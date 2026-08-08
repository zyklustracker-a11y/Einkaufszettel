-- ============================================================================
-- Receipt AI — Grundschema
--
-- Ausführen im Supabase SQL-Editor. Die Datei ist in einem Rutsch lauffähig und
-- läuft in einer Transaktion: Geht irgendetwas schief, wird nichts angelegt.
--
-- Leitplanken aus PROJEKT.md, die hier umgesetzt sind:
--
--   * Haushalt statt Einzelnutzer. Jede inhaltliche Tabelle trägt household_id,
--     und die Zugriffsregeln laufen über die Mitgliedertabelle, nie direkt über
--     auth.uid().
--   * Geld immer als integer in Cent. Kein numeric, kein float, nirgends.
--   * Mengen als ganzzahlige Basiseinheit: Gramm, Milliliter, Stück. Ein
--     separates Feld hält die Einheit für die Anzeige. Damit gibt es die
--     Fließkomma-Unschärfe von 1,005 kg gar nicht erst.
--   * Kategorie, Merkmale und Milch-Eigenschaften hängen am kanonischen
--     Produkt, nicht an der einzelnen Bon-Position. Einmal gesetzt, gilt es
--     rückwirkend für alle Käufe.
--   * Merkmale sind Daten: eine Tabelle, kein Enum, kein Union-Typ.
--   * Datum als date, Anzeige-Formatierung macht die App.
--
-- Zusätzlich zur Zeilensicherheit (RLS) hängen die Beziehungen an
-- zusammengesetzten Fremdschlüsseln über (household_id, id). Dadurch kann eine
-- Bon-Position gar nicht erst auf ein Produkt eines fremden Haushalts zeigen —
-- das verhindert die Datenbank selbst, unabhängig von den Zugriffsregeln.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- Hilfsmittel

-- Hält updated_at aktuell, ohne dass die App daran denken muss.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ============================================================================
-- Haushalt und Mitglieder
-- ============================================================================

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Haushalt',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);


-- ============================================================================
-- Stammdaten je Haushalt
-- ============================================================================

-- Kategorien liegen bewusst pro Haushalt, obwohl die Neun laut PROJEKT.md fest
-- sind: So gilt dieselbe Zugriffsregel wie überall, und ein Haushalt könnte
-- später einen Anzeigenamen ändern, ohne dass es alle betrifft. Der Schlüssel
-- (`key`) bleibt stabil und ist das, worauf der Code sich bezieht.
create table public.categories (
  id           uuid not null default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  key          text not null,
  name         text not null,
  is_food      boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  primary key (id),
  unique (household_id, id),
  unique (household_id, key)
);

create index categories_household_id_idx on public.categories (household_id);

-- Merkmale: Daten, kein Enum. `weight` steuert den Score, `trait_group` fasst
-- überlappende Merkmale zusammen (im Score zählt pro Gruppe nur eines).
--
-- Die Spalte heißt trait_group und nicht group, weil GROUP in SQL reserviert
-- ist und sonst in jeder Abfrage in Anführungszeichen stehen müsste.
create table public.traits (
  id           uuid not null default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  key          text not null,
  label        text not null,
  short        text not null check (char_length(short) between 1 and 2),
  description  text not null default '',
  weight       smallint not null default 0 check (weight between -10 and 10),
  trait_group  text,
  tip          text not null default '',
  active       boolean not null default true,
  is_default   boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id),
  unique (household_id, id),
  unique (household_id, key)
);

create index traits_household_id_idx on public.traits (household_id);
create index traits_group_idx on public.traits (household_id, trait_group) where trait_group is not null;

create trigger traits_set_updated_at
  before update on public.traits
  for each row execute function public.set_updated_at();

create table public.merchants (
  id           uuid not null default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) > 0),
  created_at   timestamptz not null default now(),
  primary key (id),
  unique (household_id, id)
);

create index merchants_household_id_idx on public.merchants (household_id);
-- Ein Händlername je Haushalt, Groß-/Kleinschreibung egal ("Rewe" = "REWE").
create unique index merchants_household_name_key on public.merchants (household_id, lower(btrim(name)));


-- ============================================================================
-- Kanonische Produkte — das Gedächtnis des Systems
--
-- PROJEKT.md: Das Modell erkennt einen unbekannten Rohtext genau einmal; ab
-- dann kommt die Zuordnung aus dieser Tabelle. Kategorie, Merkmale und
-- Milch-Eigenschaften hängen hier und nicht an der Bon-Position, damit eine
-- Korrektur rückwirkend für alle Käufe gilt.
-- ============================================================================

create table public.canonical_products (
  id               uuid not null default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) > 0),
  category_key     text not null,

  -- Packungsgröße in der Basiseinheit (g / ml / Stück), plus die Einheit für
  -- die Anzeige. Null heißt "ohne Mengenangabe" — ein echter Zustand, kein
  -- Fehler, und der Grund, warum es hier keine Ersatzwerte gibt.
  size_base        integer check (size_base is null or size_base > 0),
  size_unit        text check (size_unit is null or size_unit in ('kg', 'g', 'l', 'ml', 'stk')),

  -- Milch-Eigenschaften. Zwei unabhängige Felder, weil eine Milch gleichzeitig
  -- pasteurisiert und homogenisiert sein kann. 'unbekannt' erzeugt kein Merkmal
  -- und zählt damit neutral — nie negativ. Das Modell darf hier nicht raten.
  milk_heat        text not null default 'unbekannt'
                     check (milk_heat in ('roh', 'pasteurisiert', 'esl', 'uht', 'unbekannt')),
  milk_homogenized text not null default 'unbekannt'
                     check (milk_homogenized in ('ja', 'nein', 'unbekannt')),
  milk_origin      text not null default 'unbekannt'
                     check (milk_origin in ('weide', 'bio', 'konventionell', 'unbekannt')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (id),
  unique (household_id, id),
  -- Zusammengesetzter Fremdschlüssel: die Kategorie muss demselben Haushalt
  -- gehören. Gilt so für alle Beziehungen weiter unten.
  foreign key (household_id, category_key)
    references public.categories (household_id, key) on update cascade,
  constraint canonical_products_size_pair check (
    (size_base is null and size_unit is null) or (size_base is not null and size_unit is not null)
  )
);

create index canonical_products_household_id_idx on public.canonical_products (household_id);
create index canonical_products_category_idx on public.canonical_products (household_id, category_key);
create unique index canonical_products_household_name_key
  on public.canonical_products (household_id, lower(btrim(name)));

-- n:m zwischen Produkt und Merkmal. Alle zutreffenden Merkmale hängen am
-- Produkt — die Gruppenregel greift erst bei der Score-Berechnung, damit
-- "wie viel gebe ich für Gluten aus" weiterhin alles zählt.
create table public.canonical_product_traits (
  household_id         uuid not null references public.households (id) on delete cascade,
  canonical_product_id uuid not null,
  trait_id             uuid not null,
  created_at           timestamptz not null default now(),
  primary key (canonical_product_id, trait_id),
  foreign key (household_id, canonical_product_id)
    references public.canonical_products (household_id, id) on delete cascade,
  foreign key (household_id, trait_id)
    references public.traits (household_id, id) on delete cascade
);

create index canonical_product_traits_household_id_idx on public.canonical_product_traits (household_id);
create index canonical_product_traits_trait_idx on public.canonical_product_traits (trait_id);

-- Rohtext vom Bon -> kanonisches Produkt. Der Eintrag entsteht beim ersten
-- Auftreten und wird nie neu erfragt. Eine Nutzerkorrektur überschreibt die
-- Modell-Antwort und gilt ebenfalls dauerhaft.
create table public.product_mappings (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  raw_text             text not null check (char_length(btrim(raw_text)) > 0),
  canonical_product_id uuid not null,
  source               text not null default 'model' check (source in ('model', 'user')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (household_id, canonical_product_id)
    references public.canonical_products (household_id, id) on delete cascade
);

create index product_mappings_household_id_idx on public.product_mappings (household_id);
create index product_mappings_product_idx on public.product_mappings (canonical_product_id);
-- Ein Rohtext je Haushalt — genau das macht das Nachschlagen eindeutig.
create unique index product_mappings_household_raw_key
  on public.product_mappings (household_id, lower(btrim(raw_text)));

create trigger product_mappings_set_updated_at
  before update on public.product_mappings
  for each row execute function public.set_updated_at();


-- ============================================================================
-- Bons
-- ============================================================================

create table public.receipts (
  id                  uuid not null default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  merchant_id         uuid,
  purchased_on        date not null,

  -- Pfad im Storage-Bucket, nicht das Bild selbst. Null, wenn das Foto nach der
  -- Erkennung gelöscht wurde oder der Bon über "Text einfügen" kam.
  image_path          text,

  -- uploaded  = Bild liegt da, Erkennung läuft noch
  -- extracted = Modell hat gelesen, wartet auf den Korrektur-Screen
  -- confirmed = vom Nutzer bestätigt und gespeichert
  -- failed    = Erkennung fehlgeschlagen
  status              text not null default 'uploaded'
                        check (status in ('uploaded', 'extracted', 'confirmed', 'failed')),

  -- Die auf dem Papier gedruckte Summe.
  printed_total_cents integer not null default 0,
  -- Gedruckte Summe minus Positionssumme. Wird von einem Trigger gepflegt, ist
  -- also immer aktuell — der Korrektur-Screen zeigt daraus die Warnung.
  discrepancy_cents   integer not null default 0,

  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  primary key (id),
  unique (household_id, id),
  foreign key (household_id, merchant_id)
    references public.merchants (household_id, id) on delete set null
);

create index receipts_household_id_idx on public.receipts (household_id);
create index receipts_purchased_on_idx on public.receipts (household_id, purchased_on desc);
create index receipts_status_idx on public.receipts (household_id, status);

create table public.receipt_items (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  receipt_id           uuid not null,
  line_no              integer not null check (line_no > 0),

  -- So stand es auf dem Bon. Bleibt erhalten, auch wenn der Klarname später
  -- korrigiert wird — daraus entsteht der Eintrag in product_mappings.
  raw_text             text not null,
  -- Klarname zum Zeitpunkt des Scans, für die Anzeige.
  name                 text not null,
  -- Null, solange der Rohtext noch keinem Produkt zugeordnet ist.
  canonical_product_id uuid,

  -- Menge in der Basiseinheit (g / ml / Stück) plus Anzeige-Einheit.
  quantity_base        integer check (quantity_base is null or quantity_base > 0),
  quantity_unit        text check (quantity_unit is null or quantity_unit in ('kg', 'g', 'l', 'ml', 'stk')),
  -- Preis je Anzeige-Einheit: pro kg, pro l oder pro Stück.
  unit_price_cents     integer,

  -- Zeilensumme. Darf negativ sein: eine Rabattzeile ist eine echte Position.
  total_cents          integer not null,
  discount_cents       integer not null default 0 check (discount_cents >= 0),
  deposit_cents        integer not null default 0 check (deposit_cents >= 0),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (receipt_id, line_no),
  foreign key (household_id, receipt_id)
    references public.receipts (household_id, id) on delete cascade,
  -- Absichtlich restrict: Ein Produkt mit Kaufhistorie wird nicht gelöscht,
  -- sondern zusammengeführt. Sonst verlöre die Preishistorie ihren Anker.
  foreign key (household_id, canonical_product_id)
    references public.canonical_products (household_id, id) on delete restrict,
  constraint receipt_items_quantity_pair check (
    (quantity_base is null and quantity_unit is null)
    or (quantity_base is not null and quantity_unit is not null)
  )
);

create index receipt_items_household_id_idx on public.receipt_items (household_id);
create index receipt_items_receipt_idx on public.receipt_items (receipt_id);
create index receipt_items_product_idx on public.receipt_items (canonical_product_id);

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

create trigger receipt_items_set_updated_at
  before update on public.receipt_items
  for each row execute function public.set_updated_at();


-- ---------------------------------------------- Abweichung automatisch führen

-- Beim Anlegen eines Bons und bei jeder Änderung der gedruckten Summe.
create or replace function public.set_receipt_discrepancy()
returns trigger
language plpgsql
as $$
begin
  new.discrepancy_cents := new.printed_total_cents - coalesce(
    (select sum(i.total_cents) from public.receipt_items i where i.receipt_id = new.id), 0);
  return new;
end;
$$;

create trigger receipts_discrepancy
  before insert or update of printed_total_cents on public.receipts
  for each row execute function public.set_receipt_discrepancy();

-- Und bei jeder Änderung an den Positionen.
create or replace function public.refresh_receipt_discrepancy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt uuid := coalesce(new.receipt_id, old.receipt_id);
begin
  update public.receipts r
     set discrepancy_cents = r.printed_total_cents - coalesce(
           (select sum(i.total_cents) from public.receipt_items i where i.receipt_id = r.id), 0)
   where r.id = v_receipt;
  return null;
end;
$$;

-- Das UPDATE oben fasst printed_total_cents nicht an, deshalb löst es den
-- Trigger auf receipts nicht erneut aus — keine Schleife.
create trigger receipt_items_discrepancy
  after insert or update or delete on public.receipt_items
  for each row execute function public.refresh_receipt_discrepancy();


-- ============================================================================
-- Budget und Hinweise
-- ============================================================================

create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Immer der Monatserste, damit ein Monat genau eine Zeile hat.
  month        date not null check (extract(day from month) = 1),
  amount_cents integer not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, month)
);

create index budgets_household_id_idx on public.budgets (household_id);
create index budgets_month_idx on public.budgets (household_id, month desc);

create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

-- Vorgerechnete Hinweise: Sparpotenzial, Monatsreport, Budget-Warnung. Erzeugt
-- werden sie serverseitig aus SQL, nicht vom Modell.
create table public.insights (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind         text not null,
  period_start date not null,
  period_end   date not null,
  title        text not null,
  body         text,
  amount_cents integer,
  payload      jsonb not null default '{}'::jsonb,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);

create index insights_household_id_idx on public.insights (household_id);
create index insights_period_idx on public.insights (household_id, period_start desc);
create index insights_open_idx on public.insights (household_id, kind) where dismissed_at is null;


-- ============================================================================
-- Zugriffsregeln
--
-- Die Hilfsfunktion liefert die Haushalte des angemeldeten Nutzers. Sie läuft
-- als SECURITY DEFINER und umgeht damit die Zeilensicherheit auf
-- household_members. Das ist keine Bequemlichkeit, sondern notwendig: Ohne das
-- würde die Regel auf household_members sich selbst aufrufen und die Abfrage
-- liefe in eine Endlosschleife.
--
-- set search_path fixiert die Suchreihenfolge, damit die Funktion nicht über
-- eine untergeschobene gleichnamige Tabelle ausgehebelt werden kann.
-- ============================================================================

create or replace function public.current_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select hm.household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
$$;

revoke all on function public.current_household_ids() from public;
grant execute on function public.current_household_ids() to authenticated;

alter table public.households              enable row level security;
alter table public.household_members       enable row level security;
alter table public.categories              enable row level security;
alter table public.traits                  enable row level security;
alter table public.merchants               enable row level security;
alter table public.canonical_products      enable row level security;
alter table public.canonical_product_traits enable row level security;
alter table public.product_mappings        enable row level security;
alter table public.receipts                enable row level security;
alter table public.receipt_items           enable row level security;
alter table public.budgets                 enable row level security;
alter table public.insights                enable row level security;

-- households wird über die eigene id geprüft, alle übrigen über household_id.
-- Anlegen kann ein Client keinen Haushalt: Zum Zeitpunkt des INSERT ist er noch
-- kein Mitglied. Haushalte entstehen ausschließlich über den Trigger beim
-- ersten Login.
create policy households_own on public.households
  for all to authenticated
  using (id in (select public.current_household_ids()))
  with check (id in (select public.current_household_ids()));

-- Mitglieder des eigenen Haushalts sehen einander und dürfen weitere
-- hinzufügen — so kommt der Rest der Familie hinein.
create policy household_members_own on public.household_members
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy categories_own on public.categories
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy traits_own on public.traits
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy merchants_own on public.merchants
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy canonical_products_own on public.canonical_products
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy canonical_product_traits_own on public.canonical_product_traits
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy product_mappings_own on public.product_mappings
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy receipts_own on public.receipts
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy receipt_items_own on public.receipt_items
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy budgets_own on public.budgets
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));

create policy insights_own on public.insights
  for all to authenticated
  using (household_id in (select public.current_household_ids()))
  with check (household_id in (select public.current_household_ids()));


-- ============================================================================
-- Automatik beim ersten Login
--
-- Ein neuer Nutzer bekommt einen Haushalt, wird dessen Eigentümer und erhält
-- die neun Kategorien und dreizehn Standard-Merkmale. Die Merkmalswerte sind
-- eins zu eins die aus src/mocks/traits.ts — sie wurden aus der Datei erzeugt,
-- nicht abgetippt.
-- ============================================================================

create or replace function public.seed_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.categories (household_id, key, name, is_food, sort_order)
  values
    (p_household_id, 'produce', 'Obst & Gemüse', true, 1),
    (p_household_id, 'meat', 'Fleisch & Fisch', true, 2),
    (p_household_id, 'dairy', 'Milchprodukte', true, 3),
    (p_household_id, 'bakery', 'Backwaren', true, 4),
    (p_household_id, 'drinks', 'Getränke', true, 5),
    (p_household_id, 'sweets', 'Süßes & Snacks', true, 6),
    (p_household_id, 'readymeals', 'Fertiggerichte', true, 7),
    (p_household_id, 'staples', 'Grundnahrungsmittel', true, 8),
    (p_household_id, 'nonfood', 'Non-Food', false, 9)
  on conflict (household_id, key) do nothing;

  insert into public.traits
    (household_id, key, label, short, trait_group, weight, active, sort_order, description, tip, is_default)
  select p_household_id, v.key, v.label, v.short, v.trait_group, v.weight, v.active, v.sort_order,
         v.description, v.tip, true
  from (values
    ('verarbeitet', 'Hochverarbeitet', 'V', null, -3, true, 1,
     'Industriell stark verarbeitete Produkte mit langer Zutatenliste – Fertiggerichte, Tiefkühlware, Snacks.',
     'Statt Fertiggericht: einmal selbst kochen und portionsweise einfrieren.'),
    ('industriezucker', 'Industriezucker', 'Z', null, -3, true, 2,
     'Zugesetzter Zucker in jeder Form – Saccharose, Glukose- und Fruktosesirup, Maltodextrin.',
     'Statt gesüßtem Joghurt: Naturjoghurt mit frischem Obst.'),
    ('samenoel', 'Samenöl', 'Ö', 'fette', -3, true, 3,
     'Raffinierte Öle aus Samen und Kernen – Sonnenblumen-, Raps-, Soja-, Maiskeimöl.',
     'Statt Sonnenblumenöl: Butter, Ghee oder Olivenöl.'),
    ('pflanzenfett', 'Pflanzliches Fett', 'P', 'fette', -2, true, 4,
     'Sonstige raffinierte oder gehärtete Pflanzenfette, etwa Palmfett in Backwaren.',
     'Statt Gebäck mit Palmfett: Varianten mit Butter.'),
    ('gluten', 'Gluten', 'G', 'getreide', -2, true, 5,
     'Glutenhaltige Getreide – Weizen, Dinkel, Roggen, Gerste.',
     'Statt Weizentoast: Sauerteigbrot mit langer Führung oder Buchweizenbrot.'),
    ('weizen', 'Weizen', 'W', 'getreide', -3, true, 6,
     'Speziell Weizen, auch als Weizenmehl, Hartweizengrieß oder Weizenstärke.',
     'Statt Weizennudeln: Nudeln aus Buchweizen, Linsen oder Kichererbsen.'),
    ('milch', 'Milch', 'M', 'milch_basis', 0, true, 7,
     'Enthält Kuhmilch oder Milchbestandteile.',
     'Neutral – wird nur beobachtet, kein Handlungsbedarf.'),
    ('zusatzstoffe', 'Zusatzstoffe', 'E', null, -2, false, 8,
     'Deklarationspflichtige Zusatzstoffe – Farb- und Konservierungsstoffe, Geschmacksverstärker, Emulgatoren.',
     'Statt Produkten mit E-Nummern: Varianten mit kurzer Zutatenliste.'),
    ('roh', 'Rohmilch', 'R', 'milch_basis', 2, true, 9,
     'Nicht erhitzte Milch, direkt ab Hof.',
     'Rohmilch kühl halten und zügig verbrauchen.'),
    ('pasteurisiert', 'Pasteurisiert', 'Pa', 'milch_basis', 0, true, 10,
     'Kurz erhitzte Milch, der übliche Frischmilch-Standard.',
     'Neutral – der übliche Standard bei Frischmilch.'),
    ('esl', 'ESL-Milch', 'ES', 'milch_basis', -1, true, 11,
     'Länger haltbare Frischmilch, stärker erhitzt als pasteurisierte Milch.',
     'Statt ESL: klassische Frischmilch aus dem Kühlregal.'),
    ('uht', 'H-Milch', 'H', 'milch_basis', -2, true, 12,
     'Ultrahocherhitzte Milch, ungekühlt lange haltbar.',
     'Statt H-Milch: Frischmilch aus dem Kühlregal.'),
    ('homogenisiert', 'Homogenisiert', 'Ho', null, -1, true, 13,
     'Fettkügelchen mechanisch zerkleinert, damit sich der Rahm nicht absetzt.',
     'Statt homogenisierter Milch: nicht homogenisierte Milch mit Rahmschicht.')
  ) as v(key, label, short, trait_group, weight, active, sort_order, description, tip)
  on conflict (household_id, key) do nothing;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
begin
  -- Wer schon Mitglied ist (eingeladenes Familienmitglied), bekommt keinen
  -- zweiten Haushalt.
  if exists (select 1 from public.household_members where user_id = new.id) then
    return new;
  end if;

  insert into public.households (name) values ('Haushalt') returning id into v_household;
  insert into public.household_members (household_id, user_id, role) values (v_household, new.id, 'owner');
  perform public.seed_household(v_household);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- Rechte
--
-- Was ein angemeldeter Nutzer grundsätzlich darf. Welche *Zeilen* er sieht,
-- entscheiden allein die Regeln oben.
-- ============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
