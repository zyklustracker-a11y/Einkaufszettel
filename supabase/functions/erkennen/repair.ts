/**
 * JSON aus einer Modellantwort herausholen — auch aus einer abgeschnittenen.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES DAS BRAUCHT
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 18 stand in `validate.ts`: „Bewusst wird nur geschält, nicht
 * repariert: Fehlt eine Klammer, ist die Antwort kaputt und soll das auch
 * bleiben." Das war als Strenge gemeint und ist in der Praxis das Gegenteil
 * gewesen — es hat aus einem zu 95 % gelesenen Bon eine Fehlermeldung gemacht.
 *
 * Der Unterschied, um den es geht:
 *
 *     {"lesbar":true,"zeilen":["MILCH 1,29 B","BROT 2,4      <- hier ist Schluss
 *
 * Das ist kein kaputtes JSON. Das ist ein **unfertiges**. Die dreißig Zeilen
 * davor sind vollständig, richtig und teuer bezahlt. Sie wegzuwerfen, weil die
 * einunddreißigste mitten im Betrag endet, ist der schlechteste Umgang mit dem
 * Fehler, den es gibt. Und dass die eine angebrochene Zeile fehlt, sieht der
 * Nutzer im Korrektur-Screen sofort — der Summenabgleich zeigt genau darauf.
 *
 * ---------------------------------------------------------------------------
 * WIE REPARIERT WIRD
 * ---------------------------------------------------------------------------
 *
 * Nicht geraten und nichts erfunden. Der Text wird **einmal von vorn
 * durchgegangen**, wobei mitgeschrieben wird, welche Klammern offen sind und wo
 * zuletzt ein Wert *fertig* wurde. An dieser letzten sicheren Stelle wird
 * abgeschnitten, die offenen Klammern werden geschlossen, fertig.
 *
 * Was dabei entsteht, ist ein echtes Präfix der Modellantwort — jeder Wert
 * darin stand so da. Ergänzt werden ausschließlich `}` und `]`. Ein halber
 * Betrag wird nie zu einem ganzen ergänzt, eine angebrochene Zeile fällt
 * vollständig weg. Das ist die Regel aus PROJEKT.md: markieren statt ablehnen,
 * aber niemals raten.
 *
 * Der Scanner unterscheidet dabei **Schlüssel von Werten**. Ohne das wäre
 *
 *     {"haendler":"REWE","datum"
 *
 * nach dem Abschneiden `{"haendler":"REWE","datum"}` — ein Schlüssel ohne Wert,
 * also wieder ungültig. Deshalb merkt sich jeder Objekt-Rahmen, ob als Nächstes
 * ein Schlüssel, ein Doppelpunkt, ein Wert oder ein Komma dran ist.
 *
 * Reine Funktionen, keine Netz- und keine Datenbankzugriffe.
 */

/** Was beim Herausholen herauskam. */
export interface Recovery {
  /** Das geparste Objekt, oder null, wenn sich nichts retten ließ. */
  value: unknown | null
  /**
   * Musste geschlossen werden, damit es sich parsen ließ?
   *
   * Wichtig für die Oberfläche: Ein repariertes Ergebnis ist ein **Teil**-
   * ergebnis und muss als solches gekennzeichnet werden. Der Nutzer soll nicht
   * glauben, er habe einen vollständigen Bon vor sich.
   */
  repaired: boolean
  /** Wie viele Zeichen am Ende verworfen wurden. 0 bei heiler Antwort. */
  droppedChars: number
}

const FAILED: Recovery = { value: null, repaired: false, droppedChars: 0 }

/**
 * Markdown-Zäune entfernen.
 *
 * Trotz aller Anweisungen packen Modelle die Antwort gern in einen
 * ```json-Block. Bewusst nicht nur am Anfang und Ende gesucht: Kommt ein
 * einleitender Satz davor („Hier ist das Ergebnis:"), steht der Zaun mitten im
 * Text. Und der schließende Zaun fehlt bei einer abgeschnittenen Antwort ganz —
 * deshalb ist er optional.
 */
export function stripFences(raw: string): string {
  return raw
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .trim()
}

/* ------------------------------------------------------------- Der Scanner */

type Frame =
  /** Ein Objekt. `needs` sagt, was als Nächstes kommen muss. */
  | { kind: 'obj'; needs: 'key' | 'colon' | 'value' | 'comma' }
  /** Eine Liste. */
  | { kind: 'arr'; needs: 'value' | 'comma' }

interface ScanResult {
  /**
   * Der Index hinter dem vollständigen Wurzelwert — die Antwort war heil.
   * Null: Der Text hört vorher auf.
   */
  completeAt: number | null
  /**
   * Der Index hinter dem zuletzt fertig gewordenen Wert, zusammen mit den zu
   * diesem Zeitpunkt offenen Rahmen. Genau hier lässt sich sauber abschneiden.
   */
  safeAt: number | null
  safeStack: Array<Frame['kind']>
}

/** Zeichen, an denen ein Zahlen- oder Schlüsselwort-Literal endet. */
const LITERAL = /[-\d.eE+truefalsn]/

/**
 * Den Text einmal durchgehen und mitschreiben, wo sicher abgeschnitten werden
 * kann.
 *
 * Bewusst ein eigener Scanner statt „`JSON.parse` in einer Schleife mit immer
 * kürzerem Text": Das wäre quadratisch und bei einer 10.000-Zeichen-Antwort
 * spürbar. Hier ist es ein Durchgang.
 */
function scan(text: string): ScanResult {
  const stack: Frame[] = []
  let safeAt: number | null = null
  let safeStack: Array<Frame['kind']> = []
  let completeAt: number | null = null

  /** Ein Wert ist fertig — was das für den umgebenden Rahmen heißt. */
  const finishValue = (index: number) => {
    const frame = stack[stack.length - 1]
    if (!frame) {
      // Der Wurzelwert ist fertig. Alles danach ist Beiwerk.
      completeAt = index
      return
    }
    frame.needs = 'comma'

    /*
     * Hier steckt die eigentliche Entscheidung: WO darf geschnitten werden?
     *
     * Nicht überall, wo gerade ein Wert fertig wurde. Steht der offene Rahmen
     * direkt in einer Liste, ist er ein **angefangenes Listenelement** — etwa
     * die zweite Steuerklasse in
     *
     *     "steuerblock":[{"kennzeichen":"A","brutto_cent":159},{"kennzeichen":"B"
     *
     * Hier zu schneiden ergäbe zwar gültiges JSON, aber einen halben Eintrag:
     * eine Steuerklasse ohne Betrag. Ein halber Eintrag ist schlimmer als
     * keiner — er sieht aus wie ein Wert und ist keiner. Also fällt das
     * angefangene Element ganz weg, und geschnitten wird hinter dem letzten
     * vollständigen davor.
     *
     * Beim Bon selbst gilt das Gegenteil: Er ist das Wurzelobjekt und liegt in
     * keiner Liste. Ein Bon mit Händler und dreißig Zeilen, dem das Datum
     * fehlt, ist genau das Teilergebnis, um das es hier geht.
     */
    const parent = stack[stack.length - 2]
    if (frame.kind === 'obj' && parent?.kind === 'arr') return

    safeAt = index
    safeStack = stack.map((entry) => entry.kind)
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      i++
      continue
    }

    const frame = stack[stack.length - 1]

    if (char === '"') {
      const end = skipString(text, i)
      // Zeichenkette bricht ab: Sie ist unvollständig und zählt nicht.
      if (end === -1) break
      if (frame?.kind === 'obj' && frame.needs === 'key') {
        frame.needs = 'colon'
      } else {
        finishValue(end)
      }
      i = end
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(
        char === '{' ? { kind: 'obj', needs: 'key' } : { kind: 'arr', needs: 'value' },
      )
      i++
      continue
    }

    if (char === '}' || char === ']') {
      // Eine schließende Klammer ohne offenen Rahmen: Der Text ist nicht das,
      // wofür wir ihn halten. Abbrechen statt raten.
      if (stack.length === 0) break
      stack.pop()
      finishValue(i + 1)
      i++
      continue
    }

    if (char === ':') {
      if (frame?.kind === 'obj' && frame.needs === 'colon') frame.needs = 'value'
      i++
      continue
    }

    if (char === ',') {
      if (frame?.kind === 'obj') frame.needs = 'key'
      else if (frame?.kind === 'arr') frame.needs = 'value'
      i++
      continue
    }

    if (LITERAL.test(char)) {
      let end = i
      while (end < text.length && LITERAL.test(text[end])) end++
      /*
       * Ein Literal ganz am Textende ist verdächtig: „2,4" könnte „2,45" werden
       * wollen. Es zählt deshalb nur als fertig, wenn noch etwas dahinter steht
       * — dann hat das Modell den Wert nachweislich abgeschlossen.
       */
      if (end >= text.length) break
      finishValue(end)
      i = end
      continue
    }

    // Irgendetwas, das in JSON nichts zu suchen hat.
    break
  }

  return { completeAt, safeAt, safeStack }
}

/**
 * Das Ende einer Zeichenkette finden, Maskierungen berücksichtigt.
 *
 * `start` zeigt auf das öffnende Anführungszeichen. Zurück kommt der Index
 * **hinter** dem schließenden, oder -1, wenn der Text vorher aufhört.
 */
function skipString(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    const char = text[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '"') return i + 1
    i++
  }
  return -1
}

/* ------------------------------------------------------------ Das Ergebnis */

/**
 * JSON aus einer Modellantwort — heil oder repariert.
 *
 * Die Reihenfolge ist Absicht: Erst der heile Weg, und nur wenn der scheitert,
 * wird geschnitten. Eine vollständige Antwort wird also nie angefasst, und der
 * Normalfall kostet keine zusätzliche Arbeit.
 */
export function recoverJson(raw: string): Recovery {
  const text = stripFences(raw)
  const start = text.indexOf('{')
  if (start === -1) return FAILED

  const body = text.slice(start)
  const result = scan(body)

  // Der heile Weg: Der Wurzelwert ist vollständig.
  if (result.completeAt !== null) {
    const parsed = tryParse(body.slice(0, result.completeAt))
    if (parsed.ok) return { value: parsed.value, repaired: false, droppedChars: 0 }
  }

  // Der reparierte Weg: bis zur letzten sicheren Stelle, dann zumachen.
  if (result.safeAt === null) return FAILED

  const closers = result.safeStack
    .slice()
    .reverse()
    .map((kind) => (kind === 'obj' ? '}' : ']'))
    .join('')

  const parsed = tryParse(body.slice(0, result.safeAt) + closers)
  if (!parsed.ok) return FAILED

  return {
    value: parsed.value,
    repaired: true,
    droppedChars: body.length - result.safeAt,
  }
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}
