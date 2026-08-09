# Receipt AI – Projektentscheidungen

Diese Datei ist das Gedächtnis des Projekts. Sie beschreibt, was entschieden wurde und warum.
Bei Unsicherheit über eine Architekturfrage: erst hier nachsehen, dann fragen – nicht raten.

*Version 4 – ersetzt die vorherigen Fassungen. Geändert gegenüber v2: Die vier festen
Gesundheits-Flags werden durch ein erweiterbares, vom Nutzer konfigurierbares
Merkmalssystem ersetzt. Milchprodukte bekommen eigene Sachattribute. Gegenüber v3
präzisiert: die Gruppenregel gegen doppelte Score-Zählung.*

## Was die App ist

Eine private PWA für iPhone (Safari, zum Home-Bildschirm hinzugefügt). Deutsche UI.
Kassenzettel fotografieren → Positionen erfassen → Lebensmittelausgaben auswerten.
Nutzerkreis: eine Familie, ca. 3 Personen. Keine Veröffentlichung, kein App Store, keine Fremdnutzer.

Referenzen im Repo:
- `design/project/Receipt AI.dc.html` – das verbindliche Design (11 Screens)
- Konzeptdokument und Design-Prompt des Nutzers

## Harte Rahmenbedingung: das Projekt muss kostenlos bleiben

Keine kostenpflichtigen Dienste, keine Kreditkarte, keine laufenden Kosten. Jede
vorgeschlagene Bibliothek und jeder Dienst muss in einem dauerhaft kostenlosen Kontingent
laufen.

| Baustein | Dienst | Kosten |
|---|---|---|
| Hosting | Vercel Hobby | 0 € |
| Datenbank, Auth, Storage, Edge Functions | Supabase Free | 0 € |
| Bon-Erkennung | Mistral La Plateforme, freier Experiment-Tarif | 0 € |
| Auswertungslogik | eigener Code | 0 € |

## Kernprinzip: KI erkennt einmal, die Datenbank merkt sich das Ergebnis

Ein Vision-Modell wird für zwei Dinge gebraucht, und nur für diese:

1. **Bild → strukturierte Bon-Daten**: Händler, Datum, Positionen mit Rohtext, Menge,
   Einzelpreis, Gesamtpreis, Rabatte, Pfand, Bon-Total.
2. **Unbekannter Rohtext → Klarname, Kategorie, Merkmale**: `G&G H-MILCH 1,5%` wird zu
   `H-Milch 1,5 % Fett`, Kategorie `milchprodukte`, Merkmale `[milch]`,
   Milchattribute `{ erhitzung: 'uht' }`.

**Das Ergebnis von Schritt 2 wird dauerhaft gespeichert und nie neu erfragt.** Beim ersten
Auftreten eines Rohtexts entsteht ein Eintrag in `product_mappings` und ggf. ein neuer
Datensatz in `canonical_products`. Ab dann kommt die Zuordnung aus der eigenen Datenbank.
Nutzerkorrekturen überschreiben die Modell-Antwort und gelten ebenfalls dauerhaft.

**Was ausdrücklich KEIN Modell braucht** – hier bitte keine LLM-Aufrufe einbauen:

- Kategorie- und Merkmalszuordnung bei bereits bekannten Produkten → Datenbank
- Health-Score-Berechnung → Formel
- Summen-Abgleich Positionen vs. Bon-Total → Addition
- Bestpreis pro Produkt und Händler → SQL
- Preisverlauf, Ausgabentrend, Top-10, häufigste Käufe → SQL
- Sparpotenzial-Hinweise → SQL-Vergleich gegen historische Bestpreise
- Monats-Hochrechnung → Dreisatz

## Merkmalssystem (ersetzt die früheren „Health-Flags")

### Grundgedanke

Merkmale sind **Daten, nicht Code**. Der Nutzer legt selbst fest, worauf er achten will.
Es gibt daher **keinen** TypeScript-Union-Typ und **kein** Postgres-Enum für Merkmale.
Stattdessen eine Tabelle `traits`, pro Haushalt.

Ein Merkmal ist nicht zwingend etwas Schlechtes. `Milch` ist neutral und wird nur
beobachtet; `Industriezucker` ist negativ gewichtet. Deshalb hat jedes Merkmal ein
Gewicht, das der Nutzer einstellen kann.

### Felder eines Merkmals

| Feld | Bedeutung |
|---|---|
| `key` | stabiler Schlüssel, z. B. `industriezucker` |
| `label` | Anzeigename, z. B. „Industriezucker" |
| `short` | 1–2 Zeichen für das Badge in der Positionsliste, z. B. `Z` |
| `description` | Kurze Erklärung. **Geht als Anweisung an das Modell.** |
| `weight` | Gewicht im Score, −10 bis +10, Standard negativ |
| `group` | optional, für Überlappungen (siehe unten) |
| `active` | ein/aus, ohne Datenverlust |
| `is_default` | mitgeliefertes Merkmal oder selbst angelegt |

### Mitgelieferte Merkmale

Diese werden beim Anlegen eines Haushalts erzeugt und sind vom Nutzer änderbar oder
abschaltbar:

| key | label | short | Gruppe | Gewicht |
|---|---|---|---|---|
| `verarbeitet` | Hochverarbeitet | V | – | −3 |
| `industriezucker` | Industriezucker | Z | – | −3 |
| `samenoel` | Samenöl | Ö | fette | −3 |
| `pflanzenfett` | Pflanzliches Fett | P | fette | −2 |
| `gluten` | Gluten | G | getreide | −2 |
| `weizen` | Weizen | W | getreide | −3 |
| `milch` | Milch | M | milch_basis | 0 (neutral) |
| `zusatzstoffe` | Zusatzstoffe | E | – | −2, standardmäßig aus |

Weitere Merkmale legt der Nutzer in den Einstellungen selbst an (z. B. Palmöl, Soja,
Fruktosesirup, Bio).

### Überlappende Merkmale – Gruppenregel

`Weizen` ist fast immer auch `Gluten`; `Samenöl` ist auch ein `Pflanzliches Fett`;
`H-Milch` ist auch `Milch`. Als **Etiketten** dürfen alle zutreffenden Merkmale am Produkt
hängen – das ist gewollt, denn für die Ausgabenauswertung („wie viel gebe ich für Gluten
aus") müssen alle zählen.

**Im Score dagegen zählt pro Gruppe nur ein Merkmal.** Sonst würde dasselbe Produkt für
denselben Sachverhalt mehrfach bewertet.

**Auswahlregel, verbindlich:** Innerhalb einer Gruppe gewinnt das Merkmal mit dem
**größten Betrag** (`Math.abs(weight)`). Bei gleichem Betrag gewinnt das negativere.
Merkmale ohne `group` zählen immer einzeln.

Der Betrag – nicht der kleinste Wert – ist entscheidend, weil es auch positive Gewichte
gibt: Rohmilch (+2) soll gutschreiben und nicht vom neutralen `milch` (0) verdrängt werden.

**Kontrollbeispiele – diese müssen in Tests abgedeckt sein:**

| Produkt | Merkmale am Produkt | Im Score gezählt |
|---|---|---|
| Sauerteigbrot | `gluten` −2, `weizen` −3 (Gruppe `getreide`) | −3 |
| Tiefkühlpizza | `verarbeitet` −3, `samenoel` −3, `pflanzenfett` −2, `weizen` −3, `gluten` −2 | −3 (verarbeitet) −3 (fette) −3 (getreide) = −9 |
| Rohmilch, nicht homogenisiert | `milch` 0, `roh` +2 (Gruppe `milch_basis`) | +2 |
| H-Milch, homogenisiert | `milch` 0, `uht` −2 (Gruppe `milch_basis`), `homogenisiert` −1 (keine Gruppe) | −3 |

Die Gruppenzuordnung ist ein änderbares Feld am Merkmal, kein fest verdrahtetes Verhalten.
Der Nutzer kann sie in den Einstellungen anpassen.

**Voreingestellte Gruppen:** `getreide` (gluten, weizen), `fette` (samenoel, pflanzenfett),
`milch_basis` (milch, roh, pasteurisiert, esl, uht). Alle übrigen Merkmale sind
gruppenlos.

### Health-Score

Der Score ist eine Formel im Code, kein Modell-Urteil. Er wird aus den Merkmalen und ihren
Gewichten berechnet, gewichtet nach dem **Euro-Anteil** der betroffenen Positionen – nicht
nach ihrer Anzahl. Grund: Ein 12-Euro-Fertiggericht soll stärker durchschlagen als ein
Päckchen Toastbrötchen für 1,49 €.

Ändert der Nutzer ein Gewicht, werden die Scores **rückwirkend** neu berechnet, damit die
Verlaufskurve im Gesundheits-Screen konsistent bleibt.

### Auswirkung auf die UI

Das Design zeigt vier feste Badge-Buchstaben und genau drei „Kritische Ausgaben"-Karten.
Beides muss jetzt variabel sein:

- **Badges in Positionslisten:** maximal drei anzeigen, Rest als `+2`. Sonst reißt die Zeile.
- **Karten „Kritische Ausgaben":** alle aktiven Merkmale mit Gewicht < 0 und Ausgaben > 0,
  absteigend nach Eurobetrag, sichtbar die ersten fünf, darunter „Alle anzeigen".
  Merkmale mit Gewicht 0 (z. B. Milch) erscheinen in einem eigenen, neutral gestalteten
  Abschnitt „Beobachtet", nicht unter „Kritisch".
- **Legende** unter der Positionsliste wird aus den aktiven Merkmalen erzeugt, nicht fest
  verdrahtet.
- **Neuer Bereich in den Einstellungen:** Merkmale anlegen, umbenennen, gewichten,
  aktivieren/deaktivieren. Der Alternativ-Tipp pro Merkmal („Statt Sonnenblumenöl: Butter,
  Ghee oder Olivenöl") ist ebenfalls ein Feld am Merkmal und vom Nutzer editierbar.

### Auswirkung auf den KI-Prompt

Der Prompt an das Modell wird **zur Laufzeit aus den aktiven Merkmalen des Haushalts
zusammengesetzt**: je Merkmal `key` plus `description`. Das Modell gibt nur Schlüssel aus
dieser Liste zurück. Legt der Nutzer ein neues Merkmal an, wirkt es ab dem nächsten Scan,
ohne Codeänderung. Merkmalsschlüssel, die nicht in der Liste stehen, werden verworfen.

## Milchprodukte: eigene Sachattribute

Zusätzlich zum Merkmal `milch` bekommt jedes kanonische Produkt der Kategorie
`milchprodukte` zwei **unabhängige** Attribute. Bewusst zwei Felder und nicht eine Liste,
weil eine Milch gleichzeitig pasteurisiert und homogenisiert sein kann.

**`milk_heat`** – `roh` · `pasteurisiert` · `esl` · `uht` · `unbekannt`
**`milk_homogenized`** – `ja` · `nein` · `unbekannt`

Optional ergänzend: `milk_origin` – `weide` · `bio` · `konventionell` · `unbekannt`.

**Was das Modell realistisch erkennen kann:** `milk_heat` lässt sich aus dem Bontext meist
ableiten (`H-MILCH` → `uht`, `FRISCHMILCH` → `pasteurisiert` oder `esl`, `ROHMILCH` → `roh`).
`milk_homogenized` steht auf einem Kassenzettel praktisch nie – dieses Feld bleibt in der
Regel `unbekannt`, bis der Nutzer es einmal am Produkt setzt. Danach gilt es dauerhaft.

**Nicht raten lassen.** Wenn das Modell unsicher ist, muss es `unbekannt` liefern. Ein
falsch geratenes Attribut ist schlimmer als ein leeres, weil der Nutzer den Zahlen dann
nicht mehr trauen kann. Das gehört ausdrücklich in den Prompt.

Die Attribute wirken über eigene Merkmale mit einstellbaren Gewichten: `roh` +2,
`pasteurisiert` 0, `esl` −1, `uht` −2 – alle vier in der Gruppe `milch_basis`, gemeinsam
mit dem Merkmal `milch` selbst. Damit zählt bei einer H-Milch nur `uht` und nicht
zusätzlich noch `milch`.

`homogenisiert` −1 steht bewusst **außerhalb** dieser Gruppe und zählt eigenständig, weil
Homogenisierung ein zusätzlicher Verarbeitungsschritt ist, der unabhängig vom Erhitzungs-
grad stattfindet. Wer das anders möchte, kann das Merkmal in den Einstellungen der Gruppe
`milch_basis` zuordnen.

`unbekannt` erzeugt kein Merkmal und zählt damit neutral, nie negativ.

Im Gesundheits-Screen entsteht daraus eine Karte „Milch", die zeigt, wie sich die Ausgaben
auf Rohmilch, pasteurisiert, ESL und H-Milch verteilen.

## Anbieter: Mistral

- Endpunkt `https://api.mistral.ai/v1`, OpenAI-kompatibles Format
- Vision-fähiges Modell (Pixtral-Familie) für den Bild-Schritt
- Freier Experiment-Tarif, keine Kreditkarte, Telefonverifizierung nötig
- Rate ca. 1 Anfrage pro Sekunde; 429-Antworten mit Backoff behandeln
- EU-Datenhaltung (Frankreich). Deshalb Mistral und nicht Google: Googles Zusatz-
  bedingungen verlangen für API-Clients mit Nutzern in EWR/CH/UK die kostenpflichtigen
  Dienste, und der Nutzer sitzt in der Schweiz.
- Auf dem freien Tarif können Daten zur Modellverbesserung genutzt werden. Dem Nutzer
  bekannt und akzeptiert.

**Der API-Schlüssel liegt in einer Supabase Edge Function, niemals im Client.**

## Kamera – ausdrückliche Anforderung des Nutzers

Beim Tippen auf den Scan-Button muss die Aufnahme **innerhalb der App** passieren. Kein
Wechsel in die Fotos-App, kein manuelles Auswählen aus der Galerie.

**Primärweg:** `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
mit `<video>`-Livebild im Scan-Screen, darüber die Rahmen-Hilfe aus dem Design. Auslösen
zeichnet auf ein `<canvas>` und erzeugt ein JPEG.

**Automatischer Fallback:** Ist `getUserMedia` nicht verfügbar oder wird die Berechtigung
verweigert, wird ein verstecktes `<input type="file" accept="image/*" capture="environment">`
ausgelöst. Das öffnet die iOS-Kamera als Overlay über der App – auch hier kein Umweg über
die Galerie.

Bekannte iOS-Eigenheit: Installierte PWAs fragen die Kameraberechtigung teils bei jedem
Start neu ab. Kein Fehler in unserem Code; der Fallback fängt Verweigerung ab.

**Zusätzlich:** unauffälliger Sekundärweg „Aus Galerie wählen" (dasselbe Input ohne `capture`).
Er sitzt auf dem Nebenknopf links neben dem Auslöser, wo im Entwurf „Upload" stand.

**Vor dem Upload wird das Bild verkleinert:** lange Kante max. 2000 px, JPEG-Qualität ca. 0,8.
Bons sind schmal und lang, deshalb nicht quadratisch zuschneiden. Die Ausrichtung aus den
EXIF-Daten muss dabei greifen, sonst liegen iPhone-Fotos quer.

### Ergänzt mit Schritt 4a

**Vorschau statt Blindflug.** Anders als oben ursprünglich festgehalten geht es nach dem
Auslösen *nicht* ohne Zwischenschritt weiter. Der Screen zeigt erst das Foto mit
„Verwenden" und „Neu aufnehmen". Grund: Ein unscharfer Bon soll gar nicht erst in die
Erkennung laufen – jede Anfrage an das Modell zählt gegen das freie Kontingent, und ein
falsch gelesener Bon kostet später Handarbeit im Korrektur-Screen.

**Wie EXIF ausgewertet wird – ohne Bibliothek.** Die Datei wird in ein `<img>` geladen und
von dort auf das Canvas gezeichnet. Browser drehen ein `<img>` seit `image-orientation:
from-image` (Voreinstellung ab Safari 13.4) von sich aus richtig herum, und
`naturalWidth/naturalHeight` melden bereits die gedrehten Maße. Wer die Datei stattdessen
selbst dekodiert, müsste den EXIF-Block von Hand auswerten – dafür bräuchte es eine
zusätzliche Abhängigkeit. Aus dem Livebild kommt ohnehin ein bereits aufrechtes Bild.

**Der Kamerastrom wird an drei Stellen beendet:** beim Verlassen des Screens (das deckt auch
das Zurückwischen ab, weil React den Screen dabei abbaut), beim Wechsel in den Hintergrund
(`visibilitychange`) und bei `pagehide`. Sonst leuchtet die Kamera-Anzeige weiter und der
Akku leidet. Beim Zurückkommen aus dem Hintergrund läuft der Strom wieder an.

**Während der Vorschau bleibt der Strom absichtlich aktiv.** „Neu aufnehmen" soll nicht
jedes Mal einen neuen Berechtigungsdialog auslösen.

**Wo das Bild liegt:** `src/lib/camera.ts` macht die Bildarbeit, `src/lib/capture.ts` reicht
das Ergebnis an den Verarbeitungs-Screen weiter – eine Variable im Speicher, weil ein `Blob`
weder in die Adresse noch in den Verlaufszustand des Routers passt. Bewusst kein
`localStorage`: Das Bild soll ein Neuladen nicht überleben.

### Nachgebessert nach dem ersten iPhone-Test

**An `getUserMedia` darf immer nur EINE Kante vorgegeben werden.** Der erste Anlauf bat um
`width: { ideal: 2000 }` *und* `height: { ideal: 2000 }`. Zwei Vorgaben zusammen sind für den
Browser ein Seitenverhältnis, und er darf das Sensorbild dafür beschneiden: Auf dem iPhone kam
ein quadratischer Strom von 2000 × 2000 heraus, bei dem der untere Teil des Bons – und damit
die Gesamtsumme für den Summen-Abgleich – schon fehlte, bevor das Canvas ihn zu sehen bekam.
Der Canvas-Code war die ganze Zeit richtig.

Vorgegeben wird jetzt nur `height: { ideal: 1920 }`, weil die App hochkant benutzt wird und
der Bon die lange Kante füllt. Höher wäre sinnlos: Was über 2000 px liegt, rechnet `MAX_EDGE`
ohnehin wieder weg, es kostet nur Akku und macht die Vorschau träge.

**Der Rahmen folgt dem Kameraformat, nicht umgekehrt.** Er bekommt sein Seitenverhältnis zur
Laufzeit aus `videoWidth/videoHeight`, das Livebild steht auf `object-fit: contain`. Der
Nutzer sieht damit genau den Bereich, der aufgenommen wird. Die Alternative – Rahmen fest,
Bild mit `cover` beschnitten – wurde verworfen: Wer nicht sieht, was aufgenommen wird, richtet
den Bon falsch aus, und der Fehler fällt erst auf dem fertigen Foto auf.

**Zu erwartende Maße:** hochkant 1080 × 1920 oder 1440 × 1920, je nachdem welches Format die
Kamera meldet – beides unter der langen Kante von 2000, es wird also gar nicht verkleinert.
Nur eine 4K-Kamera (2160 × 3840) landet bei 1125 × 2000. Ein quadratisches Ergebnis ist ab
jetzt immer ein Fehler. Der Verarbeitungs-Screen zeigt deshalb `Quelle → Ergebnis`, sobald
verkleinert wurde, und sonst nur eine Zahl.

**Keine Taschenlampe auf iOS.** Der Blitz-Knopf aus dem Entwurf versucht, die Lampe über
`track.applyConstraints({ advanced: [{ torch: true }] })` zu schalten, und erscheint nur, wenn
`track.getCapabilities().torch` sie meldet. WebKit meldet sie nicht und übergeht die Vorgabe
([WebKit-Bug 243075](https://bugs.webkit.org/show_bug.cgi?id=243075)); weil auf iOS auch jeder
andere Browser WebKit benutzt, gilt das dort für alle. Auf dem iPhone verschwindet der Knopf
deshalb, und der Auslöser rückt in die Mitte. Kann Safari es eines Tages, erscheint er von
selbst – geprüft wird zur Laufzeit, nicht anhand des Browsernamens.

**Keine Scan-Linie.** Die waagerechte Linie in der Bildmitte ist ersatzlos entfernt. Sie sah
nach Analyse aus, aber das Livebild wird nirgends ausgewertet – erkannt wird erst in 4b, und
zwar auf dem Server. Die vier grünen Ecken bleiben, die helfen wirklich beim Ausrichten.
Grundsatz: Solange nichts analysiert wird, deutet die Oberfläche das auch nicht an.

## Notfallweg ohne Kamera

„Bon-Text einfügen": Der Nutzer kopiert den Text per iOS Live Text aus einem Foto und fügt
ihn in ein Textfeld ein. Dieser Text geht an dieselbe Verarbeitung, nur ohne Bild. Als
unauffälliger Link auf dem Kamera-Screen.

## Verarbeitungs-Ablauf eines Scans

1. Foto aufnehmen, verkleinern
2. Upload an die eigene Edge Function
3. Edge Function baut den Prompt aus den aktiven Merkmalen des Haushalts und ruft Mistral.
   Verlangt wird **striktes JSON in einem festen Schema**, kein Freitext.
4. **Validierung im Backend, nicht im Modell**: Schema korrekt? Preise plausibel? Ergibt die
   Summe der Positionen das Bon-Total? Merkmalsschlüssel bekannt? Bei Abweichung wird der
   Bon markiert, nicht abgelehnt – der Korrektur-Screen zeigt die Warnung (im Design
   vorhanden, Beispiel 0,19 € Abweichung).
5. Bekannte Rohtexte gegen `product_mappings` auflösen; nur unbekannte Artikel behalten die
   Modell-Vorschläge.
6. Korrektur-Screen, Nutzer bestätigt oder korrigiert
7. Speichern; Korrekturen fließen in `product_mappings` und `canonical_products` zurück

Schritte 5 und 7 sind seit 4b-2 umgesetzt; die Details stehen weiter unten.

Die Modellantwort wird **nie ungeprüft gespeichert.**

### Ergänzt mit Schritt 4b-1 (Erkennung, noch ohne Speichern)

**Schritt 4b wurde geteilt.** 4b-1 ist die Erkennung bis zum Korrektur-Screen,
4b-2 das Speichern. Grund: Der Prompt sitzt beim ersten Mal nicht. Solange nichts
geschrieben wird, lässt sich beliebig oft testen, ohne hinterher in der Datenbank
aufzuräumen. Die Punkte 5 und 7 der Liste oben (`product_mappings` auflösen,
zurückschreiben) sind deshalb noch offen.

**Wo was liegt:** `supabase/functions/erkennen/`. Die Aufteilung ist Absicht —
`prompt.ts` ist die eine Datei, an der ohne Codeverständnis nachgeschärft wird;
`index.ts` (Ablauf), `mistral.ts` (Netz) und `validate.ts` (Prüfung samt der
Typen, die sie erzeugt) bleiben davon unberührt. Mit 4b-2 kam `mappings.ts` dazu
(das Gedächtnis), mit 4c `assign.ts` (die Prüfung des zweiten Durchgangs), mit 4d `lines.ts`
(die Aufteilung der abgetippten Zeilen in Positionen) und mit 5b `rates.ts`
(der EZB-Kurs samt Zwischenspeicher).
Anleitung: `supabase/functions/README.md`.

**Ausgerollt wird über GitHub Actions**, nicht von Hand
(`.github/workflows/edge-functions.yml`). Jede Änderung unter
`supabase/functions/` auf `main` rollt die Funktion neu aus, nachdem `npm test`
durchgelaufen ist. Grund: Der Prompt wird noch oft nachgeschärft, und Kopieren
von Hand wäre bei jedem Mal eine Fehlerquelle. Eine eigene Datei nur für Typen
gibt es deshalb auch nicht mehr — der Editor in der Supabase-Oberfläche legte
sie nicht an, weil zur Laufzeit nichts von ihr übrig bleibt.

**Die Funktion arbeitet mit dem Token des Nutzers, nicht mit einem
Dienstschlüssel.** Sie prüft die Anmeldung als Allererstes — sonst könnte jeder
Fremde das freie Kontingent verbrennen — und liest Merkmale und Kategorien unter
denselben Zugriffsregeln wie die App. Auf einen fremden Haushalt kann sie damit
gar nicht sehen; das verhindert die Datenbank und nicht der Code.

**Der Prompt entsteht bei jedem Aufruf neu** aus den *aktiven* Merkmalen des
Haushalts (`key` plus `description`) und den Kategorien. Ein neues Merkmal wirkt
ab dem nächsten Scan, ohne Ausrollen. Merkmalsschlüssel, die das Modell erfindet,
werden verworfen; dasselbe gilt für unbekannte Kategorien, die dann als „offen"
stehen bleiben statt geraten zu werden. *Seit 4c gilt das für den
Zuordnungs-Prompt; geprüft wird in `assign.ts`. Der Struktur-Prompt ist eine
Konstante und kennt die Merkmale nicht.*

**Umgerechnet wird im Code, nicht im Modell.** Verlangt sind ganze Cent und ganze
Basiseinheiten. Kommt etwas anderes an, rechnet `validate.ts` um — und zwar nur,
wo es belegbar ist: Eine Kommazahl kann keine Cent-Angabe sein, also war Euro
gemeint. Eine Menge in der falschen Einheit wird nur dann umgestellt, wenn
Menge × Einzelpreis mit der einen Lesart die gedruckte Zeilensumme ergibt und mit
der anderen nicht. Geht keine Lesart auf, bleibt der Wert stehen und die Zeile
bekommt eine Warnung. **Raten ist auch dem Code verboten.**

**Markieren statt ablehnen.** Abweichende Summe, unlesbarer Betrag, verworfenes
Merkmal: alles wird zur Warnung, der Bon kommt trotzdem durch. Zurückgewiesen
wird nur, was gar nicht lesbar ist — dann sagt das Modell selbst `lesbar: false`.

**Die Rohantwort ist einsehbar**, als Aufklappbereich unten im Korrektur-Screen.
Ohne sie lässt sich nicht sehen, *warum* eine Zeile falsch gelesen wurde, und
damit auch der Prompt nicht nachschärfen. Sie wird nirgends gespeichert. *Seit
4c stehen dort zwei Antworten untereinander, eine je Durchgang — daran ist
abzulesen, welcher der beiden Prompts nachzuschärfen ist.*

**Eine Mengenzeile gehört zur Position darüber.** Nach dem ersten echten Scan
aufgefallen: Auf einem REWE-Bon steht die Mengenzeile eingerückt *unter* dem
Artikelnamen, und das Modell hängte den Einzelpreis daraus an die *folgende*
Position — die Vanilleschokolade bekam 0,99 € statt 1,99 €. Der Prompt sagt die
Regel jetzt ausdrücklich, mit genau diesem Beispiel.

Verlassen wird sich darauf nicht: `checkUnitPrice` in `validate.ts` rechnet
gegen. Mit Menge muss Menge × Einzelpreis die Zeilensumme ergeben, ohne Menge
*ist* der Einzelpreis die Zeilensumme. Geht es nicht auf, wird der **Einzelpreis
verworfen** und die Zeile markiert. Verworfen wird er und nicht Menge oder
Betrag, weil er der unsicherste der drei Werte ist und sich als einziger aus den
beiden anderen zurückrechnen lässt. Welcher Wert tatsächlich falsch war, weiß
der Code nicht — und rät deshalb auch nicht.

**Eine Zeile mit eigenem Preis ist eine eigene Position.** Der zweite Fund aus
demselben Bon: „VANILLE 1,99 B" und „MILCHSCHOKOSTR 0,99 B" sind zwei Artikel,
das Modell machte daraus „Vanille-Milchschokolade" für 1,99 € und verlor 0,99 €.
Die Regel im Prompt lautet jetzt: Was zusammengehört, entscheidet allein der
Preis am Zeilenende, nie die Bedeutung der Wörter. Ein umbrochener Artikelname
ist daran zu erkennen, dass nur eine der beiden Zeilen einen Preis trägt.

**Abgleich je Steuerklasse statt nur über die Gesamtsumme.** Deutsche Bons
drucken am Fuß eine Aufstellung je Steuersatz, und dieselben Kennzeichen stehen
an jeder Position. Beides wird jetzt miterfasst (`steuerblock` je Bon, `steuer`
je Position), und `checkTaxGroups` rechnet die Positionen je Klasse gegen den
gedruckten Bruttobetrag.

Das ist die schärfere Probe: Der Gesamtabgleich sagt nur, *dass* etwas fehlt,
dieser sagt *wo*. Im Fall oben stimmte Klasse A, und in Klasse B fehlten genau
0,99 € — die Zeile zum Nachsehen ist damit eingegrenzt.

Zwei Tore davor, damit die Probe nicht selbst Unsinn meldet: Ergeben die
Bruttobeträge zusammen nicht die gedruckte Summe, wurde der Block falsch gelesen
und taugt nicht als Maßstab. Und fehlt auch nur einer Position ihr Kennzeichen,
wäre eine Klasse zwangsläufig zu niedrig — dann entfällt der Abgleich, statt
Warnungen zu erzeugen, die nur ein nicht gelesenes Kennzeichen bedeuten. In
beiden Fällen bleibt es beim Gesamtabgleich.

*Mit 4b-2 entschieden:* `receipt_items` bekommt die Spalte `tax_code`. Das
Kennzeichen ist eine Tatsache vom Bon, kostet zwei Zeichen und wäre später nie
zu rekonstruieren — das Foto ist dann längst weg.

**Ein ungewöhnliches Bon-Datum ist ein Hinweis, kein Fehler.** Liegt das Datum
mehr als 60 Tage zurück oder in der Zukunft, sagt der Korrektur-Screen in
neutralem Ton, zu welchem Monat der Einkauf dann zählt. Nichts wird
überschrieben, nichts blockiert, nichts rot eingefärbt: Ein Bon von 2017 ist
richtig gelesen und nicht falsch — beim Testen mit Bons aus dem Internet ist das
der Normalfall. Gerechnet wird gegen die Uhr des Geräts, weil der Hinweis reine
Anzeige ist.

Das Bon-Datum ist deshalb auch der einzige Wert, der in 4b-1 schon geändert
werden kann (`<input type="date">`, auf dem iPhone der Systemauswähler). Es
entscheidet, in welchen Monat der ganze Einkauf fällt; ein vertipptes Jahr
verschiebt alles. Alles andere bleibt bis 4b-2 reine Anzeige.

**Der Fortschrittsbalken schätzt — und sagt das durch sein Verhalten.** Wie weit
Mistral ist, meldet niemand: Die Schnittstelle antwortet einmal, einen
Zwischenstand gibt es nicht. Der Balken auf dem Verarbeitungs-Screen ist deshalb
eine Schätzung, gebunden an die drei beobachtbaren Abschnitte und nach deren
typischer Dauer gewichtet (0,8 s : 14 s : 0,7 s → rund 5 % : 90 % : 4 %).

Drei Regeln halten ihn ehrlich: Er läuft nie rückwärts, er wartet bei 95 %,
solange die Antwort aussteht, und er erreicht 100 % erst, wenn das Ergebnis
wirklich da ist. Ein Balken, der bei 100 % steht und trotzdem weiterlädt, wäre
schlimmer als gar keiner. Kommt die Antwort früher als geschätzt, springt er
zügig durch — das ist der einzige erlaubte Sprung.

Die Rechnung steht in `src/lib/progress.ts` — dieselbe Trennung wie beim
Health-Score: Was eine reine Funktion über Zahlen ist, gehört nicht in einen
Screen, sondern dorthin, wo Tests es festnageln können. Die Zusicherung „nie
rückwärts" steckt deshalb in `advanceProgress` und nicht in einem
`Math.max`-Aufruf mitten im Screen. Die Zeitschätzungen stehen als benannte
Konstanten oben in derselben Datei und sind die einzige Stellschraube, sobald
sich zeigt, wie lange ein Scan im Alltag dauert.

**Das Ergebnis reist im Speicher**, wie schon das Foto (`src/lib/scanResult.ts`
neben `capture.ts`). Es gibt keinen Bon in der Datenbank, den der
Korrektur-Screen abfragen könnte. *Mit 4b-2 ist daraus die dauerhafte Lösung
geworden — siehe „Kein Bon mit Status `extracted`" weiter unten.*

### Ergänzt mit Schritt 4b-2 (Speichern und Lernen)

**Ein Bon entsteht in einem Rutsch oder gar nicht.** Das Speichern läuft über
die Datenbankfunktion `save_receipt` (`supabase/migrations/0003_speichern.sql`).
Über den Browser wären es sechs bis zehn einzelne Anfragen — Händler, Bon,
Positionen, kanonische Produkte, deren Merkmale, die gelernten Zuordnungen —,
und bräche eine davon ab (Funkloch an der Kasse), bliebe ein halber Bon zurück,
den niemand mehr geradebiegt. Der Rumpf einer Funktion ist dagegen eine einzige
Transaktion.

Die Funktion läuft mit den Rechten des **Aufrufers**, nicht als `SECURITY
DEFINER`. In einen fremden Haushalt kann sie damit gar nicht schreiben, und das
verhindert die Datenbank und nicht der Code — dieselbe Linie wie bei der Edge
Function.

**Kein Bon mit Status `extracted`.** Die frühere Planung sah vor, dass schon die
Erkennung einen Bon anlegt, den der Korrektur-Screen dann abfragt. Beim Bauen
zeigte sich, dass das der schlechtere Weg ist: Jeder Scan, den der Nutzer nicht
bestätigt — Abbruch, Neuladen, „lieber noch mal scannen" —, bliebe als
Karteileiche liegen und müsste irgendwann aufgeräumt werden. Das Erkannte reist
deshalb weiter im Speicher (`src/lib/scanResult.ts`), und geschrieben wird genau
einmal. `getScannedReceipt` ist damit entfallen.

**Händler werden zusammengeführt.** `merchant_key()` normalisiert den Namen:
kleinschreiben, Umlaute übersetzen (nicht `lower()` überlassen — was dabei
herauskommt, hängt sonst von der Spracheinstellung des Servers ab), Rechtsformen
abschneiden. Beginnt der Name mit einer bekannten Kette, *ist* die Kette der
Schlüssel: „REWE", „Rewe" und „REWE CITY" ergeben einen Eintrag. Bei einem
unbekannten Namen bleibt der ganze Name stehen — sonst würde „Bio Company" zu
„Bio" und fiele mit jedem anderen Bioladen zusammen. Lieber zwei Einträge zu
viel als zwei Läden, deren Preise sich vermischen.

**Der Lernkreis, in drei Regeln.** Sie hängen alle an der Datenbank und nicht am
Client — auch dann, wenn die App etwas anderes schickt:

1. *Ein Klarname, ein Produkt.* Gibt es den Namen schon, wird darauf verwiesen.
2. *Nutzerkorrekturen schreiben durch.* Kategorie, Merkmale und
   Milch-Eigenschaften eines vorhandenen Produkts ändert nur `quelle = user`.
   Ein Modellvorschlag fasst vorhandenes Wissen nie an.
3. *Eine bestehende `user`-Zuordnung wird nie auf `model` zurückgestuft.* Das
   ist die Zusicherung „einmal korrigiert, bleibt korrigiert", und sie gilt
   auch, wenn das Modell beim nächsten Mal etwas völlig anderes vorschlägt.

Vor dem Modellaufruf lädt die Edge Function die Zuordnungen des Haushalts
(`mappings.ts`) — gleichzeitig mit dem Aufruf, sie kosten damit keine Wartezeit.
Ein bekannter Rohtext übernimmt Name, Kategorie, Merkmale und Milch-Attribute
aus der Datenbank; der Vorschlag des Modells wird dafür verworfen. Unangetastet
bleibt, was auf *diesem* Bon steht: Menge, Preise, Steuerkennzeichen. Im
Korrektur-Screen tragen solche Zeilen ein unauffälliges „gelernt".

**Eine Position ohne Kategorie bekommt kein Produkt.** `category_key` ist
Pflicht, und einen Wert zu raten ist auch dem Code verboten. Die Zeile wird
trotzdem gespeichert — mit `canonical_product_id = null`, einem Zustand, den das
Schema ausdrücklich vorsieht. Der Korrektur-Screen sagt vor dem Speichern, wie
viele Zeilen das betrifft und was die Folge ist: Für die lernt die App nichts.

**Abgeleitete Merkmale werden nicht doppelt geführt.** `roh`, `pasteurisiert`,
`esl`, `uht` und `homogenisiert` entstehen aus `milk_heat` und
`milk_homogenized` (die View `v_item_trait_keys` leitet sie ab). Sie stehen
deshalb nicht zum Anhaken und werden nicht zusätzlich in
`canonical_product_traits` geschrieben. Schlägt das Modell `uht` als Merkmal
vor, wird daraus das Sachattribut.

**Das Bon-Foto wird nach dem Speichern verworfen und nie hochgeladen.** Es gibt
keinen Storage-Bucket und `receipts.image_path` bleibt null. Alles, was auf dem
Papier steht und später gebraucht wird, steht dann in den Positionen; das Bild
wäre nur noch personenbezogener Ballast im freien Kontingent.

**Löschen entfernt den Einkauf, nicht das Gelernte.** Ein `delete` auf
`receipts` nimmt per Kaskade die Positionen mit. `product_mappings` und
`canonical_products` hängen nicht am Bon und bleiben stehen — sonst finge man
nach jedem gelöschten Testbon von vorn an.

**Der Abgleich rechnet live.** Summenabgleich und Steuerklassen-Probe rechnen im
Korrektur-Screen bei jeder Änderung neu (`src/lib/draft.ts`, mit Tests). Die
Warnungen aus der Erkennung beschreiben einen Zeitpunkt und werden deshalb
ausgeblendet, sobald der lebende Block dasselbe besser sagt. Fehlt einer
Position ihr Steuerkennzeichen, entfällt der Klassenabgleich wie bisher — es
lässt sich jetzt aber im Bearbeiten-Blatt nachtragen, und dann rechnet er mit.

### Ergänzt mit Schritt 4c (zwei Durchgänge)

**Der Prompt allein hat es nicht gerichtet.** Auch nach zwei Verschärfungen der
Regel „eine Zeile mit Preis ist eine eigene Position" zog das Modell auf
demselben REWE-Bon wieder zwei Zeilen zusammen:

    VANILLE                    1,99 B
    MILCHSCHOKOSTR             0,99 B

wurde zu einer Position „Vanille-Milchschokolade" — beim zweiten Mal mit 0,99 €,
sodass 1,99 € verschwanden. Der Steuerklassen-Abgleich zeigte es zuverlässig an,
aber melden ist nicht verhindern.

**Die Ursache ist ein Zielkonflikt, kein Lesefehler.** Der eine Prompt verlangte
zweierlei zugleich: Zeilen abschreiben *und* daraus lesbare Produktnamen bilden.
„Vanille" und „Milchschokostreusel" ergeben zusammen einen plausiblen
Artikelnamen — das Verschmelzen war die Folge der zweiten Aufgabe. Gegen die
Bedeutung der Wörter kommt eine Textregel schwer an.

**Deshalb zwei getrennte Durchgänge:**

1. **Struktur**, mit Bild. Stumpfes Abschreiben: jede Zeile mit Preis, Rohtext
   wörtlich, Betrag, Menge, Steuerkennzeichen, Pfand/Rabatt. Keine Namen, keine
   Kategorien, keine Merkmale. Ohne die Namensaufgabe gibt es keinen Grund mehr,
   zwei Zeilen zusammenzuziehen. Dieser Prompt ist eine **Konstante** — er kennt
   die Merkmale des Haushalts nicht einmal.
2. **Zuordnung**, ohne Bild. Bekommt nur die Rohtexte und macht daraus
   Klarnamen, Kategorien und Merkmale.

**Der eigentliche Gewinn ist die geänderte Fehlerart.** Rät Durchgang 2 daneben,
kostet das einen Tipper im Korrektur-Screen — und die Lernschleife merkt sich die
Korrektur dauerhaft. Ein Betrag, der in Durchgang 1 gar nicht erfasst wurde, ist
dagegen verloren: Keine Korrektur holt zurück, was nie dastand.

**Zwei Aufrufe kosten nicht doppelt.** Durchgang 2 braucht kein Bild (Textmodell,
`MISTRAL_TEXT_MODEL`) und läuft **nur für Rohtexte, die der Haushalt noch nicht
kennt**. Bei einem Bon aus lauter bekannten Artikeln entfällt er ganz. Mit
wachsendem Gedächtnis nähert sich der Normalfall wieder einem Aufruf pro Bon.

**Warum der Browser beide Aufrufe selbst absetzt** und nicht die Funktion intern
zweimal fragt: Sonst könnte der Fortschrittsbalken den Übergang nur raten, und
er soll nichts andeuten, was er nicht beobachtet. So hat er vier echte
Abschnitte — und überspringt den vierten sichtbar („entfällt, alles schon
bekannt"), wenn nichts offen ist.

**Durchgang 2 darf scheitern, ohne den Bon mitzureißen.** Netzfehler,
erschöpftes Kontingent, unbrauchbare Antwort: Der Korrektur-Screen erscheint
trotzdem, mit den Rohtexten als Namen und ohne Kategorie, plus einem Hinweis.
Der teure Teil ist geschafft und die Beträge stimmen; von Hand zuzuordnen ist
eine Minute Arbeit gegen einen kompletten Neuscan. Ein `catch` an dieser Stelle
ist deshalb ausdrücklich richtig und kein verschlucktes Problem.

**Zugeordnet wird über den Rohtext, nie über die Reihenfolge** — an drei
Stellen gleich (`assign.ts`, `assignments.ts`, `save_receipt`). Ein Modell, das
eine Zeile ausfallen lässt, würde sonst alles Folgende um eins verschieben, und
aus dem Spülmittel würde die Milch. Das wäre ein Fehler, den niemand bemerkt,
weil er plausibel aussieht.

**Der automatische Zweitversuch bei abweichender Steuerklasse ist bewusst
zurückgestellt.** Er greift nur bei lesbarem Steuerblock, benutzt denselben
Prompt, der eben gescheitert ist, und kostet im Fehlschlag 14 Sekunden und einen
Aufruf. Erst zeigen, ob er nach der Trennung überhaupt noch gebraucht wird.

### Ergänzt mit Schritt 4d (das Modell tippt nur noch ab)

**Auch der stumpfe Prompt hat es nicht gerichtet.** Nachdem Durchgang 1 keine
Namen mehr bilden musste, kam vom selben Bon trotzdem wieder eine Position
„VANILLE MILCHSCHOKOSTR" für 1,99 € zurück — die Zeile mit 0,99 € tauchte in
der Antwort gar nicht erst auf.

**Das Modell kann die Regel, es sieht die Zeile nur nicht.** Bei der Sprühsahne
darüber wendet es dieselbe Regel richtig an, samt Mengenzeile. Es ist also kein
Verständnisproblem, gegen das ein weiterer Satz hülfe. (Vermutung zum Auslöser:
Der fehlende Betrag ist 0,99 € — genau der Einzelpreis, der zwei Zeilen darüber
schon einmal stand. Das Modell hat ihn wohl als verbraucht abgehakt.)

**Also entscheidet das Modell nicht mehr, was eine Position ist.** Durchgang 1
gibt nur noch `zeilen` zurück: jede gedruckte Zeile des Artikelbereichs einzeln,
wörtlich, mit Betrag und Steuerbuchstaben, so wie sie dasteht. Die Aufteilung
macht `lines.ts` im Code, nach drei Regeln:

1. Zeile endet auf einen Betrag → eigene Position.
2. Zeile ist eine Mengenzeile → gehört zu der Position, die sie erklärt (mit
   Zeilensumme schließt sie die Position darüber ab, ohne reichert sie die
   davor an — beide Formen kommen auf deutschen Bons vor).
3. Zeile ohne Betrag → Fortsetzung des Namens.

Damit folgt der Schritt derselben Linie wie Summen, Health-Score und Bestpreise:
**Was eine Regel über Text und Zahlen ist, gehört in den Code**, wo Tests sie
festnageln — nicht in ein Modell, das bei jedem Aufruf neu entscheidet. Der
REWE-Bon ist als Testfall hinterlegt; solange `lines.test.ts` grün ist, kann
diese Aufteilung nicht mehr davon abhängen, wie ein Modell gerade gelaunt ist.

**Erkennungsmerkmal eines Preises: zwei Nachkommastellen.** Das ist die
wichtigste Bremse gegen Fehlalarm — „H-MILCH 1,5" und „SCHOKO 30%" sind sonst
Preise. Ein gedruckter Preis hat immer zwei Stellen.

**„Aktion" macht aus einem Artikel keinen Rabatt.** Ein Abzug wird am negativen
Betrag erkannt, nicht am Wort; nur eindeutige Wörter (Rabatt, Nachlass, Coupon,
Gutschein) zählen zusätzlich. Sonst würde „AKTION VOLLMILCH 1,29" ins Minus
gedreht, und aus einem falsch erkannten Wort entstünde ein falscher Bon.

**Die abgetippten Zeilen bleiben erhalten** — an der Position, aus der sie
entstanden sind (`sourceLines`), und als Ganzes am Bon (`lines`). Der
Korrektur-Screen zeigt sie als Liste mit der Positionsnummer davor. Das ist die
beste Fehlermeldung, die sich bauen lässt: Fehlt eine gedruckte Zeile in dieser
Liste, hat das Modell sie beim Abtippen übersehen.

**Geht eine Summe nicht auf, ist das jetzt eine Aussage über das Lesen.** Beim
Aufteilen im Code kann kein Betrag verlorengehen. Weicht die Positionssumme
also von der gedruckten ab, fehlt die Zeile schon in der Abschrift — und genau
das sagt die Warnung, statt nur eine Differenz zu melden. Der Nutzer weiß damit,
dass ein besseres Foto oder ein anderes Modell hilft und kein Prompt-Satz.

**Ein abgelehntes Modell heißt nicht „nicht erreichbar".** Ein 4xx von Mistral
ist keine Störung, sondern eine Absage — fast immer ein Modellname im Secret,
den es nicht gibt oder den der freie Tarif nicht freigibt. Die Meldung nennt
deshalb den benutzten Namen und den Wortlaut der Schnittstelle. (Aufgefallen
beim Versuch mit `pixtral-large-latest`: Der Name ist richtig, das Modell
gehört aber zum kostenpflichtigen Tarif.)

### Ergänzt mit Schritt 5a (eigene Kategorien, Auswärts essen)

Schritt 5 ist in zwei Etappen geteilt. **5a** ist die Migration samt
Kategorieverwaltung und Auswärts essen, **5b** bringt Fremdwährung und das
Bearbeiten gespeicherter Bons. Die Migration `0004_erweiterungen.sql` enthält
schon **alle** Schemaänderungen beider Etappen — das war der Grund, die drei
Erweiterungen überhaupt zu bündeln, und ein zweites Mal am Schema zu drehen wäre
mit jedem gespeicherten Bon teurer geworden.

**Kategorien sind jetzt Daten, nicht Code.** Damit gilt für sie, was seit v2
schon für Merkmale gilt. `categories` bekommt `description` (geht in den
Prompt), `active` (aus statt gelöscht), `color` und `is_default`. Der
Datenmodell-Grundsatz „Kategorien bleiben fest" unten ist damit **überholt**.

**Der Schlüssel entsteht beim Anlegen aus dem Namen und ist danach
unveränderlich** — `category_key()` in SQL, `toCategoryKey()` in TypeScript.
Zwei Umsetzungen derselben Regel, weil das Anlegen in der Datenbank passiert,
das Anlegen-Formular den künftigen Schlüssel aber vorher zeigt; ein Wert, den
man nicht mehr ändern kann, soll vorher sichtbar sein. Sie sind mit Tests
aneinandergebunden (`src/lib/category.test.ts`).

**Gelöscht wird nie.** `canonical_products` verweist über einen Fremdschlüssel
auf die Kategorie. Eine abgeschaltete verschwindet aus Auswahl und Prompt und
bleibt für Altdaten gültig; die Einstellungen sagen vorher, wie viele Produkte
das betrifft.

**Die Farbe gehört der Kategorie.** Vorher vergab `categorySlices` die Grün-Ramp
nach Ausgabenhöhe — dieselbe Kategorie war im einen Monat dunkelgrün und im
nächsten hell, nur weil einmal mehr Obst gekauft wurde. Mit frei anlegbaren
Kategorien ginge es ohnehin nicht mehr: Eine selbst angelegte hätte keinen Platz
in der Ramp. Gespeichert wird Hex und keine CSS-Variable — die `--cat-*`-Token
sind in beiden Themes gleich definiert, es geht also nichts verloren, und einen
Variablennamen könnte die Datenbank nicht prüfen.

**„Auswärts" hängt am Händler, nicht an der Kategorie.** Das Konzept nennt eine
Kategorie `dining`; der Kategorieschlüssel ist ab jetzt aber Sache des Nutzers,
und ein fest verdrahtetes `dining` in Code oder Sicht wäre genau das versteckte
Verhalten, das die Merkmalstabelle abgeschafft hat. Gerechnet wird deshalb über
`merchants.kind`. Das ist auch sachlich der bessere Anker: Der Ausschluss aus
den Bestpreisen hängt ohnehin am Händler, und die drei Teilbeträge der Kopfkarte
ergeben so **exakt** die Gesamtsumme, ohne dass eine Position doppelt zählt. Die
Kategorie „Auswärts essen" behält ihre Aufgabe — sie gibt den Positionen einen
Platz im Ring mit eigener Farbe. Nur rechnet niemand mit ihrem Schlüssel.

**Die Händlerart wird nachgeschlagen, nicht geraten.** Das Konzept sieht vor,
dass das Modell sie vorschlägt. Genau das passiert bewusst nicht: Durchgang 1
ist seit 4d ein reiner Abschreiber, und jede zusätzliche Deutungsaufgabe
konkurriert mit dem Abtippen — daran ist der Prompt zweimal gescheitert.
Stattdessen sucht die Edge Function den Bonnamen über `merchant_kind_for()` in
`merchants` (dieselbe Normalform wie beim Zusammenführen, „REWE CITY" findet
also „REWE"). Bei einem neuen Restaurant tippt der Nutzer einmal auf „Gastro";
ab dem nächsten Bon desselben Ladens steht es von selbst da. Die Zusicherung des
Konzepts — einmal gesetzt, gilt für alle künftigen Bons — ist damit erfüllt,
ohne den empfindlichsten Teil der Erkennung anzufassen.

**Trinkgeld ist keine Position und steht nicht in `printed_total_cents`.** Es
steht meist gar nicht auf dem Papier, wird also eingegeben statt gelesen. Läge
es in der gedruckten Summe, meldete der Summenabgleich bei jedem
Restaurantbesuch eine Abweichung, die keine ist. Es zählt in „Auswärts" und in
die Gesamtsumme, in keine Kategorie. **Vorbelegung immer „Nein"** — ein
vorausgefülltes Trinkgeld wäre eine Behauptung über etwas, das der Bon nicht
hergibt.

**Vier Zahlen auf 390 px.** Nebeneinander passen sie nicht: Drei Spalten à rund
100 px tragen „1.234,56 €" nicht ohne Umbruch. „Gesamt" steht deshalb groß in
eigener Zeile, die drei Teilbeträge kleiner darunter.

**`save_receipt` kann jetzt aktualisieren.** Mit `bon_id` in der Anfrage wird der
bestehende Bon geändert statt ein zweiter angelegt; die Positionen werden dabei
**ersetzt** und nicht abgeglichen. Welche Zeile der Nutzer umbenannt, gelöscht
oder ergänzt hat, ließe sich von außen nicht zuverlässig zuordnen, und eine
falsch zugeordnete Zeile wäre schlimmer als eine neu geschriebene. Der Bon behält
seine id — der Verweis aus der Adresszeile bleibt gültig.

### Ergänzt mit Schritt 5b (Fremdwährung, gespeicherte Bons bearbeiten)

**Der Entwurf rechnet in der Bonwährung, umgerechnet wird genau einmal.** Ein
Schweizer Bon steht im Korrektur-Screen in Franken — man prüft ja gegen das
Papier in der Hand, und würde schon die Erkennung umrechnen, stimmte keine
einzige Zeile mit dem Beleg überein. Aus Franken werden Euro erst in
`buildSavePayload`. In der Datenbank halten die Cent-Felder danach durchgehend
Euro, und keine Auswertung weiß von Währungen.

**Beim Umrechnen darf keine Abweichung aus dem Nichts entstehen.** Jede Zeile
wird einzeln gerundet; die Summe der gerundeten Zeilen liegt deshalb manchmal
ein, zwei Cent neben der gerundeten Gesamtsumme. Bei einem Bon, der in Franken
exakt aufging, hätte der Korrektur-Screen „stimmt" gesagt und das Einkaufs-Detail
zeigte hinterher eine Differenz. Deshalb gilt bei einem aufgehenden Bon in Euro
**die Summe der umgerechneten Zeilen**. Das erfindet kein Geld: Was gedruckt
stand, steht unverändert in `original_total_cents`. Ging der Bon schon in Franken
nicht auf, bleibt die umgerechnete gedruckte Summe stehen — sonst verschwiege das
Umrechnen einen Lesefehler.

**Der Kurs kommt von der EZB, zum Bon-Datum.** Abgerufen wird in der Edge
Function (`rates.ts`), weil dort die Netzwerkrechte liegen und das Ergebnis
gleich in `exchange_rates` landet. Die EZB veröffentlicht „Franken je Euro";
gespeichert wird der Kehrwert, also die Form, in der gerechnet wird: Betrag ×
Kurs = Euro. An Wochenenden und Feiertagen wird das Fenster der letzten vierzehn
Tage abgefragt und die jüngste Beobachtung ≤ Bon-Datum genommen — damit sind
Feiertage erledigt, ohne dass irgendwo ein Kalender stünde. Der **tatsächlich
verwendete Stichtag** wird mitgespeichert.

**Der Zwischenspeicher hält nur echte Veröffentlichungstage.** Für einen Bon vom
Samstag wird deshalb jedes Mal neu gefragt: Einen Kurs unter dem Datum „Samstag"
abzulegen wäre eine Behauptung über einen Tag, an dem nichts veröffentlicht
wurde, und `receipts.rate_date` verlöre seine Aussage. Der Preis ist eine
zusätzliche Anfrage, wenn derselbe Wochenendbon ein zweites Mal gescannt wird.
Für den Normalfall — ein Werktagsbon — wird genau einmal gefragt.

**Ein gescheiterter Abruf blockiert das Speichern nicht, ein fehlender Kurs
schon.** Das ist kein Widerspruch: Der Scan läuft durch, der Korrektur-Screen
erscheint, und dort steht ein Kursfeld für genau diesen einen Bon. Was nicht geht,
ist Franken-Beträge als Euro in die Datenbank zu schreiben — das verschöbe jede
Monatssumme, ohne dass es jemandem auffiele. Es fehlt also eine einzige Zahl, und
das Feld dafür steht daneben. **Ein Wechselkurs-Feld in den Einstellungen gibt es
ausdrücklich nicht.**

**Ein anderes Bon-Datum zieht einen neuen Kurs nach sich.** Der Kurs richtet sich
nach dem Bon-Datum, also muss ein korrigiertes Datum ihn mitziehen. Ein Kurs, den
der Nutzer von Hand eingetragen hat, wird dabei nicht überschrieben — sonst wäre
die Handeingabe beim nächsten Tastendruck im Datumsfeld wieder weg.

**Bearbeiten ist eine andere Vorlage, kein anderer Screen.** „Bearbeiten" im
Einkaufs-Detail führt in denselben Korrektur-Screen. Er hatte seine ganze
Bearbeitungslogik ohnehin in `src/lib/draft.ts`; es fehlte das Laden eines
gespeicherten Bons in diese Form (`getReceiptDraft`, `toDraftsFromSaved`) und ein
Speichern, das aktualisiert statt anlegt (`bon_id`). Ein zweiter Screen mit
denselben vierzig Feldern wäre die Sorte Verdopplung, die auseinanderläuft.

**Beim Bearbeiten wird nicht zurückgerechnet.** Ein gespeicherter
Fremdwährungsbon steht in der Datenbank bereits in Euro, und dort bleibt er auch
im Entwurf. Ein Rundgang Euro → Franken → Euro verschöbe bei jedem Bearbeiten
einzelne Zeilen um einen Cent, ohne dass jemand etwas geändert hätte.
Zurückgerechnet wird nur der Originalbetrag — eine Zusatzangabe, an der keine
Auswertung hängt. Der Kurs bleibt eingefroren: Ihn nachzuführen würde
Monatssummen der Vergangenheit rückwirkend ändern.

**Eine geladene Zeile gilt nicht als bearbeitet.** `edited` bleibt `false`, bis
`differs` eine echte Änderung sieht — sonst ginge jede unveränderte Zeile beim
erneuten Speichern als Nutzerkorrektur durch und beförderte einen
Modellvorschlag zur Entscheidung.

**Die Positionen werden beim Aktualisieren ersetzt, nicht abgeglichen.** Welche
Zeile umbenannt, gelöscht oder ergänzt wurde, ließe sich von außen nicht
zuverlässig zuordnen, und eine falsch zugeordnete Zeile wäre schlimmer als eine
neu geschriebene. Der Bon behält seine id.

**Die Währung ist Abschreiben, nicht Deuten.** Durchgang 1 gibt zusätzlich
`waehrung` zurück — aber nur, wenn ein Zeichen auf dem Bon **gedruckt** steht
(`CHF`, `Fr.`, `€`). Aus der Anschrift oder dem Ladennamen auf die Währung zu
schließen ist ausdrücklich verboten: Ein aus dem Kontext erschlossenes „CHF" wäre
die Sorte plausibler Fehler, die niemand bemerkt und die jede Monatssumme um
sieben Prozent verschiebt. Steht nichts da, ist der Bon ein Euro-Bon.

### Ergänzt mit Schritt 6 (Verarbeitung im Hintergrund)

**Das Ergebnis liegt ab jetzt auch auf dem Server.** Wechselt der Nutzer während
des Scans die App, friert Safari die Seite ein: Die Edge Function rechnet weiter,
aber ihre Antwort hat beim Zurückkommen niemanden mehr, dem sie zugestellt werden
könnte. Bei rund fünfzehn Sekunden Scan-Dauer ist das kein Randfall. Deshalb legt
die App vor dem Scan einen Job in `scan_jobs` an, und Durchgang 1 schreibt sein
Ergebnis **zusätzlich** dorthin (`supabase/migrations/0005_hintergrund.sql`).

**Im Job liegt nur Durchgang 1.** Durchgang 2 — die Namensgebung — läuft erst,
wenn die App wieder wach ist. Zwei Gründe: Er ist billig und braucht kein Bild,
und er soll mit den Merkmalen laufen, die *jetzt* gelten. Ein zweiter
Zwischenspeicher für ein Zwischenergebnis wäre eine zweite Stelle, an der
derselbe Ablauf hängt.

**Das Bon-Foto liegt weiterhin nirgends.** In `scan_jobs.result` stehen nur die
erkannten Daten — dieselbe Struktur, die sonst über die Leitung ginge.

**Zwei Rettungswege, weil es zwei Fälle gibt.** Lebt die Seite noch (der
Verarbeitungs-Screen steht im Hintergrund), fragt sie bei `visibilitychange`
selbst nach und macht dort weiter, wo sie war. Hat iOS sie ganz aus dem Speicher
geworfen, ist beim nächsten Start alles weg — dann steht der Hinweis auf der
Übersicht (`OpenScanNotice`). **Das Foto ist in diesem zweiten Fall verloren, das
Ergebnis nicht.** Das ist die Grenze, die bleibt, und sie ist hinnehmbar: Das
Ergebnis ist der teure Teil.

**Bevor ein Fehler auf dem Screen steht, wird nachgefragt.** Eine abgebrochene
Anfrage nach einem App-Wechsel sieht aus wie ein Netzfehler und ist keiner. Ohne
diesen Zwischenschritt stünde „Erkennung fehlgeschlagen" da, und der Nutzer
verbrennte einen zweiten Modellaufruf für ein Ergebnis, das längst fertig ist.

**Der Job darf scheitern, der Scan nicht.** Kommt keine Job-id zurück — fehlende
Migration, kein Netz —, läuft die Erkennung wie vor Schritt 6; sie überlebt dann
nur keinen App-Wechsel. Ein Rettungsweg, der den Normalfall blockiert, wäre ein
schlechter Tausch.

**Ein offener Job gehört dem Gerät, nicht dem Haushalt.** `created_by` filtert
mit: Sonst bekäme das ganze Haus die Meldung „Ein Scan ist fertig", sobald
irgendwer irgendwo einen Bon fotografiert.

**Aufgeräumt wird beim Anlegen des nächsten Jobs**, nicht nach Zeitplan. Jobs
älter als 24 Stunden verschwinden dabei. Ein eigener `pg_cron`-Auftrag wäre für
einen Zwischenspeicher zu viel Maschinerie — Zeilen entstehen ohnehin nur, wenn
jemand die App benutzt.

### Ergänzt mit Schritt 7 (Spritkosten)

**Ein Tankbeleg ist kein neuer Datentyp.** Er ist ein Bon mit einer Position:
Menge in Litern, Preis je Liter, Gesamtbetrag. Bestpreis, Preisverlauf und
Grundpreis greifen damit ohne zusätzlichen Bau. Gebraucht wurden nur die
Kategorie `kraftstoff` (`supabase/migrations/0006_kraftstoff.sql`) und drei
kleine Nachbesserungen an der Erkennung.

**Ein Kategorieschlüssel steht hier ausnahmsweise im Code.** Bei „Auswärts
essen" wurde genau das vermieden — dort ist `merchants.kind` der bessere Anker.
Für Kraftstoff gibt es keinen: Eine Tankstelle verkauft Sprit *und* Kaffee, der
Händler sagt also nichts. `kraftstoff` ist deshalb eine **mitgelieferte**
Kategorie mit festem Schlüssel, genau wie `dairy`, an dem die Milch-Felder im
Korrektur-Screen hängen. Der Anzeigename bleibt frei änderbar; selbst angelegte
Kategorien bleiben von jedem Sonderverhalten unberührt.

**Der Literpreis hat drei Nachkommastellen — die Erkennung musste das lernen.**
Das Muster für Mengenzeilen in `lines.ts` verlangte zwei Stellen und las aus
„38,45 L à 1,779 EUR/L" ein „1,77" heraus, mit einer „9" als Textrest: ein
falscher Literpreis, der dazu noch plausibel aussieht. Dazu kamen `à` und `@` als
Trennzeichen und `Ltr`/`Liter` als Einheit. Der Struktur-Prompt hat ein
Tankbeleg-Beispiel bekommen, damit die Literzeile überhaupt als eigene Zeile
abgetippt wird — nur dann kommt sie beim Parser als Mengenzeile an.

**Die Plausibilitätsprüfung wächst jetzt mit der Menge.** Der Einzelpreis steht
als ganze Zahl in Cent; 1,779 €/l werden also 178, und 38,45 × 1,78 ergibt 68,44
statt der gedruckten 68,41. Mit der festen Grenze von zwei Cent hätte
`checkUnitPrice` den Literpreis **verworfen** — und die Bestpreis-Sicht verglich
danach nicht mehr Literpreise, sondern Tankfüllungen. Die Grenze ist deshalb
`Menge ÷ 2`, mindestens zwei Cent: genau der Fehler, den das Runden auf ganze
Cent überhaupt erzeugen kann. Für jede Supermarktzeile ändert sich dadurch
nichts.

**In der Auswertung ist der Literpreis ein Verhältnis, kein Geldbetrag.**
`v_fuel_purchases` rechnet ihn aus Zeilensumme ÷ Litern mit zwei
Nachkommastellen — `unit_price_cents` in ganzen Cent verlöre die Stelle, um die
es an der Zapfsäule geht. Gespeichert wird davon nichts; gerechnet wird bei jedem
Aufruf, so wie beim Grundpreis auch. Der Grundsatz „Geld ist eine ganze Zahl in
Cent" bleibt unberührt.

**Der Monatspreis ist Kosten ÷ Liter, nicht das Mittel der Einzelpreise.** Sonst
zählte eine Fünf-Liter-Notfüllung genauso viel wie eine volle Tankfüllung.

**„Verbrauch" heißt Liter je Monat, nicht Liter je 100 km.** Auf einem
Tankbeleg steht kein Kilometerstand. Ihn abzufragen wäre eine Eingabe, die
niemand zuverlässig macht, und eine Verbrauchsangabe aus lückenhaften
Kilometerständen wäre schlimmer als keine. Gezeigt wird, was auf den Belegen
steht — mehr wird nicht behauptet.

**Kraftstoff bleibt in der Kopfkarte Non-Food.** Vier Zahlen sind auf 390 px
bereits eng, fünf wären zu viel; das Konzept sieht es selbst so vor. Die eigene
Karte steht in den Analysen und erscheint nur, wenn es Tankbelege gibt.

### Ergänzt mit Schritt 8 (Bestpreise und Analysen scharf schalten)

**Die Auswertungen rechneten längst gegen echte Daten — es fehlten Schwellen.**
Mit drei Bons sagt „Sparpotenzial: 30 Cent" nichts über Läden, sondern über ein
Sonderangebot, und ein „Bestpreis" aus einem einzigen Kauf ist keiner. Eine
Auswertung, die mit wenigen Daten Unsinn behauptet, ist schlechter als eine, die
sagt „dafür reicht es noch nicht" (`supabase/migrations/0007_auswertungen.sql`).

**Der Grundpreis war tote Leitung.** `v_product_prices.base_price_cents` wurde
aus `canonical_products.size_base` gerechnet — einer Spalte, die `save_receipt`
**nie füllt**: Auf einem Bon steht die Packungsgröße fast nie, und sie zu raten
ist verboten. Der Grundpreis war deshalb immer null, und überall stand „ohne
Mengenangabe". Die Angabe war die ganze Zeit da, nur woanders: Bei Ware nach
Gewicht oder Volumen **ist** `unit_price_cents` der Grundpreis — „1,79 EUR/kg"
steht so auf dem Bon. Es fehlte die Umrechnung auf eine einheitliche Einheit.
Für Stückware bleibt er null, und das ist richtig: ohne Packungsgröße kein €/kg.

**Drei Schwellen beim Sparpotenzial**, jede fängt eine falsche Aussage ab:

- *Mindestens zwei Läden.* Sonst hieße „woanders günstiger" in Wahrheit
  „derselbe Laden, anderer Tag" — eine Aktion und keine Ladenwahl.
- *Mindestens 20 Cent je Produkt.* Darunter ist es Rauschen. Ein Hinweis, der
  zum Ladenwechsel wegen zwölf Cent rät, wird nicht ernst genommen — und das
  färbt auf die Hinweise ab, die stimmen.
- *Der Bestpreis ist höchstens ein halbes Jahr alt.* Ein Preis von vorletztem
  Jahr ist heute nicht erreichbar; er erzeugte ein Sparpotenzial, das niemand
  heben kann.

**„Bestpreis" ist eine Aussage über einen Vergleich** und steht deshalb nur da,
wenn es einen gab. Bei einem Kauf heißt es „Einmal bezahlt", bei einem Laden
„Günstigster Preis". Die Zahl stimmt in allen drei Fällen — nur ihre Bezeichnung
ändert sich, und darunter steht, was für den Vergleich noch fehlt.

**„Häufigste Käufe" ist eine andere Frage als „teuerste Produkte"** und für einen
Haushalt die nützlichere: Sie sagt, wofür sich ein Preisvergleich lohnt, und ist
die Vorstufe zum Einkaufszettel. Mindestens zwei Käufe in sechs Monaten, sonst
wäre es eine Liste von allem.

**Die Analysen sagen selbst, wie belastbar sie sind.** `v_household_stats`
liefert Einkäufe und Tage seit dem ersten Bon; darunter steht der Hinweis, ab
wann es aussagekräftig wird. Die Schwelle ist dieselbe wie beim Einkaufszettel —
vier Einkäufe und vierzehn Tage. Zwei Schwellen für dieselbe Frage wären zwei
Wahrheiten.

**Die Produktsuche zeigt zwei Zahlen statt einer.** Mit wenigen Bons ist der
laufende Monat oft leer, und „0 Käufe" sieht aus, als hätte die Suche nichts
gefunden — obwohl das Produkt im Vormonat dreimal vorkam.

### Ergänzt mit Schritt 9 (Einkaufszettel)

**Er ist ein eigener Tab geworden, kein Dashboard-Baustein.** Das Konzept ließ
beides offen und wollte die Entscheidung „am Gerät". Sie fällt zugunsten des
Tabs: Der Zettel wird **im Laden** benutzt, im Stehen, mit einer Hand am Wagen —
eine Karte im Dashboard kostet dort einen Tipper und eine Scrollbewegung, genau
in dem Moment, in dem es schnell gehen soll. Und er ist kein Bericht, sondern
ein Arbeitsblatt: Auf dem Dashboard steht, was war; hier hakt man ab, was noch
kommt. Beides zu mischen macht beides unklarer.

Der Platz reicht: sechs Felder auf 390 px sind rund 64 px je Feld. Dafür heißen
zwei Tabs kürzer — **„Preise" statt „Bestpreise", „Gesund" statt
„Gesundheit"**, genau wie im Konzept vorgeschlagen. Die Screens behalten ihre
vollen Titel; gekürzt ist nur, was in die Leiste muss.

> *Mit Schritt 15 zurückgenommen: Am Gerät waren sechs Felder zu gedrängt, und
> der Scan-Knopf saß nicht mehr mittig. Der Zettel behält seinen Tab — die
> Begründung darüber gilt unverändert —, die Bestpreise geben ihren ab und
> sitzen jetzt hinter einem Umschalter in den Analysen. Damit sind auch die
> Kürzungen hinfällig; die Leiste beschriftet wieder aus.*

**Median und Quartilsabstand, nicht Mittelwert und Standardabweichung.** Ein
Urlaub reißt eine Lücke von drei Wochen in einen Sechs-Tage-Rhythmus: Der
Mittelwert wandert dadurch dauerhaft nach oben, der Median nicht. Für die
Streuung gilt dasselbe — der Quartilsabstand ist gegen einzelne Ausreißer
unempfindlich, und die sind hier der Normalfall.

**Nur stabile Rhythmen kommen ungefragt auf den Zettel.** Der Quartilsabstand
darf höchstens 60 % des Medians betragen (mindestens vier Tage). Milch alle sechs
bis acht Tage ist ein Rhythmus; Grillkohle im Mai und im August ist keiner — der
Median wäre rechnerisch da, sagte aber nichts voraus. Ein Zettel, der Unsinn
vorschlägt, wird nach dem zweiten Mal nicht mehr geöffnet.

**Der erwartete Preis ist der günstigste tatsächlich bezahlte Zeilenbetrag der
letzten sechs Monate — nicht Bestpreis × Menge.** Das weicht vom Konzept ab, und
zwar bewusst: Ein Einzelpreis mal einer Medianmenge ergibt eine Zahl, die so nie
auf einem Bon stand, und bei einer Position ohne Einzelpreis wäre sie schlicht
falsch. Der günstigste bezahlte Betrag ist dagegen einer, den es wirklich gab —
samt der Menge, die man üblicherweise mitnimmt.

**Die Schwelle steht in der Datenbank, nicht im Browser.** `v_household_stats`
liefert `required_receipts`, `required_days` und `suggestions_ready`. Dieselbe
Schwelle entscheidet in `shopping_list_refresh()`, ob überhaupt Vorschläge
entstehen; stünde sie zweimal da, zeigte der Balken irgendwann „geschafft",
während die Datenbank noch schwiege.

**Die Liste gibt es von Anfang an, die Vorschläge erst ab der Schwelle.** Eigene
Einträge sind ab dem ersten Tag möglich — ein Zettel, auf den man nichts
schreiben darf, ist kein Zettel.

**Ein weggewischter Vorschlag wird nicht gelöscht, sondern mit `removed_at`
markiert.** Sonst schlüge ihn der nächste Aufruf sofort wieder vor. Mit dem
abgeschlossenen Einkauf ist die Erinnerung vorbei — sie galt für *diesen*
Durchgang.

**Abgehakt wird in `save_receipt`.** Sie weiß, welche Produkte gerade
geschrieben wurden, und sie ist eine Transaktion: Entweder ist der Bon da und
der Zettel abgehakt, oder nichts von beidem. Ein zweiter Aufruf aus dem Browser
könnte dazwischen abbrechen.

**Die Begründung steht sichtbar am Eintrag** („zuletzt vor 9 Tagen · üblich alle
7") und nicht in einem Aufklappbereich. Ein Vorschlag ohne Begründung ist eine
Behauptung; mit ihr kann der Nutzer entscheiden, ob die App richtig liegt.

### Ergänzt mit Schritt 10 (Merkmale selbst anlegen und gewichten)

**Am Schema hat sich nichts geändert.** Merkmale sind seit Schritt 2a Daten und
keine Aufzählung im Code; `traits` trug alle Felder, die die Verwaltung braucht,
und die Zugriffsregel erlaubte dem Haushalt seit jeher auch Schreiben. Es fehlte
ausschließlich die Bedienoberfläche. Die Migration `0009_merkmale.sql` legt
deshalb nur eine Sicht an: wie viele Produkte an einem Merkmal hängen — dieselbe
Frage wie beim Abschalten einer Kategorie, und dieselbe Antwort: erst zeigen,
wovon die Rede ist.

**Score-Änderungen wirken rückwirkend, ohne dass etwas neu gerechnet wird.** Der
Score ist nirgends gespeichert: `v_score_items` liefert nur die Zutaten,
`src/lib/score.ts` rechnet bei jeder Anzeige mit den Gewichten, die in diesem
Moment gelten. Nach dem Schreiben frischt `refreshTraits()` das Zwischenlager
auf, und die Verlaufskurve steht sofort richtig da. Eine „Neuberechnung
anstoßen"-Funktion gibt es hier bewusst nicht — sie wäre die Antwort auf ein
Problem, das die Architektur nicht hat.

**Der Schlüssel entsteht aus dem Namen, nach derselben Regel wie bei den
Kategorien.** `toStableKey` in `src/lib/category.ts` ist jetzt der gemeinsame
Name dafür; `toCategoryKey` ruft ihn auf. Eine zweite Umsetzung für Merkmale
wäre eine zweite Wahrheit gewesen.

**Auch die fünf abgeleiteten Merkmale sind einstellbar.** `roh`,
`pasteurisiert`, `esl`, `uht` und `homogenisiert` lassen sich weiterhin nicht
anhaken — sie entstehen aus den Milch-Feldern am Produkt. Gewicht und Gruppe
gelten trotzdem, und genau dafür sind sie da: Wer H-Milch härter bewerten will,
stellt hier das Gewicht. Das Blatt sagt das auch dazu.

**Das Gewicht bekommt zwei Knöpfe und keine Schieberegler.** Auf −10 bis +10
trifft ein Daumen den gewünschten Wert nicht, und der Unterschied zwischen −3 und
−4 ist eine Entscheidung und kein Gefühl.

**Gelöscht wird nie**, wie bei den Kategorien: Produkte hängen über einen
Fremdschlüssel am Merkmal. Ein abgeschaltetes verschwindet aus Prompt, Auswahl
und Score; die Zuordnung am Produkt bleibt stehen.

### Ergänzt mit Schritt 11 (Einstellungen als Übersicht)

**Der Screen wurde mit jedem Bereich länger.** Zuletzt standen Budget, zwei
Schalter, der Haushalt, vierzehn Kategorien und vierzehn Merkmale untereinander
— wer das Budget ändern wollte, scrollte an allem vorbei. Die beiden
Verwaltungen machten dabei den größten Teil aus, obwohl man sie am seltensten
braucht.

**Jetzt zeigt die Übersicht nur die Bereichsnamen**, wie man es von iOS kennt:
eine Zeile je Bereich, ein Chevron rechts, dahinter ein eigener Screen mit
Zurück-Weg. Die Bereiche selbst sind unverändert — es sind dieselben
Komponenten, sie stehen nur nicht mehr alle gleichzeitig da.

**Eigene Routen, keine Umschaltung im Screen.** `/einstellungen/budget`,
`/einstellungen/kategorien`, `/einstellungen/merkmale`,
`/einstellungen/haushalt`. Mit einem Zustand im Screen funktionierte weder die
Zurück-Geste noch ein Verweis auf einen bestimmten Bereich — und beides ist auf
einem Telefon der halbe Bedienweg.

**Der Dark-Mode-Schalter bleibt oben.** Er ist ein einziger Zustand; ein eigener
Screen dafür wäre ein Tipper mehr für dieselbe Bewegung. Die Faustregel: Was in
eine Zeile passt und keine Erklärung braucht, bleibt auf der Übersicht.
(Daneben stand bis Schritt 15 „Bon-Fotos nach Erkennung löschen" — siehe unten.)

**Die Reihenfolge folgt der Häufigkeit, nicht der Technik.** Erst das Budget,
dann was die Erkennung steuert (Kategorien, Merkmale), dann der Haushalt, dann
die Darstellung. „Konto abmelden" steht ganz unten — der einzige Eintrag, den man
nicht versehentlich treffen soll.

### Ergänzt mit Schritt 12 (Familie einladen)

**Ein Code zum Abtippen, kein Link.** Ein Einladungslink müsste den Code aus der
Adresszeile lesen — und der Eingeladene muss sich vorher trotzdem anmelden, sonst
gibt es niemanden, den man eintragen könnte. Nach dem Rücksprung von Google wäre
der Code wieder weg, es sei denn, die App legte ihn irgendwo ab. Für drei
Familienmitglieder ist der kürzere Weg: anmelden, Code eingeben, fertig. Er lässt
sich auch vorlesen.

Acht Zeichen aus einem Alphabet **ohne 0/O und 1/I/L**. Die verwechselt man beim
Abtippen, und „ungültiger Code" wäre hier sonst die häufigste Meldung statt der
seltensten.

**Ein Code je Haushalt, mehrfach einlösbar, sieben Tage gültig.** Nicht einer je
Person: Eine Familie mit zwei weiteren Mitgliedern bräuchte sonst zwei Codes, und
der zweite ginge verloren. Der Preis ist, dass ein durchgesickerter Code bis zum
Ablauf gilt — dagegen stehen die sieben Tage und ein Knopf zum Zurückziehen.

**`redeem_household_invite()` ist die einzige Nutzerfunktion mit `SECURITY
DEFINER`, und sie braucht es zwingend:** Wer beitritt, darf die Einladungszeile
des fremden Haushalts nicht sehen — sonst könnte er auch alles andere dort sehen.
Die Prüfung, ob er darf, *ist* der Code. Der Rumpf ist entsprechend eng: Der Code
muss gültig sein, geschrieben wird ausschließlich in `household_members` und
ausschließlich für `auth.uid()`, und `search_path` ist fixiert.

**Der eigene leere Haushalt wird beim Beitreten aufgelöst.** Das ist der
Normalfall — er entstand beim Anmelden und enthält nur die mitgelieferten
Kategorien und Merkmale. Gelöscht wird er nur, wenn danach wirklich niemand mehr
darin sitzt.

**Enthält er schon Bons, wird abgelehnt.** Zusammenführen wäre die Alternative
und ist bewusst nicht gebaut: Es müsste Produkte, Zuordnungen, Händler und
Kategorien zweier Haushalte verschmelzen, jede mit eigenen Schlüsseln, und ein
Fehler dabei wäre nicht rückgängig zu machen. Ein Haushalt mit Daten gehört nicht
stillschweigend gelöscht. Der Screen sagt das **vorher** und nicht als
Fehlermeldung hinterher.

**Nach dem Beitritt lädt die App vollständig neu.** Der Haushalt wechselt, und
daran hängt buchstäblich alles: Kategorien, Merkmale, Händler, jede Abfrage,
jedes Zwischenlager. Ein Neuladen ist ehrlicher als ein Dutzend Auffrischungen,
von denen eine vergessen würde — und es passiert genau einmal im Leben eines
Kontos.

**Die Mitgliederliste kommt aus einer Funktion, nicht aus einer Sicht.** Die
E-Mail-Adressen stehen in `auth.users`; dorthin kommt keine gewöhnliche Abfrage.
`household_members_list()` prüft als Allererstes, ob der Aufrufer selbst
dazugehört, und gibt nur Name, E-Mail, Rolle und Beitrittsdatum zurück.

### Ergänzt mit Schritt 15 (zurückgenommen und aufgeräumt)

**Der Schalter „Bon-Fotos nach Erkennung löschen" ist weg.** Er stand für eine
Wahl, die es nie gab: Das Foto wird nach der Erkennung **immer** verworfen und
nie hochgeladen, es gibt keinen Storage-Bucket, `receipts.image_path` bleibt
null. Der Schalter konnte an dem Verhalten nichts ändern und behauptete
trotzdem, es zu tun. Ein Schalter ohne Wirkung ist schlimmer als keiner, weil
man ihm glaubt. Im `AppState` bleibt damit genau eine Einstellung, die
tatsächlich pro Gerät gilt — das Erscheinungsbild.

**Die Erklärung in der Einstellungs-Übersicht steht jetzt unter dem Namen.**
Sie stand daneben, weil Name und Erklärung dort `<span>` sind und ohne
`display: block` in dieselbe Zeile rutschen — bei „Kategorien" las sich das als
ein einziger Satz und brach auf 390 px obendrein um. Das Chevron sitzt mittig
zur **ganzen** Zeile und nicht zum Namen, sonst rutschte es bei einer
zweizeiligen Erklärung nach oben.

**Die Tab-Leiste hat wieder vier Tabs: Übersicht · Zettel · Analysen ·
Gesundheit.** Mit Schritt 9 war der Einkaufszettel als fünfter dazugekommen —
sechs Felder auf 390 px. Am Gerät hat sich gezeigt, was das Konzept als
Möglichkeit offengelassen hatte: Es ist zu gedrängt, und schwerer wiegt, dass
der Scan-Knopf damit **nicht mehr mittig** saß. Er ist der einzige Weg in den
Scan-Ablauf und der am häufigsten getroffene Punkt der ganzen App; zwei Tabs
links und zwei rechts setzen ihn ohne Rechnerei in die Mitte.

Weichen mussten die **Bestpreise**, nicht der Zettel: Der Zettel wird im Laden
benutzt und muss einen Daumen entfernt sein (die Begründung aus Schritt 9 gilt
unverändert). Die Bestpreise beantworten dieselbe Frage wie die Analysen — „was
kostet was, und geht es günstiger" — und sitzen deshalb jetzt dort. Damit passen
auch die ausgeschriebenen Beschriftungen wieder; die Kürzungen aus Schritt 9
(„Preise", „Gesund") sind zurückgenommen.

**Der Umschalter sind zwei Verweise, keine Umschaltung im Screen.**
`/bestpreise` und `/bestpreise/:productId` bleiben unverändert bestehen, ebenso
beide Screens; es ändert sich nur der Weg dorthin. Ein `useState` im
Analysen-Screen hätte die Zurück-Geste des Browsers und jeden Verweis auf ein
einzelnes Produkt gekostet — für nichts. Preis dafür ist die Liste `alsoActive`
in der Tab-Leiste: Ein `NavLink` kennt nur seine eigene Adresse und wüsste sonst
nicht, dass der Analysen-Tab auch auf `/bestpreise` leuchten muss.

**Beide Screens tragen die Überschrift „Analysen".** Der Umschalter direkt
darunter sagt bereits, welcher Bereich zu sehen ist; eine Überschrift, die beim
Umschalten wechselt, ließe den Eindruck entstehen, man hätte den Bereich
verlassen. Das Suchfeld der Bestpreise steht unmittelbar unter dem Umschalter —
**die Produktsuche ist der Grund, warum es die Bestpreise gibt**, und darf durch
den Umweg über die Analysen keine Zeile tiefer rutschen als nötig.

### Zurückgenommen mit Schritt 15 (Monatsreport als Push)

Schritt 13 hatte den Monatsreport als Push-Benachrichtigung gebaut: Service
Worker, Berechtigungsabfrage, Abos je Gerät, eine eigene Edge Function und einen
Zeitplan in GitHub Actions. **Der Nutzer will ihn nicht** — eine Nachricht im
Monat rechtfertigt weder die Einrichtung (VAPID-Schlüsselpaar, vier Secrets in
Supabase, zwei in GitHub, eines bei Vercel) noch den Schalter in den
Einstellungen.

Entfernt sind damit: der Einstellungsbereich, die Berechtigungsabfrage, die
Push-Teile des Service Workers, die Edge Function `monatsreport`, der
GitHub-Workflow, das Skript zur Schlüsselerzeugung und die Dokumentation dazu.
`0012_ohne_push.sql` räumt `push_subscriptions`, `v_last_month_report` und
`mark_report_sent()` ab.

**`0011_monatsreport.sql` bleibt unverändert stehen.** Sie ist bereits
ausgeführt, und eine Migration nachträglich umzuschreiben hieße, dass zwei
Datenbanken mit derselben Dateiliste verschieden aussehen können. Was einmal
lief, bleibt stehen; rückgängig macht es die nächste Datei.

**Der Service Worker selbst bleibt** — er gehört zur PWA. Übrig sind zwei
Ereignisse, die nur dafür sorgen, dass er sich selbst nicht im Weg steht;
zwischengespeichert wird weiterhin nichts. Angemeldet wird er jetzt beim Start
in `main.tsx`, nebenbei und ohne Warten: Bis Schritt 15 tat das die
Push-Anmeldung, und die gibt es nicht mehr.

### Ergänzt mit Schritt 14 (drei Kleinigkeiten)

**Die gedruckte Bon-Summe ist änderbar geworden.** Sie war die einzige Zahl auf
dem Korrektur-Screen, die nicht aus einer Position stammt, sondern vom Papier
abgelesen wurde — und genau deshalb bisher unantastbar. Nur wurde sie eben
manchmal falsch *gelesen*, und dann meldete der Summenabgleich für immer eine
Abweichung, an die niemand herankam. Geändert wird damit nicht die Tatsache,
sondern die **Lesung** der Tatsache. Sie steht weiterhin als Zahl da und nicht
als Eingabefeld — der Normalfall ist, dass sie stimmt —, und darunter steht
„vom Papier · antippen", nach einer Änderung „von dir korrigiert".

**`EXPECTED_MS` justiert sich jetzt selbst.** Die Zahlen waren geraten, und die
Konzeptdatei führte das als offene Kleinigkeit. Die tatsächliche Dauer war die
ganze Zeit bekannt: Die Edge Function gibt sie bei jedem Scan zurück
(`durationMs` je Durchgang), sie stand nur im Aufklappbereich. Jeder Scan
hinterlässt sie jetzt in `localStorage`, und die Schätzung ist der **Median der
letzten acht** (`src/lib/timing.ts`).

Drei Entscheidungen dazu: **Median statt Mittelwert**, damit ein Scan im
Funkloch den Balken nicht für zehn Scans träge macht. **Nur acht Messungen**,
damit ein Modell- oder Umzugswechsel sich in ein paar Scans durchsetzt statt in
Monaten. **`localStorage` statt Datenbank**, weil die Dauer am Gerät und an der
Leitung hängt und nicht am Haushalt. Erst ab drei Messungen wird gerechnet — bei
einer wäre die „Schätzung" schlicht der letzte Scan.

**Der Standard war ein abgeschaltetes Modell.** `pixtral-12b-2409` hat Mistral am
2. Dezember 2025 abgekündigt und zum **31. Dezember 2025 abgeschaltet**. Ein
Standardwert, der nachweislich nicht mehr existiert, ist kein Standard, sondern
ein Ausfall — deshalb steht dort jetzt der von Mistral benannte Nachfolger
`ministral-14b-latest` (bildfähig, Apache 2.0, freier Tarif). Das ist die eine
Stelle, an der ohne Rückfrage ein Standard geändert wurde, und der Grund ist,
dass die Alternative eine App gewesen wäre, die gar nichts mehr erkennt.

**`mistral-small-latest` als Bildmodell: eher nicht.** Die Vision-Seite der
Dokumentation führt `mistral-small-2506` als bildfähig und benutzt im Beispiel
`mistral-small-latest`; die Modellübersicht beschreibt das aktuelle Mistral Small
4 dagegen **nicht** als multimodal. Die beiden Seiten widersprechen sich, und der
Grund liegt nahe: Der Alias zeigte einmal auf ein bildfähiges Modell und zeigt
jetzt auf ein anderes. Wer Mistral Small ausprobieren will, sollte deshalb
`mistral-small-2506` festnageln statt den Alias zu nehmen — ein Alias, der
irgendwann keine Bilder mehr annimmt, erzeugt eine Ablehnung ohne erkennbare
Ursache. Die Möglichkeiten stehen als Tabelle in
`supabase/functions/README.md`, Abschnitt 1.1a.

### Die Sichten werden gegen erzeugte Testdaten geprüft

`supabase/tests/` legt eine wegwerfbare Datenbank an, spielt alle Migrationen
ein, schreibt vier Bons über `save_receipt` und rechnet die Sichten nach
(`npm run test:sql`). Der Grund: Die Auswertungen sind reine SQL-Logik — Summen,
Vergleiche, Zeitfenster, Schwellen —, und genau die lässt sich mit einer fast
leeren echten Datenbank *nicht* prüfen, weil der interessante Fall (zwei Läden,
ein Sonderangebot, ein Restaurantbesuch, ein Vormonat) darin gar nicht vorkommt.

Zwei Entscheidungen dazu:

- **Geschrieben wird über `save_receipt`, nicht mit `insert`.** Damit prüft schon
  das Anlegen der Testdaten den Schreibweg mit: Händler zusammenführen, Produkte
  anlegen, Merkmale hängen, Zuordnungen lernen. Ein `insert` von Hand stellte
  einen Zustand her, den die App nie erzeugt.
- **Gelaufen wird als eigene Rolle, nicht als Superuser.** Ein Superuser umgeht
  die Zeilensicherheit; dann prüfte man die Sichten ohne genau das, was sie
  absichern. So prüft jede Abfrage die Haushaltstrennung gleich mit — im
  Datenbestand steht ein zweiter Haushalt, dessen Zeilen nirgends auftauchen
  dürfen.

Der Lauf hängt an einer lokalen PostgreSQL-Instanz und gehört deshalb **nicht** in
`npm test`. Der bleibt, was er ist: Er läuft überall und ohne Einrichtung.

## Datenmodell-Grundsätze

- **Haushalt statt Einzelnutzer.** Alle Familienmitglieder sehen dieselben Daten. Jede
  Tabelle trägt `household_id`; RLS läuft über eine Mitgliedertabelle, nicht über
  `auth.uid()` direkt.
- **Geld immer als Integer in Cent.** Niemals Float, niemals vorformatierte Strings in der
  Datenschicht. Formatierung ausschließlich in der UI über `Intl.NumberFormat('de-DE')`.
- **Mengen strukturiert**: `quantity: number | null`, `unit: 'kg' | 'l' | 'stk' | null`.
  „ohne Mengenangabe" ist ein echter Zustand, kein Fehler.
- **Datum als ISO** in den Daten, `dd.MM.yyyy` in der Anzeige.
- **Kategorien als stabile Schlüssel** (`obst_gemuese`), nicht als deutsche Anzeigetexte.
  ~~Kategorien bleiben fest; nur Merkmale sind erweiterbar.~~ *Überholt mit
  Schritt 5a: Kategorien sind ebenfalls Tabellendaten und vom Nutzer
  erweiterbar. Der Schlüssel bleibt stabil — er entsteht beim Anlegen aus dem
  Namen und ändert sich danach nie wieder.*
- **Merkmale als Tabellendaten**, verknüpft über eine n:m-Tabelle
  `canonical_product_traits`. Kein Enum, kein Union-Typ, kein Array fester Werte.
- **Merkmale, Kategorie und Milchattribute hängen am kanonischen Produkt**, nicht an der
  einzelnen Bon-Position. Einmal gesetzt, gilt rückwirkend für alle Käufe.
- **Kanonische Produkte sind Pflicht.** Ohne `canonical_products` ist die
  Bestpreis-Ansicht nicht baubar.

## Gesundheitsleitbild

Unverarbeitete, natürliche Lebensmittel gelten als gesund. Als kritisch gelten
hochverarbeitete Produkte, Industriezucker, Samenöle und raffinierte Pflanzenfette,
glutenhaltige bzw. weizenhaltige Produkte sowie stark verarbeitete Milch. Das Leitbild ist
über die Merkmals-Konfiguration jederzeit verschärf- oder lockerbar; die obige Liste ist
nur die Voreinstellung.

## Fahrplan

| Schritt | Inhalt | Status |
|---|---|---|
| 1 | React+Vite+TS-Gerüst, Design-Tokens, alle 11 Screens auf Mock-Daten, PWA | erledigt |
| 2a | Supabase-Schema inkl. `household_id`, Merkmalstabellen und RLS | erledigt |
| 2b | Google-Login über Supabase Auth | erledigt |
| 2c | Mocks gegen echte Queries tauschen, Aggregationen als SQL-Views, Leerzustände | erledigt |
| 4a | Kamera im Screen: Livebild, Rückfallweg, Galerie, Verkleinern, Vorschau | erledigt |
| 4b-1 | Edge Function mit Mistral, Prompt aus den Merkmalen, JSON-Validierung, Anzeige im Korrektur-Screen | erledigt |
| 4b-2 | Speichern aus dem Korrektur-Screen: `product_mappings`, `canonical_products`, Bon und Positionen | erledigt |
| 4c | Erkennung in zwei Durchgängen: Struktur ohne Deutung, Zuordnung danach und nur für Unbekanntes | erledigt |
| 4d | Das Modell tippt nur noch Zeilen ab; die Aufteilung in Positionen macht der Code | erledigt |
| 5a | Migration `0004` (alle Schemaänderungen), Kategorieverwaltung, Auswärts essen mit Trinkgeld | erledigt |
| 5b | Fremdwährung mit EZB-Kurs, gespeicherte Bons bearbeiten | erledigt |
| — | Bestpreis- und Analyse-Logik als SQL-Views | mit 2c vorgezogen |
| — | Health-Score als Formel in `src/lib/score.ts` | erledigt |
| 6 | Verarbeitung im Hintergrund (`scan_jobs`) | erledigt |
| 7 | Spritkosten | erledigt |
| 8 | Bestpreise und Analysen scharf schalten | erledigt |
| 9 | Einkaufszettel | erledigt |
| 10 | Merkmale selbst anlegen und gewichten | erledigt |
| 11 | Einstellungen als Übersicht mit eigenen Screens | erledigt |
| 12 | Familie einladen | erledigt |
| 13 | Monatsreport als Push-Benachrichtigung | ~~gebaut~~ mit 15 wieder entfernt |
| 14 | Bon-Summe änderbar, `EXPECTED_MS` misst sich selbst, Modellwechsel | erledigt |
| 15 | Benachrichtigungen entfernt, Bon-Foto-Schalter entfernt, Bestpreise in die Analysen | erledigt |

Ab Schritt 6 zählt der Fahrplan aus `KONZEPT-ERWEITERUNGEN.md` weiter. Die
Nummerierung der beiden Dateien ist seit Schritt 5 dieselbe; 11 (Einstellungen)
kam dazu und stand in keinem der beiden Konzepte.

Der ursprüngliche Schritt 3 (Google-Login) wurde als 2b vorgezogen, weil ohne
Anmeldung keine Abfrage eine Zeile zurückgibt: Die Zugriffsregeln hängen am
angemeldeten Nutzer. Die Auswertungs-Sichten aus Schritt 5 entstanden mit 2c
mit, weil die Screens sie ohnehin brauchten, um überhaupt Zahlen zeigen zu
können.

**Wo der Health-Score lebt — und warum nur dort:** Die Formel samt Gruppenregel
steht in `src/lib/score.ts` und ist mit 28 Tests festgenagelt. In SQL steht sie
bewusst **nicht**. Die Datenbank liefert mit `v_score_items` nur die Zutaten
(Positionsbetrag und Merkmalsschlüssel je Position); gerechnet wird an genau
einer Stelle. Eine zweite Implementierung in SQL wäre eine zweite Wahrheit, die
beim nächsten Gewichtungswechsel auseinanderliefe.

Jeder Schritt wird einzeln beauftragt und abgenommen. Nicht vorgreifen.

## Arbeitsweise mit dem Nutzer

Der Nutzer ist Einsteiger im Web-Development. Konsequenzen:

- Entscheidungen begründen, aber nicht mit Optionen überschütten – eine klare Empfehlung
  aussprechen.
- Bei mehrdeutigen Anforderungen nachfragen statt raten.
- Keine ungefragten Zusatz-Features, keine zusätzlichen Abhängigkeiten ohne Rückfrage.
- Nach größeren Blöcken anhalten und zeigen, was läuft, bevor es weitergeht.

### Fertig heißt: auf `main`

**Jede Änderung wird nach `main` zusammengeführt, nicht nur als Pull Request
abgelegt.** Das gehört zur Aufgabe und ist kein zusätzlicher Schritt, um den
eigens gebeten werden müsste.

Der Grund: Der Nutzer testet ausschließlich in der laufenden App. Erst auf
`main` rollt GitHub Actions die Edge Function aus und erst von dort baut Vercel
die Oberfläche. Ein offener Pull Request ist für ihn unsichtbar — Arbeit, die
dort liegen bleibt, ist so gut wie nicht gemacht.

Der Pull Request bleibt trotzdem der Weg dorthin: Er hält fest, *was* geändert
wurde und warum, und macht es später nachlesbar. Er ist die Beschreibung, nicht
das Ziel.

**Geht das Zusammenführen ausnahmsweise nicht** — etwa weil ein Konflikt
besteht, eine Prüfung fehlschlägt oder die Berechtigung fehlt —, dann wird das
**ausdrücklich gesagt**, samt Grund und samt dem, was der Nutzer selbst tun
muss. Stillschweigend einen offenen Pull Request zu hinterlassen und ihn als
erledigt zu melden, ist der Fehler, den diese Regel verhindert.
