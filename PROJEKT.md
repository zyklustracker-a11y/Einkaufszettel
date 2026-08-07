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
- `receipt-ai-designsystem/project/Receipt AI.dc.html` – das verbindliche Design (11 Screens)
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
zeichnet auf ein `<canvas>` und erzeugt ein JPEG. Danach ohne Zwischenschritt weiter in den
Verarbeitungs-Screen.

**Automatischer Fallback:** Ist `getUserMedia` nicht verfügbar oder wird die Berechtigung
verweigert, wird ein verstecktes `<input type="file" accept="image/*" capture="environment">`
ausgelöst. Das öffnet die iOS-Kamera als Overlay über der App – auch hier kein Umweg über
die Galerie.

Bekannte iOS-Eigenheit: Installierte PWAs fragen die Kameraberechtigung teils bei jedem
Start neu ab. Kein Fehler in unserem Code; der Fallback fängt Verweigerung ab.

**Zusätzlich:** unauffälliger Sekundärweg „Aus Galerie wählen" (dasselbe Input ohne `capture`).

**Vor dem Upload wird das Bild verkleinert:** lange Kante max. 2000 px, JPEG-Qualität ca. 0,8.
Bons sind schmal und lang, deshalb nicht quadratisch zuschneiden.

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

Die Modellantwort wird **nie ungeprüft gespeichert.**

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
  Kategorien bleiben fest; nur Merkmale sind erweiterbar.
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
| 1 | React+Vite+TS-Gerüst, Design-Tokens, alle 11 Screens auf Mock-Daten, PWA | offen |
| 2 | Supabase-Schema inkl. `household_id`, Merkmalstabellen und RLS; Mocks gegen echte Queries tauschen | offen |
| 3 | Google-Login über Supabase Auth | offen |
| 4 | Kamera im Screen, Edge Function mit Mistral, JSON-Validierung, Speichern aus dem Korrektur-Screen | offen |
| 5 | Bestpreis- und Analyse-Logik als SQL-Views | offen |
| 6 | Health-Score, Merkmals-Verwaltung in den Einstellungen, Sparhinweise, Push zum Monatsreport | offen |

Jeder Schritt wird einzeln beauftragt und abgenommen. Nicht vorgreifen.

## Arbeitsweise mit dem Nutzer

Der Nutzer ist Einsteiger im Web-Development. Konsequenzen:

- Entscheidungen begründen, aber nicht mit Optionen überschütten – eine klare Empfehlung
  aussprechen.
- Bei mehrdeutigen Anforderungen nachfragen statt raten.
- Keine ungefragten Zusatz-Features, keine zusätzlichen Abhängigkeiten ohne Rückfrage.
- Nach größeren Blöcken anhalten und zeigen, was läuft, bevor es weitergeht.
