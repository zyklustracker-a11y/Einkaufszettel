-- ============================================================================
-- Testdaten
--
-- Ein Haushalt mit vier Einkäufen in zwei Läden und einem Restaurant, dazu ein
-- zweiter Haushalt als Gegenprobe für die Trennung. Alle Beträge sind so
-- gewählt, dass sie in `checks.sql` von Hand nachrechenbar sind.
--
-- **Geschrieben wird über `save_receipt`**, nicht mit `insert`. Damit prüft
-- schon das Anlegen der Testdaten den ganzen Schreibweg mit: Händler
-- zusammenführen, kanonische Produkte anlegen, Merkmale hängen, Zuordnungen
-- lernen. Ein `insert` von Hand würde stattdessen einen Zustand herstellen, den
-- die App so nie erzeugt.
--
-- **Die Daten hängen an `current_date`.** Die Sichten rechnen mit dem laufenden
-- Monat, also müssen die Testdaten mitwandern. Der laufende Monat bekommt seine
-- Bons auf den Monatsersten — der liegt immer in der Vergangenheit oder heute,
-- egal an welchem Tag geprüft wird.
-- ============================================================================

do $$
declare
  v_user_a  uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b  uuid := '22222222-2222-2222-2222-222222222222';
  v_house_a uuid;
  v_house_b uuid;
  m0        date := date_trunc('month', current_date)::date;
  pm        date := (date_trunc('month', current_date) - interval '1 month')::date;
begin
  -- Der Trigger `on_auth_user_created` legt Haushalt, Mitgliedschaft,
  -- Kategorien und Merkmale an — genau wie beim ersten Login.
  insert into auth.users (id, email) values
    (v_user_a, 'a@example.test'),
    (v_user_b, 'b@example.test');

  select household_id into v_house_a from public.household_members where user_id = v_user_a;
  select household_id into v_house_b from public.household_members where user_id = v_user_b;

  -- „Auswärts essen" entsteht sonst über die Kategorieverwaltung. Hier von Hand,
  -- weil die Testdaten ein Restaurant brauchen.
  insert into public.categories (household_id, key, name, is_food, sort_order, color, description)
  values (v_house_a, 'auswaerts_essen', 'Auswärts essen', true, 10, '#b07a12',
          'Speisen und Getränke, die im Lokal verzehrt oder geliefert wurden.')
  on conflict (household_id, key) do nothing;

  insert into public.budgets (household_id, month, amount_cents)
  values (v_house_a, m0, 45000)
  on conflict (household_id, month) do nothing;

  /* ------------------------------------------------------------ Haushalt A */

  perform set_config('request.jwt.claim.sub', v_user_a::text, false);

  -- 1. REWE, laufender Monat, 10,00 €
  perform public.save_receipt(jsonb_build_object(
    'haendler', 'REWE', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', m0::text, 'summe_cent', 1000, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'G&G H-MILCH 1,5%', 'art', 'artikel', 'name', 'H-Milch 1,5 %',
        'kategorie', 'dairy', 'merkmale', jsonb_build_array('milch'),
        'milch_erhitzung', 'uht', 'milch_homogenisiert', 'ja',
        'menge_basis', 2, 'menge_einheit', 'stk', 'einzelpreis_cent', 129,
        'zeilensumme_cent', 258, 'steuer', 'B', 'quelle', 'user'),
      jsonb_build_object('rohtext', 'BANANEN', 'art', 'artikel', 'name', 'Bananen',
        'kategorie', 'produce', 'merkmale', jsonb_build_array(),
        'menge_basis', 1200, 'menge_einheit', 'kg', 'einzelpreis_cent', 199,
        'zeilensumme_cent', 239, 'steuer', 'B', 'quelle', 'user'),
      jsonb_build_object('rohtext', 'SPUELMITTEL', 'art', 'artikel', 'name', 'Spülmittel',
        'kategorie', 'nonfood', 'merkmale', jsonb_build_array(),
        'menge_basis', 1, 'menge_einheit', 'stk', 'einzelpreis_cent', 199,
        'zeilensumme_cent', 199, 'steuer', 'A', 'quelle', 'user'),
      jsonb_build_object('rohtext', 'TK PIZZA SALAMI', 'art', 'artikel', 'name', 'Tiefkühlpizza Salami',
        'kategorie', 'readymeals',
        'merkmale', jsonb_build_array('verarbeitet', 'weizen', 'gluten', 'samenoel'),
        'menge_basis', 1, 'menge_einheit', 'stk', 'einzelpreis_cent', 304,
        'zeilensumme_cent', 304, 'steuer', 'B', 'quelle', 'user')
    )
  ));

  -- 2. Aldi, laufender Monat, 5,00 € — hier ist die Milch billiger.
  perform public.save_receipt(jsonb_build_object(
    'haendler', 'ALDI SÜD', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', m0::text, 'summe_cent', 500, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'MILCH H 1,5%', 'art', 'artikel', 'name', 'H-Milch 1,5 %',
        'kategorie', 'dairy', 'merkmale', jsonb_build_array('milch'),
        'milch_erhitzung', 'uht', 'milch_homogenisiert', 'ja',
        'menge_basis', 2, 'menge_einheit', 'stk', 'einzelpreis_cent', 99,
        'zeilensumme_cent', 198, 'steuer', 'B', 'quelle', 'user'),
      jsonb_build_object('rohtext', 'BANANE LOSE', 'art', 'artikel', 'name', 'Bananen',
        'kategorie', 'produce', 'merkmale', jsonb_build_array(),
        'menge_basis', 1000, 'menge_einheit', 'kg', 'einzelpreis_cent', 169,
        'zeilensumme_cent', 169, 'steuer', 'B', 'quelle', 'user'),
      -- 500 g zu 2,66 EUR/kg: Die Menge steht in Gramm (Basiseinheit), die
      -- Anzeigeeinheit ist `kg`, und der Einzelpreis gilt je Kilo. Genau daraus
      -- entsteht seit Schritt 8 der Grundpreis.
      jsonb_build_object('rohtext', 'KAFFEE GEMAHLEN', 'art', 'artikel', 'name', 'Kaffee gemahlen',
        'kategorie', 'drinks', 'merkmale', jsonb_build_array(),
        'menge_basis', 500, 'menge_einheit', 'kg', 'einzelpreis_cent', 266,
        'zeilensumme_cent', 133, 'steuer', 'B', 'quelle', 'user')
    )
  ));

  -- 3. Trattoria, laufender Monat, 24,00 € plus 2,00 € Trinkgeld.
  perform public.save_receipt(jsonb_build_object(
    'haendler', 'Trattoria Bella', 'haendler_art', 'gastro', 'haendler_art_quelle', 'user',
    'gekauft_am', m0::text, 'summe_cent', 2400, 'trinkgeld_cent', 200, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'PIZZA MARGHERITA', 'art', 'artikel', 'name', 'Pizza Margherita',
        'kategorie', 'auswaerts_essen', 'merkmale', jsonb_build_array('auswaerts'),
        'menge_basis', 2, 'menge_einheit', 'stk', 'einzelpreis_cent', 1200,
        'zeilensumme_cent', 2400, 'quelle', 'user')
    )
  ));

  -- 4. REWE, Vormonat, 7,50 €.
  perform public.save_receipt(jsonb_build_object(
    'haendler', 'REWE CITY', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', pm::text, 'summe_cent', 750, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'G&G H-MILCH 1,5%', 'art', 'artikel', 'name', 'H-Milch 1,5 %',
        'kategorie', 'dairy', 'merkmale', jsonb_build_array('milch'),
        'menge_basis', 2, 'menge_einheit', 'stk', 'einzelpreis_cent', 139,
        'zeilensumme_cent', 278, 'steuer', 'B', 'quelle', 'model'),
      jsonb_build_object('rohtext', 'BANANEN', 'art', 'artikel', 'name', 'Bananen',
        'kategorie', 'produce', 'merkmale', jsonb_build_array(),
        'menge_basis', 1000, 'menge_einheit', 'kg', 'einzelpreis_cent', 189,
        'zeilensumme_cent', 189, 'steuer', 'B', 'quelle', 'model'),
      jsonb_build_object('rohtext', 'BROT 500G', 'art', 'artikel', 'name', 'Bauernbrot',
        'kategorie', 'bakery', 'merkmale', jsonb_build_array('gluten', 'weizen'),
        'menge_basis', 500, 'menge_einheit', 'kg', 'einzelpreis_cent', 566,
        'zeilensumme_cent', 283, 'steuer', 'B', 'quelle', 'model')
    )
  ));

  /*
   * 5. und 6. Tankstelle, zwei und drei Monate zurück.
   *
   * Bewusst außerhalb der beiden Monate oben: So bleiben die Zahlen der
   * Kopfkarte klein und von Hand nachrechenbar, und die Spritauswertung bekommt
   * trotzdem zwei Monate mit unterschiedlichem Literpreis.
   *
   * 38,45 L × 1,779 EUR/L sind gedruckt 68,41 EUR. Der Einzelpreis steht als
   * ganze Zahl in Cent (178) — genau der Fall, für den die Toleranz in
   * `validate.ts` mit der Menge wächst.
   */
  perform public.save_receipt(jsonb_build_object(
    'haendler', 'Shell', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', (m0 - interval '2 months')::date::text,
    'summe_cent', 6841, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'SUPER E10', 'art', 'artikel', 'name', 'Super E10',
        'kategorie', 'kraftstoff', 'merkmale', jsonb_build_array(),
        'menge_basis', 38450, 'menge_einheit', 'l', 'einzelpreis_cent', 178,
        'zeilensumme_cent', 6841, 'steuer', 'A', 'quelle', 'user')
    )
  ));

  perform public.save_receipt(jsonb_build_object(
    'haendler', 'Shell', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', (m0 - interval '3 months')::date::text,
    'summe_cent', 7560, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'SUPER E10', 'art', 'artikel', 'name', 'Super E10',
        'kategorie', 'kraftstoff', 'merkmale', jsonb_build_array(),
        'menge_basis', 40000, 'menge_einheit', 'l', 'einzelpreis_cent', 189,
        'zeilensumme_cent', 7560, 'steuer', 'A', 'quelle', 'user')
    )
  ));

  /* ------------------------------------------------------------ Haushalt B */

  perform set_config('request.jwt.claim.sub', v_user_b::text, false);

  perform public.save_receipt(jsonb_build_object(
    'haendler', 'Edeka', 'haendler_art', 'retail', 'haendler_art_quelle', 'model',
    'gekauft_am', m0::text, 'summe_cent', 9999, 'trinkgeld_cent', 0, 'waehrung', 'EUR',
    'positionen', jsonb_build_array(
      jsonb_build_object('rohtext', 'FREMDER ARTIKEL', 'art', 'artikel', 'name', 'Fremder Artikel',
        'kategorie', 'produce', 'merkmale', jsonb_build_array(),
        'menge_basis', 1, 'menge_einheit', 'stk', 'einzelpreis_cent', 9999,
        'zeilensumme_cent', 9999, 'quelle', 'user')
    )
  ));

  perform set_config('request.jwt.claim.sub', '', false);
end
$$;
