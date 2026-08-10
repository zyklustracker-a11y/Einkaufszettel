import { useState } from 'react'
import { Async, EmptyState } from '../components/states'
import { ProgressBar } from '../components/ui'
import {
  addShoppingItem,
  completeShoppingList,
  germanDataError,
  getMerchantName,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemChecked,
  useQuery,
} from '../data'
import { chooseStore } from '../lib/basket'
import { formatAmount, formatEuro } from '../lib/format'
import type {
  BasketMerchant,
  HouseholdStats,
  RhythmProduct,
  ShoppingItem,
  ShoppingList,
} from '../types'
import styles from './ShoppingList.module.css'

/**
 * Der Einkaufszettel.
 *
 * **Warum ein eigener Tab und keine Karte im Dashboard.** Das Konzept lässt
 * beides offen und will die Entscheidung „am Gerät" (KONZEPT-ERWEITERUNGEN.md,
 * Abschnitt 6). Sie fällt zugunsten des Tabs, aus zwei Gründen:
 *
 *   1. **Der Zettel wird im Laden benutzt**, im Stehen, mit einer Hand am
 *      Wagen. Eine Karte im Dashboard kostet dort einen Tipper und eine
 *      Scrollbewegung — und zwar genau in dem Moment, in dem es schnell gehen
 *      soll. Der Tab ist einen Daumen entfernt.
 *   2. **Er ist kein Bericht, sondern ein Arbeitsblatt.** Auf dem Dashboard
 *      steht, was war; hier hakt man ab, was noch kommt. Diese beiden Sorten
 *      Screen zu mischen macht beide unklarer.
 *
 * Der Tab ist geblieben, auch als die Leiste mit Schritt 15 wieder auf vier
 * Felder ging: Abgegeben haben die Bestpreise, nicht der Zettel. Die
 * Beschriftungen stehen seitdem wieder ausgeschrieben da (Übersicht · Zettel ·
 * Analysen · Gesundheit).
 */
export function ShoppingListScreen() {
  const state = useQuery(getShoppingList, [])

  return (
    <div className="screen screen--tabbed">
      <h1 className="screenTitle">Einkaufszettel</h1>
      <Async state={state}>
        {(list) => <Body list={list} reload={state.reload} />}
      </Async>
    </div>
  )
}

function Body({ list, reload }: { list: ShoppingList; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Jede Änderung läuft hier durch: ein Ladezustand, eine Fehlerstelle. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      reload()
    } catch (cause) {
      setError(germanDataError(cause))
    } finally {
      setBusy(false)
    }
  }

  const open = list.items.filter((item) => !item.checked)
  const done = list.items.filter((item) => item.checked)

  return (
    <>
      {!list.stats.suggestionsReady && <Progress stats={list.stats} rhythms={list.rhythms} />}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {list.items.length === 0 ? (
        <NothingDue stats={list.stats} rhythms={list.rhythms} />
      ) : (
        <>
          <Summary items={list.items} />
          <WhereToShop merchants={list.merchants} openCount={open.length} />
          <Groups
            items={open}
            busy={busy}
            onToggle={(item) => void run(() => setShoppingItemChecked(item.id, true))}
            onRemove={(item) => void run(() => removeShoppingItem(item.id))}
          />

          {done.length > 0 && (
            <section className={styles.doneCard}>
              <div className={styles.doneTitle}>
                Erledigt · {done.length} von {list.items.length}
              </div>
              {done.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.doneRow}
                  disabled={busy}
                  onClick={() => void run(() => setShoppingItemChecked(item.id, false))}
                >
                  <span className={styles.tickDone} aria-hidden="true">
                    ✓
                  </span>
                  <span className={styles.doneLabel}>{item.label}</span>
                </button>
              ))}
            </section>
          )}
        </>
      )}

      <AddItem busy={busy} onAdd={(label) => run(() => addShoppingItem(list.listId, label))} />

      {list.items.length > 0 && (
        <>
          <button
            type="button"
            className={styles.complete}
            disabled={busy}
            onClick={() => void run(() => completeShoppingList(list.listId))}
          >
            Einkauf abschließen
          </button>
          <p className={styles.footnote}>
            Damit wird der Zettel geschlossen; beim nächsten Öffnen entsteht ein neuer. Was du
            gescannt hast, hakt die App schon beim Speichern des Bons selbst ab.
          </p>
        </>
      )}

      {list.stats.suggestionsReady && list.items.length > 0 && (
        <p className={styles.footnote}>
          Basiert auf {list.stats.receiptCount} Einkäufen – wird mit jedem weiteren genauer.
        </p>
      )}
    </>
  )
}

/**
 * Der Leerzustand — und warum er drei Fassungen hat.
 *
 * Bis Schritt 19 stand hier ein Satz: „Alles, was du regelmäßig kaufst, ist
 * noch frisch." Das war eine Behauptung, die die Daten oft nicht hergaben. Wer
 * unregelmäßig einkauft, hat **gar keinen** erkannten Rhythmus — dann ist
 * nichts „noch frisch", sondern nichts vorhersagbar. Der Satz beruhigte über
 * etwas, das die App nicht wusste.
 *
 * Jetzt wird unterschieden:
 *
 *   1. Schwelle noch nicht erreicht → das sagt der Fortschritt darüber.
 *   2. Schwelle erreicht, aber kein stabiler Rhythmus → sagen, woran es liegt,
 *      und die erkannten Abstände zeigen. Der Nutzer sieht damit, dass die App
 *      mitzählt, und kann selbst entscheiden.
 *   3. Rhythmen erkannt, gerade keiner fällig → dann stimmt „noch frisch".
 */
function NothingDue({ stats, rhythms }: { stats: HouseholdStats; rhythms: RhythmProduct[] }) {
  if (!stats.suggestionsReady) {
    return (
      <EmptyState inline title="Noch kein Vorschlag">
        Vorschläge kommen, sobald genug Einkäufe erfasst sind. Eigene Einträge kannst du jederzeit
        hinschreiben.
      </EmptyState>
    )
  }

  if (rhythms.length === 0) {
    return (
      <EmptyState inline title="Noch kein regelmäßiges Produkt erkannt">
        Für einen Vorschlag braucht es ein Produkt, das du <strong>mindestens dreimal</strong> und
        in einigermaßen gleichen Abständen gekauft hast. Bisher ist keines dabei – unregelmäßige
        Käufe vorherzusagen wäre geraten. Eigene Einträge kannst du jederzeit hinschreiben.
      </EmptyState>
    )
  }

  return (
    <EmptyState inline title="Gerade ist nichts fällig">
      Erkannt sind{' '}
      {rhythms
        .slice(0, 4)
        .map((rhythm) => `${rhythm.name} alle ${rhythm.medianGapDays} Tage`)
        .join(' · ')}
      . Keines davon ist gerade dran – sobald etwas fällig wird, steht es hier.
    </EmptyState>
  )
}

/* ============================================================== Fortschritt */

/**
 * „Dein Einkaufszettel entsteht gerade."
 *
 * Zwei Balken statt einem, weil die Schwelle aus zwei Bedingungen besteht: Zeit
 * allein nützt nichts, wenn nicht eingekauft wurde. Die Zahlen kommen aus der
 * Datenbank — dort entscheidet dieselbe Schwelle, ob überhaupt Vorschläge
 * entstehen, und zwei Fassungen wären zwei Wahrheiten.
 *
 * **Der Balken darf rückwärts gehen**, wenn ein Bon gelöscht wird. Das ist
 * richtig so: Er zeigt den Stand und nicht den Fleiß.
 */
function Progress({ stats, rhythms }: { stats: HouseholdStats; rhythms: RhythmProduct[] }) {
  const receiptsLeft = Math.max(0, stats.requiredReceipts - stats.receiptCount)
  const daysLeft = Math.max(0, stats.requiredDays - stats.daySpan)

  if (stats.receiptCount === 0) {
    return (
      <EmptyState title="Dein Einkaufszettel entsteht aus deinen Einkäufen" scanHint>
        Ich lerne aus deinen Bons, was du regelmäßig brauchst – und schlage es vor, wenn es wieder
        fällig ist. Nach {stats.requiredReceipts} Einkäufen über {stats.requiredDays} Tage geht es
        los.
      </EmptyState>
    )
  }

  return (
    <section className="card">
      <div className="cardTitle" style={{ marginBottom: 6 }}>
        Dein Einkaufszettel entsteht gerade
      </div>
      <p className={styles.intro}>
        Ich lerne aus deinen Einkäufen, was du regelmäßig brauchst.
      </p>

      <div className={styles.bar}>
        <ProgressBar
          fraction={Math.min(1, stats.receiptCount / stats.requiredReceipts)}
          label="Einkäufe"
        />
        <div className={styles.barLabel}>
          {stats.receiptCount} von {stats.requiredReceipts} Einkäufen
        </div>
      </div>

      <div className={styles.bar}>
        <ProgressBar
          fraction={Math.min(1, stats.daySpan / stats.requiredDays)}
          label="Zeitraum"
        />
        <div className={styles.barLabel}>
          {stats.daySpan} von {stats.requiredDays} Tagen
        </div>
      </div>

      <p className={styles.intro}>
        {receiptsLeft === 0 && daysLeft === 0
          ? 'Gleich geht es los.'
          : `Noch ${[
              receiptsLeft > 0 ? `${receiptsLeft} ${receiptsLeft === 1 ? 'Einkauf' : 'Einkäufe'}` : null,
              daysLeft > 0 ? `${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}` : null,
            ]
              .filter(Boolean)
              .join(' und ')}, dann kann ich dir einen Zettel vorschlagen.`}
      </p>

      {/*
        Die wichtigste Zeile des ganzen Zustands: echte Zwischenergebnisse statt
        nur ein Balken. Ein Produkt erscheint hier, sobald es dreimal gekauft
        wurde — auch wenn die Gesamtschwelle noch fehlt.
      */}
      {rhythms.length > 0 && (
        <p className={styles.recognised}>
          Schon erkannt:{' '}
          {rhythms
            .slice(0, 4)
            .map((rhythm) => `${rhythm.name} alle ${rhythm.medianGapDays} Tage`)
            .join(' · ')}
        </p>
      )}
    </section>
  )
}

/* ================================================================= Die Liste */

/**
 * Der Preis einer Position — und warum zwei Quellen dafür in Frage kommen.
 *
 * `bestPriceCents` ist der günstigste Betrag beim günstigsten Laden, jedes Mal
 * frisch gerechnet. `expectedPriceCents` steht seit dem Eintragen am Datensatz
 * und altert. Solange es den ersten gibt, gilt er: Sonst stünde neben „ALDI
 * SÜD" eine Zahl, die von woanders stammt — und die Summe oben passte nicht zu
 * der Empfehlung darunter.
 */
function itemPriceCents(item: ShoppingItem): number | null {
  return item.bestPriceCents ?? item.expectedPriceCents
}

function Summary({ items }: { items: ShoppingItem[] }) {
  const open = items.filter((item) => !item.checked)
  const known = open.filter((item) => itemPriceCents(item) !== null)
  const expected = known.reduce((sum, item) => sum + (itemPriceCents(item) ?? 0), 0)

  return (
    <div className={styles.summary}>
      <div>
        <div className={styles.summaryCount}>
          {open.length} {open.length === 1 ? 'Eintrag' : 'Einträge'} offen
        </div>
        <div className={styles.summaryHint}>
          {known.length === 0
            ? 'Für die Kostenschätzung fehlen noch bekannte Preise.'
            : known.length === open.length
              ? 'Geschätzt nach deinen bisher günstigsten Preisen'
              : `Preis für ${known.length} von ${open.length} Einträgen bekannt`}
        </div>
      </div>
      <div className={styles.summaryAmount}>{formatEuro(expected)}</div>
    </div>
  )
}

/* ============================================================== Wo kaufen? */

/**
 * Ein Laden für den ganzen Zettel.
 *
 * **Warum das nicht dasselbe ist wie die Bestpreise.** Die stehen an jeder
 * Zeile und beantworten „wo war dieses Produkt am günstigsten". Wer ihnen
 * Position für Position folgt, fährt für zehn Einträge in vier Läden — die
 * Zeit frisst die Differenz, und niemand macht es zweimal. Diese Karte
 * beantwortet die andere Frage: In welchem **einen** Laden wird dieser Einkauf
 * insgesamt am billigsten?
 *
 * **Beide Zahlen stehen da.** Was der eine Laden kostet und was der Umweg über
 * alle brächte. Ob 2,20 € drei zusätzliche Läden wert sind, kann nur der
 * Einkaufende entscheiden — aber nur, wenn er beide Zahlen sieht.
 */
function WhereToShop({
  merchants,
  openCount,
}: {
  merchants: BasketMerchant[]
  openCount: number
}) {
  const advice = chooseStore(merchants)
  if (!advice) return null

  const { best, others, extraCents, detourWorthMentioning } = advice
  const withoutPrice = Math.max(0, openCount - best.pricedItems)

  return (
    <section className={styles.shopCard}>
      <div className={styles.shopHead}>Wo kaufen?</div>

      <div className={styles.shopBest}>
        <span className={styles.shopName}>{getMerchantName(best.merchantId)}</span>
        <span className={styles.shopTotal}>{formatEuro(best.basketTotalCents)}</span>
      </div>

      <p className={styles.shopWhy}>
        {best.missingItems === 0
          ? `Alle ${best.coveredItems} bepreisten Positionen hast du dort schon einmal gekauft.`
          : `${best.coveredItems} von ${best.pricedItems} Positionen hast du dort schon gekauft; ` +
            `für die ${best.missingItems === 1 ? 'übrige' : 'übrigen'} ist dein bisher günstigster Preis gerechnet.`}
      </p>

      <p className={styles.shopDetour}>
        {detourWorthMentioning
          ? `Jede Position im jeweils günstigsten Laden wären ${formatEuro(best.optimumTotalCents)} – ` +
            `${formatEuro(extraCents)} weniger, dafür ${best.optimumMerchantCount} Läden.`
          : best.optimumMerchantCount > 1
            ? `Der Weg über ${best.optimumMerchantCount} Läden brächte nur ${formatEuro(extraCents)} – das lohnt sich nicht.`
            : 'Günstiger wird es auch mit mehreren Läden nicht.'}
      </p>

      {others.length > 0 && (
        <ul className={styles.shopList}>
          {others.slice(0, 3).map((merchant) => (
            <li key={merchant.merchantId} className={styles.shopRow}>
              <span className={styles.shopOtherName}>{getMerchantName(merchant.merchantId)}</span>
              {/* „10 von 10" ist keine Auskunft. Die Zahl steht nur da, wenn
                  der Laden etwas vom Zettel gar nicht führt. */}
              {merchant.missingItems > 0 && (
                <span className={styles.shopOtherCount}>
                  {merchant.coveredItems} von {merchant.pricedItems}
                </span>
              )}
              <span className={styles.shopOtherTotal}>{formatEuro(merchant.basketTotalCents)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.shopFootnote}>
        Gerechnet mit dem günstigsten Betrag, den du in den letzten sechs Monaten dort bezahlt hast.
        {withoutPrice > 0 &&
          ` Für ${withoutPrice} ${withoutPrice === 1 ? 'Eintrag' : 'Einträge'} kennt die App noch keinen Preis.`}
      </p>
    </section>
  )
}

/** Nach Kategorie gruppiert — so, wie man den Laden durchläuft. */
function Groups({
  items,
  busy,
  onToggle,
  onRemove,
}: {
  items: ShoppingItem[]
  busy: boolean
  onToggle: (item: ShoppingItem) => void
  onRemove: (item: ShoppingItem) => void
}) {
  const groups = new Map<string, ShoppingItem[]>()
  for (const item of items) {
    const list = groups.get(item.categoryName) ?? []
    list.push(item)
    groups.set(item.categoryName, list)
  }

  const ordered = [...groups.entries()].sort(
    (a, b) => (a[1][0]?.categorySort ?? 999) - (b[1][0]?.categorySort ?? 999),
  )

  return (
    <>
      {ordered.map(([name, group]) => (
        <section key={name} className={styles.group}>
          <div className={styles.groupHead}>
            <span
              className={styles.swatch}
              style={{ background: group[0]?.categoryColor ?? 'var(--muted)' }}
              aria-hidden="true"
            />
            {name}
          </div>
          {group.map((item) => (
            <Row
              key={item.id}
              item={item}
              busy={busy}
              onToggle={() => onToggle(item)}
              onRemove={() => onRemove(item)}
            />
          ))}
        </section>
      ))}
    </>
  )
}

/**
 * Die Begründung unter dem Namen: „zuletzt vor 9 Tagen · üblich alle 7".
 *
 * Sie steht ausdrücklich da und nicht in einem Aufklappbereich. Ein Vorschlag
 * ohne Begründung ist eine Behauptung; mit ihr kann der Nutzer entscheiden, ob
 * die App richtig liegt.
 */
function reason(item: ShoppingItem): string | null {
  if (item.medianGapDays === null || item.daysSinceLast === null) return null
  const last =
    item.daysSinceLast === 0
      ? 'zuletzt heute'
      : item.daysSinceLast === 1
        ? 'zuletzt gestern'
        : `zuletzt vor ${item.daysSinceLast} Tagen`
  return `${last} · üblich alle ${item.medianGapDays}`
}

function Row({
  item,
  busy,
  onToggle,
  onRemove,
}: {
  item: ShoppingItem
  busy: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const amount =
    item.quantityBase !== null && item.quantityUnit !== null
      ? item.quantityUnit === 'stk'
        ? `${item.quantityBase} ×`
        : formatAmount(
            item.quantityUnit === 'g' || item.quantityUnit === 'ml'
              ? item.quantityBase
              : item.quantityBase / 1000,
            item.quantityUnit === 'kg' || item.quantityUnit === 'g' ? 'kg' : 'l',
          )
      : null

  const why = reason(item)
  const merchant = item.bestMerchantId ? getMerchantName(item.bestMerchantId) : null
  const price = itemPriceCents(item)

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.tick}
        disabled={busy}
        aria-label={`${item.label} abhaken`}
        onClick={onToggle}
      />
      <span className={styles.main}>
        <span className={styles.label}>
          {item.label}
          {amount && <span className={styles.amount}> {amount}</span>}
        </span>
        {why && <span className={styles.meta}>{why}</span>}
      </span>
      {/*
        Preis und Laden stehen übereinander in einer eigenen Spalte.

        Vorher hing „günstig bei ALDI SÜD" hinten an der Begründung — in einer
        Zeile mit `text-overflow: ellipsis`. Auf einem Telefon war davon
        regelmäßig nur „· g…" übrig: Die Auskunft war gerechnet, gespeichert,
        geladen und dann abgeschnitten. Hier kann sie nicht mehr verschwinden,
        weil die Spalte sich nach ihrem Inhalt richtet.
      */}
      {(price !== null || merchant) && (
        <span className={styles.priceBox}>
          {price !== null && <span className={styles.price}>{formatEuro(price)}</span>}
          {merchant && <span className={styles.merchant}>{merchant}</span>}
        </span>
      )}
      <button
        type="button"
        className={styles.remove}
        disabled={busy}
        aria-label={`${item.label} entfernen`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  )
}

/* ================================================================ Ergänzen */

function AddItem({ busy, onAdd }: { busy: boolean; onAdd: (label: string) => Promise<void> }) {
  const [text, setText] = useState('')

  const submit = async () => {
    if (text.trim() === '') return
    await onAdd(text)
    setText('')
  }

  return (
    <div className={styles.add}>
      <input
        className={styles.addInput}
        value={text}
        placeholder="Eigener Eintrag"
        aria-label="Eigener Eintrag, zum Beispiel Blumen"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit()
        }}
      />
      <button
        type="button"
        className={styles.addButton}
        disabled={busy || text.trim() === ''}
        onClick={() => void submit()}
      >
        Hinzufügen
      </button>
    </div>
  )
}
