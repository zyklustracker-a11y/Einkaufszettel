import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLines } from './lines.ts'

/**
 * Tests für den Zeilen-Parser.
 *
 * Der erste Test ganz unten ist der wichtigste: **der echte REWE-Bon**, an dem
 * das Modell dreimal gescheitert ist. Solange dieser Test grün ist, kann die
 * Aufteilung nicht mehr davon abhängen, wie ein Modell an einem Tag gelaunt
 * ist — sie hängt an dieser Datei.
 */

/** Kürzel: nur die Rohtexte der erkannten Positionen. */
function names(lines: string[]): string[] {
  return parseLines(lines).items.map((item) => item.rohtext)
}

/** Kürzel: nur die Zeilensummen. */
function totals(lines: string[]): number[] {
  return parseLines(lines).items.map((item) => item.zeilensumme_cent)
}

/* ------------------------------------------------------- einfache Zeilen */

test('eine Zeile mit Betrag ist eine Position', async (t) => {
  await t.test('Name, Betrag und Steuerkennzeichen', () => {
    const [item] = parseLines(['VANILLE                   1,99 B']).items
    assert.equal(item.rohtext, 'VANILLE')
    assert.equal(item.zeilensumme_cent, 199)
    assert.equal(item.steuer, 'B')
    assert.equal(item.art, 'artikel')
    // Ohne Mengenzeile ist der Einzelpreis die Zeilensumme.
    assert.equal(item.einzelpreis_cent, 199)
    assert.equal(item.menge, null)
  })

  await t.test('ohne Steuerkennzeichen', () => {
    const [item] = parseLines(['BROT 2,49']).items
    assert.equal(item.rohtext, 'BROT')
    assert.equal(item.zeilensumme_cent, 249)
    assert.equal(item.steuer, null)
  })

  await t.test('mit Währung am Ende', () => {
    const [item] = parseLines(['BROT 2,49 EUR']).items
    assert.equal(item.zeilensumme_cent, 249)
  })

  await t.test('hält Zahlen im Namen für keinen Preis', () => {
    /*
     * Die wichtigste Bremse gegen Fehlalarm: Ein gedruckter Preis hat immer
     * zwei Nachkommastellen. „1,5" und „30%" sind Teil des Namens.
     */
    const result = parseLines(['H-MILCH 1,5% FETT', 'SPRUEHSAHNE 30% 1,98 B'])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].rohtext, 'H-MILCH 1,5% FETT SPRUEHSAHNE 30%')
  })
})

/* ------------------------------------------------------------ Mengenzeilen */

test('Mengenzeilen', async (t) => {
  await t.test('Stückzeile mit Zeilensumme schließt die Position ab', () => {
    // Der Name steht in der Zeile darüber und trägt selbst keinen Betrag.
    const [item] = parseLines(['SPRUEHSAHNE 30%', '  2 Stk x   0,99          1,98 B']).items
    assert.equal(item.rohtext, 'SPRUEHSAHNE 30%')
    assert.equal(item.menge, 2)
    assert.equal(item.einheit, 'stk')
    assert.equal(item.einzelpreis_cent, 99)
    assert.equal(item.zeilensumme_cent, 198)
    assert.equal(item.steuer, 'B')
  })

  await t.test('Gewichtszeile ohne Zeilensumme reichert die Position davor an', () => {
    const [item] = parseLines(['BANANEN                2,00 B', '  1,120 kg x 1,79 EUR/kg']).items
    assert.equal(item.rohtext, 'BANANEN')
    assert.equal(item.menge, 1.12)
    assert.equal(item.einheit, 'kg')
    assert.equal(item.einzelpreis_cent, 179)
    assert.equal(item.zeilensumme_cent, 200)
  })

  await t.test('nimmt Stück in jeder Schreibweise', () => {
    for (const unit of ['Stk', 'St', 'Stck', 'Stück']) {
      const [item] = parseLines(['JOGHURT', `2 ${unit} x 1,29 2,58 B`]).items
      assert.equal(item.einheit, 'stk', unit)
    }
  })

  await t.test('kommt ohne Einheit aus', () => {
    const [item] = parseLines(['JOGHURT', '3 x 1,29 3,87 B']).items
    assert.equal(item.menge, 3)
    assert.equal(item.einheit, null)
    assert.equal(item.einzelpreis_cent, 129)
  })

  await t.test('hält ein „x" mitten im Namen für keine Mengenzeile', () => {
    const [item] = parseLines(['DUPLEX KEKSE 1,49 B']).items
    assert.equal(item.rohtext, 'DUPLEX KEKSE')
    assert.equal(item.menge, null)
  })
})

/* ------------------------------------------------------ umbrochene Namen */

test('umbrochene Namen', async (t) => {
  await t.test('eine Zeile ohne Betrag gehört zur nächsten Position', () => {
    const [item] = parseLines(['BIO VOLLMILCH', 'FRISCH 3,5% FETT', '1,29 B']).items
    assert.equal(item.rohtext, 'BIO VOLLMILCH FRISCH 3,5% FETT')
    assert.equal(item.zeilensumme_cent, 129)
  })

  await t.test('ein Fragment ohne folgende Position bleibt sichtbar', () => {
    // Nichts wird stillschweigend geschluckt: Die Zeile taucht unter
    // „nicht zugeordnet" auf, damit sich der Fehler finden lässt.
    const result = parseLines(['BROT 2,49 B', 'VIELEN DANK FUER IHREN EINKAUF'])
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.unassigned, ['VIELEN DANK FUER IHREN EINKAUF'])
  })

  await t.test('ein Betrag ohne Namen wird keine Position', () => {
    // Etwa eine mitgelieferte Summenzeile — als Position würde sie den Bon
    // verdoppeln.
    const result = parseLines(['BROT 2,49 B', '6,55'])
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.unassigned, ['6,55'])
  })
})

/* --------------------------------------------------------- Pfand und Rabatt */

test('Pfand und Rabatt', async (t) => {
  await t.test('erkennt Pfand am Wort', () => {
    const [item] = parseLines(['PFAND 0,25 0,25 A']).items
    assert.equal(item.art, 'pfand')
    assert.equal(item.zeilensumme_cent, 25)
  })

  await t.test('Leergut kommt negativ zurück', () => {
    const [item] = parseLines(['LEERGUT -1,50 A']).items
    assert.equal(item.art, 'pfand')
    assert.equal(item.zeilensumme_cent, -150)
  })

  await t.test('nimmt das Minus auch hinter dem Betrag', () => {
    // Manche Kassen drucken „0,50-" statt „-0,50".
    const [item] = parseLines(['TREUERABATT 0,50-']).items
    assert.equal(item.zeilensumme_cent, -50)
    assert.equal(item.art, 'rabatt')
  })

  await t.test('jeder negative Betrag ohne Pfandwort ist ein Abzug', () => {
    const [item] = parseLines(['10% AKTION -0,50 B']).items
    assert.equal(item.art, 'rabatt')
  })

  await t.test('ein Artikel mit „Aktion" im Namen bleibt ein Artikel', () => {
    /*
     * Sonst würde `resolveItem` seinen Betrag ins Minus drehen: aus einem
     * falsch erkannten Wort würde ein falscher Bon.
     */
    const [item] = parseLines(['AKTION VOLLMILCH 1,29 B']).items
    assert.equal(item.art, 'artikel')
    assert.equal(item.zeilensumme_cent, 129)
  })
})

/* ============================================================ Der echte Bon */

/**
 * Der REWE-Bon vom 23.06.2017, an dem das Modell dreimal gescheitert ist.
 *
 * Die Zeilen stehen hier genau so, wie sie gedruckt sind. Vier der fünf
 * Positionen hat das Modell auch vorher gefunden; „MILCHSCHOKOSTR" für 0,99 €
 * fiel jedes Mal heraus, weil es die Zeile mit der darüber verschmolz.
 */
const REWE_BON = [
  'SPRUEHSAHNE 30%',
  '  2 Stk x   0,99          1,98 B',
  'VANILLE                   1,99 B',
  'MILCHSCHOKOSTR            0,99 B',
  'KL.PAPIERTASCHE           0,10 A',
  'TRINKHALME                1,49 A',
]

test('der REWE-Bon, an dem das Modell scheiterte', async (t) => {
  await t.test('ergibt fünf Positionen', () => {
    assert.deepEqual(names(REWE_BON), [
      'SPRUEHSAHNE 30%',
      'VANILLE',
      'MILCHSCHOKOSTR',
      'KL.PAPIERTASCHE',
      'TRINKHALME',
    ])
  })

  await t.test('trennt Vanille und Milchschokostreusel', () => {
    // Der Kern der Sache: zwei Zeilen, zwei Beträge, zwei Positionen.
    assert.deepEqual(totals(REWE_BON), [198, 199, 99, 10, 149])
  })

  await t.test('die Steuerklassen gehen auf', () => {
    const items = parseLines(REWE_BON).items
    const sum = (code: string) =>
      items.filter((i) => i.steuer === code).reduce((total, i) => total + i.zeilensumme_cent, 0)

    // Gedruckt: A = 1,59 €, B = 4,96 €, Gesamt 6,55 €.
    assert.equal(sum('A'), 159)
    assert.equal(sum('B'), 496)
    assert.equal(sum('A') + sum('B'), 655)
  })

  await t.test('behält jede gedruckte Zeile bei ihrer Position', () => {
    const items = parseLines(REWE_BON).items
    assert.deepEqual(items[0].sourceLines, [
      'SPRUEHSAHNE 30%',
      '2 Stk x 0,99 1,98 B',
    ])
    assert.deepEqual(items[2].sourceLines, ['MILCHSCHOKOSTR 0,99 B'])
    assert.deepEqual(parseLines(REWE_BON).unassigned, [])
  })
})

/* ------------------------------------------------------------- Randfälle */

test('Randfälle', async (t) => {
  await t.test('leere Eingabe ergibt nichts', () => {
    assert.deepEqual(parseLines([]).items, [])
    assert.deepEqual(parseLines(null).items, [])
    assert.deepEqual(parseLines('keine Liste').items, [])
  })

  await t.test('übergeht leere Zeilen und Nicht-Text', () => {
    const result = parseLines(['', '   ', 42, null, 'BROT 2,49 B'] as unknown[])
    assert.equal(result.items.length, 1)
  })
})
