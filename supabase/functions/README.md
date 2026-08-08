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
| `MISTRAL_MODEL` | z. B. `pixtral-large-latest` | `pixtral-12b-2409` |

Ohne dieses Secret nimmt die Funktion `pixtral-12b-2409` — das Vision-Modell aus
der Pixtral-Familie, das im freien Experiment-Tarif läuft.

> `SUPABASE_URL` und `SUPABASE_ANON_KEY` brauchst du **nicht** anzulegen. Die
> setzt Supabase in jeder Edge Function von selbst.

### 1.2 Die Funktion ausrollen

**Weg A — über die Weboberfläche (kein Werkzeug nötig):**

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**
2. Name: `erkennen` (genau so, klein geschrieben — die App ruft diese Adresse auf)
3. Die fünf Dateien aus `supabase/functions/erkennen/` anlegen und Inhalt
   einfügen: `index.ts`, `prompt.ts`, `mistral.ts`, `schema.ts`, `validate.ts`
   (`validate.test.ts` wird nicht gebraucht — die Tests laufen auf deinem Rechner)
4. **Deploy**

**Weg B — mit der Supabase-CLI (schneller, wenn du sie ohnehin nutzt):**

```bash
npx supabase login
npx supabase link --project-ref DEIN-PROJEKT-REF
npx supabase functions deploy erkennen
```

Das Secret setzt du dann so, statt über die Weboberfläche:

```bash
npx supabase secrets set MISTRAL_API_KEY=dein-schluessel
```

### 1.3 Sonst nichts

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
Die Abschnitte sind einzeln überschrieben — „Nicht raten", „Bon-Eigenheiten",
„Zahlenformat", „Zuordnung", „Milchprodukte", „Antwortformat".

Der Ablauf:

1. Bon scannen, im Korrektur-Screen die **Rohantwort** ansehen.
2. Fehler benennen: Wurde das Steuerkennzeichen als Preis gelesen? Eine
   Pfandzeile übersehen? Der Rabatt positiv statt negativ?
3. Den passenden Abschnitt in `prompt.ts` ergänzen — am besten mit einem
   Beispiel, so wie es die anderen Regeln dort auch machen.
4. Funktion neu ausrollen, denselben Bon noch einmal scannen.

**Merkmale und Kategorien musst du dafür nicht anfassen.** Die setzt die
Funktion zur Laufzeit aus der Datenbank ein: Legst du in `traits` ein neues
aktives Merkmal an, kennt das Modell es ab dem nächsten Scan — ohne Ausrollen,
ohne Codeänderung. Schaltest du eines ab, verschwindet es aus dem Prompt. Und
Merkmalsschlüssel, die das Modell erfindet, wirft `validate.ts` weg.

---

## 4. Wie die Dateien zusammenhängen

| Datei | Aufgabe |
|---|---|
| `index.ts` | Der Ablauf: Anmeldung prüfen, Merkmale laden, Modell rufen, Antwort prüfen, zurückgeben |
| `prompt.ts` | **Der Erkennungs-Prompt.** Hier schärfst du nach |
| `mistral.ts` | Der Netz-Teil: Zeitlimit, Wiederholung bei 429, Antwort auspacken |
| `validate.ts` | Die Prüfung: Schema, Beträge, Mengen, Summenabgleich, bekannte Schlüssel |
| `schema.ts` | Die Formen, die zwischen Modell, Funktion und App unterwegs sind |
| `validate.test.ts` | Tests für die Prüfung — laufen mit `npm test` mit |

Zwei Dinge, die absichtlich so sind:

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
