import { functionsUrl, supabase, supabaseAnonKey } from '../lib/supabase'
import { applyAssignments, withAssignmentFailure } from '../lib/assignments'
import type { CapturedImage } from '../lib/camera'
import type {
  AssignmentResponse,
  ExtractionPhase,
  ExtractionResponse,
  StructureResponse,
} from '../lib/extraction'

// Weiterreichen, damit Aufrufer den Typ zusammen mit `extractReceipt` bekommen.
export type { ExtractionPhase }

/**
 * Der Aufruf der Bon-Erkennung — beide Durchgänge.
 *
 * Die einzige Stelle in der App, die mit der Edge Function spricht. Der
 * Mistral-Schlüssel bleibt dabei auf dem Server (PROJEKT.md).
 *
 *   1. **Lesen.** Das Foto geht hin, zurück kommt die Struktur des Bons:
 *      Positionen, Beträge, Steuerkennzeichen — und, was der Haushalt schon
 *      kennt, gleich zugeordnet.
 *   2. **Zuordnen.** Für die übrigen Rohtexte ein zweiter Aufruf, diesmal ohne
 *      Bild. Er entfällt, wenn nichts offen ist.
 *
 * **Der zweite Durchgang darf scheitern.** Netzfehler, erschöpftes Kontingent,
 * unbrauchbare Antwort: Der Bon ist dann nicht verloren. Der teure Teil ist
 * geschafft, die Beträge stehen, und der Korrektur-Screen zeigt die Positionen
 * mit ihrem Kassentext. Namen und Kategorien setzt der Nutzer von Hand — eine
 * Minute Arbeit gegen einen kompletten Neuscan.
 *
 * Jeder Fehler des *ersten* Durchgangs verlässt diese Datei dagegen als
 * `ExtractionError` mit einem fertigen deutschen Satz. Weder ein HTTP-Status
 * noch eine Rohmeldung erreicht je die Oberfläche.
 */

/** Ein Fehler, dessen Text schon auf Deutsch und direkt anzeigbar ist. */
export class ExtractionError extends Error {
  /** Maschinenlesbarer Grund, etwa für „noch einmal versuchen" oder nicht. */
  readonly code: string
  /** Die Rohantwort des Modells, wenn es eine gab — hilft beim Nachschärfen. */
  readonly raw: string | null

  constructor(code: string, message: string, raw: string | null = null) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
    this.raw = raw
  }
}

/**
 * Zeitlimit für den ganzen Vorgang, großzügiger als das der Funktion selbst
 * (60 s beim Modell): Hinzu kommt hier noch das Hochladen des Bildes über eine
 * Mobilfunkverbindung.
 */
const TIMEOUT_MS = 90_000

/**
 * Zeitlimit für Durchgang 2. Deutlich knapper, denn hier geht kein Bild über
 * die Leitung und das Textmodell antwortet in Sekunden. Läuft es ab, gilt die
 * Zuordnung als ausgefallen — und der Bon kommt trotzdem durch.
 */
const ASSIGNMENT_TIMEOUT_MS = 30_000

/**
 * Ein `Blob` als Base64, ohne den `data:`-Vorspann.
 *
 * Über den `FileReader` statt über `btoa`: Ein Bon-Foto hat schnell eine halbe
 * Million Bytes, und `String.fromCharCode(...bytes)` würde bei so vielen
 * Argumenten den Aufrufstapel sprengen.
 */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      // `readAsDataURL` liefert "data:image/jpeg;base64,XXXX" — der Kopf muss weg.
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/** Fehlerantwort der Funktion, soweit sie sich lesen lässt. */
interface ErrorBody {
  code?: unknown
  message?: unknown
  raw?: unknown
}

/**
 * Ersatztexte für den Fall, dass die Funktion gar nicht erst antwortet oder
 * ihre Antwort unlesbar ist. Im Normalfall kommt der Text von dort — die
 * Funktion kennt den genauen Grund besser als die App.
 */
const FALLBACK: Record<number, string> = {
  401: 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.',
  403: 'Für die Bon-Erkennung fehlt die Berechtigung.',
  404: 'Die Bon-Erkennung ist auf dem Server nicht eingerichtet.',
  413: 'Das Bild ist zu groß. Bitte noch einmal mit der Kamera in der App aufnehmen.',
  429: 'Das Kontingent ist gerade erschöpft. Bitte in ein paar Minuten noch einmal versuchen.',
  504: 'Die Erkennung hat zu lange gedauert. Bitte noch einmal versuchen.',
}

const GENERIC = 'Die Erkennung hat nicht geklappt. Bitte versuch es noch einmal.'

/** Ein Aufruf der Funktion. Wirft `ExtractionError` mit fertigem deutschem Satz. */
async function call(token: string, body: unknown, timeoutMs: number): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${functionsUrl}/erkennen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Das Supabase-Gateway erwartet den öffentlichen Schlüssel zusätzlich
        // zum Anmelde-Token.
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    const name = (cause as { name?: string }).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ExtractionError(
        'zeitueberschreitung',
        'Die Erkennung hat zu lange gedauert. Bitte noch einmal versuchen.',
      )
    }
    throw new ExtractionError(
      'netz',
      'Keine Verbindung. Prüfe deine Internetverbindung und versuch es noch einmal.',
    )
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ErrorBody | null
    const message = typeof errorBody?.message === 'string' ? errorBody.message : null
    const code = typeof errorBody?.code === 'string' ? errorBody.code : `http_${response.status}`
    const raw = typeof errorBody?.raw === 'string' ? errorBody.raw : null
    throw new ExtractionError(code, message ?? FALLBACK[response.status] ?? GENERIC, raw)
  }

  return await response.json().catch(() => null)
}

export async function extractReceipt(
  capture: CapturedImage,
  onPhase?: (phase: ExtractionPhase) => void,
): Promise<ExtractionResponse> {
  if (!functionsUrl) {
    throw new ExtractionError(
      'nicht_eingerichtet',
      'Die Verbindung zu Supabase ist nicht eingerichtet. In der .env fehlt VITE_SUPABASE_URL.',
    )
  }

  /*
   * Das Token der laufenden Sitzung. Ohne gültiges Token weist die Funktion die
   * Anfrage ab — hier wird das nur vorweggenommen, damit der Nutzer nicht erst
   * ein Bild hochlädt, um dann ein „nicht angemeldet" zu bekommen.
   */
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new ExtractionError(
      'nicht_angemeldet',
      'Du bist nicht mehr angemeldet. Bitte melde dich neu an und scanne noch einmal.',
    )
  }

  onPhase?.('vorbereiten')
  const image = await toBase64(capture.blob)

  /* ------------------------------------------------- Durchgang 1: lesen */

  onPhase?.('lesen')
  const structure = (await call(
    token,
    { image, mimeType: capture.blob.type || 'image/jpeg' },
    TIMEOUT_MS,
  )) as StructureResponse | null

  if (!structure || !structure.extraction || !Array.isArray(structure.extraction.items)) {
    throw new ExtractionError('modell_json', 'Die Antwort der Erkennung war unbrauchbar.')
  }

  const open = Array.isArray(structure.offeneRohtexte) ? structure.offeneRohtexte : []

  /* --------------------------------------------- Durchgang 2: zuordnen */

  if (open.length === 0) {
    // Der Haushalt kennt jeden Artikel — der zweite Aufruf entfällt vollständig.
    // Genau darauf läuft die Lernschleife hinaus.
    onPhase?.('auswerten')
    return {
      extraction: structure.extraction,
      model: structure.model,
      durationMs: structure.durationMs,
      raw: structure.raw,
      assignment: null,
    }
  }

  onPhase?.('zuordnen')
  let assignment: AssignmentResponse | null = null
  try {
    assignment = (await call(
      token,
      { rohtexte: open },
      ASSIGNMENT_TIMEOUT_MS,
    )) as AssignmentResponse | null
  } catch {
    /*
     * Bewusst geschluckt. Der Bon ist an dieser Stelle vollständig gelesen; ihn
     * wegen einer ausgefallenen Namensgebung zu verwerfen, wäre der teuerste
     * mögliche Umgang mit dem Fehler.
     */
    assignment = null
  }

  onPhase?.('auswerten')

  if (!assignment || !Array.isArray(assignment.assignments)) {
    return {
      extraction: withAssignmentFailure(structure.extraction),
      model: structure.model,
      durationMs: structure.durationMs,
      raw: structure.raw,
      assignment: null,
    }
  }

  const warnings = Array.isArray(assignment.warnings) ? assignment.warnings : []
  const assigned = applyAssignments(structure.extraction, assignment.assignments)

  return {
    extraction: { ...assigned, warnings: [...assigned.warnings, ...warnings] },
    model: structure.model,
    durationMs: structure.durationMs,
    raw: structure.raw,
    assignment: {
      model: assignment.model,
      durationMs: assignment.durationMs,
      raw: assignment.raw,
    },
  }
}
