import { useState } from 'react'
import type { ReactNode } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { Toggle } from '../components/ui'
import {
  checkNewCategoryName,
  createCategory,
  germanDataError,
  getCategoryProductCounts,
  moveCategory,
  setCategoryActive,
  sortedCategories,
  suggestCategoryColor,
  updateCategory,
  useQuery,
} from '../data'
import { CATEGORY_PALETTE } from '../lib/category'
import type { Category } from '../types'
import styles from './CategorySettings.module.css'

/**
 * Die Kategorieverwaltung in den Einstellungen.
 *
 * Aufgebaut wie die Merkmalsliste daneben: eine Zeile je Eintrag, Antippen
 * öffnet ein Bearbeiten-Blatt. Drei Dinge sind hier anders, und alle drei haben
 * denselben Grund — Kategorien werden von `canonical_products` über einen
 * Fremdschlüssel referenziert:
 *
 *   * **Der Schlüssel entsteht beim Anlegen aus dem Namen und ist danach
 *     unveränderlich.** Er wird im Anlegen-Formular vorher gezeigt, damit
 *     niemand raten muss, was dabei herauskommt.
 *   * **Deaktivieren statt Löschen.** Wie viele Produkte betroffen sind, steht
 *     daneben, bevor der Schalter umgelegt wird.
 *   * **Eine neue Kategorie wirkt nicht rückwirkend.** Das steht als Hinweis
 *     über der Liste, nicht versteckt in einem Blatt.
 *
 * Der eigentliche Gewinn steckt in der Erklärung: Sie geht in den
 * Erkennungs-Prompt, genau wie bei den Merkmalen. Eine neu angelegte Kategorie
 * wirkt damit ab dem nächsten Scan — ohne Codeänderung, ohne Ausrollen.
 */
export function CategorySettings() {
  /*
   * Die Kategorien liegen im Zwischenlager und lassen sich synchron
   * nachschlagen. React merkt von einer Änderung dort nichts, deshalb dieser
   * Zähler: Er steigt nach jedem Schreibvorgang und zeichnet die Liste neu.
   */
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = useQuery(getCategoryProductCounts, [revision])
  const categories = sortedCategories()
  const activeCount = categories.filter((category) => category.active).length

  /** Jeder Schreibvorgang läuft hier durch: ein Ladezustand, eine Fehlerstelle. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setRevision((n) => n + 1)
      counts.reload()
      return true
    } catch (cause) {
      setError(germanDataError(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardTitle}>Kategorien</div>
      <p className={styles.intro}>
        {activeCount} von {categories.length} Kategorien sind aktiv. Die Erklärung geht an die
        Erkennung – eine neue Kategorie wirkt damit ab dem nächsten Scan.
      </p>
      <p className={styles.intro}>
        <strong>Nicht rückwirkend:</strong> Schon erfasste Produkte behalten ihre bisherige
        Kategorie, bis du sie beim nächsten Bon änderst.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {categories.map((category, index) => (
          <li key={category.id} className={styles.row}>
            <span
              className={styles.swatch}
              style={{ background: category.color }}
              aria-hidden="true"
            />

            <button
              type="button"
              className={styles.rowMain}
              onClick={() => setEditing(category)}
              aria-label={`${category.name} bearbeiten`}
            >
              <span className={category.active ? styles.name : `${styles.name} ${styles['name--off']}`}>
                {category.name}
              </span>
              <span className={styles.meta}>
                {category.id} · {category.isFood ? 'Lebensmittel' : 'Non-Food'}
                {category.isDefault ? '' : ' · selbst angelegt'}
                {category.active ? '' : ' · aus'}
              </span>
            </button>

            {/*
              Pfeile statt Ziehen: Ein Drag-and-drop, das auf dem iPhone
              zuverlässig funktioniert, bräuchte eine zusätzliche Abhängigkeit —
              und die Reihenfolge ändert man einmal und dann nie wieder.
            */}
            <span className={styles.arrows}>
              <button
                type="button"
                className={styles.arrow}
                disabled={busy || index === 0}
                onClick={() => void run(() => moveCategory(category.id, -1))}
                aria-label={`${category.name} nach oben`}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.arrow}
                disabled={busy || index === categories.length - 1}
                onClick={() => void run(() => moveCategory(category.id, 1))}
                aria-label={`${category.name} nach unten`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.add}
        disabled={busy}
        onClick={() => {
          setError(null)
          setCreating(true)
        }}
      >
        + Kategorie anlegen
      </button>

      {creating && (
        <CreateSheet
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            if (await run(() => createCategory(input))) setCreating(false)
          }}
        />
      )}

      {editing && (
        <EditSheet
          key={editing.id}
          category={editing}
          productCount={counts.data?.[editing.id] ?? 0}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (await run(() => updateCategory(editing.id, input))) setEditing(null)
          }}
          onToggleActive={async () => {
            if (await run(() => setCategoryActive(editing.id, !editing.active))) setEditing(null)
          }}
        />
      )}
    </section>
  )
}

/* ============================================================ Anlegen */

function CreateSheet({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean
  onCancel: () => void
  onCreate: (input: {
    name: string
    description: string
    isFood: boolean
    color: string
  }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isFood, setIsFood] = useState(true)
  // Einmal beim Öffnen bestimmt und nicht bei jedem Zeichen neu: Sonst spränge
  // die Vorauswahl, sobald jemand tippt.
  const [color, setColor] = useState(() => suggestCategoryColor())

  const { key, error } = checkNewCategoryName(name)
  const canSave = name.trim() !== '' && key !== '' && error === null && !busy

  return (
    <BottomSheet title="Kategorie anlegen" onClose={onCancel}>
      <div className={styles.form}>
        <Field label="Name">
          <input
            className={styles.input}
            value={name}
            autoFocus
            placeholder="z. B. Auswärts essen"
            onChange={(event) => setName(event.target.value)}
          />
          {/*
            Der Schlüssel wird gezeigt, bevor er entsteht — er ist danach
            unveränderlich, und ein Wert, den man nicht mehr ändern kann, sollte
            man vorher gesehen haben.
          */}
          {error ? (
            <p className={styles.fieldError}>{error}</p>
          ) : (
            <p className={styles.fieldHint}>
              {key === ''
                ? 'Der Schlüssel entsteht aus dem Namen und lässt sich später nicht mehr ändern.'
                : `Schlüssel: ${key} – bleibt so, auch wenn du den Namen später änderst.`}
            </p>
          )}
        </Field>

        <Field label="Erklärung für die Erkennung">
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={description}
            rows={3}
            placeholder="Was gehört hinein, was nicht? Zum Beispiel: Speisen und Getränke, die im Lokal verzehrt oder geliefert wurden."
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Dieser Satz geht bei jedem Scan an das Modell. Ohne ihn muss es aus dem Namen raten.
          </p>
        </Field>

        <FoodRow isFood={isFood} onChange={() => setIsFood((value) => !value)} />
        <ColorRow color={color} onChange={setColor} />
      </div>

      <button
        type="button"
        className={styles.apply}
        disabled={!canSave}
        onClick={() => void onCreate({ name, description, isFood, color })}
      >
        {busy ? 'Wird angelegt…' : 'Anlegen'}
      </button>
    </BottomSheet>
  )
}

/* ========================================================== Bearbeiten */

function EditSheet({
  category,
  productCount,
  busy,
  onCancel,
  onSave,
  onToggleActive,
}: {
  category: Category
  productCount: number
  busy: boolean
  onCancel: () => void
  onSave: (input: {
    name: string
    description: string
    isFood: boolean
    color: string
  }) => Promise<void>
  onToggleActive: () => Promise<void>
}) {
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description)
  const [isFood, setIsFood] = useState(category.isFood)
  const [color, setColor] = useState(category.color)

  return (
    <BottomSheet title={category.name} onClose={onCancel}>
      <div className={styles.form}>
        <div className={styles.keyLine}>
          Schlüssel: <code>{category.id}</code> ·{' '}
          {category.isDefault ? 'mitgeliefert' : 'selbst angelegt'}
        </div>

        <Field label="Name">
          <input
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {name.trim() === '' && <p className={styles.fieldError}>Der Name darf nicht leer sein.</p>}
        </Field>

        <Field label="Erklärung für die Erkennung">
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={description}
            rows={3}
            placeholder="Was gehört hinein, was nicht?"
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Wirkt ab dem nächsten Scan – ohne Codeänderung und ohne neues Ausrollen.
          </p>
        </Field>

        <FoodRow isFood={isFood} onChange={() => setIsFood((value) => !value)} />
        <ColorRow color={color} onChange={setColor} />
      </div>

      <button
        type="button"
        className={styles.apply}
        disabled={busy || name.trim() === ''}
        onClick={() => void onSave({ name, description, isFood, color })}
      >
        {busy ? 'Wird gespeichert…' : 'Übernehmen'}
      </button>

      {/*
        Kein „Löschen". Produkte verweisen auf die Kategorie; ein Löschen würde
        sie brechen. Die Zahl daneben sagt, worüber wir reden.
      */}
      <p className={styles.affected}>
        {category.active
          ? productCount === 0
            ? 'Noch kein Produkt in dieser Kategorie. Ausgeschaltet verschwindet sie aus der Auswahl und aus der Erkennung.'
            : `${productCount} ${productCount === 1 ? 'Produkt behält' : 'Produkte behalten'} diese Kategorie. Ausgeschaltet verschwindet sie nur aus der Auswahl und aus der Erkennung – die Auswertungen zählen sie weiter.`
          : 'Ausgeschaltet: Die Erkennung schlägt diese Kategorie nicht mehr vor, und in der Auswahl steht sie nicht.'}
      </p>
      <button type="button" className={styles.toggleActive} disabled={busy} onClick={() => void onToggleActive()}>
        {category.active ? 'Kategorie deaktivieren' : 'Kategorie wieder aktivieren'}
      </button>
    </BottomSheet>
  )
}

/* ============================================================== Bausteine */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

function FoodRow({ isFood, onChange }: { isFood: boolean; onChange: () => void }) {
  return (
    <div className={styles.switchRow}>
      <span style={{ flex: 1 }}>
        <span className={styles.fieldLabel}>Lebensmittel</span>
        <span className={styles.fieldHint}>
          Zählt in „Lebensmittel" und in den Gesundheits-Score. Aus heißt Non-Food.
        </span>
      </span>
      <Toggle checked={isFood} onChange={onChange} label="Lebensmittel" />
    </div>
  )
}

function ColorRow({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <div>
      <div className={styles.fieldLabel}>Farbe</div>
      <div className={styles.palette}>
        {CATEGORY_PALETTE.map((option) => (
          <button
            key={option}
            type="button"
            className={
              option.toLowerCase() === color.toLowerCase()
                ? `${styles.colorChip} ${styles['colorChip--selected']}`
                : styles.colorChip
            }
            style={{ background: option }}
            aria-label={`Farbe ${option}`}
            aria-pressed={option.toLowerCase() === color.toLowerCase()}
            onClick={() => onChange(option)}
          />
        ))}
      </div>
    </div>
  )
}
