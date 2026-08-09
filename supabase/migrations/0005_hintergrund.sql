-- ============================================================================
-- Receipt AI — Schritt 6: Verarbeitung im Hintergrund
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0004 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- DAS PROBLEM
-- ---------------------------------------------------------------------------
--
-- Wechselt der Nutzer während des Scans in eine andere App, friert Safari die
-- Seite ein. Die Edge Function rechnet auf dem Server weiter, aber ihre Antwort
-- kommt nirgends an: Beim Zurückkommen hängt der Verarbeitungs-Screen oder läuft
-- in die Zeitüberschreitung — obwohl das Ergebnis längst fertig war. Bei rund
-- fünfzehn Sekunden Scan-Dauer ist das keine Randerscheinung
-- (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3).
--
-- ---------------------------------------------------------------------------
-- DIE LÖSUNG: DAS ERGEBNIS LIEGT SERVERSEITIG
-- ---------------------------------------------------------------------------
--
--   1. Die App legt vor dem Scan einen Job an (`start_scan_job()`).
--   2. Die Edge Function schreibt ihr Ergebnis in den Job — nicht nur in die
--      Antwort.
--   3. Kommt die Antwort an, wird sie wie bisher direkt benutzt.
--   4. Kommt sie nicht an, holt die App beim Zurückkommen den Job ab.
--
-- **Das Bon-Foto wird weiterhin nicht gespeichert.** In `result` liegen nur die
-- erkannten Daten — dieselbe Struktur, die sonst über die Leitung ginge. Das
-- Bild geht wie bisher durch die Funktion und wird danach verworfen
-- (PROJEKT.md, Datenschutz).
--
-- **Was hier liegt, ist ein Zwischenspeicher und kein Archiv.** Jobs, die älter
-- als 24 Stunden sind, werden beim Anlegen des nächsten weggeräumt. Ein eigener
-- Zeitplan (pg_cron) wäre dafür zu viel Maschinerie: Aufgeräumt wird genau dann,
-- wenn jemand die App benutzt, und nur dann entstehen überhaupt neue Zeilen.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Die Tabelle
--
-- `created_by` ist bewusst dabei, obwohl die Zugriffsregel am Haushalt hängt:
-- Ein offener Scan gehört dem **Gerät**, das ihn angestoßen hat. Ohne diese
-- Spalte bekäme das ganze Haus die Meldung „Ein Scan ist fertig", sobald ein
-- Familienmitglied irgendwo einen Bon fotografiert — eine Aufforderung, mit der
-- niemand sonst etwas anfangen kann.
--
-- `status`:
--   running — die Funktion arbeitet noch (oder ist unterwegs abgebrochen)
--   done    — `result` trägt das Ergebnis von Durchgang 1
--   failed  — `error_code` und `error_message` sagen, warum nicht
--
-- `consumed_at` ist gesetzt, sobald die App das Ergebnis wirklich benutzt hat.
-- Erst dadurch hört der Hinweis auf dem Dashboard auf zu erscheinen. Gelöscht
-- wird die Zeile deshalb nicht: Sie zeigt beim Nachsehen im SQL-Editor, dass ein
-- Scan durchgelaufen ist, und verschwindet ohnehin nach 24 Stunden.
-- ============================================================================

create table if not exists public.scan_jobs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null,
  status        text not null default 'running',
  -- Das Ergebnis von Durchgang 1, wortgleich zu `StructureResponse`.
  result        jsonb,
  error_code    text,
  error_message text,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

alter table public.scan_jobs drop constraint if exists scan_jobs_status_values;
alter table public.scan_jobs
  add constraint scan_jobs_status_values
  check (status in ('running', 'done', 'failed'));

/*
 * Ein fertiger Job trägt ein Ergebnis, ein gescheiterter einen Grund. Ohne diese
 * Bedingung könnte ein `done` ohne `result` entstehen — und die App zeigte einen
 * Knopf an, hinter dem nichts liegt.
 */
alter table public.scan_jobs drop constraint if exists scan_jobs_outcome_pair;
alter table public.scan_jobs
  add constraint scan_jobs_outcome_pair check (
    (status = 'running' and result is null and error_code is null)
    or (status = 'done'   and result is not null)
    or (status = 'failed' and error_code is not null)
  );

create index if not exists scan_jobs_household_idx
  on public.scan_jobs (household_id, created_at desc);

-- Der Weg, den die App beim Start geht: „Gibt es für mich einen offenen Job?"
create index if not exists scan_jobs_open_idx
  on public.scan_jobs (created_by, created_at desc)
  where consumed_at is null;

alter table public.scan_jobs enable row level security;

drop policy if exists scan_jobs_own on public.scan_jobs;
create policy scan_jobs_own on public.scan_jobs
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

grant select, insert, update, delete on public.scan_jobs to authenticated;


-- ============================================================================
-- 2. Einen Job anlegen — und dabei aufräumen
--
-- Beides in einem Aufruf, weil beides zum selben Zeitpunkt gehört: Wer einen
-- neuen Scan startet, hat für die alten keine Verwendung mehr. Eine zweite
-- Anfrage nur zum Aufräumen wäre eine Anfrage, die auf dem Mobilfunkweg vor dem
-- Kamerabild liegt.
--
-- **Kein SECURITY DEFINER.** Die Funktion läuft mit den Rechten des Aufrufers;
-- in einen fremden Haushalt kann sie damit weder schreiben noch dort löschen.
-- ============================================================================

create or replace function public.start_scan_job()
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
  v_job       uuid;
begin
  select hm.household_id into v_household
  from public.household_members hm
  where hm.user_id = auth.uid()
  limit 1;

  if v_household is null then
    raise exception 'Zu diesem Konto gehört noch kein Haushalt.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Ein Zwischenspeicher, kein Archiv (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3).
  delete from public.scan_jobs j
   where j.household_id = v_household
     and j.created_at < now() - interval '24 hours';

  insert into public.scan_jobs (household_id, created_by, status)
  values (v_household, auth.uid(), 'running')
  returning id into v_job;

  return v_job;
end;
$$;

comment on function public.start_scan_job() is
  'Legt einen Scan-Job an und räumt dabei die des Haushalts weg, die älter als 24 Stunden sind.';

revoke all on function public.start_scan_job() from public;
grant execute on function public.start_scan_job() to authenticated;


-- ============================================================================
-- 3. Der offene Job dieses Geräts
--
-- Genau eine Zeile oder keine: der jüngste noch nicht abgeholte Job des
-- angemeldeten Nutzers. `running` ist ausdrücklich dabei — ein Scan, der beim
-- Einfrieren der Seite unterwegs war, steht noch auf `running`, und die App soll
-- ihn beim Zurückkommen finden und nachsehen können, ob inzwischen ein Ergebnis
-- eingetroffen ist.
--
-- Die 24-Stunden-Grenze steht auch hier, damit ein liegengebliebener Job nicht
-- doch noch auftaucht, falls seit dem letzten Scan niemand aufgeräumt hat.
-- ============================================================================

create or replace view public.v_open_scan_job
with (security_invoker = true) as
select
  j.id,
  j.household_id,
  j.status,
  j.result,
  j.error_code,
  j.error_message,
  j.created_at,
  j.finished_at
from public.scan_jobs j
where j.created_by = auth.uid()
  and j.consumed_at is null
  and j.created_at >= now() - interval '24 hours'
order by j.created_at desc
limit 1;

grant select on public.v_open_scan_job to authenticated;


-- Sagt der Schnittstelle Bescheid, dass sich das Schema geändert hat.
notify pgrst, 'reload schema';

commit;
