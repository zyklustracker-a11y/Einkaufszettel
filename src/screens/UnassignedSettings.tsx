import { useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { Async, EmptyState } from '../components/states'
import {
  assignRawText,
  germanDataError,
  getActiveCategories,
  getActiveTraits,
  getUnassignedItems,
  useQuery,
} from '../data'
import { DERIVED_TRAIT_KEYS } from '../lib/draft'
import { formatDate, formatEuro } from '../lib/format'
import type { CategoryId, TraitId, UnassignedText } from '../types'
import styles from './UnassignedSettings.module.css'

/**
 * Positionen ohne Zuordnung — die Nachpflege.
 *
 * ---------------------------------------------------------------------------
 * WOFÜR ES DEN SCREEN GIBT
 * ---------------------------------------------------------------------------
 *
 * Eine Position ohne Kategorie bekommt kein kanonisches Produkt (PROJEKT.md), und
 * das ist richtig so: Raten ist auch dem Code verboten. Die Folge ist aber, dass
 * sie in **keinem** Kategorietopf, in keinem Preisvergleich und in keinem
 * Rhythmus auftaucht. Der Korrektur-Screen sagt das vor dem Speichern; danach
 * fand man diese Zeilen nie wieder.
 *
 * Das ist die einzige Stelle, an der Datenqualität dauerhaft verlorengeht —
 * alles andere wächst mit jedem Bon von selbst zusammen. Hier lässt sie sich
 * einsammeln.
 *
 * ---------------------------------------------------------------------------
 * ZUGEORDNET WIRD DER ROHTEXT, NICHT DIE ZEILE
 * ---------------------------------------------------------------------------
 *
 * „G&G H-MILCH 1,5%" steht auf zwölf Bons. Zwölfmal dasselbe zu tippen wäre
 * Arbeit ohne Erkenntnis, und genau dafür gibt es `product_mappings`. Ein
 * Handgriff hier ordnet deshalb alle Zeilen mit diesem Text zu — rückwirkend —
 * und die Erkennung weiß es ab dem nächsten Scan von selbst.
 */
export function UnassignedSettings() {
  const state = useQuery(getUnassignedItems, [])
  const [revision, setRevision] = useState(0)
  void revision

  return (
    <Async state={state}>
      {(texts) =>
        texts.length === 0 ? (
          <section className={styles.card}>
            <EmptyState inline title="Alles zugeordnet">
              Jede erfasste Position hängt an einem Produkt. Damit zählt sie in die Kategorien, in
              den Preisvergleich und in den Einkaufszettel.
            </EmptyState>
          </section>
        ) : (
          <Body
            texts={texts}
            onDone={() => {
              setRevision((n) => n + 1)
              state.reload()
            }}
          />
        )
      }
    </Async>
  )
}

function Body({ texts, onDone }: { texts: UnassignedText[]; onDone: () => void }) {
  const [editing, setEditing] = useState<UnassignedText | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const totalItems = texts.reduce((sum, text) => sum + text.itemCount, 0)
  const totalCents = texts.reduce((sum, text) => sum + text.amountCents, 0)

  return (
    <section className={styles.card}>
      <p className={styles.intro} style={{ marginTop: 12 }}>
        {totalItems} {totalItems === 1 ? 'Position' : 'Positionen'} über{' '}
        {formatEuro(totalCents)} hängen an keinem Produkt. Sie zählen in die Monatssumme, aber
        nicht in die Kategorien, nicht in den Preisvergleich und nicht in den Einkaufszettel.
      </p>
      <p className={styles.intro}>
        Ein Handgriff ordnet <strong>alle Zeilen mit demselben Bontext</strong> zu – auch die
        vergangenen. Ab dem nächsten Scan erkennt die App den Text von selbst.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {texts.map((text) => (
          <li key={text.rawText}>
            <button
              type="button"
              className={styles.row}
              disabled={busy}
              onClick={() => {
                setError(null)
                setEditing(text)
              }}
            >
              <span className={styles.rowMain}>
                <span className={styles.rawText}>{text.rawText}</span>
                <span className={styles.meta}>
                  {text.itemCount} {text.itemCount === 1 ? 'Position' : 'Positionen'} ·{' '}
                  {formatDate(text.firstPurchasedOn)}
                  {text.firstPurchasedOn === text.lastPurchasedOn
                    ? ''
                    : `–${formatDate(text.lastPurchasedOn)}`}
                </span>
              </span>
              <span className={styles.amount}>{formatEuro(text.amountCents)}</span>
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <AssignSheet
          key={editing.rawText}
          text={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (name, categoryId, traitKeys) => {
            setBusy(true)
            setError(null)
            try {
              await assignRawText(editing.rawText, name, categoryId, traitKeys)
              setEditing(null)
              onDone()
            } catch (cause) {
              setError(germanDataError(cause))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </section>
  )
}

/**
 * Das Zuordnungs-Blatt: Name, Kategorie, Merkmale.
 *
 * Dieselben drei Felder wie im Korrektur-Screen und in derselben Reihenfolge —
 * wer dort einmal zugeordnet hat, findet sich hier ohne Nachdenken zurecht. Die
 * Milch-Felder fehlen bewusst: Sie gehören zu einem Produkt, das man vor sich
 * hat, und wer sie braucht, öffnet den Bon und bearbeitet ihn.
 */
function AssignSheet({
  text,
  busy,
  onCancel,
  onSave,
}: {
  text: UnassignedText
  busy: boolean
  onCancel: () => void
  onSave: (name: string, categoryId: CategoryId, traitKeys: TraitId[]) => Promise<void>
}) {
  const [name, setName] = useState(text.sampleName)
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null)
  const [traitKeys, setTraitKeys] = useState<TraitId[]>([])

  const categories = getActiveCategories()
  // Die abgeleiteten Milch-Merkmale stehen nicht zur Auswahl — sie entstehen aus
  // den Feldern am Produkt und werden nie angehakt (PROJEKT.md).
  const traits = getActiveTraits().filter((trait) => !DERIVED_TRAIT_KEYS.includes(trait.id))

  const canSave = name.trim() !== '' && categoryId !== null

  return (
    <BottomSheet title="Position zuordnen" onClose={onCancel}>
      <div className={styles.form}>
        <div className={styles.rawLine}>
          Bontext: <code>{text.rawText}</code> · {text.itemCount}{' '}
          {text.itemCount === 1 ? 'Position' : 'Positionen'}
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Klarname</span>
          <input
            className={styles.input}
            value={name}
            autoFocus
            placeholder="z. B. H-Milch 1,5 %"
            onChange={(event) => setName(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Gibt es den Namen schon, wird auf dasselbe Produkt verwiesen – so wachsen die
            Preisvergleiche zusammen.
          </p>
        </label>

        <div>
          <div className={styles.fieldLabel}>Kategorie</div>
          <div className={styles.chips}>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={categoryId === category.id}
                className={
                  categoryId === category.id ? `${styles.chip} ${styles['chip--on']}` : styles.chip
                }
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          {categoryId === null && (
            <p className={styles.fieldHint}>
              Ohne Kategorie bleibt die Position, wie sie ist – das ist die Angabe, an der alles
              Weitere hängt.
            </p>
          )}
        </div>

        <div>
          <div className={styles.fieldLabel}>Merkmale</div>
          <div className={styles.chips}>
            {traits.map((trait) => (
              <button
                key={trait.id}
                type="button"
                aria-pressed={traitKeys.includes(trait.id)}
                className={
                  traitKeys.includes(trait.id) ? `${styles.chip} ${styles['chip--on']}` : styles.chip
                }
                onClick={() =>
                  setTraitKeys((keys) =>
                    keys.includes(trait.id)
                      ? keys.filter((key) => key !== trait.id)
                      : [...keys, trait.id],
                  )
                }
              >
                {trait.label}
              </button>
            ))}
          </div>
          <p className={styles.fieldHint}>
            Merkmale hängen am Produkt und gelten damit rückwirkend für alle Käufe.
          </p>
        </div>
      </div>

      <button
        type="button"
        className={styles.apply}
        disabled={busy || !canSave}
        onClick={() => void onSave(name, categoryId as CategoryId, traitKeys)}
      >
        {busy
          ? 'Wird zugeordnet…'
          : `${text.itemCount} ${text.itemCount === 1 ? 'Position' : 'Positionen'} zuordnen`}
      </button>
    </BottomSheet>
  )
}
