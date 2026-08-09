/**
 * Erzeugt ein VAPID-Schlüsselpaar für die Benachrichtigungen.
 *
 *     node scripts/vapid-keys.mjs
 *
 * VAPID ist der Ausweis des Absenders (RFC 8292): Der Push-Dienst — bei iOS
 * Apple, bei Android Google — nimmt eine Nachricht nur an, wenn sie mit dem
 * privaten Schlüssel signiert ist, der zum öffentlichen des Abos passt. Ohne
 * dieses Paar könnte jeder, der eine Abo-Adresse kennt, dorthin senden.
 *
 * **Ohne zusätzliches Paket.** Der übliche Weg wäre `npx web-push
 * generate-vapid-keys`; `node:crypto` kann dasselbe, und ein Paket für dreißig
 * Zeilen zu installieren widerspricht der Regel aus PROJEKT.md.
 *
 * Die beiden Werte gehören an genau zwei Stellen:
 *
 *   * **öffentlich** → `.env` als `VITE_VAPID_PUBLIC_KEY` und bei Vercel unter
 *     Settings → Environment Variables. Er darf im Browser stehen.
 *   * **privat** → Supabase → Project Settings → Edge Functions → Secrets als
 *     `VAPID_PRIVATE_KEY`. Er gehört nie in die App und nie ins Repository.
 *
 * Ein einmal erzeugtes Paar bleibt: Wird es ausgetauscht, sind alle bestehenden
 * Abos ungültig, und jedes Gerät muss den Schalter neu umlegen.
 */

import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

/** Base64url ohne Auffüllzeichen — die Kodierung, die Web Push überall benutzt. */
const toBase64Url = (buffer) => buffer.toString('base64url')

/*
 * Der öffentliche Schlüssel wird als JWK exportiert und daraus in die
 * unkomprimierte Form gebracht: 0x04 || X (32 Byte) || Y (32 Byte). Genau diese
 * 65 Byte erwartet `PushManager.subscribe()`.
 */
const jwk = publicKey.export({ format: 'jwk' })
const x = Buffer.from(jwk.x, 'base64url')
const y = Buffer.from(jwk.y, 'base64url')
const rawPublic = Buffer.concat([Buffer.from([4]), x, y])

const privateJwk = privateKey.export({ format: 'jwk' })

console.log('')
console.log('VAPID-Schlüsselpaar für Receipt AI')
console.log('==================================')
console.log('')
console.log('1) In die .env der App (und bei Vercel unter Environment Variables):')
console.log('')
console.log(`   VITE_VAPID_PUBLIC_KEY=${toBase64Url(rawPublic)}`)
console.log('')
console.log('2) In Supabase unter Project Settings → Edge Functions → Secrets:')
console.log('')
console.log(`   VAPID_PUBLIC_KEY=${toBase64Url(rawPublic)}`)
console.log(`   VAPID_PRIVATE_KEY=${privateJwk.d}`)
console.log('   VAPID_SUBJECT=mailto:DEINE-ADRESSE@example.com')
console.log('')
console.log('Der private Schlüssel gehört NUR nach Supabase — nie in die .env,')
console.log('nie ins Repository. Bewahr ihn zusätzlich in deinem Passwortspeicher auf:')
console.log('Geht er verloren, müssen alle Geräte den Schalter neu umlegen.')
console.log('')
