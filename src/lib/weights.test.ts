import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WEIGHT,
  MAX_WEIGHT,
  MIN_WEIGHT,
  WEIGHT_LEVELS,
  clampWeight,
  weightLabel,
  weightLevel,
} from './weights.ts'
import { traits } from '../mocks/traits.ts'

/**
 * Die sechs Gewichtsstufen.
 *
 * Zwei Dinge sind hier zu sichern, und beide sind stiller Natur — sie fallen
 * ohne Test erst auf, wenn ein Merkmal in der Verwaltung nicht mehr speicherbar
 * ist oder eine Stufe leer angezeigt wird:
 *
 *   1. Die Stufen decken den erlaubten Bereich **lückenlos** ab. Sonst gäbe es
 *      Werte, die die Datenbank annimmt, für die der Screen aber keinen Chip
 *      hat.
 *   2. Die mitgelieferten Merkmale passen hinein. Täte eines das nicht, wäre die
 *      Prüfregel aus `0013_gewichtsstufen.sql` schärfer als die eigenen Daten,
 *      und `seed_traits()` liefe auf einen Constraint-Fehler.
 */

test('die sechs Stufen decken −3 bis +2 lückenlos ab', () => {
  const werte = WEIGHT_LEVELS.map((level) => level.weight)
  assert.deepEqual(werte, [2, 1, 0, -1, -2, -3], 'von gut nach schlecht, ohne Lücke')
  assert.equal(Math.max(...werte), MAX_WEIGHT)
  assert.equal(Math.min(...werte), MIN_WEIGHT)
})

test('jede Stufe hat einen eigenen Namen und einen eigenen Farbschritt', () => {
  assert.equal(new Set(WEIGHT_LEVELS.map((l) => l.label)).size, WEIGHT_LEVELS.length)
  assert.equal(new Set(WEIGHT_LEVELS.map((l) => l.tone)).size, WEIGHT_LEVELS.length)
})

test('der Startwert eines neuen Merkmals ist eine gültige Stufe', () => {
  assert.equal(clampWeight(DEFAULT_WEIGHT), DEFAULT_WEIGHT)
})

test('jeder gültige Wert findet seine Stufe', () => {
  assert.equal(weightLabel(2), 'Sehr gut')
  assert.equal(weightLabel(0), 'Neutral')
  assert.equal(weightLabel(-3), 'Stark ungünstig')
})

test('alte Werte außerhalb der Skala landen auf der nächsten Stufe', () => {
  // Vor Schritt 16 waren −10…+10 erlaubt. Wer damals −7 gesetzt hatte, meinte
  // „so schlimm wie es geht" — und das ist jetzt −3.
  assert.equal(weightLevel(-7).weight, -3)
  assert.equal(weightLevel(9).weight, 2)
  assert.equal(weightLevel(-4).label, 'Stark ungünstig')
})

test('kaputte Werte werden neutral, nicht negativ', () => {
  assert.equal(weightLevel(Number.NaN).weight, 0)
  assert.equal(weightLevel(Number.POSITIVE_INFINITY).weight, 0)
  // Zwischenwerte kann die Datenbank nicht liefern (smallint), ein Rundungsfehler
  // in der Zuordnung wäre trotzdem still.
  assert.equal(weightLevel(-1.4).weight, -1)
  assert.equal(weightLevel(-1.6).weight, -2)
})

test('die mitgelieferten Merkmale passen in die Skala', () => {
  for (const trait of traits) {
    assert.ok(
      trait.weight >= MIN_WEIGHT && trait.weight <= MAX_WEIGHT,
      `${trait.id} liegt mit ${trait.weight} außerhalb von ${MIN_WEIGHT}…${MAX_WEIGHT}`,
    )
    assert.equal(clampWeight(trait.weight), trait.weight)
  }
})
