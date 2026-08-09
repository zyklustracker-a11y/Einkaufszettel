# Die Edge Function „erkennen" einrichten

Diese Funktion nimmt ein Bon-Foto entgegen, fragt Mistral, prüft die Antwort und
gibt strukturierte Bon-Daten zurück. Sie ist der einzige Ort, an dem der
Mistral-Schlüssel liegt — im Browser taucht er nie auf.

**Stand Schritt 4b-1: Die Funktion schreibt nichts in die Datenbank.** Sie liest
nur die Merkmale und Kategorien deines Haushalts, um daraus den Prompt zu bauen.
Das Speichern kommt in 4b-2.

---

## 1. Was du in Supabase einrichten musst

### 1.1 Das Secret mit dem Mistral-Schlüssel

Du hast es nach eigener Angabe schon hinterlegt — hier steht trotzdem, wo:

**Supabase → Project Settings → Edge Functions → Secrets → Add new secret**

| Name | Wert |
|---|---|
| `MISTRAL_API_KEY` | dein Schlüssel von [console.mistral.ai](https://console.mistral.ai) |

Der Name muss **exakt** so geschrieben sein, in Großbuchstaben mit Unterstrichen.
Fehlt er, meldet die App: „Die Bon-Erkennung ist noch nicht eingerichtet."

**Optional**, falls du ein anderes Modell probieren willst:

| Name | Wert | Voreinstellung |
|---|---|---|
| `MISTRAL_MODEL` | z. B. `ministral-14b-2512` | `ministral-14b-latest` |
| `MISTRAL_TEXT_MODEL` | z. B. `ministral-8b-latest` | `mistral-small-latest` |

Ohne diese Secrets nimmt die Funktion `ministral-14b-latest` für Durchgang 1 und
`mistral-small-latest` für Durchgang 2. Der zweite Durchgang sieht kein Bild mehr
und braucht deshalb kein Vision-Modell — ein Textmodell ist dort schneller und
billiger.

> **Wichtig, falls du das Secret `MISTRAL_MODEL` gesetzt hast:** Bis Schritt 14
> stand hier `pixtral-12b-2409`. Mistral hat dieses Modell am 2. Dezember 2025
> abgekündigt und zum **31. Dezember 2025 abgeschaltet**. Steht der Name noch in
> deinen Secrets, **entferne ihn** — sonst läuft die Erkennung ins Leere und die
> App meldet „Die Bon-Erkennung hat die Anfrage abgelehnt". Ohne das Secret gilt
> die neue Voreinstellung.

### 1.1a Taugt `mistral-small-latest` als Bildmodell?

Kurz: **eher nicht mehr, und `ministral-14b-latest` ist die klarere Wahl.**

Die Vision-Seite der Mistral-Dokumentation führt `mistral-small-2506` unter den
bildfähigen Modellen und benutzt im Python-Beispiel `mistral-small-latest`. Die
Modellübersicht beschreibt das aktuelle **Mistral Small 4** (v26.03) dagegen
**nicht** als multimodal. Die beiden Seiten widersprechen sich, und der Grund
liegt nahe: `mistral-small-latest` zeigte einmal auf ein bildfähiges Modell und
zeigt jetzt auf ein anderes.

Daraus folgen drei brauchbare Möglichkeiten, falls die Erkennung wieder Zeilen
verschluckt:

| `MISTRAL_MODEL` | wofür |
|---|---|
| *(nicht gesetzt)* | `ministral-14b-latest` – bildfähig, Apache 2.0, freier Tarif |
| `mistral-small-2506` | die alte, sicher bildfähige Fassung von Mistral Small, festgenagelt |
| `mistral-medium-2508` | größer und teurer; nur ausprobieren, wenn die anderen beiden versagen |

`mistral-small-latest` **ohne Datum** ist die schlechteste der drei: Sie kann
jederzeit auf ein Modell zeigen, das keine Bilder mehr annimmt — und dann meldet
die App eine Ablehnung, ohne dass sich etwas geändert hätte.

Umgestellt wird in Supabase → Project Settings → Edge Functions → Secrets. Die
Funktion muss dafür **nicht** neu ausgerollt werden; das Secret wirkt ab dem
nächsten Aufruf.

> **Nicht jedes Modell ist im freien Tarif erlaubt.** `pixtral-large-latest`
> etwa gibt es, es gehört aber zum kostenpflichtigen Tarif und wird abgelehnt.
> Passiert das, sagt die App es seit Schritt 4d klar: Sie nennt den benutzten
> Modellnamen und den Wortlaut der Schnittstelle, statt „nicht erreichbar" zu
> melden. Secret wieder entfernen, und es läuft mit der Voreinstellung weiter.

> `SUPABASE_URL` und `SUPABASE_ANON_KEY` brauchst du **nicht** anzulegen. Die
> setzt Supabase in jeder Edge Function von selbst.

### 1.2 Ausrollen aus GitHub — der eingerichtete Weg

Die Funktion rollt sich selbst aus, sobald sich etwas an ihr ändert. Dafür sorgt
`.github/workflows/edge-functions.yml`. Du musst dafür **einmalig zwei
Geheimnisse in GitHub hinterlegen** — danach nie wieder etwas kopieren.

**Schritt 1 — Zugangs-Token in Supabase erzeugen:**

Supabase → oben rechts aufs Konto → **Account Settings** → **Access Tokens** →
**Generate new token**. Name egal, etwa „GitHub Actions". Der Wert wird **nur
einmal angezeigt** — gleich kopieren.

**Schritt 2 — die Projekt-Kennung heraussuchen:**

Supabase → **Project Settings** → **General** → **Reference ID**. Das ist eine
Zeichenfolge wie `abcdefghijklmnopqrst`. Sie steht auch in der Adresse deines
Projekts hinter `/project/`.

**Schritt 3 — beides in GitHub eintragen:**

GitHub → dein Repository → **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret**. Zweimal, mit genau diesen Namen:

| Name | Wert |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | das Token aus Schritt 1 |
| `SUPABASE_PROJECT_ID` | die Reference ID aus Schritt 2 |

**Schritt 4 — einmal auslösen:**

GitHub → **Actions** → **Edge Functions ausrollen** → **Run workflow**. Beim
ersten Mal von Hand, weil seit dem Zusammenführen nach `main` nichts mehr an der
Funktion geändert wurde. Danach passiert es von selbst: Jede Änderung unter
`supabase/functions/` löst das Ausrollen aus.

Der Lauf dauert gut eine Minute. Vorher laufen die Tests — schlagen sie fehl,
geht nichts nach Supabase.

> **Kostet das etwas?** Nein. GitHub Actions ist für öffentliche Repositories
> unbegrenzt und für private mit 2000 Minuten im Monat kostenlos. Bei gut einer
> Minute pro Lauf reicht das für rund 1500 Ausrollungen.

### 1.3 Ausrollen von Hand — falls du es doch einmal brauchst

**Über die Weboberfläche:** Supabase → **Edge Functions** → **Deploy a new
function** → **Via Editor**, Name `erkennen` (genau so, klein geschrieben — die
App ruft diese Adresse auf), dann die acht Dateien anlegen: `index.ts`,
`prompt.ts`, `mistral.ts`, `validate.ts`, `lines.ts`, `assign.ts`,
`mappings.ts`, `rates.ts`. Die
`*.test.ts` werden nicht gebraucht, die Tests laufen auf deinem Rechner.

**Mit der Supabase-CLI:**

```bash
npx supabase login
npx supabase functions deploy erkennen --project-ref DEIN-PROJEKT-REF
```

Und das Secret ließe sich so setzen, statt über die Weboberfläche:

```bash
npx supabase secrets set MISTRAL_API_KEY=dein-schluessel
```

### 1.4 Sonst nichts

Kein Storage-Bucket (das Bild wird nicht abgelegt, nur durchgereicht), keine
neue Migration, keine Änderung an den Zugriffsregeln, keine neuen Werte in der
`.env` der App. Die App findet die Funktion über `VITE_SUPABASE_URL`, das schon
eingetragen ist.

---

## 2. Prüfen, ob es läuft

1. In der App einen Bon scannen und auf **Verwenden** tippen.
2. Der Verarbeitungs-Screen zeigt drei Schritte. Nach 5–30 Sekunden springt er
   in den Korrektur-Screen.
3. Ganz unten dort: **Rohantwort des Modells** aufklappen. Da steht wörtlich,
   was Mistral geantwortet hat.

Läuft etwas schief, sagt die App auf Deutsch, was los ist. Die technische
Ursache steht im Protokoll: **Supabase → Edge Functions → erkennen → Logs**.

| Meldung in der App | Was zu tun ist |
|---|---|
| „…noch nicht eingerichtet: In Supabase fehlt das Secret MISTRAL_API_KEY" | Secret anlegen (1.1) |
| „Bitte melde dich an" / „Anmeldung ist abgelaufen" | einmal ab- und wieder anmelden |
| „Das Kontingent bei Mistral ist gerade erschöpft" | ein paar Minuten warten; die Funktion hat schon dreimal mit Pause wiederholt |
| „Die Antwort der Erkennung war unbrauchbar" | Rohantwort ansehen, Prompt nachschärfen (siehe unten) |
| „Auf dem Foto war kein lesbarer Kassenzettel" | Bon flach hinlegen, mehr Licht, ganze Länge im Rahmen |
| „Die Bon-Erkennung ist auf dem Server nicht eingerichtet" | Funktion heißt nicht `erkennen` oder wurde nicht ausgerollt |

---

## 3. Den Prompt nachschärfen

Das ist der Teil, den du selbst machen kannst und sollst.

**Nur eine Datei ist dafür da: `supabase/functions/erkennen/prompt.ts`.**

Sie ist so geschrieben, dass du kein TypeScript brauchst: Alles zwischen den
Backticks ist normaler Text ans Modell, alles hinter `//` sind Notizen für dich.

**Sie enthält zwei Prompts, und die Frage „welcher?" beantwortest du zuerst:**

| Was schiefging | Welcher Prompt |
|---|---|
| Eine gedruckte Zeile fehlt in der Abschrift, Text falsch gelesen, Betrag verlesen | **Durchgang 1 — Struktur** |
| Name unschön, falsche Kategorie, fehlendes oder erfundenes Merkmal, Milch falsch eingeordnet | **Durchgang 2 — Zuordnung** |

Die Faustregel: Geht es um **das, was auf dem Papier steht**, ist es Durchgang 1.
Geht es um **Bedeutung**, ist es Durchgang 2. Im Korrektur-Screen stehen unter
„Rohantworten des Modells" beide Antworten getrennt untereinander — daran siehst
du sofort, welcher der beiden danebenlag.

**Wie Positionen entstehen, ist seit Schritt 4d kein Prompt-Thema mehr.** Das
Modell tippt nur noch Zeilen ab; was davon eine Position ist, entscheidet
`lines.ts` im Code. Wenn also zwei Artikel zu einem verschmelzen oder eine
Mengenzeile falsch hängt, ist das **kein** Fall für den Prompt, sondern für
`lines.ts` — und dort gehört ein Test dazu. Im Korrektur-Screen zeigt der
Aufklappbereich „Abgetippte Zeilen", welche gedruckte Zeile zu welcher Position
wurde. Fehlt eine Zeile schon dort, hat das Modell sie übersehen: Dann hilft ein
besseres Foto oder ein anderes Modell, kein zusätzlicher Satz im Prompt.

Der Ablauf:

1. Bon scannen, im Korrektur-Screen die **Rohantworten** ansehen.
2. Fehler benennen und dem richtigen Durchgang zuordnen (Tabelle oben).
3. Den passenden Abschnitt in `prompt.ts` ergänzen — am besten mit einem
   Beispiel, so wie es die anderen Regeln dort auch machen.
4. Änderung nach `main` bringen. Das Ausrollen passiert von selbst (1.2); unter
   GitHub → **Actions** siehst du, wann es durch ist.
5. Denselben Bon noch einmal scannen und vergleichen.

**Merkmale und Kategorien musst du dafür nicht anfassen.** Die setzt die
Funktion zur Laufzeit aus der Datenbank in den Zuordnungs-Prompt ein: Legst du
in `traits` ein neues aktives Merkmal an, kennt das Modell es ab dem nächsten
Scan — ohne Ausrollen, ohne Codeänderung. Schaltest du eines ab, verschwindet es
aus dem Prompt. Und Merkmalsschlüssel, die das Modell erfindet, wirft `assign.ts`
weg.

Der Struktur-Prompt kennt die Merkmale **gar nicht** — er ist eine Konstante.
Das ist Absicht: Was du in den Einstellungen änderst, soll das Abschreiben eines
Bons unter keinen Umständen beeinflussen können.

---

## 4. Wie die Dateien zusammenhängen

| Datei | Aufgabe |
|---|---|
| `index.ts` | Der Ablauf beider Durchgänge: Anmeldung prüfen, Modell rufen, Antwort prüfen, zurückgeben |
| `prompt.ts` | **Die beiden Prompts.** Hier schärfst du nach |
| `mistral.ts` | Der Netz-Teil: Zeitlimit, Wiederholung bei 429, Antwort auspacken |
| `lines.ts` | **Die Aufteilung:** aus abgetippten Zeilen werden Positionen. Hier, nicht im Prompt |
| `validate.ts` | Durchgang 1 prüfen: Schema, Beträge, Mengen, Summenabgleich — und die Formen, die dabei entstehen |
| `assign.ts` | Durchgang 2 prüfen: Kategorien und Merkmale gegen die Liste des Haushalts |
| `mappings.ts` | Das Gedächtnis: bekannte Rohtexte aus der Datenbank einsetzen |
| `rates.ts` | Der EZB-Referenzkurs zum Bon-Datum, samt Zwischenspeicher. Ohne Schlüssel, ohne Anmeldung |
| `*.test.ts` | Tests dazu — laufen mit `npm test` mit |

Die Typdefinitionen liegen bewusst in `validate.ts` und nicht in einer eigenen
`schema.ts`: Der Editor in der Supabase-Oberfläche legte die nicht an — sie
enthält nur Typen, und die verschwinden beim Übersetzen restlos, sodass zur
Laufzeit eine leere Datei übrig bleibt. Sie stehen jetzt dort, wo sie entstehen.

**Zwei Durchgänge über eine Adresse.** Die App ruft dieselbe Funktion zweimal
auf: einmal mit `image` (Struktur), einmal mit `rohtexte` (Zuordnung). Der zweite
Aufruf entfällt, wenn der Haushalt jeden Artikel des Bons schon kennt — und er
darf scheitern, ohne den Bon mitzureißen. Warum das zwei Aufrufe sind und nicht
einer, steht im Kopf von `index.ts`.

Drei weitere Dinge, die absichtlich so sind:

**Die Funktion benutzt keinen Dienstschlüssel.** Sie arbeitet mit dem Token des
angemeldeten Nutzers, also unter denselben Zugriffsregeln wie die App selbst.
Sie kann damit gar nicht auf fremde Haushalte sehen — das verhindert die
Datenbank, nicht der Code.

**Ohne Anmeldung geht nichts.** Die Funktion prüft das Token, bevor sie
irgendetwas anderes tut. Ein Fremder kann dein freies Kontingent nicht
verbrauchen.

---

## 5. Wenn beim Ausrollen etwas klemmt

**„Cannot find module 'jsr:@supabase/supabase-js@2'"** — je nach Alter der
Laufzeit versteht sie `jsr:` noch nicht. Dann in `index.ts` die erste
Import-Zeile ändern auf:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
```

**Der Browser meldet einen CORS-Fehler** — dann kam der Vorab-Anruf des Browsers
(`OPTIONS`) nicht durch. Die Funktion beantwortet ihn selbst; sollte Supabase
ihn trotzdem abweisen, in den Funktionseinstellungen **„Verify JWT"**
abschalten. Das ist hier gefahrlos: Die Funktion prüft die Anmeldung ohnehin
selbst, in Schritt 1 vor allem anderen.
