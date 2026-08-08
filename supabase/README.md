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
| 1 | 1 | 9 | 13 | 12 |

Zwölf von dreizehn aktiv ist richtig: `zusatzstoffe` ist absichtlich
ausgeschaltet, so wie es in `PROJEKT.md` steht.

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

## 8. Was noch nicht dabei ist

Bewusst nicht Teil dieser Migrationen, das kommt in späteren Schritten:

- **Speicherort für die Bon-Fotos.** `receipts.image_path` ist vorbereitet, der
  Storage-Bucket wird in Schritt 4 angelegt.
- **Schreiben von Bons.** Die App liest seit Schritt 2c alles aus der Datenbank
  und schreibt bislang nur das Monatsbudget. Bons anlegen, korrigieren und
  löschen kommt in Schritt 4.
- **Merkmale bearbeiten.** Die Einstellungen zeigen die dreizehn Merkmale, aber
  schreibgeschützt — das Bearbeiten kommt in Schritt 6.

---

## Zwei Dinge, die dir beim Lesen des SQL auffallen werden

**Geld ist immer eine ganze Zahl in Cent.** `4217` heißt 42,17 €. Es gibt
nirgends Kommazahlen für Geld — genau deshalb stimmen die Summen auf den Cent.

**Mengen sind ganze Zahlen in der kleinsten Einheit.** 1,12 kg stehen als
`quantity_base = 1120` mit `quantity_unit = 'kg'` da: gerechnet wird in Gramm,
angezeigt in Kilogramm. Damit gibt es die Rundungsunschärfe von 1,005 kg gar
nicht erst.
