-- ============================================================================
-- Receipt AI — Schritt 16: Gewichte als benannte Stufen
--
-- Ausführen im SQL-Editor. Die Datei läuft in einer Transaktion und ist
-- mehrfach ausführbar.
--
-- ---------------------------------------------------------------------------
-- WORUM ES GEHT
-- ---------------------------------------------------------------------------
--
-- `traits.weight` durfte bisher von −10 bis +10 laufen. Die Spanne war zu breit:
-- Niemand kann begründen, warum ein Merkmal −7 statt −6 sein sollte, und die
-- vierzehn mitgelieferten Merkmale benutzen ohnehin nur −3 bis +2. Zwanzig
-- Stufen anzubieten, von denen sechs gebraucht werden, ist keine Freiheit,
-- sondern eine Frage ohne Antwort.
--
-- Die Bedienung wählt ab jetzt aus sechs benannten Stufen:
--
--     Sehr gut            +2
--     Gut                 +1
--     Neutral              0
--     Leicht ungünstig    −1
--     Ungünstig           −2
--     Stark ungünstig     −3
--
-- **Gespeichert wird weiterhin die Zahl.** Die Stufen sind ihr Name und nichts
-- weiter; `src/lib/score.ts` rechnet unverändert mit dem Zahlenwert, und die
-- Namen stehen in `src/lib/weights.ts`. Es gibt deshalb auch keine Umrechnung:
-- Die sechs Werte sind genau die, die vorher schon in der Tabelle standen.
--
-- ---------------------------------------------------------------------------
-- WAS DIESE DATEI TUT
-- ---------------------------------------------------------------------------
--
--   1. Bestehende Werte außerhalb von −3…+2 auf die nächste gültige Stufe
--      ziehen. Betroffen können nur **selbst angelegte** Merkmale sein — alle
--      mitgelieferten liegen längst im neuen Bereich. Gekappt statt skaliert:
--      Ein Merkmal, das jemand auf −7 gestellt hat, meinte „so schlimm wie es
--      geht", und das ist jetzt −3. Eine anteilige Umrechnung erfände dagegen
--      eine Genauigkeit, die die Zahl nie hatte.
--   2. Die alte Prüfregel gegen die neue tauschen.
--
-- **Der Score ändert sich dadurch nur für Haushalte, die tatsächlich einen Wert
-- außerhalb der sechs Stufen gesetzt hatten.** Er ist nirgends gespeichert und
-- wird bei jeder Anzeige neu gerechnet, die Verlaufskurve zieht also sofort
-- nach. Für die mitgelieferten Merkmale ändert sich nichts, auch nicht
-- rückwirkend.
-- ============================================================================

begin;

/* ------------------------------------------------ 1. Werte auf die Stufen */

update public.traits
   set weight = greatest(-3, least(2, weight))
 where weight < -3
    or weight > 2;

/* ------------------------------------------------------ 2. Prüfregel neu */

/*
 * Die alte Regel stand in `0001_initial.sql` als `check` direkt an der Spalte
 * und trägt deshalb einen von Postgres vergebenen Namen (`traits_weight_check`).
 * Statt ihn zu raten, wird jede Check-Bedingung dieser Tabelle gelöst, die von
 * `weight` handelt — das trifft die alte ebenso wie die neue und macht die Datei
 * damit mehrfach ausführbar.
 */
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.traits'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%weight%'
  loop
    execute format('alter table public.traits drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.traits
  add constraint traits_weight_stufen check (weight between -3 and 2);

comment on column public.traits.weight is
  'Gewicht im Gesundheits-Score, −3…+2. Sechs benannte Stufen: +2 Sehr gut, '
  '+1 Gut, 0 Neutral, −1 Leicht ungünstig, −2 Ungünstig, −3 Stark ungünstig. '
  'Die Namen stehen in src/lib/weights.ts, gerechnet wird mit der Zahl.';

notify pgrst, 'reload schema';

commit;
