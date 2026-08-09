import test from 'node:test'
import assert from 'node:assert/strict'
import { applyKnownProducts, mappingKey } from './mappings.ts'
import type { KnownProduct, KnownProducts } from './mappings.ts'
import { validateExtraction } from './validate.ts'

/**
 * Tests für den Lernkreis: Was der Haushalt schon weiß, schlägt das Modell.
 *
 * Die beiden Zusicherungen aus PROJEKT.md, die hier festgenagelt sind:
 *
 *   1. Ein bekannter Rohtext übernimmt Name, Kategorie und Merkmale aus der
 *      Datenbank — auch dann, wenn das Modell etwas anderes vorschlägt.
 *   2. Was auf *diesem* Bon steht (Menge, Preise, Steuerkennzeichen), bleibt
 *      unangetastet. Das Gedächtnis kennt das Produkt, nicht den Einkauf.
 */

const MILCH: KnownProduct = {
  canonicalProductId: 'p-1',
  name: 'H-Milch 1,5 % Fett',
  categoryKey: 'dairy',
  traitKeys: ['milch'],
  milkHeat: 'uht',
  milkHomogenized: 'ja',
}

function known(entries: Array<[string, KnownProduct]>): KnownProducts {
  return new Map(entries.map(([raw, product]) => [mappingKey(raw), product]))
}

/** Ein Bon mit genau diesen Positionen, durch die echte Prüfung gelaufen. */
function receipt(positionen: unknown[]) {
  return validateExtraction({ lesbar: true, haendler: 'REWE', datum: '2026-08-14', positionen })
}

/*
 * So kommt eine Position aus Durchgang 1: abgeschrieben, aber ohne jede
 * Zuordnung. Genau die setzt `applyKnownProducts` ein.
 */
const H_MILCH = {
  rohtext: 'G&G H-MILCH 1,5%',
  art: 'artikel',
  menge: 2,
  einheit: 'stk',
  einzelpreis_cent: 129,
  zeilensumme_cent: 258,
  steuer: 'B',
}

/* ------------------------------------------------------------ Schlüssel */

test('mappingKey', async (t) => {
  await t.test('ignoriert Groß-/Kleinschreibung und Ränder', () => {
    assert.equal(mappingKey('  G&G H-Milch  '), 'g&g h-milch')
  })

  await t.test('lässt Leerzeichen im Text stehen', () => {
    // Muss dem Index lower(btrim(raw_text)) entsprechen: Der fasst zwei
    // Leerzeichen NICHT zu einem zusammen. Wäre das hier großzügiger, entstünde
    // beim Speichern eine zweite Zuordnung für denselben Text.
    assert.equal(mappingKey('A  B'), 'a  b')
  })
})

/* ------------------------------------------------------- Bekanntes gewinnt */

test('applyKnownProducts', async (t) => {
  await t.test('ersetzt den Modellvorschlag durch das Gelernte', () => {
    const result = applyKnownProducts(receipt([H_MILCH]), known([['G&G H-MILCH 1,5%', MILCH]]))
    const suggestion = result.items[0].suggestion!

    assert.equal(suggestion.name, 'H-Milch 1,5 % Fett')
    assert.equal(suggestion.categoryKey, 'dairy')
    assert.deepEqual(suggestion.traitKeys, ['milch'])
    assert.equal(suggestion.milkHeat, 'uht')
    assert.equal(suggestion.milkHomogenized, 'ja')
    assert.equal(suggestion.source, 'db')
    assert.equal(suggestion.canonicalProductId, 'p-1')
  })

  await t.test('findet den Rohtext unabhängig von der Schreibweise', () => {
    const result = applyKnownProducts(receipt([H_MILCH]), known([['g&g h-milch 1,5%  ', MILCH]]))
    assert.equal(result.items[0].suggestion?.source, 'db')
  })

  await t.test('lässt Menge, Preise und Steuerkennzeichen unangetastet', () => {
    const result = applyKnownProducts(receipt([H_MILCH]), known([['G&G H-MILCH 1,5%', MILCH]]))
    const item = result.items[0]

    assert.equal(item.quantityBase, 2)
    assert.equal(item.quantityUnit, 'stk')
    assert.equal(item.unitPriceCents, 129)
    assert.equal(item.totalCents, 258)
    assert.equal(item.taxCode, 'B')
    assert.equal(item.rawText, 'G&G H-MILCH 1,5%')
  })

  await t.test('lässt einen unbekannten Rohtext offen für Durchgang 2', () => {
    const result = applyKnownProducts(receipt([H_MILCH]), known([['ETWAS ANDERES', MILCH]]))
    assert.equal(result.items[0].suggestion, null)
  })

  await t.test('ordnet Pfand- und Rabattzeilen nie zu', () => {
    const pfand = { rohtext: 'PFAND 0,25', art: 'pfand', zeilensumme_cent: 25 }
    const result = applyKnownProducts(receipt([pfand]), known([['PFAND 0,25', MILCH]]))
    assert.equal(result.items[0].suggestion, null)
  })

  await t.test('lässt die Warnungen aus Durchgang 1 stehen', () => {
    const unlesbar = { rohtext: 'BROT', art: 'artikel', zeilensumme_cent: null }
    const result = applyKnownProducts(
      receipt([H_MILCH, unlesbar]),
      known([['G&G H-MILCH 1,5%', MILCH]]),
    )
    assert.equal(result.warnings.some((w) => w.code === 'betrag_fehlt'), true)
  })

  await t.test('gibt ohne Gelerntes dasselbe Ergebnis zurück', () => {
    const before = receipt([H_MILCH])
    assert.equal(applyKnownProducts(before, new Map()), before)
  })
})
