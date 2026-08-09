/**
 * Kategorien — Schlüssel und Farben.
 *
 * Zwei Dinge, die bis Schritt 5 gar nicht existierten, weil Kategorien fest
 * waren: Ein Schlüssel entsteht jetzt aus dem Namen, und eine Farbe muss
 * vergeben werden (KONZEPT-ERWEITERUNGEN.md, Abschnitt 2).
 *
 * Beides sind reine Funktionen über Text — sie gehören deshalb hierher und
 * nicht in einen Screen, dieselbe Trennung wie bei `score.ts`, `progress.ts`
 * und `draft.ts`. Keine Laufzeit-Importe: Die Tests nebenan laufen direkt mit
 * `node --test`, ohne Bauschritt.
 */

/* ================================================================ Schlüssel */

/**
 * Der stabile Schlüssel aus dem Anzeigenamen.
 *
 * **Diese Funktion muss zeichengleich dasselbe liefern wie `category_key()` in
 * `supabase/migrations/0004_erweiterungen.sql`.** Angelegt wird die Kategorie in
 * der Datenbank; hier wird nur *vorher gezeigt*, was dabei herauskommt — der
 * Nutzer soll nicht raten müssen, wie sein „Auswärts essen" später heißt. Liefen
 * die beiden auseinander, stünde in der Vorschau etwas anderes als in der
 * Datenbank.
 *
 * Umlaute werden ausgeschrieben (ä → ae) und nicht plattgemacht (ä → a): Der
 * Schlüssel steht im Erkennungs-Prompt und wird dort gelesen. „auswaerts_essen"
 * ist als Wort erkennbar, „auswarts_essen" sieht nach Tippfehler aus.
 */
export function toCategoryKey(name: string): string {
  return toStableKey(name)
}

/**
 * Dieselbe Regel, unter dem allgemeinen Namen.
 *
 * Seit Schritt 10 legt der Nutzer auch **Merkmale** selbst an, und deren
 * Schlüssel entsteht nach genau derselben Vorschrift. Eine zweite Umsetzung
 * daneben wäre eine zweite Wahrheit — und `toCategoryKey` in einer
 * Merkmalsdatei aufzurufen läse sich wie ein Versehen.
 */
export function toStableKey(name: string): string {
  return name
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/é/g, 'e')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/* ==================================================================== Farben */

/**
 * Die Palette, in der Reihenfolge, in der sie vergeben wird.
 *
 * Die ersten neun sind die bisherigen Token (`--cat-1` … `--cat-8`,
 * `--cat-nonfood`) und damit genau die Farben, die die mitgelieferten
 * Kategorien schon tragen. Danach kommen die Töne für alles Selbstangelegte —
 * zuerst Bernstein, weil „Auswärts essen" die erste neue Kategorie ist und das
 * Konzept dafür ausdrücklich ein warmes Bernstein vorschlägt.
 *
 * **Warum Hex und nicht `var(--cat-1)`:** Die Ramp-Token in
 * `src/styles/tokens.css` sind nur einmal definiert und gelten in beiden Themes
 * unverändert — es geht also nichts verloren. Eine Variable dagegen wäre ein
 * Name, den die Datenbank nicht prüfen kann und den ein Umbenennen im
 * Stylesheet still zerbrechen würde.
 */
export const CATEGORY_PALETTE: string[] = [
  '#16915c', // Grün, kräftig
  '#1fa86c',
  '#43bc85',
  '#6acb9e',
  '#8fd8b6',
  '#afe3cb',
  '#c6ecdb',
  '#dcf2e8', // Grün, ganz hell
  '#7c8a99', // Grau — Non-Food
  '#b07a12', // Bernstein, passend zum Token --amber
  '#d08c2f', // Bernstein, heller
  '#c8483f', // Rot
  '#8d6bb5', // Violett
  '#4a90c2', // Blau
  '#3f9e9e', // Petrol
  '#6f7d55', // Oliv
]

/** Die Farbe für eine Kategorie, die (noch) keine eigene hat. */
export const FALLBACK_CATEGORY_COLOR = '#7c8a99'

/**
 * Die erste Farbe der Palette, die noch keine Kategorie benutzt.
 *
 * Sind alle vergeben, wird von vorn weitergezählt: Zwei Kategorien in derselben
 * Farbe sind unschön, aber besser als eine ohne — und ändern lässt es sich mit
 * zwei Tippern. Bei sechzehn Farben ist das ohnehin ein theoretischer Fall.
 */
export function nextFreeColor(used: string[]): string {
  const taken = new Set(used.map((color) => color.trim().toLowerCase()))
  const free = CATEGORY_PALETTE.find((color) => !taken.has(color))
  return free ?? CATEGORY_PALETTE[used.length % CATEGORY_PALETTE.length]
}

/** Ist das ein Wert, den die Datenbank als Farbe annimmt? */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim())
}
