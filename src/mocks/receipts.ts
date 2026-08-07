import type { Receipt } from '../types'

/**
 * Scanned receipts, newest first.
 *
 * The Rewe receipt is the deliberate edge case: its line items add up to
 * 41,98 € while the paper total reads 42,17 €, so the correction screen shows
 * the amber "weicht ab" warning. The other two reconcile exactly.
 */
export const receipts: Receipt[] = [
  {
    id: 'rec-2026-08-14-rewe',
    merchantId: 'rewe',
    date: '2026-08-14',
    printedTotalCents: 4217,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 3, unitPriceCents: 129 }, totalCents: 387, flags: [] },
      { id: 'i2', name: 'Butter', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, flags: [] },
      { id: 'i3', name: 'Eier, Freiland (10er)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, flags: [] },
      { id: 'i4', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.12, unit: 'kg', pricePerUnitCents: 179 }, totalCents: 200, flags: [] },
      { id: 'i5', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, totalCents: 699, flags: [] },
      { id: 'i6', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, flags: ['gluten'] },
      { id: 'i7', name: 'Toastbrötchen (6er)', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 149 }, totalCents: 149, flags: ['processed', 'gluten'] },
      { id: 'i8', name: 'Sonnenblumenöl', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 219 }, totalCents: 219, flags: ['seedOil'] },
      { id: 'i9', name: 'Frischkäse (Eigenmarke)', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPriceCents: 99 }, totalCents: 99, flags: ['cheapDairy'] },
      { id: 'i10', name: 'Tiefkühl-Pizza Salami', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPriceCents: 279 }, totalCents: 558, flags: ['processed', 'seedOil'] },
      { id: 'i11', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, flags: [] },
      { id: 'i12', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 179 }, totalCents: 179, flags: [] },
      { id: 'i13', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.31, unit: 'kg', pricePerUnitCents: 890 }, totalCents: 276, flags: [] },
      { id: 'i14', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 89 }, totalCents: 89, flags: [] },
      { id: 'i15', name: 'Karotten (1 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 147 }, totalCents: 147, flags: [] },
    ],
  },
  {
    id: 'rec-2026-08-12-lidl',
    merchantId: 'lidl',
    date: '2026-08-12',
    printedTotalCents: 2349,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 4, unitPriceCents: 115 }, totalCents: 460, flags: [] },
      { id: 'i2', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.08, unit: 'kg', pricePerUnitCents: 169 }, totalCents: 183, flags: [] },
      { id: 'i3', name: 'Rinderhack (500 g)', categoryId: 'meat', quantity: { kind: 'count', count: 1, unitPriceCents: 499 }, totalCents: 499, flags: [] },
      { id: 'i4', name: 'Schokolade Vollmilch', categoryId: 'sweets', quantity: { kind: 'count', count: 3, unitPriceCents: 129 }, totalCents: 387, flags: ['processed'] },
      { id: 'i5', name: 'Apfelsaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPriceCents: 145 }, totalCents: 290, flags: [] },
      { id: 'i6', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.25, unit: 'kg', pricePerUnitCents: 890 }, totalCents: 223, flags: [] },
      { id: 'i7', name: 'Haferflocken (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 89 }, totalCents: 178, flags: [] },
      { id: 'i8', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 129 }, totalCents: 129, flags: [] },
    ],
  },
  {
    id: 'rec-2026-08-09-edeka',
    merchantId: 'edeka',
    date: '2026-08-09',
    printedTotalCents: 6130,
    items: [
      { id: 'i1', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, totalCents: 729, flags: [] },
      { id: 'i2', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPriceCents: 319 }, totalCents: 319, flags: ['gluten'] },
      { id: 'i3', name: 'Kaffeebohnen (1 kg)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPriceCents: 799 }, totalCents: 799, flags: [] },
      { id: 'i4', name: 'Rispentomaten', categoryId: 'produce', quantity: { kind: 'weight', amount: 0.61, unit: 'kg', pricePerUnitCents: 399 }, totalCents: 243, flags: [] },
      { id: 'i5', name: 'Äpfel Elstar', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.23, unit: 'kg', pricePerUnitCents: 279 }, totalCents: 343, flags: [] },
      { id: 'i6', name: 'Kartoffeln (2,5 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 349 }, totalCents: 349, flags: [] },
      { id: 'i7', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPriceCents: 89 }, totalCents: 89, flags: [] },
      { id: 'i8', name: 'Naturjoghurt (500 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPriceCents: 79 }, totalCents: 158, flags: [] },
      { id: 'i9', name: 'Mozzarella (125 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPriceCents: 99 }, totalCents: 198, flags: ['cheapDairy'] },
      { id: 'i10', name: 'Nudeln (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 119 }, totalCents: 238, flags: ['gluten'] },
      { id: 'i11', name: 'Passierte Tomaten', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPriceCents: 99 }, totalCents: 198, flags: [] },
      { id: 'i12', name: 'Müsliriegel (6er)', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, flags: ['processed', 'seedOil'] },
      { id: 'i13', name: 'Gummibärchen', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPriceCents: 119 }, totalCents: 119, flags: ['processed'] },
      { id: 'i14', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPriceCents: 399 }, totalCents: 399, flags: [] },
      { id: 'i15', name: 'Orangensaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPriceCents: 199 }, totalCents: 398, flags: [] },
      { id: 'i16', name: 'Fertig-Lasagne (400 g)', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPriceCents: 279 }, totalCents: 558, flags: ['processed', 'seedOil'] },
      { id: 'i17', name: 'Toilettenpapier (10 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 495 }, totalCents: 495, flags: [] },
      { id: 'i18', name: 'Küchenrolle (4 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPriceCents: 249 }, totalCents: 249, flags: [] },
    ],
  },
]

/** The receipt the scan flow pretends to have just read. */
export const scannedReceiptId = 'rec-2026-08-14-rewe'
