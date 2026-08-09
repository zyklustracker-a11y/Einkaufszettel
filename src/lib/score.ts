import type { Category, MilkHeat, Receipt, ReceiptItem, Trait, TraitId } from '../types'

/**
 * The health score and everything the trait breakdown needs.
 *
 * A formula, never a model judgement (PROJEKT.md). Deliberately free of runtime
 * imports so the tests next door run straight on `node --test`.
 */

/** Which trait a heating level stands for. `unbekannt` stands for none. */
const MILK_HEAT_TRAIT: Record<MilkHeat, TraitId | null> = {
  roh: 'roh',
  pasteurisiert: 'pasteurisiert',
  esl: 'esl',
  uht: 'uht',
  unbekannt: null,
}

const HOMOGENISED_TRAIT: TraitId = 'homogenisiert'

/** Obere Grenze der Skala. Erreichbar, aber nicht der Normalfall — siehe unten. */
export const MAX_SCORE = 100

/**
 * Der Score eines Korbs, in dem **nichts** auffällt: kein negatives Merkmal,
 * aber auch kein positives.
 *
 * ---------------------------------------------------------------------------
 * WARUM DAS NICHT 100 IST
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 18 war es 100, und damit war die obere Hälfte der Skala tot: Wer
 * frisch einkauft, trägt schlicht keine Merkmale und stand deshalb immer bei
 * 95–100. Zwischen „ordentlich" und „richtig gut" konnte der Score nicht
 * unterscheiden — dazwischen lagen zwei Punkte.
 *
 * Positive Merkmale allein reparieren das **nicht**. Das war die Annahme in der
 * Prüfung, und sie war falsch: Solange ein leerer Korb schon oben steht, kann
 * ein Pluspunkt nichts mehr gutschreiben, er läuft gegen die Decke. Erst ein
 * neutraler Punkt **unterhalb** der Decke gibt ihm Platz.
 *
 * 92 ist so gewählt, dass acht Punkte Luft nach oben bleiben — genug, um einen
 * durchgehend biologischen Einkauf von einem gewöhnlichen zu unterscheiden, und
 * wenig genug, dass ein unbelasteter Korb weiterhin als sehr gut dasteht.
 *
 * **Das verschiebt die Vergangenheit.** Der Score ist nirgends gespeichert, also
 * zieht die ganze Verlaufskurve mit: Ein Monat, der bisher 98 zeigte, zeigt
 * jetzt 90. Es ist dieselbe Aussage auf einer Skala, die oben wieder etwas
 * aussagt — die Reihenfolge der Monate untereinander ändert sich nicht.
 *
 * Durchgerechnet (`npm run score:beispiele`):
 *
 *     Frischware              −0,20  →  90
 *     Frischware mit Bio      +0,62  →  98
 *     gemischt                −2,31  →  69
 *     Fertigware              −5,67  →  35
 */
export const NEUTRAL_SCORE = 92

/**
 * ---------------------------------------------------------------------------
 * DIE EINZIGE STELLSCHRAUBE DER SKALA
 * ---------------------------------------------------------------------------
 *
 * Wie steil die Merkmalslast in den Score schneidet: **Ein Punkt
 * durchschnittlicher Last je Euro kostet zehn Score-Punkte.**
 *
 *     Score = NEUTRAL_SCORE + 10 × (euro-gewichtete Durchschnittslast), gekappt auf 0…100
 *
 * Diese Zahl ist gesetzt und nicht gemessen — als die Formel entstand, gab es
 * keine echten Einkäufe, an denen sich etwas hätte eichen lassen. Sie ist
 * bewusst die **einzige** Konstante der Umrechnung und steht **nur hier**: In
 * SQL wird der Score nirgends gerechnet (`v_score_items` liefert ausschließlich
 * die Zutaten), und die Screens zeigen nur das Ergebnis. Wer die Skala
 * verschieben will, ändert diese eine Zeile — rückwirkend für die ganze
 * Historie, weil kein Score gespeichert ist.
 *
 * **Größenordnung.** `load` ist nicht das Gewicht eines einzelnen Merkmals,
 * sondern die Summe der (gruppenbereinigten) Gewichte einer Position, gemittelt
 * über den Euro-Anteil aller Lebensmittel-Positionen. Ein Fertiggericht trägt
 * leicht vier Merkmale und kommt damit auf −8 bis −9; ein Korb, der zur Hälfte
 * aus solchen Positionen besteht, landet bei rund −4. Ein Korb aus reiner
 * Frischware trägt fast keine Merkmale und liegt bei 0.
 *
 * **Was das praktisch heißt** — Wocheneinkäufe von je rund 50 €, durchgerechnet
 * in `scripts/score-beispiele.ts` (`npm run score:beispiele`):
 *
 *     Frischware          Durchschnittslast −0,20   →   90
 *     Frischware mit Bio  Durchschnittslast +0,62   →   98
 *     gemischt            Durchschnittslast −2,31   →   69
 *     Fertigware          Durchschnittslast −5,67   →   35
 *
 * Die Spreizung stimmt: Der Score verdünnt sich nicht über viele Positionen zu
 * einem Einheitsbrei, und seit Schritt 18 unterscheidet auch das obere Ende
 * wieder — dafür sorgen `NEUTRAL_SCORE` und die beiden positiven Merkmale.
 *
 * Wirkt die Spreizung zu hart oder zu weich, ist **10** die Zahl, an der man
 * dreht: 8 zieht zusammen (Fertigware 47), 12 spreizt auf (Fertigware 24). Nach
 * der Änderung das Skript erneut laufen lassen — es liest die Konstante hier.
 */
export const POINTS_PER_WEIGHT = 10

/**
 * Every trait id that applies to an item: the ones tagged directly plus the two
 * dairy attributes. `unbekannt` contributes nothing and therefore counts
 * neutral, never negative.
 */
export function itemTraitIds(item: ReceiptItem): TraitId[] {
  const ids = [...item.traitIds]

  const heat = item.milkHeat ? MILK_HEAT_TRAIT[item.milkHeat] : null
  if (heat) ids.push(heat)
  if (item.milkHomogenized === 'ja') ids.push(HOMOGENISED_TRAIT)

  // An item may carry `milch` and be UHT; both resolve to the same id only in
  // odd data, but de-duplicating keeps a stray double tag from counting twice.
  return [...new Set(ids)]
}

/**
 * The active traits behind those ids. Ids the household does not know are
 * dropped rather than guessed at, so stale tags cannot skew a score.
 */
export function itemTraits(item: ReceiptItem, traits: Trait[]): Trait[] {
  const byId = new Map(traits.map((trait) => [trait.id, trait]))
  return itemTraitIds(item)
    .map((id) => byId.get(id))
    .filter((trait): trait is Trait => trait !== undefined && trait.active)
}

/** Within a group: larger magnitude wins, ties go to the more negative trait. */
function beats(candidate: Trait, current: Trait): boolean {
  const a = Math.abs(candidate.weight)
  const b = Math.abs(current.weight)
  if (a !== b) return a > b
  return candidate.weight < current.weight
}

/**
 * Score contribution of a set of traits, applying the group rule: inside a
 * group only one trait counts, so a wheat sourdough is not charged for both
 * `weizen` and `gluten`. Ungrouped traits always count on their own.
 *
 * Magnitude decides, not the lowest value — otherwise the neutral `milch` (0)
 * would crowd out `roh` (+2) and raw milk would stop earning its credit.
 */
export function traitScore(applied: Trait[]): number {
  const perGroup = new Map<string, Trait>()
  let score = 0

  for (const trait of applied) {
    if (trait.group === undefined) {
      score += trait.weight
      continue
    }
    const current = perGroup.get(trait.group)
    if (current === undefined || beats(trait, current)) perGroup.set(trait.group, trait)
  }

  for (const trait of perGroup.values()) score += trait.weight
  return score
}

export function itemScore(item: ReceiptItem, traits: Trait[]): number {
  return traitScore(itemTraits(item, traits))
}

/**
 * The 0–100 score for a set of positions, weighted by their **euro share** and
 * not by their number: a 12 € ready meal has to outweigh a 1,49 € pack of rolls.
 *
 * Pass food positions only — a washing-up liquid says nothing about how the
 * household eats.
 */
export function healthScore(items: ReceiptItem[], traits: Trait[]): number {
  const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0)
  // Nichts erfasst heißt nichts aufgefallen — also der neutrale Punkt und nicht
  // die Bestnote. Ein leerer Korb hat sich keine 100 verdient.
  if (totalCents === 0) return NEUTRAL_SCORE

  const load =
    items.reduce((sum, item) => sum + itemScore(item, traits) * item.totalCents, 0) / totalCents

  const score = NEUTRAL_SCORE + load * POINTS_PER_WEIGHT
  return Math.max(0, Math.min(MAX_SCORE, Math.round(score)))
}

/**
 * Every food position across the receipts. Non-food is left out on purpose: a
 * washing-up liquid says nothing about how the household eats.
 */
export function foodItems(receipts: Receipt[], categories: Category[]): ReceiptItem[] {
  const isFood = new Set(categories.filter((c) => c.isFood).map((c) => c.id))
  return receipts.flatMap((receipt) => receipt.items).filter((item) => isFood.has(item.categoryId))
}

export interface TraitSpending {
  trait: Trait
  amountCents: number
  itemCount: number
}

/**
 * Spend per trait, biggest first.
 *
 * Every applicable trait counts here, including ones the group rule suppresses
 * in the score — "how much do I spend on gluten" has to add up regardless of
 * whether `weizen` outranked it (PROJEKT.md).
 */
export function traitSpending(items: ReceiptItem[], traits: Trait[]): TraitSpending[] {
  const rows = new Map<TraitId, TraitSpending>(
    traits.map((trait) => [trait.id, { trait, amountCents: 0, itemCount: 0 }]),
  )

  for (const item of items) {
    for (const trait of itemTraits(item, traits)) {
      const row = rows.get(trait.id)
      if (!row) continue
      row.amountCents += item.totalCents
      row.itemCount += 1
    }
  }

  return [...rows.values()]
    .filter((row) => row.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
}
