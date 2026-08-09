import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CATEGORY_PALETTE,
  isHexColor,
  nextFreeColor,
  toCategoryKey,
} from './category.ts'

/**
 * Die Probe auf den Schlüssel ist keine Formsache: Dieselbe Umformung steht ein
 * zweites Mal als `category_key()` in der Datenbank. Wenn sie auseinanderlaufen,
 * zeigt die Vorschau im Anlegen-Formular etwas anderes an, als hinterher in der
 * Datenbank steht — und der Schlüssel ist danach unveränderlich.
 */
describe('toCategoryKey', () => {
  it('macht aus dem Anzeigenamen einen Schlüssel', () => {
    assert.equal(toCategoryKey('Gewürze'), 'gewuerze')
    assert.equal(toCategoryKey('Auswärts essen'), 'auswaerts_essen')
    assert.equal(toCategoryKey('Kraftstoff'), 'kraftstoff')
  })

  it('schreibt Umlaute aus, statt sie plattzumachen', () => {
    // Der Schlüssel steht im Erkennungs-Prompt und wird dort gelesen:
    // „auswaerts" ist ein Wort, „auswarts" sieht nach Tippfehler aus.
    assert.equal(toCategoryKey('Öl'), 'oel')
    assert.equal(toCategoryKey('Süßes'), 'suesses')
    assert.equal(toCategoryKey('ÄPFEL'), 'aepfel')
  })

  it('zieht Sonderzeichen zu genau einem Unterstrich zusammen', () => {
    assert.equal(toCategoryKey('Obst & Gemüse'), 'obst_gemuese')
    assert.equal(toCategoryKey('Wein / Bier'), 'wein_bier')
    assert.equal(toCategoryKey('Drogerie  &  Kosmetik'), 'drogerie_kosmetik')
  })

  it('lässt vorn und hinten keinen Unterstrich stehen', () => {
    assert.equal(toCategoryKey('  Tiefkühl!  '), 'tiefkuehl')
    assert.equal(toCategoryKey('- Sonstiges -'), 'sonstiges')
  })

  it('gibt einen leeren Schlüssel zurück, wenn nichts Verwertbares übrig bleibt', () => {
    // Der Screen fängt das ab und speichert nicht. Ein Ersatzname wäre geraten.
    assert.equal(toCategoryKey('!!!'), '')
    assert.equal(toCategoryKey('   '), '')
  })
})

describe('nextFreeColor', () => {
  it('nimmt die erste Farbe, solange keine vergeben ist', () => {
    assert.equal(nextFreeColor([]), CATEGORY_PALETTE[0])
  })

  it('überspringt vergebene Farben', () => {
    const used = CATEGORY_PALETTE.slice(0, 9)
    assert.equal(nextFreeColor(used), CATEGORY_PALETTE[9])
  })

  it('achtet nicht auf Groß- und Kleinschreibung', () => {
    const used = CATEGORY_PALETTE.slice(0, 2).map((color) => color.toUpperCase())
    assert.equal(nextFreeColor(used), CATEGORY_PALETTE[2])
  })

  it('fängt von vorn an, wenn alle vergeben sind', () => {
    // Zwei gleiche Farben sind besser als gar keine — und mit zwei Tippern
    // geändert.
    const color = nextFreeColor([...CATEGORY_PALETTE])
    assert.ok(CATEGORY_PALETTE.includes(color))
  })
})

describe('isHexColor', () => {
  it('nimmt an, was die Datenbank annimmt', () => {
    assert.equal(isHexColor('#16915c'), true)
    assert.equal(isHexColor('#B07A12'), true)
  })

  it('lehnt alles andere ab', () => {
    assert.equal(isHexColor('16915c'), false)
    assert.equal(isHexColor('#16915'), false)
    assert.equal(isHexColor('var(--cat-1)'), false)
    assert.equal(isHexColor(''), false)
  })
})
