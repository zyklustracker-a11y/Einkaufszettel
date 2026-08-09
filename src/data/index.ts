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

export {
  loadReference,
  clearReference,
  refreshMerchants,
  refreshCategories,
  refreshTraits,
} from './reference'
export type { Reference } from './reference'

/**
 * Die Kategorieverwaltung aus den Einstellungen. Sie schreibt in `categories`
 * und frischt danach das Zwischenlager auf — auch das gehört in diese Schicht
 * und nicht in einen Screen.
 */
export {
  checkNewCategoryName,
  createCategory,
  getCategoryProductCounts,
  moveCategory,
  setCategoryActive,
  sortedCategories,
  suggestCategoryColor,
  updateCategory,
} from './categories'
export type { CategoryEdit, NewCategory } from './categories'

/**
 * Die Merkmalsverwaltung. Sie schreibt in `traits` und frischt danach das
 * Zwischenlager auf — daran hängt der Health-Score, der bei jeder Anzeige neu
 * gerechnet wird.
 */
export {
  checkNewTraitName,
  createTrait,
  existingTraitGroups,
  getTraitProductCounts,
  moveTrait,
  setTraitActive,
  sortedTraits,
  updateTrait,
} from './traits'
export type { NewTrait, TraitEdit } from './traits'

export { useQuery } from './useQuery'
export type { QueryState } from './useQuery'

export { DataError, germanDataError } from './client'

/**
 * Die Bon-Erkennung. Sie spricht nicht mit der Datenbank, sondern mit der Edge
 * Function — steht aber aus demselben Grund hier: Screens erreichen den Server
 * ausschließlich über diese Schicht.
 */
export { extractReceipt, resumeScan, fetchExchangeRate, ExtractionError } from './extract'
export type { ExtractionPhase } from './extract'

/**
 * Der Rettungsweg für ein Scan-Ergebnis, das nirgends ankommt, weil iOS die
 * Seite eingefroren hat (KONZEPT-ERWEITERUNGEN.md, Abschnitt 3).
 */
export { startScanJob, getScanJob, findOpenScanJob, consumeScanJob } from './scanJobs'
export type { ScanJob } from './scanJobs'

/**
 * Schreiben. Bis Schritt 4b-2 gab es hier nur das Monatsbudget; seitdem
 * entstehen Bons — und zwar ganz oder gar nicht (siehe `save.ts`).
 */
export { saveReceipt, deleteReceipt } from './save'

/**
 * Der Einkaufszettel. Die Rechenarbeit steckt in den Sichten
 * (`v_product_rhythm`, `v_shopping_suggestions`); hier steht das Bedienen.
 */
/** Haushalt und Einladungen — der Weg von drei Konten zu einem Haushalt. */
export {
  createInvite,
  getHouseholdMembers,
  getInvite,
  getOwnReceiptCount,
  joinHousehold,
  revokeInvite,
} from './household'
export type { HouseholdMember, Invite } from './household'

export {
  getShoppingList,
  getShoppingProgress,
  setShoppingItemChecked,
  setShoppingItemQuantity,
  removeShoppingItem,
  addShoppingItem,
  completeShoppingList,
} from './shopping'

export {
  getDashboardData,
  getAnalyticsData,
  getHealthData,
  getPriceOverview,
  getProductPriceDetail,
  getReceipt,
  getReceiptDraft,
  getHouseholdStats,
  getMonthlyBudgetCents,
  saveMonthlyBudgetCents,
  searchItemSpending,
} from './queries'
export type {
  AnalyticsData,
  DashboardData,
  HealthData,
  ReceiptDraftData,
  RecentReceipt,
} from './queries'

/* ------------------------------------------------- Stammdaten, synchron */

/**
 * **Alle** Kategorien, auch abgeschaltete.
 *
 * Zum Nachschlagen gedacht: Ein Produkt aus dem letzten Jahr kann auf eine
 * Kategorie zeigen, die es in der Auswahl nicht mehr gibt — sein Name soll
 * trotzdem dastehen und nicht der rohe Schlüssel.
 */
/** Der Haushalt, zu dem der angemeldete Nutzer gehört. */
export const getHouseholdId = (): string => reference().householdId

export const getCategories = (): Category[] => reference().categories

/** Nur aktive Kategorien erreichen die Auswahl. Das ist der Sinn von „aus". */
export const getActiveCategories = (): Category[] =>
  reference().categories.filter((c) => c.active)

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
