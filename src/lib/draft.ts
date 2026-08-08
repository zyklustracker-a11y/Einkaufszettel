/**
 * Der Entwurf eines Bons — das, woran der Korrektur-Screen arbeitet.
 *
 * Zwischen „erkannt" und „gespeichert" liegt genau eine Form, und das ist die
 * hier. Sie ist bewusst näher an der Datenbank als an der Anzeige: ganze Cent,
 * ganze Basiseinheiten, Kategorie- und Merkmalsschlüssel. Umgerechnet wird nur
 * zum Zeichnen (`draftQuantity`) und beim Tippen im Eingabefeld.
 *
 * Warum eine eigene Datei und nicht alles im Screen: Summenabgleich,
 * Steuerklassen-Probe und der Aufbau der Speicher-Anfrage sind reine Funktionen
 * über Zahlen. Dieselbe Trennung wie bei `score.ts` und `progress.ts` — was sich
 * mit Tests festnageln lässt, gehört nicht in eine Komponente.
 *
 * Deshalb auch keine Laufzeit-Importe außer `format.ts`: Die Tests nebenan
 * laufen direkt mit `node --test`, ohne Bauschritt.
 */

// Mit Dateiendung, weil `node --test` die Tests nebenan ohne Bauschritt
// ausführt und den Pfad dann wörtlich nimmt (wie in `capture.ts`).
import { roundCents } from './format.ts'
import type {
  ExtractedItem,
  ExtractedUnit,
  Extraction,
  ItemKind,
  PrintedTaxGroup,
  TaxGroup,
} from './extraction'
import type { CategoryId, MilkHeat, MilkHomogenized, Quantity, TraitId } from '../types'

/* ============================================================ Die Merkmale,
 * die keine sind
 *
 * `roh`, `pasteurisiert`, `esl`, `uht` und `homogenisiert` sind zwar Merkmale
 * in der Tabelle, hängen am Produkt aber nicht als Etikett, sondern als
 * Sachattribut (`milk_heat`, `milk_homogenized`). Die Datenbank leitet sie in
 * `v_item_trait_keys` daraus wieder ab.
 *
 * Sie dürfen deshalb weder von Hand angehakt noch doppelt gespeichert werden —
 * sonst gäbe es zwei Quellen für dieselbe Aussage. Liefert das Modell sie als
 * Merkmal, werden sie hier in das passende Feld überführt.
 * ========================================================================== */

const HEAT_BY_TRAIT: Record<string, MilkHeat> = {
  roh: 'roh',
  pasteurisiert: 'pasteurisiert',
  esl: 'esl',
  uht: 'uht',
}

const HOMOGENIZED_TRAIT = 'homogenisiert'

/** Merkmale, die aus den Milch-Feldern entstehen und nicht angehakt werden. */
export const DERIVED_TRAIT_KEYS: TraitId[] = [...Object.keys(HEAT_BY_TRAIT), HOMOGENIZED_TRAIT]

/** Die Kategorie, bei der die beiden Milch-Felder erscheinen. */
export const DAIRY_CATEGORY: CategoryId = 'dairy'

/* ================================================================ Die Form */

export interface DraftItem {
  /** Stabil über alle Änderungen hinweg — Schlüssel für React und die Auswahl. */
  key: string
  rawText: string
  kind: ItemKind
  /** Der Klarname. Bei Pfand und Rabatt steht hier der Bontext. */
  name: string
  /** Null heißt „Kategorie offen" — dann entsteht kein kanonisches Produkt. */
  categoryKey: CategoryId | null
  traitKeys: TraitId[]
  milkHeat: MilkHeat
  milkHomogenized: MilkHomogenized
  /** Ganze Zahl in Gramm, Milliliter oder Stück. Null: ohne Mengenangabe. */
  quantityBase: number | null
  quantityUnit: ExtractedUnit | null
  /** Preis je Anzeige-Einheit in Cent. */
  unitPriceCents: number | null
  totalCents: number
  taxCode: string | null
  /** Der Rohtext war schon bekannt — die Zuordnung kam aus der Datenbank. */
  known: boolean
  canonicalProductId: string | null
  /** Vom Nutzer geändert. Entscheidet über `source` in `product_mappings`. */
  edited: boolean
  /** Von Hand ergänzt — es gibt keinen Rohtext, also nichts zu lernen. */
  added: boolean
}

/* ======================================================= Erkannt → Entwurf */

/**
 * Merkmale und Milch-Felder in Einklang bringen.
 *
 * Das Modell schlägt `uht` gern als Merkmal *und* als Erhitzung vor, manchmal
 * auch nur als Merkmal. Beides landet hier im Sachattribut; das Merkmal selbst
 * fällt aus der Liste. Das ausdrückliche Feld gewinnt, wenn beide etwas sagen.
 */
export function normalizeTraits(
  traitKeys: TraitId[],
  milkHeat: MilkHeat,
  milkHomogenized: MilkHomogenized,
): { traitKeys: TraitId[]; milkHeat: MilkHeat; milkHomogenized: MilkHomogenized } {
  let heat = milkHeat
  let homogenized = milkHomogenized

  for (const key of traitKeys) {
    if (heat === 'unbekannt' && HEAT_BY_TRAIT[key]) heat = HEAT_BY_TRAIT[key]
    if (homogenized === 'unbekannt' && key === HOMOGENIZED_TRAIT) homogenized = 'ja'
  }

  return {
    traitKeys: [...new Set(traitKeys.filter((key) => !DERIVED_TRAIT_KEYS.includes(key)))],
    milkHeat: heat,
    milkHomogenized: homogenized,
  }
}

function toDraft(item: ExtractedItem): DraftItem {
  const suggestion = item.suggestion
  const traits = normalizeTraits(
    suggestion?.traitKeys ?? [],
    suggestion?.milkHeat ?? 'unbekannt',
    suggestion?.milkHomogenized ?? 'unbekannt',
  )

  return {
    key: `z${item.lineNo}`,
    rawText: item.rawText,
    kind: item.kind,
    // Ohne Klarnamen steht da, was auf dem Bon stand — nie ein leeres Feld.
    name: suggestion?.name ?? item.rawText,
    categoryKey: suggestion?.categoryKey ?? null,
    traitKeys: traits.traitKeys,
    milkHeat: traits.milkHeat,
    milkHomogenized: traits.milkHomogenized,
    quantityBase: item.quantityBase,
    quantityUnit: item.quantityUnit,
    unitPriceCents: item.unitPriceCents,
    totalCents: item.totalCents,
    taxCode: item.taxCode,
    known: suggestion?.source === 'db',
    canonicalProductId: suggestion?.canonicalProductId ?? null,
    edited: false,
    added: false,
  }
}

export function toDrafts(extraction: Extraction): DraftItem[] {
  return extraction.items.map(toDraft)
}

/** Eine von Hand ergänzte Position — für die Zeile, die das Modell übersehen hat. */
export function emptyDraft(key: string): DraftItem {
  return {
    key,
    rawText: '',
    kind: 'artikel',
    name: '',
    categoryKey: null,
    traitKeys: [],
    milkHeat: 'unbekannt',
    milkHomogenized: 'unbekannt',
    quantityBase: null,
    quantityUnit: null,
    unitPriceCents: null,
    totalCents: 0,
    taxCode: null,
    known: false,
    canonicalProductId: null,
    edited: true,
    added: true,
  }
}

/**
 * Hat die Bearbeitung tatsächlich etwas geändert?
 *
 * Wichtig für den Lernkreis: Nur eine echte Änderung macht aus der Zuordnung
 * eine Nutzerkorrektur (`source: 'user'`). Wer eine Zeile nur aufklappt und
 * wieder schließt, hat nichts korrigiert — und soll eine ältere Korrektur nicht
 * versehentlich zu einem Modellvorschlag herabstufen.
 */
export function differs(before: DraftItem, after: DraftItem): boolean {
  return (
    before.name !== after.name ||
    before.categoryKey !== after.categoryKey ||
    before.milkHeat !== after.milkHeat ||
    before.milkHomogenized !== after.milkHomogenized ||
    before.quantityBase !== after.quantityBase ||
    before.quantityUnit !== after.quantityUnit ||
    before.unitPriceCents !== after.unitPriceCents ||
    before.totalCents !== after.totalCents ||
    before.taxCode !== after.taxCode ||
    before.traitKeys.length !== after.traitKeys.length ||
    before.traitKeys.some((key) => !after.traitKeys.includes(key))
  )
}

/* ============================================================ Mengenrechnen */

/** Basiseinheit → Anzeigewert: 1120 g werden zu 1,12 kg. */
export function displayAmount(base: number, unit: ExtractedUnit): number {
  return unit === 'kg' || unit === 'l' ? base / 1000 : base
}

/** Anzeigewert → Basiseinheit. Immer eine ganze Zahl. */
export function baseAmount(amount: number, unit: ExtractedUnit): number {
  return unit === 'kg' || unit === 'l' ? Math.round(amount * 1000) : Math.round(amount)
}

/**
 * Menge und Einzelpreis in die Anzeigeform bringen.
 *
 * Gleicher Ablauf wie `toQuantity` in `src/data/queries.ts`: Gramm und
 * Milliliter werden auf Kilo und Liter hochgerechnet, der Einzelpreis
 * entsprechend mit — die Oberfläche kennt nur Stück, Kilo und Liter.
 */
export function draftQuantity(draft: DraftItem): Quantity {
  const { quantityBase: base, quantityUnit: unit } = draft
  if (base === null || unit === null) return { kind: 'unknown' }

  if (unit === 'stk') {
    const unitPriceCents =
      draft.unitPriceCents ?? (base > 0 ? Math.round(draft.totalCents / base) : draft.totalCents)
    return { kind: 'count', count: base, unitPriceCents }
  }

  const displayUnit = unit === 'kg' || unit === 'g' ? 'kg' : 'l'
  const amount = base / 1000
  const factor = unit === 'g' || unit === 'ml' ? 1000 : 1
  const pricePerUnitCents =
    draft.unitPriceCents !== null
      ? draft.unitPriceCents * factor
      : amount > 0
        ? Math.round(draft.totalCents / amount)
        : draft.totalCents

  return { kind: 'weight', amount, unit: displayUnit, pricePerUnitCents }
}

/**
 * Was Menge × Einzelpreis ergibt — oder null, wenn sich nichts rechnen lässt.
 *
 * Nur ein Hinweis im Bearbeiten-Blatt, keine Korrektur: Welcher der drei Werte
 * falsch ist, weiß der Code nicht, und geraten wird nicht (PROJEKT.md).
 */
export function expectedTotalCents(draft: DraftItem): number | null {
  if (draft.unitPriceCents === null) return null
  if (draft.quantityBase === null || draft.quantityUnit === null) return draft.unitPriceCents
  return roundCents(displayAmount(draft.quantityBase, draft.quantityUnit) * draft.unitPriceCents)
}

/* ============================================================== Die Summen */

export function draftsTotalCents(drafts: DraftItem[]): number {
  return drafts.reduce((sum, draft) => sum + draft.totalCents, 0)
}

/**
 * Der Abgleich je Steuerklasse, gerechnet aus dem aktuellen Stand.
 *
 * Dieselben zwei Tore wie in der Edge Function (`checkTaxGroups`), nur dass
 * hier bei jeder Änderung neu gerechnet wird — der Nutzer soll beim Korrigieren
 * sehen, ob die Lücke geschlossen ist, statt eine Warnung von vor fünf
 * Bearbeitungen zu lesen.
 *
 *   * Ohne gedruckten Steuerblock gibt es nichts zu vergleichen.
 *   * Fehlt auch nur einer Position ihr Kennzeichen, wäre eine Klasse
 *     zwangsläufig zu niedrig. Dann kommt `missingCodes` zurück, und der Screen
 *     sagt das, statt eine falsche Abweichung anzuzeigen.
 */
export interface TaxReconciliation {
  groups: TaxGroup[]
  /** Positionen ohne Steuerkennzeichen — solange welche fehlen, wird nicht verglichen. */
  missingCodes: number
  /** Kennzeichen an Positionen, die im gedruckten Block gar nicht vorkommen. */
  unknownCodes: string[]
}

export function taxReconciliation(
  drafts: DraftItem[],
  printed: PrintedTaxGroup[],
): TaxReconciliation {
  if (printed.length === 0) return { groups: [], missingCodes: 0, unknownCodes: [] }

  const missingCodes = drafts.filter((draft) => draft.taxCode === null).length

  const sums = new Map<string, number>()
  for (const draft of drafts) {
    if (draft.taxCode === null) continue
    sums.set(draft.taxCode, (sums.get(draft.taxCode) ?? 0) + draft.totalCents)
  }

  const codes = new Set(printed.map((group) => group.code))
  const unknownCodes = [...sums.keys()].filter((code) => !codes.has(code)).sort()

  if (missingCodes > 0) return { groups: [], missingCodes, unknownCodes }

  return {
    groups: printed.map(({ code, grossCents }) => {
      const itemsTotalCents = sums.get(code) ?? 0
      return { code, grossCents, itemsTotalCents, differenceCents: grossCents - itemsTotalCents }
    }),
    missingCodes,
    unknownCodes,
  }
}

/* ====================================================== Entwurf → Speichern */

/**
 * Die Anfrage an `save_receipt` in der Datenbank.
 *
 * Deutsche Schlüssel und `snake_case`, wie überall an der Grenze zum Server.
 * Die Form steht im Kopf von `supabase/migrations/0003_speichern.sql`; wer hier
 * etwas ändert, ändert es dort mit.
 */
export interface SavePosition {
  rohtext: string
  art: ItemKind
  name: string
  kategorie: string | null
  merkmale: string[]
  milch_erhitzung: MilkHeat
  milch_homogenisiert: MilkHomogenized
  menge_basis: number | null
  menge_einheit: ExtractedUnit | null
  einzelpreis_cent: number | null
  zeilensumme_cent: number
  pfand_cent: number
  rabatt_cent: number
  steuer: string | null
  quelle: 'user' | 'model'
  produkt_id: string | null
}

export interface SavePayload {
  haendler: string | null
  gekauft_am: string
  summe_cent: number
  positionen: SavePosition[]
}

export function buildSavePayload(input: {
  merchantName: string | null
  purchasedOn: string
  printedTotalCents: number | null
  drafts: DraftItem[]
}): SavePayload {
  const drafts = input.drafts

  return {
    haendler: input.merchantName?.trim() || null,
    gekauft_am: input.purchasedOn,
    // Ohne gelesene Gesamtsumme gilt, was die Positionen ergeben. Der Bon hat
    // dann keine Abweichung — es gibt nichts, wogegen er abweichen könnte.
    summe_cent: input.printedTotalCents ?? draftsTotalCents(drafts),
    positionen: drafts.map((draft) => {
      const name = draft.name.trim() || draft.rawText.trim()
      return {
        rohtext: draft.rawText.trim(),
        art: draft.kind,
        name,
        // Pfand und Rabatt sind keine Produkte: keine Kategorie, keine Merkmale.
        kategorie: draft.kind === 'artikel' ? draft.categoryKey : null,
        merkmale: draft.kind === 'artikel' ? draft.traitKeys : [],
        milch_erhitzung: draft.kind === 'artikel' ? draft.milkHeat : 'unbekannt',
        milch_homogenisiert: draft.kind === 'artikel' ? draft.milkHomogenized : 'unbekannt',
        menge_basis: draft.quantityBase,
        menge_einheit: draft.quantityUnit,
        einzelpreis_cent: draft.unitPriceCents,
        zeilensumme_cent: draft.totalCents,
        pfand_cent: draft.kind === 'pfand' ? Math.abs(draft.totalCents) : 0,
        rabatt_cent: draft.kind === 'rabatt' ? Math.abs(draft.totalCents) : 0,
        steuer: draft.taxCode,
        quelle: draft.edited ? 'user' : 'model',
        produkt_id: draft.canonicalProductId,
      }
    }),
  }
}

/** Wie viele Artikel noch ohne Kategorie sind — die bekommen kein Produkt. */
export function withoutCategory(drafts: DraftItem[]): number {
  return drafts.filter((draft) => draft.kind === 'artikel' && draft.categoryKey === null).length
}
