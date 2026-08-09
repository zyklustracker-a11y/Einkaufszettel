-- ============================================================================
-- Receipt AI — Schritt 10: Merkmale selbst anlegen und gewichten
--
-- Ausführen im Supabase SQL-Editor, nachdem 0001 bis 0008 gelaufen sind. Die
-- Datei läuft in einer Transaktion und ist **mehrfach ausführbar**.
--
-- ---------------------------------------------------------------------------
-- WARUM DAS DIE KÜRZESTE MIGRATION IST
-- ---------------------------------------------------------------------------
--
-- Am Schema ändert sich **nichts**. Merkmale sind seit Schritt 2a Daten und
-- keine Aufzählung im Code (PROJEKT.md: „Merkmale sind Daten, nicht Code"), und
-- `traits` trägt alle Felder, die die Verwaltung braucht: `label`, `short`,
-- `description`, `weight`, `trait_group`, `tip`, `active`, `sort_order`. Die
-- Zugriffsregel erlaubt dem Haushalt seit jeher auch Schreiben. Es fehlte
-- ausschließlich die Bedienoberfläche.
--
-- Was hier dazukommt, ist eine einzige Sicht: Wie viele Produkte an einem
-- Merkmal hängen. Sie steht beim Abschalten daneben — dieselbe Frage wie bei den
-- Kategorien, und dieselbe Antwort: erst zeigen, wovon die Rede ist.
--
-- ---------------------------------------------------------------------------
-- SCORE-ÄNDERUNGEN WIRKEN RÜCKWIRKEND — OHNE ZUTUN
-- ---------------------------------------------------------------------------
--
-- „Ändert der Nutzer ein Gewicht, werden die Scores rückwirkend neu berechnet"
-- (PROJEKT.md). Dafür ist nichts zu tun: Der Score ist **nirgends gespeichert**.
-- `v_score_items` liefert nur die Zutaten (Positionsbetrag und
-- Merkmalsschlüssel), gerechnet wird in `src/lib/score.ts` bei jeder Anzeige neu
-- — mit den Gewichten, die in diesem Moment in `traits` stehen. Eine
-- Neuberechnung anzustoßen gibt es hier deshalb nicht; sie wäre eine Antwort auf
-- ein Problem, das die Architektur nicht hat.
-- ============================================================================

begin;

-- ============================================================================
-- Wie viele Produkte hängen an einem Merkmal?
--
-- Gezählt werden **nur die angehakten** Merkmale aus
-- `canonical_product_traits`. Die abgeleiteten (`roh`, `pasteurisiert`, `esl`,
-- `uht`, `homogenisiert`) stehen dort bewusst nicht — sie entstehen aus
-- `milk_heat` und `milk_homogenized` (PROJEKT.md). Für sie kommt hier eine 0
-- heraus, und das ist die richtige Zahl: Sie hängen an keinem Produkt, sondern
-- an einem Sachattribut.
--
-- Ausgegangen wird von `traits` und nicht von der Verknüpfungstabelle, damit
-- jedes Merkmal eine Zeile bekommt — auch ein frisch angelegtes.
-- ============================================================================

create or replace view public.v_trait_product_counts
with (security_invoker = true) as
select
  t.household_id,
  t.key                     as trait_key,
  count(cpt.canonical_product_id)::int as product_count
from public.traits t
left join public.canonical_product_traits cpt
  on cpt.household_id = t.household_id and cpt.trait_id = t.id
group by t.household_id, t.key;

grant select on public.v_trait_product_counts to authenticated;

notify pgrst, 'reload schema';

commit;
