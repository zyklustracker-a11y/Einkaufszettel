-- ============================================================================
-- Receipt AI — Schritt 17: Sparpotenzial in Geld, Pfand raus aus den Produkten
--
-- Ausführen im SQL-Editor, nach 0013. Läuft in einer Transaktion und ist
-- mehrfach ausführbar.
--
-- ---------------------------------------------------------------------------
-- 1. DAS SPARPOTENZIAL WAR KEIN GELDBETRAG
-- ---------------------------------------------------------------------------
--
-- `v_savings_current_month` summierte Differenzen von **Einzelpreisen** und die
-- App schrieb darüber „1,56 € Mehrkosten". Sobald eine Menge ungleich 1 im Spiel
-- ist, stimmt das nicht: Wer zwei Flaschen Milch kauft, zahlt zweimal die
-- Differenz. Nachgerechnet am Prüfbestand:
--
--     H-Milch (immer 2 Stück)   Sicht 36 ct   tatsächlich 72 ct
--     Bananen (1,1 kg / 1,0 kg) Sicht 50 ct   tatsächlich 54 ct
--     Summe                     Sicht 1,56 €  tatsächlich 1,96 €
--
-- Die Zahl war also **systematisch zu niedrig**, und zwar am stärksten dort, wo
-- sich das Umsteigen am meisten lohnt: bei großen Mengen.
--
-- Gerechnet wird ab jetzt so, wie man es von Hand täte:
--
--     Mehrkosten der Zeile = tatsächlich gezahlt − (Bestpreis × dieselbe Menge)
--
-- Nicht `(Preis − Bestpreis) × Menge`: Der gezahlte Zeilenbetrag steht als
-- Tatsache auf dem Bon, während sich `Preis × Menge` wegen der Rundung auf ganze
-- Cent um ein, zwei Cent davon unterscheiden kann. Von einer Tatsache
-- auszugehen ist der ehrlichere Weg — und die 20-Cent-Schwelle bekommt damit
-- endlich die Bedeutung, die sie behauptet.
--
-- Der Vergleich selbst bleibt ein Vergleich von **Einzelpreisen** („1,79 €/kg
-- statt 2,19 €/kg"). Nur die Summe darunter ist jetzt Geld.
--
-- ---------------------------------------------------------------------------
-- 2. PFAND UND RABATT SIND KEINE PRODUKTE
-- ---------------------------------------------------------------------------
--
-- `v_frequent_products` gruppiert über den Produktnamen und nimmt bewusst auch
-- Zeilen ohne kanonisches Produkt mit — sonst fehlten Positionen, die noch
-- keiner Zuordnung haben. Pfand- und Rabattzeilen haben planmäßig auch keine.
-- Ergebnis am Prüfbestand: Schon drei Pfandzeilen setzen „Pfand" auf Rang 5 der
-- häufigsten Käufe. Im Alltag, mit Pfand auf fast jedem Bon, stünde es dauerhaft
-- auf Rang 1 — in genau der Liste, die laut PROJEKT.md „die Vorstufe zum
-- Einkaufszettel" ist.
--
-- Erkannt werden sie an `deposit_cents` bzw. `discount_cents`: `save_receipt`
-- füllt die beiden Felder ausschließlich für `art = 'pfand'` und `art = 'rabatt'`.
-- Das ist der genauere Filter als „hat kein Produkt" — der würde auch die
-- Artikel treffen, denen nur noch die Zuordnung fehlt.
--
-- ---------------------------------------------------------------------------
-- 3. „TOP 10 TEUERSTE PRODUKTE" ENTFÄLLT
-- ---------------------------------------------------------------------------
--
-- Die Liste stand direkt über „Häufigste Käufe" und beantwortete die schwächere
-- Frage: Dass die Tankfüllung teuer war, weiß man. Dazu kam, dass Rabattzeilen
-- mit **negativem** Betrag darin auftauchten — in einer Liste namens „teuerste
-- Produkte". Sie ist aus der Oberfläche entfernt; die Sicht wird hier
-- abgeräumt, damit keine tote Leitung stehen bleibt.
--
-- ---------------------------------------------------------------------------
-- 4. WIE VIELEN PRODUKTEN FEHLT DER ZWEITE LADEN?
-- ---------------------------------------------------------------------------
--
-- Der Leerzustand des Sparpotenzials erklärte bisher nur die Regel. Mit dieser
-- Zahl kann er sagen, wie weit es noch ist: „Vier Produkte hast du mehrfach
-- gekauft, aber nur in einem Laden." Dieselbe Sechs-Monats-Grenze wie beim
-- Sparpotenzial, damit nicht zwei Fenster nebeneinander gelten.
-- ============================================================================

begin;

/* ------------------------------------------------- v_items: zwei Spalten mehr */

-- Neue Spalten kommen ans Ende; `create or replace view` verlangt das.
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
  i.quantity_unit,
  coalesce(mc.kind, 'retail')                as merchant_kind,
  coalesce(mc.kind, 'retail') = 'gastro'     as is_gastro,
  i.deposit_cents,
  i.discount_cents,
  -- Pfand- und Rabattzeilen sind Positionen des Bons, aber keine Produkte.
  (i.deposit_cents > 0 or i.discount_cents > 0) as is_adjustment
from public.receipt_items i
join public.receipts r
  on r.id = i.receipt_id and r.household_id = i.household_id
left join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
left join public.categories c
  on c.household_id = i.household_id and c.key = cp.category_key
left join public.merchants mc
  on mc.id = r.merchant_id and mc.household_id = r.household_id
where r.status = 'confirmed';


/* --------------------------------- v_price_observations: Menge und Zeilenbetrag */

-- `quantity_factor` ist die Menge in **Anzeige**-Einheiten: Bei `kg`/`l` steht
-- die Basis in Gramm bzw. Millilitern und muss durch tausend, bei `g`/`ml`/`stk`
-- ist sie es schon. Ohne Einzelpreis ist der Faktor 1 — dann *ist* `price_cents`
-- der Zeilenbetrag und darf nicht noch einmal mit einer Menge multipliziert
-- werden.
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
  end                                           as base_unit,
  i.total_cents                                 as line_total_cents,
  case
    when i.unit_price_cents is null      then 1::numeric
    when i.quantity_base is null         then 1::numeric
    when i.quantity_unit in ('kg', 'l')  then i.quantity_base / 1000.0
    else i.quantity_base::numeric
  end                                           as quantity_factor
from public.v_items i
join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
join public.merchants m
  on m.id = i.merchant_id and m.household_id = i.household_id
where i.canonical_product_id is not null
  and coalesce(i.unit_price_cents, i.total_cents) > 0
  and not i.is_gastro
  and not i.is_adjustment;


/* ------------------------------------------------------- Sparpotenzial in Geld */

drop view if exists public.v_savings_current_month;

create view public.v_savings_current_month
with (security_invoker = true) as
with recent as (
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
    r.household_id, r.product_id, r.merchant_id, r.merchant_name, r.purchased_on,
    r.price_cents, r.base_unit
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
    b.price_cents as best_price_cents,
    -- Was diese eine Zeile zu viel gekostet hat: gezahlt minus das, was
    -- dieselbe Menge zum Bestpreis gekostet hätte.
    greatest(0, r.line_total_cents - round(b.price_cents * r.quantity_factor))::bigint
      as excess_cents
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
    count(*)::int              as overpaid_count,
    sum(excess_cents)::bigint  as excess_cents
  from overpaid
  group by household_id, product_id, product_name
  having sum(excess_cents) >= 20
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
  t.excess_cents,
  -- Damit die App „1,79 €/kg statt 2,19 €/kg" schreiben kann statt „1,79 €".
  b.base_unit
from totals t
join best  b on b.household_id = t.household_id and b.product_id = t.product_id
join worst w on w.household_id = t.household_id and w.product_id = t.product_id;


/* ------------------------------------- Häufigste Käufe ohne Pfand und Rabatt */

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
    and not i.is_adjustment
  group by i.household_id, i.product_name
  having count(*) >= 2
) t;


/* ------------------------------------------ Wie vielen fehlt der zweite Laden */

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
  (coalesce(r.receipt_count, 0) >= 4 and coalesce(r.day_span, 0) >= 14) as suggestions_ready,
  coalesce(s.single_merchant_products, 0)   as single_merchant_products
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
) p on true
-- Mehrfach gekauft, aber immer im selben Laden: Genau diesen Produkten fehlt
-- für einen Preisvergleich nur noch der zweite Händler.
left join lateral (
  select count(*)::int as single_merchant_products
  from (
    select o.product_id
    from public.v_price_observations o
    where o.household_id = h.id
      and o.purchased_on >= current_date - 180
    group by o.product_id
    having count(*) >= 2 and count(distinct o.merchant_id) = 1
  ) g
) s on true;


/* ------------------------------------------------ Top-10 teuerste: entfällt */

drop view if exists public.v_top_products;

grant select on public.v_savings_current_month to authenticated;
grant select on public.v_frequent_products     to authenticated;
grant select on public.v_household_stats       to authenticated;

notify pgrst, 'reload schema';

commit;
