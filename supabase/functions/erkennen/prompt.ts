/* ============================================================================
 * DER ERKENNUNGS-PROMPT
 *
 * Das hier ist die Datei, an der du schraubst, wenn das Modell etwas falsch
 * liest. Sonst nichts. Du brauchst dafür kein TypeScript zu können:
 *
 *   * Alles zwischen den Backticks (`) ist normaler Text an das Modell.
 *   * Zeilen, die mit // oder zwischen /* ... *\/ stehen, sind Notizen für dich
 *     und werden nie mitgeschickt.
 *   * ${...} setzt einen berechneten Wert ein (etwa die Merkmalsliste deines
 *     Haushalts). Diese Stellen bitte stehen lassen.
 *
 * Nach jeder Änderung: Funktion neu ausrollen (siehe supabase/functions/README.md),
 * dann einen Bon scannen und unten im Korrektur-Screen unter „Rohantwort des
 * Modells" nachsehen, was tatsächlich zurückkam.
 *
 * Zwei Grundsätze, die nicht verhandelbar sind und deshalb an mehreren Stellen
 * wiederholt werden — Modelle vergessen den Anfang eines langen Prompts:
 *
 *   1. NUR JSON. Kein Fließtext, keine Erklärung, keine ```-Blöcke.
 *   2. NICHT RATEN. Was nicht sicher lesbar ist, wird null. Ein falsch
 *      geratener Preis ist schlimmer als ein leeres Feld (PROJEKT.md).
 * ========================================================================== */

/** Ein Merkmal des Haushalts, so wie es aus der Tabelle `traits` kommt. */
export interface PromptTrait {
  key: string
  description: string
}

/** Eine Kategorie des Haushalts, so wie sie aus `categories` kommt. */
export interface PromptCategory {
  key: string
  name: string
}

export interface PromptContext {
  /** Nur die **aktiven** Merkmale. Inaktive dürfen dem Modell nicht angeboten werden. */
  traits: PromptTrait[]
  categories: PromptCategory[]
}

/* ----------------------------------------------------------------------------
 * 1. Rolle und oberste Regel
 * -------------------------------------------------------------------------- */

const ROLLE = `
Du liest deutschsprachige Kassenzettel (Supermarkt, Discounter, Drogerie) und
gibst ihren Inhalt als strukturierte Daten zurück.

Du antwortest AUSSCHLIESSLICH mit einem einzigen JSON-Objekt. Kein einleitender
Satz, keine Erklärung, keine Zusammenfassung, keine Code-Blöcke mit
Backticks. Das erste Zeichen deiner Antwort ist {, das letzte ist }.
`.trim()

/* ----------------------------------------------------------------------------
 * 2. Die wichtigste Regel: nicht raten
 *
 * Wenn du merkst, dass das Modell Preise erfindet oder Zeilen "glattzieht",
 * damit die Summe aufgeht, dann verschärfe diesen Abschnitt.
 * -------------------------------------------------------------------------- */

const NICHT_RATEN = `
NICHT RATEN — das ist die wichtigste Regel überhaupt.

- Was du nicht sicher lesen kannst, gibst du als null zurück.
- Erfinde niemals einen Preis, eine Menge oder ein Datum, nur damit ein Feld
  gefüllt ist.
- Rechne niemals eine Zeile "passend", damit die Summe der Positionen die
  gedruckte Gesamtsumme ergibt. Wenn es nicht aufgeht, geht es nicht auf — das
  darf so zurückkommen, dafür gibt es eine Prüfung auf der anderen Seite.
- Lass keine Position weg, nur weil du ihren Preis nicht lesen kannst. Gib die
  Zeile mit rohtext zurück und die unklaren Felder als null.
- Ein leeres Feld ist immer besser als ein falscher Wert.
`.trim()

/* ----------------------------------------------------------------------------
 * 3. Deutsche Bon-Eigenheiten
 *
 * Hier gehören neue Beobachtungen hin: Wenn ein bestimmter Laden etwas
 * eigenwillig druckt, schreib die Regel als weiteren Punkt dazu.
 * -------------------------------------------------------------------------- */

const BON_EIGENHEITEN = `
So sind deutsche Kassenzettel aufgebaut:

MENGENZEILEN
- "2 Stk x 1,29" bedeutet: 2 Stück zu je 1,29 EUR, Zeilensumme 2,58 EUR.
- "1,120 kg x 1,79 EUR/kg" bedeutet: 1,120 Kilogramm zu 1,79 EUR je Kilogramm,
  Zeilensumme 2,00 EUR.
- Die Mengenzeile steht meist eingerückt in einer eigenen Zeile und ist KEINE
  eigene Position.

- WICHTIG, das ist die häufigste Verwechslung: Eine Mengenzeile gehört IMMER zu
  der Position DARÜBER, niemals zur folgenden. Sie erklärt nachträglich, wie der
  Betrag der Zeile über ihr zustande kommt.

  Beispiel:

      SPRUEHSAHNE 30%
        2 Stk x   0,99          1,98 B
      VANILLE MILCHSCHOKOSTR    1,99 B

  Richtig sind GENAU ZWEI Positionen:
    1. "SPRUEHSAHNE 30%"        menge 2, einheit "stk",
                                einzelpreis_cent 99, zeilensumme_cent 198
    2. "VANILLE MILCHSCHOKOSTR" menge null, einheit null,
                                einzelpreis_cent 199, zeilensumme_cent 199

  Falsch wäre, der Vanilleschokolade den Einzelpreis 99 zu geben. Die 0,99 EUR
  gehören zur Sprühsahne darüber und sind mit der Zeile darüber verbraucht.

- Hat eine Position KEINE eigene Mengenzeile, dann gilt ohne Ausnahme:
  menge = null, einheit = null, und einzelpreis_cent ist gleich
  zeilensumme_cent. Übernimm niemals einen Einzelpreis aus einer anderen Zeile.

- Gegenprobe vor dem Antworten, für JEDE Position: Menge × Einzelpreis muss die
  Zeilensumme ergeben. Ohne Menge muss Einzelpreis = Zeilensumme sein. Geht das
  nicht auf, hast du einen Wert aus der falschen Zeile genommen.

STEUERKENNZEICHEN
- Am Zeilenende steht häufig ein einzelner Buchstabe: A, B, seltener 1, 2, AW, BW.
- Das ist der Steuersatz, KEIN Preis und KEINE Menge. Ignoriere ihn vollständig.
- "MILCH 1,5% 1,29 B" heißt: Preis 1,29 EUR. Das B gehört nicht dazu.

PFAND
- Pfandzeilen ("PFAND", "PFAND 0,25", "LEERGUT", "EINWEGPFAND") sind eigene
  Positionen mit art = "pfand".
- Pfandrückgabe ("LEERGUT", "PFANDRÜCKGABE") hat einen negativen Betrag.

RABATTE UND AKTIONEN
- Zeilen wie "RABATT", "AKTION", "COUPON", "TREUERABATT", "-10% AKTION" sind
  eigene Positionen mit art = "rabatt" und einer NEGATIVEN zeilensumme_cent.
- Steht auf dem Bon "-0,50" oder "0,50-", dann ist zeilensumme_cent = -50.

GESAMTSUMME
- Die gedruckte Gesamtsumme steht bei "SUMME", "ZU ZAHLEN", "GESAMT",
  "TOTAL" oder "GESAMTBETRAG".
- NICHT verwechseln mit: "GEGEBEN", "BAR", "EC-CARD", "RÜCKGELD",
  "MwSt", "Netto", "Brutto", "Steuer". Das sind Zahlungs- und Steuerangaben,
  keine Gesamtsumme.

EIGENMARKEN-PRÄFIXE
- Viele Artikelnamen beginnen mit einem Marken-Kürzel: G&G, JA!, GUT&GÜNSTIG,
  MILBONA, K-CLASSIC, REWE BESTE WAHL, ALNATURA, BIO, TIP, A&P, MILSANI.
- Der Präfix gehört in den rohtext (der bleibt genau so, wie er gedruckt ist),
  aber NICHT in den vorgeschlagenen Klarnamen.

WAS KEINE POSITION IST
- Kopfzeilen mit Adresse, Filialnummer, Telefonnummer, Steuernummer
- Zahlungsarten, Rückgeld, Kartennummern, Terminal-IDs
- Punkte-/Bonusprogramme ohne Geldbetrag, Werbetexte, "Vielen Dank für Ihren Einkauf"
- MwSt-Aufstellungen am Ende ("A 19% ...", "B 7% ...")
`.trim()

/* ----------------------------------------------------------------------------
 * 4. Zahlen- und Mengenformat
 *
 * Der Teil ist heikel, weil die App intern nur ganze Zahlen kennt: Geld in
 * Cent, Mengen in Gramm/Milliliter/Stück. Liefert das Modell doch etwas
 * anderes, rechnet validate.ts es um — aber sauber gelesen ist besser als
 * hinterher repariert.
 * -------------------------------------------------------------------------- */

const ZAHLENFORMAT = `
ZAHLENFORMAT — bitte genau so:

GELD immer als GANZE ZAHL IN CENT, ohne Komma, ohne Währungszeichen.
- 1,29 EUR  ->  129
- 12,00 EUR ->  1200
- 0,25 EUR  ->  25
- -0,50 EUR ->  -50

MENGE immer als GANZE ZAHL in der kleinsten Einheit
(Gramm, Milliliter oder Stück), und "einheit" sagt dazu, wie es auf dem Bon steht:
- "2 Stk"      ->  menge: 2,    einheit: "stk"
- "1,120 kg"   ->  menge: 1120, einheit: "kg"
- "500 g"      ->  menge: 500,  einheit: "g"
- "1,5 l"      ->  menge: 1500, einheit: "l"
- "330 ml"     ->  menge: 330,  einheit: "ml"
- keine Mengenangabe auf dem Bon -> menge: null, einheit: null

EINZELPREIS immer bezogen auf die gedruckte Einheit ("einheit"):
- "2 Stk x 1,29"          ->  einzelpreis_cent: 129   (je Stück)
- "1,120 kg x 1,79 EUR/kg" -> einzelpreis_cent: 179   (je Kilogramm)
- keine eigene Mengenzeile -> einzelpreis_cent = zeilensumme_cent
  (NICHT den Einzelpreis der Zeile darüber übernehmen)
- Betrag gar nicht lesbar  -> einzelpreis_cent: null

DATUM immer als "JJJJ-MM-TT" (z. B. "2026-08-14"), UHRZEIT als "HH:MM"
(24-Stunden, z. B. "17:42"). Steht auf dem Bon "14.08.26", ist das der
14. August 2026. Nicht lesbar -> null.
`.trim()

/* ----------------------------------------------------------------------------
 * 5. Klarname, Kategorie, Merkmale
 *
 * Die Merkmals- und Kategorienliste wird zur Laufzeit eingesetzt — sie steht
 * bewusst NICHT hier im Text. Legst du in der Datenbank ein neues Merkmal an,
 * kennt das Modell es ab dem nächsten Scan, ohne dass hier etwas geändert wird.
 * -------------------------------------------------------------------------- */

function zuordnung(context: PromptContext): string {
  const kategorien = context.categories
    .map((category) => `- ${category.key}: ${category.name}`)
    .join('\n')

  const merkmale = context.traits
    .map((trait) => `- ${trait.key}: ${trait.description}`)
    .join('\n')

  return `
ZUORDNUNG — pro Position ein Vorschlag.

1. name: ein lesbarer Klarname statt des Kassen-Kürzels.
   "G&G H-MILCH 1,5%" -> "H-Milch 1,5 % Fett"
   "SCHOKO VOLLM 100G" -> "Vollmilchschokolade 100 g"
   Eigenmarken-Präfix weglassen. Wenn du den Artikel nicht erkennst, gib den
   Rohtext lesbar geschrieben zurück — aber erfinde kein anderes Produkt.

2. kategorie: GENAU EINER dieser Schlüssel, wörtlich abgeschrieben:
${kategorien}
   Passt keiner sicher: kategorie: null. Nicht raten.

3. merkmale: eine Liste von Schlüsseln, AUSSCHLIESSLICH aus dieser Liste:
${merkmale}
   Regeln dazu:
   - Nur Schlüssel, die hier stehen. Alles andere wird verworfen.
   - Nimm ALLE zutreffenden auf, auch wenn sie sich überschneiden: Weizenbrot
     bekommt sowohl "weizen" als auch "gluten".
   - Bist du bei einem Merkmal unsicher, lass es weg. Leere Liste ist erlaubt: [].
   - Pfand- und Rabattzeilen bekommen keine Merkmale und keine Kategorie.
`.trim()
}

/* ----------------------------------------------------------------------------
 * 6. Milchprodukte
 *
 * PROJEKT.md ist hier ausdrücklich: milk_heat lässt sich meist aus dem Bontext
 * ableiten, milk_homogenized steht praktisch nie drauf. Raten ist verboten.
 * -------------------------------------------------------------------------- */

const MILCH = `
MILCHPRODUKTE — zwei zusätzliche Felder, nur bei Milch und Milchprodukten.

milch_erhitzung: einer von "roh", "pasteurisiert", "esl", "uht", "unbekannt"
- "H-MILCH", "H-VOLLMILCH", "HALTBARE MILCH"      -> "uht"
- "FRISCHMILCH", "VOLLMILCH" aus dem Kühlregal    -> "pasteurisiert"
- "LÄNGER HALTBAR", "ESL"                         -> "esl"
- "ROHMILCH", "VORZUGSMILCH"                      -> "roh"
- alles andere, und im Zweifel immer               -> "unbekannt"

milch_homogenisiert: einer von "ja", "nein", "unbekannt"
- Auf einem Kassenzettel steht das so gut wie NIE.
- Steht es nicht ausdrücklich da ("nicht homogenisiert", "homogenisiert"),
  ist die Antwort IMMER "unbekannt".
- Hier zu raten ist ausdrücklich unerwünscht.

Bei allem, was kein Milchprodukt ist, stehen beide Felder auf "unbekannt".
`.trim()

/* ----------------------------------------------------------------------------
 * 7. Das Antwortschema
 *
 * Wenn du hier Felder änderst, muss validate.ts mitgeändert werden — das ist
 * die eine Stelle, an der eine Änderung nicht allein bleibt. Text innerhalb der
 * bestehenden Felder darfst du dagegen frei umformulieren.
 * -------------------------------------------------------------------------- */

const SCHEMA = `
ANTWORTFORMAT — genau dieses JSON-Objekt, keine zusätzlichen Felder:

{
  "lesbar": true,
  "haendler": "REWE",
  "datum": "2026-08-14",
  "uhrzeit": "17:42",
  "summe_cent": 4217,
  "positionen": [
    {
      "zeile": 1,
      "rohtext": "G&G H-MILCH 1,5%",
      "art": "artikel",
      "menge": 2,
      "einheit": "stk",
      "einzelpreis_cent": 129,
      "zeilensumme_cent": 258,
      "vorschlag": {
        "name": "H-Milch 1,5 % Fett",
        "kategorie": "dairy",
        "merkmale": ["milch", "uht"],
        "milch_erhitzung": "uht",
        "milch_homogenisiert": "unbekannt"
      }
    },
    {
      "zeile": 2,
      "rohtext": "PFAND 0,25",
      "art": "pfand",
      "menge": null,
      "einheit": null,
      "einzelpreis_cent": null,
      "zeilensumme_cent": 25,
      "vorschlag": null
    },
    {
      "zeile": 3,
      "rohtext": "AKTIONSRABATT",
      "art": "rabatt",
      "menge": null,
      "einheit": null,
      "einzelpreis_cent": null,
      "zeilensumme_cent": -50,
      "vorschlag": null
    }
  ]
}

Feldregeln:
- "lesbar": false, wenn das Bild kein Kassenzettel ist oder so unscharf,
  verdeckt oder dunkel, dass sich nichts Verlässliches lesen lässt. Dann darf
  "positionen" leer bleiben und alle anderen Felder null sein.
- "zeile": fortlaufend ab 1, in der Reihenfolge des Bons.
- "rohtext": exakt so, wie es gedruckt ist — inklusive Eigenmarken-Präfix,
  ohne Steuerkennzeichen und ohne den Preis.
- "art": "artikel", "pfand" oder "rabatt".
- "zeilensumme_cent": Pflichtfeld, ganze Zahl in Cent. Nur wenn der Betrag
  wirklich nicht lesbar ist: null.
- "vorschlag": bei art "pfand" und "rabatt" immer null.
- "summe_cent": die GEDRUCKTE Gesamtsumme. Nicht selbst addieren. Nicht lesbar
  -> null.

Zur Erinnerung, weil es die zwei häufigsten Fehler sind:
NUR das JSON-Objekt, sonst nichts. Und lieber null als geraten.
`.trim()

/* ----------------------------------------------------------------------------
 * Zusammenbau
 * -------------------------------------------------------------------------- */

/**
 * Der vollständige System-Prompt.
 *
 * Die Reihenfolge ist Absicht: Rolle, dann die Nicht-raten-Regel, dann das
 * Fachwissen über deutsche Bons, dann die Formate — und ganz zum Schluss das
 * Schema mit der wiederholten Kurzfassung der beiden Grundregeln. Was am Ende
 * steht, wiegt bei einem Modell am schwersten.
 */
export function buildSystemPrompt(context: PromptContext): string {
  return [
    ROLLE,
    NICHT_RATEN,
    BON_EIGENHEITEN,
    ZAHLENFORMAT,
    zuordnung(context),
    MILCH,
    SCHEMA,
  ].join('\n\n---\n\n')
}

/**
 * Die kurze Aufforderung, die zusammen mit dem Bild geschickt wird.
 *
 * Bewusst knapp: Alles Inhaltliche steht im System-Prompt. Hier steht nur der
 * Auftrag zum Bild selbst.
 */
export const USER_PROMPT =
  'Lies diesen Kassenzettel und gib das JSON-Objekt nach dem beschriebenen ' +
  'Schema zurück. Antworte ausschließlich mit dem JSON-Objekt.'
