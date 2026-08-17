import test from 'node:test'
import assert from 'node:assert/strict'
import { blankScan, isWorthReviewing, reviewQuality } from './salvage.ts'
import type { Extraction, ExtractedItem } from './extraction.ts'

/**
 * Tests für die Regel „Teilergebnis schlägt Fehlermeldung".
 *
 * Sie steht in einer eigenen Datei und nicht in der Komponente, damit sie
 * überhaupt prüfbar ist — und damit sich später niemand fragen muss, warum ein
 * halb gelesener Bon ins Formular geht.
 */

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    merchantName: null,
    purchasedOn: null,
    purchasedAt: null,
    currency: null,
    printedTotalCents: null,
    items: [],
    itemsTotalCents: 0,
    discrepancyCents: null,
    taxGroups: [],
    printedTaxGroups: [],
    lines: [],
    unassignedLines: [],
    warnings: [],
    ...over,
  }
}

function item(): ExtractedItem {
  return {
    lineNo: 1,
    rawText: 'MILCH 1,5%',
    kind: 'artikel',
    quantityBase: null,
    quantityUnit: null,
    unitPriceCents: 129,
    totalCents: 129,
    depositCents: 0,
    discountCents: 0,
    taxCode: 'B',
    suggestion: null,
    sourceLines: ['MILCH 1,5% 1,29 B'],
  }
}

test('isWorthReviewing — ein Anker genügt', async (t) => {
  await t.test('nur der Händler', () => {
    assert.equal(isWorthReviewing(extraction({ merchantName: 'REWE' })), true)
  })

  await t.test('nur die gedruckte Summe', () => {
    assert.equal(isWorthReviewing(extraction({ printedTotalCents: 12067 })), true)
  })

  await t.test('nur eine einzige Position', () => {
    assert.equal(isWorthReviewing(extraction({ items: [item()] })), true)
  })

  await t.test('eine Summe von 0 zählt auch', () => {
    // 0 ist ein gelesener Wert, kein fehlender. `null` wäre fehlend.
    assert.equal(isWorthReviewing(extraction({ printedTotalCents: 0 })), true)
  })
})

test('isWorthReviewing — wirklich nichts bleibt nichts', async (t) => {
  await t.test('alle drei Anker leer', () => {
    assert.equal(isWorthReviewing(extraction()), false)
  })

  await t.test('ein Händlername aus Leerzeichen zählt nicht', () => {
    assert.equal(isWorthReviewing(extraction({ merchantName: '   ' })), false)
  })

  await t.test('gar keine Erkennung', () => {
    assert.equal(isWorthReviewing(null), false)
    assert.equal(isWorthReviewing(undefined), false)
  })

  await t.test('abgetippte Zeilen allein reichen nicht', () => {
    /*
     * Zeilen ohne Positionen heißt: Das Modell hat etwas gesehen, aber kein
     * Betrag ließ sich herauslösen. Daraus ein Formular zu bauen, wäre ein
     * leeres Formular mit Umweg.
     */
    assert.equal(isWorthReviewing(extraction({ lines: ['irgendwas'] })), false)
  })
})

test('reviewQuality erkennt ein Teilergebnis', async (t) => {
  await t.test('vollständig, wenn nichts dagegen spricht', () => {
    assert.equal(reviewQuality(extraction({ items: [item()] })), 'vollstaendig')
  })

  await t.test('abgeschnittene Antwort', () => {
    const value = extraction({
      items: [item()],
      warnings: [{ code: 'antwort_abgeschnitten', message: '…' }],
    })
    assert.equal(reviewQuality(value), 'teilweise')
  })

  await t.test('Summe geht nicht auf', () => {
    const value = extraction({
      items: [item()],
      warnings: [{ code: 'summe_weicht_ab', message: '…' }],
    })
    assert.equal(reviewQuality(value), 'teilweise')
  })

  await t.test('gar keine Positionen', () => {
    // Ein Händlername allein ist kein Einkauf — auch ohne Warnung.
    assert.equal(reviewQuality(extraction({ merchantName: 'REWE' })), 'teilweise')
  })

  await t.test('eine harmlose Warnung macht es nicht unvollständig', () => {
    const value = extraction({
      items: [item()],
      warnings: [{ code: 'zuordnung_ausgefallen', message: '…' }],
    })
    assert.equal(reviewQuality(value), 'vollstaendig')
  })
})

test('blankScan ist ein benutzbares leeres Formular', () => {
  const blank = blankScan()

  assert.equal(blank.extraction.items.length, 0)
  assert.equal(blank.extraction.merchantName, null)
  // Ein Datum ist vorbelegt: Ohne eines wäre das Formular nicht speicherbar,
  // und „heute" ist die einzige Vermutung, die hier zulässig ist.
  assert.match(blank.extraction.purchasedOn ?? '', /^\d{4}-\d{2}-\d{2}$/)
  // Kein Modellname, denn es hat keines gearbeitet.
  assert.equal(blank.model, 'manuell')
  // Und es ist ausdrücklich nichts zu prüfen — sonst liefe es in den Formular-
  // Zweig statt in „Manuell erfassen".
  assert.equal(isWorthReviewing(blank.extraction), false)
})
