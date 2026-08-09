import type { Receipt } from '../types'
import { daysAgo } from './dates'

/**
 * Scanned receipts, newest first, dated relative to today.
 *
 * The Rewe receipt is the deliberate edge case: it is always the newest one,
 * and its line items add up to 41,98 € while the paper total reads 42,17 €, so
 * the correction screen shows the amber "weicht ab" warning. The other two
 * reconcile exactly.
 *
 * Traits are spread wide enough to exercise the UI: ten different active ones
 * occur, the frozen pizza carries the five from the PROJEKT.md control case and
 * the ready lasagne six, so the badge row has to fall back to "+N". Dairy items
 * carry `milkHeat` / `milkHomogenized`; cheeses stay `unbekannt`, because a
 * receipt does not say. `zusatzstoffe` is tagged on the gummy bears although the
 * trait is switched off — turning it on later needs no rescan.
 */
export const receipts: Receipt[] = [
  {
    id: 'rec-rewe',
    merchantId: 'rewe',
    date: daysAgo(0),
    printedTotalCents: 4217,
    tipCents: 0,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 3, unitPriceCents: 129 }, totalCents: 387, traitIds: ['milch'], milkHeat: 'uht', milkHomogenized: 'ja' },
      { id: 'i2', name: 'Butter', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, traitIds: ['milch'], milkHeat: 'pasteurisiert', milkHomogenized: 'nein' },
      { id: 'i3', name: 'Eier, Freiland (10er)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, traitIds: [] },
      { id: 'i4', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.12, unit: 'kg', pricePerUnitCents: 179 }, totalCents: 200, traitIds: [] },
      { id: 'i5', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, totalCents: 699, traitIds: [] },
      { id: 'i6', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, traitIds: ['gluten', 'weizen'] },
      { id: 'i7', name: 'Toastbrötchen (6er)', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 149 }, totalCents: 149, traitIds: ['verarbeitet', 'gluten', 'weizen', 'industriezucker'] },
      { id: 'i8', name: 'Sonnenblumenöl', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 219 }, totalCents: 219, traitIds: ['samenoel'] },
      { id: 'i9', name: 'Frischkäse (Eigenmarke)', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPriceCents: 99 }, totalCents: 99, traitIds: ['milch', 'verarbeitet'], milkHeat: 'pasteurisiert', milkHomogenized: 'unbekannt' },
      { id: 'i10', name: 'Tiefkühl-Pizza Salami', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPriceCents: 279 }, totalCents: 558, traitIds: ['verarbeitet', 'samenoel', 'pflanzenfett', 'weizen', 'gluten'] },
      { id: 'i11', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, traitIds: [] },
      { id: 'i12', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 179 }, totalCents: 179, traitIds: [] },
      { id: 'i13', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.31, unit: 'kg', pricePerUnitCents: 890 }, totalCents: 276, traitIds: ['milch'], milkHeat: 'pasteurisiert', milkHomogenized: 'unbekannt' },
      { id: 'i14', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 89 }, totalCents: 89, traitIds: [] },
      { id: 'i15', name: 'Karotten (1 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 147 }, totalCents: 147, traitIds: [] },
    ],
  },
  {
    id: 'rec-lidl',
    merchantId: 'lidl',
    date: daysAgo(2),
    printedTotalCents: 2349,
    tipCents: 0,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 4, unitPriceCents: 115 }, totalCents: 460, traitIds: ['milch'], milkHeat: 'uht', milkHomogenized: 'ja' },
      { id: 'i2', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.08, unit: 'kg', pricePerUnitCents: 169 }, totalCents: 183, traitIds: [] },
      { id: 'i3', name: 'Rinderhack (500 g)', categoryId: 'meat', quantity: { kind: 'count', count: 1, unitPriceCents: 499 }, totalCents: 499, traitIds: [] },
      { id: 'i4', name: 'Schokolade Vollmilch', categoryId: 'sweets', quantity: { kind: 'count', count: 3, unitPriceCents: 129 }, totalCents: 387, traitIds: ['verarbeitet', 'industriezucker', 'milch', 'pflanzenfett'] },
      { id: 'i5', name: 'Apfelsaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPriceCents: 145 }, totalCents: 290, traitIds: [] },
      { id: 'i6', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.25, unit: 'kg', pricePerUnitCents: 890 }, totalCents: 223, traitIds: ['milch'], milkHeat: 'pasteurisiert', milkHomogenized: 'unbekannt' },
      { id: 'i7', name: 'Haferflocken (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 89 }, totalCents: 178, traitIds: [] },
      { id: 'i8', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 129 }, totalCents: 129, traitIds: [] },
    ],
  },
  {
    id: 'rec-edeka',
    merchantId: 'edeka',
    date: daysAgo(5),
    printedTotalCents: 6130,
    tipCents: 0,
    items: [
      { id: 'i1', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, totalCents: 729, traitIds: [] },
      { id: 'i2', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 319 }, totalCents: 319, traitIds: ['gluten', 'weizen'] },
      { id: 'i3', name: 'Kaffeebohnen (1 kg)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 799 }, totalCents: 799, traitIds: [] },
      { id: 'i4', name: 'Rispentomaten', categoryId: 'produce', quantity: { kind: 'weight', amount: 0.61, unit: 'kg', pricePerUnitCents: 399 }, totalCents: 243, traitIds: [] },
      { id: 'i5', name: 'Äpfel Elstar', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.23, unit: 'kg', pricePerUnitCents: 279 }, totalCents: 343, traitIds: [] },
      { id: 'i6', name: 'Kartoffeln (2,5 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, traitIds: [] },
      { id: 'i7', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 89 }, totalCents: 89, traitIds: [] },
      { id: 'i8', name: 'Naturjoghurt (500 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPriceCents: 79 }, totalCents: 158, traitIds: ['milch'], milkHeat: 'pasteurisiert', milkHomogenized: 'nein' },
      { id: 'i9', name: 'Mozzarella (125 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPriceCents: 99 }, totalCents: 198, traitIds: ['milch', 'verarbeitet'], milkHeat: 'pasteurisiert', milkHomogenized: 'unbekannt' },
      { id: 'i10', name: 'Nudeln (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 119 }, totalCents: 238, traitIds: ['gluten', 'weizen'] },
      { id: 'i11', name: 'Passierte Tomaten', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 99 }, totalCents: 198, traitIds: [] },
      { id: 'i12', name: 'Müsliriegel (6er)', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, traitIds: ['verarbeitet', 'industriezucker', 'samenoel', 'gluten', 'weizen'] },
      { id: 'i13', name: 'Gummibärchen', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPriceCents: 119 }, totalCents: 119, traitIds: ['verarbeitet', 'industriezucker', 'zusatzstoffe'] },
      { id: 'i14', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPriceCents: 399 }, totalCents: 399, traitIds: [] },
      { id: 'i15', name: 'Orangensaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPriceCents: 199 }, totalCents: 398, traitIds: [] },
      { id: 'i16', name: 'Fertig-Lasagne (400 g)', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPriceCents: 279 }, totalCents: 558, traitIds: ['verarbeitet', 'samenoel', 'pflanzenfett', 'weizen', 'gluten', 'milch'] },
      { id: 'i17', name: 'Toilettenpapier (10 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 495 }, totalCents: 495, traitIds: [] },
      { id: 'i18', name: 'Küchenrolle (4 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, traitIds: [] },
    ],
  },
]

/** The receipt the scan flow pretends to have just read. */
export const scannedReceiptId = 'rec-rewe'
