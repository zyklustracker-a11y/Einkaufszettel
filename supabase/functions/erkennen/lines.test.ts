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

/* ------------------------------------------------------------- Tankbelege */

/**
 * Ein Tankbeleg, wie ihn eine Zapfsäule druckt.
 *
 * Drei Dinge sind hier anders als auf einem Supermarktbon, und alle drei haben
 * den Parser bis Schritt 7 aus dem Tritt gebracht: „à" statt „x", die Einheit
 * „Ltr", und ein Literpreis mit **drei** Nachkommastellen. Ohne die dritte
 * Stelle las das Muster aus „1,779" ein „1,77" heraus — ein falscher Literpreis,
 * der dazu noch plausibel aussieht.
 */
const TANKBELEG = [
  'SUPER E10',
  '  38,45 L à 1,779 EUR/L        68,41 A',
  'ZAPFSAEULE 3',
]

test('Tankbeleg', async (t) => {
  await t.test('liest Liter und Literpreis', () => {
    const { items } = parseLines(TANKBELEG)

    assert.equal(items.length, 1)
    assert.equal(items[0].menge, 38.45)
    assert.equal(items[0].einheit, 'l')
    // 1,779 EUR/L, auf ganze Cent gerundet — Geld ist nie eine Kommazahl.
    assert.equal(items[0].einzelpreis_cent, 178)
    assert.equal(items[0].zeilensumme_cent, 6841)
    assert.equal(items[0].steuer, 'A')
    assert.equal(items[0].art, 'artikel')
  })

  await t.test('die Zeile ohne Betrag bleibt sichtbar statt zu verschwinden', () => {
    // „ZAPFSAEULE 3" trägt keinen Betrag und gehört zu keiner Position. Sie
    // wandert damit in `unassigned` und steht im Korrektur-Screen unter den
    // abgetippten Zeilen — verschwiegen wird sie nicht.
    assert.deepEqual(parseLines(TANKBELEG).unassigned, ['ZAPFSAEULE 3'])
  })

  await t.test('„Ltr" und „@" werden ebenso gelesen', () => {
    const { items } = parseLines(['DIESEL', '  45,20 Ltr @ 1,659 EUR      74,99 A'])
    assert.equal(items[0].menge, 45.2)
    assert.equal(items[0].einheit, 'l')
    assert.equal(items[0].einzelpreis_cent, 166)
    assert.equal(items[0].zeilensumme_cent, 7499)
  })

  await t.test('zwei Nachkommastellen bleiben unverändert', () => {
    // Die Erweiterung darf den Normalfall nicht verschieben.
    const { items } = parseLines(['SPRUEHSAHNE 30%', '  2 Stk x 0,99      1,98 B'])
    assert.equal(items[0].einzelpreis_cent, 99)
    assert.equal(items[0].zeilensumme_cent, 198)
  })
})

/* ============================================================================
 * SCHRITT 18 — deutsche Bonformate jenseits von Edeka und REWE
 * ========================================================================== */

test('Ziffern als Steuerkennzeichen (toom, Baumärkte)', async (t) => {
  await t.test('eine Zeile mit „7" am Ende ist eine Position', () => {
    /*
     * DER FEHLER, DER DEN GANZEN toom-BON GEKOSTET HAT: Das Muster für den
     * Betrag am Zeilenende ließ nur Buchstaben als Kennzeichen zu. Eine „7"
     * hinter dem Betrag ergab deshalb nicht etwa ein falsches Kennzeichen —
     * sie verhinderte den Treffer vollständig. Die Zeile wurde zum
     * Namensfragment, und der Bon hatte am Ende null Positionen.
     */
    const [item] = parseLines(['4388950829864 1,000 STK LAVENDEL WEISS 2,99 7']).items
    assert.equal(item.zeilensumme_cent, 299)
    assert.equal(item.steuer, '7')
    assert.equal(item.rohtext, 'LAVENDEL WEISS')
  })

  await t.test('auch zweistellig: „19"', () => {
    const [item] = parseLines(['4042448169419 1,000 STK Klett für Fenste 14,99 19']).items
    assert.equal(item.zeilensumme_cent, 1499)
    assert.equal(item.steuer, '19')
  })

  await t.test('Mengenzeile im Format „2,000 STK a 5,99"', () => {
    const [item] = parseLines(['4250787606599 2,000 STK a 5,99 Calibrachoa-Mix 11,98 7']).items
    assert.equal(item.rohtext, 'Calibrachoa-Mix')
    assert.equal(item.menge, 2)
    assert.equal(item.einheit, 'stk')
    assert.equal(item.einzelpreis_cent, 599)
    assert.equal(item.zeilensumme_cent, 1198)
    assert.equal(item.steuer, '7')
  })

  await t.test('die Artikelnummer landet nicht im Namen', () => {
    const [item] = parseLines(['5701952006175 1,000 STK PETERSILIE, KRAU 2,99 7']).items
    assert.ok(!item.rohtext?.toString().includes('5701952'), `Name: „${item.rohtext}"`)
  })
})

test('Menge mitten in der Zeile: „0,99 € x 2"', async (t) => {
  await t.test('Einzelpreis und Stückzahl werden herausgelöst', () => {
    // So druckt der Edeka-Bon es. Ohne dieses Muster wäre der Einzelpreis 1,98
    // statt 0,99 — und der Bestpreisvergleich verglichen Doppelpackungen mit
    // Einzelstücken.
    const [item] = parseLines(['BIO ALNA.D.BR 0,99 € x 2 1,98 A']).items
    assert.equal(item.rohtext, 'BIO ALNA.D.BR')
    assert.equal(item.menge, 2)
    assert.equal(item.einheit, 'stk')
    assert.equal(item.einzelpreis_cent, 99)
    assert.equal(item.zeilensumme_cent, 198)
  })

  await t.test('auch ohne Währungszeichen', () => {
    const [item] = parseLines(['BIO AVOCADOS 2,49 x 2 4,98 A']).items
    assert.equal(item.menge, 2)
    assert.equal(item.einzelpreis_cent, 249)
  })

  await t.test('ein „x" im Artikelnamen wird nicht zur Menge', () => {
    // Die Bremse: Das Muster verlangt Preis, „x", Zahl und dann Zeilenende.
    const [item] = parseLines(['XOX ERDNUSS EXTRA 1,99 B']).items
    assert.equal(item.rohtext, 'XOX ERDNUSS EXTRA')
    assert.equal(item.menge, null)
  })
})

test('Tausenderpunkt', () => {
  // „1.234,56" sind 1234,56 und nicht 234,56. Der Unterschied wäre ein
  // plausibel aussehender, um 1000 Euro falscher Betrag.
  const [item] = parseLines(['KUECHENZEILE 1.234,56 A']).items
  assert.equal(item.zeilensumme_cent, 123456)
})

test('Zeilen aus dem Bonfuß werden nicht zu Positionen', async (t) => {
  const footer = [
    'SUMME 120,67',
    'GEGEBEN 150,00',
    'Netto-Entgelt 23,76',
    'MwSt-Betrag 4,51',
    'Rückgeld 29,33',
    'Mastercard 87,75',
  ]

  for (const line of footer) {
    await t.test(`„${line}" zählt nicht als Artikel`, () => {
      const result = parseLines([line])
      assert.equal(result.items.length, 0, `„${line}" wurde zur Position`)
      // Verschwiegen wird sie trotzdem nicht — sie steht bei den nicht
      // zugeordneten Zeilen und ist im Korrektur-Screen nachlesbar.
      assert.equal(result.unassigned.length, 1)
    })
  }

  await t.test('Pfand und Rabatt bleiben Positionen', () => {
    // Sie sind Teil des Einkaufs und gehören in die Rechnung — anders als die
    // Zusammenfassungen oben.
    const result = parseLines(['PFAND 0,25 A', 'RABATT -0,50 B'])
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].art, 'pfand')
    assert.equal(result.items[1].art, 'rabatt')
  })

  await t.test('eine Summenzeile verdirbt die Positionen davor nicht', () => {
    const result = parseLines(['MILCH 1,29 B', 'BROT 2,49 A', 'SUMME 3,78'])
    assert.equal(result.items.length, 2)
    assert.equal(
      result.items.reduce((sum, item) => sum + (item.zeilensumme_cent as number), 0),
      378,
    )
  })
})

test('Konfidenz', async (t) => {
  await t.test('eine saubere Zeile ist sicher', () => {
    const [item] = parseLines(['MILCH 1,5% 1,29 B']).items
    assert.equal(item.konfidenz, 1)
  })

  await t.test('eine vom Modell gemeldete Zeile sinkt', () => {
    const items = parseLines(['MILCH 1,29 B', 'BR0T 2,49 A'], [1]).items
    assert.equal(items[0].konfidenz, 1)
    assert.ok((items[1].konfidenz as number) < 0.8, `Konfidenz ${items[1].konfidenz}`)
  })

  await t.test('ein Name ganz ohne Buchstaben ist verdächtig', () => {
    const [item] = parseLines(['### 2,49 A']).items
    assert.ok((item.konfidenz as number) < 0.8, `Konfidenz ${item.konfidenz}`)
  })

  await t.test('die Unsicherheit gilt für die ganze Position', () => {
    // Zwei gedruckte Zeilen, eine Position: Ist eine davon unleserlich, ist die
    // Position unsicher — auch wenn der zusammengesetzte Name harmlos aussieht.
    const items = parseLines(['SPRUEHSAHNE 30%', '2 Stk x 0,99 1,98 B'], [0]).items
    assert.equal(items.length, 1)
    assert.ok((items[0].konfidenz as number) < 0.8, `Konfidenz ${items[0].konfidenz}`)
  })
})
