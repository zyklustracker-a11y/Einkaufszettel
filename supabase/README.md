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

## 2e. Die fünfte Migration: Verarbeitung im Hintergrund

`migrations/0005_hintergrund.sql` gehört zu Schritt 6. Sie sorgt dafür, dass ein
Scan nicht mehr verlorengeht, wenn du während der fünfzehn Sekunden kurz in eine
andere App wechselst.

| Was | Wofür |
|---|---|
| Tabelle `scan_jobs` | das Ergebnis liegt zusätzlich auf dem Server |
| Funktion `start_scan_job()` | legt einen Job an und räumt die alten weg |
| Sicht `v_open_scan_job` | „liegt für mich noch ein Scan bereit?" |

Genauso ausführen wie oben: **SQL Editor → New query → Datei einfügen → Run.**
Erwartet: **Success. No rows returned.** Die Datei ist mehrfach ausführbar.

**Prüfen:**

```sql
select public.start_scan_job() as job;
select id, status, created_at from public.scan_jobs order by created_at desc limit 5;
```

Erwartet: eine id und eine Zeile mit `status = running`. Die kannst du danach
gleich wieder wegräumen:

```sql
delete from public.scan_jobs where status = 'running' and result is null;
```

> **Das Bon-Foto liegt weiterhin nirgends.** In `result` stehen nur die erkannten
> Daten — Positionen, Beträge, Steuerkennzeichen. Das Bild geht wie bisher durch
> die Funktion und wird danach verworfen.

Jobs, die älter als 24 Stunden sind, verschwinden beim nächsten Scan von selbst.
Es gibt dafür keinen Zeitplan und keine Aufräum-Automatik, um die du dich kümmern
müsstest.

---

## 2f. Die sechste Migration: Spritkosten

`migrations/0006_kraftstoff.sql` gehört zu Schritt 7 und ist die kürzeste von
allen — ein Tankbeleg ist für die App ein gewöhnlicher Bon.

| Was | Wofür |
|---|---|
| Kategorie `kraftstoff` | Non-Food, mit Erklärung fürs Modell |
| Sicht `v_fuel_purchases` | eine Zeile je Tankfüllung, mit Literpreis |
| Sicht `v_fuel_months` | Kosten, Liter und Literpreis je Monat |

Genauso ausführen wie oben. Erwartet: **Success. No rows returned.** Auch diese
Datei ist mehrfach ausführbar.

**Prüfen, ob die Kategorie da ist:**

```sql
select key, name, is_food, active, left(description, 50) as erklaerung
from public.categories where key = 'kraftstoff';
```

Erwartet: eine Zeile, `is_food = false`, aktiv. Den Namen und die Farbe kannst du
in den Einstellungen ändern — den Schlüssel `kraftstoff` nicht, an ihm hängt die
Spritauswertung.

> **Warum hier ausnahmsweise ein Kategorieschlüssel im Code steht:** Bei
> „Auswärts essen" entscheidet die Händlerart, weil eine Gastro-Rechnung an einem
> Gastro-Händler hängt. Bei Kraftstoff geht das nicht — eine Tankstelle verkauft
> Sprit *und* Kaffee. Also entscheidet die Kategorie, und `kraftstoff` ist
> deshalb eine mitgelieferte mit festem Schlüssel, genauso wie `dairy`.

**Nach dem ersten Tankbeleg prüfen:**

```sql
select purchased_on, product_name, millilitres, total_cents, price_per_litre_cents
from public.v_fuel_purchases
order by purchased_on desc;
```

Erwartet: eine Zeile je Tankfüllung. `price_per_litre_cents` ist **Cent je
Liter** mit zwei Nachkommastellen — 177,92 heißt 1,779 €/l. Steht dort nichts,
obwohl du getankt hast, fehlt der Position ihre Literangabe: Dann im
Einkaufs-Detail auf „Bearbeiten" und die Menge nachtragen.

---

## 2g. Die siebte Migration: Bestpreise und Analysen

`migrations/0007_auswertungen.sql` gehört zu Schritt 8. Sie legt keine Tabelle
an, sondern schärft die Auswertungen — und repariert den Grundpreis, der bis
dahin immer leer war.

| Was | Wofür |
|---|---|
| `v_price_observations` | Grundpreis (€/kg, €/l) je Beobachtung |
| `v_product_prices` | Grundpreis und Zahl der Läden je Produkt |
| `v_savings_current_month` | drei Schwellen: 2 Läden, 20 Cent, 6 Monate |
| `v_frequent_products` | die häufigsten Käufe statt der teuersten |
| `v_household_stats` | wie viel Grundlage überhaupt da ist |

Genauso ausführen wie oben. Erwartet: **Success. No rows returned.**

**Prüfen, ob der Grundpreis jetzt ankommt:**

```sql
select product_name, purchase_count, merchant_count, min_cents,
       base_price_cents, base_unit
from public.v_product_prices
order by product_name;
```

Erwartet: Bei Ware, die du nach Gewicht kaufst (Obst, Käse an der Theke), steht
in `base_price_cents` jetzt eine Zahl und in `base_unit` ein `kg` oder `l`. Bei
Stückware bleibt beides leer — ohne Packungsgröße gibt es keinen €/kg, und
geraten wird nicht.

**Und wie viel Grundlage da ist:**

```sql
select * from public.v_household_stats;
```

Erwartet: eine Zeile. `receipt_count` und `day_span` sind die beiden Zahlen, an
denen die App misst, ob ihre Auswertungen schon etwas taugen — und ab denen der
Einkaufszettel Vorschläge macht.

---

## 2h. Die achte Migration: Einkaufszettel

`migrations/0008_einkaufszettel.sql` gehört zu Schritt 9.

| Was | Wofür |
|---|---|
| `shopping_lists`, `shopping_list_items` | eine offene Liste je Haushalt |
| `v_product_rhythm` | Kaufrhythmus je Produkt: Median, Streuung, Fälligkeit |
| `v_shopping_suggestions` | was heute fällig ist |
| `shopping_list_refresh()` | Liste holen und Vorschläge ergänzen |
| `v_household_stats` erweitert | die Schwelle (4 Einkäufe, 14 Tage) |
| `save_receipt()` erweitert | hakt beim Speichern ab, was auf dem Zettel stand |

Genauso ausführen wie oben. Erwartet: **Success. No rows returned.**

**Prüfen, was die App über deine Rhythmen weiß:**

```sql
select product_name, purchase_count, median_gap_days, spread_days,
       days_since_last, expected_price_cents
from public.v_product_rhythm
order by median_gap_days;
```

Erwartet: eine Zeile je Produkt, das du **mindestens dreimal** gekauft hast.
`median_gap_days` ist der übliche Abstand in Tagen, `spread_days` die Streuung.
Ist die Streuung groß, kommt das Produkt bewusst nicht auf den Zettel — dann ist
es kein Rhythmus, sondern Zufall.

**Und was daraus ein Vorschlag wird:**

```sql
select product_name, median_gap_days, days_since_last, due_in_days
from public.v_shopping_suggestions
order by due_in_days;
```

Negatives `due_in_days` heißt überfällig. Ist die Liste leer, ist gerade nichts
fällig — das ist der Normalfall direkt nach einem Großeinkauf.

**Wie weit die Schwelle ist:**

```sql
select receipt_count, required_receipts, day_span, required_days, suggestions_ready
from public.v_household_stats;
```

Solange `suggestions_ready` auf `false` steht, zeigt der Zettel-Tab den
Fortschritt statt einer Liste. Eigene Einträge kannst du trotzdem schon
hinschreiben.

> **Die Schwelle steht nur hier.** Der Balken in der App liest `required_receipts`
> und `required_days` aus dieser Sicht. Wer sie ändern will, ändert sie in der
> Migration — und beides bleibt in Übereinstimmung.

---

## 2i. Die neunte Migration: Merkmale verwalten

`migrations/0009_merkmale.sql` gehört zu Schritt 10 und ist die kürzeste von
allen — am Schema ändert sich nichts. Merkmale waren von Anfang an Daten; es
fehlte nur die Bedienoberfläche.

| Was | Wofür |
|---|---|
| Sicht `v_trait_product_counts` | wie viele Produkte an einem Merkmal hängen |

Genauso ausführen wie oben. Erwartet: **Success. No rows returned.**

```sql
select trait_key, product_count
from public.v_trait_product_counts
order by product_count desc;
```

Bei `roh`, `pasteurisiert`, `esl`, `uht` und `homogenisiert` steht dort immer 0 —
richtig so: Diese fünf hängen an keinem Produkt, sondern werden aus den
Milch-Feldern abgeleitet.

> **Was passiert, wenn du ein Gewicht änderst?** Nichts, was du anstoßen
> müsstest. Der Score wird nirgends gespeichert, sondern bei jeder Anzeige neu
> gerechnet. Die Verlaufskurve im Gesundheits-Screen ändert sich also sofort
> mit — auch für vergangene Monate.
>
> Seit Schritt 16 wählst du dabei aus sechs benannten Stufen statt einer Zahl
> (siehe Abschnitt 2l). Wie stark sich eine Stufe im Score auswirkt, lässt sich
> mit `npm run score:beispiele` an drei Beispiel-Wocheneinkäufen ablesen.

---

## 2j. Die zehnte Migration: Familie einladen

`migrations/0010_einladungen.sql` gehört zu Schritt 12 und ersetzt die drei
SQL-Abfragen aus Abschnitt 5 weiter unten.

| Was | Wofür |
|---|---|
| Tabelle `household_invites` | ein Code je Haushalt, sieben Tage gültig |
| `create_household_invite()` | Code erzeugen oder den vorhandenen zurückgeben |
| `redeem_household_invite()` | beitreten; löst den eigenen leeren Haushalt auf |
| `household_members_list()` | wer dazugehört, mit Name und E-Mail |

Genauso ausführen wie oben. Erwartet: **Success. No rows returned.**

Danach steht der ganze Ablauf in der App: **Einstellungen → Haushalt.**

1. Du erzeugst dort einen Code und gibst ihn weiter.
2. Das Familienmitglied meldet sich mit seinem **eigenen** Google-Konto an.
3. Es öffnet Einstellungen → Haushalt und trägt den Code ein.

> **Wichtig:** Das klappt nur, solange der Haushalt des Familienmitglieds noch
> **leer** ist — also solange es noch keinen Bon gescannt hat. Sonst lehnt die
> App ab und sagt, wie viele Einkäufe im Weg stehen. Zusammenführen zweier
> Haushalte ist bewusst nicht gebaut: Es wäre nicht rückgängig zu machen.

**Prüfen:**

```sql
select code, expires_at, revoked_at from public.household_invites
order by created_at desc limit 5;

select * from public.household_members_list();
```

---

## 2k. Die elfte und zwölfte Migration: Monatsreport, und wieder zurück

`migrations/0011_monatsreport.sql` hatte die Tabellen für die
Push-Benachrichtigung angelegt. Die Funktion ist wieder entfernt worden — eine
Nachricht im Monat rechtfertigt die Einrichtung nicht.

**Wenn du 0011 schon ausgeführt hast, führ jetzt `0012_ohne_push.sql` aus.** Sie
räumt `push_subscriptions`, `v_last_month_report` und `mark_report_sent()` wieder
ab. Erwartet: **Success. No rows returned.**

**Wenn du 0011 noch nicht ausgeführt hast**, kannst du beide überspringen — 0012
ist dann ohne Wirkung und läuft trotzdem fehlerfrei durch.

Es gehen dabei **keine Bon-Daten verloren.** Die drei Dinge waren ausschließlich
für den Versand da.

**Prüfen, dass nichts übrig ist:**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'push_subscriptions';
```

Erwartet: keine Zeile.

> **Die Secrets in Supabase kannst du auch löschen**, falls du sie schon angelegt
> hattest: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
> `REPORT_SECRET`. Dasselbe für `SUPABASE_URL` und `REPORT_SECRET` in den
> GitHub-Secrets und `VITE_VAPID_PUBLIC_KEY` bei Vercel. Nötig ist das nicht —
> sie werden von nichts mehr gelesen.

---

## 2l. Die dreizehnte Migration: Gewichtsstufen

`migrations/0013_gewichtsstufen.sql` gehört zu Schritt 16. **Ausführen.**

Das Gewicht eines Merkmals durfte bisher von −10 bis +10 laufen. Ab jetzt wählst
du in der Verwaltung aus sechs benannten Stufen — Sehr gut (+2), Gut (+1),
Neutral (0), Leicht ungünstig (−1), Ungünstig (−2), Stark ungünstig (−3). Die
Datenbank speichert weiterhin die Zahl; die Migration verengt nur die Prüfregel
und zieht Werte außerhalb auf die nächste Stufe.

**Betroffen sind nur selbst angelegte Merkmale mit einem Wert außerhalb von
−3…+2.** Alle mitgelieferten liegen längst darin, an ihnen ändert sich nichts —
auch nicht rückwirkend. Erwartet: **Success. No rows returned.**

**Prüfen, ob etwas gekappt wurde** (vor dem Ausführen):

```sql
select key, label, weight from public.traits
where weight < -3 or weight > 2;
```

Keine Zeile heißt: Die Migration ändert an deinen Daten nichts und setzt nur die
Regel.

**Prüfen, dass die Regel greift** (nach dem Ausführen):

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.traits'::regclass and contype = 'c';
```

Erwartet: eine Zeile `traits_weight_stufen` mit `CHECK ((weight >= -3) AND (weight <= 2))`.

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

> **Seit Schritt 12 brauchst du das nicht mehr.** Der Einladungs-Ablauf steht in
> der App: Einstellungen → Haushalt → Code erzeugen. Die drei Abfragen hier
> bleiben als Notweg stehen, falls einmal etwas schiefgeht.

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
ein schon bekannter Bontext gar nicht erst neu geraten wird.

Seit Schritt 5 kommt zweierlei dazu: Sie schlägt die **Händlerart** über
`merchant_kind_for()` nach, und bei einem Bon in fremder Währung holt sie den
**EZB-Referenzkurs** zum Bon-Datum und legt ihn in `exchange_rates` ab. Das ist
das einzige, was diese Funktion je schreibt — und ein Wechselkurs gehört keinem
Haushalt. Alles andere schreibt `save_receipt` beim Speichern.

Die EZB braucht dafür **keinen Schlüssel und keine Anmeldung**: Abgefragt wird
`data-api.ecb.europa.eu` als CSV. Es gibt also nichts einzurichten. Ein
Fehlschlag ist eingeplant — dann zeigt der Korrektur-Screen ein Kursfeld für
diesen einen Bon.

**Prüfen, ob Kurse ankommen** (erst nach dem ersten Bon in fremder Währung):

```sql
select rate_date, currency, rate, fetched_at
from public.exchange_rates
order by rate_date desc
limit 10;
```

Erwartet: mehrere Zeilen — die Funktion holt immer das Fenster der letzten
vierzehn Tage, damit der nächste Bon aus demselben Zeitraum ohne Abruf
auskommt. `rate` ist Euro je **eine** Einheit: Betrag × `rate` = Euro.

---

## 9. Was noch nicht dabei ist

Bewusst nicht Teil dieser Migrationen, das kommt in späteren Schritten:

- **Speicherort für die Bon-Fotos.** Es gibt keinen und soll keinen geben: Das
  Foto wird nach dem Speichern verworfen und nie hochgeladen (PROJEKT.md).
  `receipts.image_path` bleibt deshalb null.
  *(Merkmale bearbeiten stand hier bis Schritt 10 — seitdem lassen sie sich
  genau wie Kategorien anlegen, umbenennen, gewichten, gruppieren, umsortieren
  und abschalten.)*

Nicht mehr offen, seit Schritt 5b:

- **Fremdwährung** mit EZB-Kurs zum Bon-Datum — abgerufen von der Edge Function,
  zwischengespeichert in `exchange_rates`.
- **Einen gespeicherten Bon nachträglich ändern** — „Bearbeiten" im
  Einkaufs-Detail.

---

## Zwei Dinge, die dir beim Lesen des SQL auffallen werden

**Geld ist immer eine ganze Zahl in Cent.** `4217` heißt 42,17 €. Es gibt
nirgends Kommazahlen für Geld — genau deshalb stimmen die Summen auf den Cent.

**Mengen sind ganze Zahlen in der kleinsten Einheit.** 1,12 kg stehen als
`quantity_base = 1120` mit `quantity_unit = 'kg'` da: gerechnet wird in Gramm,
angezeigt in Kilogramm. Damit gibt es die Rundungsunschärfe von 1,005 kg gar
nicht erst.
