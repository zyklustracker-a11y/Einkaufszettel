-- ============================================================================
-- Was Supabase mitbringt und eine nackte Postgres-Instanz nicht
--
-- Die Migrationen setzen drei Dinge voraus, die es in einem Supabase-Projekt
-- schon gibt: das Schema `auth` mit der Tabelle `users`, die Funktion
-- `auth.uid()` und die Rollen `anon`, `authenticated`, `service_role`. Damit
-- sich die Migrationen auf einem eigenen Rechner ausführen und prüfen lassen,
-- werden sie hier nachgebaut — so schmal wie möglich.
--
-- **Das hier gehört ausdrücklich nicht in die Datenbank des Nutzers.** Es ist
-- Prüfwerkzeug und läuft nur in `supabase/tests/run.sh`.
-- ============================================================================

create extension if not exists pgcrypto;

-- Die drei Rollen, auf die die Migrationen Rechte vergeben.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  -- Supabase legt hier ab, was Google beim Login mitschickt. Die
  -- Mitgliederliste liest daraus den Anzeigenamen.
  raw_user_meta_data  jsonb not null default '{}'::jsonb
);

/*
 * Wer gerade angemeldet ist.
 *
 * In Supabase liest diese Funktion den Anspruch `sub` aus dem JWT. Hier liest
 * sie dieselbe Einstellung, die PostgREST dafür setzt — die Prüfungen können sie
 * also mit `set request.jwt.claim.sub` umschalten und damit einen anderen Nutzer
 * spielen.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;

/*
 * Die Rolle, unter der die Prüfungen laufen.
 *
 * Wichtig: **nicht** als Eigentümer der Tabellen. Ein Superuser umgeht die
 * Zeilensicherheit, und dann prüfte man die Sichten ohne genau das, was sie
 * absichern soll — die Haushaltstrennung.
 */
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pruefer') then
    create role pruefer login;
  end if;
end
$$;

grant authenticated to pruefer;
