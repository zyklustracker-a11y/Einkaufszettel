-- ============================================================================
-- Receipt AI — Schritt 20: Wo kaufe ich das alles?
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0016 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- WAS HIER ENTSTEHT
-- ---------------------------------------------------------------------------
--
--   1. `v_product_merchant_price` — der günstigste kürzlich bezahlte Betrag je
--      Produkt **und Laden**.
--   2. `v_product_cheapest_merchant` — daraus je Produkt der günstigste Laden.
--   3. `v_shopping_basket_merchants` — was der offene Einkaufszettel in jedem
--      einzelnen Laden kosten würde, verglichen mit dem theoretischen Optimum.
--   4. `v_shopping_list_items` bekommt zwei Spalten mehr: den Preis beim
--      günstigsten Laden und dessen Alter.
--
-- ---------------------------------------------------------------------------
-- WARUM EIN LADEN UND NICHT DER BESTPREIS JE POSITION
-- ---------------------------------------------------------------------------
--
-- Die Bestpreise beantworten „wo war dieses eine Produkt am günstigsten". Das
-- ist die richtige Frage vor dem Regal und die falsche vor der Haustür: Wer
-- ihr Position für Position folgt, fährt für zehn Einträge in vier Läden. Die
-- Zeit und der Sprit fressen die Differenz auf, und niemand macht es zweimal.
--
-- Deshalb rechnet diese Sicht den **ganzen Zettel je Laden** durch. Nicht „wo
-- ist die Butter am billigsten", sondern „wo wird dieser Einkauf insgesamt am
-- billigsten" — und daneben, was der Umweg über alle Läden brächte. Erst
-- dieser Vergleich macht die Entscheidung möglich: 2,20 € sparen, dafür drei
-- Läden mehr — das kann jeder für sich beantworten, aber nur, wenn beide
-- Zahlen dastehen.
--
-- ---------------------------------------------------------------------------
-- WELCHER PREIS GILT
-- ---------------------------------------------------------------------------
--
-- Derselbe wie beim erwarteten Preis des Einkaufszettels: der **günstigste
-- tatsächlich bezahlte Zeilenbetrag der letzten sechs Monate**, hier nur
-- zusätzlich nach Laden getrennt (PROJEKT.md, Schritt 9). Das hat zwei Gründe:
--
--   * Die Summen bleiben untereinander vergleichbar. Die Schätzung über dem
--     Zettel ist die Summe der günstigsten Beträge über alle Läden — also
--     genau das Optimum, das hier als Vergleichswert steht. Zwei verschiedene
--     Preisbegriffe ergäben zwei Summen, die sich widersprechen.
--   * Es ist ein Betrag, den es wirklich gab. Ein Einzelpreis mal einer
--     Medianmenge stand so nie auf einem Bon.
--
-- Die Sechs-Monats-Grenze ist dieselbe wie beim Sparpotenzial: Ein Preis von
-- vorletztem Jahr ist heute nicht erreichbar, und eine Empfehlung, die sich
-- darauf stützt, schickt in einen Laden, der längst teurer ist.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Der günstigste Preis je Produkt und Laden
--
-- `v_price_observations` hat die Vorarbeit schon geleistet: Gastronomie,
-- Pfand- und Rabattzeilen sind draußen, der Händler ist angehängt. Hier bleibt
-- das Zusammenfassen.
--
-- `last_seen_on` kommt mit, weil ein Preis ohne Datum keine Auskunft ist: „bei
-- ALDI SÜD 2,19 €" heißt etwas anderes, wenn es vom vorletzten Wochenende
-- stammt, als wenn es fünf Monate her ist.
-- ============================================================================

create or replace view public.v_product_merchant_price
with (security_invoker = true) as
select
  o.household_id,
  o.product_id,
  o.merchant_id,
  o.merchant_name,
  min(o.line_total_cents)::bigint as price_cents,
  max(o.purchased_on)             as last_seen_on,
  count(*)::int                   as observation_count
from public.v_price_observations o
where o.purchased_on >= current_date - 180
  and o.line_total_cents > 0
group by o.household_id, o.product_id, o.merchant_id, o.merchant_name;


-- ============================================================================
-- 2. Je Produkt der günstigste Laden
--
-- Bei Gleichstand gewinnt die jüngere Beobachtung — damit die Altersangabe zum
-- ausgewiesenen Preis passt. Dieselbe Regel wie in `v_product_best_price`.
-- ============================================================================

create or replace view public.v_product_cheapest_merchant
with (security_invoker = true) as
select distinct on (p.household_id, p.product_id)
  p.household_id,
  p.product_id,
  p.merchant_id,
  p.merchant_name,
  p.price_cents,
  p.last_seen_on
from public.v_product_merchant_price p
order by p.household_id, p.product_id, p.price_cents asc, p.last_seen_on desc;


-- ============================================================================
-- 3. Der offene Zettel, durchgerechnet je Laden
--
-- Eine Zeile je Laden, in dem mindestens eine Position des Zettels schon
-- einmal gekauft wurde. Vier Zahlen stehen darin:
--
--   * `covered_items` — wie viele Positionen dieser Laden führt (genauer: wie
--     viele dort schon einmal gekauft wurden). Das ist die Ehrlichkeitsspalte:
--     Ein Laden mit drei von zehn Positionen ist keine Empfehlung, auch wenn
--     seine Summe niedrig aussieht.
--   * `missing_items` — der Rest. Für ihn wird **der günstigste bekannte Preis
--     gerechnet**, nicht null und nicht der teuerste. Sonst gewönne jeder
--     Laden, der wenig führt, allein durch seine Lücken.
--   * `basket_total_cents` — was der Zettel dort insgesamt kostet.
--   * `optimum_total_cents` und `optimum_merchant_count` — was er kostete,
--     wenn man jede Position im jeweils günstigsten Laden kaufte, und auf wie
--     viele Läden sich das verteilte. Beides ist für alle Zeilen gleich; es
--     steht trotzdem an jeder, damit die Oberfläche keine zweite Abfrage
--     braucht.
--
-- Positionen ohne jeden bekannten Preis (ein eigener Eintrag wie „Blumen für
-- Oma") fallen ganz heraus — sie kosten überall dasselbe Unbekannte.
-- `priced_items` sagt, wie viele es in die Rechnung geschafft haben, damit die
-- Oberfläche „7 von 10 Positionen" schreiben kann statt so zu tun, als sei der
-- ganze Zettel gerechnet.
--
-- Abgehakte Einträge zählen nicht mehr mit: Was schon im Wagen liegt, ändert
-- die Frage nicht mehr, wohin man fahren sollte.
-- ============================================================================

create or replace view public.v_shopping_basket_merchants
with (security_invoker = true) as
with offen as (
  select distinct
    i.household_id,
    i.canonical_product_id as product_id
  from public.shopping_list_items i
  join public.shopping_lists l
    on l.id = i.list_id
  where l.completed_at is null
    and i.removed_at is null
    and i.checked_at is null
    and i.canonical_product_id is not null
),
preise as (
  select p.*
  from public.v_product_merchant_price p
  join offen o
    on o.household_id = p.household_id and o.product_id = p.product_id
),
guenstigster as (
  select distinct on (p.household_id, p.product_id)
    p.household_id,
    p.product_id,
    p.merchant_id,
    p.price_cents
  from preise p
  order by p.household_id, p.product_id, p.price_cents asc, p.last_seen_on desc
),
optimum as (
  select
    g.household_id,
    sum(g.price_cents)::bigint         as optimum_total_cents,
    count(distinct g.merchant_id)::int as optimum_merchant_count,
    count(*)::int                      as priced_items
  from guenstigster g
  group by g.household_id
),
laeden as (
  select distinct p.household_id, p.merchant_id, p.merchant_name
  from preise p
)
select
  l.household_id,
  l.merchant_id,
  l.merchant_name,
  count(*) filter (where p.price_cents is not null)::int  as covered_items,
  count(*) filter (where p.price_cents is null)::int      as missing_items,
  sum(coalesce(p.price_cents, g.price_cents))::bigint     as basket_total_cents,
  o.optimum_total_cents,
  o.optimum_merchant_count,
  o.priced_items
from laeden l
join guenstigster g
  on g.household_id = l.household_id
left join preise p
  on p.household_id = l.household_id
 and p.product_id   = g.product_id
 and p.merchant_id  = l.merchant_id
join optimum o
  on o.household_id = l.household_id
group by l.household_id, l.merchant_id, l.merchant_name,
         o.optimum_total_cents, o.optimum_merchant_count, o.priced_items;


-- ============================================================================
-- 4. Der Zettel selbst: Laden und Preis an jeder Position
--
-- Bis hierher stand am Eintrag nur die id des günstigsten Ladens — und die
-- Zeile im Browser schnitt sie hinter der Begründung ab. Die Auskunft war da
-- und trotzdem unsichtbar. Jetzt kommt der **Preis** dazu, damit „ALDI SÜD"
-- nicht als Behauptung dasteht, sondern mit der Zahl, auf die sie sich
-- stützt.
--
-- Zwei Dinge ändern sich am Bestehenden:
--
--   * `best_merchant_id` kommt jetzt aus `v_product_cheapest_merchant` statt
--     aus `v_product_best_price`. Der Unterschied: sechs Monate Fenster und
--     der bezahlte Zeilenbetrag statt des Einzelpreises — dieselbe Grundlage
--     wie die Ladenempfehlung darüber. Zwei Wege zu derselben Aussage wären
--     zwei Antworten auf dieselbe Frage.
--   * Zwei Spalten kommen ans Ende (`create or replace view` erlaubt nur
--     Anhängen, keine Umsortierung).
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
  b.merchant_id                      as best_merchant_id,
  b.price_cents                      as best_price_cents,
  b.last_seen_on                     as best_seen_on
from public.shopping_list_items i
join public.shopping_lists l
  on l.id = i.list_id
left join public.canonical_products cp
  on cp.id = i.canonical_product_id and cp.household_id = i.household_id
left join public.categories c
  on c.household_id = i.household_id and c.key = cp.category_key
left join public.v_product_rhythm r
  on r.household_id = i.household_id and r.product_id = i.canonical_product_id
left join public.v_product_cheapest_merchant b
  on b.household_id = i.household_id and b.product_id = i.canonical_product_id
where i.removed_at is null
  and l.completed_at is null;


grant select on public.v_product_merchant_price      to authenticated;
grant select on public.v_product_cheapest_merchant   to authenticated;
grant select on public.v_shopping_basket_merchants   to authenticated;
grant select on public.v_shopping_list_items         to authenticated;

comment on view public.v_shopping_basket_merchants is
  'Was der offene Einkaufszettel in jedem einzelnen Laden kostet — und was das Optimum über alle Läden kostete.';

notify pgrst, 'reload schema';

commit;
