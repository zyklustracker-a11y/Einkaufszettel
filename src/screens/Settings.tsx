import { useState } from 'react'
import { Async } from '../components/states'
import { Avatar, BackLink, Toggle } from '../components/ui'
import { germanDataError, getMonthlyBudgetCents, saveMonthlyBudgetCents, useQuery } from '../data'
import { useAppState } from '../state/AppState'
import { useAuth } from '../state/AuthContext'
import { CategorySettings } from './CategorySettings'
import { TraitSettings } from './TraitSettings'
import styles from './Settings.module.css'

export function SettingsScreen() {
  const { theme, toggleTheme, deleteReceiptPhotos, toggleDeleteReceiptPhotos } = useAppState()
  const { user, signOut } = useAuth()

  return (
    <div className="screen">
      <BackLink to="/">Übersicht</BackLink>
      <h1 className="pageTitle" style={{ marginBottom: 18 }}>
        Einstellungen
      </h1>

      <BudgetCard />

      <section className={styles.group}>
        <div className={styles.settingRow}>
          <div style={{ flex: 1 }} className={styles.settingTitle}>
            Dark Mode
          </div>
          <Toggle checked={theme === 'dark'} onChange={toggleTheme} label="Dark Mode" />
        </div>
        <div className={styles.settingRow}>
          <div style={{ flex: 1 }}>
            <div className={styles.settingTitle}>Bon-Fotos nach Erkennung löschen</div>
            <div className={styles.settingHint}>Spart Speicher, Positionen bleiben erhalten</div>
          </div>
          <Toggle
            checked={deleteReceiptPhotos}
            onChange={toggleDeleteReceiptPhotos}
            label="Bon-Fotos nach Erkennung löschen"
          />
        </div>
      </section>

      <section className={styles.householdCard}>
        <div className={styles.householdTitle}>Haushalt</div>
        {user && (
          <div className={styles.member}>
            <Avatar name={user.name} src={user.avatarUrl} round />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.memberName}>{user.name}</span>
              <span className={styles.memberMail}>{user.email}</span>
            </span>
            <span className={`${styles.badge} ${styles['badge--current']}`}>Angemeldet</span>
          </div>
        )}
      </section>

      {/*
        Die Kategorien stehen über den Merkmalen: Eine Kategorie muss jede
        Position haben, ein Merkmal keine. Was häufiger gebraucht wird, steht
        weiter oben.
      */}
      <CategorySettings />

      <TraitSettings />

      <button type="button" className={styles.signOut} onClick={signOut}>
        Konto abmelden
      </button>
      <div className={styles.version}>Receipt AI 1.0 · Privater Haushalt</div>
    </div>
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
