-- ============================================================================
-- Receipt AI — Auswertungs-Sichten (Views)
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001_initial.sql gelaufen ist.
-- Die Datei ist in einem Rutsch lauffähig und läuft in einer Transaktion:
-- Geht irgendetwas schief, wird nichts angelegt.
--
-- Warum das hier und nicht im Browser gerechnet wird (PROJEKT.md):
-- Monatsübersicht, Kategoriensummen, Ausgabenverlauf, Top-Produkte,
-- Merkmals-Ausgaben und Bestpreise sind reine Additionen und Vergleiche. Die
-- gehören in die Datenbank. Der Browser bekommt fertige Zahlen und formatiert
-- sie nur noch.
--
-- Was ausdrücklich NICHT hier steht: der Health-Score. Seine Gruppenregel
-- ("pro Gruppe zählt nur das Merkmal mit dem größten Betrag") lebt in
-- src/lib/score.ts und ist dort mit 28 Tests festgenagelt. Ein zweites Mal in
-- SQL wäre eine zweite Wahrheit, die irgendwann auseinanderläuft. Die Datenbank
-- liefert stattdessen mit `v_score_items` die Zutaten — Positionsbetrag und
-- Merkmalsschlüssel je Position — und die Formel bleibt an einer Stelle.
--
-- Drei Leitplanken, die überall gelten:
--
--   * Haushaltstrennung. Jede View trägt `security_invoker = true`. Ohne das
--     liefe eine View mit den Rechten ihres Eigentümers und umginge damit die
--     Zeilensicherheit (RLS) der Tabellen darunter — jeder sähe alles. Mit dem
--     Schalter greifen die Regeln aus 0001 unverändert, und jede View gibt nur
--     Zeilen des eigenen Haushalts heraus. Zusätzlich trägt jede View
--     household_id, damit man beim Lesen zusätzlich filtern kann.
--     (Setzt PostgreSQL 15 oder neuer voraus; Supabase-Projekte erfüllen das.)
--
--   * Geld bleibt eine ganze Zahl in Cent. Wo eine Division nötig ist
--     (Hochrechnung, Basispreis), wird sofort auf ganze Cent gerundet.
--
--   * Nur bestätigte Bons zählen. Ein Bon in `uploaded` oder `extracted` steckt
--     noch im Scan-Ablauf und darf keine Auswertung verändern.
-- ============================================================================

begin;

-- ============================================================================
-- Grundlage: eine Zeile je Bon-Position, angereichert um alles, was die
-- Auswertungen brauchen. Jede weitere View setzt hierauf auf.
--
-- Kategorie und Merkmale hängen laut PROJEKT.md am kanonischen Produkt, nicht
-- an der Position. Eine Position ohne Produktzuordnung (kommt zwischen Scan und
-- Korrektur vor) hat deshalb keine Kategorie. Sie zählt in die Gesamtsumme, aber
-- nicht in die Kategorienaufteilung, und gilt bis zur Zuordnung als Lebensmittel
-- — das ist in einem Lebensmittel-Tracker die wahrscheinlichere Annahme.
-- ============================================================================

create or replace view public.v_items
with (security_invoker = true) as
select
  i.household_id,
  i.id                                       as item_id,
  i.receipt_id,
  r.purchased_on,
  date_trunc('month', r.purchased_on)::date  as month,
  r.merchant_id,
  i.canonical_product_id,
  coalesce(cp.name, i.name)                  as product_name,
  cp.category_key,
  coalesce(c.is_food, true)                  as is_food,
  i.total_cents,
  i.unit_price_cents,
  i.quantity_base,
  i.quantity_unit
from public.receipt_items i
join public.receipts r
  on r.id = i.receipt_id and r.household_id = i.household_id
left join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
left join public.categories c
  on c.household_id = i.household_id and c.key = cp.category_key
where r.status = 'confirmed';


-- ============================================================================
-- Welche Merkmale gelten für eine Position?
--
-- Drei Quellen, per UNION zusammengeführt (UNION entfernt Dubletten, damit ein
-- doppelt vergebenes Merkmal nicht doppelt zählt):
--
--   1. die am Produkt hängenden Merkmale aus canonical_product_traits
--   2. der Erhitzungsgrad aus canonical_products.milk_heat — die Werte sind
--      absichtlich dieselben Schlüssel wie die Merkmale (roh, pasteurisiert,
--      esl, uht). 'unbekannt' erzeugt kein Merkmal und zählt damit neutral.
--   3. milk_homogenized = 'ja' erzeugt das Merkmal 'homogenisiert'
--
-- Ergebnis sind Merkmals*schlüssel*, keine ids: der Schlüssel ist das Stabile,
-- und die abgeleiteten Milch-Merkmale kennen nur ihn.
-- ============================================================================

create or replace view public.v_item_trait_keys
with (security_invoker = true) as
  select i.household_id, i.item_id, t.key as trait_key
  from public.v_items i
  join public.canonical_product_traits cpt
    on cpt.canonical_product_id = i.canonical_product_id
   and cpt.household_id = i.household_id
  join public.traits t
    on t.id = cpt.trait_id and t.household_id = i.household_id
union
  select i.household_id, i.item_id, cp.milk_heat
  from public.v_items i
  join public.canonical_products cp
    on cp.id = i.canonical_product_id and cp.household_id = i.household_id
  where cp.milk_heat <> 'unbekannt'
union
  select i.household_id, i.item_id, 'homogenisiert'
  from public.v_items i
  join public.canonical_products cp
    on cp.id = i.canonical_product_id and cp.household_id = i.household_id
  where cp.milk_homogenized = 'ja';


-- ============================================================================
-- Monatsübersicht
-- ============================================================================

-- Alle Monate, in denen etwas gekauft wurde.
create or replace view public.v_month_summary
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  coalesce(sum(i.total_cents) filter (where i.is_food), 0)::bigint     as food_cents,
  coalesce(sum(i.total_cents) filter (where not i.is_food), 0)::bigint as nonfood_cents,
  coalesce(sum(i.total_cents), 0)::bigint                              as total_cents,
  count(distinct i.receipt_id)::int                                    as receipt_count
from public.v_items i
group by i.household_id, i.month;

-- Der laufende Monat, eine Zeile je Haushalt.
--
-- Wichtig: die View geht von `households` aus und nicht von den Positionen.
-- Dadurch gibt es die Zeile auch dann, wenn noch kein einziger Bon existiert —
-- dann eben mit lauter Nullen. Die App muss den Fall "gar keine Zeile" also nie
-- von "alles null" unterscheiden.
--
-- forecast_cents ist der Dreisatz aus PROJEKT.md: bisherige Ausgaben, hochgerechnet
-- auf die vollen Tage des Monats. Der Nenner ist der heutige Tag im Monat und
-- damit nie null.
--
-- budget_cents ist das zuletzt gesetzte Budget für diesen oder einen früheren
-- Monat. So gilt ein einmal eingestelltes Budget weiter, ohne dass man es jeden
-- Monat neu eintragen muss. Ist noch nie eines gesetzt worden, steht hier 0 —
-- die App zeigt dann einen Hinweis statt eines Balkens.
create or replace view public.v_current_month_summary
with (security_invoker = true) as
select
  h.id                                                    as household_id,
  date_trunc('month', current_date)::date                 as month,
  current_date                                            as as_of,
  coalesce(m.food_cents, 0)                               as food_cents,
  coalesce(m.nonfood_cents, 0)                            as nonfood_cents,
  coalesce(m.total_cents, 0)                              as total_cents,
  coalesce(m.receipt_count, 0)                            as receipt_count,
  coalesce(b.amount_cents, 0)                             as budget_cents,
  round(
    coalesce(m.total_cents, 0)::numeric
    * extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))
    / extract(day from current_date)
  )::bigint                                               as forecast_cents,
  coalesce(p.amount_cents, 0)                             as previous_month_to_date_cents
from public.households h
left join public.v_month_summary m
  on m.household_id = h.id
 and m.month = date_trunc('month', current_date)::date
-- Zuletzt gesetztes Budget.
left join lateral (
  select bu.amount_cents::bigint as amount_cents
  from public.budgets bu
  where bu.household_id = h.id
    and bu.month <= date_trunc('month', current_date)::date
  order by bu.month desc
  limit 1
) b on true
-- Derselbe Zeitraum einen Monat früher: vom Monatsersten bis zum gleichen
-- Kalendertag. Die obere Grenze ist zusätzlich auf den Monatswechsel gedeckelt,
-- damit am 31. eines Monats nicht Tage des laufenden Monats mitgezählt werden,
-- wenn der Vormonat kürzer war.
left join lateral (
  select coalesce(sum(vi.total_cents), 0)::bigint as amount_cents
  from public.v_items vi
  where vi.household_id = h.id
    and vi.purchased_on >= (date_trunc('month', current_date) - interval '1 month')::date
    and vi.purchased_on <  least(
          (date_trunc('month', current_date) - interval '1 month')::date
            + make_interval(days => extract(day from current_date)::int),
          date_trunc('month', current_date)::date
        )
) p on true;


-- ============================================================================
-- Kategoriensummen — je Haushalt, Monat und Kategorie.
--
-- Positionen ohne Produktzuordnung haben keine Kategorie und fallen hier heraus;
-- in v_month_summary zählen sie weiter mit. Die Summe der Kategorien kann daher
-- kleiner sein als die Monatssumme. Das ist gewollt und sichtbar, statt einen
-- falschen Topf zu füllen.
-- ============================================================================

create or replace view public.v_category_totals
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  c.key                       as category_key,
  c.name,
  c.is_food,
  c.sort_order,
  sum(i.total_cents)::bigint  as amount_cents
from public.v_items i
join public.categories c
  on c.household_id = i.household_id and c.key = i.category_key
group by i.household_id, i.month, c.key, c.name, c.is_food, c.sort_order;


-- ============================================================================
-- Ausgabenverlauf — alle vier Zeiträume des Analysen-Screens in einer View.
--
-- Die Zeitfenster („die letzten sechs Monate", „diese Woche") entstehen hier per
-- generate_series und nicht in der App. Dadurch kommen auch leere Töpfe als
-- Zeile mit 0 zurück — sonst hätte das Balkendiagramm Lücken statt Nullbalken.
--
-- Zurückgegeben werden Anfang und Ende des Topfs sowie die Kalenderwoche. Die
-- Beschriftung („Mo", „KW32", „Aug", „1.–7.") macht die UI, weil Monats- und
-- Wochentagsnamen Anzeigetext sind und laut PROJEKT.md nicht in die Daten
-- gehören.
-- ============================================================================

create or replace view public.v_spending_trend
with (security_invoker = true) as
with buckets as (
  -- Woche: Montag bis Sonntag der laufenden Woche, ein Topf je Tag.
  select
    'week'::text                                     as range_id,
    g.i                                              as bucket_index,
    (date_trunc('week', current_date)::date + g.i)   as bucket_start,
    (date_trunc('week', current_date)::date + g.i)   as bucket_end
  from generate_series(0, 6) as g(i)

  union all

  -- Monat: die Kalenderwochen, die den laufenden Monat berühren, an den
  -- Monatsgrenzen abgeschnitten. Je nach Monat sind das vier bis sechs Töpfe.
  select
    'month',
    g.i,
    greatest(
      date_trunc('week', date_trunc('month', current_date))::date + g.i * 7,
      date_trunc('month', current_date)::date
    ),
    least(
      date_trunc('week', date_trunc('month', current_date))::date + g.i * 7 + 6,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date
    )
  from generate_series(0, 5) as g(i)
  where date_trunc('week', date_trunc('month', current_date))::date + g.i * 7
        <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date

  union all

  -- Jahr: die letzten sechs Monate, der laufende zuletzt.
  select
    'year',
    g.i,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i))::date,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i)
      + interval '1 month - 1 day')::date
  from generate_series(0, 5) as g(i)

  union all

  -- Eigen: die letzten vierzehn Tage, in zwei Wochen geteilt.
  select
    'custom',
    g.i,
    current_date - 13 + g.i * 7,
    current_date - 13 + g.i * 7 + 6
  from generate_series(0, 1) as g(i)
)
select
  h.id                                    as household_id,
  b.range_id,
  b.bucket_index,
  b.bucket_start,
  b.bucket_end,
  extract(week from b.bucket_start)::int  as iso_week,
  coalesce(s.amount_cents, 0)::bigint     as amount_cents
from public.households h
cross join buckets b
left join lateral (
  select sum(i.total_cents) as amount_cents
  from public.v_items i
  where i.household_id = h.id
    and i.purchased_on between b.bucket_start and b.bucket_end
) s on true;


-- ============================================================================
-- Top-Produkte je Monat, nach Ausgaben absteigend.
--
-- Gruppiert wird über den Produktnamen: solange eine Position noch keinem
-- kanonischen Produkt zugeordnet ist, steht dort der Name vom Bon.
-- ============================================================================

create or replace view public.v_top_products
with (security_invoker = true) as
select
  t.household_id,
  t.month,
  t.name,
  t.purchase_count,
  t.amount_cents,
  row_number() over (
    partition by t.household_id, t.month
    order by t.amount_cents desc, t.name
  )::int as rank
from (
  select
    i.household_id,
    i.month,
    i.product_name             as name,
    count(*)::int              as purchase_count,
    sum(i.total_cents)::bigint as amount_cents
  from public.v_items i
  group by i.household_id, i.month, i.product_name
) t;


-- ============================================================================
-- Gesundheitsauswertung
-- ============================================================================

-- Ausgaben je Merkmal, je Monat. Nur Lebensmittel — ein Spülmittel sagt nichts
-- darüber aus, wie sich der Haushalt ernährt.
--
-- Hier gilt die Gruppenregel bewusst NICHT: „Wie viel gebe ich für Gluten aus"
-- muss auch dann zählen, wenn im Score `weizen` das `gluten` verdrängt hat
-- (PROJEKT.md). Deshalb zählt jedes zutreffende Merkmal mit dem vollen
-- Positionsbetrag.
create or replace view public.v_trait_spending
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  t.id      as trait_id,
  t.key,
  t.label,
  t.short,
  t.description,
  t.weight,
  t.trait_group,
  t.tip,
  t.active,
  t.is_default,
  t.sort_order,
  sum(i.total_cents)::bigint as amount_cents,
  count(*)::int              as item_count
from public.v_items i
join public.v_item_trait_keys k
  on k.household_id = i.household_id and k.item_id = i.item_id
join public.traits t
  on t.household_id = i.household_id and t.key = k.trait_key
where i.is_food
  and t.active
group by i.household_id, i.month, t.id, t.key, t.label, t.short, t.description,
         t.weight, t.trait_group, t.tip, t.active, t.is_default, t.sort_order;

-- Unverarbeitet gegen verarbeitet, in Euro und je Monat.
--
-- „Verarbeitet" heißt hier: die Position trägt das Merkmal `verarbeitet`. Damit
-- folgt die Aufteilung derselben Konfiguration wie alles andere — schaltet der
-- Nutzer das Merkmal um oder vergibt es anders, wandert die Grenze mit.
create or replace view public.v_health_split
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  coalesce(sum(i.total_cents) filter (where not p.processed), 0)::bigint as unprocessed_cents,
  coalesce(sum(i.total_cents) filter (where p.processed), 0)::bigint     as processed_cents
from public.v_items i
cross join lateral (
  select exists (
    select 1
    from public.v_item_trait_keys k
    where k.household_id = i.household_id
      and k.item_id = i.item_id
      and k.trait_key = 'verarbeitet'
  ) as processed
) p
where i.is_food
group by i.household_id, i.month;

-- Die Zutaten für den Health-Score: je Lebensmittel-Position der Betrag und die
-- Merkmalsschlüssel. Die Formel samt Gruppenregel läuft in src/lib/score.ts —
-- siehe die Begründung im Kopf dieser Datei.
create or replace view public.v_score_items
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  i.item_id,
  i.total_cents,
  coalesce(
    array_agg(k.trait_key) filter (where k.trait_key is not null),
    '{}'::text[]
  ) as trait_keys
from public.v_items i
left join public.v_item_trait_keys k
  on k.household_id = i.household_id and k.item_id = i.item_id
where i.is_food
group by i.household_id, i.month, i.item_id, i.total_cents;


-- ============================================================================
-- Bestpreise
-- ============================================================================

-- Eine beobachtete Preisangabe je Bon-Position.
--
-- Der Preis ist `unit_price_cents` — der Preis für eine Anzeigeeinheit, also pro
-- Stück oder pro Kilo. Fehlt er, gilt die Zeilensumme. Ohne Händler ist ein
-- Preisvergleich sinnlos, deshalb fallen Positionen ohne Händler heraus.
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
  coalesce(i.unit_price_cents, i.total_cents)   as price_cents
from public.v_items i
join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
join public.merchants m
  on m.id = i.merchant_id and m.household_id = i.household_id
where i.canonical_product_id is not null
  and coalesce(i.unit_price_cents, i.total_cents) > 0;

-- Kennzahlen je Produkt.
--
-- base_price_cents ist der Grundpreis aus dem Bestpreis, also €/kg, €/l oder
-- €/Stück. Die Packungsgröße liegt als ganze Zahl in der Basiseinheit vor
-- (Gramm, Milliliter, Stück); der Faktor rechnet sie auf die Anzeigeeinheit
-- hoch. Ohne Packungsgröße bleibt der Grundpreis null — „ohne Mengenangabe" ist
-- ein echter Zustand und kein Fehler.
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
    when o.size_base is null then null
    else round(
      min(o.price_cents)::numeric
      * (case o.size_unit when 'kg' then 1000 when 'l' then 1000 else 1 end)
      / o.size_base
    )::bigint
  end                                 as base_price_cents,
  o.size_unit                         as base_unit
from public.v_price_observations o
group by o.household_id, o.product_id, o.product_name, o.category_key,
         o.size_base, o.size_unit;

-- Der günstigste je gesehene Preis je Produkt. Bei Gleichstand gewinnt die
-- jüngere Beobachtung, damit die Altersangabe („vor 33 Tagen") zum tatsächlich
-- gültigen Bestpreis passt.
create or replace view public.v_product_best_price
with (security_invoker = true) as
select distinct on (o.household_id, o.product_id)
  o.household_id,
  o.product_id,
  o.merchant_id,
  o.merchant_name,
  o.purchased_on,
  o.price_cents
from public.v_price_observations o
order by o.household_id, o.product_id, o.price_cents asc, o.purchased_on desc;

-- Der jüngste Preis je Produkt und Händler — die Vergleichszeilen unter dem
-- Bestpreis.
create or replace view public.v_product_merchant_latest
with (security_invoker = true) as
select distinct on (o.household_id, o.product_id, o.merchant_id)
  o.household_id,
  o.product_id,
  o.merchant_id,
  o.merchant_name,
  o.purchased_on,
  o.price_cents
from public.v_price_observations o
order by o.household_id, o.product_id, o.merchant_id, o.purchased_on desc, o.price_cents asc;

-- Sparpotenzial im laufenden Monat: jeder Kauf dieses Monats, der teurer war als
-- der je gesehene Bestpreis desselben Produkts. Produkte, die nur zum Bestpreis
-- gekauft wurden, fallen heraus.
create or replace view public.v_savings_current_month
with (security_invoker = true) as
with best as (
  select * from public.v_product_best_price
),
overpaid as (
  select
    o.household_id,
    o.product_id,
    o.product_name,
    o.merchant_id,
    o.merchant_name,
    o.purchased_on,
    o.price_cents,
    b.price_cents as best_price_cents
  from public.v_price_observations o
  join best b
    on b.household_id = o.household_id and b.product_id = o.product_id
  where o.purchased_on >= date_trunc('month', current_date)::date
    and o.purchased_on <= current_date
    and o.price_cents > b.price_cents
),
totals as (
  select
    household_id,
    product_id,
    product_name,
    count(*)::int                                    as overpaid_count,
    sum(price_cents - best_price_cents)::bigint      as excess_cents
  from overpaid
  group by household_id, product_id, product_name
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
-- Rechte
--
-- Lesen genügt: in eine View schreibt die App nie. Welche *Zeilen* sichtbar
-- sind, entscheidet weiterhin allein die Zeilensicherheit der Tabellen darunter
-- — dafür sorgt security_invoker.
-- ============================================================================

grant select on
  public.v_items,
  public.v_item_trait_keys,
  public.v_month_summary,
  public.v_current_month_summary,
  public.v_category_totals,
  public.v_spending_trend,
  public.v_top_products,
  public.v_trait_spending,
  public.v_health_split,
  public.v_score_items,
  public.v_price_observations,
  public.v_product_prices,
  public.v_product_best_price,
  public.v_product_merchant_latest,
  public.v_savings_current_month
to authenticated;

commit;
