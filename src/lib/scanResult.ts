import type { ExtractionResponse } from './extraction'

/**
 * Übergabe des Erkennungs-Ergebnisses vom Verarbeitungs- an den
 * Korrektur-Screen.
 *
 * Dasselbe Muster wie bei `capture.ts` und aus demselben Grund: Ein
 * Zwischenergebnis, das noch nirgends gespeichert ist, muss trotzdem einen
 * Screen weiterreisen. Der Router transportiert nur serialisierbare Werte, und
 * `localStorage` ist hier falsch — ein Neuladen soll das Ergebnis nicht
 * überleben.
 *
 * **Warum das in Schritt 4b-1 überhaupt nötig ist:** Es wird ausdrücklich noch
 * nichts in die Datenbank geschrieben. Der Korrektur-Screen kann sein Ergebnis
 * also nicht abfragen, er bekommt es gereicht. Mit 4b-2 fällt dieser Umweg weg:
 * Dann entsteht beim Erkennen ein Bon mit Status `extracted`, und der Screen
 * lädt ihn wie jeder andere Screen aus der Datenbank.
 */
let pending: ExtractionResponse | null = null

export function setPendingExtraction(result: ExtractionResponse): void {
  pending = result
}

/** Liest, ohne zu löschen — der Korrektur-Screen darf neu rendern. */
export function getPendingExtraction(): ExtractionResponse | null {
  return pending
}

export function clearPendingExtraction(): void {
  pending = null
}
