import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList, TraitLegend } from '../components/ReceiptItemList'
import { Async, EmptyState } from '../components/states'
import { getCategories, getMerchantName, getScannedReceipt, useQuery } from '../data'
import { receiptItemsTotal } from '../lib/derive'
import type { ExtractedItem, ExtractionResponse } from '../lib/extraction'
import { daysBetween, formatDate, formatEuro, formatMonth, roundCents, todayISO } from '../lib/format'
import { getPendingExtraction } from '../lib/scanResult'
import type { CategoryId, Quantity, Receipt, ReceiptItem } from '../types'
import styles from './ScanReview.module.css'

/**
 * Recomputes the line total after an edit, keeping quantity × price honest.
 * A weight times a €/kg price lands between cents, so the result is rounded.
 */
function applyPricing(
  quantity: Quantity,
  amount: number,
  priceCents: number,
): { quantity: Quantity; totalCents: number } {
  switch (quantity.kind) {
    case 'count': {
      const count = Math.max(1, Math.round(amount))
      return {
        quantity: { kind: 'count', count, unitPriceCents: priceCents },
        totalCents: roundCents(count * priceCents),
      }
    }
    case 'weight':
      return {
        quantity: { ...quantity, amount, pricePerUnitCents: priceCents },
        totalCents: roundCents(amount * priceCents),
      }
    case 'unknown':
      return { quantity, totalCents: priceCents }
  }
}

/** Starting values for the edit sheet's two numeric fields. */
function pricingFields(item: ReceiptItem): { amount: number; priceCents: number } {
  switch (item.quantity.kind) {
    case 'count':
      return { amount: item.quantity.count, priceCents: item.quantity.unitPriceCents }
    case 'weight':
      return { amount: item.quantity.amount, priceCents: item.quantity.pricePerUnitCents }
    case 'unknown':
      return { amount: 0, priceCents: item.totalCents }
  }
}

/**
 * Der Korrektur-Screen.
 *
 * Er hat seit Schritt 4b-1 zwei Quellen, und die Reihenfolge ist Absicht:
 *
 *   1. **Das frisch Erkannte**, das der Verarbeitungs-Screen im Speicher
 *      hinterlegt hat. In diesem Schritt wird ausdrücklich noch nichts
 *      gespeichert — es gäbe also gar nichts abzufragen.
 *   2. **Ein Bon aus der Datenbank** mit Status `extracted`. Diesen Weg gibt es
 *      noch nicht zu sehen (es schreibt ja niemand), er bleibt aber stehen: Mit
 *      4b-2 wird er der Regelfall, und der Umweg über den Speicher entfällt.
 *
 * Ohne beides steht hier eine Erklärung statt einer leeren Liste.
 */
export function ScanReview() {
  const extraction = getPendingExtraction()

  return (
    <div className={styles.screen}>
      {extraction ? <ExtractionReview result={extraction} /> : <StoredReview />}
    </div>
  )
}

/* ========================================================= frisch erkannt */

/**
 * Aus einer erkannten Position wird eine Position, wie die Anzeige sie kennt.
 *
 * Damit zeigen Positionsliste, Badges und Legende das Erkannte mit denselben
 * Bausteinen wie einen gespeicherten Bon — nichts wird für diesen Schritt
 * nachgebaut.
 */
function toReceiptItem(item: ExtractedItem): ReceiptItem {
  const suggestion = item.suggestion
  return {
    id: String(item.lineNo),
    // Der Klarname ist ein Vorschlag; ohne ihn steht da, was auf dem Bon stand.
    name: suggestion?.name ?? item.rawText,
    categoryId: categoryLabel(item),
    quantity: toQuantity(item),
    totalCents: item.totalCents,
    traitIds: suggestion?.traitKeys ?? [],
    ...(suggestion && suggestion.milkHeat !== 'unbekannt' ? { milkHeat: suggestion.milkHeat } : {}),
    ...(suggestion && suggestion.milkHomogenized !== 'unbekannt'
      ? { milkHomogenized: suggestion.milkHomogenized }
      : {}),
  }
}

/**
 * Was im Kategorie-Chip steht.
 *
 * Die Positionsliste schlägt den Schlüssel in den Stammdaten nach und zeigt
 * sonst den Schlüssel selbst. Genau das wird hier ausgenutzt: Pfand, Rabatt und
 * „noch offen" sind keine Kategorien und sollen auch nicht so aussehen, als
 * hätte das Modell sich für eine entschieden.
 */
function categoryLabel(item: ExtractedItem): CategoryId {
  if (item.kind === 'pfand') return 'Pfand' as CategoryId
  if (item.kind === 'rabatt') return 'Rabatt' as CategoryId
  return (item.suggestion?.categoryKey ?? 'Kategorie offen') as CategoryId
}

/**
 * Menge und Einzelpreis in die Anzeigeform bringen.
 *
 * Wortgleich zu `toQuantity` in `src/data/queries.ts`, und aus demselben Grund:
 * Intern ist eine Menge eine ganze Zahl in der kleinsten Einheit (Gramm,
 * Milliliter, Stück), angezeigt wird in Kilo, Liter oder Stück.
 */
function toQuantity(item: ExtractedItem): Quantity {
  if (item.quantityBase === null || item.quantityUnit === null) return { kind: 'unknown' }

  if (item.quantityUnit === 'stk') {
    const count = item.quantityBase
    const unitPriceCents =
      item.unitPriceCents ?? (count > 0 ? Math.round(item.totalCents / count) : item.totalCents)
    return { kind: 'count', count, unitPriceCents }
  }

  const perThousand = item.quantityUnit === 'kg' || item.quantityUnit === 'l'
  const unit = item.quantityUnit === 'kg' || item.quantityUnit === 'g' ? 'kg' : 'l'
  const amount = item.quantityBase / 1000
  const factor = perThousand ? 1 : 1000
  const pricePerUnitCents =
    item.unitPriceCents !== null
      ? item.unitPriceCents * factor
      : amount > 0
        ? Math.round(item.totalCents / amount)
        : item.totalCents

  return { kind: 'weight', amount, unit, pricePerUnitCents }
}

/**
 * Ab wann ein Bon-Datum einen Hinweis wert ist.
 *
 * Sechzig Tage sind bewusst großzügig: Ein Bon, der zwei Wochen im Portemonnaie
 * lag, ist völlig normal und soll nicht kommentiert werden.
 */
const UNUSUAL_AGE_DAYS = 60

/**
 * Der Hinweis zu einem ungewöhnlichen Bon-Datum — oder `null`, wenn alles
 * unauffällig ist.
 *
 * **Das ist ausdrücklich kein Fehler.** Ein alter Bon ist ein gültiger Bon; ein
 * Testscan von 2017 ist richtig gelesen und nicht falsch. Deshalb wird hier
 * nichts überschrieben, nichts blockiert und nichts rot eingefärbt — es wird
 * nur gesagt, in welchen Monat der Einkauf dann zählt. Das ist die einzige
 * Folge, die der Nutzer sonst erst in der Monatsübersicht bemerken würde.
 *
 * Gerechnet wird gegen die Uhr des Geräts und nicht gegen die des Servers: Der
 * Hinweis ist reine Anzeige, und „heute" ist hier das Heute des Nutzers.
 */
function dateNotice(iso: string, today: string): string | null {
  if (!iso) return null

  const age = daysBetween(iso, today)
  const month = formatMonth(iso)

  if (age < 0) {
    return (
      `Das Bon-Datum liegt in der Zukunft (${formatDate(iso)}). Der Einkauf würde zu ` +
      `${month} zählen. Stimmt das nicht, kannst du das Datum oben ändern.`
    )
  }

  if (age > UNUSUAL_AGE_DAYS) {
    return (
      `Dieser Bon ist vom ${formatDate(iso)} und liegt damit mehr als ${UNUSUAL_AGE_DAYS} Tage ` +
      `zurück. Das ist in Ordnung — der Einkauf zählt dann zu ${month} und nicht zum laufenden ` +
      `Monat. Stimmt das Datum nicht, kannst du es oben ändern.`
    )
  }

  return null
}

function ExtractionReview({ result }: { result: ExtractionResponse }) {
  const { extraction } = result
  const items = extraction.items.map(toReceiptItem)

  /*
   * Das Datum ist der einzige Wert, der hier schon geändert werden kann.
   * Grund: Es entscheidet, in welchen Monat der Einkauf fällt, und ein
   * vertipptes Jahr verschiebt den ganzen Einkauf — das soll man sehen und
   * richtigstellen können, bevor 4b-2 daraus einen Datensatz macht.
   */
  const [purchasedOn, setPurchasedOn] = useState(extraction.purchasedOn ?? '')
  const notice = dateNotice(purchasedOn, todayISO())

  // Der Abgleich kommt aus der Funktion; sie hat ihn beim Prüfen gerechnet.
  const printed = extraction.printedTotalCents
  const reconciles = printed !== null && extraction.discrepancyCents === 0

  /* Warnungen, die nicht schon im Summen-Banner stehen. */
  const notes = extraction.warnings.filter(
    (warning) => warning.code !== 'summe_weicht_ab' && warning.code !== 'summe_fehlt',
  )

  return (
    <>
      <div className={styles.scroll}>
        <Head />

        <div className={styles.summary}>
          <div className={styles.summaryTop}>
            <div style={{ flex: 1 }}>
              <div className={styles.merchant}>
                {extraction.merchantName ?? 'Händler nicht erkannt'}
              </div>
              <div className={styles.date}>
                {/*
                  Ein echtes Datumsfeld statt Text: Auf dem iPhone öffnet das den
                  Systemauswähler, und der Wert ist bereits das ISO-Format, mit
                  dem die App ohnehin rechnet.
                */}
                <input
                  type="date"
                  className={styles.dateInput}
                  value={purchasedOn}
                  onChange={(event) => setPurchasedOn(event.target.value)}
                  aria-label="Bon-Datum"
                />
                {extraction.purchasedAt ? ` · ${extraction.purchasedAt} Uhr` : ''} · {items.length}{' '}
                {items.length === 1 ? 'Position' : 'Positionen'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={styles.totalLabel}>Bon-Summe</div>
              <div className={styles.total}>{printed === null ? '—' : formatEuro(printed)}</div>
            </div>
          </div>

          <div className={reconciles ? `${styles.banner} ${styles['banner--ok']}` : styles.banner}>
            <div className={styles.bannerIcon} aria-hidden="true">
              {reconciles ? '✓' : '!'}
            </div>
            <div className={styles.bannerText}>
              {printed === null
                ? `Keine gedruckte Gesamtsumme gelesen – die Positionen ergeben ${formatEuro(extraction.itemsTotalCents)}.`
                : reconciles
                  ? `Positionssumme ${formatEuro(extraction.itemsTotalCents)} stimmt mit dem Bon-Total überein.`
                  : `Positionssumme ${formatEuro(extraction.itemsTotalCents)} weicht um ${formatEuro(Math.abs(extraction.discrepancyCents ?? 0))} ab – bitte prüfen.`}
            </div>
          </div>

          {/*
            Bewusst neutral gehalten und nicht im Warnton der Summen-Zeile
            darüber: Das hier ist eine Auskunft, kein Mangel.
          */}
          {notice && (
            <div className={styles.notice} role="status">
              <div className={styles.noticeIcon} aria-hidden="true">
                i
              </div>
              <div className={styles.noticeText}>{notice}</div>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState inline title="Keine Positionen erkannt">
            Die Erkennung hat auf diesem Bon keine einzelne Zeile gefunden. Scanne ihn noch einmal –
            flach, gut beleuchtet und in ganzer Länge im Rahmen.
          </EmptyState>
        ) : (
          <>
            <div className={styles.hint}>
              Korrigieren und Speichern kommen in Schritt 4b-2. Bis dahin ist das hier reine Anzeige.
            </div>
            <ReceiptItemList items={items} />
            <TraitLegend items={items} />
          </>
        )}

        {notes.length > 0 && (
          <div className={styles.notes}>
            <div className={styles.notesTitle}>Hinweise der Prüfung</div>
            <ul className={styles.notesList}>
              {notes.map((warning, index) => (
                <li key={`${warning.code}-${warning.lineNo ?? index}`}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}

        <RawAnswer result={result} />
      </div>

      <DisabledSaveBar totalCents={printed ?? extraction.itemsTotalCents} />
    </>
  )
}

/**
 * Die unverarbeitete Antwort des Modells.
 *
 * Ohne sie lässt sich der Prompt nicht nachschärfen: Erst der Rohtext zeigt, ob
 * das Modell eine Zeile übersehen, den Steuerbuchstaben als Preis gelesen oder
 * schlicht kein sauberes JSON geliefert hat. Zugeklappt, damit sie im Alltag
 * nicht stört — die Datei `supabase/functions/erkennen/prompt.ts` ist die
 * Stelle, an der die Erkenntnis dann landet.
 */
function RawAnswer({ result }: { result: ExtractionResponse }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Berechtigung bleibt der Text zum Markieren stehen.
      setCopied(false)
    }
  }

  return (
    <details className={styles.raw}>
      <summary className={styles.rawSummary}>Rohantwort des Modells</summary>
      <div className={styles.rawMeta}>
        {result.model} · {(result.durationMs / 1000).toFixed(1)} s · {result.raw.length} Zeichen
      </div>
      <button type="button" className={styles.rawCopy} onClick={copy}>
        {copied ? 'Kopiert' : 'Text kopieren'}
      </button>
      <pre className={styles.rawText}>{result.raw}</pre>
    </details>
  )
}

/**
 * Der Speichern-Knopf ist da, aber abgeschaltet.
 *
 * Absicht aus Schritt 4b-1: Der Prompt sitzt beim ersten Mal nicht, und es soll
 * sich beliebig oft testen lassen, ohne hinterher in der Datenbank aufzuräumen.
 * Der Knopf steht trotzdem hier, damit sichtbar bleibt, wo das Speichern
 * hingehört.
 */
function DisabledSaveBar({ totalCents }: { totalCents: number }) {
  return (
    <div className={styles.footer}>
      <button type="button" className={styles.save} disabled aria-disabled="true">
        Speichern · {formatEuro(totalCents)}
      </button>
      <p className={styles.saveHint}>
        Speichern kommt in Schritt 4b-2. Dieser Bon wird noch nicht in die Datenbank geschrieben.
      </p>
    </div>
  )
}

/* ==================================================== aus der Datenbank */

function Head() {
  return (
    <div className={styles.head}>
      <Link to="/scan" replace className={styles.rescan}>
        Erneut scannen
      </Link>
      <div className={styles.headTitle}>Prüfen &amp; korrigieren</div>
    </div>
  )
}

/**
 * Der Weg über die Datenbank: der zuletzt erkannte, noch nicht bestätigte Bon.
 *
 * Solange nichts geschrieben wird, führt er verlässlich in den Leerzustand.
 * Genau das ist der Fall, den ein Neuladen des Korrektur-Screens auslöst — das
 * Ergebnis im Speicher überlebt es nicht.
 */
function StoredReview() {
  const state = useQuery(getScannedReceipt, [])
  const receipt = state.data ?? null

  return (
    <>
      <div className={styles.scroll}>
        <Head />

        <Async state={state} loading={<LoadingNote />}>
          {(loaded) =>
            loaded === null ? (
              <EmptyState title="Kein Bon zum Prüfen" link={{ to: '/scan', label: 'Bon scannen' }}>
                Hier erscheint gleich nach dem Scannen, was die Erkennung gelesen hat: Händler,
                Datum und alle Positionen – jede Zeile antippbar, falls etwas nicht stimmt.
              </EmptyState>
            ) : (
              <ReviewBody receipt={loaded} />
            )
          }
        </Async>
      </div>

      {receipt && <SaveBar totalCents={receipt.printedTotalCents} />}
    </>
  )
}

function LoadingNote() {
  return (
    <p className={styles.hint} role="status">
      Erkannter Bon wird geladen…
    </p>
  )
}

function SaveBar({ totalCents }: { totalCents: number }) {
  const navigate = useNavigate()
  return (
    <div className={styles.footer}>
      {/* Das Speichern selbst kommt in Schritt 4b-2. */}
      <button type="button" className={styles.save} onClick={() => navigate('/', { replace: true })}>
        Speichern · {formatEuro(totalCents)}
      </button>
    </div>
  )
}

function ReviewBody({ receipt }: { receipt: Receipt }) {
  // Corrections live here until "Speichern"; Schritt 4b-2 posts them.
  const [items, setItems] = useState<ReceiptItem[]>(receipt.items)
  const [editing, setEditing] = useState<ReceiptItem | null>(null)

  const itemsTotalCents = receiptItemsTotal({ ...receipt, items })
  const differenceCents = receipt.printedTotalCents - itemsTotalCents
  const reconciles = differenceCents === 0

  const save = (updated: ReceiptItem) => {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    setEditing(null)
  }

  return (
    <>
      <div className={styles.summary}>
        <div className={styles.summaryTop}>
          <div style={{ flex: 1 }}>
            <div className={styles.merchant}>{getMerchantName(receipt.merchantId)}</div>
            <div className={styles.date}>
              {formatDate(receipt.date)} · {items.length}{' '}
              {items.length === 1 ? 'Position' : 'Positionen'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={styles.totalLabel}>Bon-Summe</div>
            <div className={styles.total}>{formatEuro(receipt.printedTotalCents)}</div>
          </div>
        </div>

        <div className={reconciles ? `${styles.banner} ${styles['banner--ok']}` : styles.banner}>
          <div className={styles.bannerIcon} aria-hidden="true">
            {reconciles ? '✓' : '!'}
          </div>
          <div className={styles.bannerText}>
            {reconciles
              ? `Positionssumme ${formatEuro(itemsTotalCents)} stimmt mit dem Bon-Total überein.`
              : `Positionssumme ${formatEuro(itemsTotalCents)} weicht um ${formatEuro(Math.abs(differenceCents))} ab – bitte prüfen.`}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState inline title="Keine Positionen erkannt">
          Die Erkennung hat auf diesem Bon keine einzelne Zeile gefunden. Scanne ihn noch einmal –
          flach, gut beleuchtet und in ganzer Länge im Rahmen.
        </EmptyState>
      ) : (
        <>
          <div className={styles.hint}>Zeile antippen zum Bearbeiten</div>
          <ReceiptItemList items={items} onEdit={setEditing} />
          <TraitLegend items={items} />
        </>
      )}

      {editing && <EditSheet item={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </>
  )
}

function EditSheet({
  item,
  onCancel,
  onSave,
}: {
  item: ReceiptItem
  onCancel: () => void
  onSave: (item: ReceiptItem) => void
}) {
  const initial = pricingFields(item)
  const [name, setName] = useState(item.name)
  // Fields show and accept German decimals in euros; `parseInput` takes them
  // back to numbers and `parsePrice` back to cents.
  const [amount, setAmount] = useState(String(initial.amount).replace('.', ','))
  const [price, setPrice] = useState((initial.priceCents / 100).toFixed(2).replace('.', ','))
  const [categoryId, setCategoryId] = useState<CategoryId>(item.categoryId)

  const isWeight = item.quantity.kind === 'weight'
  const hasAmount = item.quantity.kind !== 'unknown'
  const amountLabel = isWeight && item.quantity.kind === 'weight' ? `Menge (${item.quantity.unit})` : 'Menge'
  const priceLabel = hasAmount ? 'Einzelpreis' : 'Preis'

  const parseInput = (value: string) => Number(value.replace(',', '.')) || 0
  /** The field is euros, the domain is cents. */
  const parsePrice = (value: string) => roundCents(parseInput(value) * 100)

  const apply = () => {
    const { quantity, totalCents } = applyPricing(item.quantity, parseInput(amount), parsePrice(price))
    onSave({ ...item, name: name.trim() || item.name, categoryId, quantity, totalCents })
  }

  return (
    <BottomSheet title="Position bearbeiten" onClose={onCancel}>
      <div className={styles.form}>
        <div>
          <div className={styles.fieldLabel}>Name</div>
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>{amountLabel}</div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={hasAmount ? amount : ''}
              placeholder="ohne Mengenangabe"
              disabled={!hasAmount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>{priceLabel}</div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
        </div>

        <div>
          <div className={styles.fieldLabel} style={{ marginBottom: 8 }}>
            Kategorie
          </div>
          <div className={styles.categoryGrid}>
            {getCategories().map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={category.id === categoryId}
                className={
                  category.id === categoryId
                    ? `${styles.categoryOption} ${styles['categoryOption--selected']}`
                    : styles.categoryOption
                }
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button type="button" className={styles.apply} onClick={apply}>
        Übernehmen
      </button>
    </BottomSheet>
  )
}
