import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAssignments, rawTextKey, withAssignmentFailure } from './assignments.ts'
import type { AssignmentRow, ExtractedItem, Extraction } from './extraction.ts'

/**
 * Tests für das Einsetzen von Durchgang 2.
 *
 * Zwei Zusicherungen, die hier festgenagelt sind:
 *
 *   1. Zugeordnet wird über den Rohtext, nie über die Reihenfolge.
 *   2. Was schon aus der Datenbank kam, wird nicht überschrieben — eine
 *      Nutzerkorrektur gilt dauerhaft (PROJEKT.md).
 */

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    lineNo: 1,
    rawText: 'VANILLE',
    kind: 'artikel',
    quantityBase: null,
    quantityUnit: null,
    unitPriceCents: 199,
    totalCents: 199,
    depositCents: 0,
    discountCents: 0,
    taxCode: 'B',
    sourceLines: [],
    suggestion: null,
    ...overrides,
  }
}

function extraction(items: ExtractedItem[]): Extraction {
  return {
    merchantName: 'REWE',
    purchasedOn: '2026-08-14',
    purchasedAt: null,
    // Kein Währungszeichen gelesen: der Normalfall auf einem deutschen Bon.
    currency: null,
    printedTotalCents: 298,
    items,
    itemsTotalCents: 298,
    discrepancyCents: 0,
    taxGroups: [],
    printedTaxGroups: [],
    lines: [],
    unassignedLines: [],
    warnings: [],
  }
}

function row(rawText: string, name: string, categoryKey: string | null = 'sweets'): AssignmentRow {
  return {
    rawText,
    name,
    categoryKey,
    traitKeys: ['industriezucker'],
    milkHeat: 'unbekannt',
    milkHomogenized: 'unbekannt',
    source: 'model',
    canonicalProductId: null,
  }
}

test('rawTextKey', () => {
  // Muss zu `mappingKey` in der Edge Function und zu lower(btrim(raw_text)) in
  // der Datenbank passen — drei Stellen, eine Regel.
  assert.equal(rawTextKey('  VANILLE  '), 'vanille')
  assert.equal(rawTextKey('A  B'), 'a  b')
})

test('applyAssignments', async (t) => {
  await t.test('setzt die Zuordnung an ihre Zeile', () => {
    const result = applyAssignments(extraction([item()]), [row('VANILLE', 'Vanillezucker')])
    const suggestion = result.items[0].suggestion!

    assert.equal(suggestion.name, 'Vanillezucker')
    assert.equal(suggestion.categoryKey, 'sweets')
    assert.deepEqual(suggestion.traitKeys, ['industriezucker'])
    assert.equal(suggestion.source, 'model')
  })

  await t.test('ordnet über den Rohtext zu, nicht über die Reihenfolge', () => {
    /*
     * Der Fall vom REWE-Bon, jetzt getrennt: zwei Zeilen, und die Zuordnungen
     * kommen in der anderen Reihenfolge zurück. Über die Position zugeordnet
     * bekäme „VANILLE" den Namen der Schokostreusel.
     */
    const items = [item(), item({ lineNo: 2, rawText: 'MILCHSCHOKOSTR', totalCents: 99 })]
    const result = applyAssignments(extraction(items), [
      row('MILCHSCHOKOSTR', 'Milchschokostreusel'),
      row('VANILLE', 'Vanillezucker'),
    ])

    assert.equal(result.items[0].suggestion?.name, 'Vanillezucker')
    assert.equal(result.items[1].suggestion?.name, 'Milchschokostreusel')
  })

  await t.test('setzt dieselbe Zuordnung an jede Zeile mit diesem Rohtext', () => {
    // Derselbe Artikel zweimal auf dem Bon wird nur einmal gefragt.
    const items = [item(), item({ lineNo: 2 })]
    const result = applyAssignments(extraction(items), [row('VANILLE', 'Vanillezucker')])
    assert.equal(result.items[0].suggestion?.name, 'Vanillezucker')
    assert.equal(result.items[1].suggestion?.name, 'Vanillezucker')
  })

  await t.test('überschreibt nicht, was aus der Datenbank kam', () => {
    const gelernt = item({
      suggestion: {
        name: 'Bourbon-Vanillezucker',
        categoryKey: 'staples',
        traitKeys: [],
        milkHeat: 'unbekannt',
        milkHomogenized: 'unbekannt',
        source: 'db',
        canonicalProductId: 'p-1',
      },
    })
    const result = applyAssignments(extraction([gelernt]), [row('VANILLE', 'Vanillezucker')])
    assert.equal(result.items[0].suggestion?.name, 'Bourbon-Vanillezucker')
    assert.equal(result.items[0].suggestion?.source, 'db')
  })

  await t.test('ordnet Pfand- und Rabattzeilen nie zu', () => {
    const pfand = item({ kind: 'pfand', rawText: 'PFAND 0,25' })
    const result = applyAssignments(extraction([pfand]), [row('PFAND 0,25', 'Pfand')])
    assert.equal(result.items[0].suggestion, null)
  })

  await t.test('lässt eine Zeile ohne Antwort offen', () => {
    const result = applyAssignments(extraction([item()]), [row('ETWAS ANDERES', 'Anderes')])
    assert.equal(result.items[0].suggestion, null)
  })

  await t.test('lässt Beträge und Mengen unangetastet', () => {
    const result = applyAssignments(extraction([item()]), [row('VANILLE', 'Vanillezucker')])
    assert.equal(result.items[0].totalCents, 199)
    assert.equal(result.items[0].unitPriceCents, 199)
    assert.equal(result.items[0].taxCode, 'B')
  })

  await t.test('gibt ohne Zuordnungen dasselbe Ergebnis zurück', () => {
    const before = extraction([item()])
    assert.equal(applyAssignments(before, []), before)
  })
})

test('withAssignmentFailure hängt eine Warnung an, ohne etwas zu verlieren', () => {
  const before = extraction([item()])
  const after = withAssignmentFailure(before)

  assert.equal(after.items.length, 1)
  assert.equal(after.items[0].totalCents, 199)
  assert.equal(after.warnings.some((w) => w.code === 'zuordnung_ausgefallen'), true)
  // Die Eingabe bleibt unangetastet.
  assert.equal(before.warnings.length, 0)
})
