import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Der schmale Rand um jede Supabase-Abfrage.
 *
 * Zwei Aufgaben: das `{ data, error }`-Paar auspacken und aus einer technischen
 * Meldung einen Satz machen, den man lesen kann. Rohe Postgres-Meldungen
 * erscheinen nie in der Oberfläche — sie helfen niemandem weiter.
 */

const MISSING_VIEW =
  'Die Auswertungs-Sichten fehlen in der Datenbank. Bitte supabase/migrations/0002_views.sql ' +
  'einmal im SQL-Editor ausführen.'

const NO_CONNECTION =
  'Keine Verbindung zur Datenbank. Prüfe deine Internetverbindung und versuch es noch einmal.'

const NO_PERMISSION =
  'Für diese Daten fehlt die Berechtigung. Bist du noch angemeldet?'

const GENERIC = 'Die Daten konnten nicht geladen werden. Bitte versuch es noch einmal.'

/** Technische Meldung → deutscher Satz. Unbekanntes bekommt den allgemeinen. */
export function germanDataError(error: unknown): string {
  if (error instanceof DataError) return error.message

  const source = (error ?? {}) as Partial<PostgrestError> & { message?: string }
  const code = typeof source.code === 'string' ? source.code : ''
  const text = `${source.message ?? ''}`.toLowerCase()

  // 42P01 = Relation existiert nicht. Der mit Abstand wahrscheinlichste Fehler,
  // solange die zweite Migration noch nicht ausgeführt wurde.
  if (code === '42P01' || text.includes('does not exist')) return MISSING_VIEW
  if (code === '42501' || text.includes('permission denied') || text.includes('jwt')) {
    return NO_PERMISSION
  }
  if (text.includes('fetch') || text.includes('network') || text.includes('timeout')) {
    return NO_CONNECTION
  }
  return GENERIC
}

/** Ein Fehler, dessen Text schon auf Deutsch und direkt anzeigbar ist. */
export class DataError extends Error {}

/**
 * Packt eine Supabase-Antwort aus. `data` darf dabei nicht null sein — eine
 * leere Liste kommt als `[]` zurück, nicht als null.
 */
export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw new DataError(germanDataError(result.error))
  if (result.data === null) throw new DataError(GENERIC)
  return result.data
}

/** Wie `unwrap`, lässt aber „nichts gefunden" als null durch. */
export function unwrapMaybe<T>(result: { data: T | null; error: PostgrestError | null }): T | null {
  if (result.error) throw new DataError(germanDataError(result.error))
  return result.data
}
