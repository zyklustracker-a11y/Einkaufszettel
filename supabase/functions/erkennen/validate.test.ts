import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isUnreadable,
  parseModelJson,
  recoverModelJson,
  toCents,
  validateExtraction,
} from './validate.ts'

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

/**
 * Der „heutige" Tag für die Tests.
 *
 * Seit Schritt 18 prüft `validateExtraction` das Bon-Datum auf Plausibilität.
 * Ohne einen festen Bezugstag würden die Tests hier mit dem Kalender altern:
 * Der REWE-Beispielbon von 2017 wäre irgendwann „mehr als zwei Jahre her", und
 * ein Test, der von selbst rot wird, wird abgeschaltet statt gelesen.
 */
const HEUTE = '2026-08-17'

/** Derselbe Bezugstag für den alten Beispielbon von 2017. */
const DAMALS = '2017-07-01'

/** Kürzel für „ein Bon mit genau diesen Positionen". */
function receipt(positionen: unknown[], rest: Record<string, unknown> = {}) {
  return validateExtraction(
    {
      lesbar: true,
      haendler: 'REWE',
      datum: '2026-08-14',
      positionen,
      ...rest,
    },
    HEUTE,
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

  await t.test('schließt eine abgeschnittene Antwort, statt sie wegzuwerfen', () => {
    /*
     * GEÄNDERT MIT SCHRITT 18. Hier stand vorher „repariert kaputtes JSON
     * nicht" und erwartete null — mit der Begründung, aus einer halben Antwort
     * dürfe kein scheinbar vollständiger Bon werden.
     *
     * Die Begründung stimmt, die Schlussfolgerung nicht. Eine an `max_tokens`
     * abgeschnittene Antwort ist nicht kaputt, sondern unfertig, und die Zeilen
     * davor sind heil. Sie wegzuwerfen, hat die Erkennung bei jedem langen Bon
     * scheitern lassen. Der Schutz vor dem „scheinbar vollständigen Bon" liegt
     * jetzt woanders, und zwar an zwei Stellen: `repaired` markiert das
     * Teilergebnis bis in die Oberfläche, und der Summenabgleich zeigt genau
     * auf das, was fehlt.
     */
    const result = recoverModelJson('{"lesbar":true, "positionen":[{')
    assert.deepEqual(result.receipt, { lesbar: true })
    assert.equal(result.repaired, true)
  })

  await t.test('meldet eine heile Antwort als nicht repariert', () => {
    const result = recoverModelJson('{"lesbar":true}')
    assert.equal(result.repaired, false)
    assert.equal(result.droppedChars, 0)
  })

  await t.test('gibt null zurück, wenn sich gar nichts retten lässt', () => {
    assert.equal(recoverModelJson('völlig ohne JSON').receipt, null)
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

/* ------------------------------------------------- Der Weg über die Zeilen */

test('aus abgetippten Zeilen werden Positionen', async (t) => {
  /** Der REWE-Bon vom 23.06.2017, an dem das Modell dreimal gescheitert ist. */
  const zeilen = [
    'SPRUEHSAHNE 30%',
    '  2 Stk x   0,99          1,98 B',
    'VANILLE                   1,99 B',
    'MILCHSCHOKOSTR            0,99 B',
    'KL.PAPIERTASCHE           0,10 A',
    'TRINKHALME                1,49 A',
  ]

  const bon = validateExtraction(
    {
      lesbar: true,
      haendler: 'REWE CITY',
      datum: '2017-06-23',
      summe_cent: 655,
      steuerblock: [
        { kennzeichen: 'A', brutto_cent: 159 },
        { kennzeichen: 'B', brutto_cent: 496 },
      ],
      zeilen,
    },
    DAMALS,
  )

  await t.test('fünf Positionen, keine Warnung', () => {
    assert.equal(bon.items.length, 5)
    assert.equal(bon.itemsTotalCents, 655)
    assert.equal(bon.discrepancyCents, 0)
    assert.deepEqual(bon.warnings, [])
  })

  await t.test('beide Steuerklassen stimmen', () => {
    assert.deepEqual(
      bon.taxGroups.map((group) => group.differenceCents),
      [0, 0],
    )
  })

  await t.test('die Mengenzeile landet bei der Sprühsahne', () => {
    const sahne = bon.items[0]
    assert.equal(sahne.quantityBase, 2)
    assert.equal(sahne.quantityUnit, 'stk')
    assert.equal(sahne.unitPriceCents, 99)
    assert.equal(sahne.totalCents, 198)
  })

  await t.test('die Zeilen bleiben erhalten', () => {
    assert.equal(bon.lines.length, 6)
    assert.deepEqual(bon.unassignedLines, [])
    assert.deepEqual(bon.items[2].sourceLines, ['MILCHSCHOKOSTR 0,99 B'])
  })

  await t.test('eine verschluckte Zeile wird als Lesefehler benannt', () => {
    // Dasselbe ohne die Milchschokostreusel: Die App kann jetzt sagen, dass es
    // am Abtippen liegt und nicht am Deuten — die Aufteilung rechnet sie selbst.
    const luecke = validateExtraction(
      {
        lesbar: true,
        haendler: 'REWE CITY',
        datum: '2017-06-23',
        summe_cent: 655,
        zeilen: zeilen.filter((line) => !line.startsWith('MILCHSCHOKOSTR')),
      },
      DAMALS,
    )
    assert.equal(luecke.discrepancyCents, 99)
    assert.ok(luecke.warnings.some((w) => w.code === 'zeilen_fehlen'))
  })

  await t.test('eine Zeile ohne Betrag wird gemeldet statt verschluckt', () => {
    const rest = validateExtraction(
      {
        lesbar: true,
        haendler: 'REWE',
        datum: '2017-06-23',
        summe_cent: 249,
        zeilen: ['BROT 2,49 B', 'VIELEN DANK'],
      },
      DAMALS,
    )
    assert.equal(rest.items.length, 1)
    assert.deepEqual(rest.unassignedLines, ['VIELEN DANK'])
    assert.ok(rest.warnings.some((w) => w.code === 'zeile_nicht_zugeordnet'))
  })
})

/* ------------------------------------------------- Struktur bleibt Struktur */

test('Durchgang 1 ordnet nichts zu', async (t) => {
  await t.test('lässt jede Position ohne Zuordnung', () => {
    // Die Zuordnung kommt aus der Datenbank (`mappings.ts`) oder aus
    // Durchgang 2 (`assign.ts`) — hier entsteht sie nie.
    const items = receipt([
      { rohtext: 'G&G H-MILCH', zeilensumme_cent: 129 },
      { rohtext: 'PFAND 0,25', art: 'pfand', zeilensumme_cent: 25 },
    ]).items
    assert.equal(items[0].suggestion, null)
    assert.equal(items[1].suggestion, null)
  })

  await t.test('übergeht einen Vorschlag, den das Modell trotzdem mitschickt', () => {
    /*
     * Der Struktur-Prompt fragt nicht danach. Liefert das Modell aus alter
     * Gewohnheit dennoch einen Vorschlag, wird er stillschweigend übergangen
     * statt ungeprüft übernommen: Er hat weder Kategorien noch Merkmale des
     * Haushalts gesehen.
     */
    const result = receipt(
      [
        {
          rohtext: 'MILCH',
          zeilensumme_cent: 129,
          vorschlag: { name: 'Milch', kategorie: 'dairy', merkmale: ['laktose'] },
        },
      ],
      { summe_cent: 129 },
    )
    assert.equal(result.items[0].suggestion, null)
    assert.equal(result.items[0].rawText, 'MILCH')
    assert.equal(result.items[0].totalCents, 129)
    assert.equal(result.warnings.length, 0)
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
    const result = validateExtraction({ lesbar: true, positionen: [] })
    assert.ok(result.warnings.some((w) => w.code === 'haendler_fehlt'))
    assert.ok(result.warnings.some((w) => w.code === 'datum_fehlt'))
  })

  await t.test('weist ein Datum zurück, das es nicht gibt', () => {
    const result = validateExtraction({
      lesbar: true,
      datum: '2026-02-31',
      uhrzeit: '25:00',
      positionen: [],
    })
    assert.equal(result.purchasedOn, null)
    assert.equal(result.purchasedAt, null)
  })

  await t.test('stürzt nicht über eine Antwort ohne Positionen', () => {
    const result = validateExtraction({ lesbar: true })
    assert.deepEqual(result.items, [])
    assert.equal(result.itemsTotalCents, 0)
  })
})

/* ----------------------------------------------------- Tankbeleg, Toleranz */

test('Toleranz wächst mit der Menge', async (t) => {
  await t.test('ein Literpreis überlebt das Runden auf ganze Cent', () => {
    /*
     * 38,45 L × 1,779 EUR/L sind gedruckt 68,41 €. Der Einzelpreis steht als
     * ganze Zahl in Cent, also als 178 — und 38,45 × 1,78 ergibt 68,44. Mit
     * einer festen Grenze von zwei Cent würde der Literpreis hier verworfen,
     * und die Bestpreis-Sicht verglich danach Tankfüllungen statt Literpreise.
     */
    const bon = receipt([
      {
        rohtext: 'SUPER E10',
        menge: 38.45,
        einheit: 'l',
        einzelpreis_cent: 178,
        zeilensumme_cent: 6841,
      },
    ])

    assert.equal(bon.items[0].unitPriceCents, 178)
    assert.equal(bon.items[0].quantityBase, 38450)
    assert.equal(bon.items[0].quantityUnit, 'l')
    assert.equal(
      bon.warnings.some((warning) => warning.code === 'einzelpreis_verworfen'),
      false,
    )
  })

  await t.test('bei kleiner Menge bleibt es bei zwei Cent', () => {
    // 2 Stück à 0,99 € ergeben 1,98 €. Stehen dort 2,50 €, ist das kein
    // Rundungsfehler, sondern ein Lesefehler — und der Einzelpreis fliegt.
    const bon = receipt([
      { rohtext: 'SPRUEHSAHNE', menge: 2, einheit: 'stk', einzelpreis_cent: 99, zeilensumme_cent: 250 },
    ])

    assert.equal(bon.items[0].unitPriceCents, null)
    assert.equal(
      bon.warnings.some((warning) => warning.code === 'einzelpreis_verworfen'),
      true,
    )
  })
})

/* ============================================================================
 * SCHRITT 18 — deutsche Zahlenschreibweise
 * ========================================================================== */

test('toCents versteht das deutsche Zahlenformat', async (t) => {
  await t.test('Tausenderpunkt und Dezimalkomma', () => {
    /*
     * Die alte Fassung ersetzte nur das erste Komma und ließ den
     * Tausenderpunkt stehen: „1.234,56" wurde zu „1.234.56", `Number` gab NaN
     * zurück, und der Betrag fiel ersatzlos weg. Auf einem Baumarktbon mit
     * vierstelliger Summe ist das kein Randfall.
     */
    assert.equal(toCents('1.234,56'), 123456)
    assert.equal(toCents('12.345,00'), 1234500)
  })

  await t.test('einfaches Dezimalkomma', () => {
    assert.equal(toCents('1,29'), 129)
    assert.equal(toCents('120,67'), 12067)
  })

  await t.test('englische Schreibweise geht auch', () => {
    assert.equal(toCents('1,234.56'), 123456)
    assert.equal(toCents('1.29'), 129)
  })

  await t.test('mit Währung und Leerzeichen', () => {
    assert.equal(toCents('1.234,56 EUR'), 123456)
    assert.equal(toCents(' 87,75 € '), 8775)
  })

  await t.test('negative Beträge', () => {
    assert.equal(toCents('-0,50'), -50)
  })

  await t.test('ohne Trennzeichen sind es schon Cent', () => {
    // Der Prompt verlangt Cent als ganze Zahl. Steht kein Trennzeichen da,
    // wurde er befolgt.
    assert.equal(toCents('12067'), 12067)
    assert.equal(toCents(655), 655)
  })

  await t.test('Unsinn bleibt null', () => {
    assert.equal(toCents('keine Zahl'), null)
    assert.equal(toCents(''), null)
    assert.equal(toCents(null), null)
  })
})

/* ============================================================================
 * SCHRITT 18 — Plausibilität: warnen, nicht blockieren
 * ========================================================================== */

test('Summenabgleich mit Toleranz', async (t) => {
  await t.test('ein Cent Abweichung ist keine Warnung', () => {
    /*
     * Eine Kasse rundet bei gewichteten Waren je Zeile, und die Summe der
     * gerundeten Zeilen ist nicht immer die gerundete Summe. Eine Warnung, die
     * bei jedem zweiten Bon erscheint, liest niemand mehr.
     */
    const result = receipt([{ rohtext: 'BANANEN', zeilensumme_cent: 199 }], { summe_cent: 200 })
    assert.equal(result.discrepancyCents, 1)
    assert.ok(!result.warnings.some((w) => w.code === 'summe_weicht_ab'))
  })

  await t.test('drei Cent sind eine', () => {
    const result = receipt([{ rohtext: 'BANANEN', zeilensumme_cent: 199 }], { summe_cent: 202 })
    assert.ok(result.warnings.some((w) => w.code === 'summe_weicht_ab'))
  })

  await t.test('eine fehlende Zeile fällt weiterhin auf', () => {
    const result = receipt([{ rohtext: 'MILCH', zeilensumme_cent: 129 }], { summe_cent: 378 })
    assert.ok(result.warnings.some((w) => w.code === 'summe_weicht_ab'))
  })
})

test('Postenzahl', async (t) => {
  await t.test('stimmt die Zahl, gibt es keine Warnung', () => {
    const result = receipt(
      [
        { rohtext: 'MILCH', zeilensumme_cent: 129 },
        { rohtext: 'BROT', zeilensumme_cent: 249 },
      ],
      { summe_cent: 378, posten: 2 },
    )
    assert.ok(!result.warnings.some((w) => w.code === 'postenzahl_weicht_ab'))
  })

  await t.test('eine fehlende Zeile wird benannt', () => {
    /*
     * Der Zweck: Die gedruckte Postenzahl ist die einzige Angabe auf dem
     * Papier, die sagt, wie viele Zeilen es geben MÜSSTE. Damit fällt auch eine
     * fehlende Zeile auf, deren Betrag zu klein ist, um im Summenabgleich
     * aufzufallen.
     */
    const result = receipt([{ rohtext: 'MILCH', zeilensumme_cent: 129 }], {
      summe_cent: 129,
      posten: 35,
    })
    const warning = result.warnings.find((w) => w.code === 'postenzahl_weicht_ab')
    assert.ok(warning, 'keine Warnung zur Postenzahl')
    assert.match(warning.message, /35/)
    assert.match(warning.message, /fehlt/)
  })

  await t.test('Rabattzeilen zählen nicht als Posten', () => {
    const result = receipt(
      [
        { rohtext: 'MILCH', zeilensumme_cent: 129 },
        { rohtext: 'RABATT', art: 'rabatt', zeilensumme_cent: 50 },
      ],
      { summe_cent: 79, posten: 1 },
    )
    assert.ok(!result.warnings.some((w) => w.code === 'postenzahl_weicht_ab'))
  })

  await t.test('ohne gedruckte Postenzahl wird nicht geprüft', () => {
    const result = receipt([{ rohtext: 'MILCH', zeilensumme_cent: 129 }], { summe_cent: 129 })
    assert.ok(!result.warnings.some((w) => w.code === 'postenzahl_weicht_ab'))
  })
})

test('Datum auf Plausibilität', async (t) => {
  const bon = (datum: string, today: string) =>
    validateExtraction(
      { lesbar: true, haendler: 'REWE', datum, summe_cent: 129, zeilen: ['MILCH 1,29 B'] },
      today,
    ).warnings.filter((w) => w.code === 'datum_unplausibel')

  await t.test('heute ist in Ordnung', () => {
    assert.deepEqual(bon('2026-08-17', '2026-08-17'), [])
  })

  await t.test('gestern auch', () => {
    assert.deepEqual(bon('2026-08-16', '2026-08-17'), [])
  })

  await t.test('nächste Woche nicht', () => {
    // Ein Einkauf, der noch nicht stattgefunden hat, ist keiner. Kommt von
    // einer verlesenen Ziffer im Jahr.
    assert.equal(bon('2026-08-24', '2026-08-17').length, 1)
  })

  await t.test('ein Tag Nachsicht wegen Zeitzonen', () => {
    assert.deepEqual(bon('2026-08-18', '2026-08-17'), [])
  })

  await t.test('vor mehr als zwei Jahren nicht', () => {
    // Aus „25" wird „05", und der Bon landet zwanzig Jahre in der
    // Vergangenheit — mitten in den Auswertungen, wo ihn niemand sucht.
    assert.equal(bon('2005-08-17', '2026-08-17').length, 1)
  })

  await t.test('ein Jahr alt ist erlaubt', () => {
    // Alte Bons nachzuerfassen ist ein normaler Vorgang.
    assert.deepEqual(bon('2025-08-17', '2026-08-17'), [])
  })
})

test('Händlername auf Plausibilität', async (t) => {
  const warn = (haendler: unknown) =>
    validateExtraction(
      { lesbar: true, haendler, datum: '2026-08-14', summe_cent: 129, zeilen: ['MILCH 1,29 B'] },
      HEUTE,
    ).warnings.filter((w) => w.code === 'haendler_unplausibel')

  await t.test('normale Namen gehen durch', () => {
    for (const name of ['REWE CITY', 'E center', 'toom Baumarkt GmbH', 'ALDI SÜD Fil. 4711']) {
      assert.deepEqual(warn(name), [], `„${name}" wurde beanstandet`)
    }
  })

  await t.test('eine reine Zahlenfolge ist kein Händler', () => {
    // Fast immer eine verlesene Steuer- oder Filialnummer aus dem Bonkopf.
    assert.equal(warn('123456789').length, 1)
    assert.equal(warn('07761-5534110').length, 1)
  })

  await t.test('ein ganzer Absatz ist kein Händler', () => {
    assert.equal(warn('x'.repeat(80)).length, 1)
  })
})

/* ============================================================================
 * SCHRITT 18 — das Kennzeichen „AW"
 * ========================================================================== */

test('ein Kennzeichen mit Zusatzbuchstaben zählt zur Grundklasse', async (t) => {
  const bon = (steuer: string) =>
    validateExtraction(
      {
        lesbar: true,
        haendler: 'REWE',
        datum: '2026-08-14',
        summe_cent: 300,
        steuerblock: [
          { kennzeichen: 'A', brutto_cent: 200 },
          { kennzeichen: 'B', brutto_cent: 100 },
        ],
        zeilen: [`WASSERMELONE 2,00 ${steuer}`, 'PACKBAND 1,00 B'],
      },
      HEUTE,
    )

  await t.test('„AW" wird zu „A"', () => {
    /*
     * DER FALL VOM ECHTEN EDEKA-BON. Zwei Positionen mit „AW" (Joghurt und
     * Wassermelone, zusammen 13,79 €) fielen aus jeder Klasse heraus, obwohl
     * sie richtig gelesen waren. Die App meldete daraufhin „16,94 € fehlen in
     * A" und schickte den Nutzer auf die Suche nach einem Fehler, den es nicht
     * gab.
     *
     * „AW" ist kein eigener Steuersatz — der Satz ist das „A", das „W" ist ein
     * Vermerk der Kasse.
     */
    const result = bon('AW')
    const klasseA = result.taxGroups.find((group) => group.code === 'A')

    assert.ok(klasseA, 'keine Klasse A im Abgleich')
    assert.equal(klasseA.itemsTotalCents, 200)
    assert.equal(klasseA.differenceCents, 0)
    assert.ok(!result.warnings.some((w) => w.code === 'steuerklasse_unbekannt'))
  })

  await t.test('ein schlichtes „A" natürlich auch', () => {
    assert.equal(bon('A').taxGroups.find((group) => group.code === 'A')?.differenceCents, 0)
  })

  await t.test('ein Kennzeichen ohne Bezug bleibt eine Warnung', () => {
    // „ZW" fängt mit „Z" an, und „Z" steht nicht im Block. Hier soll nichts
    // zurechtgebogen werden — die Warnung ist die richtige Antwort.
    const result = bon('ZW')
    assert.ok(result.warnings.some((w) => w.code === 'steuerklasse_unbekannt'))
  })

  await t.test('aus B wird nie A', () => {
    // Nur nach vorn gekürzt, nie quer zugeordnet: Sonst würde aus einem
    // verlesenen Kennzeichen ein falscher Steuersatz.
    const result = bon('B')
    assert.equal(result.taxGroups.find((group) => group.code === 'B')?.itemsTotalCents, 300)
  })
})
