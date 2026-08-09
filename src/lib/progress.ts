import type { ExtractionPhase } from './extraction'

/**
 * Der geschätzte Fortschritt eines Scans — und warum er schätzen darf, ohne zu
 * lügen.
 *
 * Wie weit Mistral mit einem Bon ist, sagt uns niemand: Die Schnittstelle
 * antwortet einmal, fertig; einen Zwischenstand gibt es nicht. Der Balken auf
 * dem Verarbeitungs-Screen ist deshalb eine **Schätzung**. Damit er trotzdem
 * ehrlich bleibt, gelten drei Regeln, und die stehen hier im Code statt in einer
 * Absichtserklärung:
 *
 *   1. **Nie rückwärts.** `advanceProgress` gibt nie weniger zurück als den
 *      bisherigen Stand.
 *   2. **Halt bei WAIT_CEILING, solange die Antwort aussteht.** Innerhalb eines
 *      Abschnitts läuft der Wert gleichmäßig bis ans obere Ende seines Bereichs
 *      und bleibt dort stehen, statt eine Bewegung zu erfinden, die nichts
 *      bedeutet.
 *   3. **100 % erreicht diese Datei nie.** `estimateProgress` kommt höchstens
 *      auf CHECK_CEILING. Die volle Anzeige setzt allein der Screen, und zwar
 *      erst, wenn das Ergebnis wirklich da ist. Ein Balken, der bei 100 % steht
 *      und trotzdem weiterlädt, wäre schlimmer als gar keiner.
 *
 * Bewusst frei von React und von jedem Laufzeit-Import: Es sind reine
 * Funktionen über Zahlen, und die Tests nebenan laufen direkt auf `node --test`.
 */

/* ------------------------------------------------------- Die Stellschrauben */

/**
 * Wie lange ein Abschnitt typischerweise dauert.
 *
 * **Das ist die Stellschraube.** Sobald sich zeigt, wie lange ein Scan im Alltag
 * wirklich dauert, werden hier die Zahlen angepasst und sonst nichts.
 *
 * `lesen` umfasst alles zwischen Absenden und Antwort des ersten Durchgangs:
 * Hochladen über Mobilfunk, den Modell-Aufruf mit Bild und die Prüfung auf dem
 * Server. Das ist mit Abstand das Längste.
 *
 * `zuordnen` ist der zweite Aufruf — ohne Bild und mit einem Textmodell, also
 * ein Bruchteil davon. Er entfällt ganz, wenn der Haushalt jeden Artikel des
 * Bons schon kennt.
 */
export const EXPECTED_MS: Record<ExtractionPhase, number> = {
  vorbereiten: 800,
  lesen: 14_000,
  zuordnen: 3_000,
  auswerten: 700,
}

/**
 * Hier wartet der Balken, solange die Antwort aussteht.
 *
 * Bewusst nicht 100: Die letzten Prozent gehören einem Ergebnis, das wirklich
 * eingetroffen ist.
 */
export const WAIT_CEILING = 95

/** Und hier, während die eingetroffene Antwort ausgepackt und geprüft wird. */
export const CHECK_CEILING = 99

/** Der volle Stand. Wird ausschließlich vom Screen gesetzt, nie hier berechnet. */
export const COMPLETE = 100

/** Wie oft der Screen nachrechnet. Fein genug, dass die Bewegung flüssig wirkt. */
export const TICK_MS = 100

/**
 * Wie lange die volle Anzeige stehen bleibt, bevor es weitergeht.
 *
 * Ohne diese kurze Pause wäre die 100 nie zu sehen — der Screen verschwände im
 * selben Augenblick, in dem sie erscheint.
 *
 * Mit Schritt 4d von 250 auf 450 ms erhöht: Seitdem bekommt auch der letzte
 * Abschnitt sein Häkchen, und zwar genau in diesem Moment. Bei 250 ms war das
 * ein Blinzeln.
 */
export const FINISH_MS = 450

/**
 * Die vier Abschnitte mit ihrem Prozentbereich und dem Text dazu.
 *
 * Die Bereiche sind nach der typischen Dauer gewichtet — 0,8 s : 14 s : 3 s :
 * 0,7 s entspricht rund 4 % : 76 % : 16 % : 4 %. Deshalb steht der Balken die
 * meiste Zeit im zweiten Abschnitt, und genau dort wird auch am längsten
 * gewartet.
 *
 * Beschriftung und Bereich stehen absichtlich in derselben Zeile: Zwei getrennte
 * Listen über denselben vier Abschnitten wären zwei Stellen, die auseinander-
 * laufen können.
 *
 * **In den Beschriftungen steht kein Anbietername.** „Mistral liest den Bon"
 * stand hier bis Schritt 4d und war gleich doppelt schlecht: Mit dem Namen kann
 * niemand etwas anfangen, und bei einem Anbieterwechsel stünde dort dauerhaft
 * etwas Falsches. Beschrieben wird, was passiert — nicht, wer es tut.
 *
 * `zuordnen` wird übersprungen, wenn der Haushalt jeden Artikel schon kennt.
 * Dann springt der Balken von 80 auf 95 — der eine erlaubte Sprung, weil er
 * eine Abkürzung anzeigt, die wirklich stattgefunden hat.
 */
export const PROGRESS_STEPS: ReadonlyArray<{
  phase: ExtractionPhase
  label: string
  from: number
  to: number
}> = [
  { phase: 'vorbereiten', label: 'Bild wird vorbereitet', from: 0, to: 5 },
  { phase: 'lesen', label: 'Bon wird gelesen', from: 5, to: 80 },
  { phase: 'zuordnen', label: 'Positionen werden zugeordnet', from: 80, to: WAIT_CEILING },
  { phase: 'auswerten', label: 'Ergebnis wird geprüft', from: WAIT_CEILING, to: CHECK_CEILING },
]

/* ------------------------------------------------------------- Die Rechnung */

/**
 * Der geschätzte Stand innerhalb eines Abschnitts, in Prozent.
 *
 * Gleichmäßig von `from` nach `to` über die erwartete Dauer, danach Halt am
 * oberen Ende. Dieses Stehenbleiben ist der ehrliche Teil: Dauert es länger als
 * geschätzt, wird eben nicht weitergezählt.
 */
export function estimateProgress(
  phase: ExtractionPhase,
  elapsedMs: number,
  /**
   * Die erwarteten Dauern — voreingestellt die geschätzten von oben.
   *
   * Seit Schritt 14 reicht der Verarbeitungs-Screen hier die **gemessenen**
   * hinein (`src/lib/timing.ts`): Jeder Scan meldet, wie lange er wirklich
   * gebraucht hat. Ein Parameter statt eines Zugriffs auf `localStorage` mitten
   * in der Rechnung — sonst wäre diese Datei nicht mehr rein und die Tests
   * daneben bräuchten einen Browser.
   */
  expected: Record<ExtractionPhase, number> = EXPECTED_MS,
): number {
  const step = PROGRESS_STEPS.find((entry) => entry.phase === phase)
  if (!step) return 0

  const share = Math.min(1, Math.max(0, elapsedMs) / Math.max(1, expected[phase]))
  return step.from + (step.to - step.from) * share
}

/**
 * Der neue Stand, ausgehend vom bisherigen.
 *
 * Hier und nur hier steckt die Zusicherung, dass der Balken nie rückwärts läuft.
 * Beim Wechsel in den nächsten Abschnitt liegt dessen Anfang über dem alten
 * Stand — das ergibt den erlaubten Sprung nach vorn. Trifft dagegen ein
 * verspäteter Takt aus dem vorigen Abschnitt ein, bleibt der höhere Stand
 * stehen.
 */
export function advanceProgress(
  current: number,
  phase: ExtractionPhase,
  elapsedMs: number,
  expected: Record<ExtractionPhase, number> = EXPECTED_MS,
): number {
  return Math.max(current, estimateProgress(phase, elapsedMs, expected))
}
