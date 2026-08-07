import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, BackLink, Toggle } from '../components/ui'
import { getHousehold } from '../data'
import { useAppState } from '../state/AppState'
import styles from './Settings.module.css'

export function SettingsScreen() {
  const { theme, toggleTheme, settings, setMonthlyBudget, toggleDeleteReceiptPhotos } = useAppState()
  const [editingBudget, setEditingBudget] = useState(false)
  const [draftBudget, setDraftBudget] = useState(String(settings.monthlyBudget))

  const startEditing = () => {
    setDraftBudget(String(settings.monthlyBudget))
    setEditingBudget(true)
  }

  const commitBudget = () => {
    const value = Number(draftBudget.replace(',', '.'))
    if (Number.isFinite(value) && value > 0) setMonthlyBudget(Math.round(value))
    setEditingBudget(false)
  }

  return (
    <div className="screen">
      <BackLink to="/">Übersicht</BackLink>
      <h1 className="pageTitle" style={{ marginBottom: 18 }}>
        Einstellungen
      </h1>

      <section className={styles.budgetCard}>
        <div className={styles.label}>Monatsbudget</div>
        <div className={styles.budgetRow}>
          {editingBudget ? (
            <input
              className={styles.budgetInput}
              type="text"
              inputMode="numeric"
              autoFocus
              value={draftBudget}
              aria-label="Monatsbudget in Euro"
              onChange={(event) => setDraftBudget(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && commitBudget()}
            />
          ) : (
            <div className={styles.budgetValue}>{settings.monthlyBudget}</div>
          )}
          <div className={styles.currency}>€</div>
          <div style={{ flex: 1 }} />
          {editingBudget ? (
            <button type="button" className={`${styles.smallButton} ${styles['smallButton--primary']}`} onClick={commitBudget}>
              Sichern
            </button>
          ) : (
            <button type="button" className={styles.smallButton} onClick={startEditing}>
              Ändern
            </button>
          )}
        </div>
      </section>

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
            checked={settings.deleteReceiptPhotos}
            onChange={toggleDeleteReceiptPhotos}
            label="Bon-Fotos nach Erkennung löschen"
          />
        </div>
      </section>

      <section className={styles.householdCard}>
        <div className={styles.householdTitle}>Haushalt</div>
        {getHousehold().map((member) => (
          <div key={member.id} className={styles.member}>
            <Avatar name={member.name} round />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={styles.memberName}>{member.name}</span>
              <span className={styles.memberMail}>{member.email}</span>
            </span>
            <span className={member.isCurrentUser ? `${styles.badge} ${styles['badge--current']}` : styles.badge}>
              {member.isCurrentUser ? 'Angemeldet' : 'Mitglied'}
            </span>
          </div>
        ))}
      </section>

      <Link to="/anmelden" className={styles.signOut}>
        Konto abmelden
      </Link>
      <div className={styles.version}>Receipt AI 1.0 · Privater Haushalt</div>
    </div>
  )
}
