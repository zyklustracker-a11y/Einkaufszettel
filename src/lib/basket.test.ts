import test from 'node:test'
import assert from 'node:assert/strict'
import { RELEVANT_DIFFERENCE_CENTS, chooseStore } from './basket.ts'
import type { BasketMerchant } from '../types.ts'

/**
 * Die Ladenwahl.
 *
 * Der Fall, um den es geht, steht in den SQL-Prüfungen von Hand nachgerechnet:
 * Milch ist bei ALDI SÜD günstiger, Bananen bei REWE, Grillkohle gibt es nur
 * bei REWE — und trotzdem ist REWE die richtige Antwort, weil der **ganze
 * Zettel** dort billiger wird. Hier wird gesichert, dass die Auswahl davor
 * nicht doch wieder auf den günstigsten Einzelpreis hereinfällt, und dass sie
 * schweigt, wo sie nichts zu sagen hat.
 */

function laden(overrides: Partial<BasketMerchant> & { merchantId: string }): BasketMerchant {
  return {
    coveredItems: 3,
    missingItems: 0,
    basketTotalCents: 0,
    optimumTotalCents: 0,
    optimumMerchantCount: 1,
    pricedItems: 3,
    ...overrides,
  }
}

test('empfiehlt den Laden mit dem günstigsten Warenkorb, nicht den mit dem günstigsten Einzelpreis', () => {
  const advice = chooseStore([
    laden({ merchantId: 'aldi', basketTotalCents: 837, coveredItems: 2, missingItems: 1,
      optimumTotalCents: 817, optimumMerchantCount: 2 }),
    laden({ merchantId: 'rewe', basketTotalCents: 827,
      optimumTotalCents: 817, optimumMerchantCount: 2 }),
  ])

  assert.ok(advice)
  assert.equal(advice.best.merchantId, 'rewe')
  assert.equal(advice.others.length, 1)
  assert.equal(advice.others[0]?.merchantId, 'aldi')
  assert.equal(advice.extraCents, 10)
})

test('zehn Cent Umweg sind keiner', () => {
  const advice = chooseStore([
    laden({ merchantId: 'rewe', basketTotalCents: 827, optimumTotalCents: 817, optimumMerchantCount: 2 }),
    laden({ merchantId: 'aldi', basketTotalCents: 837, optimumTotalCents: 817, optimumMerchantCount: 2 }),
  ])

  assert.ok(advice)
  assert.equal(advice.detourWorthMentioning, false)
})

test('ab der Rauschschwelle wird der Umweg erwähnt', () => {
  const advice = chooseStore([
    laden({ merchantId: 'rewe', basketTotalCents: 3010, optimumTotalCents: 2790, optimumMerchantCount: 4 }),
    laden({ merchantId: 'aldi', basketTotalCents: 3140, optimumTotalCents: 2790, optimumMerchantCount: 4 }),
  ])

  assert.ok(advice)
  assert.equal(advice.extraCents, 220)
  assert.ok(advice.extraCents >= RELEVANT_DIFFERENCE_CENTS)
  assert.equal(advice.detourWorthMentioning, true)
})

test('ein Laden ist keine Wahl', () => {
  assert.equal(
    chooseStore([laden({ merchantId: 'rewe', basketTotalCents: 827, optimumTotalCents: 827 })]),
    null,
  )
  assert.equal(chooseStore([]), null)
})

test('eine einzige bepreiste Position sagt nichts, was nicht schon an der Zeile steht', () => {
  const advice = chooseStore([
    laden({ merchantId: 'rewe', basketTotalCents: 129, optimumTotalCents: 119, pricedItems: 1, coveredItems: 1 }),
    laden({ merchantId: 'aldi', basketTotalCents: 119, optimumTotalCents: 119, pricedItems: 1, coveredItems: 1 }),
  ])

  assert.equal(advice, null)
})

test('bei gleicher Summe gewinnt der Laden, der mehr Positionen führt', () => {
  const advice = chooseStore([
    laden({ merchantId: 'klein', basketTotalCents: 500, coveredItems: 1, missingItems: 2,
      optimumTotalCents: 500 }),
    laden({ merchantId: 'gross', basketTotalCents: 500, coveredItems: 3, missingItems: 0,
      optimumTotalCents: 500 }),
  ])

  assert.ok(advice)
  assert.equal(advice.best.merchantId, 'gross')
})

test('der Umweg wird nie negativ, auch wenn das Optimum darüberläge', () => {
  const advice = chooseStore([
    laden({ merchantId: 'a', basketTotalCents: 500, optimumTotalCents: 520, optimumMerchantCount: 2 }),
    laden({ merchantId: 'b', basketTotalCents: 600, optimumTotalCents: 520, optimumMerchantCount: 2 }),
  ])

  assert.ok(advice)
  assert.equal(advice.extraCents, 0)
})
