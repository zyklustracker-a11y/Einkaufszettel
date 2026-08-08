import test from 'node:test'
import assert from 'node:assert/strict'
import { isUnreadable, parseModelJson, toCents, validateExtraction } from './validate.ts'

/**
 * Tests für die Prüfung der Modellantwort.
 *
 * Wie bei `src/lib/score.ts` gilt: Was eine reine Funktion ist, wird
 * festgenagelt. Hier ist das besonders wichtig, weil die Eingabe von einem
 * Modell kommt — sie ist also nie verlässlich, und genau die krummen Fälle
 * müssen sitzen.
 *
 * Läuft mit `npm test`; Node führt TypeScript direkt aus, ein Bauschritt ist
 * dafür nicht nötig.
 */

const CONTEXT = {
  categoryKeys: ['produce', 'meat', 'dairy', 'bakery', 'drinks', 'staples', 'nonfood'],
  traitKeys: ['milch', 'uht', 'weizen', 'gluten', 'verarbeitet'],
}

/** Kürzel für „ein Bon mit genau diesen Positionen". */
function receipt(positionen: unknown[], rest: Record<string, unknown> = {}) {
  return validateExtraction(
    { lesbar: true, haendler: 'REWE', datum: '2026-08-14', positionen, ...rest },
    CONTEXT,
  )
}

/* ------------------------------------------------------------ JSON schälen */

test('parseModelJson', async (t) => {
  await t.test('nimmt sauberes JSON', () => {
    assert.deepEqual(parseModelJson('{"lesbar":true}'), { lesbar: true })
  })

  await t.test('entfernt Codeblock und Vorspann', () => {
    const raw = 'Hier ist das Ergebnis:\n```json\n{"lesbar":true}\n```'
    assert.deepEqual(parseModelJson(raw), { lesbar: true })
  })

  await t.test('gibt null zurück, wenn gar kein JSON da ist', () => {
    assert.equal(parseModelJson('Das kann ich leider nicht lesen.'), null)
  })

  await t.test('repariert kaputtes JSON nicht', () => {
    // Eine fehlende Klammer darf nicht stillschweigend geradegebogen werden —
    // sonst entsteht aus einer halben Antwort ein scheinbar vollständiger Bon.
    assert.equal(parseModelJson('{"lesbar":true, "positionen":[{'), null)
  })

  await t.test('erkennt „nicht lesbar"', () => {
    assert.equal(isUnreadable(parseModelJson('{"lesbar":false}')!), true)
    assert.equal(isUnreadable(parseModelJson('{"lesbar":true}')!), false)
  })
})

/* ----------------------------------------------------------------- Beträge */

test('toCents', async (t) => {
  await t.test('nimmt ganze Zahlen als Cent', () => {
    assert.equal(toCents(129), 129)
    assert.equal(toCents(-50), -50)
    assert.equal(toCents(0), 0)
  })

  await t.test('liest eine Kommazahl als Euro', () => {
    // Halbe Cent gibt es auf keinem Bon, also war Euro gemeint.
    assert.equal(toCents(1.29), 129)
    assert.equal(toCents(12.5), 1250)
  })

  await t.test('nimmt auch Text mit deutschem Komma', () => {
    assert.equal(toCents('1,29'), 129)
    assert.equal(toCents('2,00 EUR'), 200)
    assert.equal(toCents('129'), 129)
  })

  await t.test('gibt null zurück statt zu raten', () => {
    assert.equal(toCents(null), null)
    assert.equal(toCents(undefined), null)
    assert.equal(toCents('unlesbar'), null)
  })
})

/* ------------------------------------------------------------------ Mengen */

test('Mengen', async (t) => {
  await t.test('übernimmt eine saubere Basiseinheit', () => {
    const item = receipt([
      { rohtext: 'RINDERHACK', menge: 1120, einheit: 'kg', einzelpreis_cent: 179, zeilensumme_cent: 200 },
    ]).items[0]
    assert.equal(item.quantityBase, 1120)
    assert.equal(item.quantityUnit, 'kg')
  })

  await t.test('rechnet eine Kommazahl in die Basiseinheit um', () => {
    const result = receipt([
      { rohtext: 'RINDERHACK', menge: 1.12, einheit: 'kg', einzelpreis_cent: 179, zeilensumme_cent: 200 },
    ])
    assert.equal(result.items[0].quantityBase, 1120)
    assert.ok(result.warnings.some((w) => w.code === 'menge_umgerechnet'))
  })

  await t.test('stellt eine falsche Einheit nur um, wenn die Rechnung es belegt', () => {
    // "2 kg × 1,99 €/kg = 3,98 €": als 2 Gramm gelesen ginge die Zeile nicht auf,
    // als 2 Kilo schon. Deshalb — und nur deshalb — wird umgestellt.
    const result = receipt([
      { rohtext: 'BANANEN', menge: 2, einheit: 'kg', einzelpreis_cent: 199, zeilensumme_cent: 398 },
    ])
    assert.equal(result.items[0].quantityBase, 2000)
    assert.ok(result.warnings.some((w) => w.code === 'menge_umgerechnet'))
  })

  await t.test('meldet eine Menge, die zu keiner Lesart passt', () => {
    const result = receipt([
      { rohtext: 'IRGENDWAS', menge: 7, einheit: 'kg', einzelpreis_cent: 199, zeilensumme_cent: 500 },
    ])
    // Menge und Zeilensumme bleiben stehen: Welcher Wert der falsche ist, weiß
    // hier niemand. Verworfen wird nur der Einzelpreis.
    assert.equal(result.items[0].quantityBase, 7)
    assert.equal(result.items[0].totalCents, 500)
    assert.equal(result.items[0].unitPriceCents, null)
    assert.ok(result.warnings.some((w) => w.code === 'einzelpreis_verworfen'))
  })

  await t.test('„ohne Mengenangabe" ist kein Fehler', () => {
    const result = receipt([{ rohtext: 'HÄHNCHENBRUST', zeilensumme_cent: 599 }], {
      summe_cent: 599,
    })
    assert.equal(result.items[0].quantityBase, null)
    assert.equal(result.items[0].quantityUnit, null)
    // Kein Fehler, keine Warnung — laut PROJEKT.md ein echter Zustand.
    assert.equal(result.warnings.length, 0)
  })

  await t.test('nimmt Stück in jeder Schreibweise', () => {
    for (const einheit of ['stk', 'Stk', 'Stück', 'ST']) {
      const item = receipt([
        { rohtext: 'JOGHURT', menge: 2, einheit, einzelpreis_cent: 129, zeilensumme_cent: 258 },
      ]).items[0]
      assert.equal(item.quantityUnit, 'stk', `Einheit ${einheit}`)
      assert.equal(item.quantityBase, 2)
    }
  })
})

/* -------------------------------------------------- Einzelpreis-Gegenprobe */

test('Einzelpreis gegen die Zeilensumme', async (t) => {
  await t.test('lässt einen stimmigen Einzelpreis durch', () => {
    const result = receipt(
      [{ rohtext: 'SPRUEHSAHNE 30%', menge: 2, einheit: 'stk', einzelpreis_cent: 99, zeilensumme_cent: 198 }],
      { summe_cent: 198 },
    )
    assert.equal(result.items[0].unitPriceCents, 99)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('verwirft einen Einzelpreis aus der Zeile darüber', () => {
    /*
     * Der Fall vom REWE-Bon: Die Mengenzeile "2 Stk x 0,99" gehört zur
     * Sprühsahne, das Modell hat die 0,99 aber an die folgende Position
     * gehängt. Ohne Menge muss der Einzelpreis die Zeilensumme sein — 99 ist
     * es nicht, also fliegt er raus.
     */
    const result = receipt(
      [{ rohtext: 'VANILLE MILCHSCHOKOSTR', einzelpreis_cent: 99, zeilensumme_cent: 199 }],
      { summe_cent: 199 },
    )
    assert.equal(result.items[0].unitPriceCents, null)
    assert.equal(result.items[0].totalCents, 199)
    assert.ok(result.warnings.some((w) => w.code === 'einzelpreis_verworfen'))
  })

  await t.test('lässt Einzelpreis gleich Zeilensumme unangetastet', () => {
    const result = receipt(
      [{ rohtext: 'VANILLE MILCHSCHOKOSTR', einzelpreis_cent: 199, zeilensumme_cent: 199 }],
      { summe_cent: 199 },
    )
    assert.equal(result.items[0].unitPriceCents, 199)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('verzeiht den Rundungscent bei Gewichtsware', () => {
    // 1,120 kg × 1,79 €/kg = 2,0048 €, gedruckt sind 2,00 €.
    const result = receipt(
      [{ rohtext: 'RINDERHACK', menge: 1120, einheit: 'kg', einzelpreis_cent: 179, zeilensumme_cent: 200 }],
      { summe_cent: 200 },
    )
    assert.equal(result.items[0].unitPriceCents, 179)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('prüft Pfand und Rabatt nicht gegen', () => {
    // "2 Stück × Einzelpreis" ist bei einem Rabatt keine sinnvolle Rechnung.
    const result = receipt(
      [{ rohtext: 'AKTION', art: 'rabatt', einzelpreis_cent: 50, zeilensumme_cent: -50 }],
      { summe_cent: -50 },
    )
    assert.equal(result.items[0].unitPriceCents, 50)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('prüft die bereinigte Menge, nicht die gelieferte', () => {
    // Erst wird 1.12 zu 1120 umgerechnet, dann geht die Gegenprobe auf — die
    // Zeile darf danach nicht trotzdem als unstimmig gelten.
    const result = receipt(
      [{ rohtext: 'RINDERHACK', menge: 1.12, einheit: 'kg', einzelpreis_cent: 179, zeilensumme_cent: 200 }],
      { summe_cent: 200 },
    )
    assert.equal(result.items[0].unitPriceCents, 179)
    assert.ok(!result.warnings.some((w) => w.code === 'einzelpreis_verworfen'))
  })
})

/* ----------------------------------------------------- Kategorie und Merkmale */

test('Zuordnung gegen die Datenbank', async (t) => {
  await t.test('übernimmt bekannte Schlüssel', () => {
    const suggestion = receipt([
      {
        rohtext: 'G&G H-MILCH',
        zeilensumme_cent: 129,
        vorschlag: {
          name: 'H-Milch 1,5 % Fett',
          kategorie: 'dairy',
          merkmale: ['milch', 'uht'],
          milch_erhitzung: 'uht',
          milch_homogenisiert: 'unbekannt',
        },
      },
    ]).items[0].suggestion
    assert.equal(suggestion?.categoryKey, 'dairy')
    assert.deepEqual(suggestion?.traitKeys, ['milch', 'uht'])
    assert.equal(suggestion?.milkHeat, 'uht')
  })

  await t.test('verwirft erfundene Merkmale', () => {
    const result = receipt([
      {
        rohtext: 'MILCH',
        zeilensumme_cent: 129,
        vorschlag: { kategorie: 'dairy', merkmale: ['milch', 'laktose', 'bio'] },
      },
    ])
    assert.deepEqual(result.items[0].suggestion?.traitKeys, ['milch'])
    assert.ok(result.warnings.some((w) => w.code === 'merkmal_verworfen'))
  })

  await t.test('lässt eine unbekannte Kategorie offen statt zu raten', () => {
    const result = receipt([
      { rohtext: 'BANANEN', zeilensumme_cent: 199, vorschlag: { kategorie: 'obst' } },
    ])
    assert.equal(result.items[0].suggestion?.categoryKey, null)
    assert.ok(result.warnings.some((w) => w.code === 'kategorie_unbekannt'))
  })

  await t.test('macht aus unbekannten Milchangaben „unbekannt"', () => {
    const suggestion = receipt([
      {
        rohtext: 'MILCH',
        zeilensumme_cent: 129,
        vorschlag: { kategorie: 'dairy', milch_erhitzung: 'vielleicht uht', milch_homogenisiert: 'ja' },
      },
    ]).items[0].suggestion
    assert.equal(suggestion?.milkHeat, 'unbekannt')
    assert.equal(suggestion?.milkHomogenized, 'ja')
  })

  await t.test('Pfand und Rabatt bekommen keinen Vorschlag', () => {
    const items = receipt([
      { rohtext: 'PFAND 0,25', art: 'pfand', zeilensumme_cent: 25, vorschlag: { kategorie: 'drinks' } },
      { rohtext: 'RABATT', art: 'rabatt', zeilensumme_cent: -50 },
    ]).items
    assert.equal(items[0].suggestion, null)
    assert.equal(items[1].suggestion, null)
  })
})

/* ------------------------------------------------------- Pfand und Rabatt */

test('Pfand und Rabatt', async (t) => {
  await t.test('Pfand ist eine eigene Position mit Pfandbetrag', () => {
    const item = receipt([{ rohtext: 'PFAND 0,25', art: 'pfand', zeilensumme_cent: 25 }]).items[0]
    assert.equal(item.kind, 'pfand')
    assert.equal(item.totalCents, 25)
    assert.equal(item.depositCents, 25)
  })

  await t.test('ein Rabatt zählt negativ, auch wenn das Modell ihn positiv liefert', () => {
    const item = receipt([{ rohtext: 'AKTION', art: 'rabatt', zeilensumme_cent: 50 }]).items[0]
    assert.equal(item.totalCents, -50)
    assert.equal(item.discountCents, 50)
  })
})

/* --------------------------------------------------------- Der Steuerblock */

test('Abgleich je Steuerklasse', async (t) => {
  /*
   * Der Bon, an dem es aufgefallen ist. Fünf Zeilen mit eigenem Preis, das
   * Modell hat vier daraus gemacht: „VANILLE" (1,99 B) und „MILCHSCHOKOSTR"
   * (0,99 B) wurden zu einem Artikel zusammengezogen.
   */
  const vollstaendig = [
    { rohtext: 'SPRUEHSAHNE 30%', menge: 2, einheit: 'stk', einzelpreis_cent: 99, zeilensumme_cent: 198, steuer: 'B' },
    { rohtext: 'VANILLE', einzelpreis_cent: 199, zeilensumme_cent: 199, steuer: 'B' },
    { rohtext: 'MILCHSCHOKOSTR', einzelpreis_cent: 99, zeilensumme_cent: 99, steuer: 'B' },
    { rohtext: 'KL.PAPIERTASCHE', einzelpreis_cent: 10, zeilensumme_cent: 10, steuer: 'A' },
    { rohtext: 'TRINKHALME', einzelpreis_cent: 149, zeilensumme_cent: 149, steuer: 'A' },
  ]

  const block = [
    { kennzeichen: 'A', brutto_cent: 159 },
    { kennzeichen: 'B', brutto_cent: 496 },
  ]

  await t.test('meldet nichts, wenn jede Klasse aufgeht', () => {
    const result = receipt(vollstaendig, { summe_cent: 655, steuerblock: block })
    assert.equal(result.itemsTotalCents, 655)
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(
      result.taxGroups.map((g) => [g.code, g.differenceCents]),
      [
        ['A', 0],
        ['B', 0],
      ],
    )
  })

  await t.test('zeigt, in welcher Klasse etwas fehlt', () => {
    // Genau der Fehlerfall: die 0,99-Zeile fehlt.
    const result = receipt(
      vollstaendig.filter((item) => item.rohtext !== 'MILCHSCHOKOSTR'),
      { summe_cent: 655, steuerblock: block },
    )

    const gruppen = new Map(result.taxGroups.map((g) => [g.code, g.differenceCents]))
    assert.equal(gruppen.get('A'), 0, 'Klasse A stimmt')
    assert.equal(gruppen.get('B'), 99, 'in Klasse B fehlen 0,99 €')

    const warnung = result.warnings.find((w) => w.code === 'steuerklasse_weicht_ab')
    assert.ok(warnung)
    assert.match(warnung.message, /Steuerklasse B/)
    assert.match(warnung.message, /0,99 €/)
    // Der Gesamtabgleich meldet weiterhin, *dass* etwas fehlt.
    assert.ok(result.warnings.some((w) => w.code === 'summe_weicht_ab'))
  })

  await t.test('lässt den Abgleich aus, wenn ein Kennzeichen fehlt', () => {
    // Sonst wäre eine Klasse zu niedrig und es hagelte Warnungen, die nur ein
    // einziges nicht gelesenes Kennzeichen bedeuten.
    const ohneKennzeichen = vollstaendig.map((item, index) =>
      index === 0 ? { ...item, steuer: null } : item,
    )
    const result = receipt(ohneKennzeichen, { summe_cent: 655, steuerblock: block })
    assert.deepEqual(result.taxGroups, [])
    assert.ok(result.warnings.some((w) => w.code === 'steuer_kennzeichen_fehlt'))
    assert.ok(!result.warnings.some((w) => w.code === 'steuerklasse_weicht_ab'))
  })

  await t.test('verwirft einen Steuerblock, der nicht zur Gesamtsumme passt', () => {
    const result = receipt(vollstaendig, {
      summe_cent: 655,
      steuerblock: [
        { kennzeichen: 'A', brutto_cent: 159 },
        { kennzeichen: 'B', brutto_cent: 400 },
      ],
    })
    assert.deepEqual(result.taxGroups, [])
    assert.ok(result.warnings.some((w) => w.code === 'steuerblock_unstimmig'))
    assert.ok(!result.warnings.some((w) => w.code === 'steuerklasse_weicht_ab'))
  })

  await t.test('übergeht die Gesamtbetrag-Zeile im Block', () => {
    // Sie ist keine Steuerklasse; „Gesamtbetrag" ist kein gültiges Kennzeichen
    // und fällt schon beim Einlesen heraus.
    const result = receipt(vollstaendig, {
      summe_cent: 655,
      steuerblock: [...block, { kennzeichen: 'Gesamtbetrag', brutto_cent: 655 }],
    })
    assert.equal(result.taxGroups.length, 2)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('meldet ein Kennzeichen, das im Block fehlt', () => {
    const result = receipt(
      [
        { rohtext: 'A-WARE', einzelpreis_cent: 159, zeilensumme_cent: 159, steuer: 'A' },
        { rohtext: 'C-WARE', einzelpreis_cent: 496, zeilensumme_cent: 496, steuer: 'C' },
      ],
      { summe_cent: 655, steuerblock: block },
    )
    assert.ok(result.warnings.some((w) => w.code === 'steuerklasse_unbekannt'))
  })

  await t.test('ohne Steuerblock bleibt es beim Gesamtabgleich', () => {
    const result = receipt(vollstaendig, { summe_cent: 655 })
    assert.deepEqual(result.taxGroups, [])
    assert.equal(result.warnings.length, 0)
  })

  await t.test('liest das Kennzeichen je Position mit', () => {
    const items = receipt(vollstaendig, { summe_cent: 655, steuerblock: block }).items
    assert.deepEqual(
      items.map((item) => item.taxCode),
      ['B', 'B', 'B', 'A', 'A'],
    )
  })

  await t.test('normalisiert Schreibweisen des Kennzeichens', () => {
    const items = receipt([
      { rohtext: 'A', zeilensumme_cent: 100, steuer: ' b ' },
      { rohtext: 'B', zeilensumme_cent: 100, steuer: 'A=' },
      { rohtext: 'C', zeilensumme_cent: 100, steuer: 'Mehrwertsteuer' },
    ]).items
    assert.deepEqual(
      items.map((item) => item.taxCode),
      ['B', 'A', null],
    )
  })
})

/* --------------------------------------------------------- Der ganze Bon */

test('Bon als Ganzes', async (t) => {
  await t.test('gleicht die Positionen gegen die gedruckte Summe ab', () => {
    const result = receipt(
      [
        { rohtext: 'MILCH', zeilensumme_cent: 129 },
        { rohtext: 'BROT', zeilensumme_cent: 249 },
      ],
      { summe_cent: 378 },
    )
    assert.equal(result.itemsTotalCents, 378)
    assert.equal(result.discrepancyCents, 0)
    assert.equal(result.warnings.length, 0)
  })

  await t.test('markiert eine Abweichung, statt den Bon abzulehnen', () => {
    const result = receipt([{ rohtext: 'MILCH', zeilensumme_cent: 129 }], { summe_cent: 148 })
    assert.equal(result.discrepancyCents, 19)
    assert.equal(result.items.length, 1)
    const warning = result.warnings.find((w) => w.code === 'summe_weicht_ab')
    assert.ok(warning)
    assert.match(warning.message, /0,19 €/)
  })

  await t.test('kommt ohne gedruckte Summe zurecht', () => {
    const result = receipt([{ rohtext: 'MILCH', zeilensumme_cent: 129 }])
    assert.equal(result.printedTotalCents, null)
    assert.equal(result.discrepancyCents, null)
    assert.ok(result.warnings.some((w) => w.code === 'summe_fehlt'))
  })

  await t.test('nummeriert die Zeilen selbst durch', () => {
    // Zweimal dieselbe Nummer vom Modell darf nicht durchkommen: In der
    // Datenbank ist (receipt_id, line_no) eindeutig.
    const items = receipt([
      { zeile: 3, rohtext: 'A', zeilensumme_cent: 100 },
      { zeile: 3, rohtext: 'B', zeilensumme_cent: 200 },
    ]).items
    assert.deepEqual(
      items.map((item) => item.lineNo),
      [1, 2],
    )
  })

  await t.test('behält eine Position ohne lesbaren Betrag', () => {
    const result = receipt([{ rohtext: 'VERWISCHT' }])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].totalCents, 0)
    assert.ok(result.warnings.some((w) => w.code === 'betrag_fehlt'))
  })

  await t.test('meldet fehlenden Händler und fehlendes Datum', () => {
    const result = validateExtraction({ lesbar: true, positionen: [] }, CONTEXT)
    assert.ok(result.warnings.some((w) => w.code === 'haendler_fehlt'))
    assert.ok(result.warnings.some((w) => w.code === 'datum_fehlt'))
  })

  await t.test('weist ein Datum zurück, das es nicht gibt', () => {
    const result = validateExtraction(
      { lesbar: true, datum: '2026-02-31', uhrzeit: '25:00', positionen: [] },
      CONTEXT,
    )
    assert.equal(result.purchasedOn, null)
    assert.equal(result.purchasedAt, null)
  })

  await t.test('stürzt nicht über eine Antwort ohne Positionen', () => {
    const result = validateExtraction({ lesbar: true }, CONTEXT)
    assert.deepEqual(result.items, [])
    assert.equal(result.itemsTotalCents, 0)
  })
})
