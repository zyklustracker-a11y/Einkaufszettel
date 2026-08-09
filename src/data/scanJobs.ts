import { supabase } from '../lib/supabase'
import { unwrap, unwrapMaybe } from './client'
import type { StructureResponse } from '../lib/extraction'

/**
 * Der Scan-Job — der Rettungsweg für ein Ergebnis, das nirgends ankommt.
 *
 * Wechselt der Nutzer während des Scans in eine andere App, friert Safari die
 * Seite ein. Die Edge Function rechnet auf dem Server weiter, aber ihre Antwort
 * hat beim Zurückkommen niemanden mehr, dem sie zugestellt werden könnte
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3). Deshalb legt die App vor dem Scan
 * einen Job an, und die Funktion schreibt ihr Ergebnis **zusätzlich** dorthin.
 *
 * **Alles hier darf scheitern, ohne dass ein Scan scheitert.** Ein Rettungsweg,
 * der den Normalfall blockiert, wäre ein schlechter Tausch: Ohne Job läuft die
 * Erkennung genau wie vorher, sie überlebt nur keinen App-Wechsel. Deshalb geben
 * diese Funktionen `null` zurück, statt zu werfen — mit einer Ausnahme, die
 * unten steht.
 *
 * **Das Bon-Foto liegt nicht im Job**, nur das Erkannte. Es geht wie bisher
 * durch die Funktion und wird danach verworfen (PROJEKT.md).
 */

/** Was in `scan_jobs` steht, in der Form, mit der die App arbeitet. */
export interface ScanJob {
  id: string
  status: 'running' | 'done' | 'failed'
  /** Das Ergebnis von Durchgang 1. Nur bei `done` gesetzt. */
  result: StructureResponse | null
  errorCode: string | null
  /** Bereits auf Deutsch und direkt anzeigbar. */
  errorMessage: string | null
  createdAt: string
}

interface JobRow {
  id: string
  status: string
  result: unknown
  error_code: string | null
  error_message: string | null
  created_at: string
}

const JOB_COLUMNS = 'id, status, result, error_code, error_message, created_at'

/**
 * Sieht die Zeile aus wie ein Ergebnis von Durchgang 1?
 *
 * Geprüft wird, nicht vertraut: In `result` steht, was eine ältere Fassung der
 * Edge Function dort abgelegt hat, und ein Ergebnis ohne `items` würde den
 * Korrektur-Screen sonst mit einer leeren Liste öffnen, statt zu sagen, dass
 * nichts da ist.
 */
function toStructure(value: unknown): StructureResponse | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Partial<StructureResponse>
  if (!candidate.extraction || !Array.isArray(candidate.extraction.items)) return null
  return candidate as StructureResponse
}

function toJob(row: JobRow): ScanJob {
  const status = row.status === 'done' || row.status === 'failed' ? row.status : 'running'
  return {
    id: row.id,
    status,
    result: status === 'done' ? toStructure(row.result) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }
}

/**
 * Legt einen Job an und räumt dabei die alten weg.
 *
 * Beides macht `start_scan_job()` in der Datenbank in einem Aufruf — ein
 * zusätzlicher Weg über die Leitung, bevor das Bild losgeht, wäre teurer als
 * der Nutzen.
 *
 * Gibt `null` zurück, wenn es nicht klappt (fehlende Migration, kein Netz). Der
 * Scan läuft dann ohne Rettungsweg weiter, so wie vor Schritt 6.
 */
export async function startScanJob(): Promise<string | null> {
  const { data, error } = await supabase.rpc('start_scan_job')
  if (error || typeof data !== 'string' || data === '') return null
  return data
}

/** Der Stand eines bestimmten Jobs. `null`, wenn es ihn nicht (mehr) gibt. */
export async function getScanJob(jobId: string): Promise<ScanJob | null> {
  try {
    const row = unwrapMaybe(
      await supabase.from('scan_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle(),
    ) as JobRow | null
    return row ? toJob(row) : null
  } catch {
    return null
  }
}

/**
 * Der jüngste noch nicht abgeholte Job **dieses Nutzers**, oder `null`.
 *
 * Die Sicht filtert bereits auf `auth.uid()` und die letzten 24 Stunden. Sie
 * liefert auch `running`-Jobs: Ein Scan, der beim Einfrieren der Seite unterwegs
 * war, steht noch so da, und ob inzwischen ein Ergebnis eingetroffen ist, sieht
 * man erst beim Nachfragen.
 */
export async function findOpenScanJob(): Promise<ScanJob | null> {
  try {
    const rows = unwrap<JobRow[]>(await supabase.from('v_open_scan_job').select(JOB_COLUMNS))
    const row = rows[0]
    return row ? toJob(row) : null
  } catch {
    // Fehlt die Migration, gibt es auch nichts abzuholen. Der Hinweis auf dem
    // Dashboard bleibt dann einfach aus, statt eine Fehlerkarte zu zeigen.
    return null
  }
}

/**
 * Der Job ist erledigt — er soll sich nicht noch einmal melden.
 *
 * Gelöscht wird er nicht: Er verschwindet ohnehin nach 24 Stunden, und bis dahin
 * lässt sich im SQL-Editor nachsehen, dass ein Scan durchgelaufen ist.
 */
export async function consumeScanJob(jobId: string): Promise<void> {
  await supabase
    .from('scan_jobs')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', jobId)
    .is('consumed_at', null)
}
