/**
 * Die sechs benannten Gewichtsstufen.
 *
 * ---------------------------------------------------------------------------
 * WARUM NAMEN UND KEINE ZAHL
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 16 war das Gewicht eine Zahl von −10 bis +10. Die Spanne war zu
 * breit: Niemand kann begründen, warum ein Merkmal −7 statt −6 sein sollte, und
 * die vierzehn mitgelieferten Merkmale benutzten ohnehin nur −3 bis +2. Zwanzig
 * Stufen anzubieten, von denen sechs gebraucht werden, ist keine Freiheit,
 * sondern eine Frage ohne Antwort.
 *
 * Gespeichert wird weiterhin die **Zahl** — sie ist das, womit `score.ts`
 * rechnet, und die Stufen sind nur ihr Name. Eine Umrechnung gibt es nicht: Die
 * sechs Werte sind genau die, die vorher schon in der Datenbank standen, jede
 * bestehende Voreinstellung passt ohne Anfassen hinein.
 *
 * ---------------------------------------------------------------------------
 * DIE REIHENFOLGE
 * ---------------------------------------------------------------------------
 *
 * Von gut nach schlecht, links nach rechts — so wie die Farben laufen. Die
 * Alternative (von der Zahl her aufsteigend, also `Stark ungünstig` zuerst)
 * hätte die Chip-Reihe rot beginnen lassen, und das liest sich als Warnung, wo
 * nur eine Auswahl steht.
 *
 * `tone` ist der Farbschritt und heißt bewusst nicht wie der Wert: Die CSS-Klasse
 * soll sich nicht ändern, wenn der Wert einer Stufe je nachjustiert wird.
 */
export interface WeightLevel {
  /** Was in der Datenbank landet. */
  weight: number
  label: string
  /** Farbstufe von grün nach rot — der Suffix der CSS-Klasse. */
  tone: 'vgood' | 'good' | 'neutral' | 'slight' | 'bad' | 'vbad'
}

export const WEIGHT_LEVELS: readonly WeightLevel[] = [
  { weight: 2, label: 'Sehr gut', tone: 'vgood' },
  { weight: 1, label: 'Gut', tone: 'good' },
  { weight: 0, label: 'Neutral', tone: 'neutral' },
  { weight: -1, label: 'Leicht ungünstig', tone: 'slight' },
  { weight: -2, label: 'Ungünstig', tone: 'bad' },
  { weight: -3, label: 'Stark ungünstig', tone: 'vbad' },
]

/** Die Grenzen, die auch `traits_weight_check` in der Datenbank zieht. */
export const MAX_WEIGHT = 2
export const MIN_WEIGHT = -3

/** Womit ein neu angelegtes Merkmal startet: die häufigste Stufe der Voreinstellungen. */
export const DEFAULT_WEIGHT = -2

/**
 * Die Stufe zu einem gespeicherten Wert.
 *
 * Werte außerhalb der sechs kann es nur aus der Zeit vor Schritt 16 geben —
 * `0013_gewichtsstufen.sql` zieht sie in der Datenbank gerade, aber ein
 * Zwischenlager, das noch vor der Migration geladen wurde, kann sie kurz halten.
 * Deshalb wird hier **auf die nächstgelegene Stufe gerundet** statt zu raten oder
 * zu werfen: Ein altes −7 ist „Stark ungünstig", und das stimmt auch.
 */
export function weightLevel(weight: number): WeightLevel {
  if (!Number.isFinite(weight)) return levelByWeight(0)
  return levelByWeight(Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(weight))))
}

function levelByWeight(weight: number): WeightLevel {
  const found = WEIGHT_LEVELS.find((level) => level.weight === weight)
  // Kann nicht eintreten, solange die sechs Stufen lückenlos von −3 bis +2
  // laufen — der Rückfall steht nur, damit der Rückgabetyp ohne `!` auskommt.
  return found ?? WEIGHT_LEVELS[2]
}

/** Der Name der Stufe, für Listen und Vorlesetexte. */
export function weightLabel(weight: number): string {
  return weightLevel(weight).label
}

/** Auf eine gültige Stufe begrenzen, bevor geschrieben wird. */
export function clampWeight(weight: number): number {
  return weightLevel(weight).weight
}
