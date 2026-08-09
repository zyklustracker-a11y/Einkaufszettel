# Receipt AI

Mobile PWA zum Scannen von Kassenzetteln und Tracken von Lebensmittelkosten –
React + Vite + TypeScript, komplett auf Deutsch, mobile-first für iPhone
(390 × 844, Safe Areas oben und unten).

Aktuell reines Frontend mit realistischen Beispieldaten. Die Datenschicht ist so
geschnitten, dass sie ohne Änderungen an der UI gegen Supabase getauscht werden
kann.

## Loslegen

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # Typecheck + Produktions-Build
npm run preview    # Build lokal ansehen
```

Auf dem iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm". Die App
startet dann im Standalone-Modus mit korrekten Safe Areas und passendem
Status-Bar-Stil. Icons werden von `scripts/generate-icons.mjs` erzeugt (nur nötig,
wenn sich das Logo ändert).

## Screens

| Route | Screen |
| --- | --- |
| `/anmelden` | Login mit Google-Button |
| `/` | Dashboard: Monatsstand, Budget, Kategorien, Score, letzte Einkäufe |
| `/scan` | Kamera mit Rahmenhilfe |
| `/scan/verarbeitung` | „KI liest deinen Bon…" – ruft die Edge Function auf |
| `/scan/pruefen` | Das Erkannte prüfen, inkl. Summenabgleich und Rohantwort |
| `/bestpreise` | Durchsuchbare Produktliste mit Bestpreis je Produkt |
| `/bestpreise/:productId` | Preisverlauf und alle Käufe eines Produkts |
| `/zettel` | Einkaufszettel: Vorschläge aus dem Kaufrhythmus, Abhaken, eigene Einträge |
| `/analysen` | Zeitraum-Umschalter, Verlauf, Kategorien, Sparpotenzial, Top 10, Kraftstoff |
| `/gesundheit` | Score-Verlauf, verarbeitet/unverarbeitet, kritische Ausgaben |
| `/einkauf/:receiptId` | Gespeicherter Bon mit Positionen, korrigieren oder löschen |
| `/einstellungen` | Budget, Dark Mode, Haushalt, Bon-Fotos, Abmelden |

Die Tab-Bar (Übersicht · Preise · Zettel · Scan · Analysen · Gesund) liegt über
allen Tabs-Screens; Scan-Flow und Einstellungen laufen ohne sie.

## Aufbau

```
src/
  types.ts          Domänentypen – Zahlen bleiben Zahlen, Daten bleiben ISO-Strings
  mocks/            Beispieldaten, je Datei eine „Tabelle"
  data/index.ts     Zugriffsschicht: der einzige Ort, den Supabase ersetzt
  lib/format.ts     Deutsche Darstellung (2,49 € · 14.08.2026 · vor 33 Tagen)
  lib/derive.ts     Alles Abgeleitete: Bestpreise, Sparpotenzial, Charts, Budget
  state/AppState    Theme und Einstellungen, in localStorage gesichert
  components/       Tab-Bar, Bottom-Sheet, Charts, kleine UI-Bausteine
  screens/          Eine Datei pro Screen plus CSS-Modul
  styles/tokens.css Design-Tokens für Light und Dark

supabase/
  migrations/       Schema und Auswertungs-Sichten
  functions/erkennen/  Edge Function: Bon-Foto → geprüfte Bon-Daten (Mistral)
```

### Bon-Erkennung

Das Foto geht an die Edge Function `erkennen`, nie direkt an Mistral — der
API-Schlüssel liegt ausschließlich dort. Die Funktion baut den Prompt zur
Laufzeit aus den aktiven Merkmalen des Haushalts, prüft die Antwort (Schema,
Beträge in Cent, Mengen in Basiseinheiten, Summenabgleich, bekannte Schlüssel)
und gibt sie zusammen mit der Rohantwort zurück.

Nachschärfen des Prompts: `supabase/functions/erkennen/prompt.ts`.
Einrichtung: [`supabase/functions/README.md`](supabase/functions/README.md).

### Anschluss an Supabase

Die UI liest ausschließlich über `src/data/index.ts`. Für den Umstieg reicht es,
dort die Funktionsrümpfe zu ersetzen (und die Aufrufer zu `await`-en):

```ts
export const getReceipts = async (): Promise<Receipt[]> => {
  const { data } = await supabase.from('receipts').select('*, items:receipt_items(*)')
  return data ?? []
}
```

Die Mock-Dateien bilden dabei schon die Tabellen ab, die es später gibt:

- `mocks/receipts.ts` → `receipts` + `receipt_items`
- `mocks/products.ts` → `products` + `price_points`
- `mocks/categories.ts` → `categories`, Health-Flags als Enum
- `mocks/summary.ts` → Aggregat-Views (`monthly_summary`, `category_totals`,
  `spending_trend`, `top_products`, `health_summary`) sowie Haushalt und Settings

Alles, was sich berechnen lässt, wird berechnet und nicht gespeichert: Bestpreis
und sein Alter, Grundpreis (€/kg), Preisverlauf, Sparpotenzial, Budget-Auslastung
und die Abweichung zwischen Positionssumme und Bon-Total leben in
`lib/derive.ts`.

### Randfälle in den Beispieldaten

- **Bon mit Abweichung** – der Rewe-Bon vom 14.08.2026 summiert 41,98 €, gedruckt
  sind 42,17 €. Der Korrektur-Screen zeigt die gelbe Warnung und schaltet auf den
  grünen Haken um, sobald man die Positionen passend korrigiert.
- **Produkt ohne Mengenangabe** – „Hähnchenbrust" hat keine Packungsgröße und wird
  im Grundpreis-Vergleich als „ohne Mengenangabe" geführt.
- **Monat über Budget** – Juli liegt mit 471,20 € über den 450 €; der Balken im
  Ausgabenverlauf ist rot, die Hochrechnung für August meldet 490 €.
- **Non-Food** – bleibt in Donut, Kategorien-Balken und Legende immer sichtbar und
  bekommt einen eigenen neutralen Farbton statt eines Grüntons.

## Design

Umgesetzt nach dem Claude-Design-Prototyp in `design/` (Prototyp, Chat-Verlauf
und Export-README). Farben, Radien, Schatten und Abstände stammen 1 : 1 aus
`design/project/Receipt AI.dc.html` und liegen als Tokens in
`src/styles/tokens.css`.
