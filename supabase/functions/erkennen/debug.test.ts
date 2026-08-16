import test from 'node:test'
import assert from 'node:assert/strict'
import { isTruncated, tail } from './debug.ts'

/**
 * Tests für die zwei reinen Teile der Fehlersuche.
 *
 * `isDebugEnabled` und `logModelResponse` bleiben ungetestet: Das eine liest ein
 * Secret aus der Deno-Laufzeit, das andere schreibt in die Konsole. Beides
 * nachzubauen kostet mehr, als es sichert — die Entscheidung, um die es
 * inhaltlich geht („war die Antwort abgeschnitten?"), steht hier.
 */

test('isTruncated erkennt beide Abschneide-Gründe', () => {
  // Der Fall, um den es geht: max_tokens erreicht.
  assert.equal(isTruncated('length'), true)
  // Und der seltenere: das Kontextfenster war voll.
  assert.equal(isTruncated('model_length'), true)

  // Eine fertige Antwort ist nicht abgeschnitten — auch dann nicht, wenn ihr
  // JSON kaputt ist. Genau diese Unterscheidung ist der Zweck der Funktion.
  assert.equal(isTruncated('stop'), false)
  assert.equal(isTruncated('tool_calls'), false)
  assert.equal(isTruncated(null), false)
})

test('tail zeigt das Ende, nicht den Anfang', async (t) => {
  await t.test('kurze Antworten bleiben vollständig', () => {
    assert.equal(tail('{"lesbar":true}'), '{"lesbar":true}')
  })

  await t.test('lange Antworten werden vorn gekürzt', () => {
    const text = `${'A'.repeat(500)}ENDE`
    const cut = tail(text, 10)
    // Das Ende ist da — daran sieht man, ob mitten im Wort abgebrochen wurde.
    assert.ok(cut.endsWith('ENDE'))
    // Und das Kürzen ist sichtbar, statt einen vollständigen Text vorzutäuschen.
    assert.ok(cut.startsWith('…'))
    assert.equal(cut.length, 11)
  })
})
