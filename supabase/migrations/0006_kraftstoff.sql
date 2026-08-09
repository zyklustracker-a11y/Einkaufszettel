-- ============================================================================
-- Receipt AI — Schritt 7: Spritkosten
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0005 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- EIN TANKBELEG IST KEIN SONDERFALL
-- ---------------------------------------------------------------------------
--
-- Für die App ist er ein gewöhnlicher Bon mit einer Position: Menge in Litern,
-- Preis je Liter, Gesamtbetrag (KONZEPT-ERWEITERUNGEN.md, Abschnitt 4). Damit
-- greifen Bestpreis, Preisverlauf und Grundpreis **ohne zusätzlichen Bau** —
-- nach ein paar Tankfüllungen zeigt die App, welche Tankstelle günstiger ist.
--
-- Es fehlen genau zwei Dinge, und die stehen hier:
--
--   1. Die Kategorie `kraftstoff`. Sie ist Non-Food und bekommt eine Erklärung,
--      die in den Erkennungs-Prompt fließt.
--   2. Zwei Sichten für die eigene Auswertung in den Analysen.
--
-- Der Rest lag außerhalb des SQL: Der Struktur-Prompt hat ein Tankbeleg-Beispiel
-- bekommen, `lines.ts` liest jetzt „38,45 L à 1,779 EUR/L", und die
-- Plausibilitätsprüfung in `validate.ts` verwirft den Literpreis nicht mehr.
--
-- ---------------------------------------------------------------------------
-- WARUM HIER EIN KATEGORIESCHLÜSSEL IM CODE STEHT
-- ---------------------------------------------------------------------------
--
-- Bei „Auswärts essen" wurde das ausdrücklich vermieden: Dort entscheidet
-- `merchants.kind`, weil das der bessere Anker ist. Für Kraftstoff gibt es
-- keinen solchen Anker — eine Tankstelle verkauft Sprit **und** Kaffee, und der
-- Händler sagt deshalb nichts. Bleibt die Kategorie.
--
-- Das ist kein Bruch mit dem Grundsatz „Kategorien sind Daten": `kraftstoff` ist
-- eine **mitgelieferte** Kategorie mit festem Schlüssel, genau wie `dairy`, an
-- dem die Milch-Felder im Korrektur-Screen hängen. Der Anzeigename bleibt frei
-- änderbar, der Schlüssel nicht — und selbst angelegte Kategorien bleiben von
-- jedem Sonderverhalten unberührt.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Die Kategorie
--
-- Die Erklärung ist der eigentliche Inhalt: Sie geht bei jedem Scan an das
-- Modell und grenzt ab, was an einer Tankstelle Kraftstoff ist und was nicht.
-- Ohne sie landete die Autowäsche mit im selben Topf.
-- ============================================================================

create or replace function public.seed_fuel_category(p_household_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.categories
    (household_id, key, name, is_food, sort_order, color, description, is_default, active)
  values (
    p_household_id, 'kraftstoff', 'Kraftstoff', false, 10, '#4a90c2',
    'Sprit und Ladestrom fürs Auto: Benzin, Super, E10, Diesel, LPG, Autogas, AdBlue, Ladestrom. '
    || 'Nicht dazu gehört alles andere, was es an der Tankstelle gibt – Autowäsche, Motoröl, '
    || 'Scheibenwischer, Kaffee, Snacks.',
    true, true
  )
  on conflict (household_id, key) do nothing;
$$;

comment on function public.seed_fuel_category(uuid) is
  'Legt die mitgelieferte Kategorie „Kraftstoff" an, falls sie noch fehlt.';

revoke all on function public.seed_fuel_category(uuid) from public;

-- Alle bestehenden Haushalte nachziehen. `on conflict do nothing` heißt: Wer die
-- Kategorie schon selbst angelegt hat, behält seine — samt Farbe und Erklärung.
do $$
declare
  h record;
begin
  for h in select id from public.households loop
    perform public.seed_fuel_category(h.id);
  end loop;
end
$$;

/*
 * Und für jeden neuen Haushalt.
 *
 * `seed_household()` wird hier nicht neu geschrieben, sondern ruft die Funktion
 * oben zusätzlich auf. Die neunzig Zeilen Kategorien und Merkmale aus 0004 ein
 * zweites Mal abzutippen wäre die Sorte Verdopplung, die beim nächsten Mal
 * auseinanderläuft — und dann stünde in einem neuen Haushalt etwas anderes als
 * im alten.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid;
begin
  if exists (select 1 from public.household_members where user_id = new.id) then
    return new;
  end if;

  insert into public.households (name) values ('Haushalt') returning id into v_household;
  insert into public.household_members (household_id, user_id, role) values (v_household, new.id, 'owner');
  perform public.seed_household(v_household);
  perform public.seed_fuel_category(v_household);

  return new;
end;
$$;


-- ============================================================================
-- 2. Die Tankfüllungen
--
-- Eine Zeile je Position der Kategorie `kraftstoff`, für die eine Literzahl
-- dasteht. Ohne Menge gibt es keinen Literpreis, und ein Tankbeleg ohne
-- Literzahl ist für diese Auswertung nur eine Ausgabe wie jede andere — er zählt
-- in Non-Food und in die Monatssumme, aber nicht hier.
--
-- **`price_per_litre_cents` ist ein Verhältnis, kein Geldbetrag.** Es wird aus
-- Zeilensumme ÷ Litern gerechnet und trägt deshalb zwei Nachkommastellen: Sprit
-- ist in Zehntelcent ausgezeichnet, und `unit_price_cents` (ganze Cent) verlöre
-- genau diese Stelle. Der Grundsatz „Geld ist eine ganze Zahl in Cent" bleibt
-- davon unberührt — gespeichert wird nichts davon, gerechnet wird bei jedem
-- Aufruf neu, so wie beim Grundpreis auch.
--
-- Die Basiseinheit ist immer Milliliter, egal ob die Anzeigeeinheit `l` oder
-- `ml` heißt. Deshalb der Faktor 1000: Cent je 1000 ml sind Cent je Liter.
-- ============================================================================

create or replace view public.v_fuel_purchases
with (security_invoker = true) as
select
  i.household_id,
  i.item_id,
  i.receipt_id,
  i.purchased_on,
  i.month,
  i.merchant_id,
  i.product_name,
  i.quantity_base                                             as millilitres,
  i.total_cents,
  round(i.total_cents::numeric * 1000 / i.quantity_base, 2)    as price_per_litre_cents
from public.v_items i
where i.category_key = 'kraftstoff'
  and i.quantity_unit in ('l', 'ml')
  and i.quantity_base is not null
  and i.quantity_base > 0
  and i.total_cents > 0;


-- ============================================================================
-- 3. Je Monat
--
-- Was die Analysen zeigen: Kosten, Liter und der mittlere Literpreis — jeweils
-- über den ganzen Monat. Der Literpreis ist bewusst **nicht** der Durchschnitt
-- der einzelnen Literpreise, sondern Gesamtkosten ÷ Gesamtliter. Sonst zählte
-- eine Fünf-Liter-Notfüllung genauso viel wie eine volle Tankfüllung, und der
-- Monatswert sagte über die tatsächlich bezahlten Spritkosten nichts mehr aus.
--
-- „Verbrauch" heißt hier **Liter je Monat**, nicht Liter je 100 km: Auf einem
-- Tankbeleg steht kein Kilometerstand, und ihn zu erfragen wäre eine Eingabe,
-- die niemand zuverlässig macht. Was sich aus den Belegen ableiten lässt, steht
-- hier — mehr wird nicht behauptet.
-- ============================================================================

create or replace view public.v_fuel_months
with (security_invoker = true) as
select
  f.household_id,
  f.month,
  count(*)::int                                                     as fill_count,
  sum(f.total_cents)::bigint                                        as amount_cents,
  sum(f.millilitres)::bigint                                        as millilitres,
  round(sum(f.total_cents)::numeric * 1000 / sum(f.millilitres), 2) as price_per_litre_cents,
  min(f.purchased_on)                                               as first_on,
  max(f.purchased_on)                                               as last_on
from public.v_fuel_purchases f
group by f.household_id, f.month;


grant select on public.v_fuel_purchases  to authenticated;
grant select on public.v_fuel_months     to authenticated;

notify pgrst, 'reload schema';

commit;
