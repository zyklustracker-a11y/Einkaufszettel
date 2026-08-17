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

/* ----------------------------------------------------------------------------
 * Tankbelege (Schritt 7).
 *
 * Sie sind anders gebaut als ein Supermarktbon: ein einziger Artikel, dafür mit
 * Zapfsäule, Kraftstoffart, Literzahl und einem Preis mit DREI Nachkommastellen.
 * Der Prompt braucht dafür kein neues Konzept — die Regel „eine gedruckte Zeile
 * ist ein Eintrag" gilt unverändert. Was fehlte, ist ein Beispiel, damit die
 * Literzeile als eigene Zeile abgetippt wird und nicht im Artikelnamen
 * verschwindet: Nur so kommt sie bei `lines.ts` als Mengenzeile an, und nur dann
 * gibt es einen Literpreis zum Vergleichen.
 * -------------------------------------------------------------------------- */

const STRUKTUR_TANKBELEG = `
TANKBELEGE — ein Sonderfall der Form, nicht der Regel.

Ein Tankbeleg hat meist nur einen Artikel, dafür eine Mengenzeile mit Litern und
einen Literpreis mit DREI Nachkommastellen. Tippe beides ab, unverändert:

    SUPER E10
      38,45 L à 1,779 EUR/L       68,41 A
    ZAPFSAEULE 3

Das sind drei Einträge, so wie sie dastehen. Beachte dabei:

- Der Literpreis behält seine dritte Stelle: "1,779" und nicht "1,78". Runde
  nichts.
- Trennzeichen zwischen Menge und Preis sind hier oft "à" oder "@" statt "x".
  Lass sie stehen, wie sie gedruckt sind.
- Die Einheit heißt je nach Kasse "L", "Ltr" oder "Liter". Auch die bleibt so.
- Zeilen wie "ZAPFSAEULE 3", "KM-STAND" oder eine Fahrzeugnummer sind Teil des
  Artikelbereichs und werden mit abgetippt. Sie tragen keinen Betrag und
  richten damit keinen Schaden an.
- Steht auf dem Beleg zusätzlich eine Zeile für die Autowäsche oder einen
  Kaffee, ist das eine eigene Zeile wie jede andere.
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

DATUM als "JJJJ-MM-TT", UHRZEIT als "HH:MM" (24 Stunden). Nicht lesbar -> null.

- WO ES STEHT: fast immer in der LETZTEN Zeile des Bons, unter dem Strichcode
  und hinter dem Wort "Datum" oder "Datum Uhrzeit". Nicht im Bonkopf, und
  NICHT in den langen Ziffernfolgen dazwischen — eine Beleg- oder
  Kundennummer sieht einem Datum zum Verwechseln ähnlich und ist keines.

- ZWEISTELLIGE JAHRESZAHLEN gehören ins 21. Jahrhundert:

      "23.06.17"  ->  2017-06-23
      "16.07.25"  ->  2025-07-16
      "04.08.26"  ->  2026-08-04

  Aus "25" wird 2025 und niemals 1925. Und die Zahl direkt vor der Uhrzeit ist
  das Jahr, nicht der Tag.

- BIST DU UNSICHER, gib null zurück. Ein falsches Datum ist teurer als gar
  keines: Der Einkauf landet dann im falschen Monat, und in der Auswertung
  sucht ihn dort niemand. Ein fehlendes Datum fragt die App beim Nutzer nach.

WÄHRUNG "waehrung" als Drei-Buchstaben-Code, zum Beispiel "EUR" oder "CHF".
- Das ist ebenfalls Abschreiben und kein Deuten: Du gibst zurück, welches
  Währungszeichen auf dem Bon GEDRUCKT steht — bei "CHF", "Fr." oder "SFr."
  also "CHF", bei "EUR" oder "€" also "EUR".
- Steht gar kein Zeichen da, ist die Antwort null. Schließe NICHT aus der
  Anschrift, der Sprache oder dem Ladennamen auf die Währung. Ein deutscher
  Bon ohne Zeichen ist der Normalfall, und dort ist null genau richtig.
- Die Beträge selbst bleiben unverändert, so wie sie gedruckt sind. Rechne
  nichts um — das macht die App.

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
  "waehrung": "EUR",
  "summe_cent": 655,
  "posten": 6,
  "unsichere_zeilen": [],
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
- "waehrung": nur, wenn ein Währungszeichen dasteht. Sonst null.
- "posten": die auf dem Bon gedruckte Postenzahl, sonst null. Nicht zählen.
- "unsichere_zeilen": die Nummern der Zeilen, die du nicht sicher lesen
  konntest, ab 0 gezählt. Warst du überall sicher: [].

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


/* ----------------------------------------------------------------------------
 * Deutsche Bonformate jenseits von Edeka und REWE (Schritt 18).
 *
 * Anlass waren zwei echte Bons, an denen die Erkennung gescheitert ist: ein
 * Edeka-Bon mit 35 Positionen und ein toom-Baumarktbon. Der Baumarkt druckt
 * anders — Artikelnummer vorn, Menge davor statt darunter, Steuersatz als
 * Ziffer statt als Buchstabe. Nichts davon ist exotisch, es war nur nie
 * beschrieben.
 *
 * WICHTIG: Was hier steht, sind Anweisungen zum ABTIPPEN, nicht zum Umrechnen.
 * Das Zerlegen in Menge, Einzelpreis und Steuerkennzeichen macht `lines.ts` im
 * Code — mit Tests daneben. Diese Beispiele sollen nur dafür sorgen, dass die
 * Zeile vollständig und unverändert ankommt.
 * -------------------------------------------------------------------------- */

const STRUKTUR_FORMATE = `
BONFORMATE, DIE DIR BEGEGNEN — tippe sie alle unverändert ab.

MENGENZEILEN. Es gibt drei Schreibweisen, und alle drei bleiben, wie sie sind:

    a) Menge in einer eigenen Zeile darunter:
           SPRUEHSAHNE 30%
             2 Stk x   0,99          1,98 B

    b) Menge in derselben Zeile, VOR dem Namen (Baumärkte, Gartencenter):
           4250787606599 2,000 STK a 5,99 Calibrachoa-Mix    11,98  7

    c) Menge in derselben Zeile, NACH dem Namen (Edeka):
           BIO ALNA.D.BR      0,99 € x 2                      1,98 A

   Bei b) gehört die lange Zahl am Anfang zur Zeile und wird mitgetippt. Rechne
   NICHTS aus: Weder 2 × 5,99 noch 0,99 × 2. Die Zeilensumme steht schon da.

ZAHLEN. Sie bleiben in der Schreibweise des Bons:
- "1,98" bleibt "1,98". Kein Punkt statt Komma, keine Umrechnung in Cent.
- "1.234,56" bleibt "1.234,56". Der Punkt trennt die Tausender und gehört dazu.
- "2,000 STK" bleibt "2,000 STK", auch wenn zwei Stück gemeint sind.

DAS ZEICHEN AM ZEILENENDE IST DER STEUERSATZ, NIE EIN PREIS.
- Als Buchstabe: "A", "B", seltener "AW" (Edeka, REWE, Lidl).
- Als ZIFFER: "7" oder "19" (toom, Bauhaus, OBI, viele Fachmärkte).

      Klett für Fenste     14,99 19
                                 └── Steuersatz 19 %, NICHT Teil von 14,99

  Die Ziffer gehört mit in die Zeile, genau wie der Buchstabe. Häng sie nicht
  an den Betrag an und lass sie nicht weg.
`.trim()

const STRUKTUR_NICHT_ARTIKEL = `
ZEILEN, DIE KEINE ARTIKEL SIND.

Der Artikelbereich endet bei der Summenzeile. Alles danach gehört NICHT in
"zeilen" — auch dann nicht, wenn ein Betrag darauf steht:

    SUMME              120,67          <- nein
    GEGEBEN            150,00          <- nein
    Rückgeld            29,33          <- nein
    Netto-Entgelt       23,76          <- nein
    MwSt-Betrag          4,51          <- nein
    Mastercard          87,75          <- nein
    PAYBACK Punkte         60          <- nein
    Posten: 35                         <- nein, aber siehe "posten" unten

Diese Zeilen fassen zusammen, was oben schon steht. Kämen sie mit, stünde
derselbe Betrag zweimal in der Rechnung.

ZWEI AUSNAHMEN, die sehr wohl dazugehören, weil sie Teil des Einkaufs sind:

    PFAND               0,15           <- JA, mit abtippen
    RABATT             -0,50           <- JA, mit abtippen

Steht auf dem Bon eine Postenzahl ("Posten: 35", "Artikel: 12", "35 Posten"),
gib die Zahl im Feld "posten" zurück. Nicht selbst zählen — nur abschreiben,
was dasteht. Steht keine da: null.
`.trim()

const STRUKTUR_UNSICHER = `
WAS DU NICHT ENTZIFFERN KANNST.

Thermopapier verblasst, Bons knicken, Fotos sind unscharf. Es ist normal, dass
ein paar Zeichen nicht lesbar sind — und es ist völlig in Ordnung, das zu sagen.

- Tippe die Zeile trotzdem ab, so gut es geht. Eine halbe Zeile ist mehr wert
  als keine.
- Ist ein BETRAG nicht sicher lesbar, rate ihn NICHT. Schreib die Zeile ohne
  ihn. Ein erfundener Preis ist der teuerste Fehler, den du machen kannst: Er
  sieht richtig aus und fällt niemandem auf.
- Merk dir die Nummern der Zeilen, bei denen du unsicher warst — die Zählung
  beginnt bei 0 — und gib sie in "unsichere_zeilen" zurück.

      "zeilen": ["MILCH 1,29 B", "BR0T ?,49 A", "BUTTER 2,29 A"]
      "unsichere_zeilen": [1]

  Die App umrandet diese Zeilen dann farbig und bittet den Nutzer, sie zu
  prüfen. Das ist genau richtig so — du sollst nicht sicherer wirken, als du
  bist.

Gib KEINE Zahl zwischen 0 und 1 an und schätze keine Prozente. Zeig nur mit dem
Finger: unsicher oder nicht.
`.trim()

/**
 * Dasselbe Schema noch einmal — diesmal für die Schnittstelle statt für das
 * Modell.
 *
 * ---------------------------------------------------------------------------
 * WARUM ZWEIMAL?
 * ---------------------------------------------------------------------------
 *
 * Der Text oben (`STRUKTUR_SCHEMA`) **bittet** um eine Form. Dieses Schema
 * **erzwingt** sie: Mistral nimmt es als `response_format: json_schema` entgegen
 * und lässt das Modell gar nichts anderes erzeugen. Damit fällt die häufigste
 * Fehlerquelle weg — Fließtext um das JSON herum, Markdown-Zäune, erfundene
 * Zusatzfelder.
 *
 * Der Text bleibt trotzdem stehen, aus zwei Gründen: Nicht jedes Modell kennt
 * den Modus (dann steigt `mistral.ts` auf `json_object` herab, und die Form muss
 * wieder der Prompt durchsetzen), und das Schema kann nur die *Form* erzwingen,
 * nicht die Regeln. Dass eine gedruckte Zeile ein Eintrag ist, steht in keinem
 * JSON-Schema der Welt.
 *
 * **Wer hier etwas ändert, ändert es oben mit.** Zwei Beschreibungen derselben
 * Antwort sind zwei Stellen, die auseinanderlaufen können.
 */
export const STRUCTURE_JSON_SCHEMA = {
  name: 'kassenzettel',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'lesbar',
      'haendler',
      'datum',
      'uhrzeit',
      'waehrung',
      'summe_cent',
      'steuerblock',
      'zeilen',
    ],
    properties: {
      lesbar: { type: 'boolean' },
      // Überall `['string', 'null']` statt `string`: „nicht lesbar" ist ein
      // gültiges Ergebnis und muss ausdrückbar bleiben, sonst rät das Modell.
      haendler: { type: ['string', 'null'] },
      datum: { type: ['string', 'null'] },
      uhrzeit: { type: ['string', 'null'] },
      waehrung: { type: ['string', 'null'] },
      summe_cent: { type: ['integer', 'null'] },
      /** Die Postenzahl vom Bonfuß, für den Abgleich in `validate.ts`. */
      posten: { type: ['integer', 'null'] },
      steuerblock: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kennzeichen', 'brutto_cent'],
          properties: {
            kennzeichen: { type: 'string' },
            brutto_cent: { type: 'integer' },
          },
        },
      },
      zeilen: { type: 'array', items: { type: 'string' } },
      /**
       * Die Nummern der Zeilen, bei denen das Modell sich nicht sicher war —
       * 0-basiert, bezogen auf `zeilen`.
       *
       * Bewusst eine Liste von Nummern und **keine** Konfidenz je Zeile: Eine
       * Zahl zwischen 0 und 1 je Zeile wäre eine zusätzliche Schätzaufgabe für
       * jede einzelne Zeile, und genau solche Nebenaufgaben haben das
       * Abschreiben schon zweimal verdorben (siehe Kopf dieser Datei). „Zeig
       * mit dem Finger auf das, was du nicht entziffern konntest" ist eine
       * Aufgabe, keine fünfzig. Die eigentliche Konfidenz rechnet `lines.ts`
       * daraus und aus der Lesbarkeit der Zeile selbst.
       */
      unsichere_zeilen: { type: 'array', items: { type: 'integer' } },
    },
  },
} as const

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
  STRUKTUR_FORMATE,
  STRUKTUR_NICHT_ARTIKEL,
  STRUKTUR_TANKBELEG,
  STRUKTUR_ZAHLENFORMAT,
  STRUKTUR_UNSICHER,
  STRUKTUR_SCHEMA,
].join('\n\n---\n\n')

/** Die kurze Aufforderung, die zusammen mit dem Bild geschickt wird. */
export const STRUCTURE_USER_PROMPT =
  'Tippe die Zeilen dieses Kassenzettels ab und gib das JSON-Objekt nach dem ' +
  'beschriebenen Schema zurück. Eine gedruckte Zeile ist ein Eintrag in „zeilen". ' +
  'Antworte ausschließlich mit dem JSON-Objekt.'

/**
 * Dieselbe Aufforderung, wenn der Bon in Kacheln zerlegt ankommt.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES DIESEN ZWEITEN TEXT BRAUCHT
 * ---------------------------------------------------------------------------
 *
 * Ein Bon mit vierzig Positionen ist bei 2000 px langer Kante so weit
 * herunterskaliert, dass eine Textzeile fünf bis sieben Pixel hoch ist. Das ist
 * an der Grenze des Lesbaren, und genau dort fängt ein Modell an zu raten oder
 * sich zu wiederholen. Deshalb wird ein sehr langer Bon im Browser in zwei bis
 * drei senkrecht überlappende Ausschnitte geschnitten — jeder für sich mit
 * voller Auflösung.
 *
 * Sie gehen **zusammen in einem Aufruf** hin. Der Preis dafür ist dieser Text:
 * Das Modell muss wissen, dass es denselben Bon dreimal sieht, sonst tippt es
 * die Überlappung doppelt ab und jeder Betrag darin zählt zweimal.
 *
 * **Die Überlappung ist Absicht und kein Fehler.** Ohne sie könnte eine Zeile
 * genau auf der Schnittkante liegen und in beiden Kacheln nur halb zu sehen
 * sein — dann fehlt sie ganz. Mit 15 % Überlappung ist jede Zeile in
 * mindestens einer Kachel vollständig.
 */
export const STRUCTURE_TILED_USER_PROMPT = `
Du bekommst MEHRERE Bilder. Es ist EIN EINZIGER Kassenzettel, der für dich in
überlappende Ausschnitte zerschnitten wurde — von oben nach unten, in dieser
Reihenfolge.

So gehst du damit um:

1. Lies die Ausschnitte der Reihe nach, von oben nach unten.
2. Die Ausschnitte ÜBERLAPPEN sich am Rand. Die letzten Zeilen eines
   Ausschnitts sind dieselben wie die ersten des nächsten. Das ist Absicht.
3. Schreibe jede gedruckte Zeile GENAU EINMAL in "zeilen". Eine Zeile, die du
   in zwei Ausschnitten siehst, ist EINE Zeile — nicht zwei.
4. Woran du eine Wiederholung erkennst: gleicher Text UND gleicher Betrag.
   Zwei Zeilen mit gleichem Text, aber verschiedenem Betrag sind zwei
   verschiedene Zeilen und gehören beide hinein.
5. Kopf (Händler, Datum) steht im ersten Ausschnitt, Summe und Steuerblock im
   letzten. Nimm sie von dort.

Ansonsten gilt alles wie sonst: Eine gedruckte Zeile ist ein Eintrag in
„zeilen", wörtlich abgetippt. Antworte ausschließlich mit dem JSON-Objekt.
`.trim()

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
