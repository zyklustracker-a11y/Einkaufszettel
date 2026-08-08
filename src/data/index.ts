/**
 * Die Datenschicht — die einzige Stelle, an der die Screens die Datenbank
 * berühren.
 *
 * Bis Schritt 2b kamen die Ergebnisse aus `src/mocks/`. Seit 2c kommen sie aus
 * Supabase. Die Dateien unter `src/mocks/` bleiben als Referenz für Typen und
 * Tests liegen, werden von hier aus aber nicht mehr gelesen — und von einer
 * Komponente erst recht nicht.
 *
 * Zwei Sorten Funktionen liegen hier:
 *
 *   * **Synchron** — Stammdaten (Kategorien, Merkmale, Händler). Sie stehen
 *     nach dem Start im Zwischenlager und lassen sich mitten im Rendern
 *     nachschlagen. Gefüllt wird es von `<DataGate>`.
 *   * **Asynchron** — alles, was von Bons abhängt. Eine Funktion je Screen,
 *     damit ein Screen genau einen Ladezustand hat.
 */

import { reference } from './reference'
import type { Category, Merchant, MerchantId, Trait, TraitId } from '../types'

export { loadReference, clearReference, refreshMerchants } from './reference'
export type { Reference } from './reference'

export { useQuery } from './useQuery'
export type { QueryState } from './useQuery'

export { DataError, germanDataError } from './client'

/**
 * Die Bon-Erkennung. Sie spricht nicht mit der Datenbank, sondern mit der Edge
 * Function — steht aber aus demselben Grund hier: Screens erreichen den Server
 * ausschließlich über diese Schicht.
 */
export { extractReceipt, ExtractionError } from './extract'
export type { ExtractionPhase } from './extract'

/**
 * Schreiben. Bis Schritt 4b-2 gab es hier nur das Monatsbudget; seitdem
 * entstehen Bons — und zwar ganz oder gar nicht (siehe `save.ts`).
 */
export { saveReceipt, deleteReceipt } from './save'

export {
  getDashboardData,
  getAnalyticsData,
  getHealthData,
  getPriceOverview,
  getProductPriceDetail,
  getReceipt,
  getMonthlyBudgetCents,
  saveMonthlyBudgetCents,
  searchItemSpending,
} from './queries'
export type { AnalyticsData, DashboardData, HealthData, RecentReceipt } from './queries'

/* ------------------------------------------------- Stammdaten, synchron */

export const getCategories = (): Category[] => reference().categories

export const getCategory = (id: string): Category | undefined =>
  reference().categories.find((c) => c.id === id)

export const getTraits = (): Trait[] => reference().traits

export const getTrait = (id: TraitId): Trait | undefined =>
  reference().traits.find((t) => t.id === id)

/** Nur aktive Merkmale erreichen die Oberfläche; inaktive behalten ihre Daten. */
export const getActiveTraits = (): Trait[] => reference().traits.filter((t) => t.active)

export const getMerchants = (): Merchant[] => reference().merchants

export const getMerchant = (id: MerchantId): Merchant | undefined =>
  reference().merchants.find((m) => m.id === id)

/**
 * Anzeigename eines Händlers. Ein Bon ohne Händler ist möglich (etwa über „Text
 * einfügen"), deshalb gibt es hier zwei verschiedene Ersatztexte statt der
 * rohen id — eine uuid hilft niemandem weiter.
 */
export const getMerchantName = (id: MerchantId): string => {
  if (!id) return 'Ohne Händler'
  return getMerchant(id)?.name ?? 'Unbekannter Laden'
}
