import type { CapturedImage } from './camera.ts'

/**
 * Übergabe des aufgenommenen Bons vom Kamera- an den Verarbeitungs-Screen.
 *
 * Ein Foto ist ein `Blob` und passt damit weder in die Adresse noch in den
 * Verlaufszustand des Routers – beides muss serialisierbar sein. Es liegt
 * deshalb hier, in einer einzelnen Variablen im Speicher.
 *
 * Bewusst **kein** React-Context: Ein Context, den nur zwei benachbarte Screens
 * lesen, müsste trotzdem um die ganze App gelegt werden. Und bewusst kein
 * `localStorage`: das Bild soll ein Neuladen der Seite gar nicht überleben,
 * sonst hinge nach Tagen noch ein alter Bon im Speicher.
 *
 * Ab Schritt 4b tritt hier der Upload an die Edge Function an die Stelle des
 * bloßen Weiterreichens.
 */
let pending: CapturedImage | null = null

export function setPendingCapture(image: CapturedImage): void {
  pending = image
}

/** Liest, ohne zu löschen – der Verarbeitungs-Screen darf neu rendern. */
export function getPendingCapture(): CapturedImage | null {
  return pending
}

export function clearPendingCapture(): void {
  pending = null
}
