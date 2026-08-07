import type { Merchant } from '../types'

/**
 * The shops we buy at.
 *
 * Receipts and price points reference these by `id`, never by name, so a new
 * shop is one row here and nothing else. With Supabase this becomes a
 * `merchants` table per household; the ids stay the stable key, the names are
 * display text and may be edited.
 */
export const merchants: Merchant[] = [
  { id: 'rewe', name: 'Rewe' },
  { id: 'edeka', name: 'Edeka' },
  { id: 'lidl', name: 'Lidl' },
  { id: 'aldi', name: 'Aldi' },
]
