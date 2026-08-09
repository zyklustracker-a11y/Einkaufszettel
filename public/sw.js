/*
 * Der Service Worker — nur für Benachrichtigungen.
 *
 * Er speichert **nichts** zwischen und fängt **keine** Anfragen ab. Das ist
 * Absicht: Ein Cache würde bedeuten, dass nach einem Ausrollen die alte App
 * weiterläuft, bis jemand sie von Hand aktualisiert — und der Nutzer testet
 * ausschließlich in der laufenden App (PROJEKT.md). Eine App, die nach jeder
 * Änderung erst einmal die vorige Fassung zeigt, wäre der teuerste denkbare
 * Preis für Offline-Fähigkeit, die hier niemand braucht: Ohne Netz gibt es
 * weder Bons noch Auswertungen.
 *
 * Übrig bleiben zwei Ereignisse, und für die braucht es einen Service Worker
 * zwingend — anders lässt eine Web-Push-Meldung sich nicht empfangen.
 *
 * Diese Datei liegt bewusst in `public/` und wird von Vite unverändert
 * durchgereicht: Sie muss unter `/sw.js` erreichbar sein, damit ihr
 * Geltungsbereich die ganze App umfasst.
 */

/**
 * Sofort übernehmen statt auf das Schließen aller Tabs zu warten.
 *
 * Ohne das bliebe nach einem Ausrollen die alte Fassung aktiv, bis der Nutzer
 * die App vollständig beendet — und auf einem iPhone passiert das selten.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/**
 * Eine eingetroffene Push-Nachricht anzeigen.
 *
 * Der Inhalt ist Ende-zu-Ende verschlüsselt angekommen; entschlüsselt hat ihn
 * der Browser. Was hier steht, ist genau das, was
 * `supabase/functions/monatsreport/report.ts` gebaut hat.
 *
 * **Anzeigen ist Pflicht, nicht Kür.** Ein Push, der keine Meldung erzeugt,
 * gilt bei den Browsern als Missbrauch und kostet die Berechtigung. Deshalb
 * steht auch für eine unlesbare Nachricht ein Ersatztext bereit, statt sie
 * stillschweigend zu verwerfen.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'Receipt AI', body: 'Dein Monatsreport ist da.', url: '/analysen' }

  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    // Unlesbarer Inhalt: Es bleibt beim Ersatztext.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Ein Kennzeichen, damit zwei Reports desselben Monats einander ersetzen
      // statt sich zu stapeln.
      tag: 'monatsreport',
      data: { url: payload.url },
    }),
  )
})

/**
 * Ein Tipp auf die Meldung führt in die App.
 *
 * Läuft sie schon, wird das vorhandene Fenster nach vorn geholt statt ein
 * zweites geöffnet — sonst hätte man die App danach doppelt.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
