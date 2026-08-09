import { useState } from 'react'
import type { ReactNode } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { toneOf } from '../components/ui'
import {
  checkNewTraitName,
  createTrait,
  existingTraitGroups,
  germanDataError,
  getTraitProductCounts,
  moveTrait,
  setTraitActive,
  sortedTraits,
  updateTrait,
  useQuery,
} from '../data'
import { DERIVED_TRAIT_KEYS } from '../lib/draft'
import type { NewTrait } from '../data'
import type { Trait } from '../types'
import styles from './TraitSettings.module.css'

/**
 * Die Merkmalsverwaltung.
 *
 * Aufgebaut wie die Kategorieverwaltung daneben — dieselbe Zeile, dasselbe
 * Bearbeiten-Blatt, dieselben Pfeile. Drei Dinge sind hier eigen:
 *
 *   * **Das Gewicht** ist die eigentliche Stellschraube. Es reicht von −10 bis
 *     +10; 0 heißt „wird nur beobachtet" und landet im Gesundheits-Screen unter
 *     „Beobachtet" statt unter „Kritisch".
 *   * **Die Gruppe** entscheidet über die Doppelzählung: Innerhalb einer Gruppe
 *     zählt im Score nur das Merkmal mit dem größten Betrag (PROJEKT.md). Als
 *     Etikett hängen weiterhin alle am Produkt — sonst stimmte die Frage „wie
 *     viel gebe ich für Gluten aus" nicht mehr.
 *   * **Fünf Merkmale sind nicht anhakbar** (`roh`, `pasteurisiert`, `esl`,
 *     `uht`, `homogenisiert`). Sie entstehen aus den Milch-Feldern am Produkt.
 *     Gewicht und Gruppe lassen sich trotzdem einstellen — das ist ja gerade der
 *     Sinn: Wer H-Milch härter bewerten will, stellt hier das Gewicht.
 *
 * **Eine Gewichtsänderung wirkt rückwirkend.** Dafür ist nichts zu tun: Der
 * Score ist nirgends gespeichert, er wird bei jeder Anzeige neu gerechnet.
 */
export function TraitSettings() {
  /*
   * Die Merkmale liegen im Zwischenlager und werden synchron nachgeschlagen.
   * React merkt von einer Änderung dort nichts — deshalb dieser Zähler.
   */
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Trait | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counts = useQuery(getTraitProductCounts, [revision])
  const traits = sortedTraits()
  const activeCount = traits.filter((trait) => trait.active).length

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
      <div className={styles.cardTitle}>Merkmale</div>
      <p className={styles.intro}>
        {activeCount} von {traits.length} Merkmalen sind aktiv. Worauf die Auswertung achtet – die
        Erklärung geht an die Erkennung, das Gewicht in den Gesundheits-Score.
      </p>
      <p className={styles.intro}>
        <strong>Gewichte wirken rückwirkend:</strong> Der Score wird bei jeder Anzeige neu
        gerechnet, die Verlaufskurve ändert sich also sofort mit.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {traits.map((trait, index) => (
          <li key={trait.id} className={styles.row}>
            <span
              className={`${styles.short} ${styles[`short--${toneOf(trait)}`]}`}
              aria-hidden="true"
            >
              {trait.short}
            </span>

            <button
              type="button"
              className={styles.rowMain}
              onClick={() => setEditing(trait)}
              aria-label={`${trait.label} bearbeiten`}
            >
              <span className={trait.active ? styles.name : `${styles.name} ${styles['name--off']}`}>
                {trait.label}
              </span>
              <span className={styles.meta}>
                {trait.group ? `Gruppe ${trait.group}` : 'ohne Gruppe'}
                {trait.isDefault ? '' : ' · selbst angelegt'}
                {trait.active ? '' : ' · aus'}
                {DERIVED_TRAIT_KEYS.includes(trait.id) ? ' · aus Milch-Feldern' : ''}
              </span>
            </button>

            <span className={styles.weight}>{formatWeight(trait.weight)}</span>

            <span className={styles.arrows}>
              <button
                type="button"
                className={styles.arrow}
                disabled={busy || index === 0}
                onClick={() => void run(() => moveTrait(trait.id, -1))}
                aria-label={`${trait.label} nach oben`}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.arrow}
                disabled={busy || index === traits.length - 1}
                onClick={() => void run(() => moveTrait(trait.id, 1))}
                aria-label={`${trait.label} nach unten`}
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
        + Merkmal anlegen
      </button>

      {creating && (
        <TraitSheet
          title="Merkmal anlegen"
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={async (input) => {
            if (await run(() => createTrait(input))) setCreating(false)
          }}
        />
      )}

      {editing && (
        <TraitSheet
          key={editing.id}
          title={editing.label}
          trait={editing}
          productCount={counts.data?.[editing.id] ?? 0}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (await run(() => updateTrait(editing.id, input))) setEditing(null)
          }}
          onToggleActive={async () => {
            if (await run(() => setTraitActive(editing.id, !editing.active))) setEditing(null)
          }}
        />
      )}
    </section>
  )
}

/** `−3` · `0` · `+2` — das Vorzeichen trägt die Bedeutung und steht deshalb immer. */
function formatWeight(weight: number): string {
  if (weight > 0) return `+${weight}`
  if (weight < 0) return `−${Math.abs(weight)}`
  return '0'
}

/* ================================================== Anlegen und Bearbeiten */

/**
 * Ein Blatt für beides.
 *
 * Anders als bei den Kategorien gibt es hier **keine** zwei Formulare: Die
 * Felder sind dieselben, und der einzige Unterschied ist der Schlüssel — beim
 * Anlegen wird er vorher gezeigt, beim Bearbeiten steht er fest. Zwei Fassungen
 * mit sechs gleichen Feldern wären die Sorte Verdopplung, die auseinanderläuft.
 */
function TraitSheet({
  title,
  trait,
  productCount = 0,
  busy,
  onCancel,
  onSave,
  onToggleActive,
}: {
  title: string
  /** Fehlt beim Anlegen. */
  trait?: Trait
  productCount?: number
  busy: boolean
  onCancel: () => void
  onSave: (input: NewTrait) => Promise<void>
  onToggleActive?: () => Promise<void>
}) {
  const [label, setLabel] = useState(trait?.label ?? '')
  const [short, setShort] = useState(trait?.short ?? '')
  const [description, setDescription] = useState(trait?.description ?? '')
  const [tip, setTip] = useState(trait?.tip ?? '')
  const [weight, setWeight] = useState(trait?.weight ?? -2)
  const [group, setGroup] = useState(trait?.group ?? '')

  const creating = trait === undefined
  const check = checkNewTraitName(label)
  const canSave = label.trim() !== '' && (!creating || (check.key !== '' && check.error === null))

  const groups = existingTraitGroups()
  const derived = trait !== undefined && DERIVED_TRAIT_KEYS.includes(trait.id)

  return (
    <BottomSheet title={title} onClose={onCancel}>
      <div className={styles.form}>
        {trait && (
          <div className={styles.keyLine}>
            Schlüssel: <code>{trait.id}</code> ·{' '}
            {trait.isDefault ? 'mitgeliefert' : 'selbst angelegt'}
          </div>
        )}

        <Field label="Name">
          <input
            className={styles.input}
            value={label}
            autoFocus={creating}
            placeholder="z. B. Palmöl"
            onChange={(event) => setLabel(event.target.value)}
          />
          {creating ? (
            check.error ? (
              <p className={styles.fieldError}>{check.error}</p>
            ) : (
              <p className={styles.fieldHint}>
                {check.key === ''
                  ? 'Der Schlüssel entsteht aus dem Namen und lässt sich später nicht mehr ändern.'
                  : `Schlüssel: ${check.key} – bleibt so, auch wenn du den Namen später änderst.`}
              </p>
            )
          ) : (
            label.trim() === '' && <p className={styles.fieldError}>Der Name darf nicht leer sein.</p>
          )}
        </Field>

        <Field label="Kürzel fürs Badge">
          <input
            className={`${styles.input} ${styles['input--short']}`}
            value={short}
            maxLength={2}
            placeholder="P"
            onChange={(event) => setShort(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Ein bis zwei Zeichen. Sie stehen in der Positionsliste neben dem Produkt – mehr sprengt
            die Zeile.
          </p>
        </Field>

        <WeightRow weight={weight} onChange={setWeight} />

        <GroupRow group={group} groups={groups} onChange={setGroup} />

        <Field label="Erklärung für die Erkennung">
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={description}
            rows={3}
            placeholder="Woran erkennt man es? Zum Beispiel: Palmöl und Palmfett, auch als pflanzliches Fett deklariert."
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Dieser Satz geht bei jedem Scan an das Modell. Ohne ihn muss es aus dem Namen raten –
            wirkt ab dem nächsten Scan, ohne Ausrollen.
          </p>
        </Field>

        <Field label="Alternativ-Tipp">
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={tip}
            rows={2}
            placeholder="Statt … : …"
            onChange={(event) => setTip(event.target.value)}
          />
          <p className={styles.fieldHint}>
            Steht im Gesundheits-Screen unter dem Merkmal. Leer lassen ist in Ordnung.
          </p>
        </Field>

        {derived && (
          <p className={styles.affected}>
            Dieses Merkmal wird <strong>nicht angehakt</strong>, sondern aus den Milch-Feldern am
            Produkt abgeleitet (Erhitzung, Homogenisierung). Gewicht und Gruppe wirken trotzdem –
            genau dafür sind sie da.
          </p>
        )}
      </div>

      <button
        type="button"
        className={styles.apply}
        disabled={busy || !canSave}
        onClick={() => void onSave({ label, short, description, tip, weight, group })}
      >
        {busy ? 'Wird gespeichert…' : creating ? 'Anlegen' : 'Übernehmen'}
      </button>

      {trait && onToggleActive && (
        <>
          {/*
            Kein „Löschen". Produkte hängen über einen Fremdschlüssel am
            Merkmal — dieselbe Lage wie bei den Kategorien.
          */}
          <p className={styles.affected}>
            {trait.active
              ? productCount === 0
                ? 'Noch kein Produkt trägt dieses Merkmal. Ausgeschaltet verschwindet es aus der Auswahl, aus der Erkennung und aus dem Score.'
                : `${productCount} ${productCount === 1 ? 'Produkt trägt' : 'Produkte tragen'} dieses Merkmal. Ausgeschaltet bleibt die Zuordnung erhalten – sie zählt nur nicht mehr mit.`
              : 'Ausgeschaltet: Die Erkennung schlägt dieses Merkmal nicht mehr vor, und es zählt nicht in den Score.'}
          </p>
          <button
            type="button"
            className={styles.toggleActive}
            disabled={busy}
            onClick={() => void onToggleActive()}
          >
            {trait.active ? 'Merkmal deaktivieren' : 'Merkmal wieder aktivieren'}
          </button>
        </>
      )}
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

/**
 * Das Gewicht.
 *
 * Zwei Knöpfe und eine Zahl statt eines Schiebereglers: Auf −10 bis +10 trifft
 * ein Daumen den gewünschten Wert nicht, und der Unterschied zwischen −3 und −4
 * ist hier eine Entscheidung und kein Gefühl.
 */
function WeightRow({ weight, onChange }: { weight: number; onChange: (weight: number) => void }) {
  const meaning =
    weight < 0
      ? 'zieht den Score herunter'
      : weight > 0
        ? 'schreibt dem Score gut'
        : 'zählt nicht – wird nur beobachtet'

  return (
    <div>
      <div className={styles.fieldLabel}>Gewicht im Score</div>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.stepButton}
          disabled={weight <= -10}
          aria-label="Gewicht verringern"
          onClick={() => onChange(Math.max(-10, weight - 1))}
        >
          −
        </button>
        <span className={styles.stepValue}>{formatWeight(weight)}</span>
        <button
          type="button"
          className={styles.stepButton}
          disabled={weight >= 10}
          aria-label="Gewicht erhöhen"
          onClick={() => onChange(Math.min(10, weight + 1))}
        >
          +
        </button>
        <span className={styles.stepMeaning}>{meaning}</span>
      </div>
    </div>
  )
}

/**
 * Die Gruppe.
 *
 * Sie ist der einzige Wert hier, der etwas über das Zusammenspiel *mehrerer*
 * Merkmale sagt: Innerhalb einer Gruppe zählt im Score nur eines — das mit dem
 * größten Betrag. Deshalb steht die Erklärung darunter und nicht in einem
 * Hilfetext, den niemand öffnet.
 */
function GroupRow({
  group,
  groups,
  onChange,
}: {
  group: string
  groups: string[]
  onChange: (group: string) => void
}) {
  const [custom, setCustom] = useState(group !== '' && !groups.includes(group))

  return (
    <div>
      <div className={styles.fieldLabel}>Gruppe</div>
      <div className={styles.chips}>
        <Chip selected={group === ''} onClick={() => { onChange(''); setCustom(false) }}>
          ohne
        </Chip>
        {groups.map((name) => (
          <Chip
            key={name}
            selected={group === name}
            onClick={() => {
              onChange(name)
              setCustom(false)
            }}
          >
            {name}
          </Chip>
        ))}
        <Chip selected={custom} onClick={() => setCustom(true)}>
          neu …
        </Chip>
      </div>

      {custom && (
        <input
          className={styles.input}
          style={{ marginTop: 8 }}
          value={group}
          placeholder="z. B. fette"
          aria-label="Neue Gruppe"
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <p className={styles.fieldHint}>
        In einer Gruppe zählt im Score nur <strong>ein</strong> Merkmal – das mit dem größten
        Betrag. Als Etikett am Produkt bleiben alle stehen, sonst stimmte die Frage „wie viel gebe
        ich für Gluten aus“ nicht mehr.
      </p>
    </div>
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
