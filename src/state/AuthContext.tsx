import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from '../lib/supabase'

/**
 * Wer ist angemeldet.
 *
 * Der Zustand hat drei Stufen, und `loading` ist die wichtigste davon: Solange
 * die Sitzung geprüft wird, darf weder der Anmelde-Screen noch das Dashboard
 * erscheinen. Sonst blitzt beim Start kurz die falsche Seite auf.
 */
export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

export interface AuthUser {
  id: string
  name: string
  email: string
  /** Profilbild aus dem Google-Konto, falls vorhanden. */
  avatarUrl: string | null
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  /** Bereits auf Deutsch, direkt anzeigbar. */
  error: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** Falls Supabase gar nicht antwortet, nicht ewig im Ladezustand hängen. */
const SESSION_TIMEOUT_MS = 8000

function textOf(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toAuthUser(user: User): AuthUser {
  // Google liefert die Felder unter wechselnden Namen, je nach Anbieter-Version.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  return {
    id: user.id,
    name:
      textOf(meta, 'full_name') ??
      textOf(meta, 'name') ??
      user.email?.split('@')[0] ??
      'Angemeldet',
    email: user.email ?? '',
    avatarUrl: textOf(meta, 'avatar_url') ?? textOf(meta, 'picture') ?? null,
  }
}

/**
 * Technische Meldungen in verständliches Deutsch übersetzen. Was nicht bekannt
 * ist, bekommt einen allgemeinen Satz — auf keinen Fall die Rohmeldung.
 */
function germanAuthError(...parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join(' ').toLowerCase()
  if (text.includes('access_denied') || text.includes('denied') || text.includes('cancel')) {
    return 'Die Anmeldung wurde abgebrochen.'
  }
  if (text.includes('popup')) {
    return 'Die Anmeldung konnte nicht geöffnet werden. Bitte noch einmal versuchen.'
  }
  if (text.includes('network') || text.includes('fetch')) {
    return 'Keine Verbindung. Prüfe deine Internetverbindung und versuch es noch einmal.'
  }
  if (text.includes('provider') || text.includes('not enabled')) {
    return 'Die Google-Anmeldung ist in Supabase noch nicht freigeschaltet.'
  }
  if (text.includes('redirect')) {
    return 'Die Rücksprungadresse ist in Supabase nicht hinterlegt. Bitte in den Auth-Einstellungen ergänzen.'
  }
  return 'Die Anmeldung hat nicht geklappt. Bitte versuch es noch einmal.'
}

/**
 * Trägt die Adresse eine Antwort von Google? Wird einmal beim Laden abgefragt,
 * bevor der Router irgendwohin umleiten kann.
 */
function hasOAuthResponse(): boolean {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return ['code', 'error', 'access_token'].some((key) => query.has(key) || hash.has(key))
}

/**
 * Kommt Google mit einem Fehler zurück, steht er als Parameter in der Adresse —
 * je nach Ablauf in der Abfrage oder hinter dem Rautezeichen.
 */
function readErrorFromUrl(): string | null {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const code = query.get('error') ?? hash.get('error')
  if (!code) return null

  const description = query.get('error_description') ?? hash.get('error_description')
  const subCode = query.get('error_code') ?? hash.get('error_code')
  // Adresse säubern, damit ein Neuladen den Fehler nicht wiederholt. Das ist
  // nur sicher, weil eine Fehlerantwort nie einen Anmelde-Code enthält.
  window.history.replaceState({}, '', window.location.pathname)
  return germanAuthError(code, subCode, description)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settled = useRef(false)
  /*
   * Einmal beim Laden festgehalten: Steht eine Antwort von Google in der
   * Adresse? Wenn ja, darf ein "nicht angemeldet" nicht sofort zum
   * Anmelde-Screen führen — die Weiterleitung würde den Code aus der Adresse
   * werfen, bevor er gegen eine Sitzung getauscht ist.
   */
  const awaitingOAuth = useRef(hasOAuthResponse())

  useEffect(() => {
    if (supabaseConfigError) {
      setError(supabaseConfigError)
      setStatus('signedOut')
      return
    }

    const urlError = readErrorFromUrl()
    if (urlError) {
      setError(urlError)
      // Eine Fehlerantwort enthält keinen Code — es gibt nichts einzulösen und
      // damit auch keinen Grund, auf eine Sitzung zu warten.
      awaitingOAuth.current = false
    }

    /*
     * Bewusst nur über onAuthStateChange, nicht zusätzlich über getSession():
     * Beim Rücksprung von Google muss erst der Code aus der Adresse gegen eine
     * Sitzung getauscht werden. Ein paralleles getSession() könnte vorher mit
     * "nicht angemeldet" antworten — dann blitzte der Anmelde-Screen auf, bevor
     * das Dashboard erscheint. Der Client meldet sich nach der Einrichtung von
     * selbst mit INITIAL_SESSION.
     */
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      if (session?.user) {
        settled.current = true
        awaitingOAuth.current = false
        setUser(toAuthUser(session.user))
        setStatus('signedIn')
        return
      }

      // Rücksprung von Google, aber noch keine Sitzung: weiter warten statt
      // wegleiten. Das Zeitlimit unten fängt den Fall ab, dass nichts kommt.
      if (awaitingOAuth.current) return

      settled.current = true
      setUser(null)
      setStatus('signedOut')
    })

    const timer = window.setTimeout(() => {
      if (settled.current) return
      settled.current = true
      setError(
        awaitingOAuth.current
          ? 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuch es noch einmal.'
          : 'Supabase antwortet nicht. Prüfe die Adresse und den Schlüssel in der .env-Datei.',
      )
      awaitingOAuth.current = false
      setUser(null)
      setStatus('signedOut')
    }, SESSION_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timer)
      listener.subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (supabaseConfigError) {
      setError(supabaseConfigError)
      return
    }
    setError(null)

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        /*
         * Zurück auf die Startseite, also ins Dashboard. Diese Adresse muss in
         * Supabase unter Authentication → URL Configuration als Redirect URL
         * eingetragen sein.
         */
        redirectTo: `${window.location.origin}/`,
        /*
         * Kein Pop-up, sondern eine Weiterleitung im selben Fenster: In einer
         * installierten PWA auf dem iPhone werden Pop-ups nicht zuverlässig
         * geöffnet. `skipBrowserRedirect: false` ist die Voreinstellung und
         * steht hier nur, damit die Absicht im Code sichtbar bleibt.
         */
        skipBrowserRedirect: false,
      },
    })

    if (oauthError) setError(germanAuthError(oauthError.message))
  }, [])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError('Das Abmelden hat nicht geklappt. Bitte versuch es noch einmal.')
      return
    }
    // Den Rest erledigt der Listener oben: Er setzt den Zustand auf abgemeldet,
    // woraufhin der Zugriffsschutz zum Anmelde-Screen weiterleitet.
    setError(null)
  }, [])

  const value = useMemo(
    () => ({ status, user, error, signInWithGoogle, signOut }),
    [status, user, error, signInWithGoogle, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
