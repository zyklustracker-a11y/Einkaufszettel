import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList, TraitLegend } from '../components/ReceiptItemList'
import { EmptyState } from '../components/states'
import { getActiveTraits, getCategories, saveReceipt } from '../data'
import {
  DAIRY_CATEGORY,
  DERIVED_TRAIT_KEYS,
  baseAmount,
  buildSavePayload,
  differs,
  displayAmount,
  draftQuantity,
  draftsTotalCents,
  emptyDraft,
  expectedTotalCents,
  taxReconciliation,
  toDrafts,
  withoutCategory,
} from '../lib/draft'
import type { DraftItem } from '../lib/draft'
import { clearPendingCapture } from '../lib/capture'
import type { ExtractedUnit, ExtractionResponse } from '../lib/extraction'
import { daysBetween, formatDate, formatEuro, formatMonth, roundCents, todayISO } from '../lib/format'
import { clearPendingExtraction, getPendingExtraction } from '../lib/scanResult'
import type { CategoryId, MilkHeat, MilkHomogenized, ReceiptItem } from '../types'
import styles from './ScanReview.module.css'

/**
 * Der Korrektur-Screen.
 *
 * Er arbeitet auf dem, was der Verarbeitungs-Screen im Speicher hinterlegt hat
 * (`src/lib/scanResult.ts`). Einen Bon in der Datenbank gibt es an dieser Stelle
 * bewusst noch nicht: Geschrieben wird genau einmal, beim Speichern, vollständig
 * — sonst bliebe jeder abgebrochene Scan als halber Bon liegen.
 *
 * Alles, was hier bearbeitet wird, lebt bis dahin in `drafts`. Erst „Speichern"
 * macht daraus einen Datensatz, und zwar in einer einzigen Transaktion
 * (`supabase/migrations/0003_speichern.sql`).
 */
export function ScanReview() {
  const extraction = getPendingExtraction()

  return (
    <div className={styles.screen}>
      {extraction ? <ExtractionReview result={extraction} /> : <NothingToReview />}
    </div>
  )
}

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
 * Ohne Ergebnis im Speicher gibt es nichts zu prüfen. Das ist der Normalfall
 * nach einem Neuladen: Das Erkannte überlebt es absichtlich nicht.
 */
function NothingToReview() {
  return (
    <div className={styles.scroll}>
      <Head />
      <EmptyState title="Kein Bon zum Prüfen" link={{ to: '/scan', label: 'Bon scannen' }}>
        Hier erscheint gleich nach dem Scannen, was die Erkennung gelesen hat: Händler, Datum und
        alle Positionen – jede Zeile antippbar, falls etwas nicht stimmt.
      </EmptyState>
    </div>
  )
}

/**
 * Was im Kategorie-Chip steht.
 *
 * Die Positionsliste schlägt den Schlüssel in den Stammdaten nach und zeigt
 * sonst den Schlüssel selbst. Genau das wird hier ausgenutzt: Pfand, Rabatt und
 * „noch offen" sind keine Kategorien und sollen auch nicht so aussehen, als
 * hätte sich jemand für eine entschieden.
 */
function categoryLabel(draft: DraftItem): CategoryId {
  if (draft.kind === 'pfand') return 'Pfand' as CategoryId
  if (draft.kind === 'rabatt') return 'Rabatt' as CategoryId
  return (draft.categoryKey ?? 'Kategorie offen') as CategoryId
}

/** Aus einem Entwurf wird eine Position, wie die Anzeige sie kennt. */
function toReceiptItem(draft: DraftItem): ReceiptItem {
  return {
    id: draft.key,
    name: draft.name.trim() || draft.rawText.trim() || 'Ohne Namen',
    categoryId: categoryLabel(draft),
    quantity: draftQuantity(draft),
    totalCents: draft.totalCents,
    traitIds: draft.traitKeys,
    ...(draft.milkHeat !== 'unbekannt' ? { milkHeat: draft.milkHeat } : {}),
    ...(draft.milkHomogenized !== 'unbekannt' ? { milkHomogenized: draft.milkHomogenized } : {}),
  }
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
 * nur gesagt, in welchen Monat der Einkauf dann zählt.
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

/**
 * Warnungen, die inzwischen woanders stehen und deshalb nicht doppelt in der
 * Liste auftauchen: Der Summenabgleich hat sein eigenes Banner, die
 * Steuerklassen ihren eigenen Block — und beide rechnen bei jeder Änderung neu,
 * während diese Meldungen vom Zeitpunkt der Erkennung stammen.
 */
/**
 * Zähler für die Schlüssel von Hand ergänzter Zeilen. Er muss über die ganze
 * Sitzung eindeutig bleiben, auch nachdem Zeilen gelöscht wurden — die Länge der
 * Liste taugt dafür nicht.
 */
let nextKey = 1

const SUPERSEDED_WARNINGS = [
  'summe_weicht_ab',
  'summe_fehlt',
  'steuerklasse_weicht_ab',
  'steuerklasse_unbekannt',
  'steuer_kennzeichen_fehlt',
]

function ExtractionReview({ result }: { result: ExtractionResponse }) {
  const navigate = useNavigate()
  const { extraction } = result

  /*
   * Alles Bearbeitete lebt hier, bis gespeichert wird. `toDrafts` läuft nur
   * einmal — mit `useState`-Initialisierer und nicht in einem Effekt, sonst
   * würde jede Neuzeichnung die Korrekturen des Nutzers überschreiben.
   */
  const [drafts, setDrafts] = useState<DraftItem[]>(() => toDrafts(extraction))
  const [editing, setEditing] = useState<string | null>(null)
  const [purchasedOn, setPurchasedOn] = useState(extraction.purchasedOn ?? todayISO())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const notice = dateNotice(purchasedOn, todayISO())

  /* Beides rechnet aus dem aktuellen Stand, nicht aus dem der Erkennung. */
  const itemsTotalCents = draftsTotalCents(drafts)
  const printed = extraction.printedTotalCents
  const differenceCents = printed === null ? null : printed - itemsTotalCents
  const reconciles = differenceCents === 0

  const tax = useMemo(
    () => taxReconciliation(drafts, extraction.printedTaxGroups),
    [drafts, extraction.printedTaxGroups],
  )

  const openCategories = withoutCategory(drafts)
  const learned = drafts.filter((draft) => draft.known).map((draft) => draft.key)

  const notes = extraction.warnings.filter(
    (warning) => !SUPERSEDED_WARNINGS.includes(warning.code),
  )

  const items = drafts.map(toReceiptItem)
  const editingDraft = drafts.find((draft) => draft.key === editing) ?? null

  const applyEdit = (updated: DraftItem) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === updated.key
          ? { ...updated, edited: draft.edited || differs(draft, updated) }
          : draft,
      ),
    )
    setEditing(null)
  }

  const removeDraft = (key: string) => {
    setDrafts((current) => current.filter((draft) => draft.key !== key))
    setEditing(null)
  }

  const addDraft = () => {
    const key = `neu-${nextKey++}`
    setDrafts((current) => [...current, emptyDraft(key)])
    setEditing(key)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const receiptId = await saveReceipt(
        buildSavePayload({
          merchantName: extraction.merchantName,
          purchasedOn: purchasedOn || todayISO(),
          printedTotalCents: printed,
          drafts,
        }),
      )

      /*
       * Erst jetzt wird das Foto weggeworfen, zusammen mit dem Ergebnis. Es
       * wird nirgends hochgeladen (PROJEKT.md, Datenschutz) — gebraucht wird es
       * nur, solange die Erkennung wiederholt werden könnte.
       */
      clearPendingCapture()
      clearPendingExtraction()
      navigate(`/einkauf/${receiptId}`, { replace: true, state: { justSaved: true } })
    } catch (cause) {
      setSaveError(
        cause instanceof Error
          ? cause.message
          : 'Der Bon konnte nicht gespeichert werden. Bitte noch einmal versuchen.',
      )
      setSaving(false)
    }
  }

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
              {differenceCents === null
                ? `Keine gedruckte Gesamtsumme gelesen – die Positionen ergeben ${formatEuro(itemsTotalCents)}.`
                : reconciles
                  ? `Positionssumme ${formatEuro(itemsTotalCents)} stimmt mit dem Bon-Total überein.`
                  : `Positionssumme ${formatEuro(itemsTotalCents)} weicht um ${formatEuro(Math.abs(differenceCents))} ab – bitte prüfen.`}
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

        <TaxBlock tax={tax} />

        <Transcript extraction={extraction} />

        {/*
          Direkt unter der Zusammenfassung und nicht unter der Positionsliste:
          Bei einem Bon mit vierzig Zeilen stünde der Hinweis sonst außerhalb des
          Bildschirms — also genau dort, wo ihn niemand liest.
        */}
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

        {items.length === 0 ? (
          <EmptyState inline title="Keine Positionen">
            Auf diesem Bon steht keine Zeile mehr. Scanne ihn noch einmal – flach, gut beleuchtet
            und in ganzer Länge im Rahmen – oder ergänze die Positionen von Hand.
          </EmptyState>
        ) : (
          <>
            <div className={styles.hint}>
              Zeile antippen zum Bearbeiten oder Löschen.
              {learned.length > 0 &&
                ` ${learned.length} ${learned.length === 1 ? 'Zeile war' : 'Zeilen waren'} schon bekannt.`}
            </div>
            <ReceiptItemList items={items} onEdit={(item) => setEditing(item.id)} learnedIds={learned} />
            <TraitLegend items={items} />
          </>
        )}

        <button type="button" className={styles.add} onClick={addDraft}>
          + Position hinzufügen
        </button>

        <RawAnswer result={result} />
      </div>

      {editingDraft && (
        <EditSheet
          // Der Schlüssel setzt das Blatt beim Wechsel der Zeile zurück; sonst
          // stünden im Formular noch die Eingaben der vorigen Position.
          key={editingDraft.key}
          draft={editingDraft}
          taxCodes={extraction.printedTaxGroups.map((group) => group.code)}
          onCancel={() => setEditing(null)}
          onSave={applyEdit}
          onDelete={() => removeDraft(editingDraft.key)}
        />
      )}

      <div className={styles.footer}>
        {saveError && (
          <p className={styles.saveError} role="alert">
            {saveError}
          </p>
        )}
        {openCategories > 0 && (
          <p className={styles.saveHint}>
            {openCategories === 1
              ? 'Eine Position hat noch keine Kategorie und wird ohne Produkt gespeichert – dann lernt die App für diese Zeile nichts.'
              : `${openCategories} Positionen haben noch keine Kategorie und werden ohne Produkt gespeichert – dann lernt die App für diese Zeilen nichts.`}
          </p>
        )}
        <button
          type="button"
          className={styles.save}
          disabled={saving || drafts.length === 0}
          onClick={save}
        >
          {saving ? 'Wird gespeichert…' : `Speichern · ${formatEuro(printed ?? itemsTotalCents)}`}
        </button>
      </div>
    </>
  )
}

/**
 * Der Abgleich je Steuerklasse — die schärfere Probe.
 *
 * Der Gesamtabgleich sagt nur, *dass* etwas fehlt; dieser sagt *wo*. Er rechnet
 * bei jeder Änderung neu, damit sich beim Korrigieren zusehen lässt, wie die
 * Lücke zugeht.
 */
function TaxBlock({ tax }: { tax: ReturnType<typeof taxReconciliation> }) {
  if (tax.groups.length === 0 && tax.missingCodes === 0 && tax.unknownCodes.length === 0) {
    return null
  }

  return (
    <div className={styles.tax}>
      <div className={styles.notesTitle}>Abgleich je Steuerklasse</div>

      {tax.groups.map((group) => (
        <div key={group.code} className={styles.taxRow}>
          <span className={styles.taxCode}>{group.code}</span>
          <span className={styles.taxNumbers}>
            {formatEuro(group.itemsTotalCents)} von {formatEuro(group.grossCents)}
          </span>
          <span
            className={
              group.differenceCents === 0
                ? `${styles.taxState} ${styles['taxState--ok']}`
                : styles.taxState
            }
          >
            {group.differenceCents === 0
              ? 'stimmt'
              : `${formatEuro(Math.abs(group.differenceCents))} ${group.differenceCents > 0 ? 'fehlen' : 'zu viel'}`}
          </span>
        </div>
      ))}

      {tax.missingCodes > 0 && (
        <p className={styles.taxNote}>
          {tax.missingCodes === 1
            ? 'Einer Position fehlt das Steuerkennzeichen'
            : `${tax.missingCodes} Positionen fehlt das Steuerkennzeichen`}{' '}
          – solange wäre jede Klasse zu niedrig, deshalb wird nicht verglichen. Trag es beim
          Bearbeiten der Zeile nach, dann rechnet der Abgleich mit.
        </p>
      )}

      {tax.unknownCodes.length > 0 && (
        <p className={styles.taxNote}>
          Das Kennzeichen „{tax.unknownCodes.join('“, „')}“ steht an einer Position, aber nicht im
          gedruckten Steuerblock.
        </p>
      )}
    </div>
  )
}

/**
 * Was das Modell abgetippt hat, Zeile für Zeile — und was daraus wurde.
 *
 * Seit Schritt 4d entscheidet das Modell nicht mehr, was eine Position ist: Es
 * tippt nur ab, aufgeteilt wird im Code. Damit ist diese Liste die beste
 * Fehlermeldung, die sich bauen lässt. Geht eine Summe nicht auf, steht die
 * Antwort hier — entweder ist eine gedruckte Zeile gar nicht erst abgetippt
 * worden (dann fehlt sie in der Liste), oder sie trug keinen Betrag (dann steht
 * „—" davor).
 *
 * Zugeklappt, solange alles stimmt; aufgeklappt, sobald es etwas zu sehen gibt.
 */
function Transcript({ extraction }: { extraction: ExtractionResponse['extraction'] }) {
  if (extraction.lines.length === 0) return null

  /* Zeile → Positionsnummer. Die Position kennt ihre Quellzeilen selbst. */
  const positionByLine = new Map<string, number>()
  extraction.items.forEach((item, index) => {
    for (const line of item.sourceLines) positionByLine.set(line, index + 1)
  })

  const unassigned = new Set(extraction.unassignedLines)
  const somethingOff =
    extraction.unassignedLines.length > 0 ||
    (extraction.discrepancyCents !== null && extraction.discrepancyCents !== 0)

  return (
    <details className={styles.transcript} open={somethingOff}>
      <summary className={styles.rawSummary}>
        Abgetippte Zeilen ({extraction.lines.length}) → {extraction.items.length}{' '}
        {extraction.items.length === 1 ? 'Position' : 'Positionen'}
      </summary>
      <p className={styles.taxNote}>
        Aufgeteilt wird im Code, nicht vom Modell – dabei geht kein Betrag verloren. Fehlt hier
        eine gedruckte Zeile, hat das Modell sie beim Abtippen übersehen.
      </p>
      <ol className={styles.transcriptList}>
        {extraction.lines.map((line, index) => {
          /*
           * Der Parser zieht mehrfache Leerzeichen zusammen; die Rohzeile hier
           * hat sie noch. Verglichen wird deshalb in derselben Form, sonst
           * fände keine Zeile ihre Position.
           */
          const tidy = line.replace(/\s+/g, ' ').trim()
          const position = positionByLine.get(tidy)
          return (
            <li
              key={`${index}-${line}`}
              className={
                unassigned.has(tidy)
                  ? `${styles.transcriptLine} ${styles['transcriptLine--open']}`
                  : styles.transcriptLine
              }
            >
              <span className={styles.transcriptMark}>{position ? position : '—'}</span>
              <code>{line}</code>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

/**
 * Die unverarbeiteten Antworten des Modells — eine je Durchgang.
 *
 * Ohne sie lässt sich der Prompt nicht nachschärfen: Erst der Rohtext zeigt, ob
 * das Modell eine Zeile übersehen, den Steuerbuchstaben als Preis gelesen oder
 * schlicht kein sauberes JSON geliefert hat. Und seit Schritt 4c zeigt er
 * zusätzlich, *welcher* der beiden Durchgänge danebenlag — sie werden getrennt
 * nachgeschärft, in `supabase/functions/erkennen/prompt.ts`.
 *
 * Zugeklappt, damit sie im Alltag nicht stören.
 */
function RawAnswer({ result }: { result: ExtractionResponse }) {
  return (
    <details className={styles.raw}>
      <summary className={styles.rawSummary}>Rohantworten des Modells</summary>

      <RawBlock
        title="1 · Struktur"
        model={result.model}
        durationMs={result.durationMs}
        raw={result.raw}
      />

      {result.assignment ? (
        <RawBlock
          title="2 · Zuordnung"
          model={result.assignment.model}
          durationMs={result.assignment.durationMs}
          raw={result.assignment.raw}
        />
      ) : (
        <div className={styles.rawMeta}>
          2 · Zuordnung: entfallen – entweder war jeder Artikel schon bekannt, oder der Durchgang
          ist ausgefallen (dann steht es oben in den Hinweisen).
        </div>
      )}
    </details>
  )
}

function RawBlock({
  title,
  model,
  durationMs,
  raw,
}: {
  title: string
  model: string
  durationMs: number
  raw: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Berechtigung bleibt der Text zum Markieren stehen.
      setCopied(false)
    }
  }

  return (
    <div className={styles.rawBlock}>
      <div className={styles.rawMeta}>
        {title} · {model} · {(durationMs / 1000).toFixed(1)} s · {raw.length} Zeichen
      </div>
      <button type="button" className={styles.rawCopy} onClick={copy}>
        {copied ? 'Kopiert' : 'Text kopieren'}
      </button>
      <pre className={styles.rawText}>{raw}</pre>
    </div>
  )
}

/* ========================================================= Bearbeiten */

/** Die Mengen-Einheiten zur Auswahl, plus „ohne Mengenangabe". */
const UNITS: Array<{ value: ExtractedUnit | ''; label: string }> = [
  { value: '', label: 'ohne' },
  { value: 'stk', label: 'Stück' },
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'l' },
  { value: 'ml', label: 'ml' },
]

const MILK_HEATS: Array<{ value: MilkHeat; label: string }> = [
  { value: 'unbekannt', label: 'unbekannt' },
  { value: 'roh', label: 'Rohmilch' },
  { value: 'pasteurisiert', label: 'pasteurisiert' },
  { value: 'esl', label: 'ESL' },
  { value: 'uht', label: 'H-Milch' },
]

const MILK_HOMOGENIZED: Array<{ value: MilkHomogenized; label: string }> = [
  { value: 'unbekannt', label: 'unbekannt' },
  { value: 'ja', label: 'homogenisiert' },
  { value: 'nein', label: 'nicht homogenisiert' },
]

/** Ein Feld, in das eine deutsche Kommazahl getippt wird. */
function parseInput(value: string): number {
  return Number(value.replace(',', '.')) || 0
}

/** Das Feld ist in Euro, gerechnet wird in Cent. */
function parsePrice(value: string): number {
  return roundCents(parseInput(value) * 100)
}

function toField(value: number): string {
  return String(value).replace('.', ',')
}

function toPriceField(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

function EditSheet({
  draft,
  taxCodes,
  onCancel,
  onSave,
  onDelete,
}: {
  draft: DraftItem
  /** Die Kennzeichen aus dem gedruckten Steuerblock. Leer: kein Block gelesen. */
  taxCodes: string[]
  onCancel: () => void
  onSave: (draft: DraftItem) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(draft.name)
  const [unit, setUnit] = useState<ExtractedUnit | ''>(draft.quantityUnit ?? '')
  const [amount, setAmount] = useState(
    draft.quantityBase === null || draft.quantityUnit === null
      ? ''
      : toField(displayAmount(draft.quantityBase, draft.quantityUnit)),
  )
  const [unitPrice, setUnitPrice] = useState(toPriceField(draft.unitPriceCents))
  const [total, setTotal] = useState(toPriceField(draft.totalCents))
  const [categoryKey, setCategoryKey] = useState<CategoryId | null>(draft.categoryKey)
  const [traitKeys, setTraitKeys] = useState<string[]>(draft.traitKeys)
  const [milkHeat, setMilkHeat] = useState<MilkHeat>(draft.milkHeat)
  const [milkHomogenized, setMilkHomogenized] = useState<MilkHomogenized>(draft.milkHomogenized)
  const [taxCode, setTaxCode] = useState<string | null>(draft.taxCode)

  const isArticle = draft.kind === 'artikel'
  const isDairy = categoryKey === DAIRY_CATEGORY

  /*
   * Die abgeleiteten Merkmale (roh, pasteurisiert, esl, uht, homogenisiert)
   * stehen bewusst nicht zum Anhaken: Sie entstehen aus den beiden Milch-Feldern
   * darunter. Zwei Wege zur selben Aussage wären zwei Wahrheiten.
   */
  const traits = getActiveTraits().filter((trait) => !DERIVED_TRAIT_KEYS.includes(trait.id))

  const collect = (): DraftItem => {
    const quantityUnit = unit === '' ? null : unit
    const quantityBase =
      quantityUnit === null || amount.trim() === '' ? null : baseAmount(parseInput(amount), quantityUnit)

    return {
      ...draft,
      name: name.trim() || draft.name,
      quantityBase: quantityBase !== null && quantityBase > 0 ? quantityBase : null,
      quantityUnit: quantityBase !== null && quantityBase > 0 ? quantityUnit : null,
      unitPriceCents: unitPrice.trim() === '' ? null : parsePrice(unitPrice),
      totalCents: parsePrice(total),
      categoryKey: isArticle ? categoryKey : null,
      traitKeys: isArticle ? traitKeys : [],
      milkHeat: isArticle && isDairy ? milkHeat : 'unbekannt',
      milkHomogenized: isArticle && isDairy ? milkHomogenized : 'unbekannt',
      taxCode,
    }
  }

  const expected = expectedTotalCents(collect())
  const current = parsePrice(total)
  const mismatch = expected !== null && Math.abs(expected - current) > 2

  const toggleTrait = (key: string) => {
    setTraitKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

  return (
    <BottomSheet title={draft.added ? 'Position hinzufügen' : 'Position bearbeiten'} onClose={onCancel}>
      <div className={styles.form}>
        {draft.rawText && <div className={styles.rawLine}>Auf dem Bon: {draft.rawText}</div>}

        <div>
          <div className={styles.fieldLabel}>Name</div>
          <input
            className={styles.input}
            value={name}
            placeholder="Klarname"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div>
          <div className={styles.fieldLabel}>Menge</div>
          <div className={styles.chips}>
            {UNITS.map((option) => (
              <Chip
                key={option.value || 'ohne'}
                selected={unit === option.value}
                onClick={() => setUnit(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
          {unit !== '' && (
            <input
              className={`${styles.input} ${styles['input--number']}`}
              style={{ marginTop: 8 }}
              type="text"
              inputMode="decimal"
              value={amount}
              placeholder={unit === 'kg' || unit === 'l' ? 'z. B. 1,12' : 'z. B. 2'}
              aria-label={`Menge in ${unit}`}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </div>

        <div className={styles.fieldRow}>
          <div>
            <div className={styles.fieldLabel}>
              Einzelpreis {unit === '' ? '' : `je ${unit === 'stk' ? 'Stück' : unit}`}
            </div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={unitPrice}
              placeholder="leer lassen"
              onChange={(event) => setUnitPrice(event.target.value)}
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>Zeilensumme</div>
            <input
              className={`${styles.input} ${styles['input--number']}`}
              type="text"
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
            />
          </div>
        </div>

        {/*
          Nur ein Hinweis, keine Korrektur: Welcher der drei Werte falsch ist,
          weiß hier niemand — und geraten wird nicht (PROJEKT.md).
        */}
        {mismatch && expected !== null && (
          <div className={styles.mismatch}>
            Menge × Einzelpreis ergibt {formatEuro(expected)}, in der Zeilensumme stehen{' '}
            {formatEuro(current)}.
          </div>
        )}

        {taxCodes.length > 0 && (
          <div>
            <div className={styles.fieldLabel}>Steuerkennzeichen</div>
            <div className={styles.chips}>
              <Chip selected={taxCode === null} onClick={() => setTaxCode(null)}>
                keins
              </Chip>
              {taxCodes.map((code) => (
                <Chip key={code} selected={taxCode === code} onClick={() => setTaxCode(code)}>
                  {code}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {isArticle && (
          <>
            <div>
              <div className={styles.fieldLabel}>Kategorie</div>
              <div className={styles.chips}>
                {getCategories().map((category) => (
                  <Chip
                    key={category.id}
                    selected={category.id === categoryKey}
                    onClick={() => setCategoryKey(category.id === categoryKey ? null : category.id)}
                  >
                    {category.name}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div className={styles.fieldLabel}>Merkmale</div>
              <div className={styles.chips}>
                {traits.map((trait) => (
                  <Chip
                    key={trait.id}
                    selected={traitKeys.includes(trait.id)}
                    onClick={() => toggleTrait(trait.id)}
                  >
                    {trait.label}
                  </Chip>
                ))}
              </div>
            </div>

            {isDairy && (
              <>
                <div>
                  <div className={styles.fieldLabel}>Erhitzung</div>
                  <div className={styles.chips}>
                    {MILK_HEATS.map((option) => (
                      <Chip
                        key={option.value}
                        selected={milkHeat === option.value}
                        onClick={() => setMilkHeat(option.value)}
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <div className={styles.fieldLabel}>Homogenisierung</div>
                  <div className={styles.chips}>
                    {MILK_HOMOGENIZED.map((option) => (
                      <Chip
                        key={option.value}
                        selected={milkHomogenized === option.value}
                        onClick={() => setMilkHomogenized(option.value)}
                      >
                        {option.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <button type="button" className={styles.apply} onClick={() => onSave(collect())}>
        Übernehmen
      </button>
      <button type="button" className={styles.remove} onClick={onDelete}>
        Position löschen
      </button>
    </BottomSheet>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={selected ? `${styles.chip} ${styles['chip--selected']}` : styles.chip}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
