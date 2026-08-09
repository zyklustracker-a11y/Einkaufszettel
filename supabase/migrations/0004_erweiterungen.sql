-- ============================================================================
-- Receipt AI — Schritt 5: Auswärts essen, eigene Kategorien, Fremdwährung
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001, 0002 und 0003 gelaufen sind.
-- Die Datei läuft in einer Transaktion: Geht irgendetwas schief, wird nichts
-- angelegt.
--
-- **Die Datei ist mehrfach ausführbar.** Jede Spalte kommt mit `if not exists`,
-- jede Einschränkung wird vorher weggeworfen, jede Funktion und jede Sicht
-- entsteht per `create or replace`. Ändert sich später etwas an dieser Migration,
-- wird sie schlicht erneut ausgeführt — genau wie 0003.
--
-- Warum alle drei Erweiterungen in EINER Migration stehen: Schemaänderungen sind
-- jetzt billig und werden mit jedem gespeicherten Bon teurer
-- (KONZEPT-ERWEITERUNGEN.md, Fahrplan).
--
-- ---------------------------------------------------------------------------
-- WAS HINZUKOMMT
-- ---------------------------------------------------------------------------
--
--   1. `categories` bekommt `description`, `active`, `color`, `is_default` und
--      `updated_at` — aus festen Stammdaten werden verwaltbare Daten.
--   2. `category_key()` leitet den stabilen Schlüssel aus dem Namen ab.
--   3. `merchants.kind` — `retail` oder `gastro`.
--   4. `receipts` bekommt `tip_cents` sowie `currency`, `original_total_cents`,
--      `exchange_rate` und `rate_date`.
--   5. `exchange_rates` — der Zwischenspeicher für EZB-Referenzkurse.
--   6. Das Merkmal `auswaerts` mit Gewicht 0.
--   7. Die Auswertungs-Sichten rechnen Gastronomie getrennt und schließen sie
--      aus den Bestpreisen aus.
--   8. `save_receipt()` kennt Händlerart, Trinkgeld, Fremdwährung — und kann
--      einen bestehenden Bon aktualisieren statt einen zweiten anzulegen.
--
-- ---------------------------------------------------------------------------
-- EINE ENTSCHEIDUNG, DIE ERKLÄRUNG BRAUCHT: „Auswärts" hängt am HÄNDLER
-- ---------------------------------------------------------------------------
--
-- Das Konzept nennt eine Kategorie `dining`. Der Schlüssel einer Kategorie wird
-- aber ab jetzt beim Anlegen aus dem Namen abgeleitet und ist Sache des Nutzers.
-- Ein fest verdrahtetes `dining` im Code oder in einer Sicht wäre damit genau
-- das, was PROJEKT.md an den Merkmalen abgeschafft hat: verstecktes Verhalten,
-- das an einem Anzeigetext hängt.
--
-- Deshalb entscheidet **`merchants.kind`** und nicht der Kategorieschlüssel,
-- was als „Auswärts" zählt. Das ist auch sachlich der bessere Anker:
--
--   * Ein Restaurantbesuch ist ein Beleg eines Gastro-Händlers — unabhängig
--     davon, wie der Nutzer die Speisen einsortiert.
--   * Der Ausschluss aus den Bestpreisen hängt ohnehin am Händler
--     („Pizza bei zwei Restaurants" ist Scheingenauigkeit).
--   * Die drei Teilbeträge der Kopfkarte ergeben zusammen exakt die
--     Gesamtsumme, ohne dass eine Position doppelt zählt.
--
-- Die Kategorie „Auswärts essen" behält ihre volle Aufgabe: Sie gibt den
-- Positionen eines Restaurantbelegs einen Platz im Kategorien-Ring mit eigener
-- Farbe. Nur *rechnet* niemand mit ihrem Schlüssel.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Kategorien werden zu verwaltbaren Daten
--
-- Bisher waren die neun Kategorien faktisch fest: anlegen ging nur über SQL,
-- die Farbe lag im Code, und eine Erklärung fürs Modell gab es nicht.
--
--   * `description` fließt in den Erkennungs-Prompt, genau wie bei den
--     Merkmalen. Ohne sie müsste das Modell aus dem Namen raten — bei „Gewürze"
--     geht das, bei „Vorratskammer" nicht.
--   * `active` statt Löschen: `canonical_products` verweist über einen
--     Fremdschlüssel auf die Kategorie. Ein DELETE würde bestehende Produkte
--     brechen; eine abgeschaltete Kategorie verschwindet aus Prompt und Auswahl,
--     bleibt für Altdaten aber gültig.
--   * `color` muss zur Kategorie gehören, sobald man eigene anlegen kann —
--     sonst bekäme eine selbst angelegte keine.
--   * `is_default` kennzeichnet die mitgelieferten neun. Änderbar sind sie
--     trotzdem, sie sind nur als solche erkennbar.
-- ============================================================================

alter table public.categories add column if not exists description text not null default '';
alter table public.categories add column if not exists active      boolean not null default true;
alter table public.categories add column if not exists color       text not null default '';
alter table public.categories add column if not exists is_default  boolean not null default false;
alter table public.categories add column if not exists updated_at  timestamptz not null default now();

-- Die Farbe ist ein Hex-Wert und keine CSS-Variable. Grund: Die Ramp-Token
-- (--cat-1 …) sind in beiden Themes identisch definiert, es ginge also nichts
-- verloren — eine Variable dagegen wäre ein Name, den die Datenbank nicht
-- prüfen kann und den ein Umbenennen im Stylesheet still zerbrechen würde.
-- Leer heißt „noch keine vergeben"; die App setzt dann eine freie aus der
-- Palette.
alter table public.categories drop constraint if exists categories_color_form;
alter table public.categories
  add constraint categories_color_form
  check (color = '' or color ~ '^#[0-9a-fA-F]{6}$');

-- Der Anzeigename darf sich ändern, leer sein darf er nie.
alter table public.categories drop constraint if exists categories_name_present;
alter table public.categories
  add constraint categories_name_present
  check (char_length(btrim(name)) > 0);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create index if not exists categories_active_idx
  on public.categories (household_id, sort_order) where active;


-- ============================================================================
-- 2. Der stabile Schlüssel aus dem Namen
--
-- Derselbe Grundsatz wie bei den Merkmalen: Anzeigetexte ändern sich,
-- Datenbankwerte nicht. Der Schlüssel entsteht **einmal** beim Anlegen und ist
-- danach unveränderlich — der Name bleibt frei änderbar.
--
-- Umlaute werden ausgeschrieben (ä → ae) und nicht plattgemacht (ä → a). Der
-- Schlüssel steht im Erkennungs-Prompt und wird dort gelesen: „auswaerts_essen"
-- ist als Wort erkennbar, „auswarts_essen" sieht nach Tippfehler aus. Bei
-- `merchant_key()` ist es umgekehrt gelöst, weil dort *zusammengeführt* wird und
-- nicht gelesen — beide Formen sind für ihren Zweck richtig.
--
-- Ersetzt wird vor `lower()` und in beiden Schreibweisen: Was `lower('Ä')`
-- ergibt, hängt sonst von der Spracheinstellung des Servers ab.
-- ============================================================================

create or replace function public.category_key(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(
          replace(replace(replace(replace(
            replace(replace(replace(replace(
              coalesce(p_name, ''),
            'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ß', 'ss'),
            'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'é', 'e')
        ),
        '[^a-z0-9]+', '_', 'g'),
      '_'),
    '')
$$;

comment on function public.category_key(text) is
  'Stabiler Schlüssel aus einem Kategorienamen: „Auswärts essen" wird zu „auswaerts_essen".';

revoke all on function public.category_key(text) from public;
grant execute on function public.category_key(text) to authenticated;


-- ============================================================================
-- 3. Händlerart
--
-- Ein Restaurantbesuch ist kein eigener Datentyp, sondern eine Variante des
-- bestehenden Bons (KONZEPT-ERWEITERUNGEN.md, Abschnitt 1). Genau ein Feld
-- unterscheidet ihn, und dieses Feld hängt am Händler: Einmal gesetzt, gilt es
-- für alle künftigen Bons desselben Ladens.
-- ============================================================================

alter table public.merchants add column if not exists kind text not null default 'retail';

alter table public.merchants drop constraint if exists merchants_kind_values;
alter table public.merchants
  add constraint merchants_kind_values check (kind in ('retail', 'gastro'));

create index if not exists merchants_kind_idx
  on public.merchants (household_id, kind) where kind <> 'retail';

/*
 * Die Art zu einem Händlernamen — für die Edge Function.
 *
 * Der Korrektur-Screen soll die Art eines bekannten Ladens vorausgewählt haben.
 * Gesucht wird über dieselbe Normalform, mit der `save_receipt` Händler
 * zusammenführt: „REWE", „Rewe" und „REWE CITY" sind ein Eintrag. Ohne das fände
 * ein Bon, auf dem der Laden diesmal anders geschrieben steht, seine eigene Art
 * nicht wieder.
 *
 * Eine Funktion und keine Abfrage im Client, weil `merchant_key()` sonst je
 * Händler einmal aufgerufen werden müsste — bei zwanzig Läden zwanzig Anfragen
 * für eine Angabe.
 *
 * **Kein SECURITY DEFINER.** Die Funktion läuft mit den Rechten des Aufrufers,
 * die Zeilensicherheit auf `merchants` greift also unverändert: Sie kann
 * überhaupt nur Händler des eigenen Haushalts sehen.
 */
create or replace function public.merchant_kind_for(p_name text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select m.kind
      from public.merchants m
      where public.merchant_key(m.name) = public.merchant_key(p_name)
      -- Bei mehreren Treffern gewinnt der älteste, wie in `save_receipt`.
      order by m.created_at
      limit 1
    ),
    'retail'
  )
$$;

comment on function public.merchant_kind_for(text) is
  'Die gespeicherte Art („retail" / „gastro") zu einem Händlernamen. Unbekannt → „retail".';

revoke all on function public.merchant_kind_for(text) from public;
grant execute on function public.merchant_kind_for(text) to authenticated;


-- ============================================================================
-- 4. Trinkgeld und Fremdwährung am Bon
--
-- **Trinkgeld ist keine Position, sondern eine Eigenschaft des Belegs.** Es
-- steht meist gar nicht auf dem Papier, wird also eingegeben statt gelesen — und
-- es geht deshalb ausdrücklich **nicht** in `printed_total_cents` ein. Sonst
-- meldete der Summenabgleich („Positionen gegen gedruckte Summe") jedes Mal eine
-- Abweichung in Höhe des Trinkgelds, obwohl nichts falsch gelesen wurde.
--
-- **Die bestehenden Cent-Felder halten weiterhin Euro.** Das ist die ganze
-- Idee hinter der Fremdwährung: Jede Auswertung rechnet unverändert weiter, ohne
-- von Währungen zu wissen. Daneben steht, was auf dem Bon stand.
--
--   `currency`             Bonwährung, ISO-Code. `EUR` ist der Normalfall.
--   `original_total_cents` Die gedruckte Summe in der Bonwährung.
--   `exchange_rate`        Der beim Speichern verwendete Kurs, eingefroren.
--   `rate_date`            Der Stichtag, für den der Kurs galt — nicht
--                          zwangsläufig das Bon-Datum (siehe exchange_rates).
--
-- Der Kurs wird beim Speichern eingefroren und nie nachgeführt: Sonst änderten
-- sich Monatssummen der Vergangenheit rückwirkend, und niemand könnte den Zahlen
-- mehr trauen.
-- ============================================================================

alter table public.receipts add column if not exists tip_cents            integer not null default 0;
alter table public.receipts add column if not exists currency             text not null default 'EUR';
alter table public.receipts add column if not exists original_total_cents integer;
alter table public.receipts add column if not exists exchange_rate        numeric(12,6);
alter table public.receipts add column if not exists rate_date            date;

alter table public.receipts drop constraint if exists receipts_tip_positive;
alter table public.receipts
  add constraint receipts_tip_positive check (tip_cents >= 0);

alter table public.receipts drop constraint if exists receipts_currency_form;
alter table public.receipts
  add constraint receipts_currency_form check (currency ~ '^[A-Z]{3}$');

alter table public.receipts drop constraint if exists receipts_rate_positive;
alter table public.receipts
  add constraint receipts_rate_positive
  check (exchange_rate is null or exchange_rate > 0);

/*
 * Die Zusicherung, auf der alle Auswertungen ruhen: Ein Bon in Fremdwährung
 * trägt immer sowohl den Originalbetrag als auch den benutzten Kurs. Nur dann
 * ist die Euro-Zahl daneben nachvollziehbar — und nur dann ist sie überhaupt
 * entstanden.
 *
 * Ein Euro-Bon trägt umgekehrt beides nicht: Ein Kurs von 1,0 wäre eine Zahl
 * ohne Aussage, und ein „Originalbetrag" in Euro wäre dieselbe Zahl zweimal.
 */
alter table public.receipts drop constraint if exists receipts_currency_pair;
alter table public.receipts
  add constraint receipts_currency_pair check (
    (currency = 'EUR' and original_total_cents is null and exchange_rate is null)
    or (currency <> 'EUR' and original_total_cents is not null and exchange_rate is not null)
  );


-- ============================================================================
-- 5. Der Kurs-Zwischenspeicher
--
-- **Diese Tabelle hängt bewusst an keinem Haushalt.** Ein Wechselkurs ist eine
-- öffentliche Tatsache und keine private Angabe — er gehört niemandem. Lesen
-- darf ihn jeder Angemeldete, und ein Tag wird höchstens einmal bei der EZB
-- abgefragt.
--
-- **`rate_date` und nicht `date`.** Das Konzept nennt die Spalte `date`; das ist
-- in PostgreSQL zwar erlaubt, aber `select date from exchange_rates` liest sich
-- wie ein Typ und nicht wie eine Spalte. Der Inhalt ist derselbe.
--
-- **Was `rate_date` bedeutet:** der Tag, für den der Kurs gilt — also der
-- Stichtag, nicht das Bon-Datum. An Wochenenden und Feiertagen veröffentlicht
-- die EZB keinen Kurs; dann steht hier der letzte verfügbare Werktag, und
-- `receipts.rate_date` hält denselben Wert fest. Damit bleibt später
-- nachvollziehbar, woher die Zahl stammt.
--
-- **`rate` ist der Preis einer Einheit Fremdwährung in Euro** (0,00 bis 9999).
-- Die EZB veröffentlicht ihre Kurse andersherum (1 EUR = x CHF); umgerechnet
-- wird in der Edge Function, gespeichert wird die Form, in der gerechnet wird:
-- Betrag × rate = Euro.
--
-- **Schreiben darf jeder Angemeldete** — in dieser App sind das drei
-- Familienmitglieder. Ein Dienstschlüssel in der Edge Function wäre die
-- strengere Lösung, würde aber die Linie aus PROJEKT.md brechen, dass die
-- Funktion ausschließlich mit dem Token des Nutzers arbeitet. Stattdessen
-- schreibt sie mit `on conflict do nothing`: Ein einmal gespeicherter Tag wird
-- nie wieder überschrieben.
-- ============================================================================

create table if not exists public.exchange_rates (
  rate_date  date not null,
  currency   text not null,
  rate       numeric(12,6) not null,
  fetched_at timestamptz not null default now(),
  primary key (rate_date, currency)
);

alter table public.exchange_rates drop constraint if exists exchange_rates_currency_form;
alter table public.exchange_rates
  add constraint exchange_rates_currency_form check (currency ~ '^[A-Z]{3}$');

alter table public.exchange_rates drop constraint if exists exchange_rates_rate_positive;
alter table public.exchange_rates
  add constraint exchange_rates_rate_positive check (rate > 0);

alter table public.exchange_rates enable row level security;

drop policy if exists exchange_rates_read on public.exchange_rates;
create policy exchange_rates_read on public.exchange_rates
  for select to authenticated
  using (true);

drop policy if exists exchange_rates_write on public.exchange_rates;
create policy exchange_rates_write on public.exchange_rates
  for insert to authenticated
  with check (true);

-- Kein update, kein delete: Ein veröffentlichter Kurs ändert sich nicht mehr.
grant select, insert on public.exchange_rates to authenticated;


-- ============================================================================
-- 6. Stammdaten: Farben, Erklärungen und das Merkmal `auswaerts`
--
-- Zwei Schritte, und beide sind vorsichtig:
--
--   * `seed_household()` wird ersetzt, damit ein NEUER Haushalt alles
--     mitbekommt.
--   * Bestehende Haushalte werden nachgezogen — aber nur dort, wo das Feld noch
--     leer ist. Wer eine Farbe oder eine Erklärung schon geändert hat, behält
--     sie, auch wenn diese Datei ein zweites Mal läuft.
-- ============================================================================

create or replace function public.seed_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /*
   * Die neun mitgelieferten Kategorien.
   *
   * Die Farben sind eins zu eins die Ramp-Token aus src/styles/tokens.css
   * (--cat-1 … --cat-8, --cat-nonfood) in der Reihenfolge der Sortierung. Bis
   * Schritt 5 wurden sie im Browser nach Ausgabenhöhe vergeben — dieselbe
   * Kategorie wechselte also von Monat zu Monat die Farbe. Ab jetzt gehört die
   * Farbe der Kategorie und bleibt stehen; das ist nebenbei die bessere Anzeige.
   *
   * Die Erklärungen gehen an das Modell. Sie sagen, was hineingehört und was
   * nicht — die Abgrenzung ist wichtiger als die Beschreibung.
   */
  insert into public.categories
    (household_id, key, name, is_food, sort_order, color, description, is_default)
  values
    (p_household_id, 'produce', 'Obst & Gemüse', true, 1, '#16915c',
     'Frisches Obst, Gemüse, Salat, Kräuter und Pilze – auch tiefgekühlt, solange nichts zugesetzt ist.', true),
    (p_household_id, 'meat', 'Fleisch & Fisch', true, 2, '#1fa86c',
     'Fleisch, Geflügel, Fisch, Meeresfrüchte sowie Wurst und Schinken.', true),
    (p_household_id, 'dairy', 'Milchprodukte', true, 3, '#43bc85',
     'Milch, Joghurt, Quark, Sahne, Butter, Käse und Milchersatz aus dem Kühlregal.', true),
    (p_household_id, 'bakery', 'Backwaren', true, 4, '#6acb9e',
     'Brot, Brötchen, Kuchen, Gebäck und Teigwaren aus der Backabteilung.', true),
    (p_household_id, 'drinks', 'Getränke', true, 5, '#8fd8b6',
     'Wasser, Saft, Limonade, Kaffee, Tee, Bier, Wein und Spirituosen.', true),
    (p_household_id, 'sweets', 'Süßes & Snacks', true, 6, '#afe3cb',
     'Schokolade, Bonbons, Kekse, Chips, Nüsse und salziges Knabberzeug.', true),
    (p_household_id, 'readymeals', 'Fertiggerichte', true, 7, '#c6ecdb',
     'Zubereitete Speisen zum Aufwärmen – Pizza, Tiefkühlgerichte, Konserven, Suppen, Dosenravioli.', true),
    (p_household_id, 'staples', 'Grundnahrungsmittel', true, 8, '#dcf2e8',
     'Vorrat zum Selberkochen: Mehl, Reis, Nudeln, Öl, Zucker, Salz, Gewürze, Hülsenfrüchte, Eier.', true),
    (p_household_id, 'nonfood', 'Non-Food', false, 9, '#7c8a99',
     'Alles, was man nicht isst: Reinigungsmittel, Hygieneartikel, Papierwaren, Haushaltswaren, Tierfutter.', true)
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
     'Statt homogenisierter Milch: nicht homogenisierte Milch mit Rahmschicht.'),
    /*
     * Gewicht 0 — ausdrücklich. Auswärts zu essen ist erst einmal eine
     * Beobachtung und kein Fehltritt; das Merkmal landet damit im Abschnitt
     * „Beobachtet" und verzerrt den Score nicht. Wer möchte, dass es ihn stört,
     * stellt das Gewicht in den Einstellungen selbst herunter.
     */
    ('auswaerts', 'Auswärts gegessen', 'A', null, 0, true, 14,
     'Speisen und Getränke, die im Lokal verzehrt oder geliefert wurden – Restaurant, Imbiss, Kantine, Lieferdienst.',
     'Neutral – wird nur beobachtet, kein Handlungsbedarf.')
  ) as v(key, label, short, trait_group, weight, active, sort_order, description, tip)
  on conflict (household_id, key) do nothing;
end;
$$;

/* ------------------------------------------- bestehende Haushalte nachziehen */

-- Das Merkmal `auswaerts` für alle, die es noch nicht haben.
insert into public.traits
  (household_id, key, label, short, trait_group, weight, active, sort_order,
   description, tip, is_default)
select h.id, 'auswaerts', 'Auswärts gegessen', 'A', null, 0, true, 14,
       'Speisen und Getränke, die im Lokal verzehrt oder geliefert wurden – Restaurant, Imbiss, Kantine, Lieferdienst.',
       'Neutral – wird nur beobachtet, kein Handlungsbedarf.',
       true
from public.households h
on conflict (household_id, key) do nothing;

-- Farbe, Erklärung und Kennzeichnung der mitgelieferten neun.
--
-- Jede Spalte einzeln bedingt: Wer die Farbe schon angepasst hat, behält sie
-- auch dann, wenn die Erklärung noch leer ist.
update public.categories c
   set color       = case when c.color = ''       then v.color       else c.color end,
       description = case when c.description = '' then v.description else c.description end,
       is_default  = true
from (values
  ('produce',    '#16915c', 'Frisches Obst, Gemüse, Salat, Kräuter und Pilze – auch tiefgekühlt, solange nichts zugesetzt ist.'),
  ('meat',       '#1fa86c', 'Fleisch, Geflügel, Fisch, Meeresfrüchte sowie Wurst und Schinken.'),
  ('dairy',      '#43bc85', 'Milch, Joghurt, Quark, Sahne, Butter, Käse und Milchersatz aus dem Kühlregal.'),
  ('bakery',     '#6acb9e', 'Brot, Brötchen, Kuchen, Gebäck und Teigwaren aus der Backabteilung.'),
  ('drinks',     '#8fd8b6', 'Wasser, Saft, Limonade, Kaffee, Tee, Bier, Wein und Spirituosen.'),
  ('sweets',     '#afe3cb', 'Schokolade, Bonbons, Kekse, Chips, Nüsse und salziges Knabberzeug.'),
  ('readymeals', '#c6ecdb', 'Zubereitete Speisen zum Aufwärmen – Pizza, Tiefkühlgerichte, Konserven, Suppen, Dosenravioli.'),
  ('staples',    '#dcf2e8', 'Vorrat zum Selberkochen: Mehl, Reis, Nudeln, Öl, Zucker, Salz, Gewürze, Hülsenfrüchte, Eier.'),
  ('nonfood',    '#7c8a99', 'Alles, was man nicht isst: Reinigungsmittel, Hygieneartikel, Papierwaren, Haushaltswaren, Tierfutter.')
) as v(key, color, description)
where c.key = v.key;

-- Selbst angelegte Kategorien aus der Zeit vor dieser Migration hätten sonst
-- gar keine Farbe. Ein neutrales Grau ist besser als ein leeres Feld — ändern
-- lässt es sich in den Einstellungen mit zwei Tippern.
update public.categories set color = '#7c8a99' where color = '';


-- ============================================================================
-- 7. Die Auswertungs-Sichten
--
-- Ersetzt werden nur die, die sich ändern. `create or replace view` verlangt,
-- dass die Spaltenliste am Anfang gleich bleibt und höchstens hinten wächst —
-- deshalb kommen neue Spalten überall ans Ende.
-- ============================================================================

-- ----------------------------------------------------------------- v_items
--
-- Neu: `is_gastro`. Sie kommt vom Händler des Bons und ist die eine Angabe, an
-- der alles Weitere hängt — getrennte Kopfzahl, Ausschluss aus den Bestpreisen.
-- Ein Bon ohne Händler (etwa über „Text einfügen") gilt als `retail`: Wer keinen
-- Laden genannt hat, hat auch kein Restaurant genannt.
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
  coalesce(mc.kind, 'retail') = 'gastro'     as is_gastro
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


-- ------------------------------------------------------------------ v_tips
--
-- Trinkgeld ist die einzige Ausgabe ohne Position. Damit es trotzdem überall
-- mitzählt, wo Ausgaben addiert werden, bekommt es eine eigene schmale Sicht —
-- statt in jeder Summenabfrage ein zweites Mal über `receipts` zu gehen.
create or replace view public.v_tips
with (security_invoker = true) as
select
  r.household_id,
  r.id                                       as receipt_id,
  r.purchased_on,
  date_trunc('month', r.purchased_on)::date  as month,
  r.tip_cents
from public.receipts r
where r.status = 'confirmed'
  and r.tip_cents > 0;


-- --------------------------------------------------------- v_month_summary
--
-- Vier Zahlen statt drei (KONZEPT-ERWEITERUNGEN.md, Abschnitt 1):
--
--   food_cents    Lebensmittel, ohne Gastronomie
--   dining_cents  Gastronomie — alle Positionen von Gastro-Bons plus Trinkgeld
--   nonfood_cents Non-Food, ohne Gastronomie
--   total_cents   alles zusammen, Trinkgeld eingeschlossen
--
-- Die drei Teilbeträge ergeben zusammen exakt `total_cents`. Das ist der Grund
-- für die `not is_gastro`-Filter oben: Ohne sie zählte eine Restaurantposition
-- in „Lebensmittel" UND in „Auswärts".
--
-- Ausgegangen wird von den Bons und nicht von den Positionen — sonst fehlte ein
-- Beleg, der nur aus Trinkgeld besteht, in jeder Zeile.
drop view if exists public.v_current_month_summary;
drop view if exists public.v_month_summary;

create view public.v_month_summary
with (security_invoker = true) as
with months as (
  select
    r.household_id,
    date_trunc('month', r.purchased_on)::date as month,
    count(*)::int                             as receipt_count
  from public.receipts r
  where r.status = 'confirmed'
  group by 1, 2
),
items as (
  select
    i.household_id,
    i.month,
    coalesce(sum(i.total_cents) filter (where i.is_food and not i.is_gastro), 0)     as food_cents,
    coalesce(sum(i.total_cents) filter (where not i.is_food and not i.is_gastro), 0) as nonfood_cents,
    coalesce(sum(i.total_cents) filter (where i.is_gastro), 0)                       as gastro_cents,
    coalesce(sum(i.total_cents), 0)                                                  as total_cents
  from public.v_items i
  group by 1, 2
),
tips as (
  select t.household_id, t.month, coalesce(sum(t.tip_cents), 0) as tip_cents
  from public.v_tips t
  group by 1, 2
)
select
  m.household_id,
  m.month,
  coalesce(i.food_cents, 0)::bigint                                as food_cents,
  coalesce(i.nonfood_cents, 0)::bigint                             as nonfood_cents,
  (coalesce(i.total_cents, 0) + coalesce(t.tip_cents, 0))::bigint  as total_cents,
  m.receipt_count,
  (coalesce(i.gastro_cents, 0) + coalesce(t.tip_cents, 0))::bigint as dining_cents
from months m
left join items i on i.household_id = m.household_id and i.month = m.month
left join tips  t on t.household_id = m.household_id and t.month = m.month;


-- ------------------------------------------------- v_current_month_summary
--
-- Unverändert im Aufbau, nur um `dining_cents` erweitert. Der Vormonatsvergleich
-- rechnet jetzt ebenfalls mit Trinkgeld, sonst verglichen sich zwei
-- verschiedene Größen.
create view public.v_current_month_summary
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
  coalesce(p.amount_cents, 0)                             as previous_month_to_date_cents,
  coalesce(m.dining_cents, 0)                             as dining_cents
from public.households h
left join public.v_month_summary m
  on m.household_id = h.id
 and m.month = date_trunc('month', current_date)::date
left join lateral (
  select bu.amount_cents::bigint as amount_cents
  from public.budgets bu
  where bu.household_id = h.id
    and bu.month <= date_trunc('month', current_date)::date
  order by bu.month desc
  limit 1
) b on true
left join lateral (
  select (
    coalesce((
      select sum(vi.total_cents)
      from public.v_items vi
      where vi.household_id = h.id
        and vi.purchased_on >= (date_trunc('month', current_date) - interval '1 month')::date
        and vi.purchased_on <  least(
              (date_trunc('month', current_date) - interval '1 month')::date
                + make_interval(days => extract(day from current_date)::int),
              date_trunc('month', current_date)::date
            )
    ), 0)
    + coalesce((
      select sum(vt.tip_cents)
      from public.v_tips vt
      where vt.household_id = h.id
        and vt.purchased_on >= (date_trunc('month', current_date) - interval '1 month')::date
        and vt.purchased_on <  least(
              (date_trunc('month', current_date) - interval '1 month')::date
                + make_interval(days => extract(day from current_date)::int),
              date_trunc('month', current_date)::date
            )
    ), 0)
  )::bigint as amount_cents
) p on true;


-- ----------------------------------------------------- v_category_totals
--
-- Neu: Farbe und Aktiv-Kennzeichen der Kategorie. Der Ring im Browser färbt
-- damit nach der Kategorie und nicht mehr nach dem Rang in der Ausgabenliste —
-- dieselbe Kategorie hat ab jetzt jeden Monat dieselbe Farbe.
--
-- Eine abgeschaltete Kategorie erscheint hier weiterhin, solange Altdaten auf
-- sie zeigen: Sonst verschwänden Ausgaben aus dem Ring, ohne dass die Summe
-- daneben kleiner würde.
create or replace view public.v_category_totals
with (security_invoker = true) as
select
  i.household_id,
  i.month,
  c.key                       as category_key,
  c.name,
  c.is_food,
  c.sort_order,
  sum(i.total_cents)::bigint  as amount_cents,
  c.color,
  c.active
from public.v_items i
join public.categories c
  on c.household_id = i.household_id and c.key = i.category_key
group by i.household_id, i.month, c.key, c.name, c.is_food, c.sort_order, c.color, c.active;


-- ------------------------------------------------------- v_spending_trend
--
-- Unverändert bis auf eines: Trinkgeld zählt mit. Ohne das wäre ein
-- Restaurantabend im Balkendiagramm kleiner als in der Kopfkarte.
create or replace view public.v_spending_trend
with (security_invoker = true) as
with buckets as (
  select
    'week'::text                                     as range_id,
    g.i                                              as bucket_index,
    (date_trunc('week', current_date)::date + g.i)   as bucket_start,
    (date_trunc('week', current_date)::date + g.i)   as bucket_end
  from generate_series(0, 6) as g(i)

  union all

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

  select
    'year',
    g.i,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i))::date,
    (date_trunc('month', current_date) - make_interval(months => 5 - g.i)
      + interval '1 month - 1 day')::date
  from generate_series(0, 5) as g(i)

  union all

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
  select
    coalesce((
      select sum(i.total_cents)
      from public.v_items i
      where i.household_id = h.id
        and i.purchased_on between b.bucket_start and b.bucket_end
    ), 0)
    + coalesce((
      select sum(t.tip_cents)
      from public.v_tips t
      where t.household_id = h.id
        and t.purchased_on between b.bucket_start and b.bucket_end
    ), 0) as amount_cents
) s on true;


-- --------------------------------------------------- v_price_observations
--
-- **Gastro-Positionen sind ausgeschlossen** (KONZEPT-ERWEITERUNGEN.md,
-- Abschnitt 1). „Pizza bei zwei Restaurants" wäre Scheingenauigkeit:
-- Portionsgröße, Beilagen und Qualität sind nicht vergleichbar, und ein
-- Bestpreis, der das behauptet, ist schlechter als gar keiner.
--
-- Gefiltert wird hier und nicht weiter oben, weil alle Preis-Sichten auf dieser
-- aufsetzen — Bestpreis, Grundpreis, Preisverlauf und Sparpotenzial erben den
-- Ausschluss damit von selbst.
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
  and coalesce(i.unit_price_cents, i.total_cents) > 0
  and not i.is_gastro;


grant select on public.v_tips to authenticated;
grant select on public.v_month_summary to authenticated;
grant select on public.v_current_month_summary to authenticated;


-- ============================================================================
-- 8. Speichern — jetzt auch aktualisieren
--
-- Die Funktion aus 0003, erweitert um vier Dinge. Der Lernkreis in der Mitte
-- ist unverändert; seine drei Regeln stehen weiterhin im Kopf von
-- 0003_speichern.sql und gelten wörtlich auch hier.
--
--   1. **Händlerart.** Ein neuer Händler bekommt die mitgeschickte Art. Ein
--      bekannter wird nur dann umgestellt, wenn der Nutzer es ausdrücklich getan
--      hat (`haendler_art_quelle = 'user'`) — sonst würde jeder Bon eines als
--      Gastro markierten Ladens ihn wieder auf `retail` zurücksetzen.
--   2. **Trinkgeld** als Eigenschaft des Belegs, nicht als Position.
--   3. **Fremdwährung.** Die Cent-Felder halten Euro; daneben steht, was auf
--      dem Bon stand. Ohne vollständige Angabe wird auf Euro zurückgefallen
--      statt eine halbe Umrechnung zu speichern.
--   4. **`bon_id`** — ist sie gesetzt, wird der bestehende Bon aktualisiert
--      statt ein zweiter angelegt. Die Positionen werden dabei ersetzt: Welche
--      Zeile der Nutzer umbenannt, gelöscht oder ergänzt hat, lässt sich von
--      außen nicht zuverlässig zuordnen, und eine falsch zugeordnete Zeile wäre
--      schlimmer als eine neu geschriebene. Der Bon behält seine id, und damit
--      bleibt der Verweis aus der Adresszeile gültig.
--
-- Nach wie vor kein SECURITY DEFINER: Die Funktion läuft mit den Rechten des
-- Aufrufers und kann in keinen fremden Haushalt schreiben.
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
      -- Nur die ausdrückliche Entscheidung des Nutzers stellt einen bekannten
      -- Händler um. Sie gilt dann für alle Bons dieses Ladens, auch für die
      -- bereits gespeicherten — die Art hängt am Händler, nicht am Beleg.
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

  /*
   * Ohne vollständige Angabe gilt der Bon als Euro-Bon. Die Alternative wäre,
   * eine Währung ohne Kurs zu speichern — dann stünde in den Cent-Feldern ein
   * Franken-Betrag, den jede Auswertung für Euro hielte. Lieber eine Angabe
   * verlieren als jede Monatssumme verfälschen.
   */
  if v_currency = 'EUR' or v_original is null or v_rate is null or v_rate <= 0 then
    v_currency  := 'EUR';
    v_original  := null;
    v_rate      := null;
    v_rate_date := null;
  end if;

  /* ----------------------------------------------------------------- Bon */

  v_receipt := nullif(btrim(coalesce(p_payload->>'bon_id', '')), '')::uuid;

  if v_receipt is not null then
    /*
     * Aktualisieren. Die Prüfung auf den eigenen Haushalt ist nicht nur
     * Höflichkeit: Ohne sie liefe das UPDATE dank Zeilensicherheit zwar ins
     * Leere, gäbe aber trotzdem eine id zurück — und die App zeigte einen Bon,
     * den sie nie geschrieben hat.
     */
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

    -- Die Positionen werden ersetzt, nicht abgeglichen. `line_no` beginnt
    -- danach wieder bei 1, und der eindeutige Schlüssel (receipt_id, line_no)
    -- bleibt sauber.
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
      -- Das Bon-Foto wird nach der Erkennung verworfen und nie hochgeladen
      -- (PROJEKT.md, Datenschutz). Deshalb steht hier immer null.
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

  /*
   * Der Trigger auf `receipt_items` hält `discrepancy_cents` aktuell. Beim
   * Aktualisieren eines Bons OHNE Positionen (alle gelöscht) feuert er nicht —
   * dann muss die Abweichung hier von Hand nachgezogen werden, sonst stünde
   * noch die des vorigen Standes da.
   */
  if v_line = 0 then
    update public.receipts r
       set discrepancy_cents = r.printed_total_cents
     where r.id = v_receipt and r.household_id = v_household;
  end if;

  return v_receipt;
end;
$$;

comment on function public.save_receipt(jsonb) is
  'Speichert oder aktualisiert einen geprüften Bon vollständig oder gar nicht: '
  'Händler samt Art, Bon samt Trinkgeld und Währung, Positionen, kanonische '
  'Produkte und die gelernten Zuordnungen.';

revoke all on function public.save_receipt(jsonb) from public;
grant execute on function public.save_receipt(jsonb) to authenticated;


-- ============================================================================
-- 9. Wie viele Produkte hängen an einer Kategorie?
--
-- Die Einstellungen sagen beim Deaktivieren, wie viele Produkte betroffen sind.
-- Eine Sicht statt einer Zählabfrage je Kategorie: Bei zwölf Kategorien wären
-- das sonst zwölf Anfragen für eine einzige Zeile Text.
-- ============================================================================

create or replace view public.v_category_product_counts
with (security_invoker = true) as
select
  c.household_id,
  c.key                       as category_key,
  count(cp.id)::int           as product_count
from public.categories c
left join public.canonical_products cp
  on cp.household_id = c.household_id and cp.category_key = c.key
group by c.household_id, c.key;

grant select on public.v_category_product_counts to authenticated;


-- Sagt der Schnittstelle Bescheid, dass sich das Schema geändert hat. Ohne das
-- kann es einen Moment dauern, bis die App die neuen Spalten sieht.
notify pgrst, 'reload schema';

commit;
