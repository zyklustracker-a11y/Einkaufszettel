import { useState } from 'react'
import { Async } from '../components/states'
import { Avatar } from '../components/ui'
import {
  createInvite,
  germanDataError,
  getHouseholdMembers,
  getInvite,
  getOwnReceiptCount,
  joinHousehold,
  revokeInvite,
  useQuery,
} from '../data'
import type { HouseholdMember, Invite } from '../data'
import { formatDate } from '../lib/format'
import styles from './HouseholdSettings.module.css'

/**
 * Haushalt und Familie.
 *
 * Beim ersten Login bekommt jeder Nutzer einen eigenen Haushalt — sonst gäbe
 * keine Abfrage eine Zeile zurück. Meldet sich die Familie an, sitzt danach
 * jeder allein in seinem eigenen. Dieser Screen ist der Weg zusammen, und er hat
 * zwei Seiten: einladen und beitreten.
 *
 * **Beides steht untereinander auf demselben Screen**, statt hinter einer
 * Auswahl „Bist du Einladender oder Beitretender?". Wer die App zum ersten Mal
 * öffnet, weiß noch nicht, welche Rolle er hat; das steht erst fest, wenn er den
 * Code entweder verschickt oder bekommen hat.
 */
export function HouseholdSettings() {
  const state = useQuery(
    async () => ({
      members: await getHouseholdMembers(),
      invite: await getInvite(),
      receiptCount: await getOwnReceiptCount(),
    }),
    [],
  )

  return (
    <Async state={state}>
      {(data) => (
        <>
          <Members members={data.members} />
          <InviteCard invite={data.invite} onChanged={state.reload} />
          <JoinCard members={data.members.length} receiptCount={data.receiptCount} />
        </>
      )}
    </Async>
  )
}

function Members({ members }: { members: HouseholdMember[] }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardTitle}>
        {members.length === 1 ? 'Du allein' : `${members.length} Mitglieder`}
      </div>
      {members.map((member) => (
        <div key={member.userId} className={styles.member}>
          <Avatar name={member.name} round />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className={styles.memberName}>{member.name}</span>
            <span className={styles.memberMail}>{member.email}</span>
          </span>
          <span
            className={
              member.isSelf ? `${styles.badge} ${styles['badge--current']}` : styles.badge
            }
          >
            {member.isSelf ? 'Du' : member.role === 'owner' ? 'Eigentümer' : 'Mitglied'}
          </span>
        </div>
      ))}
      <p className={styles.note}>
        Alle Mitglieder sehen dieselben Bons, Preise und Auswertungen. Es gibt keine getrennten
        Bereiche – der Haushalt ist die Einheit, nicht das Konto.
      </p>
    </section>
  )
}

/* ================================================================ Einladen */

function InviteCard({ invite, onChanged }: { invite: Invite | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (cause) {
      setError(germanDataError(cause))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Berechtigung bleibt der Code zum Abtippen stehen —
      // dafür ist er schließlich gemacht.
      setCopied(false)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardTitle}>Familie einladen</div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {invite ? (
        <>
          <button
            type="button"
            className={styles.code}
            onClick={() => void copy()}
            aria-label={`Einladungscode ${invite.code.split('').join(' ')} kopieren`}
          >
            {invite.code}
          </button>
          <p className={styles.note}>
            {copied ? 'Kopiert. ' : ''}
            Gültig bis {invite.expiresAt ? formatDate(invite.expiresAt.slice(0, 10)) : 'in 7 Tagen'}.
            Der Code lässt sich mehrfach einlösen – ein Code reicht also für die ganze Familie.
          </p>
          <p className={styles.note}>
            <strong>So geht es:</strong> Das Familienmitglied meldet sich in der App mit seinem
            eigenen Google-Konto an, öffnet Einstellungen → Haushalt und trägt den Code unten ein.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void run(() => createInvite(true))}
            >
              Neuen Code
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => void run(revokeInvite)}
            >
              Zurückziehen
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.note}>
            Erzeug einen Code und gib ihn weiter. Wer ihn eingibt, sieht danach dieselben Daten wie
            du. Der Code ist sieben Tage gültig und lässt sich jederzeit zurückziehen.
          </p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void run(() => createInvite())}
          >
            {busy ? 'Wird erzeugt…' : 'Einladungscode erzeugen'}
          </button>
        </>
      )}
    </section>
  )
}

/* ============================================================== Beitreten */

function JoinCard({ members, receiptCount }: { members: number; receiptCount: number }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      await joinHousehold(code)
      /*
       * Vollständig neu laden statt den Zustand nachzuziehen.
       *
       * Beim Beitritt wechselt der Haushalt, und daran hängt buchstäblich alles:
       * Kategorien, Merkmale, Händler, jede Abfrage, jedes Zwischenlager. Ein
       * Neuladen ist hier der ehrlichere Weg als ein Dutzend Auffrischungen, von
       * denen eine vergessen würde — und es passiert genau einmal im Leben
       * dieses Kontos.
       */
      window.location.assign('/')
    } catch (cause) {
      setError(germanDataError(cause))
      setBusy(false)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardTitle}>Einem Haushalt beitreten</div>

      <p className={styles.note}>
        Hast du einen Code bekommen? Dann trag ihn hier ein.
      </p>

      {/*
        Was passieren wird, steht vorher da und nicht als Fehlermeldung
        hinterher. Bei null Bons wird der eigene Haushalt aufgelöst; mit Bons
        lehnt die Datenbank ab, weil Zusammenführen nicht rückgängig zu machen
        wäre.
      */}
      {receiptCount > 0 ? (
        <p className={styles.warn}>
          In deinem Haushalt liegen bereits {receiptCount}{' '}
          {receiptCount === 1 ? 'Einkauf' : 'Einkäufe'}. Ein Beitritt würde ihn auflösen – deshalb
          lehnt die App ihn ab. Lösch die Einkäufe zuerst, wenn du sie nicht mehr brauchst.
        </p>
      ) : members > 1 ? (
        <p className={styles.warn}>
          Du bist bereits mit anderen in einem Haushalt. Ein Beitritt woanders nimmt dich hier
          heraus.
        </p>
      ) : (
        <p className={styles.note}>
          Dein bisheriger Haushalt ist leer und wird dabei aufgelöst – samt der Kategorien und
          Merkmale, die beim Anmelden angelegt wurden. Danach siehst du die Daten des Haushalts,
          dem du beitrittst.
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <input
        className={styles.input}
        value={code}
        placeholder="ABCD2345"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Einladungscode"
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />
      <button
        type="button"
        className={styles.primary}
        disabled={busy || code.trim().length < 8}
        onClick={() => void join()}
      >
        {busy ? 'Tritt bei…' : 'Beitreten'}
      </button>
    </section>
  )
}
