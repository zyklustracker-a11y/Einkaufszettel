import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptPayload, fromBase64Url, toBase64Url, vapidHeader } from './push.ts'

/**
 * Web Push, geprüft gegen die Testvektoren der Norm.
 *
 * Das ist der Grund, warum die Verschlüsselung hier von Hand steht und nicht aus
 * einer Bibliothek kommt: RFC 8291 enthält in Abschnitt 5 ein vollständig
 * durchgerechnetes Beispiel — Schlüssel, Salz, Klartext und das erwartete
 * Ergebnis Byte für Byte. Was diesen Test besteht, ist nicht „sieht richtig
 * aus", sondern stimmt mit der Norm überein.
 *
 * Läuft mit `npm test` auf Node; die Web-Crypto-Schnittstelle ist dort dieselbe
 * wie in Deno.
 */

/* Alle Werte wörtlich aus RFC 8291, Abschnitt 5. */
const VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  /** Der öffentliche Schlüssel des Empfängers (ua_public). */
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  /** Das Abo-Geheimnis (auth_secret). */
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  /** Das Salz des Beispiels. */
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  /** Der private Schlüssel des Absenders (as_private), roh. */
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  /** Und sein öffentlicher (as_public), unkomprimiert. */
  senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  /** Der erwartete Nachrichtenkörper. */
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/**
 * Das Schlüsselpaar des Beispiels, so wie Web Crypto es braucht.
 *
 * Der private Schlüssel liegt im RFC als rohe 32 Byte vor; als JWK gehören die
 * beiden Hälften des öffentlichen dazu.
 */
async function senderKeyPair(): Promise<CryptoKeyPair> {
  const raw = fromBase64Url(VECTOR.senderPublic)

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(raw.slice(1, 33)),
      y: toBase64Url(raw.slice(33, 65)),
      d: VECTOR.senderPrivate,
      ext: true,
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )

  const publicKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )

  return { privateKey, publicKey }
}

test('Web-Push-Verschlüsselung', async (t) => {
  await t.test('trifft den Testvektor aus RFC 8291 Byte für Byte', async () => {
    const body = await encryptPayload(
      { endpoint: 'https://example.test/x', p256dh: VECTOR.p256dh, auth: VECTOR.auth },
      VECTOR.plaintext,
      { salt: fromBase64Url(VECTOR.salt), keyPair: await senderKeyPair() },
    )

    assert.equal(toBase64Url(body), VECTOR.body)
  })

  await t.test('der Kopf trägt Salz, Satzgröße und den Absender-Schlüssel', async () => {
    const body = await encryptPayload(
      { endpoint: 'https://example.test/x', p256dh: VECTOR.p256dh, auth: VECTOR.auth },
      'kurz',
    )

    // 16 Byte Salz, 4 Byte Satzgröße, 1 Byte Länge, 65 Byte Schlüssel.
    assert.equal(body[16 + 4], 65)
    assert.equal(body[16 + 4 + 1], 4, 'der öffentliche Schlüssel ist nicht unkomprimiert')
    assert.ok(body.length > 86, 'der Körper ist zu kurz für Kopf und Chiffrat')
  })

  await t.test('zweimal dasselbe ergibt zwei verschiedene Körper', async () => {
    // Salz und Schlüsselpaar sind je Nachricht neu. Wären sie es nicht, ließe
    // sich aus zwei Nachrichten der Schlüsselstrom herausrechnen.
    const send = () =>
      encryptPayload(
        { endpoint: 'https://example.test/x', p256dh: VECTOR.p256dh, auth: VECTOR.auth },
        'gleicher Text',
      )

    assert.notEqual(toBase64Url(await send()), toBase64Url(await send()))
  })
})

test('VAPID', async (t) => {
  const keys = {
    publicKey: VECTOR.senderPublic,
    privateKey: VECTOR.senderPrivate,
    subject: 'mailto:test@example.test',
  }

  await t.test('baut den Autorisierungs-Kopf', async () => {
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys, 1_700_000_000)

    assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    assert.ok(header.endsWith(`k=${VECTOR.senderPublic}`))
  })

  await t.test('der Empfänger ist der Ursprung, nicht die ganze Adresse', async () => {
    // Sonst bräuchte jedes Gerät ein eigenes Token, obwohl derselbe Dienst
    // dahintersteht.
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys, 1_700_000_000)
    const claims = JSON.parse(
      new TextDecoder().decode(fromBase64Url(header.slice('vapid t='.length).split('.')[1])),
    )

    assert.equal(claims.aud, 'https://fcm.googleapis.com')
    assert.equal(claims.sub, 'mailto:test@example.test')
    assert.equal(claims.exp, 1_700_000_000 + 12 * 60 * 60)
  })
})
