/**
 * Der Aufruf bei Mistral.
 *
 * Endpunkt und Format sind OpenAI-kompatibel (PROJEKT.md). Hier steht nur das
 * Netzwerk-Handwerk: Anfrage bauen, Zeitlimit setzen, bei 429 mit wachsender
 * Wartezeit erneut versuchen, Antwort auspacken. Was *inhaltlich* gefragt wird,
 * steht in `prompt.ts`; was mit der Antwort passiert, in `validate.ts`.
 */

import type { ResponseDiagnostics } from './debug.ts'

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

/**
 * Das Vision-Modell. Über das Secret `MISTRAL_MODEL` austauschbar, ohne den
 * Code anzufassen.
 *
 * ---------------------------------------------------------------------------
 * GEÄNDERT MIT SCHRITT 14: pixtral-12b-2409 GIBT ES NICHT MEHR
 * ---------------------------------------------------------------------------
 *
 * Hier stand `pixtral-12b-2409`, seit Schritt 4b-1. Mistral hat das Modell am
 * **2. Dezember 2025 abgekündigt und zum 31. Dezember 2025 abgeschaltet**; als
 * Nachfolger nennt die Dokumentation ausdrücklich Ministral 3 14B. Ein Aufruf
 * unter dem alten Namen wird abgelehnt — die App sagt dann seit Schritt 4d
 * korrekt „Die Bon-Erkennung hat die Anfrage abgelehnt", nennt den Modellnamen
 * und ist trotzdem nicht mehr zu gebrauchen.
 *
 * Ein Standardwert, der nachweislich nicht mehr existiert, ist kein Standard,
 * sondern ein Ausfall. Deshalb steht hier jetzt der von Mistral benannte
 * Nachfolger: `ministral-14b-latest` — bildfähig (0,4 B Vision-Encoder neben
 * dem Sprachmodell), Apache 2.0, und damit im freien Experiment-Tarif.
 *
 * **Die `-latest`-Form ist Absicht.** Ein festes Datum im Namen
 * (`ministral-14b-2512`) altert genauso, wie `pixtral-12b-2409` gealtert ist.
 * Der Preis ist, dass sich das Modell unter dem Namen ändern kann; bei einer
 * App, die zwei Jahre ohne Wartung laufen soll, ist das der bessere Tausch. Wer
 * es festnageln will, setzt das Secret `MISTRAL_MODEL`.
 */
const DEFAULT_MODEL = 'ministral-14b-latest'

/**
 * Das Modell für Durchgang 2, die Zuordnung.
 *
 * Reine Textarbeit — dafür braucht es kein Vision-Modell. Über das Secret
 * `MISTRAL_TEXT_MODEL` austauschbar. Ist keines gesetzt, tut es auch das
 * Vision-Modell: Es kann Text ebenso, nur eben nicht ganz so gut.
 */
const DEFAULT_TEXT_MODEL = 'mistral-small-latest'

export { DEFAULT_MODEL, DEFAULT_TEXT_MODEL }

/**
 * Zeitlimit für einen einzelnen Versuch.
 *
 * Ein langer Bon mit vierzig Positionen braucht beim Modell durchaus 20–30
 * Sekunden. 60 Sekunden lassen dafür Luft und schneiden trotzdem ab, bevor die
 * Funktion selbst in ihr Laufzeitlimit läuft.
 */
const TIMEOUT_MS = 60_000

/**
 * Wie oft insgesamt versucht wird, und wie lange dazwischen gewartet wird.
 *
 * Der freie Tarif erlaubt etwa eine Anfrage pro Sekunde (PROJEKT.md). Ein 429
 * heißt deshalb meist „zu schnell", nicht „Kontingent für heute weg" — nach
 * ein, zwei Sekunden geht es oft weiter. Erst wenn alle Versuche scheitern,
 * sieht der Nutzer eine Meldung.
 */
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [1_000, 2_500, 5_000]

/** Obergrenze für die Antwort. Ein sehr langer Bon braucht Platz. */
const MAX_TOKENS = 4_000

export type MistralFailure =
  | 'kontingent'
  | 'zeitueberschreitung'
  | 'modell_fehler'
  /**
   * Die Schnittstelle hat die Anfrage abgelehnt (4xx außer 429).
   *
   * Das ist fast immer ein Einrichtungsfehler und keine Störung — allen voran
   * ein Modellname, den es nicht gibt oder den der eigene Tarif nicht freigibt.
   * Er bekommt einen eigenen Grund, weil „nicht erreichbar" hier in die Irre
   * führt: Es liegt nicht an Mistral, sondern am Secret.
   */
  | 'modell_abgelehnt'

export type MistralOutcome =
  | {
      ok: true
      text: string
      model: string
      durationMs: number
      /**
       * Was die Schnittstelle über das Ende der Antwort sagt.
       *
       * Bis Schritt 18 wurde das hier weggeworfen — und damit die einzige
       * Angabe, an der sich eine **abgeschnittene** Antwort von einer
       * **kaputten** unterscheiden lässt. Beide kommen als unlesbares JSON an;
       * die eine ist ein zu langer Bon, die andere ein Modellfehler. Ohne
       * `finish_reason` sind beide dasselbe Rätsel.
       */
      diagnostics: ResponseDiagnostics
    }
  | { ok: false; reason: MistralFailure; detail: string; model: string }

export interface MistralRequest {
  apiKey: string
  model?: string
  systemPrompt: string
  userPrompt: string
  /**
   * Das Bon-Foto als Data-URL, also `data:image/jpeg;base64,...`.
   *
   * Fehlt es, wird ein reiner Textaufruf daraus. Das ist Durchgang 2, die
   * Zuordnung: Er bekommt nur die Rohtexte und braucht den Bon nicht mehr —
   * und ohne Bild ist der Aufruf ein Bruchteil so teuer und deutlich schneller.
   */
  imageDataUrl?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wartezeit nach einem 429.
 *
 * Sagt der Server über `Retry-After`, wie lange zu warten ist, gilt seine
 * Angabe — aber gedeckelt, damit ein „warte 300 Sekunden" nicht die ganze
 * Funktion blockiert. Sonst greift die feste Staffel.
 */
function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  const seconds = header ? Number(header) : Number.NaN
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000)
  return BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
}

/** Der Antworttext aus dem OpenAI-kompatiblen Umschlag. */
function readContent(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null

  const content = (choices[0] as { message?: { content?: unknown } }).message?.content

  if (typeof content === 'string') return content

  /*
   * Manche Modellversionen antworten mit einer Liste von Textblöcken statt mit
   * einem String. Beides ist gültig, deshalb wird beides gelesen.
   */
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: unknown }).text ?? '')))
      .filter((part): part is string => typeof part === 'string')
      .join('')
  }

  return null
}

/**
 * Abbruchgrund und Token-Verbrauch aus dem OpenAI-kompatiblen Umschlag.
 *
 * Beides ist optional — nicht jede Version meldet `usage`, und ein Fehlen ist
 * kein Fehler. Deshalb überall null statt einer Ausnahme: Ein fehlender
 * Zählerstand darf einen gelesenen Bon nicht kosten.
 */
function readDiagnostics(
  payload: unknown,
  textLength: number,
  jsonMode: boolean,
): ResponseDiagnostics {
  const choices = (payload as { choices?: unknown }).choices
  const first = Array.isArray(choices) ? (choices[0] as { finish_reason?: unknown }) : null
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })
    .usage

  const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  return {
    finishReason: typeof first?.finish_reason === 'string' ? first.finish_reason : null,
    inputTokens: count(usage?.prompt_tokens),
    outputTokens: count(usage?.completion_tokens),
    textLength,
    jsonMode,
  }
}

/**
 * Ein einzelner Versuch. `jsonMode` schaltet Mistrals JSON-Modus zu.
 *
 * Der Modus wird beim ersten Versuch mitgeschickt, weil er die Wahrscheinlichkeit
 * für kaputtes JSON deutlich senkt. Lehnt ein Modell ihn ab (Antwort 400),
 * probiert `callMistral` es ohne — besser eine Antwort, die `validate.ts` noch
 * geraderücken muss, als gar keine.
 */
async function attempt(
  request: MistralRequest,
  model: string,
  jsonMode: boolean,
): Promise<Response> {
  const body = {
    model,
    // 0 = so wenig Fantasie wie möglich. Bei einem Kassenzettel gibt es nichts
    // zu erfinden, es gibt genau eine richtige Antwort.
    temperature: 0,
    max_tokens: MAX_TOKENS,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        // Ohne Bild ein einfacher Text — die Blockform ist nur nötig, wenn
        // neben dem Text noch etwas anderes mitkommt.
        content: request.imageDataUrl
          ? [
              { type: 'text', text: request.userPrompt },
              // Mistral nimmt die Data-URL direkt als `image_url` entgegen.
              { type: 'image_url', image_url: request.imageDataUrl },
            ]
          : request.userPrompt,
      },
    ],
  }

  return await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/**
 * Ruft das Modell auf und gibt seinen rohen Antworttext zurück.
 *
 * Geprüft wird hier nichts Inhaltliches — auch eine Antwort, die offensichtlich
 * Unsinn ist, kommt durch. Das ist Absicht: Der Rohtext soll unverändert im
 * Korrektur-Screen sichtbar werden, sonst lässt sich der Prompt nicht
 * nachschärfen.
 */
export async function callMistral(request: MistralRequest): Promise<MistralOutcome> {
  const model = request.model ?? DEFAULT_MODEL
  const started = Date.now()
  let jsonMode = true
  let lastDetail = 'Unbekannter Fehler beim Modell-Aufruf.'

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let response: Response
    try {
      response = await attempt(request, model, jsonMode)
    } catch (cause) {
      // AbortSignal.timeout wirft einen TimeoutError; alles andere ist Netz.
      const name = (cause as { name?: string }).name
      if (name === 'TimeoutError' || name === 'AbortError') {
        return {
          ok: false,
          reason: 'zeitueberschreitung',
          detail: `Zeitlimit von ${TIMEOUT_MS} ms überschritten.`,
          model,
        }
      }
      lastDetail = `Netzwerkfehler: ${String((cause as { message?: string }).message ?? cause)}`
      if (i === MAX_ATTEMPTS - 1) break
      await sleep(BACKOFF_MS[i])
      continue
    }

    if (response.ok) {
      const payload = await response.json().catch(() => null)
      const text = payload ? readContent(payload) : null
      if (text === null) {
        return {
          ok: false,
          reason: 'modell_fehler',
          detail: 'Die Antwort von Mistral enthielt keinen Text.',
          model,
        }
      }
      return {
        ok: true,
        text,
        model,
        durationMs: Date.now() - started,
        diagnostics: readDiagnostics(payload, text.length, jsonMode),
      }
    }

    const detail = (await response.text().catch(() => '')).slice(0, 500)
    lastDetail = `HTTP ${response.status}: ${detail}`

    // Kontingent bzw. zu schnell: warten und noch einmal.
    if (response.status === 429) {
      if (i === MAX_ATTEMPTS - 1) {
        return { ok: false, reason: 'kontingent', detail: lastDetail, model }
      }
      await sleep(retryDelay(response, i))
      continue
    }

    /*
     * Kennt das Modell den JSON-Modus nicht, antwortet die Schnittstelle mit
     * 400. Statt aufzugeben wird derselbe Aufruf einmal ohne den Modus
     * wiederholt — kaputtes JSON fängt `validate.ts` ab, gar keine Antwort
     * fängt niemand ab.
     */
    if (response.status === 400 && jsonMode && detail.includes('response_format')) {
      jsonMode = false
      continue
    }

    // 5xx sind vorübergehend, 4xx nicht — nur die einen lohnen einen zweiten Versuch.
    if (response.status >= 500 && i < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFF_MS[i])
      continue
    }

    /*
     * Jedes andere 4xx ist eine abgelehnte Anfrage und keine Störung: Der
     * Server hat verstanden und Nein gesagt. Der mit Abstand häufigste Grund
     * ist ein Modellname, den es nicht gibt oder den der Tarif nicht freigibt.
     * Der Grund bekommt deshalb einen eigenen Namen, und der Text der
     * Schnittstelle wird durchgereicht — er sagt genau, was fehlt.
     */
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, reason: 'modell_abgelehnt', detail: apiMessage(detail), model }
    }

    return { ok: false, reason: 'modell_fehler', detail: lastDetail, model }
  }

  return { ok: false, reason: 'modell_fehler', detail: lastDetail, model }
}

/**
 * Der Klartext aus einer Fehlerantwort von Mistral.
 *
 * Die Schnittstelle antwortet mal `{"message":"..."}`, mal
 * `{"detail":[{"msg":"..."}]}`, mal mit reinem Text. Gesucht ist der eine Satz,
 * der dem Nutzer weiterhilft — nicht das ganze JSON.
 */
function apiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown
      error?: { message?: unknown }
      detail?: unknown
    }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
    if (typeof parsed.error?.message === 'string' && parsed.error.message) return parsed.error.message
    if (Array.isArray(parsed.detail)) {
      const first = parsed.detail[0] as { msg?: unknown } | undefined
      if (typeof first?.msg === 'string') return first.msg
    }
    if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail
  } catch {
    // Kein JSON — dann ist der Rohtext das Beste, was wir haben.
  }
  return body.slice(0, 200) || 'ohne nähere Angabe'
}
