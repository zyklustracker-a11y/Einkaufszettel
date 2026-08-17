import test from 'node:test'
import assert from 'node:assert/strict'
import { recoverJson, stripFences } from './repair.ts'

/**
 * Tests für das Herausholen von JSON aus einer Modellantwort.
 *
 * Der wichtigste Block ist „abgeschnittene Antworten": Genau daran ist die
 * Erkennung bei langen Bons gescheitert, und genau dort muss ein Teilergebnis
 * herauskommen statt einer Ausnahme.
 */

/* ------------------------------------------------------------ heile Antworten */

test('heile Antworten bleiben unangetastet', async (t) => {
  await t.test('reines JSON', () => {
    const result = recoverJson('{"lesbar":true,"zeilen":["MILCH 1,29 B"]}')
    assert.deepEqual(result.value, { lesbar: true, zeilen: ['MILCH 1,29 B'] })
    assert.equal(result.repaired, false)
    assert.equal(result.droppedChars, 0)
  })

  await t.test('mit Vorrede davor', () => {
    const result = recoverJson('Hier ist das Ergebnis:\n{"lesbar":true}')
    assert.deepEqual(result.value, { lesbar: true })
    assert.equal(result.repaired, false)
  })

  await t.test('mit Nachsatz dahinter', () => {
    const result = recoverJson('{"lesbar":true}\n\nIch hoffe, das hilft!')
    assert.deepEqual(result.value, { lesbar: true })
    assert.equal(result.repaired, false)
  })

  await t.test('verschachtelt', () => {
    const raw = '{"a":{"b":[1,2,{"c":null}]},"d":true}'
    assert.deepEqual(recoverJson(raw).value, { a: { b: [1, 2, { c: null }] }, d: true })
  })
})

/* ------------------------------------------------------------ Markdown-Zäune */

test('Markdown-Codefences werden gestrippt', async (t) => {
  await t.test('```json ... ```', () => {
    const raw = '```json\n{"lesbar":true,"summe_cent":655}\n```'
    const result = recoverJson(raw)
    assert.deepEqual(result.value, { lesbar: true, summe_cent: 655 })
    assert.equal(result.repaired, false)
  })

  await t.test('```  ohne Sprachangabe', () => {
    assert.deepEqual(recoverJson('```\n{"lesbar":true}\n```').value, { lesbar: true })
  })

  await t.test('Zaun plus Vorrede plus abgeschnitten', () => {
    // Der schlimmste realistische Fall auf einmal: Der schließende Zaun fehlt,
    // weil die Antwort vorher endete.
    const raw = 'Bitte sehr:\n```json\n{"lesbar":true,"zeilen":["A 1,00 B","B 2,0'
    const result = recoverJson(raw)
    assert.deepEqual(result.value, { lesbar: true, zeilen: ['A 1,00 B'] })
    assert.equal(result.repaired, true)
  })

  await t.test('stripFences allein', () => {
    assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}')
  })
})

/* -------------------------------------------------- abgeschnittene Antworten */

test('abgeschnittene Antworten liefern ein Teilergebnis', async (t) => {
  await t.test('mitten in einer Zeichenkette', () => {
    // Der Normalfall bei max_tokens: Das Modell schreibt gerade an einer Zeile.
    const raw = '{"lesbar":true,"zeilen":["MILCH 1,29 B","BROT 2,49 A","BUTTER 2,4'
    const result = recoverJson(raw)
    assert.deepEqual(result.value, {
      lesbar: true,
      // Die angebrochene Zeile fällt weg — vollständig. Nicht halb, nicht geraten.
      zeilen: ['MILCH 1,29 B', 'BROT 2,49 A'],
    })
    assert.equal(result.repaired, true)
    assert.ok(result.droppedChars > 0)
  })

  await t.test('direkt nach einem Komma', () => {
    const raw = '{"lesbar":true,"zeilen":["MILCH 1,29 B",'
    assert.deepEqual(recoverJson(raw).value, { lesbar: true, zeilen: ['MILCH 1,29 B'] })
  })

  await t.test('mitten in einem Schlüssel', () => {
    /*
     * Der Fall, an dem ein naiver Reparierer scheitert: Ein Schlüssel ohne Wert
     * ergibt ungültiges JSON. Er muss deshalb ganz wegfallen.
     */
    const raw = '{"haendler":"REWE","datu'
    assert.deepEqual(recoverJson(raw).value, { haendler: 'REWE' })
  })

  await t.test('nach dem Doppelpunkt, vor dem Wert', () => {
    const raw = '{"haendler":"REWE","summe_cent":'
    assert.deepEqual(recoverJson(raw).value, { haendler: 'REWE' })
  })

  await t.test('mitten in einer Zahl', () => {
    // „6" könnte 655 werden wollen. Eine halbe Zahl ist keine Zahl.
    const raw = '{"haendler":"REWE","summe_cent":6'
    assert.deepEqual(recoverJson(raw).value, { haendler: 'REWE' })
  })

  await t.test('mitten in einem verschachtelten Objekt', () => {
    const raw = '{"steuerblock":[{"kennzeichen":"A","brutto_cent":159},{"kennzeichen":"B"'
    assert.deepEqual(recoverJson(raw).value, {
      steuerblock: [{ kennzeichen: 'A', brutto_cent: 159 }],
    })
  })

  await t.test('zwei Ebenen offen', () => {
    const raw = '{"a":{"b":[1,2,3'
    assert.deepEqual(recoverJson(raw).value, { a: { b: [1, 2] } })
  })

  await t.test('ein langer Bon, hinten abgeschnitten', () => {
    // Die Form, um die es wirklich geht: dreißig heile Zeilen, eine angebrochene.
    const zeilen = Array.from({ length: 30 }, (_, i) => `ARTIKEL ${i} 1,0${i % 10} B`)
    const raw =
      `{"lesbar":true,"haendler":"EDEKA","summe_cent":12067,"zeilen":` +
      `${JSON.stringify(zeilen).slice(0, -1)},"ARTIKEL 30 1,3`
    const result = recoverJson(raw)
    const value = result.value as { zeilen: string[]; haendler: string; summe_cent: number }
    assert.equal(result.repaired, true)
    // Alles, was heil war, ist noch da.
    assert.equal(value.zeilen.length, 30)
    assert.equal(value.haendler, 'EDEKA')
    assert.equal(value.summe_cent, 12067)
  })

  await t.test('maskierte Anführungszeichen verwirren den Scanner nicht', () => {
    const raw = '{"zeilen":["ZOLL 5\\" ROHR 1,99 A","NAECHSTE'
    assert.deepEqual(recoverJson(raw).value, { zeilen: ['ZOLL 5" ROHR 1,99 A'] })
  })
})

/* ------------------------------------------------------------- Aussichtslos */

test('was sich nicht retten lässt, wird nicht erfunden', async (t) => {
  await t.test('reiner Fließtext', () => {
    assert.equal(recoverJson('Das kann ich leider nicht lesen.').value, null)
  })

  await t.test('leere Antwort', () => {
    assert.equal(recoverJson('').value, null)
  })

  await t.test('nur eine öffnende Klammer', () => {
    assert.equal(recoverJson('{').value, null)
  })

  await t.test('abgebrochen, bevor der erste Wert fertig war', () => {
    assert.equal(recoverJson('{"lesbar"').value, null)
  })

  await t.test('eine Liste statt eines Objekts', () => {
    // Der Bon ist ein Objekt. Eine Liste an der Wurzel ist nicht das, wonach
    // gefragt wurde — und wird nicht zurechtgebogen.
    assert.equal(recoverJson('["MILCH 1,29 B"]').value, null)
  })
})
