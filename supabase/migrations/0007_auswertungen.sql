-- ============================================================================
-- Receipt AI — Schritt 8: Bestpreise und Analysen scharf schalten
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0006 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- WORUM ES GEHT
-- ---------------------------------------------------------------------------
--
-- Die Auswertungen rechnen seit Schritt 2c gegen echte Daten. Was fehlte, sind
-- **Schwellen**: Mit drei Bons in der Datenbank sagt „Sparpotenzial: 30 Cent"
-- nichts über Läden, sondern über ein Sonderangebot — und ein „Bestpreis", der
-- auf einem einzigen Kauf beruht, ist gar keiner.
--
-- Eine Auswertung, die mit wenigen Daten Unsinn behauptet, ist schlechter als
-- eine, die sagt „dafür reicht es noch nicht". Genau das steht hier.
--
--   1. `v_price_observations` bekommt den **Grundpreis je Beobachtung**.
--   2. `v_product_prices` füllt `base_price_cents` endlich — bisher war er
--      immer null.
--   3. `v_savings_current_month` bekommt drei Schwellen.
--   4. `v_frequent_products` — die häufigsten Käufe, nicht die teuersten.
--   5. `v_household_stats` — wie viel Datengrundlage überhaupt da ist.
--
-- ---------------------------------------------------------------------------
-- DER GRUNDPREIS WAR TOTE LEITUNG
-- ---------------------------------------------------------------------------
--
-- `v_product_prices.base_price_cents` wurde aus `canonical_products.size_base`
-- gerechnet — einer Spalte, die `save_receipt` **nie füllt**. Auf einem Bon
-- steht die Packungsgröße nämlich fast nie, und sie zu raten ist verboten
-- (PROJEKT.md). Der Grundpreis war damit immer null, und die App schrieb überall
-- „ohne Mengenangabe".
--
-- Die Angabe war die ganze Zeit da, nur an anderer Stelle: Bei einer Ware, die
-- nach Gewicht oder Volumen verkauft wird, **ist** `unit_price_cents` bereits
-- der Grundpreis — „1,79 EUR/kg" steht so auf dem Bon. Es fehlte nur die
-- Umrechnung auf eine einheitliche Anzeigeeinheit.
--
-- Für Stückware bleibt der Grundpreis null. Das ist richtig so: Ohne die
-- Packungsgröße gibt es keinen €/kg, und „ohne Mengenangabe" ist ein echter
-- Zustand und kein Fehler.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Der Grundpreis je Beobachtung
--
-- Neue Spalten kommen ans Ende — `create or replace view` verlangt, dass die
-- vorhandene Spaltenliste am Anfang unverändert bleibt.
--
-- `unit_price_cents` ist der Preis je **Anzeige**-Einheit. Heißt die `kg`, ist
-- es schon der Preis je Kilo; heißt sie `g`, ist es der Preis je Gramm und muss
-- mal tausend. Bei `stk` gibt es keinen Grundpreis — ein „Preis je Stück" ist
-- der Preis und keine zusätzliche Auskunft.
-- ============================================================================

create or replace view public.v_price_observations
with (security_invoker = true) as
select
  i.household_id,
  i.canonical_product_id                        as product_id,
  cp.name                                       as product_name,
  cp.category_key,
  cp.size_base,
  cp.size_unit,
  i.merchant_id,
  m.name                                        as merchant_name,
  i.purchased_on,
  coalesce(i.unit_price_cents, i.total_cents)   as price_cents,
  i.quantity_base,
  i.quantity_unit,
  case
    when i.unit_price_cents is null            then null
    when i.quantity_unit in ('kg', 'l')        then i.unit_price_cents
    when i.quantity_unit in ('g', 'ml')        then i.unit_price_cents * 1000
    else null
  end                                           as base_price_cents,
  case
    when i.quantity_unit in ('kg', 'g')  then 'kg'
    when i.quantity_unit in ('l', 'ml')  then 'l'
    else null
  end                                           as base_unit
from public.v_items i
join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
join public.merchants m
  on m.id = i.merchant_id and m.household_id = i.household_id
where i.canonical_product_id is not null
  and coalesce(i.unit_price_cents, i.total_cents) > 0
  and not i.is_gastro;


-- ============================================================================
-- 2. Kennzahlen je Produkt
--
-- Unverändert bis auf den Grundpreis: Ist am Produkt eine Packungsgröße
-- hinterlegt, gilt sie (dieser Weg bleibt, falls sie irgendwann gepflegt wird).
-- Sonst kommt der günstigste je gesehene Grundpreis aus den Beobachtungen.
-- ============================================================================

create or replace view public.v_product_prices
with (security_invoker = true) as
select
  o.household_id,
  o.product_id,
  o.product_name,
  o.category_key,
  min(o.price_cents)::bigint          as min_cents,
  max(o.price_cents)::bigint          as max_cents,
  round(avg(o.price_cents))::bigint   as avg_cents,
  count(*)::int                       as purchase_count,
  min(o.purchased_on)                 as first_purchased_on,
  max(o.purchased_on)                 as last_purchased_on,
  case
    when o.size_base is not null then round(
      min(o.price_cents)::numeric
      * (case o.size_unit when 'kg' then 1000 when 'l' then 1000 else 1 end)
      / o.size_base
    )::bigint
    else min(o.base_price_cents)::bigint
  end                                 as base_price_cents,
  coalesce(o.size_unit, min(o.base_unit)) as base_unit,
  -- Neu ans Ende: Bei einem einzigen Laden gibt es nichts zu vergleichen, und
  -- die App soll dann „Günstigster Preis" statt „Bestpreis" schreiben.
  count(distinct o.merchant_id)::int  as merchant_count
from public.v_price_observations o
group by o.household_id, o.product_id, o.product_name, o.category_key,
         o.size_base, o.size_unit;


-- ============================================================================
-- 3. Sparpotenzial — mit Schwellen
--
-- Drei Bedingungen, und jede fängt eine Aussage ab, die mit wenigen Daten sonst
-- falsch wäre:
--
--   * **Mindestens zwei Läden.** Ohne das hieße „woanders günstiger" in
--     Wahrheit „derselbe Laden, anderer Tag" — das ist eine Aktion und keine
--     Ladenwahl. Genau das steht auch im Leerzustand des Screens.
--   * **Mindestens 20 Cent Mehrkosten je Produkt.** Darunter ist es Rauschen:
--     Pfandzeilen, Rundungen, ein Cent Preisanpassung. Ein Hinweis, der zum
--     Ladenwechsel wegen zwölf Cent rät, wird nicht ernst genommen — und das
--     färbt auf die Hinweise ab, die stimmen.
--   * **Der Bestpreis ist höchstens ein halbes Jahr alt.** Ein Preis von 2024
--     ist heute nicht mehr erreichbar; ihn als Maßstab zu nehmen erzeugt ein
--     Sparpotenzial, das niemand heben kann.
--
-- Die Zahlen stehen als Literale im SQL. Eine Konstantentabelle dafür wäre eine
-- Einstellung, die niemand je anfasst — und drei Zahlen mit Begründung
-- danebenzuschreiben ist ehrlicher als ein Regler ohne.
-- ============================================================================

drop view if exists public.v_savings_current_month;

create view public.v_savings_current_month
with (security_invoker = true) as
with recent as (
  -- Nur das letzte halbe Jahr, für Bestpreis wie Vergleich.
  select * from public.v_price_observations o
  where o.purchased_on >= current_date - 180
),
comparable as (
  select r.household_id, r.product_id
  from recent r
  group by r.household_id, r.product_id
  having count(distinct r.merchant_id) >= 2
),
best as (
  select distinct on (r.household_id, r.product_id)
    r.household_id, r.product_id, r.merchant_id, r.merchant_name, r.purchased_on, r.price_cents
  from recent r
  order by r.household_id, r.product_id, r.price_cents asc, r.purchased_on desc
),
overpaid as (
  select
    r.household_id,
    r.product_id,
    r.product_name,
    r.merchant_id,
    r.merchant_name,
    r.purchased_on,
    r.price_cents,
    b.price_cents as best_price_cents
  from recent r
  join comparable c
    on c.household_id = r.household_id and c.product_id = r.product_id
  join best b
    on b.household_id = r.household_id and b.product_id = r.product_id
  where r.purchased_on >= date_trunc('month', current_date)::date
    and r.purchased_on <= current_date
    and r.price_cents > b.price_cents
),
totals as (
  select
    household_id,
    product_id,
    product_name,
    count(*)::int                               as overpaid_count,
    sum(price_cents - best_price_cents)::bigint as excess_cents
  from overpaid
  group by household_id, product_id, product_name
  having sum(price_cents - best_price_cents) >= 20
),
worst as (
  select distinct on (household_id, product_id)
    household_id, product_id, merchant_id, merchant_name, price_cents, purchased_on
  from overpaid
  order by household_id, product_id, price_cents desc, purchased_on desc
)
select
  t.household_id,
  t.product_id,
  t.product_name,
  b.merchant_id     as best_merchant_id,
  b.merchant_name   as best_merchant_name,
  b.price_cents     as best_price_cents,
  b.purchased_on    as best_purchased_on,
  w.merchant_id     as worst_merchant_id,
  w.merchant_name   as worst_merchant_name,
  w.price_cents     as worst_price_cents,
  w.purchased_on    as worst_purchased_on,
  t.overpaid_count,
  t.excess_cents
from totals t
join best  b on b.household_id = t.household_id and b.product_id = t.product_id
join worst w on w.household_id = t.household_id and w.product_id = t.product_id;


-- ============================================================================
-- 4. Häufigste Käufe
--
-- Die Top-10-Liste zeigt, wofür am meisten Geld weggeht. Das ist eine andere
-- Frage als „was kaufe ich ständig" — und die zweite ist für einen Haushalt die
-- nützlichere: Sie sagt, welche Produkte sich ein Preisvergleich überhaupt
-- lohnt, und sie ist die Vorstufe zum Einkaufszettel.
--
-- **Mindestens zwei Käufe**, sonst wäre es eine Liste von allem. Und ein Fenster
-- von sechs Monaten, damit ein Produkt, das man voriges Jahr einmal kaufte,
-- nicht ewig oben mitläuft.
--
-- Gruppiert wird über den Produktnamen, wie bei `v_top_products`: Eine Position
-- ohne Produktzuordnung soll trotzdem gezählt werden.
-- ============================================================================

create or replace view public.v_frequent_products
with (security_invoker = true) as
select
  t.household_id,
  t.name,
  t.purchase_count,
  t.amount_cents,
  t.first_purchased_on,
  t.last_purchased_on,
  t.rank
from (
  select
    i.household_id,
    i.product_name                            as name,
    count(*)::int                             as purchase_count,
    sum(i.total_cents)::bigint                as amount_cents,
    min(i.purchased_on)                       as first_purchased_on,
    max(i.purchased_on)                       as last_purchased_on,
    row_number() over (
      partition by i.household_id
      order by count(*) desc, sum(i.total_cents) desc, i.product_name
    )::int                                    as rank
  from public.v_items i
  where i.purchased_on >= (current_date - interval '6 months')::date
  group by i.household_id, i.product_name
  having count(*) >= 2
) t;


-- ============================================================================
-- 5. Wie viel Grundlage ist überhaupt da?
--
-- Eine Zeile je Haushalt, auch wenn noch kein einziger Bon existiert — die
-- Sicht geht von `households` aus. Damit muss die App nie „keine Zeile" von
-- „alles null" unterscheiden.
--
-- `day_span` zählt die Tage seit dem **ersten** Einkauf, nicht seit der
-- Anmeldung: Gelernt wird aus Einkäufen, und vorher gibt es nichts zu lernen.
-- Der Einkaufszettel aus Schritt 9 braucht genau diese beiden Zahlen
-- (mindestens 14 Tage und mindestens 4 Einkäufe), und die Analysen sagen damit,
-- wie belastbar ihre eigenen Zahlen sind.
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
  coalesce(r.merchant_count, 0)             as merchant_count
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


grant select on public.v_savings_current_month to authenticated;
grant select on public.v_frequent_products     to authenticated;
grant select on public.v_household_stats       to authenticated;

notify pgrst, 'reload schema';

commit;
