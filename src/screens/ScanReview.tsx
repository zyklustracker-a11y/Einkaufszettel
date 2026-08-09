import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ReceiptItemList, TraitLegend } from '../components/ReceiptItemList'
import { Async, EmptyState } from '../components/states'
import {
  fetchExchangeRate,
  getActiveCategories,
  getActiveTraits,
  getReceiptDraft,
  saveReceipt,
  useQuery,
} from '../data'
import type { ReceiptDraftData } from '../data'
import {
  DAIRY_CATEGORY,
  DERIVED_TRAIT_KEYS,
  TIP_PERCENTS,
  baseAmount,
  buildSavePayload,
  differs,
  displayAmount,
  draftQuantity,
  draftsTotalCents,
  emptyDraft,
  expectedTotalCents,
  taxReconciliation,
  tipFromPercent,
  toDrafts,
  toDraftsFromSaved,
  withoutCategory,
} from '../lib/draft'
import type { Conversion, DraftItem } from '../lib/draft'
import { clearPendingCapture } from '../lib/capture'
import type { ExtractedUnit, ExtractionResponse, PrintedTaxGroup } from '../lib/extraction'
import {
  daysBetween,
  formatDate,
  formatEuro,
  formatMonth,
  formatMoney,
  roundCents,
  todayISO,
} from '../lib/format'
import { clearPendingExtraction, getPendingExtraction } from '../lib/scanResult'
import type {
  CategoryId,
  MerchantKind,
  MilkHeat,
  MilkHomogenized,
  ReceiptItem,
} from '../types'
import styles from './ScanReview.module.css'

/**
 * Der Korrektur-Screen — für einen frisch erkannten **und** für einen
 * gespeicherten Bon.
 *
 * Nach dem Scan arbeitet er auf dem, was der Verarbeitungs-Screen im Speicher
 * hinterlegt hat (`src/lib/scanResult.ts`). Einen Bon in der Datenbank gibt es
 * an dieser Stelle bewusst noch nicht: Geschrieben wird genau einmal, beim
 * Speichern, vollständig — sonst bliebe jeder abgebrochene Scan als halber Bon
 * liegen.
 *
 * Seit Schritt 5b führt auch „Bearbeiten" im Einkaufs-Detail hierher. Das war
 * überraschend wenig Arbeit, weil die ganze Bearbeitungslogik längst in
 * `src/lib/draft.ts` steckt: Es fehlte das Laden eines gespeicherten Bons in
 * diese Form und ein Speichern, das aktualisiert statt anlegt. Beides ist eine
 * andere **Vorlage**, kein anderer Screen — und ein zweiter Screen mit
 * denselben vierzig Feldern wäre die Sorte Verdopplung, die irgendwann
 * auseinanderläuft.
 *
 * Alles, was hier bearbeitet wird, lebt bis zum Speichern in `drafts`.
 */
export function ScanReview() {
  const { receiptId } = useParams()

  return (
    <div className={styles.screen}>
      {receiptId ? <EditSavedReceipt receiptId={receiptId} /> : <ReviewScan />}
    </div>
  )
}

/* ------------------------------------------------- Vorlage: frischer Scan */

function ReviewScan() {
  const result = getPendingExtraction()
  if (!result) return <NothingToReview />

  return <ReviewBody source={fromScan(result)} />
}

/* --------------------------------------------- Vorlage: gespeicherter Bon */

function EditSavedReceipt({ receiptId }: { receiptId: string }) {
  const state = useQuery(() => getReceiptDraft(receiptId), [receiptId])

  return (
    <Async state={state}>
      {(data) =>
        data === null ? (
          <div className={styles.scroll}>
            <Head backTo="/" backLabel="Zur Übersicht" title="Einkauf nicht gefunden" />
            <EmptyState title="Einkauf nicht gefunden" link={{ to: '/', label: 'Zur Übersicht' }}>
              Diesen Einkauf gibt es nicht mehr. Möglicherweise wurde er auf einem anderen Gerät
              gelöscht.
            </EmptyState>
          </div>
        ) : (
          <ReviewBody source={fromSaved(data)} />
        )
      }
    </Async>
  )
}

/* ================================================================ Vorlage */

/**
 * Woran der Screen arbeitet — dieselbe Form, egal woher der Bon kommt.
 *
 * Alles, was **nur** ein frischer Scan mitbringt (abgetippte Zeilen,
 * Steuerblock, Warnungen der Prüfung, Rohantworten des Modells), hängt an
 * `scan`. Ist das null, wird ein gespeicherter Bon bearbeitet, und die
 * betreffenden Blöcke erscheinen gar nicht erst — sie beschreiben einen
 * Zeitpunkt der Erkennung und nicht den Bon.
 */
interface ReviewSource {
  /** Gesetzt: bestehenden Bon aktualisieren statt einen zweiten anzulegen. */
  receiptId: string | null
  merchantName: string | null
  merchantKind: MerchantKind
  purchasedOn: string
  purchasedAt: string | null
  /** In der Währung, in der die Entwürfe stehen. */
  printedTotalCents: number | null
  tipCents: number
  drafts: DraftItem[]
  printedTaxGroups: PrintedTaxGroup[]
  /** Die Kennzeichen zur Auswahl im Bearbeiten-Blatt. */
  taxCodes: string[]
  currency: string
  /** Stehen die Beträge in der Bonwährung oder schon in Euro? */
  amountsIn: 'bon' | 'euro'
  exchangeRate: number | null
  rateDate: string | null
  rateError: string | null
  scan: ExtractionResponse | null
}

function fromScan(result: ExtractionResponse): ReviewSource {
  const { extraction } = result
  return {
    receiptId: null,
    merchantName: extraction.merchantName,
    merchantKind: result.merchantKind,
    purchasedOn: extraction.purchasedOn ?? todayISO(),
    purchasedAt: extraction.purchasedAt,
    printedTotalCents: extraction.printedTotalCents,
    // Vorbelegung immer „Nein" — auch bei einem bekannten Gastro-Händler.
    tipCents: 0,
    drafts: toDrafts(extraction),
    printedTaxGroups: extraction.printedTaxGroups,
    taxCodes: extraction.printedTaxGroups.map((group) => group.code),
    // Ohne gelesenes Währungszeichen gilt Euro. Das ist der Normalfall und
    // ausdrücklich keine Vermutung: Auf einem deutschen Bon steht keines.
    currency: extraction.currency ?? 'EUR',
    amountsIn: 'bon',
    exchangeRate: result.exchangeRate?.rate ?? null,
    rateDate: result.exchangeRate?.rateDate ?? null,
    rateError: result.rateError,
    scan: result,
  }
}

function fromSaved(data: ReceiptDraftData): ReviewSource {
  return {
    receiptId: data.receiptId,
    merchantName: data.merchantName,
    merchantKind: data.merchantKind,
    purchasedOn: data.purchasedOn,
    purchasedAt: null,
    printedTotalCents: data.printedTotalCents,
    tipCents: data.tipCents,
    drafts: toDraftsFromSaved(data.items),
    // Der gedruckte Steuerblock wird nicht gespeichert — er beschreibt einen
    // Zeitpunkt der Erkennung. Der Klassenabgleich entfällt damit; umhängen
    // lässt sich eine Zeile trotzdem.
    printedTaxGroups: [],
    taxCodes: data.taxCodes,
    currency: data.currency,
    // In der Datenbank stehen bereits Euro, und zurückgerechnet wird nicht.
    amountsIn: 'euro',
    exchangeRate: data.exchangeRate,
    rateDate: data.rateDate,
    rateError: null,
    scan: null,
  }
}

function Head({
  backTo,
  backLabel,
  title,
}: {
  backTo: string
  backLabel: string
  title: string
}) {
  return (
    <div className={styles.head}>
      <Link to={backTo} replace className={styles.rescan}>
        {backLabel}
      </Link>
      <div className={styles.headTitle}>{title}</div>
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
      <Head backTo="/scan" backLabel="Erneut scannen" title="Prüfen & korrigieren" />
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

/* ============================================================ Fremdwährung */

/**
 * Die Währungen zur Auswahl.
 *
 * Der Mechanismus ist auf keine Währung festgelegt — jede, für die die EZB
 * einen Kurs veröffentlicht, funktioniert. Die **Auswahl** ist es schon: Der
 * Nutzer wohnt an der deutsch-schweizerischen Grenze. Erkennt das Modell etwas
 * anderes, kommt es als dritter Knopf dazu.
 */
const CURRENCIES = ['EUR', 'CHF']

interface CurrencyState {
  currency: string
  /** Euro je eine Einheit. Null: noch keiner da. */
  rate: number | null
  rateDate: string | null
  /** Warum keiner da ist, als fertiger deutscher Satz. */
  error: string | null
  /** Läuft gerade ein Abruf? */
  loading: boolean
  setCurrency: (currency: string) => void
  setRate: (rate: number | null) => void
  /** Was an `buildSavePayload` geht. Null bei einem Euro-Bon. */
  conversion: Conversion | null
  /** Fehlt noch etwas, ohne das nicht gespeichert werden darf? */
  blocked: boolean
}

/**
 * Währung und Kurs im Korrektur-Screen.
 *
 * Zwei Dinge lösen einen neuen Abruf aus: eine andere Währung und **ein anderes
 * Bon-Datum**. Das zweite ist der Grund, warum das hier ein Haken ist und keine
 * einfache Zustandsvariable: Der Kurs richtet sich nach dem Bon-Datum
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 5), und ein vertipptes Jahr, das der
 * Nutzer oben korrigiert, muss den Kurs mitziehen.
 *
 * Ein Kurs, den der Nutzer von Hand eingetragen hat, wird dabei **nicht**
 * überschrieben — sonst wäre die Handeingabe beim nächsten Tastendruck im
 * Datumsfeld wieder weg.
 *
 * Beim Bearbeiten eines gespeicherten Bons wird gar nichts abgerufen: Der Kurs
 * ist eingefroren, und ihn nachzuführen würde eine Monatssumme der
 * Vergangenheit rückwirkend ändern.
 */
function useCurrency(source: ReviewSource, purchasedOn: string): CurrencyState {
  const frozen = source.receiptId !== null

  const [currency, setCurrencyRaw] = useState(source.currency)
  const [rate, setRateRaw] = useState<number | null>(source.exchangeRate)
  const [rateDate, setRateDate] = useState<string | null>(source.rateDate)
  const [error, setError] = useState<string | null>(source.rateError)
  const [manual, setManual] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (frozen || currency === 'EUR' || manual) return

    // Für das Datum, das schon beim Öffnen einen Kurs geliefert hat, wurde
    // bereits gefragt — der Abruf in der Edge Function lief mit demselben Wert.
    if (rate !== null && rateDate !== null && purchasedOn === source.purchasedOn) return

    let cancelled = false
    setLoading(true)
    void fetchExchangeRate(currency, purchasedOn).then((result) => {
      if (cancelled) return
      setRateRaw(result.exchangeRate?.rate ?? null)
      setRateDate(result.exchangeRate?.rateDate ?? null)
      setError(result.rateError)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, purchasedOn, frozen, manual])

  const setCurrency = (next: string) => {
    setCurrencyRaw(next)
    // Ein Kurs gehört zu genau einer Währung. Beim Wechsel ist der alte falsch,
    // und ihn stehen zu lassen wäre schlimmer als ein leeres Feld.
    setManual(false)
    setRateRaw(null)
    setRateDate(null)
    setError(null)
  }

  const setRate = (next: number | null) => {
    setManual(true)
    setRateRaw(next)
    // Von Hand eingetragen heißt: kein Stichtag. Einen zu erfinden wäre eine
    // Behauptung über eine Veröffentlichung, die es nicht gab.
    setRateDate(null)
    setError(null)
  }

  const usable = currency !== 'EUR' && rate !== null && rate > 0

  return {
    currency,
    rate,
    rateDate,
    error,
    loading,
    setCurrency,
    setRate,
    conversion: usable
      ? { currency, rate: rate as number, rateDate, amountsIn: source.amountsIn }
      : null,
    // Ohne Kurs dürfen Franken-Beträge nicht als Euro in der Datenbank landen —
    // das verschöbe jede Monatssumme, ohne dass es jemandem auffiele.
    blocked: currency !== 'EUR' && !usable,
  }
}

function ReviewBody({ source }: { source: ReviewSource }) {
  const navigate = useNavigate()
  const editingSaved = source.receiptId !== null

  /*
   * Alles Bearbeitete lebt hier, bis gespeichert wird. Die Vorlage wird nur
   * einmal gelesen — mit `useState`-Initialisierer und nicht in einem Effekt,
   * sonst würde jede Neuzeichnung die Korrekturen des Nutzers überschreiben.
   */
  const [drafts, setDrafts] = useState<DraftItem[]>(() => source.drafts)
  const [editing, setEditing] = useState<string | null>(null)
  const [purchasedOn, setPurchasedOn] = useState(source.purchasedOn)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /*
   * Die Händlerart. Vorbelegt mit dem, was die Datenbank über diesen Laden
   * weiß; ein unbekannter Laden ist ein Laden. `kindEdited` merkt sich, ob der
   * Nutzer sie angefasst hat — nur dann stellt das Speichern einen bekannten
   * Händler um (siehe `buildSavePayload`).
   */
  const [merchantKind, setMerchantKind] = useState<MerchantKind>(source.merchantKind)
  const [kindEdited, setKindEdited] = useState(false)

  /*
   * Trinkgeld, in Cent. Beim frischen Scan ist die **Vorbelegung immer „Nein"**,
   * auch bei einem bekannten Gastro-Händler: Niemand soll versehentlich
   * Trinkgeld erfassen, das er nicht gegeben hat (KONZEPT-ERWEITERUNGEN.md,
   * Abschnitt 1). Beim Bearbeiten steht da, was gespeichert ist.
   */
  const [tipCents, setTipCents] = useState(source.tipCents)

  const currencyState = useCurrency(source, purchasedOn)

  const notice = dateNotice(purchasedOn, todayISO())

  /* Beides rechnet aus dem aktuellen Stand, nicht aus dem der Erkennung. */
  const itemsTotalCents = draftsTotalCents(drafts)
  const printed = source.printedTotalCents
  const differenceCents = printed === null ? null : printed - itemsTotalCents
  const reconciles = differenceCents === 0

  const tax = useMemo(
    () => taxReconciliation(drafts, source.printedTaxGroups),
    [drafts, source.printedTaxGroups],
  )

  const openCategories = withoutCategory(drafts)
  const learned = drafts.filter((draft) => draft.known).map((draft) => draft.key)

  const notes = (source.scan?.extraction.warnings ?? []).filter(
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

  /** Die Währung, in der die Beträge auf diesem Screen stehen. */
  const shownIn = source.amountsIn === 'euro' ? 'EUR' : currencyState.currency
  const money = (cents: number): string => formatMoney(cents, shownIn)

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const savedId = await saveReceipt(
        buildSavePayload({
          receiptId: source.receiptId,
          merchantName: source.merchantName,
          merchantKind,
          merchantKindEdited: kindEdited,
          purchasedOn: purchasedOn || todayISO(),
          printedTotalCents: printed,
          // Trinkgeld gibt es nur bei Gastronomie. Wer eine Zeile eingetippt und
          // danach auf „Laden" zurückgestellt hat, soll sie nicht mitspeichern.
          tipCents: merchantKind === 'gastro' ? tipCents : 0,
          drafts,
          conversion: currencyState.conversion,
        }),
      )

      /*
       * Erst jetzt wird das Foto weggeworfen, zusammen mit dem Ergebnis. Es
       * wird nirgends hochgeladen (PROJEKT.md, Datenschutz) — gebraucht wird es
       * nur, solange die Erkennung wiederholt werden könnte.
       */
      clearPendingCapture()
      clearPendingExtraction()
      navigate(`/einkauf/${savedId}`, {
        replace: true,
        state: { justSaved: true, updated: editingSaved },
      })
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
        {editingSaved ? (
          <Head
            backTo={`/einkauf/${source.receiptId}`}
            backLabel="Abbrechen"
            title="Einkauf bearbeiten"
          />
        ) : (
          <Head backTo="/scan" backLabel="Erneut scannen" title="Prüfen & korrigieren" />
        )}

        <div className={styles.summary}>
          <div className={styles.summaryTop}>
            <div style={{ flex: 1 }}>
              <div className={styles.merchant}>
                {source.merchantName ?? 'Händler nicht erkannt'}
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
                {source.purchasedAt ? ` · ${source.purchasedAt} Uhr` : ''} · {items.length}{' '}
                {items.length === 1 ? 'Position' : 'Positionen'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={styles.totalLabel}>Bon-Summe</div>
              <div className={styles.total}>{printed === null ? '—' : money(printed)}</div>
            </div>
          </div>

          <div className={reconciles ? `${styles.banner} ${styles['banner--ok']}` : styles.banner}>
            <div className={styles.bannerIcon} aria-hidden="true">
              {reconciles ? '✓' : '!'}
            </div>
            <div className={styles.bannerText}>
              {differenceCents === null
                ? `Keine gedruckte Gesamtsumme gelesen – die Positionen ergeben ${money(itemsTotalCents)}.`
                : reconciles
                  ? `Positionssumme ${money(itemsTotalCents)} stimmt mit dem Bon-Total überein.`
                  : `Positionssumme ${money(itemsTotalCents)} weicht um ${money(Math.abs(differenceCents))} ab – bitte prüfen.`}
            </div>
          </div>

          {/*
            Die Händlerart. Sie steht hier oben beim Händler, weil sie zu ihm
            gehört und nicht zu diesem einen Beleg: Einmal gesetzt, gilt sie für
            alle künftigen Bons desselben Ladens.
          */}
          <div className={styles.kindRow}>
            <div className={styles.kindChips}>
              <Chip
                selected={merchantKind === 'retail'}
                onClick={() => {
                  setMerchantKind('retail')
                  setKindEdited(true)
                }}
              >
                Laden
              </Chip>
              <Chip
                selected={merchantKind === 'gastro'}
                onClick={() => {
                  setMerchantKind('gastro')
                  setKindEdited(true)
                }}
              >
                Gastro
              </Chip>
            </div>
            <div className={styles.kindHint}>
              {merchantKind === 'gastro'
                ? 'Zählt als „Auswärts" und nicht in die Bestpreise – Portionen sind nicht vergleichbar.'
                : 'Supermarkt, Bäckerei, Tankstelle, Drogerie.'}
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

        <CurrencyBlock
          state={currencyState}
          detected={source.currency}
          frozen={editingSaved}
          totalCents={printed ?? itemsTotalCents}
        />

        <TaxBlock tax={tax} />

        {source.scan && <Transcript extraction={source.scan.extraction} />}

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
            {editingSaved
              ? 'Zu diesem Einkauf steht keine Zeile mehr. Ergänze die Positionen von Hand oder brich ab.'
              : 'Auf diesem Bon steht keine Zeile mehr. Scanne ihn noch einmal – flach, gut beleuchtet und in ganzer Länge im Rahmen – oder ergänze die Positionen von Hand.'}
          </EmptyState>
        ) : (
          <>
            <div className={styles.hint}>
              Zeile antippen zum Bearbeiten oder Löschen.
              {learned.length > 0 &&
                (editingSaved
                  ? ` ${learned.length} ${learned.length === 1 ? 'Zeile ist' : 'Zeilen sind'} einem Produkt zugeordnet – eine Korrektur hier gilt rückwirkend für alle Käufe.`
                  : ` ${learned.length} ${learned.length === 1 ? 'Zeile war' : 'Zeilen waren'} schon bekannt.`)}
            </div>
            <ReceiptItemList items={items} onEdit={(item) => setEditing(item.id)} learnedIds={learned} />
            <TraitLegend items={items} />
          </>
        )}

        <button type="button" className={styles.add} onClick={addDraft}>
          + Position hinzufügen
        </button>

        {/*
          Nur bei Gastronomie, und dort direkt vor dem Speichern-Knopf: Es ist
          das Letzte, was noch fehlt, und das Einzige auf diesem Screen, das
          nicht vom Bon abgelesen werden konnte.
        */}
        {merchantKind === 'gastro' && (
          <TipBlock
            tipCents={tipCents}
            baseCents={printed ?? itemsTotalCents}
            currency={shownIn}
            onChange={setTipCents}
          />
        )}

        {source.scan && <RawAnswer result={source.scan} />}
      </div>

      {editingDraft && (
        <EditSheet
          // Der Schlüssel setzt das Blatt beim Wechsel der Zeile zurück; sonst
          // stünden im Formular noch die Eingaben der vorigen Position.
          key={editingDraft.key}
          draft={editingDraft}
          currency={shownIn}
          taxCodes={source.taxCodes}
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
        {/*
          Der eine Fall, in dem nicht gespeichert werden darf: Fremdwährung ohne
          Kurs. Die Cent-Felder halten Euro — Franken hineinzuschreiben verschöbe
          jede Monatssumme, ohne dass es jemandem auffiele. Es fehlt genau eine
          Zahl, und das Feld dafür steht oben.
        */}
        {currencyState.blocked && (
          <p className={styles.saveHint}>
            Für diesen Bon in {currencyState.currency} fehlt noch der Kurs. Trag ihn oben ein –
            danach lässt sich speichern.
          </p>
        )}
        <button
          type="button"
          className={styles.save}
          disabled={saving || drafts.length === 0 || currencyState.blocked}
          onClick={save}
        >
          {saving
            ? 'Wird gespeichert…'
            : // Mit Trinkgeld: Auf dem Knopf steht, was der Einkauf gekostet hat,
              // nicht was auf dem Zettel gedruckt war.
              `${editingSaved ? 'Änderungen sichern' : 'Speichern'} · ${money(
                (printed ?? itemsTotalCents) + (merchantKind === 'gastro' ? tipCents : 0),
              )}`}
        </button>
      </div>
    </>
  )
}

/* ============================================================ Fremdwährung */

/**
 * Währung, Kurs und der Euro-Betrag, der daraus wird.
 *
 * Der Block erscheint nur, wenn es etwas zu sagen gibt: bei einem Bon in
 * fremder Währung, oder wenn das Modell zwar etwas gelesen hat, der Kurs aber
 * nicht zu beschaffen war. Bei einem deutschen Bon — dem Normalfall — steht
 * hier gar nichts.
 *
 * **Ein Einstellungsfeld für den Wechselkurs gibt es ausdrücklich nicht**
 * (KONZEPT-ERWEITERUNGEN.md, Abschnitt 5). Die App holt ihn selbst; das Feld
 * hier gilt für genau diesen einen Bon und erscheint nur, wenn der Abruf
 * scheitert oder der Nutzer den Kurs ändern will.
 */
function CurrencyBlock({
  state,
  detected,
  frozen,
  totalCents,
}: {
  state: CurrencyState
  /** Was die Erkennung gelesen hat — für den dritten Knopf, falls es einen gibt. */
  detected: string
  /** Ein gespeicherter Bon: Währung und Kurs sind eingefroren. */
  frozen: boolean
  /** Die Bon-Summe, in der Währung, in der die Beträge stehen. */
  totalCents: number
}) {
  const [editing, setEditing] = useState(false)
  const foreign = state.currency !== 'EUR'

  /*
   * Beim Bearbeiten eines gespeicherten Bons ist hier nichts zu wählen — der
   * Kurs ist eingefroren, und die Beträge unten stehen bereits in Euro. Ihn
   * nachzuführen würde eine Monatssumme der Vergangenheit rückwirkend ändern.
   * Statt Knöpfen, die nichts tun, steht deshalb nur der Sachverhalt da.
   */
  if (frozen) {
    if (!foreign || state.rate === null) return null
    return (
      <section className={styles.currency}>
        <div className={styles.notesTitle}>Währung</div>
        <p className={styles.currencyLine}>
          Dieser Einkauf wurde in {state.currency} erfasst, zum Kurs{' '}
          {state.rate.toFixed(6).replace('.', ',')}
          {state.rateDate ? ` vom ${formatDate(state.rateDate)}` : ''}. Die Beträge unten stehen in
          Euro.
          <span className={styles.currencyDetail}>
            Währung und Kurs bleiben, wie sie sind – sonst änderten sich alte Monatssummen
            rückwirkend.
          </span>
        </p>
      </section>
    )
  }

  const rateField = editing || (foreign && state.rate === null)
  const chips = (
    <div className={styles.chips} style={{ marginTop: 10 }}>
      {[...new Set([...CURRENCIES, detected])].map((code) => (
        <Chip
          key={code}
          selected={state.currency === code}
          onClick={() => {
            state.setCurrency(code)
            setEditing(false)
          }}
        >
          {code}
        </Chip>
      ))}
    </div>
  )

  /*
   * Bei einem Euro-Bon gibt es nichts zu klären, und ein Block über etwas, das
   * nicht zutrifft, ist auf einem Telefon teurer als anderswo. Ganz verschwinden
   * darf er trotzdem nicht: Hat das Modell das Währungszeichen übersehen — auf
   * einem Schweizer Bon steht es meist deutlich, aber eben nicht immer —, hätte
   * der Nutzer sonst keinen Weg mehr, das zu berichtigen.
   *
   * Deshalb zugeklappt, wie die abgetippten Zeilen darunter: da, aber leise.
   */
  if (!foreign && detected === 'EUR' && state.error === null) {
    return (
      <details className={styles.currency}>
        <summary className={styles.rawSummary}>Bon in einer anderen Währung?</summary>
        <p className={styles.taxNote}>
          Die Erkennung hat kein anderes Währungszeichen gelesen – bei einem deutschen Bon ist das
          der Normalfall. Stimmt das nicht, wähl die Währung hier; den Kurs holt die App dann selbst
          zum Bon-Datum.
        </p>
        {chips}
      </details>
    )
  }

  return (
    <section className={styles.currency}>
      <div className={styles.notesTitle}>Währung</div>

      {chips}

      {foreign && (
        <>
          {/*
            Genau die Zeile aus dem Konzept: Originalbetrag, Kurs, Euro-Betrag.
            Sie ist der ganze Zweck des Blocks — man muss sehen können, wie aus
            45,00 CHF 48,14 € wurden.
          */}
          {state.rate !== null && (
            <p className={styles.currencyLine}>
              Dieser Bon ist in {state.currency}. Umgerechnet
              {state.rateDate ? ` zum EZB-Kurs vom ${formatDate(state.rateDate)}` : ' zum Kurs'}:{' '}
              <strong>{formatEuro(roundCents(totalCents * state.rate))}</strong>
              <span className={styles.currencyDetail}>
                ({formatMoney(totalCents, state.currency)} · Kurs{' '}
                {state.rate.toFixed(6).replace('.', ',')})
              </span>
            </p>
          )}

          {state.loading && <p className={styles.taxNote}>EZB-Kurs wird geholt…</p>}

          {state.error && (
            <p className={styles.currencyError} role="status">
              {state.error}
            </p>
          )}

          {rateField ? (
            <div className={styles.tipField}>
              <span className={styles.fieldLabel}>1 {state.currency} in Euro</span>
              <input
                className={`${styles.input} ${styles['input--number']}`}
                type="text"
                inputMode="decimal"
                autoFocus={editing}
                defaultValue={state.rate === null ? '' : state.rate.toFixed(6).replace('.', ',')}
                placeholder="z. B. 1,069862"
                aria-label={`Kurs: 1 ${state.currency} in Euro`}
                onChange={(event) => {
                  const value = Number(event.target.value.replace(',', '.'))
                  state.setRate(Number.isFinite(value) && value > 0 ? value : null)
                }}
              />
            </div>
          ) : (
            <button type="button" className={styles.rawCopy} onClick={() => setEditing(true)}>
              Kurs ändern
            </button>
          )}
        </>
      )}
    </section>
  )
}

/* ============================================================== Trinkgeld */

/**
 * „Trinkgeld gegeben?" — abgefragt, nicht geraten.
 *
 * Trinkgeld steht auf einem Restaurantbeleg praktisch nie: Es wird beim Zahlen
 * gesagt und nicht gedruckt. Es gibt also nichts zu erkennen, und deshalb ist
 * das hier ein Eingabefeld und keine Anzeige.
 *
 * **Vorbelegung immer „Nein".** Ein vorausgefülltes Trinkgeld wäre eine
 * Behauptung über etwas, das der Bon nicht hergibt — und in der Monatssumme
 * stünde dann Geld, das nie geflossen ist.
 *
 * Die Prozentknöpfe füllen nur das Feld vor. Auf 43,80 € sind 10 % genau
 * 4,38 €; gegeben werden meist 5 €, und dann soll das dastehen.
 */
function TipBlock({
  tipCents,
  baseCents,
  currency,
  onChange,
}: {
  tipCents: number
  /** Grundlage der Prozentrechnung: die gedruckte Summe ohne Trinkgeld. */
  baseCents: number
  /** Die Währung, in der der Bon dasteht — Trinkgeld gibt man in Franken. */
  currency: string
  onChange: (cents: number) => void
}) {
  /*
   * Das Feld führt seinen eigenen Text: Wer „4," getippt hat, ist mitten in
   * einer Zahl, und `toPriceField(400)` würde ihm daraus „4,00" machen und den
   * Cursor verschieben. Die Knöpfe darüber schreiben beides zugleich.
   */
  const [field, setField] = useState(() => (tipCents === 0 ? '' : toPriceField(tipCents)))

  const set = (cents: number) => {
    onChange(cents)
    setField(cents === 0 ? '' : toPriceField(cents))
  }

  return (
    <section className={styles.tip}>
      <div className={styles.notesTitle}>Trinkgeld gegeben?</div>

      <div className={styles.chips}>
        <Chip selected={tipCents === 0} onClick={() => set(0)}>
          Nein
        </Chip>
        {TIP_PERCENTS.map((percent) => {
          const cents = tipFromPercent(baseCents, percent)
          return (
            <Chip key={percent} selected={tipCents !== 0 && tipCents === cents} onClick={() => set(cents)}>
              {percent} % · {formatMoney(cents, currency)}
            </Chip>
          )
        })}
      </div>

      <div className={styles.tipField}>
        <span className={styles.fieldLabel}>Eigener Betrag</span>
        <input
          className={`${styles.input} ${styles['input--number']}`}
          type="text"
          inputMode="decimal"
          value={field}
          placeholder="0,00"
          aria-label={`Trinkgeld in ${currency}`}
          onChange={(event) => {
            setField(event.target.value)
            onChange(event.target.value.trim() === '' ? 0 : Math.max(0, parsePrice(event.target.value)))
          }}
        />
      </div>

      <p className={styles.taxNote}>
        Trinkgeld ist keine Bon-Position: Es zählt in „Auswärts" und in die Gesamtsumme, aber in
        keine Kategorie – und der Summenabgleich oben lässt es außen vor.
      </p>
    </section>
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
  currency,
  taxCodes,
  onCancel,
  onSave,
  onDelete,
}: {
  draft: DraftItem
  /** Die Währung, in der die Beträge dieses Bons stehen. */
  currency: string
  /**
   * Die Kennzeichen zur Auswahl. Beim frischen Scan die des gedruckten
   * Steuerblocks, beim Bearbeiten die, die an den Positionen stehen. Leer:
   * nichts zu wählen.
   */
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
            Menge × Einzelpreis ergibt {formatMoney(expected, currency)}, in der Zeilensumme
            stehen {formatMoney(current, currency)}.
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
              {/*
                Nur aktive Kategorien. Eine abgeschaltete gilt für Altdaten
                weiter, wird aber nicht mehr neu vergeben — das ist der Sinn von
                „aus" (KONZEPT-ERWEITERUNGEN.md, Abschnitt 2).
              */}
              <div className={styles.chips}>
                {getActiveCategories().map((category) => (
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
