import type { Merchant } from '../types'

/**
 * The shops we buy at.
 *
 * Receipts and price points reference these by `id`, never by name, so a new
 * shop is one row here and nothing else. With Supabase this becomes a
 * `merchants` table per household; the ids stay the stable key, the names are
 * display text and may be edited.
 *
 * `kind` kam mit Schritt 5 dazu. Es hängt am Händler und nicht am Beleg: Einmal
 * auf `gastro` gestellt, gilt es für alle künftigen Bons dieses Ladens.
 */
export const merchants: Merchant[] = [
  { id: 'rewe', name: 'Rewe', kind: 'retail' },
  { id: 'edeka', name: 'Edeka', kind: 'retail' },
  { id: 'lidl', name: 'Lidl', kind: 'retail' },
  { id: 'aldi', name: 'Aldi', kind: 'retail' },
  { id: 'trattoria', name: 'Trattoria da Vinci', kind: 'gastro' },
]
