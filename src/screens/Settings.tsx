import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Async } from '../components/states'
import { ChevronRightIcon } from '../components/icons'
import { BackLink, Toggle } from '../components/ui'
import { germanDataError, getMonthlyBudgetCents, saveMonthlyBudgetCents, useQuery } from '../data'
import { formatEuroWhole } from '../lib/format'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/AuthContext'
import { CategorySettings } from './CategorySettings'
import { HouseholdSettings } from './HouseholdSettings'
import { TraitSettings } from './TraitSettings'
import { UnassignedSettings } from './UnassignedSettings'
import styles from './Settings.module.css'

/**
 * Die Einstellungen — eine Übersicht mit eigenen Screens dahinter.
 *
 * Bis Schritt 11 stand hier alles untereinander: Budget, zwei Schalter, der
 * Haushalt, die Kategorieverwaltung und die Merkmalsverwaltung. Mit jedem
 * Bereich wurde der Screen länger, und die beiden Verwaltungen mit ihren
 * Listen und Blättern machten zusammen den größten Teil aus — wer das Budget
 * ändern wollte, scrollte an vierzehn Merkmalen vorbei.
 *
 * Jetzt zeigt die Übersicht **nur die Bereichsnamen**, wie man es von iOS kennt:
 * eine Zeile je Bereich, ein Chevron rechts, dahinter ein eigener Screen mit
 * Zurück-Weg. Die Bereiche selbst sind unverändert — es sind dieselben
 * Komponenten, sie stehen nur nicht mehr alle gleichzeitig da.
 *
 * **Der Dark-Mode-Schalter bleibt auf der Übersicht.** Er ist ein einziger
 * Zustand; ein eigener Screen dafür wäre ein Tipper mehr für dieselbe Bewegung.
 * Die Faustregel: Was in eine Zeile passt und keine Erklärung braucht, bleibt
 * oben.
 *
 * **Die Reihenfolge folgt der Häufigkeit, nicht der Technik.** Das Budget wird
 * am ehesten geändert, danach kommt, was die Erkennung steuert (Kategorien,
 * Merkmale), dann der Haushalt. Abmelden steht ganz unten, weil es der einzige
 * Eintrag ist, den man nicht versehentlich treffen soll.
 */
export function SettingsScreen() {
  const { theme, toggleTheme } = useAppState()
  const { user, signOut } = useAuth()
  const budget = useQuery(getMonthlyBudgetCents, [])

  return (
    <div className="screen">
      <BackLink to="/">Übersicht</BackLink>
      <h1 className="pageTitle" style={{ marginBottom: 18 }}>
        Einstellungen
      </h1>

      <nav className={styles.group}>
        <Row
          to="/einstellungen/budget"
          title="Monatsbudget"
          value={
            budget.data && budget.data > 0 ? formatEuroWhole(budget.data) : 'noch keins'
          }
        />
      </nav>

      <div className={styles.groupLabel}>Was die Erkennung steuert</div>
      <nav className={styles.group}>
        <Row
          to="/einstellungen/kategorien"
          title="Kategorien"
          hint="Anlegen, umbenennen, umfärben, abschalten"
        />
        <Row
          to="/einstellungen/merkmale"
          title="Merkmale"
          hint="Gewichte, Gruppen und die Erklärung fürs Modell"
        />
        {/*
          Die einzige Stelle, an der Datenqualität dauerhaft verlorengeht: Eine
          Position ohne Kategorie bekommt kein Produkt und taucht danach in
          keiner Auswertung mehr auf. Hier lässt sie sich nachträglich einsammeln.
        */}
        <Row
          to="/einstellungen/zuordnung"
          title="Positionen ohne Zuordnung"
          hint="Bontexte nachträglich einem Produkt zuordnen – rückwirkend"
        />
      </nav>

      <div className={styles.groupLabel}>Haushalt</div>
      <nav className={styles.group}>
        <Row
          to="/einstellungen/haushalt"
          title="Haushalt"
          value={user?.name ?? undefined}
          hint="Wer dazugehört, Familie einladen"
        />
      </nav>

      <div className={styles.groupLabel}>Darstellung</div>
      <section className={styles.group}>
        {/*
          Ein reiner Schalter bleibt hier: ein einziger Zustand, keine Erklärung
          nötig. Ein eigener Screen dafür wäre ein Tipper mehr für dieselbe
          Bewegung.
        */}
        <div className={styles.settingRow}>
          <div style={{ flex: 1 }} className={styles.settingTitle}>
            Dark Mode
          </div>
          <Toggle checked={theme === 'dark'} onChange={toggleTheme} label="Dark Mode" />
        </div>
      </section>

      <button type="button" className={styles.signOut} onClick={signOut}>
        Konto abmelden
      </button>
      <div className={styles.version}>Receipt AI 1.0 · Privater Haushalt</div>
    </div>
  )
}

/**
 * Eine Zeile der Übersicht: Name, darunter die Erklärung, rechts der Stand und
 * das Chevron.
 *
 * **Die Erklärung steht in einer eigenen Zeile**, kleiner und gedämpft — wie in
 * den iOS-Einstellungen. Nebeneinander wirkte sie gedrängt und war schlecht zu
 * lesen: „Kategorien Anlegen, umbenennen, umfärben, abschalten" liest sich als
 * ein einziger Satz, und auf 390 px brach er obendrein um.
 *
 * Das Chevron bleibt rechts und sitzt mittig zur **ganzen** Zeile, nicht zum
 * Namen — sonst rutschte es bei einer zweizeiligen Erklärung nach oben.
 */
function Row({
  to,
  title,
  value,
  hint,
}: {
  to: string
  title: string
  /** Der aktuelle Stand, rechts in gedämpfter Farbe — wie in den iOS-Einstellungen. */
  value?: string
  hint?: string
}) {
  return (
    <Link to={to} className={styles.navRow}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className={styles.navTitle}>{title}</span>
        {hint && <span className={styles.navHint}>{hint}</span>}
      </span>
      {value && <span className={styles.navValue}>{value}</span>}
      <span className={styles.chevron} aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </Link>
  )
}

/* ============================================================ Die Bereiche */

/**
 * Der Rahmen für einen Bereichs-Screen.
 *
 * Zurück-Weg und Titel stehen an einer Stelle, damit die vier Bereiche nicht
 * viermal leicht unterschiedlich aussehen.
 */
function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="screen">
      <BackLink to="/einstellungen">Einstellungen</BackLink>
      <h1 className="pageTitle" style={{ marginBottom: 18 }}>
        {title}
      </h1>
      {children}
    </div>
  )
}

export function BudgetSettingsScreen() {
  return (
    <SettingsPage title="Monatsbudget">
      <BudgetCard />
      <p className={styles.pageNote}>
        Das Budget gehört dem Haushalt und liegt in der Datenbank, nicht auf diesem Gerät – alle
        sehen dieselbe Zahl. Es gilt ab dem laufenden Monat und danach weiter, bis du es änderst.
      </p>
    </SettingsPage>
  )
}

export function CategorySettingsScreen() {
  return (
    <SettingsPage title="Kategorien">
      <CategorySettings />
    </SettingsPage>
  )
}

export function TraitSettingsScreen() {
  return (
    <SettingsPage title="Merkmale">
      <TraitSettings />
    </SettingsPage>
  )
}

export function UnassignedSettingsScreen() {
  return (
    <SettingsPage title="Positionen ohne Zuordnung">
      <UnassignedSettings />
    </SettingsPage>
  )
}

export function HouseholdSettingsScreen() {
  return (
    <SettingsPage title="Haushalt">
      <HouseholdSettings />
    </SettingsPage>
  )
}

/**
 * Das Monatsbudget.
 *
 * Es liegt seit Schritt 2c in der Tabelle `budgets` und nicht mehr im
 * Browser-Speicher: Es gehört dem Haushalt, nicht dem Gerät. Geschrieben wird
 * auf den laufenden Monat; eingegeben und angezeigt wird in vollen Euro,
 * gespeichert wird in Cent.
 */
function BudgetCard() {
  const state = useQuery(getMonthlyBudgetCents, [])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const budgetCents = state.data ?? 0
  const budgetEuros = Math.round(budgetCents / 100)

  const startEditing = () => {
    setDraft(budgetCents > 0 ? String(budgetEuros) : '')
    setSaveError(null)
    setEditing(true)
  }

  const commit = async () => {
    const value = Number(draft.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      setSaveError('Bitte eine Zahl eingeben, zum Beispiel 450.')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await saveMonthlyBudgetCents(Math.round(value) * 100)
      setEditing(false)
      state.reload()
    } catch (cause) {
      setSaveError(germanDataError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.budgetCard}>
      <div className={styles.label}>Monatsbudget</div>
      <Async
        state={state}
        loading={<div className={styles.budgetValue}>…</div>}
      >
        {() => (
          <>
            <div className={styles.budgetRow}>
              {editing ? (
                <input
                  className={styles.budgetInput}
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={draft}
                  placeholder="450"
                  aria-label="Monatsbudget in Euro"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commit()
                  }}
                />
              ) : (
                <div className={styles.budgetValue}>{budgetCents > 0 ? budgetEuros : '–'}</div>
              )}
              <div className={styles.currency}>€</div>
              <div style={{ flex: 1 }} />
              {editing ? (
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles['smallButton--primary']}`}
                  disabled={saving}
                  onClick={() => void commit()}
                >
                  {saving ? 'Sichert…' : 'Sichern'}
                </button>
              ) : (
                <button type="button" className={styles.smallButton} onClick={startEditing}>
                  {budgetCents > 0 ? 'Ändern' : 'Festlegen'}
                </button>
              )}
            </div>

            {saveError && (
              <p className={styles.settingHint} role="alert" style={{ marginTop: 10 }}>
                {saveError}
              </p>
            )}
            {!editing && budgetCents === 0 && !saveError && (
              <p className={styles.settingHint} style={{ marginTop: 10 }}>
                Noch kein Budget festgelegt. Danach zeigt die Übersicht, wie viel davon schon
                verbraucht ist.
              </p>
            )}
          </>
        )}
      </Async>
    </section>
  )
}
