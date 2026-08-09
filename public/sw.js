/*
 * Der Service Worker.
 *
 * Er speichert **nichts** zwischen und fängt **keine** Anfragen ab. Das ist
 * Absicht: Ein Cache würde bedeuten, dass nach einem Ausrollen die alte App
 * weiterläuft, bis jemand sie von Hand aktualisiert — und der Nutzer testet
 * ausschließlich in der laufenden App (PROJEKT.md). Eine App, die nach jeder
 * Änderung erst einmal die vorige Fassung zeigt, wäre der teuerste denkbare
 * Preis für Offline-Fähigkeit, die hier niemand braucht: Ohne Netz gibt es
 * weder Bons noch Auswertungen.
 *
 * Warum es ihn dann überhaupt gibt: Er gehört zur PWA. iOS und Android führen
 * eine Anwendung erst dann als eigenständig installierbar, wenn Manifest **und**
 * Service Worker da sind, und er ist die Stelle, an der später einmal etwas
 * hineinkäme, das wirklich im Hintergrund laufen muss.
 *
 * Die beiden Ereignisse unten sind alles, was er tut — und sie sorgen nur dafür,
 * dass er sich selbst nicht im Weg steht.
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
