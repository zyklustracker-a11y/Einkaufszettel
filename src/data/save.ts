import { supabase } from '../lib/supabase'
import { DataError, GENERIC_DATA_ERROR, germanDataError } from './client'
import { refreshMerchants } from './reference'
import type { SavePayload } from '../lib/draft'

/**
 * Schreiben — die einzige Stelle, an der die App einen Bon anlegt oder löscht.
 *
 * **Ein Bon wird ganz oder gar nicht gespeichert.** Über den Browser ginge das
 * nicht sauber: Händler, Bon, Positionen, kanonische Produkte, deren Merkmale
 * und die gelernten Zuordnungen wären sechs bis zehn einzelne Anfragen, und
 * bräche eine davon ab (Funkloch im Supermarkt), bliebe ein halber Bon in der
 * Datenbank zurück. Deshalb macht das eine Datenbankfunktion,
 * `save_receipt` aus `supabase/migrations/0003_speichern.sql`: Ihr Rumpf ist
 * eine einzige Transaktion.
 *
 * Die Funktion läuft mit den Rechten des angemeldeten Nutzers, nicht mit einem
 * Dienstschlüssel — in einen fremden Haushalt kann sie damit gar nicht
 * schreiben.
 */

const MISSING_FUNCTION =
  'Die Speicher-Funktion fehlt in der Datenbank. Bitte supabase/migrations/0003_speichern.sql ' +
  'einmal im SQL-Editor ausführen – und wenn du das gerade getan hast, eine halbe Minute warten ' +
  'und noch einmal versuchen.'

const SAVE_FAILED =
  'Der Bon konnte nicht gespeichert werden. Es wurde nichts angelegt – bitte noch einmal ' +
  'versuchen.'

const DELETE_FAILED = 'Der Einkauf konnte nicht gelöscht werden. Bitte noch einmal versuchen.'

/** Fehlt die Funktion selbst, hilft nur die Migration — und das soll dastehen. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = `${error.message ?? ''}`.toLowerCase()
  // PGRST202: PostgREST findet die Funktion nicht. 42883: Postgres kennt sie nicht.
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    message.includes('save_receipt') ||
    message.includes('function public.save_receipt')
  )
}

/**
 * Speichert den geprüften Bon und gibt seine id zurück.
 *
 * Danach wird die Händlerliste im Zwischenlager aufgefrischt: Beim Speichern
 * kann ein neuer Händler entstanden sein, und das Einkaufs-Detail direkt danach
 * schlägt seinen Namen dort nach.
 */
export async function saveReceipt(payload: SavePayload): Promise<string> {
  const { data, error } = await supabase.rpc('save_receipt', { p_payload: payload })

  if (error) {
    if (isMissingFunction(error)) throw new DataError(MISSING_FUNCTION)
    // Ein Rechte- oder Verbindungsfehler hat einen genaueren Satz verdient; für
    // alles Übrige ist „nichts wurde angelegt" die wichtigere Auskunft.
    const reason = germanDataError(error)
    throw new DataError(reason === GENERIC_DATA_ERROR ? SAVE_FAILED : reason)
  }

  if (typeof data !== 'string' || data.length === 0) {
    throw new DataError(SAVE_FAILED)
  }

  await refreshMerchants()
  return data
}

/**
 * Löscht einen Einkauf samt seinen Positionen.
 *
 * Ein einziges DELETE — die Positionen hängen per `on delete cascade` daran,
 * und ein einzelnes Statement ist von sich aus eine Transaktion.
 *
 * **Das Gelernte bleibt.** `product_mappings` und `canonical_products` zeigen
 * nicht auf den Bon, sondern stehen für sich. Gelöscht wird der Einkauf, nicht
 * das Wissen darüber, was „G&G H-MILCH 1,5%" bedeutet — sonst müsste man nach
 * jedem gelöschten Testbon von vorn anfangen.
 */
export async function deleteReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase.from('receipts').delete().eq('id', receiptId)
  if (error) throw new DataError(DELETE_FAILED)
}
