import { functionsUrl, supabase, supabaseAnonKey } from '../lib/supabase'
import type { CapturedImage } from '../lib/camera'
import type { ExtractionResponse } from '../lib/extraction'

/**
 * Der Aufruf der Bon-Erkennung.
 *
 * Die einzige Stelle in der App, die mit der Edge Function spricht. Sie schickt
 * das Foto hin und bekommt geprüfte Bon-Daten zurück — der Mistral-Schlüssel
 * bleibt dabei auf dem Server (PROJEKT.md).
 *
 * Jeder Fehler verlässt diese Datei als `ExtractionError` mit einem fertigen
 * deutschen Satz. Weder ein HTTP-Status noch eine Rohmeldung erreicht je die
 * Oberfläche.
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

/**
 * Die drei Abschnitte eines Scans, an denen der Verarbeitungs-Screen ablesen
 * kann, wie weit es ist.
 *
 * Bewusst nur drei, und bewusst genau diese: Es sind die einzigen Zeitpunkte,
 * die sich hier wirklich beobachten lassen. Ein Fortschritt, der nur nach
 * Stoppuhr weiterläuft, wäre eine Behauptung — und der Screen soll nichts
 * andeuten, was nicht passiert.
 */
export type ExtractionPhase = 'vorbereiten' | 'senden' | 'auswerten'

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

  onPhase?.('senden')
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
      body: JSON.stringify({ image, mimeType: capture.blob.type || 'image/jpeg' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

  onPhase?.('auswerten')

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorBody | null
    const message = typeof body?.message === 'string' ? body.message : null
    const code = typeof body?.code === 'string' ? body.code : `http_${response.status}`
    const raw = typeof body?.raw === 'string' ? body.raw : null
    throw new ExtractionError(code, message ?? FALLBACK[response.status] ?? GENERIC, raw)
  }

  const result = (await response.json().catch(() => null)) as ExtractionResponse | null
  if (!result || !result.extraction || !Array.isArray(result.extraction.items)) {
    throw new ExtractionError('modell_json', 'Die Antwort der Erkennung war unbrauchbar.')
  }

  return result
}
