# Receipt AI – Konzept für die offenen Erweiterungen

Ergänzung zu `PROJEKT.md`. Beschreibt die noch nicht gebauten Funktionen im Detail.
Verbindlich, sobald der jeweilige Schritt beauftragt wird.

*Version 2 – ersetzt die erste Fassung. Angebote per Prospekt sind gestrichen, der
Einkaufszettel ist vorgezogen. Neu: eigene Kategorien, Verarbeitung im Hintergrund,
Spritkosten und Fremdwährung.*

---

# 1 – Auswärts essen

## Warum das kein Sonderfall ist

Ein Restaurantbesuch ist im Kern derselbe Vorgang wie ein Supermarkteinkauf: ein Beleg,
ein Händler, ein Datum, Positionen, eine Summe. Er wird deshalb nicht als eigener
Datentyp gebaut, sondern als Variante des bestehenden Bons. Drei Dinge unterscheiden ihn:
Trinkgeld, fehlende Produktvergleichbarkeit und eine andere Behandlung im Score.

## Schemaänderungen

**`merchants.kind`** – `retail` | `gastro`, Standard `retail`. Steuert das abweichende
Verhalten. Beim ersten Scan eines neuen Händlers schlägt das Modell die Art vor; der
Nutzer kann sie im Korrektur-Screen ändern. Einmal gesetzt, gilt sie für alle künftigen
Bons dieses Händlers.

**`receipts.tip_cents`** – `integer not null default 0`, `check (tip_cents >= 0)`.
Trinkgeld ist keine Bon-Position, sondern eine Eigenschaft des Belegs. Es steht meist gar
nicht auf dem Papier, wird also eingegeben, nicht gelesen.

**Kategorie `dining`** („Auswärts essen"), `is_food = true`.

**Merkmal `auswaerts`** („Auswärts gegessen", Kürzel `A`), Gewicht **0**, ohne Gruppe.
Landet damit im Abschnitt „Beobachtet" und verzerrt den Score nicht – bis der Nutzer
entscheidet, dass es ihn stören soll.

## Erfassung

Der Scan-Ablauf bleibt gleich. Restaurantbelege sind für ein Vision-Modell sogar
einfacher als Supermarktbons: weniger Positionen, keine Abkürzungen, kein Pfand.

**Trinkgeld wird abgefragt, nicht geraten.** Bei `kind = 'gastro'` zeigt der
Korrektur-Screen über dem Speichern-Knopf:

> **Trinkgeld gegeben?** [ Nein ] [ 5 % ] [ 10 % ] [ Eigener Betrag ]

Die Prozentknöpfe rechnen auf ganze Cent und füllen das Feld vor; überschreibbar.
Vorbelegung immer „Nein", damit niemand versehentlich Trinkgeld erfasst.

**Positionen bleiben erhalten**, auch wenn sie sich nicht vergleichen lassen. „2× Pizza
Margherita 11,50 €" ist nützlich, selbst wenn daraus nie ein Bestpreis wird.

## Auswirkungen

**Dashboard.** Die Kopfkarte zeigt heute drei Zahlen. Sie wird auf vier erweitert:
**Lebensmittel · Auswärts · Non-Food · Gesamt**. Auf 390 px ist das eng – deshalb „Gesamt"
groß in eigener Zeile, die drei Teilbeträge kleiner darunter.

**Trinkgeld** zählt in „Auswärts" und „Gesamt", in keine Produktkategorie.

**Kategorien-Diagramm.** `dining` mit eigener Farbe – nicht im Grünverlauf der
Lebensmittel, nicht im Grau von Non-Food. Vorschlag: warmes Bernstein, passend zu den
`--amber`-Token.

**Bestpreise.** Gastro-Positionen sind ausgeschlossen. „Pizza bei zwei Restaurants" wäre
Scheingenauigkeit – Portionsgrößen und Qualität sind nicht vergleichbar.

**Gesundheit.** Restaurantessen lässt sich nicht auf Zutaten auflösen. Die Positionen
tragen nur `auswaerts` und gehen nicht in den Score ein, solange dessen Gewicht 0 ist.
Eigene Karte: „Auswärts gegessen: 87 € in 6 Besuchen".

**Grenzfälle.** Lieferdienste sind `gastro`; Liefer- und Servicegebühr sind Positionen,
kein Trinkgeld. Eine Bäckerei bleibt `retail`, bis der Nutzer sie umstellt. Kantine und
Mensa sind `gastro`, üblicherweise ohne Trinkgeld.

---

# 2 – Eigene Kategorien

## Der Kern: es funktioniert bereits automatisch

Der Erkennungs-Prompt wird zur Laufzeit aus den Kategorien und Merkmalen des Haushalts
zusammengebaut. Eine neu angelegte Kategorie wirkt daher **ab dem nächsten Scan**, ohne
Codeänderung und ohne neues Ausrollen. Legt der Nutzer „Gewürze" an, ordnet das Modell
Zimt und Pfeffer selbst zu.

Es fehlt ausschließlich die Bedienoberfläche.

## Schemaänderung

**`categories.description`** – Kurze Erklärung, die in den Prompt fließt, analog zu
`traits.description`. Ohne sie muss das Modell aus dem Namen raten. Bei „Gewürze" geht
das; bei einem selbst erfundenen Namen wie „Vorratskammer" nicht.

**`categories.active`** – Deaktivieren statt löschen. Kategorien werden von
`canonical_products` referenziert; ein Löschen würde bestehende Produkte brechen. Eine
deaktivierte Kategorie erscheint nicht mehr im Prompt und nicht in der Auswahl, bleibt
aber für Altdaten gültig.

**`categories.color`** – Bisher liegen die neun Farben im Code. Mit frei anlegbaren
Kategorien muss die Farbe zur Kategorie gehören. Beim Anlegen wird automatisch eine noch
freie Farbe aus der Palette vergeben, änderbar.

## Bedienung

Neuer Bereich in den Einstellungen, analog zur Merkmalsliste:

- Anlegen: Name, Erklärung fürs Modell, Lebensmittel ja/nein, Farbe
- Umbenennen, Erklärung ändern, Farbe ändern, Reihenfolge ändern
- Deaktivieren (mit Hinweis, wie viele Produkte betroffen sind)
- Die neun mitgelieferten Kategorien sind änderbar, aber als solche gekennzeichnet

Der stabile `key` wird beim Anlegen aus dem Namen abgeleitet und ist danach
unveränderlich – der Anzeigename bleibt frei änderbar. Das ist derselbe Grundsatz wie bei
den Merkmalen: Anzeigetexte ändern sich, Datenbankwerte nicht.

## Was der Nutzer wissen muss

Eine neue Kategorie wirkt **nicht rückwirkend**. Bereits erfasste Produkte behalten ihre
alte Zuordnung, bis sie von Hand geändert werden. Der Einstellungsbereich soll das sagen
und anbieten, betroffene Produkte zu suchen.

---

# 3 – Verarbeitung im Hintergrund

## Das Problem

Wechselt der Nutzer während des Scans in eine andere App, friert Safari die Seite ein.
Die Edge Function rechnet serverseitig weiter, aber die Antwort kommt nirgends an. Beim
Zurückkommen hängt der Verarbeitungs-Screen oder läuft in die Zeitüberschreitung – obwohl
das Ergebnis längst fertig war.

Bei rund 15 Sekunden Scan-Dauer ist das keine Randerscheinung.

## Lösung: Ergebnis serverseitig ablegen

**Neue Tabelle `scan_jobs`**: `household_id`, `status` (`running` | `done` | `failed`),
`result` (jsonb), `error_code`, `created_at`, `finished_at`.

Ablauf:

1. Die App legt einen Job an und schickt das Bild an die Edge Function.
2. Die Function schreibt ihr Ergebnis in den Job – nicht nur in die Antwort.
3. Die App wartet auf die Antwort wie bisher. Kommt sie an, wird der Job direkt benutzt.
4. Kommt sie **nicht** an, weil die Seite eingefroren war, fragt die App beim Zurückkommen
   den offenen Job ab und zeigt das Ergebnis.

**Das Bon-Foto wird weiterhin nicht gespeichert.** Es geht wie bisher durch die Function
und wird danach verworfen. In `scan_jobs` liegen nur die erkannten Daten.

**Aufräumen:** Jobs älter als 24 Stunden werden gelöscht. Sie sind ein Zwischenspeicher,
kein Archiv.

**Beim Start der App** wird geprüft, ob ein offener Job existiert. Falls ja, bietet die
App an, direkt zum Korrektur-Screen zu springen – der Scan geht also auch dann nicht
verloren, wenn iOS die Seite komplett aus dem Speicher geworfen hat.

**Grenze, die bleibt:** Wird die Seite entladen, ist das aufgenommene Bild weg. Das
Ergebnis lässt sich retten, das Bild nicht. Das ist hinnehmbar, weil das Ergebnis der
teure Teil ist.

---

# 4 – Spritkosten

## Kein Sonderfall

Ein Tankbeleg ist für die App ein gewöhnlicher Bon mit einer Position: Menge in Litern,
Preis pro Liter, Gesamtbetrag. Damit greifen Bestpreis, Grundpreis und Preisverlauf
**ohne zusätzlichen Bau**. Nach ein paar Tankfüllungen zeigt die App, welche Tankstelle
günstiger ist und wie sich der Spritpreis entwickelt.

## Was nötig ist

**Kategorie `kraftstoff`** („Kraftstoff"), `is_food = false`. Entsteht über die
Kategorieverwaltung aus Teil 2, braucht keinen eigenen Code.

**Menge:** `quantity_unit = 'l'`, `quantity_base` in Millilitern (45,2 l → 45200). Passt
ins bestehende Schema.

**Prompt-Ergänzung:** Tankbelege sind anders aufgebaut als Supermarktbons – Zapfsäule,
Kraftstoffart, Liter, Preis je Liter. Der Struktur-Prompt braucht dafür kein neues
Konzept, aber ein Beispiel, damit die Literzeile nicht als Mengenzeile im Supermarktsinn
gelesen wird.

**Dashboard:** Kraftstoff ist Non-Food und erscheint dort. Ob er eine eigene Zahl in der
Kopfkarte bekommt, entscheidet sich, wenn Auswärts essen gebaut ist – vier Zahlen sind
bereits eng, fünf wären zu viel. Vorschlag: Kraftstoff bleibt in Non-Food, bekommt aber
in den Analysen eine eigene Auswertung (Verbrauch, €/l im Zeitverlauf, Kosten je Monat).

---

# 5 – Fremdwährung

## Die Anforderung und ihre Tücke

Der Nutzer lebt an der deutsch-schweizerischen Grenze und zahlt manchmal in Franken. Die
Anzeige soll durchgehend in Euro erfolgen.

**Nicht umsetzbar wie wörtlich gewünscht:** Einen CHF-Betrag unverändert als Euro zu
übernehmen, würde die Zahlen verfälschen – 50 CHF sind rund 53 €. Monatssummen wären
dauerhaft zu niedrig, und ein Preisvergleich zwischen einer Schweizer und einer deutschen
Tankstelle wäre wertlos.

**Umzusetzen ist:** in Euro *anzeigen*, aber *umgerechnet*.

## Schemaänderung

Auf `receipts`:

- `currency` – `EUR` | `CHF`, Standard `EUR`
- `original_total_cents` – der Betrag in der Bonwährung
- `exchange_rate` – der beim Speichern verwendete Kurs, `numeric(10,6)`

Die bestehenden Cent-Felder halten weiterhin **Euro**. Alle Auswertungen rechnen
unverändert weiter, ohne von Währungen zu wissen.

**Der Kurs wird beim Speichern eingefroren.** Ändert sich der Wechselkurs, bleiben alte
Bons unverändert – sonst würden sich Monatssummen der Vergangenheit rückwirkend ändern,
und niemand könnte den Zahlen mehr trauen.

## Kurs automatisch beschaffen – kein Einstellungsfeld

**Ausdrücklicher Wunsch des Nutzers:** In den Einstellungen soll nichts zum Wechselkurs
stehen. Die App holt ihn selbst.

Die Europäische Zentralbank veröffentlicht ihre Referenzkurse frei zugänglich, ohne
Anmeldung und ohne Schlüssel – tagesaktuell und historisch.

**Der Abruf passiert in der Edge Function**, nicht im Browser: dort liegen die
Netzwerkrechte, und das Ergebnis lässt sich gleich zwischenspeichern.

**Er passiert nur im Bedarfsfall.** Erkennt der Struktur-Durchgang eine andere Währung als
Euro, wird der Kurs geholt. Bei deutschen Bons – dem Normalfall – passiert gar nichts.
Erkennungsmerkmale sind das Währungszeichen auf dem Bon (`CHF`, `Fr.`) und die Anschrift
des Händlers.

**Der Kurs richtet sich nach dem Bon-Datum, nicht nach heute.** Ein Tankbeleg von vor zwei
Wochen bekommt den damaligen Kurs. Das kostet nichts zusätzlich und macht die Zahl
korrekt statt ungefähr.

## Zwischenspeicher

**Neue Tabelle `exchange_rates`**: `date`, `currency`, `rate`, `fetched_at`.
Primärschlüssel aus `date` und `currency`. Ein Tag wird höchstens einmal abgefragt.

Die Tabelle ist **nicht** an einen Haushalt gebunden – ein Wechselkurs ist eine öffentliche
Tatsache, keine private Angabe. Lesen dürfen ihn alle angemeldeten Nutzer, schreiben nur
die Edge Function.

## Zwei Fälle, die abgefangen werden müssen

**Wochenenden und Feiertage.** Die EZB veröffentlicht an solchen Tagen keinen Kurs. Dann
wird der letzte verfügbare Werktag verwendet, und der tatsächlich benutzte Stichtag wird
mitgespeichert – damit später nachvollziehbar bleibt, woher die Zahl stammt.

**Abruf schlägt fehl** (Netz, Ausfall, unbekannte Währung). Das darf das Speichern **nicht**
blockieren. Der Korrektur-Screen zeigt dann ein Feld für den Kurs, nur für diesen einen
Bon, mit dem Hinweis, warum es erscheint. Das ist der Ausnahmefall – ein dauerhaftes
Einstellungsfeld bleibt es ausdrücklich nicht.

## Bedienung

Erkennt das Modell eine andere Währung, zeigt der Korrektur-Screen einen ruhigen Hinweis:

> Dieser Bon ist in CHF. Umgerechnet zum EZB-Kurs vom 07.08.2026: **53,12 €**
> *(45,00 CHF · Kurs 1,1805)*

Der Kurs ist antippbar und überschreibbar, falls er im Einzelfall nicht passen sollte.
Gespeichert wird immer der tatsächlich verwendete Wert – der Bon bleibt damit dauerhaft
nachvollziehbar, auch wenn sich der Kurs später ändert.

Im Einkaufs-Detail steht der Originalbetrag zusätzlich unter dem Euro-Betrag.

Der Mechanismus ist nicht auf Franken beschränkt: Jede Währung, für die die EZB einen Kurs
veröffentlicht, funktioniert ohne weitere Arbeit.

---

# 6 – Einkaufszettel

Neuer fünfter Tab. Angebote per Prospekt sind gestrichen – die Kostenschätzung stützt
sich auf die eigenen Bestpreise aus der Kaufhistorie.

## Tab-Leiste

Fünf Tabs plus Scan-Knopf ergeben sechs Positionen, je rund 62 px auf einem 390-px-iPhone.
Die Beschriftungen müssen kurz sein: **Übersicht · Preise · Zettel · Analysen · Gesund**.
Wirkt das am Gerät zu gedrängt, sitzt der Zettel stattdessen als Karte im Dashboard. Die
Entscheidung fällt am Gerät.

## Fortschritt ab dem ersten Bon

Der Tab existiert von Anfang an und zeigt, wie weit die App ist. **Schwelle: mindestens
14 Tage und mindestens 4 Einkäufe** – beides zusammen, weil Zeit allein nichts nützt,
wenn nicht eingekauft wurde.

> **Dein Einkaufszettel entsteht gerade**
>
> Ich lerne aus deinen Einkäufen, was du regelmäßig brauchst.
>
> ▓▓▓▓▓▓▓▓░░░░ **3 von 4 Einkäufen**
> ▓▓▓▓▓▓▓▓▓▓░░ **11 von 14 Tagen**
>
> Noch 1 Einkauf und 3 Tage, dann kann ich dir einen Zettel vorschlagen.
>
> *Schon erkannt: H-Milch alle 6 Tage · Bananen alle 8 Tage*

Die letzte Zeile ist wichtig: Sobald ein Produkt dreimal gekauft wurde, erscheint es dort
– auch wenn die Gesamtschwelle noch nicht erreicht ist. Der Nutzer sieht echte
Zwischenergebnisse statt nur einen Balken.

Der Balken kann rückwärts gehen, wenn ein Bon gelöscht wird. Das ist richtig so.

Nach Erreichen der Schwelle bleibt ein dezenter Hinweis: „Basiert auf 4 Einkäufen – wird
mit jedem weiteren genauer."

## Erkennung

Für jedes kanonische Produkt mit **mindestens drei Käufen**:

- **Kaufrhythmus**: Median des Abstands zwischen Käufen (nicht Mittelwert – ein Urlaub
  soll das Ergebnis nicht kippen)
- **Streuung**: stabil (Milch alle 6–8 Tage) oder zufällig (Grillkohle)? Nur stabile
  Produkte kommen ungefragt auf den Zettel
- **Fälligkeit**: letzter Kauf plus Rhythmus gegen heute
- **Übliche Menge**: Median der gekauften Mengen
- **Erwarteter Preis**: aktueller Bestpreis mal Menge

## Anzeige

Liste nach Kategorie gruppiert (so, wie man den Laden durchläuft), je Eintrag Name,
übliche Menge, erwarteter Preis, Händler mit dem Bestpreis, und die Begründung: „zuletzt
vor 9 Tagen · üblich alle 7". Oben eine Summe, bei knappem Budget ein Hinweis.

Positionen sind entfernbar, Mengen änderbar, eigene Einträge hinzufügbar – auch freie
Texte ohne bekanntes Produkt.

## Speicherung

**Neue Tabellen:** `shopping_lists` (`household_id`, `created_at`, `completed_at`) und
`shopping_list_items` (Liste, optional `canonical_product_id`, freier Text, Menge,
`checked`, `source` = `suggestion` | `manual`, erwarteter Preis in Cent).

Eine offene Liste je Haushalt. Neue Vorschläge werden ergänzt, ohne bestehende Einträge zu
überschreiben. Ein entfernter Vorschlag kommt in diesem Durchgang nicht wieder.

**Abgleich nach dem Einkauf:** Beim Speichern eines Bons hakt die App die Positionen ab,
die auf dem Zettel stehen: „5 von 7 erledigt". Schließt den Kreis zwischen Planung und
Erfassung, ohne Zutun.

---

# Fahrplan

| Schritt | Inhalt | Warum dort |
|---|---|---|
| **5** | Auswärts essen, eigene Kategorien, Fremdwährung mit EZB-Abruf – alle Schemaänderungen in einer Migration | Schemaänderungen sind jetzt billig und werden mit jedem Bon teurer |
| **6** | Verarbeitung im Hintergrund | Betrifft den Scan-Ablauf, den man täglich benutzt |
| **7** | Spritkosten | Braucht nur die Kategorieverwaltung aus 5 plus eine Prompt-Ergänzung |
| **8** | Bestpreise und Analysen scharf schalten | Braucht Bons zum Vergleichen |
| **9** | Einkaufszettel | Braucht 4 Einkäufe und 14 Tage |
| **10** | Merkmale selbst anlegen und gewichten | Jederzeit machbar |
| **11** | Familie einladen | Wenn der Nutzer soweit ist |
| **12** | Monatsreport als Push-Benachrichtigung | Zum Schluss |

**Zwischen 7 und 8 sollte der Nutzer einige Wochen einfach einkaufen und scannen.** Die
Auswertungen werden erst mit Daten sichtbar, und dann zeigt sich auch, was tatsächlich
fehlt.

# Beim Bauen von Schritt 5 entschieden

Drei Stellen weichen bewusst vom Wortlaut oben ab. Die Begründungen stehen
ausführlich in `PROJEKT.md` unter „Ergänzt mit Schritt 5a"; hier nur, *was*
anders ist, damit beim Weiterlesen niemand nach etwas sucht, das es nicht gibt:

- **Die Kategorie heißt `auswaerts_essen`, nicht `dining`.** Sie entsteht über
  die Kategorieverwaltung, und der Schlüssel wird dort aus dem Namen abgeleitet.
  Wichtiger: **kein Code rechnet mit ihrem Schlüssel.** Was als „Auswärts" zählt,
  entscheidet `merchants.kind` — der Ausschluss aus den Bestpreisen hängt ohnehin
  am Händler, und so ergeben die drei Teilbeträge der Kopfkarte exakt die
  Gesamtsumme.
- **Die Händlerart schlägt nicht das Modell vor, sondern die Datenbank.**
  Durchgang 1 ist seit Schritt 4d ein reiner Abschreiber; eine zusätzliche
  Deutungsaufgabe dort hat schon zweimal Beträge gekostet. Ein bekannter Laden
  bringt seine Art mit, ein neues Restaurant kostet einen Tipper — danach nie
  wieder.
- **`exchange_rates.date` heißt `rate_date`.** `date` ist in PostgreSQL als
  Spaltenname zwar erlaubt, liest sich aber wie ein Typ.
- **Der Kurs-Zwischenspeicher hält nur echte Veröffentlichungstage.** Ein Bon vom
  Samstag löst deshalb jedes Mal einen Abruf aus, statt dass ein erfundener
  Samstags-Eintrag entsteht — sonst verlöre `receipts.rate_date` seine Aussage.
  Für Werktagsbons, den Normalfall, wird ein Tag genau einmal abgefragt.
- **Beim Bearbeiten eines Fremdwährungsbons wird nicht zurückgerechnet.** Die
  Beträge stehen dann in Euro, so wie sie gespeichert sind; ein Rundgang Euro →
  Franken → Euro verschöbe sonst bei jedem Bearbeiten einzelne Zeilen um einen
  Cent.

# Beim Bauen von Schritt 6 und 7 entschieden

**Schritt 6 (Verarbeitung im Hintergrund).** Der Ablauf ist der aus Abschnitt 3,
mit drei Präzisierungen:

- **Im Job liegt nur Durchgang 1.** Die Zuordnung läuft erst, wenn die App
  wieder wach ist — sie ist billig, braucht kein Bild und soll mit den Merkmalen
  von heute laufen.
- **Ein offener Job gehört dem Gerät, nicht dem Haushalt.** Sonst bekäme die
  ganze Familie die Meldung „Ein Scan ist fertig", sobald irgendwer irgendwo
  einen Bon fotografiert.
- **Aufgeräumt wird beim Anlegen des nächsten Jobs**, nicht nach Zeitplan. Für
  einen Zwischenspeicher wäre ein eigener `pg_cron`-Auftrag zu viel Maschinerie.

**Schritt 7 (Spritkosten).** Drei Stellen weichen vom Wortlaut oben ab:

- **`kraftstoff` steht als Schlüssel im Code.** Bei „Auswärts essen" wurde das
  ausdrücklich vermieden; dort ist die Händlerart der bessere Anker. Für Sprit
  gibt es keinen — eine Tankstelle verkauft auch Kaffee. `kraftstoff` ist deshalb
  eine mitgelieferte Kategorie mit festem Schlüssel, wie `dairy`.
- **„Verbrauch" heißt Liter je Monat, nicht Liter je 100 km.** Auf einem
  Tankbeleg steht kein Kilometerstand, und eine Verbrauchsangabe aus lückenhaften
  Kilometerständen wäre schlimmer als keine.
- **Die Prompt-Ergänzung allein hätte nicht gereicht.** Der Literpreis hat drei
  Nachkommastellen; das Muster in `lines.ts` verlangte zwei und las aus „1,779"
  ein „1,77". Und die Plausibilitätsprüfung hätte den Literpreis verworfen, weil
  sich der halbe Cent Rundung über 38 Liter auf drei Cent summiert. Beides ist
  nachgebessert und mit Tests festgenagelt.

# Beim Bauen von Schritt 8 und 9 entschieden

**Schritt 8 (Bestpreise und Analysen).** Die Auswertungen rechneten längst gegen
echte Daten; es fehlten Schwellen. Dazu kam ein Fund: Der Grundpreis war die
ganze Zeit leer, weil er aus `canonical_products.size_base` kam — einer Spalte,
die `save_receipt` nie füllt. Er wird jetzt aus dem Einzelpreis gewonnen, der bei
Ware nach Gewicht ohnehin der Grundpreis ist.

**Schritt 9 (Einkaufszettel).** Vier Stellen weichen vom Wortlaut oben ab:

- **Der Zettel ist ein eigener Tab.** Die Entscheidung fällt zugunsten des Tabs,
  weil er im Laden benutzt wird — eine Dashboard-Karte kostet dort einen Tipper
  und eine Scrollbewegung. Dafür heißen zwei Tabs kürzer: „Preise" und
  „Gesund", wie im Abschnitt oben vorgeschlagen.
- **Der erwartete Preis ist der günstigste tatsächlich bezahlte Zeilenbetrag**
  der letzten sechs Monate, nicht Bestpreis × Menge. Ein Einzelpreis mal einer
  Medianmenge ergibt eine Zahl, die so nie auf einem Bon stand.
- **Die Streuung wird über den Quartilsabstand gemessen** (höchstens 60 % des
  Medians, mindestens vier Tage Spielraum). Er ist gegen Ausreißer
  unempfindlich, und die sind hier der Normalfall.
- **Die Liste gibt es ab dem ersten Tag, die Vorschläge erst ab der Schwelle.**
  Ein Zettel, auf den man nichts schreiben darf, ist kein Zettel.

# Offene Kleinigkeiten

- ~~**„Korrigieren" im Einkaufs-Detail**~~ *Erledigt mit Schritt 5b. Der Knopf
  heißt jetzt „Bearbeiten" und führt in denselben Korrektur-Screen — diesmal
  hält er, was er verspricht: Der gespeicherte Bon wird in dieselbe Entwurfsform
  geladen wie ein frisch gescannter, und beim Sichern wird er aktualisiert statt
  ein zweiter angelegt.*
- **Zeitschätzung des Fortschrittsbalkens** (`EXPECTED_MS` in `src/lib/progress.ts`) ist
  geraten. Nachjustieren, sobald die tatsächliche Dauer im Alltag bekannt ist.
- **`mistral-small-latest` als Modellalternative** testen, falls die Erkennung wieder
  Zeilen verschluckt. `pixtral-large-latest` ist kostenpflichtig und scheidet aus.
