/**
 * Das Protokoll für die Fehlersuche an der Erkennung.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES DIESE DATEI GIBT
 * ---------------------------------------------------------------------------
 *
 * Ein Scan, der mit „Die Antwort der Erkennung war unbrauchbar" endet, ist von
 * außen nicht zu unterscheiden von einem, bei dem das Modell Unsinn geschrieben
 * hat. Beide sehen gleich aus: kein JSON, kein Ergebnis. Der Unterschied steht
 * in Angaben, die bis Schritt 18 **weggeworfen** wurden — `finish_reason` und
 * `usage` aus der Antwort von Mistral:
 *
 *   * `finish_reason: "length"` heißt, die Antwort wurde mitten im Satz
 *     abgeschnitten, weil `max_tokens` erreicht war. Dann ist das JSON nicht
 *     kaputt, sondern unfertig — und der Bon war zu lang, nicht unlesbar.
 *   * `finish_reason: "stop"` bei kaputtem JSON heißt das Gegenteil: Das Modell
 *     war fertig und hat trotzdem etwas geschrieben, das sich nicht lesen lässt.
 *
 * Ohne diese Unterscheidung ist jede Vermutung über die Ursache genau das: eine
 * Vermutung. Deshalb wird beides jetzt ausgewertet, und deshalb steht es im
 * Protokoll.
 *
 * ---------------------------------------------------------------------------
 * WARUM HINTER EINEM SCHALTER
 * ---------------------------------------------------------------------------
 *
 * Die ausführliche Form protokolliert einen Ausschnitt der Modellantwort — also
 * den Inhalt eines fremden Kassenzettels. Das gehört nicht in ein Protokoll, das
 * dauerhaft mitläuft. Es ist ein Werkzeug für den Fall, dass jemand eine
 * konkrete Frage an einen konkreten Scan hat.
 *
 * Anschalten in Supabase:
 *
 *     supabase secrets set ERKENNEN_DEBUG=1
 *
 * Ausschalten:
 *
 *     supabase secrets unset ERKENNEN_DEBUG
 *
 * Danach steht bei jedem Scan eine Zeile in den Funktionsprotokollen
 * (Supabase → Edge Functions → erkennen → Logs).
 *
 * **Die knappe Form läuft immer.** Sie enthält nur Zahlen und Kennungen, keinen
 * Bon-Inhalt: Abbruchgrund, Token-Verbrauch, Länge der Antwort. Genau das, was
 * man braucht, um einen gemeldeten Fehlschlag einzuordnen — und nichts, was man
 * hinterher lieber nicht protokolliert hätte.
 *
 * Eine Ausnahme, und nur eine: Scheitert das Lesen des JSON, kommt das Ende der
 * Antwort auch ohne Schalter mit ins Protokoll. Das sind dieselben Zeichen, die
 * die App dem Nutzer ohnehin unter „Rohantwort des Modells" zeigt — und ohne sie
 * wäre der eine Fall, für den diese Datei gebaut wurde, wieder blind.
 */

/**
 * Steht das Secret `ERKENNEN_DEBUG` auf einem Ja-Wert?
 *
 * Bei jedem Aufruf frisch gelesen und nicht einmal beim Start: Eine Edge
 * Function lebt zwischen zwei Anfragen weiter, und ein Schalter, der erst beim
 * nächsten Kaltstart wirkt, ist beim Suchen wertlos.
 */
export function isDebugEnabled(): boolean {
  const value = (Deno.env.get('ERKENNEN_DEBUG') ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'ja' || value === 'on'
}

/** Was von der Modellantwort für die Fehlersuche zählt. */
export interface ResponseDiagnostics {
  /**
   * Der Abbruchgrund der Schnittstelle — bei Mistral `finish_reason`.
   *
   * `stop` = fertig. `length` = an `max_tokens` abgeschnitten. `model_length` =
   * am Kontextfenster abgeschnitten. Null: Die Antwort nannte keinen.
   */
  finishReason: string | null
  /** Verbrauchte Eingabe-Token (Prompt plus Bild). Null, wenn nicht gemeldet. */
  inputTokens: number | null
  /** Verbrauchte Ausgabe-Token. Null, wenn nicht gemeldet. */
  outputTokens: number | null
  /** Länge des Rohtexts in Zeichen. */
  textLength: number
  /**
   * Lief der Aufruf mit Mistrals JSON-Modus?
   *
   * Entscheidend für die Deutung eines kaputten JSON: Mit eingeschaltetem Modus
   * ist syntaktisch falsches JSON bei *abgeschlossener* Generierung kaum
   * möglich — dann war die Antwort fast sicher abgeschnitten. Ohne den Modus
   * (der 400-Rückfall in `callMistral` schaltet ihn ab) sind beide Ursachen
   * offen. Ohne diese Angabe im Protokoll wäre nicht zu sagen, welcher der
   * beiden Fälle vorlag.
   */
  jsonMode: boolean
}

/**
 * Die letzten Zeichen einer Antwort.
 *
 * Genau hier sieht man den Unterschied, um den es geht: Eine abgeschnittene
 * Antwort endet mitten in einem Wort oder einer Zeichenkette, eine fertige auf
 * `}`. Der Anfang der Antwort sagt darüber nichts — deshalb das Ende und nicht
 * der Anfang.
 */
export function tail(text: string, chars = 200): string {
  return text.length <= chars ? text : `…${text.slice(-chars)}`
}

/**
 * Eine Protokollzeile zu einem Modellaufruf.
 *
 * `stufe` sagt, welcher Durchgang gemeint ist („struktur" oder „zuordnung") —
 * ohne diese Angabe stünden zwei verschiedene Aufrufe ununterscheidbar
 * untereinander.
 *
 * Die Zeile ist bewusst **eine** Zeile und JSON: Die Protokollansicht von
 * Supabase bricht mehrzeilige Ausgaben in getrennte Einträge auf, und die
 * gehören dann nicht mehr sichtbar zusammen.
 */
export function logModelResponse(
  stufe: string,
  model: string,
  durationMs: number,
  diagnostics: ResponseDiagnostics,
  /** Der Rohtext. Wird nur bei eingeschaltetem Schalter angefasst. */
  text: string,
): void {
  const base = {
    stufe,
    model,
    durationMs,
    finishReason: diagnostics.finishReason,
    inputTokens: diagnostics.inputTokens,
    outputTokens: diagnostics.outputTokens,
    textLength: diagnostics.textLength,
    jsonMode: diagnostics.jsonMode,
    /*
     * Der eine abgeleitete Wert, der hier statt beim Lesen steht: Wer das
     * Protokoll durchsieht, soll nicht erst wissen müssen, welche Werte von
     * `finish_reason` ein Abschneiden bedeuten.
     */
    truncated: isTruncated(diagnostics.finishReason),
  }

  if (!isDebugEnabled()) {
    console.log('erkennen:', JSON.stringify(base))
    return
  }

  console.log('erkennen:', JSON.stringify({ ...base, tail: tail(text) }))
}

/**
 * Wurde die Antwort abgeschnitten?
 *
 * Mistral meldet `length`, wenn `max_tokens` erreicht war, und `model_length`,
 * wenn das Kontextfenster voll war. Beides bedeutet dasselbe für uns: Was da
 * ankam, ist ein Anfang und kein Ganzes.
 */
export function isTruncated(finishReason: string | null): boolean {
  return finishReason === 'length' || finishReason === 'model_length'
}
