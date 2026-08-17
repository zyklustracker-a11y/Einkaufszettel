import test from 'node:test'
import assert from 'node:assert/strict'
import { EDEKA, TOOM } from './fixtures.ts'
import { validateExtraction } from './validate.ts'
import { recoverModelJson } from './validate.ts'

/**
 * Die beiden echten Bons durch die ganze Prüfkette.
 *
 * Was hier geprüft wird und was nicht, steht ausführlich im Kopf von
 * `fixtures.ts`. Die Kurzfassung: Die **Kopf- und Fußangaben** sind vom Foto
 * zweifelsfrei lesbar und werden festgenagelt. Die **Zeilenbeträge** sind eine
 * Abschrift nach bestem Lesen und stimmen nicht — deshalb prüft der letzte
 * Block, dass die App genau damit richtig umgeht: warnen, ins Formular lassen,
 * nicht ablehnen.
 */

/* ================================================================== Edeka */

test('Edeka-Bon (Schmidts Märkte)', async (t) => {
  const bon = validateExtraction(EDEKA.model, EDEKA.today)

  await t.test('Händler, Datum und Summe', () => {
    assert.equal(bon.merchantName, 'Schmidts Märkte GmbH')
    assert.equal(bon.purchasedOn, '2026-07-16')
    assert.equal(bon.purchasedAt, '20:14')
    assert.equal(bon.printedTotalCents, 12067)
    assert.equal(bon.currency, 'EUR')
  })

  await t.test('jede abgetippte Zeile wird eine Position', () => {
    // Kein Betrag darf beim Aufteilen verloren gehen — das ist die Zusicherung,
    // wegen der `lines.ts` überhaupt existiert.
    assert.equal(bon.items.length, EDEKA.model.zeilen!.length)
    assert.deepEqual(bon.unassignedLines, [])
  })

  await t.test('die Edeka-Mengenzeile „0,99 € x 2"', () => {
    const brot = bon.items.find((item) => item.rawText.startsWith('BIO ALNA.D.BR'))
    assert.ok(brot, 'Position nicht gefunden')
    assert.equal(brot.quantityBase, 2)
    assert.equal(brot.quantityUnit, 'stk')
    // 0,99 und nicht 1,98: Sonst verglichen die Bestpreise Doppelpackungen mit
    // Einzelstücken.
    assert.equal(brot.unitPriceCents, 99)
    assert.equal(brot.totalCents, 198)
    // Und die Mengenangabe steckt nicht mehr im Namen.
    assert.equal(brot.rawText, 'BIO ALNA.D.BR')
  })

  await t.test('das zweistellige Kennzeichen „AW"', () => {
    const melone = bon.items.find((item) => item.rawText.includes('WASSERMEL'))
    assert.equal(melone?.taxCode, 'AW')
    assert.equal(melone?.totalCents, 1202)
  })

  await t.test('Pfand wird als Pfand geführt', () => {
    const pfand = bon.items.find((item) => item.kind === 'pfand')
    assert.ok(pfand, 'keine Pfandzeile erkannt')
    assert.equal(pfand.depositCents, 15)
  })

  await t.test('der gedruckte Steuerblock kommt an', () => {
    assert.deepEqual(
      bon.printedTaxGroups.map((group) => [group.code, group.grossCents]),
      [
        ['A', 9622],
        ['B', 2445],
      ],
    )
  })

  await t.test('die Postenzahl wird abgeglichen', () => {
    // Der Bon nennt 35 Posten, die Abschrift hat 32. Genau dafür ist die
    // Prüfung da: Sie bemerkt eine fehlende Zeile auch dann, wenn ihr Betrag
    // klein genug wäre, um im Summenabgleich unterzugehen.
    const warning = bon.warnings.find((w) => w.code === 'postenzahl_weicht_ab')
    assert.ok(warning, 'kein Abgleich der Postenzahl')
    assert.match(warning.message, /35/)
  })

  await t.test('das Datum gilt als plausibel', () => {
    assert.ok(!bon.warnings.some((w) => w.code === 'datum_unplausibel'))
  })

  await t.test('der Händlername gilt als plausibel', () => {
    assert.ok(!bon.warnings.some((w) => w.code === 'haendler_unplausibel'))
  })
})

/* =================================================================== toom */

test('toom-Bon (Baumarkt)', async (t) => {
  const bon = validateExtraction(TOOM.model, TOOM.today)

  await t.test('Händler, Datum und Summe', () => {
    assert.equal(bon.merchantName, 'toom Baumarkt GmbH')
    assert.equal(bon.purchasedOn, '2026-07-02')
    assert.equal(bon.printedTotalCents, 8775)
  })

  await t.test('jede Zeile wird eine Position — trotz Ziffern-Kennzeichen', () => {
    /*
     * DER TEST, DER DEN GRÖSSTEN EINZELFEHLER FESTNAGELT: Bis Schritt 18 ließ
     * das Muster für den Betrag am Zeilenende nur Buchstaben als Kennzeichen
     * zu. Eine „7" hat den Treffer nicht verfälscht, sondern verhindert — jede
     * Zeile wurde zum Namensfragment, und dieser Bon hätte NULL Positionen
     * ergeben, egal wie gut das Modell gelesen hätte.
     */
    assert.equal(bon.items.length, 13)
    assert.deepEqual(bon.unassignedLines, [])
  })

  await t.test('die Baumarkt-Mengenzeile „2,000 STK a 5,99"', () => {
    const mix = bon.items[0]
    assert.equal(mix.rawText, 'Calibrachoa-Mix')
    assert.equal(mix.quantityBase, 2)
    assert.equal(mix.quantityUnit, 'stk')
    assert.equal(mix.unitPriceCents, 599)
    assert.equal(mix.totalCents, 1198)
    assert.equal(mix.taxCode, '7')
  })

  await t.test('Steuersätze als Ziffern, ein- und zweistellig', () => {
    const codes = new Set(bon.items.map((item) => item.taxCode))
    assert.ok(codes.has('7'), 'kein Kennzeichen 7')
    assert.ok(codes.has('19'), 'kein Kennzeichen 19')
  })

  await t.test('die Ziffer gehört nicht zum Betrag', () => {
    // „14,99 19" sind 14,99 Euro und Steuersatz 19 — nicht 14,99 mit
    // angehängter 19 oder gar 1499,19.
    const klett = bon.items.find((item) => item.rawText.includes('Klett'))
    assert.equal(klett?.totalCents, 1499)
    assert.equal(klett?.taxCode, '19')
  })

  await t.test('die Artikelnummer steht nicht im Rohtext', () => {
    /*
     * Wichtiger, als es aussieht: Der Rohtext ist der Schlüssel des
     * Lernkreises. Stünde die EAN darin, wäre jede Zeile ein eigener, nie
     * wieder auftauchender Schlüssel — und der Haushalt lernte nie etwas.
     */
    for (const item of bon.items) {
      assert.ok(!/\d{6,}/.test(item.rawText), `Artikelnummer im Rohtext: „${item.rawText}"`)
    }
  })

  await t.test('Umlaute und Kommas im Namen überleben', () => {
    assert.ok(bon.items.some((item) => item.rawText === 'PETERSILIE, KRAU'))
    assert.ok(bon.items.some((item) => item.rawText === 'Klett für Fenste'))
  })
})

/* ============================================ Was bei Lücken passieren muss */

test('unvollständig gelesene Bons werden markiert, nicht abgelehnt', async (t) => {
  for (const [name, fixture] of [
    ['Edeka', EDEKA],
    ['toom', TOOM],
  ] as const) {
    await t.test(`${name}: die Abweichung wird benannt`, () => {
      const bon = validateExtraction(fixture.model, fixture.today)

      if (fixture.erwartet.summeStimmt) {
        assert.equal(bon.discrepancyCents, 0)
        return
      }

      // Die Abschrift kommt nicht auf die gedruckte Summe (siehe fixtures.ts).
      // Genau das muss die App sagen — und zwar als Warnung.
      assert.notEqual(bon.discrepancyCents, 0)
      assert.ok(
        bon.warnings.some((w) => w.code === 'summe_weicht_ab'),
        'keine Warnung zur Summe',
      )
    })

    await t.test(`${name}: der Bon bleibt trotzdem verwertbar`, () => {
      const bon = validateExtraction(fixture.model, fixture.today)

      // Abnahmekriterium 2: Der Nutzer landet nie in einer Sackgasse. Alle drei
      // Anker sind da, also geht es ins Formular.
      assert.ok(bon.merchantName)
      assert.ok(bon.printedTotalCents)
      assert.ok(bon.items.length > 0)
    })

    await t.test(`${name}: die gedruckte Summe wird nicht überschrieben`, () => {
      const bon = validateExtraction(fixture.model, fixture.today)
      // Sie kommt vom Papier und bleibt, was sie ist — auch wenn die Positionen
      // etwas anderes ergeben. Die App rechnet nichts glatt.
      assert.equal(bon.printedTotalCents, fixture.erwartet.summeCent)
    })
  }
})

/* ====================================== Der Weg durch das Parsen der Antwort */

test('beide Bons überstehen eine abgeschnittene Antwort', async (t) => {
  for (const [name, fixture] of [
    ['Edeka', EDEKA],
    ['toom', TOOM],
  ] as const) {
    await t.test(`${name}: hinten abgeschnitten ergibt ein Teilergebnis`, () => {
      /*
       * Der Fall, mit dem alles anfing: Die Antwort endet an der Token-Grenze.
       * Nachgestellt, indem das JSON bei 70 % abgeschnitten wird.
       */
      const voll = JSON.stringify(fixture.model)
      const kurz = voll.slice(0, Math.floor(voll.length * 0.7))

      const recovered = recoverModelJson(kurz)
      assert.notEqual(recovered.receipt, null, 'nichts gerettet')
      assert.equal(recovered.repaired, true)

      const bon = validateExtraction(recovered.receipt!, fixture.today)
      // Der Kopf steht am Anfang der Antwort und ist deshalb heil.
      assert.equal(bon.merchantName, fixture.erwartet.haendler)
      assert.equal(bon.printedTotalCents, fixture.erwartet.summeCent)
      // Und ein Teil der Zeilen ist da — mehr als nichts, weniger als alles.
      assert.ok(bon.items.length > 0, 'keine einzige Position gerettet')
      assert.ok(bon.items.length < fixture.model.zeilen!.length)
    })

    await t.test(`${name}: in Markdown-Zäune verpackt`, () => {
      const raw = '```json\n' + JSON.stringify(fixture.model) + '\n```'
      const bon = validateExtraction(recoverModelJson(raw).receipt!, fixture.today)
      assert.equal(bon.merchantName, fixture.erwartet.haendler)
      assert.equal(bon.items.length, fixture.model.zeilen!.length)
    })

    await t.test(`${name}: mit Vorrede davor`, () => {
      const raw = 'Gerne! Hier ist der Bon:\n\n' + JSON.stringify(fixture.model)
      const bon = validateExtraction(recoverModelJson(raw).receipt!, fixture.today)
      assert.equal(bon.items.length, fixture.model.zeilen!.length)
    })
  }
})
