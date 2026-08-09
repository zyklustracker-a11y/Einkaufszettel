/**
 * Benachrichtigungen im Browser — Berechtigung, Abo, Abmeldung.
 *
 * Die Kryptografie steckt auf dem Server (`supabase/functions/monatsreport/`);
 * hier geht es nur um die drei Dinge, die der Browser beisteuert: den Service
 * Worker anmelden, die Berechtigung erfragen und ein Abo erzeugen.
 *
 * **Auf dem iPhone geht das ausschließlich in der installierten App.** Safari
 * erlaubt Web Push seit iOS 16.4, aber nur für eine PWA, die über „Zum
 * Home-Bildschirm" hinzugefügt wurde — im normalen Safari-Tab gibt es die
 * Schnittstelle gar nicht. Deshalb prüft `pushSupport()` nicht nur, *ob* etwas
 * fehlt, sondern sagt auch **was**: „Nicht unterstützt" wäre hier die
 * unbrauchbarste aller Antworten.
 *
 * Bewusst frei von React: reine Funktionen um die Browser-Schnittstellen herum.
 */

import { supabase } from './supabase'

/** Der öffentliche VAPID-Schlüssel. Ohne ihn lässt sich kein Abo erzeugen. */
const vapidPublicKey: string = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim()

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Kann dieses Gerät Benachrichtigungen — und wenn nicht, warum.
 *
 * Die Reihenfolge der Prüfungen ist die Reihenfolge, in der man sie beheben
 * kann: erst die Einrichtung (Schlüssel), dann die Installation, dann der
 * Browser.
 */
export function pushSupport(): PushSupport {
  if (vapidPublicKey === '') {
    return {
      ok: false,
      reason:
        'Für Benachrichtigungen fehlt noch der Schlüssel. In der .env (und bei Vercel) muss ' +
        'VITE_VAPID_PUBLIC_KEY stehen.',
    }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    /*
     * Auf dem iPhone ist das der Normalfall im Safari-Tab: Web Push gibt es dort
     * nur in der installierten App. Der Hinweis nennt deshalb den Weg und nicht
     * die Ursache.
     */
    return {
      ok: false,
      reason:
        'Dieser Browser kann keine Benachrichtigungen. Auf dem iPhone geht es nur, wenn die App ' +
        'über „Teilen → Zum Home-Bildschirm" hinzugefügt wurde – dann diesen Bereich noch einmal ' +
        'aus der installierten App öffnen.',
    }
  }

  if (!('Notification' in window)) {
    return { ok: false, reason: 'Dieser Browser kann keine Benachrichtigungen anzeigen.' }
  }

  return { ok: true }
}

/** Was der Browser gerade über die Berechtigung sagt. */
export function pushPermission(): NotificationPermission | 'unavailable' {
  if (!('Notification' in window)) return 'unavailable'
  return Notification.permission
}

/**
 * Der Service Worker.
 *
 * Er wird **erst hier** angemeldet und nicht beim Start der App: Solange
 * niemand Benachrichtigungen will, gibt es auch nichts zu tun — und ein Service
 * Worker, der ohne Aufgabe registriert wird, ist eine zusätzliche Schicht
 * zwischen App und Netz, die man erklären müsste.
 */
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

/** Base64url → Bytes. So erwartet `PushManager` den Schlüssel. */
function decodeKey(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function keyToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Berechtigung erfragen, Abo erzeugen, in der Datenbank ablegen.
 *
 * **Die Berechtigung wird erst hier erfragt und nicht beim Start.** Ein Dialog,
 * der ohne Zusammenhang aufpoppt, wird weggetippt — und danach ist er auf iOS
 * dauerhaft weg. Er erscheint deshalb nur, wenn jemand den Schalter umlegt.
 *
 * Wirft mit fertigem deutschem Satz.
 */
export async function enablePush(householdId: string): Promise<void> {
  const support = pushSupport()
  if (!support.ok) throw new Error(support.reason)

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Benachrichtigungen sind für diese App abgelehnt. Das lässt sich nur in den ' +
          'Einstellungen des Geräts wieder ändern (Einstellungen → Receipt AI → Mitteilungen).'
        : 'Die Berechtigung wurde nicht erteilt.',
    )
  }

  const worker = await registration()

  /*
   * Ein vorhandenes Abo wird weiterverwendet. Es zweimal zu erzeugen ginge zwar,
   * hinterließe aber zwei Adressen für dasselbe Gerät — und damit zwei Meldungen
   * je Monat.
   */
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({
      // Ohne diese Angabe lehnen alle Browser ab: Ein Push, der keine Meldung
      // erzeugt, gilt als Missbrauch.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(vapidPublicKey) as BufferSource,
    }))

  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh ?? keyToBase64Url(subscription.getKey('p256dh'))
  const auth = json.keys?.auth ?? keyToBase64Url(subscription.getKey('auth'))

  if (!p256dh || !auth) {
    throw new Error('Das Abo ist unvollständig. Bitte die App schließen und noch einmal öffnen.')
  }

  const { data } = await supabase.auth.getUser()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      household_id: householdId,
      user_id: data.user?.id ?? null,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      // Ein wiederbelebtes Abo hatte vielleicht einen Fehlschlag stehen.
      failed_at: null,
      fail_reason: null,
    },
    { onConflict: 'endpoint' },
  )

  if (error) {
    throw new Error(
      'Das Abo konnte nicht gespeichert werden. Fehlt noch die Migration ' +
        'supabase/migrations/0011_monatsreport.sql?',
    )
  }
}

/**
 * Abmelden.
 *
 * Beides: das Abo im Browser beenden **und** die Zeile in der Datenbank
 * entfernen. Nur eines von beidem hinterließe entweder eine Adresse, an die
 * niemand mehr horcht, oder ein Gerät, das weiter Meldungen bekommt.
 */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  const worker = await navigator.serviceWorker.getRegistration('/')
  const subscription = await worker?.pushManager.getSubscription()

  if (subscription) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
    await subscription.unsubscribe()
  }
}

/** Hat **dieses** Gerät ein Abo? */
export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  const worker = await navigator.serviceWorker.getRegistration('/')
  return Boolean(await worker?.pushManager.getSubscription())
}
