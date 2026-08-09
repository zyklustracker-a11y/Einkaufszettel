/* ============================================================================
 * DIE ERKENNUNGS-PROMPTS
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
 * ---------------------------------------------------------------------------
 * ZWEI DURCHGÄNGE — und warum die Trennung der Kern der Sache ist
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 4b-2 stand hier ein einziger Prompt, der beides zugleich
 * verlangte: Zeilen abschreiben UND daraus lesbare Produktnamen bilden. Genau
 * daran ist er wiederholt gescheitert. Auf einem REWE-Bon stand
 *
 *     VANILLE                    1,99 B
 *     MILCHSCHOKOSTR             0,99 B
 *
 * und das Modell machte daraus eine Position „Vanille-Milchschokolade". Das ist
 * kein Lesefehler: „Vanille" und „Milchschokostreusel" ergeben zusammen einen
 * plausiblen Artikelnamen, und der Auftrag lautete ja, plausible Namen zu
 * bilden. Die Regel „eine Zeile mit Preis ist eine eigene Position" stand
 * daneben und verlor. Gegen die Bedeutung der Wörter kommt eine Textregel
 * schwer an.
 *
 * Seit Schritt 4c laufen deshalb zwei getrennte Durchgänge:
 *
 *   1. STRUKTUR (mit Bild). Stumpfes Abschreiben.
 *   2. ZUORDNUNG (ohne Bild). Bekommt nur die Rohtexte und macht daraus
 *      Klarnamen, Kategorien und Merkmale.
 *
 * Mit Schritt 4d ging Durchgang 1 noch einen Schritt weiter zurück. Auch ohne
 * Namensaufgabe zog das Modell „VANILLE" und „MILCHSCHOKOSTR" weiter zusammen —
 * es *kann* die Regel (bei der Sprühsahne darüber wendet es sie richtig an), es
 * sieht die zweite Zeile nur nicht als eigene. Dagegen half kein weiterer Satz.
 *
 * Also entscheidet das Modell jetzt gar nicht mehr, was eine Position ist. Es
 * gibt nur noch `zeilen` zurück — jede gedruckte Zeile einzeln, wörtlich. Die
 * Aufteilung macht `lines.ts` im Code, nach einer Regel, die sich hinschreiben
 * und mit Tests festnageln lässt. Das ist derselbe Grundsatz wie bei Summen,
 * Score und Bestpreisen: Was eine Regel über Text und Zahlen ist, gehört nicht
 * in ein Modell.
 *
 * Der Gewinn ist die geänderte Fehlerart: Rät Durchgang 2 daneben, kostet das
 * einen Tipper im Korrektur-Screen — und die Lernschleife merkt sich die
 * Korrektur dauerhaft. Ein Betrag, der in Durchgang 1 gar nicht erst erfasst
 * wurde, ist dagegen verloren.
 *
 * Durchgang 2 läuft nur für Rohtexte, die der Haushalt noch nicht kennt. Bei
 * einem Bon aus lauter bekannten Artikeln entfällt er ganz.
 *
 * Zwei Grundsätze gelten in beiden Durchgängen und stehen deshalb in beiden
 * Prompts — Modelle vergessen den Anfang eines langen Texts:
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

/**
 * Eine Kategorie des Haushalts, so wie sie aus `categories` kommt.
 *
 * `description` kam mit Schritt 5 dazu und ist der eigentliche Grund, warum
 * eigene Kategorien überhaupt funktionieren: Ohne sie müsste das Modell aus dem
 * Namen raten. Bei „Gewürze" ginge das noch, bei „Vorratskammer" nicht mehr.
 * Leer ist erlaubt — dann steht eben nur der Name da.
 */
export interface PromptCategory {
  key: string
  name: string
  description: string
}

export interface PromptContext {
  /** Nur die **aktiven** Merkmale. Inaktive dürfen dem Modell nicht angeboten werden. */
  traits: PromptTrait[]
  /** Ebenfalls nur die **aktiven**. Eine abgeschaltete wird nicht mehr vergeben. */
  categories: PromptCategory[]
}

/* ############################################################################
 *
 *   DURCHGANG 1 — STRUKTUR
 *
 *   Alles, was hier nicht steht, macht diesen Prompt besser. Jede zusätzliche
 *   Aufgabe ist eine, die mit dem Abschreiben konkurriert.
 *
 * ######################################################################### */

const STRUKTUR_ROLLE = `
Du bist ein Abschreiber. Du liest ein Foto von einem deutschsprachigen
Kassenzettel und gibst zurück, was dort steht — Zeile für Zeile, wörtlich.

Stell dir vor, du tippst den Bon für jemanden ab, der ihn nicht sehen kann. Du
deutest nichts. Du fasst nichts zusammen. Du benennst nichts um. Du entscheidest
nicht, was ein Artikel „eigentlich" ist und welche Zeilen zusammengehören. Diese
Aufgaben hat jemand anders; sie sind hier ausdrücklich nicht deine.

Du antwortest AUSSCHLIESSLICH mit einem einzigen JSON-Objekt. Kein einleitender
Satz, keine Erklärung, keine Zusammenfassung, keine Code-Blöcke mit Backticks.
Das erste Zeichen deiner Antwort ist {, das letzte ist }.
`.trim()

const STRUKTUR_NICHT_RATEN = `
NICHT RATEN — das ist die wichtigste Regel überhaupt.

- Was du nicht sicher lesen kannst, tippst du so ab, wie du es siehst. Rate
  keinen Text und keinen Betrag dazu.
- Rechne nichts aus. Du addierst nichts, du prüfst keine Summe, du korrigierst
  keinen Preis. Ob am Ende alles aufgeht, ist nicht deine Sorge — dafür gibt es
  eine Prüfung auf der anderen Seite.
- Lass keine Zeile weg, weil sie dir überflüssig vorkommt.
- Ein unvollständig gelesener Text ist besser als ein erfundener.
`.trim()

/* ----------------------------------------------------------------------------
 * Die eine Regel, um die es geht.
 *
 * Wenn wieder Zeilen verschmelzen oder fehlen, gehört die Verschärfung HIER hin
 * — und nirgendwo sonst. Neue Beobachtungen zu einzelnen Läden ebenfalls.
 * -------------------------------------------------------------------------- */

const STRUKTUR_ZEILEN = `
EINE GEDRUCKTE ZEILE IST EIN EINTRAG IN "zeilen". Das ist die ganze Regel.

- Geh den Artikelbereich des Bons von oben nach unten durch. Jede gedruckte
  Zeile wird EIN Eintrag in der Liste "zeilen", in genau dieser Reihenfolge.
- Fasse NIEMALS zwei gedruckte Zeilen zu einem Eintrag zusammen. Auch dann
  nicht, wenn die Wörter inhaltlich zusammenzupassen scheinen.
- Zerlege umgekehrt keine gedruckte Zeile in zwei Einträge.
- Tippe jede Zeile vollständig ab: Artikeltext, Betrag und den Buchstaben am
  Zeilenende, alles in einem Eintrag, so wie es dasteht.

  Beispiel:

      VANILLE                    1,99 B
      MILCHSCHOKOSTR             0,99 B

  Das sind ZWEI Einträge:
      "VANILLE                    1,99 B"
      "MILCHSCHOKOSTR             0,99 B"

  Daraus einen Eintrag "VANILLE MILCHSCHOKOSTR 1,99 B" zu machen wäre falsch und
  würde 0,99 EUR verschlucken. Ob die beiden Wörter zusammen einen sinnvollen
  Artikelnamen ergäben, ist dir egal — du benennst nichts, du tippst ab.

- ZÄHLE ZUM SCHLUSS NACH: So viele Einträge, wie der Bon gedruckte Zeilen im
  Artikelbereich hat. Und für jeden Betrag, den du im Artikelbereich siehst,
  muss ein Eintrag mit genau diesem Betrag in der Liste stehen. Fehlt einer,
  hast du eine Zeile übersehen — geh sie noch einmal durch.
`.trim()

const STRUKTUR_EIGENHEITEN = `
Was in "zeilen" gehört und was nicht:

DAZU GEHÖREN
- Artikelzeilen mit Betrag, zum Beispiel "MILCH 1,5%           1,29 B"
- Zeilen ohne Betrag, die zu einem Artikel gehören: eine Fortsetzung eines
  langen Namens, oder eine eingerückte Mengenzeile wie "2 Stk x   0,99   1,98 B"
  oder "1,120 kg x 1,79 EUR/kg"
- Pfandzeilen ("PFAND 0,25", "LEERGUT", "EINWEGPFAND")
- Rabattzeilen ("RABATT", "AKTION", "COUPON", "TREUERABATT")

  Diese Zeilen tippst du einfach mit ab — so, wie sie dastehen, an der Stelle,
  an der sie stehen. Was sie bedeuten, entscheidet jemand anders.

NICHT DAZU GEHÖREN
- Kopfzeilen mit Name, Adresse, Filialnummer, Telefonnummer, Steuernummer
- Die Summenzeile ("SUMME", "ZU ZAHLEN", "GESAMT", "TOTAL") und alles darunter
- Zahlungsarten, Rückgeld, Kartennummern, Terminal-IDs, "Gegeben", "Bar"
- Die MwSt-Aufstellung am Fuß (die kommt getrennt, siehe "steuerblock")
- Punkte- und Bonusprogramme ohne Geldbetrag, Werbetexte, "Vielen Dank"

Der Artikelbereich beginnt bei der ersten Artikelzeile und endet bei der
Summenzeile — die gehört nicht mehr dazu.
`.trim()

const STRUKTUR_ZAHLENFORMAT = `
ABTIPPEN HEISST WÖRTLICH — auch bei Zahlen.

- Beträge bleiben so stehen, wie sie gedruckt sind: "1,99", "0,10", "-0,50",
  "0,50-". Rechne sie NICHT in Cent um, lass das Komma stehen, rund nichts.
- Mengenangaben bleiben ebenfalls stehen: "2 Stk x   0,99", "1,120 kg x 1,79
  EUR/kg". Nicht umrechnen, nicht vereinfachen.
- Der Buchstabe am Zeilenende (A, B, seltener 1, 2, AW) ist das
  Steuerkennzeichen. Er gehört mit in die Zeile. Er ist KEIN Preis.
- Groß- und Kleinschreibung, Abkürzungen, Eigenmarken-Kürzel (G&G, JA!,
  K-CLASSIC, MILBONA) und Umlaute bleiben so, wie sie gedruckt sind.
- Mehrere Leerzeichen zwischen Text und Betrag darfst du beibehalten oder auf
  eines kürzen — beides ist in Ordnung.

Nur die vier Kopf-Felder werden umgerechnet, weil sie eindeutig sind:

GESAMTSUMME "summe_cent" als GANZE ZAHL IN CENT.
- "6,55" -> 655.  Nicht lesbar -> null.
- Das ist die GEDRUCKTE Summe bei "SUMME", "ZU ZAHLEN", "GESAMT", "TOTAL".
  NICHT verwechseln mit "GEGEBEN", "BAR", "EC-CARD", "RÜCKGELD", "MwSt".
- Nicht selbst addieren.

DATUM als "JJJJ-MM-TT", UHRZEIT als "HH:MM" (24 Stunden). Steht auf dem Bon
"23.06.17", ist das der 23. Juni 2017. Nicht lesbar -> null.

DER STEUERBLOCK AM FUSS DES BONS
- Fast jeder Bon schließt mit einer Aufstellung je Steuersatz ab:

      Steuer %      Netto   Steuer   Brutto
      A= 19,0%       1,34     0,25     1,59
      B=  7,0%       4,64     0,32     4,96
      Gesamtbetrag   5,98     0,57     6,55

- Gib je Steuerklasse das Kennzeichen und den BRUTTO-Betrag in Cent zurück (die
  letzte Spalte). Aus dem Beispiel werden zwei Einträge: A mit 159, B mit 496.
- Die Zeile "Gesamtbetrag" (oder "Summe", "Gesamt") ist KEINE Steuerklasse und
  gehört NICHT in die Liste.
- Fehlt der Block oder ist er nicht lesbar: "steuerblock": []. Nicht ausrechnen,
  nicht schätzen.
`.trim()

const STRUKTUR_SCHEMA = `
ANTWORTFORMAT — genau dieses JSON-Objekt, keine zusätzlichen Felder:

{
  "lesbar": true,
  "haendler": "REWE CITY",
  "datum": "2017-06-23",
  "uhrzeit": "14:25",
  "summe_cent": 655,
  "steuerblock": [
    { "kennzeichen": "A", "brutto_cent": 159 },
    { "kennzeichen": "B", "brutto_cent": 496 }
  ],
  "zeilen": [
    "SPRUEHSAHNE 30%",
    "  2 Stk x   0,99          1,98 B",
    "VANILLE                   1,99 B",
    "MILCHSCHOKOSTR            0,99 B",
    "KL.PAPIERTASCHE           0,10 A",
    "TRINKHALME                1,49 A"
  ]
}

Feldregeln:
- "lesbar": false, wenn das Bild kein Kassenzettel ist oder so unscharf,
  verdeckt oder dunkel, dass sich nichts Verlässliches lesen lässt. Dann darf
  "zeilen" leer bleiben und alle anderen Felder null sein.
- "zeilen": eine Liste von Zeichenketten. Eine gedruckte Zeile, ein Eintrag.
  Keine Objekte, keine Nummerierung, keine Zusatzfelder.
- "haendler": der Name des Ladens aus dem Bonkopf.

Es gibt KEIN Feld für Positionen, Produktnamen, Kategorien oder Eigenschaften.
Wenn du versucht bist, eines hinzuzufügen: nicht tun. Die Zeilen werden auf der
anderen Seite von einem Programm aufgeteilt, das dabei keinen Betrag verlieren
kann — das ist genau der Grund, warum du sie einzeln abtippen sollst.

Zwei Kontrollen, bevor du antwortest:
1. Genauso viele Einträge, wie der Artikelbereich gedruckte Zeilen hat.
2. Jeder Betrag, der im Artikelbereich steht, kommt in genau einem Eintrag vor.

Und zur Erinnerung, weil es die zwei häufigsten Fehler sind:
NUR das JSON-Objekt, sonst nichts. Und wörtlich abtippen statt deuten.
`.trim()

/**
 * Der System-Prompt für Durchgang 1.
 *
 * Er ist eine **Konstante**: Struktur hat mit den Merkmalen des Haushalts nichts
 * zu tun. Damit hängt der empfindlichste Teil der Erkennung an keiner
 * Einstellung mehr — was der Nutzer in den Merkmalen ändert, kann das Abschreiben
 * nicht mehr beeinflussen.
 */
export const STRUCTURE_SYSTEM_PROMPT = [
  STRUKTUR_ROLLE,
  STRUKTUR_NICHT_RATEN,
  STRUKTUR_ZEILEN,
  STRUKTUR_EIGENHEITEN,
  STRUKTUR_ZAHLENFORMAT,
  STRUKTUR_SCHEMA,
].join('\n\n---\n\n')

/** Die kurze Aufforderung, die zusammen mit dem Bild geschickt wird. */
export const STRUCTURE_USER_PROMPT =
  'Tippe die Zeilen dieses Kassenzettels ab und gib das JSON-Objekt nach dem ' +
  'beschriebenen Schema zurück. Eine gedruckte Zeile ist ein Eintrag in „zeilen". ' +
  'Antworte ausschließlich mit dem JSON-Objekt.'

/* ############################################################################
 *
 *   DURCHGANG 2 — ZUORDNUNG
 *
 *   Ohne Bild. Bekommt nur die Rohtexte, die der Haushalt noch nicht kennt.
 *   Hier darf gedeutet werden — hier hängt kein Geldbetrag daran.
 *
 * ######################################################################### */

const ZUORDNUNG_ROLLE = `
Du bekommst eine Liste von Artikeltexten, wie sie auf deutschen Kassenzetteln
gedruckt sind, und ordnest jedem davon einen Klarnamen, eine Kategorie und
Merkmale zu.

Du siehst den Bon nicht und brauchst ihn nicht. Preise, Mengen und Summen sind
bereits erfasst und gehen dich nichts an — gib sie auch nicht zurück.

Du antwortest AUSSCHLIESSLICH mit einem einzigen JSON-Objekt. Kein einleitender
Satz, keine Erklärung, keine Code-Blöcke mit Backticks. Das erste Zeichen deiner
Antwort ist {, das letzte ist }.
`.trim()

const ZUORDNUNG_NICHT_RATEN = `
NICHT RATEN.

- Passt keine Kategorie sicher: kategorie null. Nicht die nächstbeste nehmen.
- Bist du bei einem Merkmal unsicher: weglassen. Eine leere Liste ist erlaubt.
- Erkennst du den Artikel nicht, gib den Rohtext lesbar geschrieben als Namen
  zurück — aber erfinde kein anderes Produkt.
- Ein leeres Feld ist besser als ein falsches. Der Nutzer sieht jede Zuordnung
  und korrigiert sie in einem Schritt; eine falsche Zuordnung dagegen, die
  plausibel aussieht, übersieht er.

Gib GENAU EINEN Eintrag je übergebenem Rohtext zurück, mit dem Rohtext
unverändert im Feld "rohtext" — daran wird zugeordnet. Lass keinen aus, erfinde
keinen dazu, fass keine zwei zusammen.
`.trim()

/* ----------------------------------------------------------------------------
 * Die Merkmals- und Kategorienliste wird zur Laufzeit eingesetzt — sie steht
 * bewusst NICHT hier im Text. Legst du in der Datenbank ein neues Merkmal an,
 * kennt das Modell es ab dem nächsten Scan, ohne dass hier etwas geändert wird.
 * -------------------------------------------------------------------------- */

function zuordnung(context: PromptContext): string {
  const kategorien = context.categories
    .map((category) => {
      const erklaerung = category.description.trim()
      // Die Erklärung sagt, was hineingehört und was nicht — sie ist bei einem
      // selbst erfundenen Namen die einzige Information, die das Modell hat.
      return erklaerung === ''
        ? `- ${category.key}: ${category.name}`
        : `- ${category.key}: ${category.name} — ${erklaerung}`
    })
    .join('\n')

  const merkmale = context.traits
    .map((trait) => `- ${trait.key}: ${trait.description}`)
    .join('\n')

  return `
SO ORDNEST DU ZU — drei Felder je Rohtext.

1. name: ein lesbarer Klarname statt des Kassen-Kürzels.
   "G&G H-MILCH 1,5%" -> "H-Milch 1,5 % Fett"
   "SCHOKO VOLLM 100G" -> "Vollmilchschokolade 100 g"
   "SPRUEHSAHNE 30%" -> "Sprühsahne 30 % Fett"
   Eigenmarken-Präfix weglassen (G&G, JA!, GUT&GÜNSTIG, MILBONA, K-CLASSIC,
   REWE BESTE WAHL, ALNATURA, TIP, A&P, MILSANI). Der Präfix sagt nur, wessen
   Eigenmarke es ist, nicht was es ist.

2. kategorie: GENAU EINER dieser Schlüssel, wörtlich abgeschrieben:
${kategorien}
   Passt keiner sicher: kategorie null. Nicht raten.

3. merkmale: eine Liste von Schlüsseln, AUSSCHLIESSLICH aus dieser Liste:
${merkmale}
   Regeln dazu:
   - Nur Schlüssel, die hier stehen. Alles andere wird verworfen.
   - Nimm ALLE zutreffenden auf, auch wenn sie sich überschneiden: Weizenbrot
     bekommt sowohl "weizen" als auch "gluten".
   - Bist du bei einem Merkmal unsicher, lass es weg. Leere Liste ist erlaubt: [].
`.trim()
}

const ZUORDNUNG_MILCH = `
MILCHPRODUKTE — zwei zusätzliche Felder, nur bei Milch und Milchprodukten.

milch_erhitzung: einer von "roh", "pasteurisiert", "esl", "uht", "unbekannt"
- "H-MILCH", "H-VOLLMILCH", "HALTBARE MILCH"      -> "uht"
- "FRISCHMILCH", "VOLLMILCH" aus dem Kühlregal    -> "pasteurisiert"
- "LÄNGER HALTBAR", "ESL"                         -> "esl"
- "ROHMILCH", "VORZUGSMILCH"                      -> "roh"
- alles andere, und im Zweifel immer               -> "unbekannt"

milch_homogenisiert: einer von "ja", "nein", "unbekannt"
- Auf einem Kassenzettel steht das so gut wie NIE.
- Steht es nicht ausdrücklich im Text ("nicht homogenisiert", "homogenisiert"),
  ist die Antwort IMMER "unbekannt".
- Hier zu raten ist ausdrücklich unerwünscht.

Bei allem, was kein Milchprodukt ist, stehen beide Felder auf "unbekannt".
`.trim()

const ZUORDNUNG_SCHEMA = `
ANTWORTFORMAT — genau dieses JSON-Objekt, keine zusätzlichen Felder:

{
  "zuordnungen": [
    {
      "rohtext": "G&G H-MILCH 1,5%",
      "name": "H-Milch 1,5 % Fett",
      "kategorie": "dairy",
      "merkmale": ["milch"],
      "milch_erhitzung": "uht",
      "milch_homogenisiert": "unbekannt"
    },
    {
      "rohtext": "SPUELMITTEL ZITRONE",
      "name": "Spülmittel Zitrone",
      "kategorie": "nonfood",
      "merkmale": [],
      "milch_erhitzung": "unbekannt",
      "milch_homogenisiert": "unbekannt"
    }
  ]
}

- "rohtext": unverändert der übergebene Text. Nicht korrigieren, nicht kürzen —
  daran wird zugeordnet.
- Genau so viele Einträge wie übergebene Rohtexte, in derselben Reihenfolge.

Und zur Erinnerung: NUR das JSON-Objekt, sonst nichts. Und lieber null als
geraten.
`.trim()

/** Der System-Prompt für Durchgang 2, aus den Merkmalen des Haushalts gebaut. */
export function buildAssignmentPrompt(context: PromptContext): string {
  return [
    ZUORDNUNG_ROLLE,
    ZUORDNUNG_NICHT_RATEN,
    zuordnung(context),
    ZUORDNUNG_MILCH,
    ZUORDNUNG_SCHEMA,
  ].join('\n\n---\n\n')
}

/** Die Aufforderung mit den Rohtexten, einer je Zeile. */
export function buildAssignmentUserPrompt(rawTexts: string[]): string {
  return [
    `Ordne diese ${rawTexts.length} Artikeltexte zu. Gib genau ${rawTexts.length} Einträge zurück,`,
    'jeden mit seinem Rohtext unverändert. Antworte ausschließlich mit dem JSON-Objekt.',
    '',
    ...rawTexts.map((text) => `- ${text}`),
  ].join('\n')
}
