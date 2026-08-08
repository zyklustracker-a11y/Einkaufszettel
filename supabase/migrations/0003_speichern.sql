-- ============================================================================
-- Receipt AI — Schritt 4b-2: Speichern und Lernen
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 und 0002 gelaufen sind. Die
-- Datei läuft in einer Transaktion: Geht irgendetwas schief, wird nichts
-- angelegt.
--
-- Drei Dinge kommen hinzu:
--
--   1. `receipt_items.tax_code` — das Steuerkennzeichen der Zeile (A, B, …).
--      Es steht auf dem Bon, kostet vier Zeichen und wäre später nie zu
--      rekonstruieren, weil das Foto dann längst gelöscht ist.
--
--   2. `merchant_key()` — eine Normalform für Händlernamen, damit „REWE",
--      „Rewe" und „REWE CITY" ein Händler bleiben und nicht drei werden.
--
--   3. `save_receipt()` — schreibt einen ganzen Bon in EINEM Rutsch: Händler,
--      Bon, Positionen, kanonische Produkte samt Merkmalen und die gelernten
--      Zuordnungen. Eine Funktion ist hier kein Selbstzweck: Der Browser
--      bräuchte dafür sechs bis zehn einzelne Anfragen, und bräche eine davon
--      ab, bliebe ein halber Bon zurück. In der Funktion ist alles eine einzige
--      Transaktion — entweder steht der Bon vollständig da oder gar nicht.
--
-- Die Funktion läuft mit den Rechten des **Aufrufers** (kein SECURITY DEFINER).
-- Damit gelten dieselben Zugriffsregeln wie in der App: Sie kann gar nichts in
-- einen fremden Haushalt schreiben, und das verhindert die Datenbank, nicht der
-- Code.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Das Steuerkennzeichen an der Position
--
-- Dieselbe Form wie in `toTaxCode` der Edge Function: ein bis zwei Buchstaben
-- oder Ziffern. Null heißt „stand nicht auf dem Bon" — ein echter Zustand.
-- ============================================================================

alter table public.receipt_items
  add column if not exists tax_code text;

alter table public.receipt_items
  drop constraint if exists receipt_items_tax_code_form;

alter table public.receipt_items
  add constraint receipt_items_tax_code_form
  check (tax_code is null or tax_code ~ '^[A-Z0-9]{1,2}$');


-- ============================================================================
-- 2. Händler zusammenführen statt verdoppeln
--
-- Der eindeutige Index aus 0001 fängt nur die Groß-/Kleinschreibung ab
-- („Rewe" = „REWE"). Auf dem Bon steht aber auch mal die Filiale mit im Namen:
-- „REWE CITY", „EDEKA NEUKAUF", „REWE MARKT GMBH". Drei Einträge für denselben
-- Laden machen jeden Preisvergleich wertlos.
--
-- Die Normalform macht zwei Schritte, und beide sind bewusst zurückhaltend:
--
--   * Kleinschreiben, alles außer Buchstaben und Ziffern zu Leerzeichen, und
--     angehängte Rechtsformen (GmbH, KG, AG …) entfernen.
--   * Beginnt der Name mit einer bekannten Kette, IST die Kette der Schlüssel —
--     der Rest ist Filialbezeichnung.
--
-- Warum nicht einfach immer das erste Wort? Weil „Bio Company" dann zu „Bio"
-- würde und mit jedem anderen Bioladen zusammenfiele. Bei einem unbekannten
-- Namen bleibt deshalb der ganze Name stehen: lieber zwei Einträge zu viel als
-- zwei Läden, die zu einem verschmelzen und deren Preise sich vermischen.
--
-- Die Liste ist erweiterbar — wer einen Laden vermisst, trägt ihn hier ein und
-- führt die Datei erneut aus (`create or replace`).
-- ============================================================================

create or replace function public.merchant_key(p_name text)
returns text
language sql
immutable
as $$
  select case
    when split_part(c.name, ' ', 1) = any (array[
      'rewe', 'edeka', 'aldi', 'lidl', 'penny', 'netto', 'kaufland', 'norma',
      'real', 'marktkauf', 'nahkauf', 'famila', 'combi', 'globus', 'tegut',
      -- Kleingeschrieben und ohne Umlaute, so wie die Normalform sie liefert.
      'dm', 'rossmann', 'muller', 'budni', 'denns', 'alnatura',
      'migros', 'coop', 'denner', 'volg', 'spar', 'billa', 'hofer',
      'merkur', 'metro', 'selgros'
    ]) then split_part(c.name, ' ', 1)
    else c.name
  end
  from (
    select btrim(regexp_replace(n.name, '( (gmbh|mbh|ag|kg|ohg|co|se|ek))+$', '')) as name
    from (
      -- Umlaute werden ausdrücklich übersetzt und nicht `lower()` überlassen:
      -- Was `lower('Ü')` ergibt, hängt von der Spracheinstellung der Datenbank
      -- ab. „MÜLLER" und „Müller" müssen aber denselben Schlüssel ergeben,
      -- egal auf welchem Server.
      select btrim(regexp_replace(
               regexp_replace(
                 lower(translate(coalesce(p_name, ''), 'ÄÖÜäöüß', 'aouaous')),
                 '[^a-z0-9]+', ' ', 'g'),
               ' +', ' ', 'g')) as name
    ) n
  ) c
$$;

comment on function public.merchant_key(text) is
  'Normalform eines Händlernamens: „REWE CITY" und „Rewe" ergeben beide „rewe".';

revoke all on function public.merchant_key(text) from public;
grant execute on function public.merchant_key(text) to authenticated;


-- ============================================================================
-- 3. Einen ganzen Bon speichern
--
-- Erwartet wird ein JSON-Objekt in genau dieser Form (Beträge in ganzen Cent,
-- Mengen in ganzen Basiseinheiten — Gramm, Milliliter, Stück):
--
--   {
--     "haendler": "REWE CITY",
--     "gekauft_am": "2026-08-14",
--     "summe_cent": 4217,
--     "positionen": [
--       {
--         "rohtext": "G&G H-MILCH 1,5%",
--         "art": "artikel",                  -- artikel | pfand | rabatt
--         "name": "H-Milch 1,5 % Fett",
--         "kategorie": "dairy",              -- null: kein Produkt, keine Lernzeile
--         "merkmale": ["milch"],
--         "milch_erhitzung": "uht",
--         "milch_homogenisiert": "unbekannt",
--         "menge_basis": 2, "menge_einheit": "stk",
--         "einzelpreis_cent": 129,
--         "zeilensumme_cent": 258,
--         "pfand_cent": 0, "rabatt_cent": 0,
--         "steuer": "B",
--         "quelle": "user",                  -- user = vom Nutzer korrigiert
--         "produkt_id": null                 -- bekannter Rohtext: das Produkt
--       }
--     ]
--   }
--
-- Zurück kommt die id des Bons.
--
-- Die drei Regeln, die den Lernkreis ausmachen:
--
--   * **Ein Klarname, ein Produkt.** Gibt es den Namen schon, wird darauf
--     verwiesen statt ein zweites Mal angelegt.
--   * **Nutzerkorrekturen schreiben durch.** Kategorie, Merkmale und
--     Milch-Eigenschaften eines vorhandenen Produkts werden nur überschrieben,
--     wenn `quelle` = `user` ist. Ein Modellvorschlag fasst vorhandenes Wissen
--     nie an — die Datenbank weiß es besser als das Modell.
--   * **Ein Rohtext, eine Zuordnung.** `product_mappings` bekommt je Position
--     eine Zeile. Eine bestehende `user`-Zuordnung wird dabei nie auf `model`
--     zurückgestuft; das ist die Zusicherung „einmal korrigiert, bleibt
--     korrigiert".
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
  v_pos         jsonb;
  v_line        integer := 0;
  v_kind        text;
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
  if v_merchant_nm <> '' then
    select m.id into v_merchant
    from public.merchants m
    where m.household_id = v_household
      and public.merchant_key(m.name) = public.merchant_key(v_merchant_nm)
    -- Bei mehreren Treffern (aus der Zeit vor dieser Migration) gewinnt der
    -- älteste: an ihm hängt die längere Preishistorie.
    order by m.created_at
    limit 1;

    if v_merchant is null then
      insert into public.merchants (household_id, name)
      values (v_household, v_merchant_nm)
      returning id into v_merchant;
    end if;
  end if;

  /* ----------------------------------------------------------------- Bon */

  insert into public.receipts (
    household_id, merchant_id, purchased_on, status, printed_total_cents, image_path, note
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
    nullif(btrim(coalesce(p_payload->>'notiz', '')), '')
  )
  returning id into v_receipt;

  /* ---------------------------------------------------------- Positionen */

  for v_pos in
    select value from jsonb_array_elements(coalesce(p_payload->'positionen', '[]'::jsonb))
  loop
    -- Durchnummeriert wird hier und nicht nach der Vorlage: (receipt_id,
    -- line_no) ist eindeutig, und eine doppelte Nummer im JSON würde das
    -- Speichern sonst mitten im Bon scheitern lassen.
    v_line := v_line + 1;

    v_kind := case when v_pos->>'art' in ('pfand', 'rabatt') then v_pos->>'art' else 'artikel' end;
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

    -- Menge und Einheit gehören zusammen: fehlt eines, gilt „ohne Mengenangabe".
    v_qty_base := nullif(v_pos->>'menge_basis', '')::integer;
    v_qty_unit := nullif(btrim(coalesce(v_pos->>'menge_einheit', '')), '');
    if v_qty_base is null or v_qty_base <= 0
       or v_qty_unit is null or v_qty_unit not in ('kg', 'g', 'l', 'ml', 'stk') then
      v_qty_base := null;
      v_qty_unit := null;
    end if;

    /*
     * Was zu diesem Rohtext schon gelernt wurde.
     *
     * Normalerweise hat die Edge Function das bereits eingesetzt, und der
     * Browser schickt `produkt_id` mit. Nachgesehen wird trotzdem: Die
     * Zusicherung „eine Nutzerkorrektur gilt dauerhaft" soll an der Datenbank
     * hängen und nicht daran, dass der Client sich richtig verhält.
     */
    v_known_id := null;
    v_known_src := null;
    if v_kind = 'artikel' and v_raw <> '' then
      select pm.canonical_product_id, pm.source into v_known_id, v_known_src
      from public.product_mappings pm
      where pm.household_id = v_household
        and lower(btrim(pm.raw_text)) = lower(v_raw)
      limit 1;
    end if;

    /*
     * Das kanonische Produkt. Ohne Kategorie entsteht keines: `category_key`
     * ist Pflicht, und einen Wert zu raten ist auch dem Code verboten
     * (PROJEKT.md). Die Position wird dann ohne Produktzuordnung gespeichert —
     * ein Zustand, den das Schema ausdrücklich vorsieht.
     */
    if v_kind = 'artikel' and v_known_src = 'user' and v_source = 'model' then
      -- Hier hat der Nutzer schon einmal entschieden. Ein Modellvorschlag legt
      -- daneben kein zweites Produkt an und ändert auch nichts am vorhandenen.
      v_product := v_known_id;
      -- Der gelernte Name gilt auch für die Position. `coalesce`, damit ein
      -- fehlender Datensatz die Zeile nicht namenlos macht.
      select coalesce(cp.name, v_name) into v_name
      from public.canonical_products cp
      where cp.id = v_product and cp.household_id = v_household;
      if v_name is null or btrim(v_name) = '' then
        v_name := coalesce(nullif(btrim(coalesce(v_pos->>'name', '')), ''), v_raw);
      end if;

    elsif v_kind = 'artikel' and v_category is not null then
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
        -- Nur die Korrektur des Nutzers schreibt durch, und sie gilt rückwirkend
        -- für alle Käufe dieses Produkts (PROJEKT.md).
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

    /*
     * Die gelernte Zuordnung: Rohtext vom Bon → kanonisches Produkt.
     *
     * Nur mit echtem Rohtext — eine von Hand ergänzte Position hat keinen, und
     * ein selbst getippter Name ist nichts, was auf dem Bon stand.
     *
     * Das WHERE am Ende ist die Zusicherung aus PROJEKT.md: Eine einmal vom
     * Nutzer gesetzte Zuordnung wird von einem späteren Modellvorschlag nicht
     * mehr angefasst.
     */
    if v_kind = 'artikel' and v_product is not null and v_raw <> '' then
      insert into public.product_mappings (household_id, raw_text, canonical_product_id, source)
      values (v_household, v_raw, v_product, v_source)
      on conflict (household_id, lower(btrim(raw_text)))
      do update set canonical_product_id = excluded.canonical_product_id,
                    source               = excluded.source
      where product_mappings.source <> 'user' or excluded.source = 'user';
    end if;
  end loop;

  return v_receipt;
end;
$$;

comment on function public.save_receipt(jsonb) is
  'Speichert einen geprüften Bon vollständig oder gar nicht: Händler, Bon, '
  'Positionen, kanonische Produkte und die gelernten Zuordnungen.';

revoke all on function public.save_receipt(jsonb) from public;
grant execute on function public.save_receipt(jsonb) to authenticated;

-- Sagt der Schnittstelle Bescheid, dass es eine neue Funktion gibt. Ohne das
-- kann es einen Moment dauern, bis die App sie aufrufen kann — und in der
-- Zwischenzeit meldete sie „Speicher-Funktion fehlt", obwohl sie längst da ist.
notify pgrst, 'reload schema';

commit;
