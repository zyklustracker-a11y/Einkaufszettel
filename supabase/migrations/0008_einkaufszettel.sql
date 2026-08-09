-- ============================================================================
-- Receipt AI — Schritt 9: Einkaufszettel
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0007 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- WAS HIER ENTSTEHT
-- ---------------------------------------------------------------------------
--
--   1. `shopping_lists` und `shopping_list_items` — eine offene Liste je
--      Haushalt.
--   2. `v_product_rhythm` — Kaufrhythmus je Produkt: Median des Abstands,
--      Streuung, Fälligkeit, übliche Menge, erwarteter Preis.
--   3. `v_shopping_suggestions` — was heute fällig ist.
--   4. `shopping_list_refresh()` — Liste holen und neue Vorschläge ergänzen.
--   5. `save_receipt()` hakt beim Speichern ab, was auf dem Zettel stand.
--
-- ---------------------------------------------------------------------------
-- WARUM DER MEDIAN UND NICHT DER MITTELWERT
-- ---------------------------------------------------------------------------
--
-- Ein Urlaub reißt eine Lücke von drei Wochen in einen Sechs-Tage-Rhythmus. Der
-- Mittelwert wandert dadurch dauerhaft nach oben, der Median nicht
-- (KONZEPT-ERWEITERUNGEN.md, Abschnitt 6). Dasselbe gilt für die übliche Menge:
-- Ein Hamsterkauf soll den Zettel nicht umschreiben.
--
-- ---------------------------------------------------------------------------
-- WARUM ES „STABIL" UND „ZUFÄLLIG" GIBT
-- ---------------------------------------------------------------------------
--
-- Milch alle sechs bis acht Tage ist ein Rhythmus. Grillkohle im Mai und im
-- August ist keiner — der Median wäre rechnerisch da, sagte aber nichts voraus.
-- Nur stabile Produkte kommen ungefragt auf den Zettel; die übrigen tauchen gar
-- nicht erst auf, statt jede Woche vorgeschlagen und weggewischt zu werden.
--
-- Gemessen wird mit dem **Quartilsabstand** und nicht mit der
-- Standardabweichung: Er ist gegen einzelne Ausreißer unempfindlich, und genau
-- die sind hier der Normalfall.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Die Listen
--
-- **Eine offene Liste je Haushalt** — das ist die ganze Verwaltung. Ein
-- Teilindex sichert das ab; ohne ihn entstünden bei zwei Familienmitgliedern,
-- die gleichzeitig den Tab öffnen, zwei Listen.
--
-- Eine abgeschlossene Liste bleibt stehen. Sie kostet nichts und beantwortet
-- später die Frage „was stand eigentlich letzte Woche drauf".
-- ============================================================================

create table if not exists public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists shopping_lists_household_idx
  on public.shopping_lists (household_id, created_at desc);

create unique index if not exists shopping_lists_one_open_idx
  on public.shopping_lists (household_id) where completed_at is null;

/*
 * Ein Eintrag auf dem Zettel.
 *
 * `canonical_product_id` ist optional: Ein eigener Eintrag („Blumen für Oma")
 * hat kein Produkt in der Datenbank, und er soll trotzdem auf den Zettel dürfen
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 6).
 *
 * **`removed_at` statt DELETE.** Ein weggewischter Vorschlag muss in Erinnerung
 * bleiben, sonst schlüge ihn der nächste Aufruf sofort wieder vor — „ein
 * entfernter Vorschlag kommt in diesem Durchgang nicht wieder". Gelöscht wird er
 * mit der Liste, wenn der Einkauf abgeschlossen ist.
 */
create table if not exists public.shopping_list_items (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  list_id              uuid not null references public.shopping_lists (id) on delete cascade,
  canonical_product_id uuid,
  /** Der Anzeigetext. Bei einem Vorschlag der Produktname, sonst freier Text. */
  label                text not null check (char_length(btrim(label)) > 0),
  quantity_base        integer check (quantity_base is null or quantity_base > 0),
  quantity_unit        text check (quantity_unit is null or quantity_unit in ('kg','g','l','ml','stk')),
  expected_price_cents integer,
  source               text not null default 'manual',
  checked_at           timestamptz,
  removed_at           timestamptz,
  created_at           timestamptz not null default now(),
  foreign key (household_id, canonical_product_id)
    references public.canonical_products (household_id, id) on delete set null
);

alter table public.shopping_list_items drop constraint if exists shopping_list_items_source_values;
alter table public.shopping_list_items
  add constraint shopping_list_items_source_values check (source in ('suggestion', 'manual'));

create index if not exists shopping_list_items_list_idx
  on public.shopping_list_items (list_id);

-- Ein Produkt steht höchstens einmal auf einer Liste. Das ist die Bedingung,
-- an der `shopping_list_refresh()` erkennt, was schon dasteht — auch dann, wenn
-- der Eintrag weggewischt wurde.
create unique index if not exists shopping_list_items_product_idx
  on public.shopping_list_items (list_id, canonical_product_id)
  where canonical_product_id is not null;

alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;

drop policy if exists shopping_lists_own on public.shopping_lists;
create policy shopping_lists_own on public.shopping_lists
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

drop policy if exists shopping_list_items_own on public.shopping_list_items;
create policy shopping_list_items_own on public.shopping_list_items
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

grant select, insert, update, delete on public.shopping_lists      to authenticated;
grant select, insert, update, delete on public.shopping_list_items to authenticated;


-- ============================================================================
-- 2. Der Kaufrhythmus
--
-- Eine Zeile je kanonischem Produkt mit **mindestens drei Käufen** — darunter
-- gibt es höchstens einen Abstand, und aus einem Abstand lässt sich kein
-- Rhythmus ablesen.
--
-- Gezählt werden **Kauftage**, nicht Positionen: Zwei Bons am selben Samstag
-- sind ein Einkauf, und zwei Zeilen desselben Produkts auf einem Bon (etwa mit
-- und ohne Rabatt) erst recht.
--
-- Gastronomie fällt heraus. „Pizza alle neun Tage" wäre eine Beobachtung über
-- Restaurantbesuche und kein Einkaufszettel-Eintrag.
-- ============================================================================

create or replace view public.v_product_rhythm
with (security_invoker = true) as
with purchases as (
  select distinct
    i.household_id,
    i.canonical_product_id as product_id,
    i.purchased_on
  from public.v_items i
  where i.canonical_product_id is not null
    and not i.is_gastro
),
gaps as (
  select
    p.household_id,
    p.product_id,
    p.purchased_on,
    (p.purchased_on - lag(p.purchased_on) over (
      partition by p.household_id, p.product_id order by p.purchased_on
    ))::int as gap_days
  from purchases p
),
-- Menge und Preis kommen aus den Positionen, nicht aus den Kauftagen: Wie viel
-- üblich ist, steht an der Zeile.
amounts as (
  select
    i.household_id,
    i.canonical_product_id as product_id,
    percentile_disc(0.5) within group (order by i.quantity_base)
      filter (where i.quantity_base is not null)                as median_quantity,
    mode() within group (order by i.quantity_unit)
      filter (where i.quantity_unit is not null)                as quantity_unit,
    /*
     * Der erwartete Preis ist der **günstigste tatsächlich bezahlte
     * Zeilenbetrag** der letzten sechs Monate — nicht Bestpreis × Menge.
     *
     * Das weicht vom Konzept ab, und zwar bewusst: Ein Einzelpreis mal einer
     * Medianmenge ergibt eine Zahl, die so nie auf einem Bon stand, und bei
     * einer Position ohne Einzelpreis wäre sie schlicht falsch. Der günstigste
     * bezahlte Betrag ist dagegen ein Betrag, den es wirklich gab — samt der
     * Menge, die man üblicherweise mitnimmt.
     */
    min(i.total_cents) filter (
      where i.total_cents > 0 and i.purchased_on >= current_date - 180
    )                                                           as expected_price_cents
  from public.v_items i
  where i.canonical_product_id is not null
    and not i.is_gastro
  group by 1, 2
)
select
  g.household_id,
  g.product_id,
  cp.name                                     as product_name,
  cp.category_key,
  count(*)::int                               as purchase_count,
  max(g.purchased_on)                         as last_purchased_on,
  (current_date - max(g.purchased_on))::int   as days_since_last,
  round(percentile_cont(0.5) within group (order by g.gap_days)
    filter (where g.gap_days is not null))::int as median_gap_days,
  round(
    percentile_cont(0.75) within group (order by g.gap_days) filter (where g.gap_days is not null)
    - percentile_cont(0.25) within group (order by g.gap_days) filter (where g.gap_days is not null)
  )::int                                      as spread_days,
  a.median_quantity,
  a.quantity_unit,
  a.expected_price_cents
from gaps g
join public.canonical_products cp
  on cp.id = g.product_id and cp.household_id = g.household_id
join amounts a
  on a.household_id = g.household_id and a.product_id = g.product_id
group by g.household_id, g.product_id, cp.name, cp.category_key,
         a.median_quantity, a.quantity_unit, a.expected_price_cents
having count(*) >= 3;


-- ============================================================================
-- 3. Was heute fällig ist
--
-- Drei Bedingungen, und jede hat einen Grund:
--
--   * **Stabiler Rhythmus.** Der Quartilsabstand darf höchstens 60 % des
--     Medians betragen, mindestens aber vier Tage — bei einem
--     Sechs-Tage-Rhythmus wären das ±4 Tage Schwankung, und das ist noch ein
--     Rhythmus. Bei Grillkohle (Mai, August, Mai) ist es keiner.
--   * **Fällig.** Letzter Kauf plus Median liegt heute oder früher. Ein Tag
--     Vorlauf ist eingebaut: Wer alle sieben Tage Milch kauft, will sie am
--     siebten Tag auf dem Zettel haben und nicht am achten.
--   * **Nicht ewig her.** Liegt der letzte Kauf mehr als das Vierfache des
--     Rhythmus zurück, wurde das Produkt offenbar abgewählt. Es dann noch
--     vorzuschlagen wäre hartnäckig und nicht hilfreich.
-- ============================================================================

create or replace view public.v_shopping_suggestions
with (security_invoker = true) as
select
  r.household_id,
  r.product_id,
  r.product_name,
  r.category_key,
  r.purchase_count,
  r.last_purchased_on,
  r.days_since_last,
  r.median_gap_days,
  r.spread_days,
  r.median_quantity,
  r.quantity_unit,
  r.expected_price_cents,
  -- Negativ heißt überfällig. Das ist die Sortierung: Was am längsten fehlt,
  -- steht oben.
  (r.median_gap_days - r.days_since_last)::int as due_in_days,
  b.merchant_id                                as best_merchant_id,
  b.price_cents                                as best_price_cents
from public.v_product_rhythm r
left join public.v_product_best_price b
  on b.household_id = r.household_id and b.product_id = r.product_id
where r.median_gap_days > 0
  and r.spread_days <= greatest(4, r.median_gap_days * 0.6)
  and r.days_since_last >= r.median_gap_days - 1
  and r.days_since_last <= r.median_gap_days * 4;


-- ============================================================================
-- 3b. Die Schwelle — an genau einer Stelle
--
-- „Mindestens 14 Tage und mindestens 4 Einkäufe, beides zusammen, weil Zeit
-- allein nichts nützt, wenn nicht eingekauft wurde" (KONZEPT-ERWEITERUNGEN.md,
-- Abschnitt 6).
--
-- Die beiden Zahlen stehen **hier** und nicht im Browser, obwohl der Browser
-- den Fortschrittsbalken zeichnet. Grund: Dieselbe Schwelle entscheidet, ob
-- `shopping_list_refresh()` überhaupt Vorschläge einträgt. Stünde sie zweimal
-- da, zeigte der Balken irgendwann „geschafft", während die Datenbank noch
-- schwiege — oder umgekehrt.
--
-- `v_household_stats` wächst dafür um drei Spalten am Ende (weiter vorn geht
-- nicht, `create or replace view` verlangt eine unveränderte Spaltenliste).
-- ============================================================================

create or replace view public.v_household_stats
with (security_invoker = true) as
select
  h.id                                      as household_id,
  coalesce(r.receipt_count, 0)              as receipt_count,
  r.first_purchased_on,
  r.last_purchased_on,
  coalesce(r.day_span, 0)                   as day_span,
  coalesce(p.product_count, 0)              as product_count,
  coalesce(r.merchant_count, 0)             as merchant_count,
  4                                         as required_receipts,
  14                                        as required_days,
  (coalesce(r.receipt_count, 0) >= 4 and coalesce(r.day_span, 0) >= 14)
                                            as suggestions_ready
from public.households h
left join lateral (
  select
    count(*)::int                                       as receipt_count,
    min(rr.purchased_on)                                as first_purchased_on,
    max(rr.purchased_on)                                as last_purchased_on,
    (current_date - min(rr.purchased_on))::int          as day_span,
    count(distinct rr.merchant_id)::int                 as merchant_count
  from public.receipts rr
  where rr.household_id = h.id and rr.status = 'confirmed'
) r on true
left join lateral (
  select count(*)::int as product_count
  from public.canonical_products cp
  where cp.household_id = h.id
) p on true;


-- ============================================================================
-- 4. Die Liste holen und ergänzen
--
-- Ein Aufruf, drei Dinge: die offene Liste finden oder anlegen, fällige
-- Vorschläge eintragen, die id zurückgeben.
--
-- **Ergänzt wird nur, was noch nicht dasteht.** Der Teilindex auf
-- (`list_id`, `canonical_product_id`) sorgt dafür — und weil ein weggewischter
-- Eintrag mit `removed_at` stehen bleibt statt gelöscht zu werden, kommt er in
-- diesem Durchgang auch nicht wieder.
--
-- **Kein SECURITY DEFINER**: Die Funktion läuft mit den Rechten des Aufrufers.
-- ============================================================================

create or replace function public.shopping_list_refresh()
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
  v_list      uuid;
  v_ready     boolean;
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    raise exception 'Zu diesem Konto gehört noch kein Haushalt.'
      using errcode = 'insufficient_privilege';
  end if;

  select l.id into v_list
  from public.shopping_lists l
  where l.household_id = v_household and l.completed_at is null
  limit 1;

  if v_list is null then
    insert into public.shopping_lists (household_id) values (v_household) returning id into v_list;
  end if;

  /*
   * Die Liste gibt es immer — eigene Einträge darf man von Anfang an
   * hinschreiben. **Vorschläge** kommen erst ab der Schwelle: Aus zwei
   * Einkäufen in drei Tagen lässt sich kein Rhythmus ablesen, und ein Zettel,
   * der Unsinn vorschlägt, wird nach dem zweiten Mal nicht mehr geöffnet.
   */
  select s.suggestions_ready into v_ready
  from public.v_household_stats s
  where s.household_id = v_household;

  if not coalesce(v_ready, false) then
    return v_list;
  end if;

  insert into public.shopping_list_items (
    household_id, list_id, canonical_product_id, label,
    quantity_base, quantity_unit, expected_price_cents, source
  )
  select
    v_household, v_list, s.product_id, s.product_name,
    s.median_quantity, s.quantity_unit, s.expected_price_cents, 'suggestion'
  from public.v_shopping_suggestions s
  where s.household_id = v_household
  on conflict do nothing;

  return v_list;
end;
$$;

comment on function public.shopping_list_refresh() is
  'Die offene Einkaufsliste des Haushalts, ergänzt um alles, was gerade fällig ist.';

revoke all on function public.shopping_list_refresh() from public;
grant execute on function public.shopping_list_refresh() to authenticated;


-- ============================================================================
-- 5. Die Liste, wie der Screen sie braucht
--
-- Sortiert nach Kategorie — so, wie man den Laden durchläuft. Die Farbe kommt
-- mit, damit der Zettel dieselbe Zuordnung zeigt wie der Kategorienring.
-- ============================================================================

create or replace view public.v_shopping_list_items
with (security_invoker = true) as
select
  i.id,
  i.household_id,
  i.list_id,
  i.canonical_product_id,
  i.label,
  i.quantity_base,
  i.quantity_unit,
  i.expected_price_cents,
  i.source,
  (i.checked_at is not null)   as checked,
  i.created_at,
  cp.category_key,
  coalesce(c.name, 'Ohne Kategorie') as category_name,
  coalesce(c.sort_order, 999)        as category_sort,
  c.color                            as category_color,
  r.median_gap_days,
  r.days_since_last,
  b.merchant_id                      as best_merchant_id
from public.shopping_list_items i
join public.shopping_lists l
  on l.id = i.list_id
left join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
left join public.categories c
  on c.household_id = i.household_id and c.key = cp.category_key
left join public.v_product_rhythm r
  on r.household_id = i.household_id and r.product_id = i.canonical_product_id
left join public.v_product_best_price b
  on b.household_id = i.household_id and b.product_id = i.canonical_product_id
where i.removed_at is null
  and l.completed_at is null;


grant select on public.v_product_rhythm        to authenticated;
grant select on public.v_shopping_suggestions  to authenticated;
grant select on public.v_shopping_list_items   to authenticated;


-- ============================================================================
-- 6. Abhaken beim Speichern
--
-- „Schließt den Kreis zwischen Planung und Erfassung, ohne Zutun"
-- (KONZEPT-ERWEITERUNGEN.md). Der richtige Ort dafür ist `save_receipt`: Sie
-- weiß, welche Produkte gerade geschrieben wurden, und sie ist eine
-- Transaktion — entweder ist der Bon da und der Zettel abgehakt, oder nichts
-- von beidem.
--
-- Die Funktion ist unverändert bis auf den Block ganz am Ende. Der Rest steht
-- wortgleich in 0004; wer ihn liest, findet dort auch die Begründungen.
-- ============================================================================

create or replace function public.save_receipt(p_payload jsonb)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household   uuid;
  v_merchant    uuid;
  v_receipt     uuid;
  v_merchant_nm text;
  v_kind        text;
  v_kind_src    text;
  v_tip         integer;
  v_currency    text;
  v_original    integer;
  v_rate        numeric(12,6);
  v_rate_date   date;
  v_pos         jsonb;
  v_line        integer := 0;
  v_item_kind   text;
  v_raw         text;
  v_name        text;
  v_category    text;
  v_source      text;
  v_product     uuid;
  v_heat        text;
  v_homog       text;
  v_qty_base    integer;
  v_qty_unit    text;
  v_known_id    uuid;
  v_known_src   text;
  -- Neu mit Schritt 9: die Produkte dieses Bons, zum Abhaken.
  v_products    uuid[] := '{}';
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    raise exception 'Zu diesem Konto gehört noch kein Haushalt.'
      using errcode = 'insufficient_privilege';
  end if;

  /* ------------------------------------------------------------- Händler */

  v_merchant_nm := btrim(coalesce(p_payload->>'haendler', ''));
  v_kind        := case when p_payload->>'haendler_art' = 'gastro' then 'gastro' else 'retail' end;
  v_kind_src    := case when p_payload->>'haendler_art_quelle' = 'user' then 'user' else 'model' end;

  if v_merchant_nm <> '' then
    select m.id into v_merchant
    from public.merchants m
    where m.household_id = v_household
      and public.merchant_key(m.name) = public.merchant_key(v_merchant_nm)
    order by m.created_at
    limit 1;

    if v_merchant is null then
      insert into public.merchants (household_id, name, kind)
      values (v_household, v_merchant_nm, v_kind)
      returning id into v_merchant;
    elsif v_kind_src = 'user' then
      update public.merchants m
         set kind = v_kind
       where m.id = v_merchant and m.household_id = v_household;
    end if;
  end if;

  /* --------------------------------------------------- Trinkgeld, Währung */

  v_tip := abs(coalesce((p_payload->>'trinkgeld_cent')::integer, 0));

  v_currency := upper(btrim(coalesce(p_payload->>'waehrung', 'EUR')));
  if v_currency !~ '^[A-Z]{3}$' then v_currency := 'EUR'; end if;

  v_original  := nullif(p_payload->>'original_summe_cent', '')::integer;
  v_rate      := nullif(p_payload->>'kurs', '')::numeric;
  v_rate_date := nullif(p_payload->>'kurs_datum', '')::date;

  if v_currency = 'EUR' or v_original is null or v_rate is null or v_rate <= 0 then
    v_currency  := 'EUR';
    v_original  := null;
    v_rate      := null;
    v_rate_date := null;
  end if;

  /* ----------------------------------------------------------------- Bon */

  v_receipt := nullif(btrim(coalesce(p_payload->>'bon_id', '')), '')::uuid;

  if v_receipt is not null then
    update public.receipts r
       set merchant_id          = v_merchant,
           purchased_on         = coalesce(nullif(p_payload->>'gekauft_am', '')::date, r.purchased_on),
           status               = 'confirmed',
           printed_total_cents  = coalesce((p_payload->>'summe_cent')::integer, 0),
           tip_cents            = v_tip,
           currency             = v_currency,
           original_total_cents = v_original,
           exchange_rate        = v_rate,
           rate_date            = v_rate_date,
           note                 = nullif(btrim(coalesce(p_payload->>'notiz', '')), '')
     where r.id = v_receipt and r.household_id = v_household;

    if not found then
      raise exception 'Diesen Einkauf gibt es nicht mehr.' using errcode = 'no_data_found';
    end if;

    delete from public.receipt_items i
     where i.receipt_id = v_receipt and i.household_id = v_household;

  else
    insert into public.receipts (
      household_id, merchant_id, purchased_on, status, printed_total_cents,
      image_path, note, tip_cents, currency, original_total_cents, exchange_rate, rate_date
    )
    values (
      v_household,
      v_merchant,
      coalesce(nullif(p_payload->>'gekauft_am', '')::date, current_date),
      'confirmed',
      coalesce((p_payload->>'summe_cent')::integer, 0),
      null,
      nullif(btrim(coalesce(p_payload->>'notiz', '')), ''),
      v_tip, v_currency, v_original, v_rate, v_rate_date
    )
    returning id into v_receipt;
  end if;

  /* ---------------------------------------------------------- Positionen */

  for v_pos in
    select value from jsonb_array_elements(coalesce(p_payload->'positionen', '[]'::jsonb))
  loop
    v_line := v_line + 1;

    v_item_kind := case when v_pos->>'art' in ('pfand', 'rabatt') then v_pos->>'art' else 'artikel' end;
    v_raw  := btrim(coalesce(v_pos->>'rohtext', ''));
    v_name := btrim(coalesce(v_pos->>'name', ''));
    if v_name = '' then v_name := v_raw; end if;
    if v_name = '' then v_name := 'Position ' || v_line; end if;

    v_category := nullif(btrim(coalesce(v_pos->>'kategorie', '')), '');
    v_source   := case when v_pos->>'quelle' = 'user' then 'user' else 'model' end;
    v_product  := null;

    v_heat := coalesce(v_pos->>'milch_erhitzung', 'unbekannt');
    if v_heat not in ('roh', 'pasteurisiert', 'esl', 'uht') then v_heat := 'unbekannt'; end if;
    v_homog := coalesce(v_pos->>'milch_homogenisiert', 'unbekannt');
    if v_homog not in ('ja', 'nein') then v_homog := 'unbekannt'; end if;

    v_qty_base := nullif(v_pos->>'menge_basis', '')::integer;
    v_qty_unit := nullif(btrim(coalesce(v_pos->>'menge_einheit', '')), '');
    if v_qty_base is null or v_qty_base <= 0
       or v_qty_unit is null or v_qty_unit not in ('kg', 'g', 'l', 'ml', 'stk') then
      v_qty_base := null;
      v_qty_unit := null;
    end if;

    v_known_id := null;
    v_known_src := null;
    if v_item_kind = 'artikel' and v_raw <> '' then
      select pm.canonical_product_id, pm.source into v_known_id, v_known_src
      from public.product_mappings pm
      where pm.household_id = v_household
        and lower(btrim(pm.raw_text)) = lower(v_raw)
      limit 1;
    end if;

    if v_item_kind = 'artikel' and v_known_src = 'user' and v_source = 'model' then
      v_product := v_known_id;
      select coalesce(cp.name, v_name) into v_name
      from public.canonical_products cp
      where cp.id = v_product and cp.household_id = v_household;
      if v_name is null or btrim(v_name) = '' then
        v_name := coalesce(nullif(btrim(coalesce(v_pos->>'name', '')), ''), v_raw);
      end if;

    elsif v_item_kind = 'artikel' and v_category is not null then
      v_product := nullif(v_pos->>'produkt_id', '')::uuid;
      if v_product is not null
         and not exists (
           select 1 from public.canonical_products cp
           where cp.id = v_product and cp.household_id = v_household
         )
      then
        v_product := null;
      end if;

      if v_product is null then
        select cp.id into v_product
        from public.canonical_products cp
        where cp.household_id = v_household
          and lower(btrim(cp.name)) = lower(v_name)
        limit 1;
      end if;

      if v_product is null then
        insert into public.canonical_products (
          household_id, name, category_key, milk_heat, milk_homogenized
        )
        values (v_household, v_name, v_category, v_heat, v_homog)
        returning id into v_product;

        insert into public.canonical_product_traits (household_id, canonical_product_id, trait_id)
        select v_household, v_product, t.id
        from public.traits t
        where t.household_id = v_household
          and t.key in (
            select jsonb_array_elements_text(coalesce(v_pos->'merkmale', '[]'::jsonb))
          )
        on conflict do nothing;

      elsif v_source = 'user' then
        update public.canonical_products cp
           set category_key     = v_category,
               milk_heat        = v_heat,
               milk_homogenized = v_homog
         where cp.id = v_product and cp.household_id = v_household;

        delete from public.canonical_product_traits cpt
         where cpt.household_id = v_household and cpt.canonical_product_id = v_product;

        insert into public.canonical_product_traits (household_id, canonical_product_id, trait_id)
        select v_household, v_product, t.id
        from public.traits t
        where t.household_id = v_household
          and t.key in (
            select jsonb_array_elements_text(coalesce(v_pos->'merkmale', '[]'::jsonb))
          )
        on conflict do nothing;
      end if;
    end if;

    if v_product is not null then
      v_products := v_products || v_product;
    end if;

    insert into public.receipt_items (
      household_id, receipt_id, line_no, raw_text, name, canonical_product_id,
      quantity_base, quantity_unit, unit_price_cents,
      total_cents, discount_cents, deposit_cents, tax_code
    )
    values (
      v_household, v_receipt, v_line,
      case when v_raw = '' then v_name else v_raw end,
      v_name,
      v_product,
      v_qty_base, v_qty_unit,
      nullif(v_pos->>'einzelpreis_cent', '')::integer,
      coalesce((v_pos->>'zeilensumme_cent')::integer, 0),
      abs(coalesce((v_pos->>'rabatt_cent')::integer, 0)),
      abs(coalesce((v_pos->>'pfand_cent')::integer, 0)),
      nullif(upper(btrim(coalesce(v_pos->>'steuer', ''))), '')
    );

    if v_item_kind = 'artikel' and v_product is not null and v_raw <> '' then
      insert into public.product_mappings (household_id, raw_text, canonical_product_id, source)
      values (v_household, v_raw, v_product, v_source)
      on conflict (household_id, lower(btrim(raw_text)))
      do update set canonical_product_id = excluded.canonical_product_id,
                    source               = excluded.source
      where product_mappings.source <> 'user' or excluded.source = 'user';
    end if;
  end loop;

  if v_line = 0 then
    update public.receipts r
       set discrepancy_cents = r.printed_total_cents
     where r.id = v_receipt and r.household_id = v_household;
  end if;

  /*
   * Den Einkaufszettel abhaken.
   *
   * Nur was noch offen ist (`checked_at is null`) und nur auf der offenen
   * Liste. Ein bereits abgehakter Eintrag behält seinen Zeitpunkt — sonst
   * verschöbe ein nachträglich bearbeiteter Bon eine Uhrzeit, die etwas anderes
   * bedeutet.
   */
  if array_length(v_products, 1) > 0 then
    update public.shopping_list_items i
       set checked_at = now()
      from public.shopping_lists l
     where l.id = i.list_id
       and l.household_id = v_household
       and l.completed_at is null
       and i.household_id = v_household
       and i.checked_at is null
       and i.removed_at is null
       and i.canonical_product_id = any (v_products);
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.save_receipt(jsonb) from public;
grant execute on function public.save_receipt(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
