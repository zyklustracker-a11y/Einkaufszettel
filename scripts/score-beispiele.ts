/**
 * Der Gesundheits-Score an realistischen Einkäufen durchgerechnet.
 *
 *     npm run score:beispiele
 *
 * ---------------------------------------------------------------------------
 * WOZU
 * ---------------------------------------------------------------------------
 *
 * Die Umrechnung von Merkmalslast auf 0…100 hängt an genau einer Konstante:
 * `POINTS_PER_WEIGHT` in `src/lib/score.ts`. Die Zahl ist gesetzt und nicht
 * gemessen — als die Formel entstand, gab es keine echten Einkäufe, an denen
 * sich etwas hätte eichen lassen. Solange das so ist, ist dieses Skript der
 * Ersatz: drei Körbe, wie sie tatsächlich vorkommen, einmal durch dieselbe
 * Funktion geschickt, die auch die App benutzt.
 *
 * Nach jeder Änderung an `POINTS_PER_WEIGHT` erneut aufrufen — es liest die
 * Konstante, statt sie zu wiederholen, und zeigt am Ende, wie die drei Körbe bei
 * anderen Werten lägen.
 *
 * ---------------------------------------------------------------------------
 * WIE DIE KÖRBE ENTSTANDEN SIND
 * ---------------------------------------------------------------------------
 *
 * Die Merkmale kommen aus `src/mocks/traits.ts` — dieselben vierzehn, die
 * `seed_traits()` jedem neuen Haushalt mitgibt, mit denselben Gewichten und
 * Gruppen. Die Positionen sind von Hand gesetzt, mit Preisen aus einem
 * deutschen Supermarkt und mit den Merkmalen, die die Erkennung an so einem
 * Produkt vergeben würde. Sie sind eine Annahme und keine Messung; genau
 * deshalb steht dieses Skript im Verzeichnis und nicht das Ergebnis in einer
 * Konstante.
 */
import { itemScore, healthScore, POINTS_PER_WEIGHT, MAX_SCORE } from '../src/lib/score.ts'
import { traits } from '../src/mocks/traits.ts'
import type { ReceiptItem, TraitId } from '../src/types.ts'

/**
 * Eine Position, kurz notiert: Name, Betrag in Cent, Merkmale.
 *
 * `quantity` und `categoryId` spielen für den Score keine Rolle — gerechnet wird
 * mit `totalCents` und den Merkmalen. Sie stehen trotzdem drin, weil
 * `ReceiptItem` sie verlangt und eine erfundene Teilmenge des Typs schwerer zu
 * lesen wäre als der echte.
 */
function item(
  name: string,
  totalCents: number,
  traitIds: TraitId[],
  milk?: { heat?: ReceiptItem['milkHeat']; homogenized?: ReceiptItem['milkHomogenized'] },
): ReceiptItem {
  return {
    id: name,
    name,
    categoryId: 'staples',
    quantity: { kind: 'count', amount: 1 },
    totalCents,
    traitIds,
    milkHeat: milk?.heat,
    milkHomogenized: milk?.homogenized,
  }
}

interface Basket {
  title: string
  note: string
  items: ReceiptItem[]
}

const BASKETS: Basket[] = [
  {
    title: 'Frischware',
    note: 'Obst, Gemüse, Fleisch, Milchprodukte, ein Sauerteigbrot, Nudeln',
    items: [
      item('Rispentomaten', 243, []),
      item('Äpfel Elstar', 343, []),
      item('Bananen', 200, []),
      item('Kartoffeln 2,5 kg', 249, []),
      item('Zwiebeln', 129, []),
      item('Möhren', 149, []),
      item('Feldsalat', 199, []),
      item('Hähnchenbrust', 799, []),
      item('Rinderhack', 549, []),
      item('Eier 10er', 329, []),
      item('Butter 250 g', 239, ['milch'], { heat: 'pasteurisiert' }),
      item('Frischmilch 1 l', 119, ['milch'], { heat: 'pasteurisiert', homogenized: 'nein' }),
      item('Gouda am Stück', 276, ['milch'], { heat: 'pasteurisiert' }),
      item('Naturjoghurt 500 g', 129, ['milch'], { heat: 'pasteurisiert' }),
      item('Olivenöl 500 ml', 699, []),
      item('Linsen 500 g', 199, []),
      item('Haferflocken 500 g', 179, []),
      item('Roggen-Sauerteigbrot', 349, ['gluten']),
      item('Hartweizennudeln 500 g', 149, ['gluten', 'weizen']),
      item('Passierte Tomaten', 99, []),
    ],
  },
  {
    title: 'Fertigware',
    note: 'Tiefkühl, Fertiggerichte, Snacks, Limonade, H-Milch',
    items: [
      item('TK-Pizza Salami', 349, ['verarbeitet', 'gluten', 'weizen', 'samenoel', 'milch']),
      item('Fertiglasagne', 429, ['verarbeitet', 'gluten', 'weizen', 'pflanzenfett', 'milch']),
      item('Kartoffelchips', 229, ['verarbeitet', 'samenoel']),
      item('Cola 6 × 1,5 l', 499, ['verarbeitet', 'industriezucker']),
      item('Schokoriegel 5er', 249, ['verarbeitet', 'industriezucker', 'pflanzenfett', 'milch']),
      item('Toastbrot', 129, ['verarbeitet', 'gluten', 'weizen']),
      item('Fruchtjoghurt 4er', 219, ['verarbeitet', 'industriezucker', 'milch']),
      item('TK-Pommes', 249, ['verarbeitet', 'samenoel']),
      item('Fertigsoße Bolognese', 179, ['verarbeitet', 'industriezucker', 'samenoel']),
      item('Frühstücksflakes', 299, ['verarbeitet', 'industriezucker', 'gluten', 'weizen']),
      item('Wiener Würstchen', 249, ['verarbeitet']),
      item('Tütensuppe 3er', 189, ['verarbeitet', 'pflanzenfett']),
      item('H-Milch 6 × 1 l', 534, ['milch'], { heat: 'uht', homogenized: 'ja' }),
      item('Bananen', 200, []),
      item('Äpfel', 250, []),
    ],
  },
  {
    title: 'Gemischt',
    note: 'der Alltagsfall: frisch gekocht, aber mit Fertigem dazwischen',
    items: [
      item('Rispentomaten', 243, []),
      item('Äpfel', 250, []),
      item('Kartoffeln 2,5 kg', 249, []),
      item('Zwiebeln', 129, []),
      item('Salatgurke', 89, []),
      item('Hähnchenschenkel', 449, []),
      item('Rinderhack', 549, []),
      item('Eier 10er', 329, []),
      item('Butter 250 g', 239, ['milch'], { heat: 'pasteurisiert' }),
      item('Frischmilch 1 l', 119, ['milch'], { heat: 'pasteurisiert', homogenized: 'ja' }),
      item('Käse in Scheiben', 199, ['verarbeitet', 'milch'], { heat: 'pasteurisiert' }),
      item('Mischbrot', 279, ['gluten', 'weizen']),
      item('Hartweizennudeln 500 g', 149, ['gluten', 'weizen']),
      item('Fertigsoße Bolognese', 179, ['verarbeitet', 'industriezucker', 'samenoel']),
      item('TK-Pizza Salami', 349, ['verarbeitet', 'gluten', 'weizen', 'samenoel', 'milch']),
      item('Kartoffelchips', 229, ['verarbeitet', 'samenoel']),
      item('Fruchtjoghurt 4er', 219, ['verarbeitet', 'industriezucker', 'milch']),
      item('Olivenöl 500 ml', 699, []),
      item('Sonnenblumenöl 1 l', 249, ['samenoel']),
      item('Cola 6 × 1,5 l', 499, ['verarbeitet', 'industriezucker']),
    ],
  },
]

/* ============================================================== Die Rechnung */

/**
 * Die euro-gewichtete Durchschnittslast — der Wert, den `healthScore` intern
 * bildet, bevor die Konstante ihn in Punkte übersetzt.
 *
 * Hier noch einmal nachgebaut, damit sich der Score für **andere** Konstanten
 * zeigen lässt, ohne die Datei zu ändern. Dass der Nachbau stimmt, prüft das
 * Skript am Ende selbst gegen `healthScore`.
 */
function averageLoad(items: ReceiptItem[]): number {
  const totalCents = items.reduce((sum, i) => sum + i.totalCents, 0)
  if (totalCents === 0) return 0
  return items.reduce((sum, i) => sum + itemScore(i, traits) * i.totalCents, 0) / totalCents
}

function scoreAt(load: number, pointsPerWeight: number): number {
  return Math.max(0, Math.min(MAX_SCORE, Math.round(MAX_SCORE + load * pointsPerWeight)))
}

function euro(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €'
}

/* ================================================================= Ausgabe */

console.log('')
console.log(`Gesundheits-Score · POINTS_PER_WEIGHT = ${POINTS_PER_WEIGHT}`)
console.log('Score = 100 − POINTS_PER_WEIGHT × Durchschnittslast je Euro, gekappt auf 0…100')
console.log('')

for (const basket of BASKETS) {
  const totalCents = basket.items.reduce((sum, i) => sum + i.totalCents, 0)
  const load = averageLoad(basket.items)
  const score = healthScore(basket.items, traits)

  console.log(`── ${basket.title} ${'─'.repeat(Math.max(0, 60 - basket.title.length))}`)
  console.log(`   ${basket.note}`)
  console.log(
    `   ${basket.items.length} Positionen · ${euro(totalCents)} · Durchschnittslast ${load.toFixed(2)}`,
  )
  console.log(`   Score: ${score}`)
  console.log('')

  // Die drei Positionen, die den Score am stärksten drücken — Last mal
  // Euro-Anteil, denn genau so geht es in die Rechnung ein.
  const worst = basket.items
    .map((i) => ({ i, share: (itemScore(i, traits) * i.totalCents) / totalCents }))
    .filter((row) => row.share !== 0)
    .sort((a, b) => a.share - b.share)
    .slice(0, 3)

  if (worst.length > 0) {
    console.log('   Größter Anteil an der Last:')
    for (const row of worst) {
      console.log(
        `     ${row.i.name.padEnd(24)} ${euro(row.i.totalCents).padStart(8)}` +
          `  Position ${String(itemScore(row.i, traits)).padStart(3)}` +
          `  →  ${row.share.toFixed(2)} Punkte`,
      )
    }
    console.log('')
  }
}

/* ------------------------------------------------ wenn man an der Zahl dreht */

console.log('── Bei anderen Werten der Konstante ' + '─'.repeat(26))
console.log('')
const candidates = [6, 8, 10, 12, 15]
console.log('   ' + 'Korb'.padEnd(14) + candidates.map((c) => String(c).padStart(6)).join(''))
for (const basket of BASKETS) {
  const load = averageLoad(basket.items)
  console.log(
    '   ' +
      basket.title.padEnd(14) +
      candidates.map((c) => String(scoreAt(load, c)).padStart(6)).join(''),
  )
}
console.log('')

/* --------------------------------------------------------- Selbstkontrolle */

for (const basket of BASKETS) {
  const rebuilt = scoreAt(averageLoad(basket.items), POINTS_PER_WEIGHT)
  const actual = healthScore(basket.items, traits)
  if (rebuilt !== actual) {
    console.error(
      `Der Nachbau der Formel weicht ab (${basket.title}: ${rebuilt} statt ${actual}). ` +
        'Dieses Skript muss an src/lib/score.ts angepasst werden.',
    )
    process.exit(1)
  }
}
