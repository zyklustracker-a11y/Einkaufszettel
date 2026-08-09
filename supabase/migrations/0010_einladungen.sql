-- ============================================================================
-- Receipt AI — Schritt 12: Familie einladen
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0009 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- DAS PROBLEM
-- ---------------------------------------------------------------------------
--
-- Beim ersten Login bekommt **jeder** Nutzer einen eigenen Haushalt — so steht
-- es im Trigger seit 0001, und so muss es auch sein: Ohne Haushalt gäbe keine
-- einzige Abfrage eine Zeile zurück. Meldet sich die Familie an, sitzt danach
-- jeder in seinem eigenen, leeren Haushalt und sieht die Daten der anderen
-- nicht.
--
-- Bisher half nur SQL von Hand (`supabase/README.md`, Abschnitt 5). Das hier ist
-- der Weg über die App.
--
-- ---------------------------------------------------------------------------
-- DIE FORM: EIN CODE, KEIN LINK
-- ---------------------------------------------------------------------------
--
-- Ein Einladungs**link** müsste eine Adresse in der App haben, die den Code aus
-- der Adresszeile liest — und der Nutzer muss sich vorher trotzdem anmelden,
-- sonst gibt es niemanden, den man eintragen könnte. Nach dem Rücksprung von
-- Google wäre der Code wieder weg, es sei denn, die App legte ihn irgendwo ab.
-- Für drei Familienmitglieder ist ein **Code zum Abtippen** der kürzere Weg:
-- anmelden, Code eingeben, fertig. Er lässt sich auch vorlesen.
--
-- Der Code besteht aus acht Zeichen ohne 0/O und 1/I/L — die verwechselt man
-- beim Abtippen, und ein „ungültiger Code" wäre hier die häufigste Fehlermeldung
-- statt der seltensten.
--
-- ---------------------------------------------------------------------------
-- WAS BEIM BEITRETEN MIT DEM ALTEN HAUSHALT PASSIERT
-- ---------------------------------------------------------------------------
--
-- Der Normalfall: Er ist leer, weil sich das Familienmitglied gerade erst
-- angemeldet hat. Dann wird er beim Beitreten **aufgelöst** — samt seiner neun
-- Kategorien und vierzehn Merkmale, die nie jemand benutzt hat.
--
-- Der andere Fall: Er enthält bereits Bons. Dann wird **abgelehnt**, mit einer
-- Meldung, die sagt, wie viele es sind. Zusammenführen wäre die Alternative, und
-- sie ist bewusst nicht gebaut: Sie müsste Produkte, Zuordnungen, Händler und
-- Kategorien zweier Haushalte verschmelzen, jede davon mit eigenen Schlüsseln —
-- und ein Fehler dabei wäre nicht rückgängig zu machen. Ein Haushalt, der Daten
-- hat, gehört nicht stillschweigend gelöscht.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Die Einladung
--
-- **Ein Code je Haushalt, gültig bis er abläuft oder zurückgezogen wird.**
-- Nicht ein Code je Person: Eine Familie mit zwei weiteren Mitgliedern
-- brauchte sonst zwei Codes, und der zweite ginge garantiert verloren. Der Preis
-- ist, dass ein durchgesickerter Code bis zum Ablauf gilt — deshalb sieben Tage
-- und ein Knopf zum Zurückziehen.
-- ============================================================================

create table if not exists public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);

create index if not exists household_invites_household_idx
  on public.household_invites (household_id, created_at desc);

alter table public.household_invites enable row level security;

/*
 * Sehen und zurückziehen darf ihn nur der eigene Haushalt. Wer beitritt, sieht
 * die Zeile **nicht** — er kennt ja nur den Code, und das Einlösen läuft über
 * eine Funktion mit erhöhten Rechten (siehe unten).
 */
drop policy if exists household_invites_own on public.household_invites;
create policy household_invites_own on public.household_invites
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

grant select, insert, update, delete on public.household_invites to authenticated;


-- ============================================================================
-- 2. Einen Code erzeugen
--
-- Acht Zeichen aus einem Alphabet ohne 0/O und 1/I/L. Bei 31 Zeichen sind das
-- rund 8·10^11 Möglichkeiten — genug, damit Raten aussichtslos ist, und kurz
-- genug zum Vorlesen.
--
-- **Ein vorhandener gültiger Code wird zurückgegeben statt ein zweiter
-- angelegt.** Sonst hätte man nach dreimaligem Öffnen des Screens drei gültige
-- Codes im Umlauf und wüsste nicht mehr, welcher an wen ging.
-- ============================================================================

create or replace function public.create_household_invite(p_new boolean default false)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
  v_code      text;
  v_alphabet  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i           integer;
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    raise exception 'Zu diesem Konto gehört noch kein Haushalt.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_new then
    -- „Neuen Code erzeugen" zieht den alten ausdrücklich zurück. Zwei gültige
    -- Codes nebeneinander wären genau die Unklarheit, die es zu vermeiden gilt.
    update public.household_invites
       set revoked_at = now()
     where household_id = v_household and revoked_at is null and expires_at > now();
  else
    select hi.code into v_code
    from public.household_invites hi
    where hi.household_id = v_household
      and hi.revoked_at is null
      and hi.expires_at > now()
    order by hi.created_at desc
    limit 1;

    if v_code is not null then
      return v_code;
    end if;
  end if;

  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    -- Bei acht Zeichen praktisch nie, aber ein Primärschlüsselkonflikt wäre eine
    -- Fehlermeldung, für die niemand etwas kann.
    exit when not exists (select 1 from public.household_invites where code = v_code);
  end loop;

  insert into public.household_invites (code, household_id, created_by, expires_at)
  values (v_code, v_household, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

comment on function public.create_household_invite(boolean) is
  'Der gültige Einladungscode des Haushalts, oder ein neuer. Sieben Tage gültig.';

revoke all on function public.create_household_invite(boolean) from public;
grant execute on function public.create_household_invite(boolean) to authenticated;


-- ============================================================================
-- 3. Einen Code einlösen
--
-- **Das ist die einzige Funktion in diesem Projekt mit `SECURITY DEFINER` für
-- eine Nutzeraktion**, und sie braucht es zwingend: Wer beitritt, darf die
-- Einladungszeile des fremden Haushalts nicht sehen — sonst könnte er auch alles
-- andere dort sehen. Die Prüfung, ob er darf, ist genau der Code.
--
-- Deshalb ist der Rumpf so eng geschrieben:
--
--   * Der Code muss existieren, gültig und nicht zurückgezogen sein.
--   * Geschrieben wird ausschließlich in `household_members` — und zwar für
--     `auth.uid()`, nie für eine übergebene id.
--   * Der alte Haushalt wird nur dann gelöscht, wenn er **leer** ist und
--     niemand sonst darin sitzt.
--   * `search_path` ist fixiert, damit die Funktion nicht über eine
--     untergeschobene gleichnamige Tabelle ausgehebelt werden kann.
-- ============================================================================

create or replace function public.redeem_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_target    uuid;
  v_old       uuid;
  v_receipts  integer;
  v_others    integer;
begin
  if v_user is null then
    raise exception 'Bitte melde dich an.' using errcode = 'insufficient_privilege';
  end if;

  select hi.household_id into v_target
  from public.household_invites hi
  where hi.code = upper(btrim(coalesce(p_code, '')))
    and hi.revoked_at is null
    and hi.expires_at > now();

  if v_target is null then
    raise exception 'Dieser Einladungscode ist ungültig oder abgelaufen.'
      using errcode = 'no_data_found';
  end if;

  -- Schon drin: nichts zu tun, und das ist kein Fehler.
  if exists (
    select 1 from public.household_members
    where user_id = v_user and household_id = v_target
  ) then
    return v_target;
  end if;

  select hm.household_id into v_old
  from public.household_members hm
  where hm.user_id = v_user
  limit 1;

  if v_old is not null then
    select count(*)::int into v_receipts
    from public.receipts r
    where r.household_id = v_old;

    if v_receipts > 0 then
      raise exception
        'Dein bisheriger Haushalt enthält % Einkäufe und wird deshalb nicht aufgelöst. '
        'Lösch sie zuerst, wenn du sie nicht mehr brauchst — dann klappt der Beitritt.',
        v_receipts
        using errcode = 'raise_exception';
    end if;

    delete from public.household_members
     where user_id = v_user and household_id = v_old;

    /*
     * Den leeren Haushalt wegräumen — aber nur, wenn wirklich niemand mehr
     * darin sitzt. Sonst nähme man einem anderen Familienmitglied den Boden
     * unter den Füßen weg.
     */
    select count(*)::int into v_others
    from public.household_members
    where household_id = v_old;

    if v_others = 0 then
      delete from public.households where id = v_old;
    end if;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_target, v_user, 'member')
  on conflict do nothing;

  return v_target;
end;
$$;

comment on function public.redeem_household_invite(text) is
  'Tritt dem Haushalt hinter dem Code bei. Der eigene leere Haushalt wird dabei aufgelöst.';

revoke all on function public.redeem_household_invite(text) from public;
grant execute on function public.redeem_household_invite(text) to authenticated;


-- ============================================================================
-- 4. Wer gehört dazu?
--
-- Die Mitgliederliste braucht die E-Mail-Adressen, und die stehen in
-- `auth.users` — dort kommt eine gewöhnliche Abfrage nicht hin. Deshalb eine
-- Funktion mit erhöhten Rechten, die als **Allererstes** prüft, ob der Aufrufer
-- selbst zu dem Haushalt gehört, den er ansieht.
--
-- Zurück kommt nur, was die Liste zeigt: Name, E-Mail, Rolle, Beitrittsdatum.
-- Kein Token, kein Passwort-Hash, keine fremden Haushalte.
-- ============================================================================

create or replace function public.household_members_list()
returns table (
  user_id   uuid,
  email     text,
  name      text,
  role      text,
  joined_at timestamptz,
  is_self   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp, auth
as $$
declare
  v_household uuid;
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    return;
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    coalesce(
      nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data->>'name'), ''),
      split_part(u.email::text, '@', 1)
    )                       as name,
    m.role,
    m.joined_at,
    (m.user_id = auth.uid()) as is_self
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id = v_household
  order by m.joined_at;
end;
$$;

comment on function public.household_members_list() is
  'Die Mitglieder des eigenen Haushalts mit Name und E-Mail.';

revoke all on function public.household_members_list() from public;
grant execute on function public.household_members_list() to authenticated;

notify pgrst, 'reload schema';

commit;
