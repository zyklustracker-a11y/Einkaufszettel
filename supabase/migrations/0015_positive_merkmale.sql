-- ============================================================================
-- Receipt AI — Schritt 18: zwei positive Merkmale
--
-- Ausführen im SQL-Editor, nach 0014. Läuft in einer Transaktion und ist
-- mehrfach ausführbar.
--
-- ---------------------------------------------------------------------------
-- WARUM
-- ---------------------------------------------------------------------------
--
-- Der Score hatte genau **ein** positives Merkmal: `roh` (+2), und das trägt nur
-- Rohmilch. Alles andere kann den Score bestenfalls nicht senken. Die Folge ist
-- beim Durchrechnen der Beispielkörbe aufgefallen (`npm run score:beispiele`):
-- Wer frisch einkauft, landet immer bei 95–100, weil unbelastete Ware schlicht
-- kein Merkmal trägt. Die obere Hälfte der Skala unterscheidet damit nichts.
--
-- Das ist keine Frage der Steilheit (`POINTS_PER_WEIGHT` bleibt bei 10), sondern
-- eine Frage fehlender Gegengewichte. Zwei kommen hier dazu:
--
--     bio        +1   „Gut"
--     vollkorn   +1   „Gut"
--
-- **Beide sind auf einem Kassenzettel wirklich ablesbar.** Das war das
-- Auswahlkriterium und hat andere Kandidaten ausgeschlossen: „Regional" oder
-- „Saisonal" stehen dort nie, und ein Merkmal, das das Modell raten müsste,
-- wäre schlimmer als keines (PROJEKT.md: „Nicht raten lassen"). Deshalb sagen
-- beide Erklärungen ausdrücklich, dass das Wort auf dem Bon stehen muss.
--
-- **Beide sind ohne Gruppe.** In einer Gruppe zählte im Score nur das Merkmal
-- mit dem größten Betrag — ein Vollkorn-Weizenbrot bekäme dann `weizen` (−3)
-- und der Pluspunkt verfiele. Ungruppiert zählen sie eigenständig: Das
-- Vollkorn-Weizenbrot steht bei −2 und damit besser als das Weißmehlbrot,
-- schlechter als Buchweizen. Genau das ist gemeint. Dieselbe Überlegung wie bei
-- `homogenisiert`, das aus demselben Grund außerhalb von `milch_basis` steht.
--
-- **Rückwirkend ändert sich nichts.** Merkmale hängen am kanonischen Produkt,
-- und kein bestehendes Produkt trägt die beiden neuen. Der Score der Vergangen-
-- heit bleibt also, wie er war; die Merkmale wirken ab dem nächsten Scan — und
-- an bestehenden Produkten, sobald man sie dort anhakt.
-- ============================================================================

begin;

create or replace function public.seed_positive_traits(p_household_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.traits
    (household_id, key, label, short, trait_group, weight, active, sort_order,
     description, tip, is_default)
  values
    (p_household_id, 'bio', 'Bio', 'B', null, 1, true, 15,
     'Zertifizierte Bio-Ware. Nur vergeben, wenn es auf dem Bon steht – als „Bio", '
     || '„Öko", „Demeter", „Bioland" oder „Naturland". Aus dem Produkt selbst darf '
     || 'nicht auf Bio geschlossen werden.',
     'Bio ist ein Pluspunkt, kein Freibrief – eine Bio-Fertigpizza bleibt eine Fertigpizza.',
     true),
    (p_household_id, 'vollkorn', 'Vollkorn', 'VK', null, 1, true, 16,
     'Vollkorn-Getreide: Das Wort „Vollkorn" steht im Artikelnamen, etwa '
     || '„Vollkornbrot", „Vollkornnudeln", „Vollkornmehl". Nicht bei „Mehrkorn", '
     || '„Körner", „Kraftkorn" oder „dunkel" – die sagen nichts über den Ausmahlungsgrad.',
     'Vollkorn statt Auszugsmehl ist die kleinste Umstellung mit der größten Wirkung.',
     true)
  on conflict (household_id, key) do nothing;
$$;

comment on function public.seed_positive_traits(uuid) is
  'Legt die mitgelieferten Merkmale „Bio" und „Vollkorn" an, falls sie fehlen.';

revoke all on function public.seed_positive_traits(uuid) from public;

-- Bestehende Haushalte nachziehen. `on conflict do nothing` heißt: Wer eines der
-- beiden schon selbst angelegt hat, behält seines – samt Gewicht und Erklärung.
do $$
declare
  h record;
begin
  for h in select id from public.households loop
    perform public.seed_positive_traits(h.id);
  end loop;
end
$$;

/*
 * Und für jeden neuen Haushalt. `seed_household()` wird auch hier nicht neu
 * geschrieben, sondern ergänzt — dieselbe Linie wie bei `seed_fuel_category()`
 * in 0006. Die neunzig Zeilen aus 0004 ein zweites Mal abzutippen wäre die Sorte
 * Verdopplung, die auseinanderläuft.
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
  perform public.seed_positive_traits(v_household);

  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
