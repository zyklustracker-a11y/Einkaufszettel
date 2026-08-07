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
    merchant: 'Rewe',
    date: '2026-08-14',
    printedTotal: 42.17,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 3, unitPrice: 1.29 }, total: 3.87, flags: [] },
      { id: 'i2', name: 'Butter', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPrice: 2.49 }, total: 2.49, flags: [] },
      { id: 'i3', name: 'Eier, Freiland (10er)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPrice: 3.49 }, total: 3.49, flags: [] },
      { id: 'i4', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.12, unit: 'kg', pricePerUnit: 1.79 }, total: 2.0, flags: [] },
      { id: 'i5', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, total: 6.99, flags: [] },
      { id: 'i6', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPrice: 2.49 }, total: 2.49, flags: ['gluten'] },
      { id: 'i7', name: 'Toastbrötchen (6er)', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPrice: 1.49 }, total: 1.49, flags: ['processed', 'gluten'] },
      { id: 'i8', name: 'Sonnenblumenöl', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPrice: 2.19 }, total: 2.19, flags: ['seedOil'] },
      { id: 'i9', name: 'Frischkäse (Eigenmarke)', categoryId: 'dairy', quantity: { kind: 'count', count: 1, unitPrice: 0.99 }, total: 0.99, flags: ['cheapDairy'] },
      { id: 'i10', name: 'Tiefkühl-Pizza Salami', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPrice: 2.79 }, total: 5.58, flags: ['processed', 'seedOil'] },
      { id: 'i11', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPrice: 3.49 }, total: 3.49, flags: [] },
      { id: 'i12', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPrice: 1.79 }, total: 1.79, flags: [] },
      { id: 'i13', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.31, unit: 'kg', pricePerUnit: 8.9 }, total: 2.76, flags: [] },
      { id: 'i14', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPrice: 0.89 }, total: 0.89, flags: [] },
      { id: 'i15', name: 'Karotten (1 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPrice: 1.47 }, total: 1.47, flags: [] },
    ],
  },
  {
    id: 'rec-2026-08-12-lidl',
    merchant: 'Lidl',
    date: '2026-08-12',
    printedTotal: 23.49,
    items: [
      { id: 'i1', name: 'H-Milch 3,5 %', categoryId: 'dairy', quantity: { kind: 'count', count: 4, unitPrice: 1.15 }, total: 4.6, flags: [] },
      { id: 'i2', name: 'Bananen', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.08, unit: 'kg', pricePerUnit: 1.69 }, total: 1.83, flags: [] },
      { id: 'i3', name: 'Rinderhack (500 g)', categoryId: 'meat', quantity: { kind: 'count', count: 1, unitPrice: 4.99 }, total: 4.99, flags: [] },
      { id: 'i4', name: 'Schokolade Vollmilch', categoryId: 'sweets', quantity: { kind: 'count', count: 3, unitPrice: 1.29 }, total: 3.87, flags: ['processed'] },
      { id: 'i5', name: 'Apfelsaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPrice: 1.45 }, total: 2.9, flags: [] },
      { id: 'i6', name: 'Gouda am Stück', categoryId: 'dairy', quantity: { kind: 'weight', amount: 0.25, unit: 'kg', pricePerUnit: 8.9 }, total: 2.23, flags: [] },
      { id: 'i7', name: 'Haferflocken (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPrice: 0.89 }, total: 1.78, flags: [] },
      { id: 'i8', name: 'Spülmittel', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPrice: 1.29 }, total: 1.29, flags: [] },
    ],
  },
  {
    id: 'rec-2026-08-09-edeka',
    merchant: 'Edeka',
    date: '2026-08-09',
    printedTotal: 61.3,
    items: [
      { id: 'i1', name: 'Hähnchenbrust', categoryId: 'meat', quantity: { kind: 'unknown' }, total: 7.29, flags: [] },
      { id: 'i2', name: 'Sauerteigbrot', categoryId: 'bakery', quantity: { kind: 'count', count: 1, unitPrice: 3.19 }, total: 3.19, flags: ['gluten'] },
      { id: 'i3', name: 'Kaffeebohnen (1 kg)', categoryId: 'staples', quantity: { kind: 'count', count: 1, unitPrice: 7.99 }, total: 7.99, flags: [] },
      { id: 'i4', name: 'Rispentomaten', categoryId: 'produce', quantity: { kind: 'weight', amount: 0.61, unit: 'kg', pricePerUnit: 3.99 }, total: 2.43, flags: [] },
      { id: 'i5', name: 'Äpfel Elstar', categoryId: 'produce', quantity: { kind: 'weight', amount: 1.23, unit: 'kg', pricePerUnit: 2.79 }, total: 3.43, flags: [] },
      { id: 'i6', name: 'Kartoffeln (2,5 kg)', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPrice: 3.49 }, total: 3.49, flags: [] },
      { id: 'i7', name: 'Salatgurke', categoryId: 'produce', quantity: { kind: 'count', count: 1, unitPrice: 0.89 }, total: 0.89, flags: [] },
      { id: 'i8', name: 'Naturjoghurt (500 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPrice: 0.79 }, total: 1.58, flags: [] },
      { id: 'i9', name: 'Mozzarella (125 g)', categoryId: 'dairy', quantity: { kind: 'count', count: 2, unitPrice: 0.99 }, total: 1.98, flags: ['cheapDairy'] },
      { id: 'i10', name: 'Nudeln (500 g)', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPrice: 1.19 }, total: 2.38, flags: ['gluten'] },
      { id: 'i11', name: 'Passierte Tomaten', categoryId: 'staples', quantity: { kind: 'count', count: 2, unitPrice: 0.99 }, total: 1.98, flags: [] },
      { id: 'i12', name: 'Müsliriegel (6er)', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPrice: 2.49 }, total: 2.49, flags: ['processed', 'seedOil'] },
      { id: 'i13', name: 'Gummibärchen', categoryId: 'sweets', quantity: { kind: 'count', count: 1, unitPrice: 1.19 }, total: 1.19, flags: ['processed'] },
      { id: 'i14', name: 'Mineralwasser (6 × 1,5 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 1, unitPrice: 3.99 }, total: 3.99, flags: [] },
      { id: 'i15', name: 'Orangensaft (1 l)', categoryId: 'drinks', quantity: { kind: 'count', count: 2, unitPrice: 1.99 }, total: 3.98, flags: [] },
      { id: 'i16', name: 'Fertig-Lasagne (400 g)', categoryId: 'readymeals', quantity: { kind: 'count', count: 2, unitPrice: 2.79 }, total: 5.58, flags: ['processed', 'seedOil'] },
      { id: 'i17', name: 'Toilettenpapier (10 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPrice: 4.95 }, total: 4.95, flags: [] },
      { id: 'i18', name: 'Küchenrolle (4 Rollen)', categoryId: 'nonfood', quantity: { kind: 'count', count: 1, unitPrice: 2.49 }, total: 2.49, flags: [] },
    ],
  },
]

/** The receipt the scan flow pretends to have just read. */
export const scannedReceiptId = 'rec-2026-08-14-rewe'
