import test from 'node:test'
import assert from 'node:assert/strict'
import {
  baseAmount,
  buildSavePayload,
  differs,
  displayAmount,
  draftQuantity,
  draftsTotalCents,
  emptyDraft,
  expectedTotalCents,
  normalizeTraits,
  taxReconciliation,
  tipFromPercent,
  toDrafts,
  toDraftsFromSaved,
  withoutCategory,
} from './draft.ts'
import type { DraftItem } from './draft.ts'
import type { ExtractedItem, Extraction } from './extraction.ts'

/**
 * Tests für den Entwurf, an dem der Korrektur-Screen arbeitet.
 *
 * Drei Dinge müssen sitzen, weil an ihnen Zahlen hängen, die der Nutzer später
 * für bare Münze nimmt:
 *
 *   1. Der Summenabgleich und die Steuerklassen-Probe rechnen aus dem
 *      **aktuellen** Stand, nicht aus dem, was das Modell einmal geliefert hat.
 *   2. Aus den Milch-Merkmalen werden Sachattribute — sonst stünde dieselbe
 *      Aussage doppelt in der Datenbank.
 *   3. `quelle` wird nur dann `user`, wenn wirklich etwas geändert wurde.
 */

function item(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    lineNo: 1,
    rawText: 'G&G H-MILCH 1,5%',
    kind: 'artikel',
    quantityBase: null,
    quantityUnit: null,
    unitPriceCents: null,
    totalCents: 129,
    depositCents: 0,
    discountCents: 0,
    taxCode: 'B',
    sourceLines: [],
    suggestion: {
      name: 'H-Milch 1,5 % Fett',
      categoryKey: 'dairy',
      traitKeys: ['milch'],
      milkHeat: 'uht',
      milkHomogenized: 'unbekannt',
      source: 'model',
      canonicalProductId: null,
    },
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
    printedTotalCents: draftsTotal(items),
    items,
    itemsTotalCents: draftsTotal(items),
    discrepancyCents: 0,
    taxGroups: [],
    printedTaxGroups: [],
    lines: [],
    unassignedLines: [],
    warnings: [],
  }
}

function draftsTotal(items: ExtractedItem[]): number {
  return items.reduce((sum, i) => sum + i.totalCents, 0)
}

function draft(overrides: Partial<DraftItem> = {}): DraftItem {
  return { ...toDrafts(extraction([item()]))[0], ...overrides }
}

/* ------------------------------------------------------- Erkannt → Entwurf */

test('toDrafts', async (t) => {
  await t.test('übernimmt den Vorschlag des Modells', () => {
    const [first] = toDrafts(extraction([item()]))
    assert.equal(first.name, 'H-Milch 1,5 % Fett')
    assert.equal(first.categoryKey, 'dairy')
    assert.equal(first.milkHeat, 'uht')
    assert.equal(first.edited, false)
    assert.equal(first.known, false)
  })

  await t.test('nimmt den Bontext, wenn es keinen Klarnamen gibt', () => {
    const [first] = toDrafts(extraction([item({ suggestion: null })]))
    assert.equal(first.name, 'G&G H-MILCH 1,5%')
    assert.equal(first.categoryKey, null)
  })

  await t.test('merkt sich, was aus der Datenbank kam', () => {
    const known = item({
      suggestion: { ...item().suggestion!, source: 'db', canonicalProductId: 'p-1' },
    })
    const [first] = toDrafts(extraction([known]))
    assert.equal(first.known, true)
    assert.equal(first.canonicalProductId, 'p-1')
  })
})

/* -------------------------------------------------- Merkmale und Milch */

test('normalizeTraits', async (t) => {
  await t.test('macht aus dem Merkmal „uht" den Erhitzungsgrad', () => {
    const result = normalizeTraits(['milch', 'uht'], 'unbekannt', 'unbekannt')
    assert.deepEqual(result.traitKeys, ['milch'])
    assert.equal(result.milkHeat, 'uht')
  })

  await t.test('macht aus „homogenisiert" das Sachattribut', () => {
    const result = normalizeTraits(['homogenisiert'], 'unbekannt', 'unbekannt')
    assert.deepEqual(result.traitKeys, [])
    assert.equal(result.milkHomogenized, 'ja')
  })

  await t.test('das ausdrückliche Feld gewinnt gegen das Merkmal', () => {
    const result = normalizeTraits(['esl'], 'uht', 'unbekannt')
    assert.equal(result.milkHeat, 'uht')
  })

  await t.test('entfernt doppelte Merkmale', () => {
    assert.deepEqual(normalizeTraits(['milch', 'milch'], 'unbekannt', 'unbekannt').traitKeys, [
      'milch',
    ])
  })
})

/* ----------------------------------------------------------------- Mengen */

test('Mengen rechnen', async (t) => {
  await t.test('Basiseinheit und Anzeige gehen ineinander über', () => {
    assert.equal(displayAmount(1120, 'kg'), 1.12)
    assert.equal(displayAmount(500, 'g'), 500)
    assert.equal(baseAmount(1.12, 'kg'), 1120)
    assert.equal(baseAmount(2, 'stk'), 2)
  })

  await t.test('Stück werden zu „2 × 1,29 €"', () => {
    const quantity = draftQuantity(
      draft({ quantityBase: 2, quantityUnit: 'stk', unitPriceCents: 129, totalCents: 258 }),
    )
    assert.deepEqual(quantity, { kind: 'count', count: 2, unitPriceCents: 129 })
  })

  await t.test('Gramm werden auf Kilo hochgerechnet, der Preis mit', () => {
    const quantity = draftQuantity(
      draft({ quantityBase: 500, quantityUnit: 'g', unitPriceCents: 1, totalCents: 500 }),
    )
    assert.deepEqual(quantity, { kind: 'weight', amount: 0.5, unit: 'kg', pricePerUnitCents: 1000 })
  })

  await t.test('ohne Menge bleibt es „ohne Mengenangabe"', () => {
    assert.deepEqual(draftQuantity(draft()), { kind: 'unknown' })
  })

  await t.test('Menge × Einzelpreis als Hinweis, gerundet auf ganze Cent', () => {
    const line = draft({ quantityBase: 1120, quantityUnit: 'kg', unitPriceCents: 179 })
    // 1,12 kg × 1,79 €/kg = 2,0048 € — die Kasse druckt 2,00 €.
    assert.equal(expectedTotalCents(line), 200)
  })

  await t.test('ohne Einzelpreis gibt es nichts gegenzurechnen', () => {
    assert.equal(expectedTotalCents(draft({ unitPriceCents: null })), null)
  })
})

/* ----------------------------------------------------------- Der Abgleich */

test('Summen und Steuerklassen', async (t) => {
  await t.test('die Positionssumme rechnet aus dem aktuellen Stand', () => {
    const drafts = [draft({ totalCents: 199 }), draft({ key: 'z2', totalCents: 99 })]
    assert.equal(draftsTotalCents(drafts), 298)
  })

  await t.test('Rabatte ziehen ab', () => {
    const drafts = [draft({ totalCents: 199 }), draft({ key: 'z2', kind: 'rabatt', totalCents: -50 })]
    assert.equal(draftsTotalCents(drafts), 149)
  })

  const printed = [
    { code: 'A', grossCents: 159 },
    { code: 'B', grossCents: 496 },
  ]

  await t.test('zeigt die Lücke in der richtigen Klasse', () => {
    const drafts = [
      draft({ key: 'a', taxCode: 'A', totalCents: 159 }),
      draft({ key: 'b', taxCode: 'B', totalCents: 397 }),
    ]
    const result = taxReconciliation(drafts, printed)
    assert.equal(result.groups[0].differenceCents, 0)
    assert.equal(result.groups[1].differenceCents, 99)
  })

  await t.test('die ergänzte Position schließt die Lücke sofort', () => {
    const drafts = [
      draft({ key: 'a', taxCode: 'A', totalCents: 159 }),
      draft({ key: 'b', taxCode: 'B', totalCents: 397 }),
      draft({ key: 'c', taxCode: 'B', totalCents: 99 }),
    ]
    const result = taxReconciliation(drafts, printed)
    assert.deepEqual(
      result.groups.map((group) => group.differenceCents),
      [0, 0],
    )
  })

  await t.test('ohne vollständige Kennzeichen wird nicht verglichen', () => {
    const drafts = [draft({ key: 'a', taxCode: 'A' }), draft({ key: 'b', taxCode: null })]
    const result = taxReconciliation(drafts, printed)
    assert.deepEqual(result.groups, [])
    assert.equal(result.missingCodes, 1)
  })

  await t.test('meldet ein Kennzeichen, das der Block nicht kennt', () => {
    const drafts = [draft({ key: 'a', taxCode: 'C' })]
    assert.deepEqual(taxReconciliation(drafts, printed).unknownCodes, ['C'])
  })

  await t.test('ohne gedruckten Block gibt es nichts zu prüfen', () => {
    assert.deepEqual(taxReconciliation([draft()], []).groups, [])
  })
})

/* ------------------------------------------------------------ Korrekturen */

test('differs', async (t) => {
  await t.test('erkennt eine echte Änderung', () => {
    assert.equal(differs(draft(), draft({ name: 'Anders' })), true)
    assert.equal(differs(draft(), draft({ totalCents: 1 })), true)
    assert.equal(differs(draft(), draft({ traitKeys: [] })), true)
  })

  await t.test('meldet nichts, wenn nichts geändert wurde', () => {
    // Aufklappen und wieder schließen ist keine Korrektur — sonst würde eine
    // ältere Nutzerkorrektur zum Modellvorschlag herabgestuft.
    assert.equal(differs(draft(), draft()), false)
  })
})

/* ------------------------------------------------------------- Speichern */

test('buildSavePayload', async (t) => {
  const base = {
    merchantName: 'REWE CITY',
    merchantKind: 'retail' as const,
    merchantKindEdited: false,
    purchasedOn: '2026-08-14',
    printedTotalCents: 258,
    tipCents: 0,
  }

  await t.test('meldet die Händlerart nur dann als Nutzerentscheidung, wenn sie eine war', () => {
    // Ohne diese Unterscheidung setzte jeder weitere Bon eines als Gastro
    // markierten Ladens ihn wieder auf „retail" zurück.
    assert.equal(buildSavePayload({ ...base, drafts: [draft()] }).haendler_art_quelle, 'model')
    assert.equal(
      buildSavePayload({
        ...base,
        merchantKind: 'gastro',
        merchantKindEdited: true,
        drafts: [draft()],
      }).haendler_art_quelle,
      'user',
    )
  })

  await t.test('lässt das Trinkgeld aus der gedruckten Summe heraus', () => {
    // `summe_cent` ist das, was auf dem Papier steht — dagegen rechnet der
    // Summenabgleich. Läge das Trinkgeld darin, meldete er bei jedem
    // Restaurantbesuch eine Abweichung.
    const payload = buildSavePayload({ ...base, tipCents: 500, drafts: [draft()] })
    assert.equal(payload.summe_cent, 258)
    assert.equal(payload.trinkgeld_cent, 500)
  })

  await t.test('schickt niemals ein negatives Trinkgeld', () => {
    const payload = buildSavePayload({ ...base, tipCents: -500, drafts: [draft()] })
    assert.equal(payload.trinkgeld_cent, 0)
  })

  await t.test('schickt den Vorschlag als „model", die Korrektur als „user"', () => {
    const payload = buildSavePayload({
      ...base,
      drafts: [draft(), draft({ key: 'z2', edited: true })],
    })
    assert.equal(payload.positionen[0].quelle, 'model')
    assert.equal(payload.positionen[1].quelle, 'user')
  })

  await t.test('gibt Pfand und Rabatt keine Kategorie und keine Merkmale', () => {
    const payload = buildSavePayload({
      ...base,
      drafts: [draft({ kind: 'pfand', totalCents: 25 }), draft({ key: 'z2', kind: 'rabatt', totalCents: -50 })],
    })
    assert.equal(payload.positionen[0].kategorie, null)
    assert.deepEqual(payload.positionen[0].merkmale, [])
    assert.equal(payload.positionen[0].pfand_cent, 25)
    assert.equal(payload.positionen[1].rabatt_cent, 50)
  })

  await t.test('nimmt ohne gedruckte Summe die Positionssumme', () => {
    const payload = buildSavePayload({
      ...base,
      printedTotalCents: null,
      drafts: [draft({ totalCents: 199 }), draft({ key: 'z2', totalCents: 99 })],
    })
    assert.equal(payload.summe_cent, 298)
  })

  await t.test('reicht das bekannte Produkt weiter', () => {
    const payload = buildSavePayload({ ...base, drafts: [draft({ canonicalProductId: 'p-1' })] })
    assert.equal(payload.positionen[0].produkt_id, 'p-1')
  })

  await t.test('eine ergänzte Position bringt keinen Rohtext mit', () => {
    const added = { ...emptyDraft('neu'), name: 'Vergessene Zeile', totalCents: 99 }
    const payload = buildSavePayload({ ...base, drafts: [added] })
    assert.equal(payload.positionen[0].rohtext, '')
    assert.equal(payload.positionen[0].quelle, 'user')
  })
})

/* ---------------------------------------------------------- Fremdwährung */

test('buildSavePayload rechnet Fremdwährung um', async (t) => {
  const base = {
    merchantName: 'Migros',
    merchantKind: 'retail' as const,
    merchantKindEdited: false,
    purchasedOn: '2026-08-07',
    tipCents: 0,
  }

  // 1 CHF = 1,069862 € — der Kehrwert des EZB-Kurses 0,9347 vom 07.08.2026.
  const conversion = {
    currency: 'CHF',
    rate: 1.069862,
    rateDate: '2026-08-07',
    amountsIn: 'bon' as const,
  }

  await t.test('legt Euro in die Cent-Felder und den Originalbetrag daneben', () => {
    const payload = buildSavePayload({
      ...base,
      printedTotalCents: 4500,
      drafts: [draft({ totalCents: 4500, unitPriceCents: 4500 })],
      conversion,
    })

    // 45,00 CHF werden zu 48,14 €.
    assert.equal(payload.summe_cent, 4814)
    assert.equal(payload.positionen[0].zeilensumme_cent, 4814)
    assert.equal(payload.positionen[0].einzelpreis_cent, 4814)
    assert.equal(payload.waehrung, 'CHF')
    assert.equal(payload.original_summe_cent, 4500)
    assert.equal(payload.kurs, 1.069862)
    assert.equal(payload.kurs_datum, '2026-08-07')
  })

  await t.test('erfindet keine Abweichung, wenn der Bon in Franken aufging', () => {
    /*
     * Der eigentliche Fallstrick beim Umrechnen: Jede Zeile wird einzeln
     * gerundet. 3 × 3,33 CHF ergeben einzeln umgerechnet 356+356+356 = 1068
     * Cent, die Summe 9,99 CHF dagegen 1069. Ohne Sonderregel stünde im
     * gespeicherten Bon eine Abweichung von einem Cent, obwohl der
     * Korrektur-Screen „stimmt" gesagt hatte.
     */
    const drafts = [
      draft({ key: 'z1', totalCents: 333 }),
      draft({ key: 'z2', totalCents: 333 }),
      draft({ key: 'z3', totalCents: 333 }),
    ]
    const payload = buildSavePayload({ ...base, printedTotalCents: 999, drafts, conversion })

    const zeilensumme = payload.positionen.reduce((sum, p) => sum + p.zeilensumme_cent, 0)
    assert.equal(payload.summe_cent, zeilensumme)
    // Und der Betrag vom Papier bleibt unangetastet.
    assert.equal(payload.original_summe_cent, 999)
  })

  await t.test('lässt eine echte Abweichung stehen', () => {
    // Ging der Bon schon in Franken nicht auf, muss das auch in Euro sichtbar
    // bleiben — sonst verschwiege das Umrechnen einen Lesefehler.
    const payload = buildSavePayload({
      ...base,
      printedTotalCents: 1000,
      drafts: [draft({ totalCents: 900 })],
      conversion,
    })
    assert.notEqual(payload.summe_cent, payload.positionen[0].zeilensumme_cent)
  })

  await t.test('rechnet auch das Trinkgeld um', () => {
    // Trinkgeld gibt man in Franken, nicht in Euro.
    const payload = buildSavePayload({
      ...base,
      merchantKind: 'gastro',
      printedTotalCents: 4500,
      tipCents: 500,
      drafts: [draft({ totalCents: 4500 })],
      conversion,
    })
    assert.equal(payload.trinkgeld_cent, 535)
  })

  await t.test('lässt bei einem Euro-Bon jeden Betrag unberührt', () => {
    const payload = buildSavePayload({
      ...base,
      printedTotalCents: 4500,
      drafts: [draft({ totalCents: 4500 })],
      conversion: null,
    })
    assert.equal(payload.summe_cent, 4500)
    assert.equal(payload.waehrung, 'EUR')
    assert.equal(payload.original_summe_cent, null)
    assert.equal(payload.kurs, null)
  })

  await t.test('rechnet beim Bearbeiten nicht zurück und wieder hin', () => {
    /*
     * Ein gespeicherter Bon steht in der Datenbank bereits in Euro. Ein Rundgang
     * Euro → Franken → Euro verschöbe einzelne Zeilen um einen Cent, ohne dass
     * jemand etwas geändert hätte. Umgerechnet wird deshalb nur der
     * Originalbetrag — eine Zusatzangabe, an der keine Auswertung hängt.
     */
    const payload = buildSavePayload({
      ...base,
      receiptId: 'bon-1',
      printedTotalCents: 4814,
      drafts: [draft({ totalCents: 4814 })],
      conversion: { ...conversion, amountsIn: 'euro' },
    })

    assert.equal(payload.bon_id, 'bon-1')
    assert.equal(payload.summe_cent, 4814)
    assert.equal(payload.positionen[0].zeilensumme_cent, 4814)
    // 48,14 € / 1,069862 sind wieder 45,00 CHF.
    assert.equal(payload.original_summe_cent, 4500)
  })
})

test('toDraftsFromSaved', async (t) => {
  const saved = {
    rawText: 'G&G H-MILCH',
    name: 'H-Milch 1,5 %',
    categoryKey: 'dairy',
    traitKeys: ['milch'],
    milkHeat: 'uht' as const,
    milkHomogenized: 'unbekannt' as const,
    quantityBase: 2,
    quantityUnit: 'stk' as const,
    unitPriceCents: 129,
    totalCents: 258,
    discountCents: 0,
    depositCents: 0,
    taxCode: 'B',
    canonicalProductId: 'p-1',
  }

  await t.test('macht aus einer gespeicherten Zeile einen Entwurf', () => {
    const [item] = toDraftsFromSaved([saved])
    assert.equal(item.name, 'H-Milch 1,5 %')
    assert.equal(item.categoryKey, 'dairy')
    assert.equal(item.kind, 'artikel')
    assert.equal(item.canonicalProductId, 'p-1')
    assert.equal(item.known, true)
  })

  await t.test('gewinnt Pfand und Rabatt aus den beiden Betragsfeldern zurück', () => {
    // `receipt_items` hat keine Spalte für die Art — sie steckt in
    // `deposit_cents` und `discount_cents`, und genau daraus ist die Zeile beim
    // Speichern entstanden.
    const items = toDraftsFromSaved([
      { ...saved, depositCents: 25, totalCents: 25 },
      { ...saved, discountCents: 50, totalCents: -50 },
    ])
    assert.equal(items[0].kind, 'pfand')
    assert.equal(items[1].kind, 'rabatt')
  })

  await t.test('gilt nicht als bearbeitet, solange nichts geändert wurde', () => {
    // Sonst würde jede unveränderte Zeile beim erneuten Speichern als
    // Nutzerkorrektur durchgehen und einen Modellvorschlag zur Entscheidung
    // befördern.
    const [item] = toDraftsFromSaved([saved])
    assert.equal(item.edited, false)
    assert.equal(item.added, false)
    assert.equal(differs(item, item), false)
  })

  await t.test('führt abgeleitete Milch-Merkmale nicht doppelt', () => {
    const [item] = toDraftsFromSaved([{ ...saved, traitKeys: ['milch', 'uht'] }])
    assert.deepEqual(item.traitKeys, ['milch'])
    assert.equal(item.milkHeat, 'uht')
  })

  await t.test('vergibt Schlüssel, die sich nicht mit ergänzten Zeilen beißen', () => {
    const items = toDraftsFromSaved([saved, saved])
    assert.deepEqual(
      items.map((item) => item.key),
      ['b1', 'b2'],
    )
  })
})

test('tipFromPercent', async (t) => {
  await t.test('rechnet auf ganze Cent', () => {
    // 43,80 € · 10 % = 4,38 €. Kein halber Cent, nirgends.
    assert.equal(tipFromPercent(4380, 10), 438)
    assert.equal(tipFromPercent(4380, 5), 219)
  })

  await t.test('rundet kaufmännisch statt abzuschneiden', () => {
    // 12,35 € · 5 % = 0,6175 € → 62 Cent.
    assert.equal(tipFromPercent(1235, 5), 62)
  })

  await t.test('gibt ohne Grundbetrag nichts zurück', () => {
    assert.equal(tipFromPercent(0, 10), 0)
    assert.equal(tipFromPercent(-100, 10), 0)
  })
})

test('withoutCategory zählt nur Artikel', () => {
  const drafts = [
    draft({ categoryKey: null }),
    draft({ key: 'z2', kind: 'pfand', categoryKey: null }),
    draft({ key: 'z3' }),
  ]
  assert.equal(withoutCategory(drafts), 1)
})
