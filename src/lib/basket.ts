import type { BasketMerchant } from '../types'

/**
 * Wo lohnt sich der Einkauf — als ein Laden gedacht, nicht als zehn.
 *
 * Die Bestpreise beantworten „wo war dieses eine Produkt am günstigsten". Vor
 * der Haustür ist das die falsche Frage: Wer ihr Position für Position folgt,
 * fährt für zehn Einträge in vier Läden. Hier steht deshalb die andere Frage —
 * **in welchem einzelnen Laden wird dieser Zettel insgesamt am billigsten**,
 * und was brächte der Umweg über alle Läden.
 *
 * Gerechnet wird das in `v_shopping_basket_merchants`. Diese Datei entscheidet
 * nur, ob die Auskunft überhaupt eine ist, und ordnet sie.
 */

/**
 * Unter zwanzig Cent Unterschied ist der Umweg keiner.
 *
 * Dieselbe Schwelle wie beim Sparpotenzial (`0007_auswertungen.sql`): Darunter
 * ist es Rauschen — eine Rundung, ein Cent Preisanpassung, ein Pfandbon. Ein
 * Hinweis, der wegen zwölf Cent in den zweiten Laden schickt, wird nicht ernst
 * genommen, und das färbt auf die Hinweise ab, die stimmen.
 */
export const RELEVANT_DIFFERENCE_CENTS = 20

export interface StoreAdvice {
  /** Der Laden, in dem der ganze Zettel am günstigsten wird. */
  best: BasketMerchant
  /** Die übrigen Läden, aufsteigend nach Warenkorbsumme. */
  others: BasketMerchant[]
  /** Was der Zettel dort mehr kostet als der Weg über mehrere Läden. */
  extraCents: number
  /**
   * Ob sich dieser Umweg überhaupt lohnt: mehr als ein Laden im Optimum und
   * mehr als die Rauschschwelle Unterschied.
   */
  detourWorthMentioning: boolean
}

/**
 * Die Empfehlung — oder null, wenn es keine gibt.
 *
 * Zwei Bedingungen, und jede fängt eine Aussage ab, die sonst falsch wäre:
 *
 *   * **Mindestens zwei Läden.** Bei einem gibt es nichts zu wählen; „am
 *     günstigsten bei REWE" wäre dann nur die Feststellung, dass es REWE gibt.
 *   * **Mindestens zwei bepreiste Positionen.** Bei einer einzigen ist die
 *     Ladenempfehlung dasselbe wie der Bestpreis an der Zeile darunter, nur
 *     größer gesetzt.
 *
 * Bei Gleichstand gewinnt der Laden, der mehr Positionen führt: Zwei gleich
 * teure Warenkörbe sind nicht gleich gut, wenn man in dem einen die Hälfte
 * nicht bekommt.
 */
export function chooseStore(merchants: BasketMerchant[]): StoreAdvice | null {
  if (merchants.length < 2) return null

  const sorted = [...merchants].sort(
    (a, b) => a.basketTotalCents - b.basketTotalCents || b.coveredItems - a.coveredItems,
  )

  const best = sorted[0]
  if (best === undefined || best.pricedItems < 2) return null

  const extraCents = Math.max(0, best.basketTotalCents - best.optimumTotalCents)

  return {
    best,
    others: sorted.slice(1),
    extraCents,
    detourWorthMentioning:
      best.optimumMerchantCount > 1 && extraCents >= RELEVANT_DIFFERENCE_CENTS,
  }
}
