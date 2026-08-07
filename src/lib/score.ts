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

/** Highest attainable score — a basket with nothing flagged. */
export const MAX_SCORE = 100

/**
 * How steeply trait load eats into the score. Weights run −10…+10, so one full
 * point of average load per euro costs ten score points: a basket averaging −10
 * lands at 0, one averaging −3 lands at 70.
 */
const POINTS_PER_WEIGHT = 10

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
  if (totalCents === 0) return MAX_SCORE

  const load =
    items.reduce((sum, item) => sum + itemScore(item, traits) * item.totalCents, 0) / totalCents

  const score = MAX_SCORE + load * POINTS_PER_WEIGHT
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
