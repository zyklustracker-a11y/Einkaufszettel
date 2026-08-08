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
