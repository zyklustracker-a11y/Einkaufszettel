/**
 * Der Aufruf bei Mistral.
 *
 * Endpunkt und Format sind OpenAI-kompatibel (PROJEKT.md). Hier steht nur das
 * Netzwerk-Handwerk: Anfrage bauen, Zeitlimit setzen, bei 429 mit wachsender
 * Wartezeit erneut versuchen, Antwort auspacken. Was *inhaltlich* gefragt wird,
 * steht in `prompt.ts`; was mit der Antwort passiert, in `validate.ts`.
 */

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

/**
 * Das Vision-Modell. Über das Secret `MISTRAL_MODEL` austauschbar, ohne den
 * Code anzufassen — praktisch, wenn Mistral die Familie umbenennt oder ein
 * größeres Modell im freien Tarif erscheint.
 */
const DEFAULT_MODEL = 'pixtral-12b-2409'

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

export type MistralOutcome =
  | { ok: true; text: string; model: string; durationMs: number }
  | { ok: false; reason: 'kontingent' | 'zeitueberschreitung' | 'modell_fehler'; detail: string }

export interface MistralRequest {
  apiKey: string
  model?: string
  systemPrompt: string
  userPrompt: string
  /** Das Bon-Foto als Data-URL, also `data:image/jpeg;base64,...`. */
  imageDataUrl: string
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
        content: [
          { type: 'text', text: request.userPrompt },
          // Mistral nimmt die Data-URL direkt als `image_url` entgegen.
          { type: 'image_url', image_url: request.imageDataUrl },
        ],
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
        }
      }
      return { ok: true, text, model, durationMs: Date.now() - started }
    }

    const detail = (await response.text().catch(() => '')).slice(0, 500)
    lastDetail = `HTTP ${response.status}: ${detail}`

    // Kontingent bzw. zu schnell: warten und noch einmal.
    if (response.status === 429) {
      if (i === MAX_ATTEMPTS - 1) {
        return { ok: false, reason: 'kontingent', detail: lastDetail }
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

    return { ok: false, reason: 'modell_fehler', detail: lastDetail }
  }

  return { ok: false, reason: 'modell_fehler', detail: lastDetail }
}
