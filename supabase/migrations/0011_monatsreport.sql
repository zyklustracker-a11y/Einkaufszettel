-- ============================================================================
-- Receipt AI — Schritt 13: Monatsreport als Push-Benachrichtigung
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0010 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- WAS HIER ENTSTEHT
-- ---------------------------------------------------------------------------
--
--   1. `push_subscriptions` — welches Gerät welche Benachrichtigungen bekommt.
--   2. `v_last_month_report` — die Zahlen des Vormonats, fertig zum Vorlesen.
--   3. `mark_report_sent()` — damit derselbe Monat nicht zweimal kommt.
--
-- ---------------------------------------------------------------------------
-- DIE ZAHLEN STEHEN HIER, DIE SÄTZE NICHT
-- ---------------------------------------------------------------------------
--
-- Die Sicht liefert Beträge und Anzahlen; die deutschen Sätze baut
-- `supabase/functions/monatsreport/report.ts` daraus. Das ist dieselbe Linie wie
-- überall in diesem Projekt (PROJEKT.md: „Formatierung ausschließlich in der
-- UI") — und es hat einen zweiten Nutzen: Ein Satz, der im Code entsteht, lässt
-- sich mit Tests festnageln. Ein Satz, den SQL zusammensetzt, nicht.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Die Abonnements
--
-- **Ein Eintrag je Gerät**, nicht je Nutzer: Wer die App auf iPhone und iPad
-- installiert hat, bekommt zwei Abos, und beide sollen die Meldung bekommen. Die
-- Adresse (`endpoint`) ist der Schlüssel — sie kommt vom Push-Dienst und ist
-- weltweit eindeutig.
--
-- **`p256dh` und `auth` sind Schlüsselmaterial des Geräts.** Sie erlauben genau
-- eines: eine Nachricht zu verschlüsseln, die nur dieses Gerät lesen kann. Wer
-- sie hätte, könnte damit nichts entschlüsseln und nichts abfragen.
--
-- `failed_at` merkt sich ein abgelaufenes Abo (der Push-Dienst antwortet dann mit
-- 404 oder 410). Gelöscht wird es beim nächsten Lauf — nicht sofort, damit sich
-- im SQL-Editor nachsehen lässt, warum ein Gerät nichts mehr bekommt.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  /** Für welchen Monat zuletzt gesendet wurde. Verhindert Doppelmeldungen. */
  last_month    date,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  failed_at     timestamptz,
  fail_reason   text
);

create index if not exists push_subscriptions_household_idx
  on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;


-- ============================================================================
-- 2. Der Vormonat in Zahlen
--
-- Eine Zeile je Haushalt, der im Vormonat überhaupt etwas erfasst hat. Wer nicht
-- eingekauft hat, bekommt keine Meldung — „Du hast 0 € ausgegeben" ist keine
-- Nachricht, sondern eine Störung.
--
-- **`security_invoker` steht auch hier**, obwohl die Sicht vom Server aus
-- gelesen wird. Für den Dienstschlüssel gilt die Zeilensicherheit ohnehin nicht;
-- für einen angemeldeten Nutzer schon, und der soll seinen eigenen Report auch in
-- der App ansehen können, ohne dass eine zweite Sicht dafür nötig wäre.
-- ============================================================================

create or replace view public.v_last_month_report
with (security_invoker = true) as
with month_bounds as (
  select
    (date_trunc('month', current_date) - interval '1 month')::date as month,
    (date_trunc('month', current_date) - interval '2 months')::date as previous_month
)
select
  m.household_id,
  b.month,
  m.food_cents,
  m.dining_cents,
  m.nonfood_cents,
  m.total_cents,
  m.receipt_count,
  coalesce(bu.amount_cents, 0)::bigint     as budget_cents,
  coalesce(pm.total_cents, 0)::bigint      as previous_total_cents,
  top.name                                 as top_product_name,
  coalesce(top.amount_cents, 0)::bigint    as top_product_cents,
  coalesce(sav.excess_cents, 0)::bigint    as savings_excess_cents
from month_bounds b
join public.v_month_summary m
  on m.month = b.month
left join public.v_month_summary pm
  on pm.household_id = m.household_id and pm.month = b.previous_month
-- Das zuletzt gesetzte Budget, das für diesen Monat galt.
left join lateral (
  select bb.amount_cents
  from public.budgets bb
  where bb.household_id = m.household_id and bb.month <= b.month
  order by bb.month desc
  limit 1
) bu on true
left join lateral (
  select t.name, t.amount_cents
  from public.v_top_products t
  where t.household_id = m.household_id and t.month = b.month
  order by t.rank
  limit 1
) top on true
-- Sparpotenzial ist eine Sicht auf den **laufenden** Monat; für den Report zählt
-- deshalb nur die Summe, die daraus gerade offen ist.
left join lateral (
  select sum(s.excess_cents) as excess_cents
  from public.v_savings_current_month s
  where s.household_id = m.household_id
) sav on true
where m.total_cents > 0;

grant select on public.v_last_month_report to authenticated;


-- ============================================================================
-- 3. Gesendet — vermerken
--
-- Eine eigene kleine Funktion statt eines UPDATE aus der Edge Function heraus:
-- Sie ist die einzige Stelle, an der `last_month` gesetzt wird, und sie setzt
-- ihn **nur nach vorn**. Ein zweiter Lauf im selben Monat — etwa weil der
-- Zeitplan zweimal ausgelöst hat — schickt damit nichts noch einmal.
--
-- `SECURITY DEFINER` ist hier bewusst **nicht** gesetzt: Die Funktion wird vom
-- Dienstschlüssel aufgerufen, der ohnehin alles darf, und für einen Nutzer soll
-- sie nichts Zusätzliches können.
-- ============================================================================

create or replace function public.mark_report_sent(p_endpoint text, p_month date)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.push_subscriptions
     set last_month   = p_month,
         last_sent_at = now(),
         failed_at    = null,
         fail_reason  = null
   where endpoint = p_endpoint
     and (last_month is null or last_month < p_month);
$$;

revoke all on function public.mark_report_sent(text, date) from public;
grant execute on function public.mark_report_sent(text, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
