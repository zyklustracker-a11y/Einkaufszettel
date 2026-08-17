import test from 'node:test'
import assert from 'node:assert/strict'
import { callMistral } from './mistral.ts'

/**
 * Tests für den Aufruf bei Mistral — mit gefälschtem `fetch`.
 *
 * Was hier geprüft wird, ist genau das, was bei langen Bons schiefging: Eine
 * Antwort, die an der Token-Grenze endet, darf nicht als fertig gelten. Sie muss
 * fortgesetzt werden, und wenn das nicht klappt, muss das Bisherige übrig
 * bleiben statt verloren zu gehen.
 *
 * Die Wiederholungen bei 429 und 5xx sind hier bewusst **nicht** getestet: Sie
 * warten echte Sekunden ab (`BACKOFF_MS`), und ein Test, der fünf Sekunden
 * schläft, wird abgeschaltet statt repariert.
 */

/** Eine Antwort, wie die Schnittstelle sie schickt. */
function reply(content: string, finishReason: string, tokens = 100) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { prompt_tokens: 1500, completion_tokens: tokens },
      }),
    text: () => Promise.resolve(''),
    headers: new Headers(),
  }
}

/** Eine Ablehnung, etwa wegen eines unbekannten Antwortformats. */
function rejection(status: number, body: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(body),
    headers: new Headers(),
  }
}

/**
 * `fetch` durch eine Liste vorbereiteter Antworten ersetzen.
 *
 * Zurück kommt die Liste der gestellten Anfragen — daran wird geprüft, dass die
 * Fortsetzung wirklich als `prefix` mitgeht und nicht als neue Frage.
 */
function stubFetch(responses: unknown[]): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  let index = 0

  globalThis.fetch = ((_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body))
    const response = responses[Math.min(index, responses.length - 1)]
    index++
    return Promise.resolve(response)
  }) as unknown as typeof fetch

  return { bodies }
}

const BASE = {
  apiKey: 'test',
  systemPrompt: 'System',
  userPrompt: 'Frage',
}

test('ein normaler Aufruf', async (t) => {
  await t.test('gibt den Text und die Diagnose zurück', async () => {
    stubFetch([reply('{"lesbar":true}', 'stop', 250)])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return

    assert.equal(outcome.text, '{"lesbar":true}')
    assert.equal(outcome.diagnostics.finishReason, 'stop')
    assert.equal(outcome.diagnostics.outputTokens, 250)
    assert.equal(outcome.diagnostics.inputTokens, 1500)
    // Nichts abgeschnitten, also auch nichts fortzusetzen.
    assert.equal(outcome.diagnostics.continuations, 0)
  })

  await t.test('schickt ohne Schema den einfachen JSON-Modus', async () => {
    const { bodies } = stubFetch([reply('{}', 'stop')])
    await callMistral({ ...BASE })
    assert.deepEqual(bodies[0].response_format, { type: 'json_object' })
  })

  await t.test('schickt mit Schema die strenge Form', async () => {
    const { bodies } = stubFetch([reply('{}', 'stop')])
    await callMistral({
      ...BASE,
      jsonSchema: { name: 'kassenzettel', schema: { type: 'object' } },
    })
    const format = bodies[0].response_format as { type: string; json_schema: { name: string } }
    assert.equal(format.type, 'json_schema')
    assert.equal(format.json_schema.name, 'kassenzettel')
  })

  await t.test('hebt das Ausgabe-Budget auf 8000', async () => {
    const { bodies } = stubFetch([reply('{}', 'stop')])
    await callMistral({ ...BASE })
    assert.equal(bodies[0].max_tokens, 8_000)
  })
})

/* ------------------------------------------------------------- Fortsetzung */

test('eine abgeschnittene Antwort wird fortgesetzt', async (t) => {
  await t.test('der Text wird nahtlos zusammengesetzt', async () => {
    stubFetch([
      reply('{"lesbar":true,"zeilen":["MILCH 1,29 B","BRO', 'length', 4000),
      reply('T 2,49 A"]}', 'stop', 40),
    ])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return

    // Ohne Trennzeichen — sonst würde aus „BRO" + „T" ein „BRO T".
    assert.equal(outcome.text, '{"lesbar":true,"zeilen":["MILCH 1,29 B","BROT 2,49 A"]}')
    assert.equal(outcome.diagnostics.continuations, 1)
    // Die Token beider Runden zusammen, nicht nur die der letzten.
    assert.equal(outcome.diagnostics.outputTokens, 4040)
    assert.equal(outcome.diagnostics.finishReason, 'stop')
  })

  await t.test('der bisherige Text geht als prefix zurück', async () => {
    const { bodies } = stubFetch([reply('{"zeilen":["A', 'length'), reply('"]}', 'stop')])
    await callMistral({ ...BASE })

    assert.equal(bodies.length, 2)
    const messages = bodies[1].messages as Array<Record<string, unknown>>
    const last = messages[messages.length - 1]
    assert.equal(last.role, 'assistant')
    assert.equal(last.content, '{"zeilen":["A')
    assert.equal(last.prefix, true)
    /*
     * Und ohne erzwungenes Format: Ein vollständiges JSON-Objekt zu verlangen
     * und zugleich mitten in einem weiterzuschreiben, widerspricht sich.
     */
    assert.equal(bodies[1].response_format, undefined)
  })

  await t.test('nach zwei Runden ist Schluss', async () => {
    // Ein Modell in der Wiederholungsschleife: Es endet immer an der Grenze.
    stubFetch([reply('{"a":', 'length'), reply('1,', 'length'), reply('2,', 'length')])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return

    // Drei Aufrufe insgesamt: einer plus zwei Fortsetzungen. Nicht mehr.
    assert.equal(outcome.diagnostics.continuations, 2)
    assert.equal(outcome.text, '{"a":1,2,')
  })

  await t.test('auch model_length gilt als abgeschnitten', async () => {
    stubFetch([reply('{"a":', 'model_length'), reply('1}', 'stop')])
    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.diagnostics.continuations, 1)
  })

  await t.test('scheitert die Fortsetzung, bleibt das Bisherige', async () => {
    /*
     * Der wichtigste Test der Datei. Runde eins hat den Bon gelesen und
     * bezahlt; Runde zwei fällt aus. Das Ergebnis muss trotzdem ankommen — ein
     * Fehler hier würde den teuren Teil wegen des billigen wegwerfen.
     */
    stubFetch([
      reply('{"lesbar":true,"zeilen":["MILCH 1,29 B"', 'length'),
      rejection(401, 'Unauthorized'),
    ])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.text, '{"lesbar":true,"zeilen":["MILCH 1,29 B"')
  })
})

/* ---------------------------------------------------------- Die Format-Leiter */

test('die Format-Leiter steigt bei Ablehnung hinab', async (t) => {
  await t.test('json_schema abgelehnt → json_object', async () => {
    const { bodies } = stubFetch([
      rejection(400, '{"message":"response_format json_schema not supported"}'),
      reply('{"lesbar":true}', 'stop'),
    ])

    const outcome = await callMistral({
      ...BASE,
      jsonSchema: { name: 'kassenzettel', schema: { type: 'object' } },
    })

    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.diagnostics.responseFormat, 'json_object')
    assert.deepEqual(bodies[1].response_format, { type: 'json_object' })
  })

  await t.test('json_object abgelehnt → gar kein Format', async () => {
    const { bodies } = stubFetch([
      rejection(400, '{"message":"response_format not supported"}'),
      reply('{"lesbar":true}', 'stop'),
    ])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.diagnostics.responseFormat, 'none')
    assert.equal(bodies[1].response_format, undefined)
  })

  await t.test('eine Ablehnung aus anderem Grund bleibt eine Ablehnung', async () => {
    // Kein `response_format` im Text: Das ist ein unbekanntes Modell, und da
    // hilft kein Herabsteigen.
    stubFetch([rejection(400, '{"message":"Invalid model: gibt-es-nicht"}')])

    const outcome = await callMistral({ ...BASE })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.reason, 'modell_abgelehnt')
    assert.match(outcome.detail, /Invalid model/)
  })
})

/* ------------------------------------------------------------------ Kacheln */

test('mehrere Kacheln gehen in einem einzigen Aufruf mit', async () => {
  const { bodies } = stubFetch([reply('{"lesbar":true}', 'stop')])

  await callMistral({
    ...BASE,
    imageDataUrl: 'data:image/jpeg;base64,AAA',
    extraImageDataUrls: ['data:image/jpeg;base64,BBB', 'data:image/jpeg;base64,CCC'],
  })

  assert.equal(bodies.length, 1)
  const messages = bodies[0].messages as Array<{ role: string; content: unknown }>
  const parts = messages[1].content as Array<{ type: string; image_url?: string }>

  // Ein Textteil, dann die drei Kacheln in gedruckter Reihenfolge.
  assert.equal(parts[0].type, 'text')
  assert.deepEqual(
    parts.slice(1).map((part) => part.image_url),
    ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB', 'data:image/jpeg;base64,CCC'],
  )
})
