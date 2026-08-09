/**
 * Web Push — Verschlüsselung und VAPID, von Hand.
 *
 * ---------------------------------------------------------------------------
 * WARUM KEINE BIBLIOTHEK
 * ---------------------------------------------------------------------------
 *
 * Für Web Push gibt es `web-push` auf npm, und der übliche Weg wäre, sie zu
 * nehmen. Dagegen sprechen hier zwei Dinge:
 *
 *   1. **Prüfbarkeit.** Die beiden Normen (RFC 8188 für die Verschlüsselung,
 *      RFC 8291 für die Schlüsselableitung) enthalten vollständige
 *      Testvektoren. Was hier steht, wird gegen genau diese Vektoren geprüft
 *      (`push.test.ts`) — eine Bibliothek könnte man nur ausprobieren.
 *   2. **Keine neue Abhängigkeit** (PROJEKT.md). Alles unten läuft auf der
 *      Web-Crypto-Schnittstelle, die Deno und Node beide mitbringen; es kommt
 *      kein einziges Paket dazu.
 *
 * Es sind rund hundertfünfzig Zeilen, und jede davon ist eine Zeile aus dem RFC.
 *
 * ---------------------------------------------------------------------------
 * WAS HIER PASSIERT
 * ---------------------------------------------------------------------------
 *
 * Eine Push-Nachricht ist zweimal abgesichert, und die beiden Teile haben
 * verschiedene Aufgaben:
 *
 *   * **Der Inhalt ist Ende-zu-Ende verschlüsselt** (RFC 8291). Der Push-Dienst
 *     — bei iOS Apple, bei Android Google — leitet nur ein undurchsichtiges
 *     Paket weiter. Den Schlüssel dafür hat das Gerät beim Abonnieren erzeugt;
 *     der Server kennt nur den öffentlichen Teil.
 *   * **VAPID weist den Absender aus** (RFC 8292). Ein signiertes Token sagt dem
 *     Push-Dienst, wer sendet — sonst könnte jeder, der eine Abo-Adresse kennt,
 *     dorthin senden.
 *
 * Reine Funktionen, kein Netz, keine Datenbank: `index.ts` setzt sie zusammen.
 */

/* ============================================================== Kleinteile */

/** Base64url ohne Auffüllzeichen — die Kodierung, die im Web Push überall gilt. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Eine Zahl als 4 Byte, höchstwertiges Byte zuerst — so verlangt es RFC 8188. */
function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value)
  return out
}

/* ================================================== HKDF, wie im RFC benutzt */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data as BufferSource))
}

/**
 * HKDF in der Kurzform, die Web Push benutzt: extrahieren, einmal expandieren,
 * abschneiden.
 *
 * Die volle Fassung aus RFC 5869 kann mehrere Runden; hier werden nie mehr als
 * 32 Byte gebraucht, also genügt eine.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, Uint8Array.from([1])))
  return okm.slice(0, length)
}

/* ====================================================== Der Schlüsselaustausch */

/** Der öffentliche Schlüssel eines Abos, in der unkomprimierten Form (65 Byte). */
async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )
}

/**
 * Das gemeinsame Geheimnis aus dem eigenen privaten und dem fremden öffentlichen
 * Schlüssel — der Kern von ECDH.
 */
async function sharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )
  return new Uint8Array(bits)
}

/** Ein frisches Schlüsselpaar für genau eine Nachricht. */
async function ephemeralKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
}

/* ================================================== Der verschlüsselte Körper */

export interface PushSubscription {
  endpoint: string
  /** Der öffentliche Schlüssel des Geräts, base64url. */
  p256dh: string
  /** Das Abo-Geheimnis, base64url. */
  auth: string
}

/**
 * Der Nachrichtenkörper nach RFC 8188 („aes128gcm").
 *
 * Aufbau:
 *
 *     salt (16) | rs (4) | idlen (1) | Absender-Schlüssel (65) | Chiffrat
 *
 * `salt` und das Schlüsselpaar sind bei jedem Aufruf neu; für den Test lassen
 * sie sich vorgeben, damit das Ergebnis mit dem Vektor aus RFC 8291 vergleichbar
 * ist.
 */
export async function encryptPayload(
  subscription: PushSubscription,
  payload: string,
  fixed?: { salt: Uint8Array; keyPair: CryptoKeyPair },
): Promise<Uint8Array> {
  const clientPublicRaw = fromBase64Url(subscription.p256dh)
  const authSecret = fromBase64Url(subscription.auth)

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const keyPair = fixed?.keyPair ?? (await ephemeralKeyPair())

  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const clientPublicKey = await importPublicKey(clientPublicRaw)
  const ecdh = await sharedSecret(keyPair.privateKey, clientPublicKey)

  /*
   * RFC 8291, Abschnitt 3.4: Erst wird aus dem ECDH-Geheimnis und dem
   * Abo-Geheimnis ein Zwischenschlüssel gebildet, und **in dessen `info` stehen
   * beide öffentlichen Schlüssel**. Genau das bindet die Nachricht an dieses
   * eine Abo — dieselbe Nachricht an ein anderes Gerät ergibt einen anderen
   * Schlüssel.
   */
  const keyInfo = concat(utf8('WebPush: info\0'), clientPublicRaw, serverPublicRaw)
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32)

  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  /*
   * Das Trennzeichen 0x02 heißt „letzter Abschnitt" (RFC 8188, Abschnitt 2).
   * Ohne es lehnt der Push-Dienst die Nachricht ab; mit 0x01 erwartete der
   * Empfänger einen weiteren Abschnitt, der nie kommt.
   */
  const record = concat(utf8(payload), Uint8Array.from([2]))

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      record as BufferSource,
    ),
  )

  return concat(
    salt,
    uint32(4096),
    Uint8Array.from([serverPublicRaw.length]),
    serverPublicRaw,
    ciphertext,
  )
}

/* ============================================================ VAPID (RFC 8292) */

/**
 * Der private VAPID-Schlüssel, so wie ihn `scripts/vapid-keys.mjs` ausgibt: die
 * rohen 32 Byte als base64url. Für Web Crypto muss daraus ein JWK werden — und
 * dafür werden auch die beiden Hälften des öffentlichen Schlüssels gebraucht.
 */
async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const raw = fromBase64Url(publicKey)
  if (raw.length !== 65 || raw[0] !== 4) {
    throw new Error('Der öffentliche VAPID-Schlüssel hat nicht die erwartete Form (65 Byte, 0x04).')
  }

  return await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(raw.slice(1, 33)),
      y: toBase64Url(raw.slice(33, 65)),
      d: privateKey.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/**
 * Das VAPID-Token für einen Push-Dienst.
 *
 * `aud` ist der **Ursprung** der Abo-Adresse und nicht die Adresse selbst — ein
 * Token gilt damit für alle Abos desselben Dienstes und muss nicht je Gerät neu
 * signiert werden.
 *
 * `nowSeconds` ist ein Parameter und keine Uhr im Rumpf: Nur so lässt sich das
 * Ergebnis im Test festnageln.
 */
export async function vapidHeader(
  endpoint: string,
  keys: { publicKey: string; privateKey: string; subject: string },
  nowSeconds: number,
): Promise<string> {
  const audience = new URL(endpoint).origin

  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(
    utf8(
      JSON.stringify({
        aud: audience,
        // Zwölf Stunden. Die Norm erlaubt bis zu 24; kürzer ist unkritisch, und
        // ein Token wird ohnehin je Lauf neu gebildet.
        exp: nowSeconds + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  )

  const signingInput = utf8(`${header}.${claims}`)
  const key = await importVapidKey(keys.publicKey, keys.privateKey)
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signingInput as BufferSource,
    ),
  )

  const token = `${header}.${claims}.${toBase64Url(signature)}`
  return `vapid t=${token}, k=${keys.publicKey}`
}
