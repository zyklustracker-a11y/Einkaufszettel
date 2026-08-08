/// <reference types="vite/client" />

/**
 * Die Umgebungsvariablen der App. Absichtlich `| undefined`: Beim ersten
 * Auschecken existiert noch keine `.env`, und der Code muss das abfangen
 * können, statt sich darauf zu verlassen.
 */
interface ImportMetaEnv {
  /** Projekt-URL aus Supabase → Project Settings → Data API. */
  readonly VITE_SUPABASE_URL: string | undefined
  /** Öffentlicher anon-Key von derselben Seite. Darf im Browser stehen. */
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * Die Taschenlampe der Kamera fehlt in den Standardtypen: Sie gehört zur
 * Image-Capture-Erweiterung von Media Capture, die `lib.dom` nicht abdeckt.
 * Hier nachgetragen, damit der Kamera-Screen ohne `any` auskommt.
 *
 * Die Fähigkeit kommt je nach Browser als `true` oder als Liste der möglichen
 * Werte zurück. Auf iOS meldet WebKit sie derzeit überhaupt nicht und
 * übergeht die Vorgabe (WebKit-Bug 243075) – deshalb wird sie zur Laufzeit
 * geprüft und nicht vorausgesetzt.
 */
interface MediaTrackCapabilities {
  torch?: boolean | boolean[]
}

interface MediaTrackConstraintSet {
  torch?: ConstrainBoolean
}
