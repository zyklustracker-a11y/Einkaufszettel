/**
 * Der Aufruf bei Mistral.
 *
 * Endpunkt und Format sind OpenAI-kompatibel (PROJEKT.md). Hier steht nur das
 * Netzwerk-Handwerk: Anfrage bauen, Zeitlimit setzen, bei 429 mit wachsender
 * Wartezeit erneut versuchen, Antwort auspacken. Was *inhaltlich* gefragt wird,
 * steht in `prompt.ts`; was mit der Antwort passiert, in `validate.ts`.
 */

import { isTruncated } from './debug.ts'
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

/**
 * Obergrenze für die Antwort.
 *
 * ---------------------------------------------------------------------------
 * ANGEHOBEN MIT SCHRITT 18: 4.000 → 8.000
 * ---------------------------------------------------------------------------
 *
 * Nachgerechnet für einen Bon mit 35 Positionen: Die erwartete Antwort ist rund
 * 1.400 Zeichen kompakt, also je nach Zerlegung 400–800 Ausgabe-Token. Mit 4.000
 * war das fünf- bis achtfach gedeckt — die alte Grenze war also **nicht** knapp
 * bemessen, und ein langer Bon sprengt sie nicht durch seine Länge allein.
 *
 * Sprengen kann sie etwas anderes: Wenn das Modell auf einem schwer lesbaren
 * Foto in eine Wiederholung gerät und dieselbe Zeile immer weiter schreibt.
 * Dann läuft es bis zur Grenze, egal wie hoch sie steht.
 *
 * 8.000 ist deshalb kein Heilmittel, sondern Reserve — für den Bon mit siebzig
 * Positionen, den es auch gibt. Der eigentliche Fortschritt ist, dass ein
 * Erreichen der Grenze jetzt **bemerkt** wird (`finish_reason`) und nicht mehr
 * in einer Fehlermeldung endet: Erst wird weitergeschrieben (siehe
 * `MAX_CONTINUATIONS`), und was dann noch fehlt, wird als Teilergebnis
 * geschlossen (`repair.ts`).
 */
const MAX_TOKENS = 8_000

/**
 * Wie oft weitergeschrieben wird, wenn die Antwort an der Grenze endet.
 *
 * Mistral kann eine begonnene Assistenten-Nachricht fortsetzen (`prefix: true`).
 * Der bisherige Text geht dabei unverändert zurück, und das Modell schreibt
 * daran weiter — es fängt also nicht von vorn an und tippt den Bon nicht ein
 * zweites Mal ab.
 *
 * Zwei Runden, nicht mehr. Mit 8.000 Token je Runde sind das bis zu 24.000
 * Token für einen einzigen Bon; wer die auch noch sprengt, hat kein
 * Platzproblem, sondern eine Wiederholungsschleife — und die wird durch eine
 * dritte Runde nur teurer. Danach gilt, was da ist: `repair.ts` schließt es zu
 * einem Teilergebnis, und der Nutzer sieht im Korrektur-Screen, was fehlt.
 */
const MAX_CONTINUATIONS = 2

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
  /**
   * Weitere Bilder desselben Bons — die überlappenden Kacheln aus Schritt 18.
   *
   * Ein sehr langer Bon wird im Browser in zwei bis drei senkrecht
   * überlappende Ausschnitte geschnitten, damit die Schrift groß genug
   * ankommt. Sie gehen **zusammen in einem Aufruf** hin, in gedruckter
   * Reihenfolge: Nur so kann das Modell die Überlappung erkennen und die
   * doppelt sichtbaren Zeilen zusammenführen. Zwei getrennte Aufrufe wüssten
   * nichts voneinander.
   */
  extraImageDataUrls?: string[]
  /**
   * Ein JSON-Schema für die Antwort — Mistrals „structured output".
   *
   * Ist es gesetzt, wird es als erstes probiert. Die Schnittstelle erzwingt
   * dann die Form, statt sie nur zu erbitten, und der Prompt muss sie nicht
   * mehr allein durchsetzen. Lehnt das Modell den Modus ab (Antwort 400),
   * fällt `callMistral` von selbst auf den einfachen JSON-Modus zurück und von
   * dort auf gar keinen. Siehe `FORMAT_LADDER`.
   */
  jsonSchema?: { name: string; schema: unknown }
}

/**
 * Die Stufenleiter der Antwortformate, von streng nach nachgiebig.
 *
 * **Warum eine Leiter und keine feste Wahl:** Welches Modell welchen Modus
 * kennt, ändert sich — `MISTRAL_MODEL` ist ein Secret, und die Voreinstellung
 * zeigt bewusst auf `-latest`. Ein fest verdrahteter Modus wäre genau die Sorte
 * Annahme, die in einem Jahr still bricht. Lehnt die Schnittstelle eine Stufe
 * ab, wird die nächste probiert; abgelehnt wird dabei nur der Modus, nicht die
 * Anfrage.
 *
 * Die unterste Stufe ist immer erreichbar: kein Format, dafür `repair.ts`
 * dahinter. Besser eine Antwort, die geradegerückt werden muss, als gar keine.
 */
const FORMAT_LADDER = ['json_schema', 'json_object', 'none'] as const

type ResponseFormatRung = (typeof FORMAT_LADDER)[number]

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
  rung: ResponseFormatRung,
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
    responseFormat: rung,
    // Wird von `callMistral` hochgezählt; ein einzelner Aufruf weiß davon nichts.
    continuations: 0,
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
  rung: ResponseFormatRung,
  /**
   * Der bisher geschriebene Text, wenn dies eine Fortsetzung ist.
   *
   * Er geht als begonnene Assistenten-Nachricht mit `prefix: true` zurück.
   * Mistral schreibt dann daran weiter, statt neu anzufangen — der Bon wird
   * also nicht ein zweites Mal abgetippt und bezahlt.
   */
  prefill: string | null,
): Promise<Response> {
  const images = [
    ...(request.imageDataUrl ? [request.imageDataUrl] : []),
    ...(request.extraImageDataUrls ?? []),
  ]

  const body = {
    model,
    // 0 = so wenig Fantasie wie möglich. Bei einem Kassenzettel gibt es nichts
    // zu erfinden, es gibt genau eine richtige Antwort.
    temperature: 0,
    max_tokens: MAX_TOKENS,
    ...responseFormat(rung, request, prefill),
    messages: [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        // Ohne Bild ein einfacher Text — die Blockform ist nur nötig, wenn
        // neben dem Text noch etwas anderes mitkommt.
        content:
          images.length > 0
            ? [
                { type: 'text', text: request.userPrompt },
                // Mistral nimmt die Data-URL direkt als `image_url` entgegen.
                // Mehrere Kacheln kommen in gedruckter Reihenfolge, damit die
                // Überlappung für das Modell nachvollziehbar bleibt.
                ...images.map((url) => ({ type: 'image_url', image_url: url })),
              ]
            : request.userPrompt,
      },
      ...(prefill === null
        ? []
        : [{ role: 'assistant', content: prefill, prefix: true }]),
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
 * Der `response_format`-Teil des Anfragekörpers für eine Stufe der Leiter.
 *
 * **Bei einer Fortsetzung bleibt er weg.** Das ist kein Versehen: Ein
 * erzwungenes Format und ein vorgegebener Anfang widersprechen sich — die
 * Schnittstelle müsste ein vollständiges JSON-Objekt erzeugen und zugleich
 * mitten in einem weiterschreiben. Die Form wird bei der Fortsetzung ohnehin
 * durch den mitgeschickten Anfang vorgegeben, und was am Ende trotzdem nicht
 * aufgeht, schließt `repair.ts`.
 */
function responseFormat(
  rung: ResponseFormatRung,
  request: MistralRequest,
  prefill: string | null,
): Record<string, unknown> {
  if (prefill !== null || rung === 'none') return {}

  if (rung === 'json_schema') {
    if (!request.jsonSchema) return {}
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.jsonSchema.name,
          schema: request.jsonSchema.schema,
          strict: true,
        },
      },
    }
  }

  return { response_format: { type: 'json_object' } }
}

/** Die erste Stufe, die für diese Anfrage überhaupt in Frage kommt. */
function firstRung(request: MistralRequest): ResponseFormatRung {
  return request.jsonSchema ? 'json_schema' : 'json_object'
}

/** Die nächstniedrigere Stufe, oder null, wenn es keine mehr gibt. */
function nextRung(rung: ResponseFormatRung): ResponseFormatRung | null {
  const index = FORMAT_LADDER.indexOf(rung)
  return FORMAT_LADDER[index + 1] ?? null
}

/** Das Ergebnis eines Aufrufs samt der Stufe, auf der er zustande kam. */
interface OnceResult {
  outcome: MistralOutcome
  rung: ResponseFormatRung
}

/**
 * Ein Aufruf mit allen Wiederholungen — aber ohne Fortsetzung.
 *
 * Hier steckt das Netz-Handwerk: Zeitlimit, 429 mit wachsender Wartezeit, 5xx
 * noch einmal, und das Herabsteigen auf der Format-Leiter. Die Fortsetzung
 * einer abgeschnittenen Antwort ist eine Ebene darüber (`callMistral`) — sie
 * ist kein Netzproblem, sondern eine inhaltliche Entscheidung.
 */
async function callOnce(
  request: MistralRequest,
  model: string,
  startRung: ResponseFormatRung,
  prefill: string | null,
): Promise<OnceResult> {
  /*
   * Die Stufe steht in einem Halter und nicht als schlichte Variable, weil sie
   * zwei Leser hat: die Schleife unten, die auf ihr herabsteigt, und der
   * Aufrufer, der wissen muss, auf welcher Stufe es am Ende geklappt hat —
   * sonst begänne die Fortsetzung wieder ganz oben und liefe in dieselbe
   * Ablehnung.
   */
  const state = { rung: startRung }
  const outcome = await withRetries(request, model, state, prefill)
  return { outcome, rung: state.rung }
}

async function withRetries(
  request: MistralRequest,
  model: string,
  state: { rung: ResponseFormatRung },
  prefill: string | null,
): Promise<MistralOutcome> {
  const started = Date.now()
  let lastDetail = 'Unbekannter Fehler beim Modell-Aufruf.'

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let response: Response
    try {
      response = await attempt(request, model, state.rung, prefill)
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
        diagnostics: readDiagnostics(payload, text.length, state.rung),
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
     * Kennt das Modell das verlangte Antwortformat nicht, antwortet die
     * Schnittstelle mit 400. Statt aufzugeben wird eine Stufe hinabgestiegen:
     * erst `json_schema`, dann `json_object`, dann gar keins. Kaputtes JSON
     * fängt `repair.ts` ab, gar keine Antwort fängt niemand ab.
     *
     * Der Versuchszähler läuft dabei **nicht** weiter (`i--`): Ein abgelehntes
     * Format ist kein Fehlversuch, sondern eine Feststellung über das Modell.
     * Sonst verbrauchte eine zweistufige Leiter zwei der drei Versuche, bevor
     * überhaupt einmal ernsthaft gefragt wurde.
     */
    if (response.status === 400 && detail.includes('response_format')) {
      const lower = nextRung(state.rung)
      if (lower) {
        console.error(`Antwortformat „${state.rung}" abgelehnt, weiter mit „${lower}".`)
        state.rung = lower
        i--
        continue
      }
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
 * Ruft das Modell auf und gibt seinen rohen Antworttext zurück.
 *
 * Geprüft wird hier nichts Inhaltliches — auch eine Antwort, die offensichtlich
 * Unsinn ist, kommt durch. Das ist Absicht: Der Rohtext soll unverändert im
 * Korrektur-Screen sichtbar werden, sonst lässt sich der Prompt nicht
 * nachschärfen.
 *
 * ---------------------------------------------------------------------------
 * NEU MIT SCHRITT 18: DIE ANTWORT DARF ZU ENDE GESCHRIEBEN WERDEN
 * ---------------------------------------------------------------------------
 *
 * Endet eine Antwort an `max_tokens` (`finish_reason: "length"`), war sie
 * bisher verloren: Der abgeschnittene Text ging als „fertig" zurück, das JSON
 * ließ sich nicht lesen, und der Nutzer bekam „Die Antwort der Erkennung war
 * unbrauchbar" — für einen Bon, der zu neunzig Prozent gelesen war.
 *
 * Jetzt wird stattdessen weitergeschrieben: Der bisherige Text geht als
 * begonnene Assistenten-Nachricht (`prefix: true`) zurück, und das Modell setzt
 * ihn fort. Der Bon wird dabei **nicht** ein zweites Mal abgetippt — das
 * Abgeschriebene steht ja schon da.
 *
 * Höchstens zwei Runden (`MAX_CONTINUATIONS`). Danach gilt, was da ist: Ein
 * Modell, das auch nach 24.000 Token nicht fertig ist, hat kein Platzproblem,
 * sondern eine Wiederholungsschleife. `repair.ts` schließt den Text dann zu
 * einem Teilergebnis, und der Korrektur-Screen zeigt, was fehlt.
 *
 * **Scheitert eine Fortsetzungsrunde, gilt das Bisherige.** Das ist der Kern:
 * Ein Netzfehler in Runde zwei darf nicht das kosten, was Runde eins gelesen
 * hat. Der teure Teil ist da, und er wird nicht wegen des billigen weggeworfen.
 */
export async function callMistral(request: MistralRequest): Promise<MistralOutcome> {
  const model = request.model ?? DEFAULT_MODEL
  const started = Date.now()

  const first = await callOnce(request, model, firstRung(request), null)
  if (!first.outcome.ok) return first.outcome

  let text = first.outcome.text
  let diagnostics = first.outcome.diagnostics
  let outputTokens = diagnostics.outputTokens ?? 0
  let rounds = 0

  while (isTruncated(diagnostics.finishReason) && rounds < MAX_CONTINUATIONS) {
    rounds++
    console.error(
      `Antwort an der Token-Grenze abgeschnitten, Fortsetzung ${rounds}/${MAX_CONTINUATIONS}.`,
    )

    const next = await callOnce(request, model, first.rung, text)
    if (!next.outcome.ok) {
      // Bewusst kein Abbruch: Das Bisherige ist mehr wert als ein Fehler.
      console.error('Fortsetzung fehlgeschlagen, weiter mit dem Teilergebnis:', next.outcome.detail)
      break
    }

    /*
     * Aneinandersetzen ohne Trennzeichen. Das Modell schreibt an derselben
     * Zeichenkette weiter — ein Leerzeichen oder Zeilenumbruch dazwischen
     * könnte mitten in einem Wort landen und aus „MILCH" ein „MIL CH" machen.
     */
    text += next.outcome.text
    diagnostics = next.outcome.diagnostics
    outputTokens += diagnostics.outputTokens ?? 0
  }

  return {
    ok: true,
    text,
    model,
    durationMs: Date.now() - started,
    diagnostics: {
      ...diagnostics,
      // Die Zahlen gelten für das Ganze, nicht für die letzte Runde.
      outputTokens: outputTokens === 0 ? null : outputTokens,
      textLength: text.length,
      continuations: rounds,
    },
  }
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
