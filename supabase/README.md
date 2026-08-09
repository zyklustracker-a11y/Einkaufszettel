# Datenbank einrichten

Diese Anleitung führt dich durch das einmalige Anlegen des Schemas in Supabase.
Du brauchst dafür nichts zu installieren — alles läuft im Browser.

---

## 1. Was die Migration anlegt

`migrations/0001_initial.sql` legt zwölf Tabellen an:

| Tabelle | wofür |
|---|---|
| `households` | der Haushalt selbst |
| `household_members` | wer dazugehört |
| `categories` | die neun festen Kategorien |
| `traits` | die Merkmale mit Gewicht und Gruppe |
| `merchants` | die Läden |
| `canonical_products` | die Produkte, an denen Kategorie, Merkmale und Milch-Eigenschaften hängen |
| `canonical_product_traits` | welches Produkt welche Merkmale hat |
| `product_mappings` | Rohtext vom Bon → Produkt |
| `receipts` | die Bons |
| `receipt_items` | die Positionen darauf |
| `budgets` | das Monatsbudget |
| `insights` | vorgerechnete Hinweise, etwa Sparpotenzial |

Dazu die Zugriffsregeln (jeder sieht nur seinen eigenen Haushalt) und eine
Automatik, die beim ersten Login alles Nötige anlegt.

---

## 2. Migration ausführen

1. Öffne dein Projekt auf [supabase.com](https://supabase.com).
2. Links in der Seitenleiste auf **SQL Editor**.
3. Oben rechts auf **New query**.
4. Öffne `supabase/migrations/0001_initial.sql` in deinem Editor, markiere
   **alles** (Strg/Cmd + A) und kopiere es.
5. Füge es in das leere Feld im SQL-Editor ein.
6. Klick auf **Run** (oder Strg/Cmd + Enter).

Nach ein paar Sekunden sollte unten **Success. No rows returned** stehen.

> **Wenn eine Fehlermeldung kommt:** Es ist nichts kaputtgegangen. Die Datei
> läuft in einer Transaktion — entweder klappt alles oder nichts. Schick mir die
> Meldung, dann sehen wir sie uns an.

---

## 2b. Die zweite Migration: die Auswertungs-Sichten

`migrations/0002_views.sql` legt keine Tabellen an, sondern **fünfzehn Sichten
(Views)**. Eine Sicht ist eine gespeicherte Abfrage: Sie speichert keine Daten,
sondern rechnet bei jedem Aufruf aus den Tabellen neu. Damit wandern
Monatsübersicht, Kategoriensummen, Ausgabenverlauf, Top-Produkte,
Merkmals-Ausgaben und Bestpreise dorthin, wo sie hingehören — in die Datenbank
statt in den Browser.

Genauso ausführen wie oben: **SQL Editor → New query → Datei einfügen → Run.**
Erwartet: **Success. No rows returned.**

Ohne diese Migration zeigt die App auf jedem Screen den Hinweis „Die
Auswertungs-Sichten fehlen in der Datenbank" — daran erkennst du sofort, dass
sie noch fehlt.

**Prüfen, ob alle fünfzehn da sind:**

```sql
select table_name
from information_schema.views
where table_schema = 'public'
order by table_name;
```

**Und dass keine davon fremde Haushalte durchlässt:**

```sql
select c.relname as sicht,
       (c.reloptions::text like '%security_invoker=true%') as haushaltstrennung_aktiv
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public'
order by c.relname;
```

Erwartet: fünfzehn Zeilen, **überall `true`**. Dieser Schalter ist der Grund,
warum eine Sicht nur die eigenen Zeilen zeigt. Stünde irgendwo `false`, liefe
die Sicht mit den Rechten ihres Eigentümers und umginge die Zugriffsregeln —
dann bitte melden.

> Die Datei lässt sich gefahrlos erneut ausführen: Alle Sichten stehen als
> `create or replace`. Nur wenn sich die Spalten einer Sicht ändern, musst du
> sie vorher einmal mit `drop view … cascade` entfernen.

---

## 2c. Die dritte Migration: Speichern und Lernen

`migrations/0003_speichern.sql` gehört zu Schritt 4b-2. **Ohne sie lässt sich
kein Bon speichern** — die App sagt dann „Die Speicher-Funktion fehlt in der
Datenbank".

Sie legt drei Dinge an:

| Was | Wofür |
|---|---|
| Spalte `receipt_items.tax_code` | das Steuerkennzeichen (A, B, …) vom Bon |
| Funktion `merchant_key()` | „REWE", „Rewe" und „REWE CITY" sind ein Händler |
| Funktion `save_receipt()` | schreibt einen ganzen Bon in **einer** Transaktion |

Genauso ausführen wie oben: **SQL Editor → New query → Datei einfügen → Run.**
Erwartet: **Success. No rows returned.** Eine Meldung wie `column "tax_code" …
already exists, skipping` ist in Ordnung — die Datei lässt sich gefahrlos
mehrfach ausführen.

**Prüfen, ob die beiden Funktionen da sind:**

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('merchant_key', 'save_receipt');
```

Erwartet: zwei Zeilen.

**Und dass die Zusammenführung greift:**

```sql
select public.merchant_key('REWE CITY') as a, public.merchant_key('Rewe') as b;
```

Erwartet: zweimal `rewe`.

> Warum eine Datenbankfunktion und nicht einfach mehrere Anfragen aus der App?
> Weil ein Bon aus Händler, Bon, Positionen, Produkten, deren Merkmalen und den
> gelernten Zuordnungen besteht. Bräche mitten in der Reihe die Verbindung ab,
> läge ein halber Bon in der Datenbank. Der Rumpf einer Funktion ist dagegen
> eine einzige Transaktion: entweder alles oder nichts.

---

## 2d. Die vierte Migration: Kategorien, Auswärts essen, Fremdwährung

`migrations/0004_erweiterungen.sql` gehört zu Schritt 5. Sie bringt **alle**
Schemaänderungen der drei Erweiterungen auf einmal — Schemaänderungen sind jetzt
billig und werden mit jedem gespeicherten Bon teurer.

| Was | Wofür |
|---|---|
| `categories.description`, `.active`, `.color`, `.is_default` | Kategorien werden verwaltbar; die Erklärung geht an das Modell |
| Funktion `category_key()` | „Auswärts essen" → `auswaerts_essen` |
| `merchants.kind` | `retail` oder `gastro` |
| Funktion `merchant_kind_for()` | schlägt die Art zu einem Bonnamen nach |
| `receipts.tip_cents` | Trinkgeld — keine Position, sondern Eigenschaft des Belegs |
| `receipts.currency`, `.original_total_cents`, `.exchange_rate`, `.rate_date` | Fremdwährung; die Cent-Felder halten weiterhin Euro |
| Tabelle `exchange_rates` | Zwischenspeicher für EZB-Kurse, **ohne** Haushalt |
| Merkmal `auswaerts` | Gewicht 0, landet unter „Beobachtet" |
| Sichten neu gerechnet | vierte Kopfzahl „Auswärts", Gastro raus aus den Bestpreisen |
| `save_receipt()` erweitert | Händlerart, Trinkgeld, Währung — und **Aktualisieren** statt Neuanlegen |

Genauso ausführen wie oben: **SQL Editor → New query → Datei einfügen → Run.**
Erwartet: **Success. No rows returned.** Meldungen wie `constraint … does not
exist, skipping` sind in Ordnung — die Datei ist ausdrücklich mehrfach
ausführbar.

**Prüfen, ob der Schlüssel richtig gebildet wird:**

```sql
select public.category_key('Auswärts essen') as a,
       public.category_key('Obst & Gemüse')  as b;
```

Erwartet: `auswaerts_essen` und `obst_gemuese`. Genau diese Umformung macht auch
die App, wenn sie im Anlegen-Formular den künftigen Schlüssel anzeigt.

**Und dass die neun mitgelieferten Kategorien ihre Farbe bekommen haben:**

```sql
select key, color, active, is_default, left(description, 40) as erklaerung
from public.categories
order by sort_order;
```

Erwartet: neun Zeilen, überall eine Farbe wie `#16915c` und ein Satz Erklärung.
Ist eine Farbe leer, ist die Migration nicht durchgelaufen.

**Und dass das Merkmal `auswaerts` da ist:**

```sql
select key, short, weight, active from public.traits where key = 'auswaerts';
```

Erwartet: eine Zeile mit `A`, Gewicht `0`, aktiv.

> **Die vier Zahlen der Kopfkarte müssen sich zur Gesamtsumme addieren.** Das ist
> die Probe, an der man merkt, ob die Sichten sauber sind:
>
> ```sql
> select food_cents, dining_cents, nonfood_cents, total_cents,
>        food_cents + dining_cents + nonfood_cents = total_cents as stimmt
> from public.v_current_month_summary;
> ```
>
> Erwartet: `stimmt` = `true`.

---

## 3. Prüfen, ob alles angekommen ist

Öffne eine neue Abfrage und führe diese vier Blöcke nacheinander aus.

### 3.1 Sind alle zwölf Tabellen da?

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Erwartet: zwölf Zeilen, genau die aus der Tabelle oben.

### 3.2 Ist der Zugriffsschutz überall an?

```sql
select tablename, rowsecurity as schutz_aktiv
from pg_tables
where schemaname = 'public'
order by tablename;
```

Erwartet: zwölf Zeilen, **überall `true`**. Steht irgendwo `false`, wäre diese
Tabelle für alle lesbar — dann bitte melden.

### 3.3 Hat jede Tabelle eine Zugriffsregel?

```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
order by tablename;
```

Erwartet: zwölf Zeilen, je eine Regel pro Tabelle.

### 3.4 Läuft die Automatik beim Login?

```sql
select tgname as trigger_name
from pg_trigger
where tgname = 'on_auth_user_created';
```

Erwartet: eine Zeile. Fehlt sie, wurde der Trigger auf `auth.users` nicht
angelegt — dann bekommt ein neuer Nutzer keinen Haushalt.

---

## 4. Nach dem ersten Login prüfen

Die Automatik greift erst, wenn sich zum ersten Mal jemand anmeldet. Das
passiert in **Schritt 3** (Google-Login). Sobald du dich einmal angemeldet hast,
führ das hier aus:

```sql
select
  (select count(*) from public.households)         as haushalte,
  (select count(*) from public.household_members)  as mitglieder,
  (select count(*) from public.categories)         as kategorien,
  (select count(*) from public.traits)             as merkmale,
  (select count(*) from public.traits where active) as merkmale_aktiv;
```

Erwartet nach genau einer Anmeldung:

| haushalte | mitglieder | kategorien | merkmale | merkmale_aktiv |
|---|---|---|---|---|
| 1 | 1 | 9 | 14 | 13 |

Dreizehn von vierzehn aktiv ist richtig: `zusatzstoffe` ist absichtlich
ausgeschaltet, so wie es in `PROJEKT.md` steht. Das vierzehnte Merkmal ist
`auswaerts` — es kam mit Schritt 5 dazu. Vor der vierten Migration standen hier
13 und 12.

Und zur Kontrolle die Merkmale selbst:

```sql
select key, short, weight, trait_group, active
from public.traits
order by sort_order;
```

Da müssen `weizen` bei −3, `gluten` bei −2, `milch` bei 0 und `roh` bei +2
stehen — dieselben Werte wie in der App.

---

## 5. Die Familie dazuholen

Beim Anmelden bekommt **jeder** Nutzer erst einmal einen eigenen Haushalt. Damit
Marie und Opa Klaus dieselben Daten sehen wie du, musst du sie einmalig zu
deinem Haushalt hinzufügen.

**Schritt 1** — alle Nutzer und ihre Haushalte anzeigen:

```sql
select u.email, m.household_id, m.role
from public.household_members m
join auth.users u on u.id = m.user_id
order by u.email;
```

**Schritt 2** — die anderen in deinen Haushalt eintragen. Setze deine eigene
`household_id` aus Schritt 1 ein:

```sql
update public.household_members
set household_id = 'HIER-DEINE-HOUSEHOLD-ID', role = 'member'
where user_id in (
  select id from auth.users where email in ('marie@…', 'klaus@…')
);
```

**Schritt 3** — die leeren Haushalte der beiden wegräumen:

```sql
delete from public.households h
where not exists (select 1 from public.household_members m where m.household_id = h.id);
```

Danach steht ihr zu dritt in einem Haushalt und seht dieselben Daten.

> Ein richtiger Einladungs-Ablauf kommt später. Für drei Personen, die sich
> einmal anmelden, sind diese drei Abfragen der kürzere Weg.

---

## 6. Noch einmal von vorn

Die Migration lässt sich nicht zweimal ausführen — beim zweiten Mal meldet
Postgres, dass die Tabellen schon existieren. Wenn du neu anfangen willst:

```sql
-- ACHTUNG: löscht alle Daten in diesen Tabellen unwiderruflich.
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
drop function if exists public.handle_new_user() cascade;
```

Danach die Migration erneut ausführen. Die angemeldeten Nutzer bleiben dabei
erhalten (die liegen im Schema `auth`), sie haben danach nur keinen Haushalt
mehr — den legst du mit `select public.seed_household(...)` neu an oder meldest
dich einmal ab und neu an.

---

## 7. Die zwei Werte für die App eintragen

Damit sich die App mit deinem Projekt verbindet, braucht sie zwei Werte. Beide
stehen in Supabase unter **Project Settings → Data API**:

| Was | Wo es steht | Trägst du ein als |
|---|---|---|
| Projekt-URL (`https://….supabase.co`) | Feld **Project URL** | `VITE_SUPABASE_URL` |
| Öffentlicher Schlüssel | Feld **anon public** | `VITE_SUPABASE_ANON_KEY` |

**Auf deinem Rechner:** Kopiere `.env.example` im Projektordner nach `.env` und
trag die Werte dort ein. `.env` ist in `.gitignore` und landet nie auf GitHub.
Danach `npm run dev` neu starten — Vite liest die Datei nur beim Start.

**Bei Vercel:** Projekt → Settings → Environment Variables → beide Namen mit
ihren Werten anlegen, für Production **und** Preview. Danach einmal neu
deployen, sonst stecken die alten (leeren) Werte noch im Build.

Fehlt einer der beiden, zeigt der Anmelde-Screen einen Hinweis statt einer
weißen Seite — daran erkennst du es sofort.

> Der `anon public`-Schlüssel darf im Browser stehen: Er schaltet nichts frei,
> was die Zugriffsregeln nicht ohnehin erlauben. Der `service_role`-Schlüssel
> gehört dagegen nie in die App.

Zusätzlich muss in Supabase unter **Authentication → URL Configuration** die
Adresse deiner App als **Redirect URL** eingetragen sein — einmal die
Vercel-Adresse und einmal `http://localhost:5173/` fürs Entwickeln.

---

## 8. Die Bon-Erkennung

Seit Schritt 4b-1 gibt es eine Edge Function, die das Bon-Foto an Mistral gibt
und geprüfte Daten zurückliefert. Sie braucht **ein** Secret in Supabase und
sonst nichts — keine Migration, keine Änderung an den Zugriffsregeln.

Die Einrichtung steht Schritt für Schritt in
[`functions/README.md`](functions/README.md).

Was die Funktion mit der Datenbank macht: Sie **liest** `household_members`,
`traits` und `categories`, um daraus den Prompt zu bauen — und seit 4b-2
zusätzlich `product_mappings`, `canonical_products` und deren Merkmale, damit
ein schon bekannter Bontext gar nicht erst neu geraten wird. Geschrieben wird
nichts; das macht `save_receipt` beim Speichern.

---

## 9. Was noch nicht dabei ist

Bewusst nicht Teil dieser Migrationen, das kommt in späteren Schritten:

- **Speicherort für die Bon-Fotos.** Es gibt keinen und soll keinen geben: Das
  Foto wird nach dem Speichern verworfen und nie hochgeladen (PROJEKT.md).
  `receipts.image_path` bleibt deshalb null.
- **Merkmale bearbeiten.** Die Einstellungen zeigen die vierzehn Merkmale, aber
  schreibgeschützt — das Bearbeiten kommt in Schritt 10. **Kategorien** lassen
  sich seit Schritt 5 dagegen anlegen, umbenennen, umfärben, umsortieren und
  abschalten.

Und zwei Dinge, für die die **Datenbank schon bereit ist**, die Oberfläche aber
noch nicht — sie kommen in der zweiten Etappe von Schritt 5:

- **Fremdwährung.** Die Spalten auf `receipts` und die Tabelle `exchange_rates`
  stehen bereits; den EZB-Kurs holt die Edge Function noch nicht ab, und der
  Korrektur-Screen zeigt noch kein Währungsfeld. Bis dahin wird jeder Bon als
  Euro-Bon gespeichert.
- **Einen gespeicherten Bon nachträglich ändern.** `save_receipt()` kann es
  bereits (Feld `bon_id` in der Anfrage), das Einkaufs-Detail bietet es noch
  nicht an. Bis dahin ist der Weg löschen und neu scannen.

---

## Zwei Dinge, die dir beim Lesen des SQL auffallen werden

**Geld ist immer eine ganze Zahl in Cent.** `4217` heißt 42,17 €. Es gibt
nirgends Kommazahlen für Geld — genau deshalb stimmen die Summen auf den Cent.

**Mengen sind ganze Zahlen in der kleinsten Einheit.** 1,12 kg stehen als
`quantity_base = 1120` mit `quantity_unit = 'kg'` da: gerechnet wird in Gramm,
angezeigt in Kilogramm. Damit gibt es die Rundungsunschärfe von 1,005 kg gar
nicht erst.
