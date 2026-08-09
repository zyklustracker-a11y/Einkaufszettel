-- ============================================================================
-- Die Prüfungen
--
-- Jede steht als `assert` in einem DO-Block: Stimmt eine Zahl nicht, bricht der
-- Lauf mit ihrem Namen ab. Kein Testrahmen, keine Abhängigkeit — `psql` und
-- plpgsql können das selbst.
--
-- Gelaufen wird als Rolle `pruefer`, also **mit** Zeilensicherheit. Damit prüfen
-- dieselben Abfragen gleichzeitig die Haushaltstrennung mit: Was hier
-- herauskommt, ist genau das, was die App zu sehen bekäme.
-- ============================================================================

\set ON_ERROR_STOP on

set role pruefer;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare
  r record;
  n bigint;
begin
  /* ================================================== Haushaltstrennung */

  -- Haushalt B hat einen Bon über 99,99 €. Er darf hier nirgends auftauchen.
  select count(*) into n from public.v_items where product_name = 'Fremder Artikel';
  assert n = 0, 'Haushaltstrennung: fremde Position sichtbar';

  select count(*) into n from public.v_items;
  assert n = 13, format('v_items: 13 Positionen erwartet, %s gefunden', n);

  /* =================================================== Monatsübersicht */

  select * into r from public.v_current_month_summary;

  assert r.food_cents = 1301, format('food_cents: 1301 erwartet, %s', r.food_cents);
  assert r.nonfood_cents = 199, format('nonfood_cents: 199 erwartet, %s', r.nonfood_cents);
  assert r.dining_cents = 2600, format('dining_cents: 2600 erwartet, %s', r.dining_cents);
  assert r.total_cents = 4100, format('total_cents: 4100 erwartet, %s', r.total_cents);

  -- Die Probe aus supabase/README.md: Die drei Teilbeträge ergeben die Summe.
  assert r.food_cents + r.dining_cents + r.nonfood_cents = r.total_cents,
    'Kopfkarte: die drei Teilbeträge ergeben nicht die Gesamtsumme';

  assert r.receipt_count = 3, format('receipt_count: 3 erwartet, %s', r.receipt_count);
  assert r.budget_cents = 45000, format('budget_cents: 45000 erwartet, %s', r.budget_cents);
  assert r.previous_month_to_date_cents = 750,
    format('Vormonat: 750 erwartet, %s', r.previous_month_to_date_cents);

  -- Hochrechnung: Ausgaben ÷ Tag im Monat × Tage des Monats.
  assert r.forecast_cents = round(
      4100::numeric
      * extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))
      / extract(day from current_date)),
    format('forecast_cents unerwartet: %s', r.forecast_cents);

  /* ==================================================== Kategoriensummen */

  select sum(amount_cents) into n
  from public.v_category_totals
  where month = date_trunc('month', current_date)::date;
  -- Alle Positionen des Monats, ohne Trinkgeld: 4100 − 200.
  assert n = 3900, format('Kategoriensummen: 3900 erwartet, %s', n);

  select amount_cents into n
  from public.v_category_totals
  where month = date_trunc('month', current_date)::date and category_key = 'dairy';
  assert n = 456, format('Kategorie dairy: 456 erwartet, %s', n);

  select amount_cents into n
  from public.v_category_totals
  where month = date_trunc('month', current_date)::date and category_key = 'auswaerts_essen';
  assert n = 2400, format('Kategorie auswaerts_essen: 2400 erwartet, %s', n);

  /* ================================================== Händler-Zusammenführung */

  -- „REWE" und „REWE CITY" sind derselbe Laden (merchant_key).
  select count(*) into n from public.merchants;
  assert n = 4, format('Händler: 4 erwartet (REWE, Aldi, Trattoria, Shell), %s gefunden', n);

  select count(*) into n from public.merchants where kind = 'gastro';
  assert n = 1, format('Gastro-Händler: 1 erwartet, %s', n);

  /* ======================================================== Lernkreis */

  -- „G&G H-MILCH 1,5%" und „MILCH H 1,5%" zeigen auf dasselbe Produkt.
  select count(distinct canonical_product_id) into n
  from public.product_mappings
  where lower(raw_text) in ('g&g h-milch 1,5%', 'milch h 1,5%');
  assert n = 1, format('Lernkreis: ein Produkt für beide Rohtexte erwartet, %s', n);

  -- Regel 3: Eine bestehende `user`-Zuordnung wird nie auf `model` zurückgestuft.
  -- Der Vormonatsbon kam mit `quelle = model` und demselben Rohtext.
  select source into r from public.product_mappings where lower(raw_text) = 'g&g h-milch 1,5%';
  assert r.source = 'user', format('Lernkreis: user-Zuordnung auf %s zurückgestuft', r.source);

  /* ========================================================== Bestpreise */

  -- Gastro ist ausgeschlossen: Die Pizza taucht in keiner Preis-Sicht auf.
  select count(*) into n from public.v_price_observations where product_name = 'Pizza Margherita';
  assert n = 0, 'Bestpreise: Gastro-Position nicht ausgeschlossen';

  select * into r from public.v_product_best_price b
  join public.canonical_products cp on cp.id = b.product_id
  where cp.name = 'H-Milch 1,5 %';
  assert r.price_cents = 99, format('Bestpreis H-Milch: 99 erwartet, %s', r.price_cents);
  assert r.merchant_name like 'ALDI%', format('Bestpreis H-Milch beim falschen Laden: %s', r.merchant_name);

  select * into r from public.v_product_prices p
  join public.canonical_products cp on cp.id = p.product_id
  where cp.name = 'H-Milch 1,5 %';
  assert r.purchase_count = 3, format('H-Milch: 3 Beobachtungen erwartet, %s', r.purchase_count);
  assert r.min_cents = 99 and r.max_cents = 139,
    format('H-Milch min/max: 99/139 erwartet, %s/%s', r.min_cents, r.max_cents);

  /* ========================================================= Grundpreis */

  -- Bananen werden nach Gewicht verkauft: Der Einzelpreis IST der Grundpreis.
  -- Bis Schritt 8 stand hier immer null, weil `size_base` nie gefüllt wird.
  select * into r from public.v_product_prices p
  join public.canonical_products cp on cp.id = p.product_id
  where cp.name = 'Bananen';
  assert r.base_price_cents = 169, format('Grundpreis Bananen: 169 erwartet, %s', r.base_price_cents);
  assert r.base_unit = 'kg', format('Grundpreis-Einheit Bananen: kg erwartet, %s', r.base_unit);
  assert r.merchant_count = 2, format('Bananen bei 2 Läden erwartet, %s', r.merchant_count);

  -- Stückware hat keinen Grundpreis. „Ohne Mengenangabe" ist ein echter
  -- Zustand und kein Fehler — geraten wird auch hier nicht.
  select * into r from public.v_product_prices p
  join public.canonical_products cp on cp.id = p.product_id
  where cp.name = 'H-Milch 1,5 %';
  assert r.base_price_cents is null, format('Grundpreis H-Milch: null erwartet, %s', r.base_price_cents);
  assert r.base_unit is null, 'Grundpreis-Einheit H-Milch: null erwartet';

  /* ====================================================== Sparpotenzial */

  select count(*) into n from public.v_savings_current_month;
  assert n = 2, format('Sparpotenzial: 2 Zeilen erwartet, %s', n);

  select sum(excess_cents) into n from public.v_savings_current_month;
  assert n = 60, format('Sparpotenzial gesamt: 60 erwartet, %s', n);

  -- Die Schwelle „mindestens zwei Läden": Sprit gab es nur bei Shell, also
  -- taucht er nie im Sparpotenzial auf — auch dann nicht, wenn eine Füllung
  -- teurer war als die andere. Das wäre eine Aussage über den Ölpreis und
  -- nicht über die Wahl der Tankstelle.
  select count(*) into n from public.v_savings_current_month where product_name = 'Super E10';
  assert n = 0, 'Sparpotenzial: Produkt mit nur einem Laden nicht ausgeschlossen';

  /* ==================================================== Häufigste Käufe */

  select count(*) into n from public.v_frequent_products;
  -- Nur Produkte mit mindestens zwei Käufen: H-Milch (3), Bananen (3),
  -- Super E10 (2). Alles Einmalige fällt heraus.
  assert n = 3, format('Häufigste Käufe: 3 Zeilen erwartet, %s', n);

  select * into r from public.v_frequent_products where rank = 1;
  assert r.name = 'H-Milch 1,5 %', format('Häufigster Kauf: H-Milch erwartet, %s', r.name);
  assert r.purchase_count = 3, format('H-Milch: 3 Käufe erwartet, %s', r.purchase_count);

  /* ==================================================== Datengrundlage */

  select * into r from public.v_household_stats;
  assert r.receipt_count = 6, format('Einkäufe: 6 erwartet, %s', r.receipt_count);
  assert r.merchant_count = 4, format('Läden: 4 erwartet, %s', r.merchant_count);
  assert r.product_count = 8, format('Produkte: 8 erwartet, %s', r.product_count);
  -- Der erste Einkauf liegt drei Monate zurück; auf den Tag genau hängt das vom
  -- Prüftag ab, mindestens zwei Monate sind es immer.
  assert r.day_span >= 59, format('Zeitraum: mindestens 59 Tage erwartet, %s', r.day_span);

  /* ========================================================= Gesundheit */

  select * into r from public.v_health_split
  where month = date_trunc('month', current_date)::date;
  assert r.processed_cents = 304, format('verarbeitet: 304 erwartet, %s', r.processed_cents);
  assert r.unprocessed_cents = 3397, format('unverarbeitet: 3397 erwartet, %s', r.unprocessed_cents);

  -- Die abgeleiteten Milch-Merkmale: `uht` und `homogenisiert` entstehen aus den
  -- Sachattributen und stehen nicht in canonical_product_traits.
  select count(*) into n
  from public.v_item_trait_keys k
  join public.v_items i on i.item_id = k.item_id
  where i.product_name = 'H-Milch 1,5 %' and k.trait_key = 'uht';
  -- Drei Positionen über beide Monate — und das Merkmal steht an keiner davon
  -- in `canonical_product_traits`. Auch die Zeile vom Vormonat trägt es, obwohl
  -- ihr Bon ohne `milch_erhitzung` gespeichert wurde: Das Attribut hängt am
  -- Produkt und gilt rückwirkend für alle Käufe (PROJEKT.md).
  assert n = 3, format('abgeleitetes Merkmal uht: 3 Positionen erwartet, %s', n);

  select count(*) into n
  from public.canonical_product_traits cpt
  join public.traits t on t.id = cpt.trait_id
  where t.key in ('uht', 'homogenisiert');
  assert n = 0, format('abgeleitete Merkmale doppelt gespeichert: %s Zeilen', n);

  select amount_cents into n from public.v_trait_spending
  where month = date_trunc('month', current_date)::date and key = 'weizen';
  assert n = 304, format('Ausgaben für weizen: 304 erwartet, %s', n);

  -- Die Gruppenregel gilt hier ausdrücklich NICHT: `gluten` und `weizen` zählen
  -- beide mit dem vollen Betrag (PROJEKT.md).
  select amount_cents into n from public.v_trait_spending
  where month = date_trunc('month', current_date)::date and key = 'gluten';
  assert n = 304, format('Ausgaben für gluten: 304 erwartet, %s', n);

  /* ====================================================== Ausgabenverlauf */

  select sum(amount_cents) into n from public.v_spending_trend where range_id = 'year';
  -- Sechs Monatstöpfe: laufender Monat (4100), Vormonat (750) und die beiden
  -- Tankfüllungen zwei und drei Monate zurück (6841 + 7560).
  assert n = 19251, format('Jahresverlauf: 19251 erwartet, %s', n);

  /* ========================================================= Spritkosten */

  select count(*) into n from public.v_fuel_purchases;
  assert n = 2, format('Tankfüllungen: 2 erwartet, %s', n);

  select * into r from public.v_fuel_months
  where month = (date_trunc('month', current_date) - interval '2 months')::date;
  assert r.millilitres = 38450, format('Liter: 38450 ml erwartet, %s', r.millilitres);
  assert r.amount_cents = 6841, format('Spritkosten: 6841 erwartet, %s', r.amount_cents);
  -- 6841 Cent ÷ 38,45 l = 177,92 Cent/l. Zwei Nachkommastellen, weil Sprit in
  -- Zehntelcent ausgezeichnet ist — ganze Cent verlören genau diese Stelle.
  assert r.price_per_litre_cents = 177.92,
    format('Literpreis: 177,92 erwartet, %s', r.price_per_litre_cents);

  -- Verglichen wird der Literpreis und nicht die Tankfüllung. Sonst wäre der
  -- „Bestpreis" schlicht die kleinste Menge, die je getankt wurde.
  select * into r from public.v_product_best_price b
  join public.canonical_products cp on cp.id = b.product_id
  where cp.name = 'Super E10';
  assert r.price_cents = 178, format('Bestpreis Sprit: 178 Cent/l erwartet, %s', r.price_cents);

  /* ========================================================= Top-Produkte */

  select * into r from public.v_top_products
  where month = date_trunc('month', current_date)::date and rank = 1;
  assert r.name = 'Pizza Margherita', format('Top 1: Pizza Margherita erwartet, %s', r.name);
  assert r.amount_cents = 2400, format('Top 1 Betrag: 2400 erwartet, %s', r.amount_cents);

  /* =========================================================== Scan-Jobs */

  declare
    v_job uuid;
  begin
    v_job := public.start_scan_job();
    assert v_job is not null, 'start_scan_job() hat keine id geliefert';

    select count(*) into n from public.v_open_scan_job;
    -- Ein laufender Job zählt als offen: Wer nach einem App-Wechsel zurückkommt,
    -- muss ihn finden, um nachsehen zu können.
    assert n = 1, format('offener Job: 1 erwartet, %s', n);

    update public.scan_jobs
       set status = 'done', result = '{"extraction":{"items":[]}}'::jsonb, finished_at = now()
     where id = v_job;

    select count(*) into n from public.v_open_scan_job where status = 'done';
    assert n = 1, 'fertiger Job wird nicht als offen gemeldet';

    update public.scan_jobs set consumed_at = now() where id = v_job;
    select count(*) into n from public.v_open_scan_job;
    assert n = 0, 'abgeholter Job meldet sich weiterhin';

    -- Ein `done` ohne Ergebnis darf gar nicht erst entstehen.
    begin
      update public.scan_jobs set result = null where id = v_job;
      assert false, 'scan_jobs_outcome_pair greift nicht';
    exception
      when check_violation then null;
    end;
  end;

  raise notice 'Alle Sicht-Prüfungen bestanden.';
end
$$;

reset role;
