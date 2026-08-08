/**
 * Edge Function „erkennen" — Bild rein, geprüfte Bon-Daten raus.
 *
 * Sie ist der einzige Ort, an dem der Mistral-Schlüssel liegt (PROJEKT.md).
 * Er steht als Secret `MISTRAL_API_KEY` in der Supabase-Projektkonfiguration
 * und taucht weder im Browser noch im Repository auf.
 *
 * Ablauf, in dieser Reihenfolge:
 *
 *   1. Anmeldung prüfen. Ohne gültiges Token endet hier alles — sonst könnte
 *      jeder Fremde das freie Kontingent verbrauchen.
 *   2. Haushalt, aktive Merkmale und Kategorien laden. Das passiert mit dem
 *      Token des Nutzers, also unter denselben Zugriffsregeln wie in der App.
 *      Ein Dienstschlüssel wird bewusst nirgends benutzt.
 *   3. Prompt aus diesen Merkmalen zusammenbauen (prompt.ts).
 *   4. Mistral aufrufen (mistral.ts) — mit Zeitlimit und Backoff bei 429.
 *      Daneben, gleichzeitig: die gelernten Zuordnungen des Haushalts laden.
 *   5. Antwort prüfen und umrechnen (validate.ts).
 *   6. Bekannte Rohtexte aus der Datenbank auflösen (mappings.ts). Was der
 *      Haushalt schon weiß, schlägt den Vorschlag des Modells.
 *   7. Ergebnis samt Rohantwort zurückgeben.
 *
 * **Gespeichert wird hier nichts.** Geschrieben wird erst beim „Speichern" im
 * Korrektur-Screen, und zwar über die Datenbankfunktion `save_receipt` — in
 * einer Transaktion, damit kein halber Bon zurückbleiben kann. Diese Funktion
 * liest nur.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildSystemPrompt, USER_PROMPT } from './prompt.ts'
import { callMistral } from './mistral.ts'
import { isUnreadable, parseModelJson, validateExtraction } from './validate.ts'
import type { Extraction, MilkHeat, MilkHomogenized } from './validate.ts'
import { applyKnownProducts, mappingKey } from './mappings.ts'
import type { KnownProducts } from './mappings.ts'

/* -------------------------------------------------- Was die Funktion liefert */

/** Der Erfolgsfall. Steht wortgleich in `src/lib/extraction.ts`. */
interface ExtractionResponse {
  extraction: Extraction
  /** Das benutzte Modell, für den Aufklappbereich im Korrektur-Screen. */
  model: string
  /** Dauer des Modell-Aufrufs in Millisekunden. */
  durationMs: number
  /** Die unverarbeitete Antwort des Modells — Grundlage zum Nachschärfen. */
  raw: string
}

/**
 * Warum es nicht geklappt hat. Der Code ist für die App, der Text für den
 * Nutzer — technische Meldungen erreichen die Oberfläche nie.
 */
type ExtractionErrorCode =
  | 'nicht_angemeldet'
  | 'kein_haushalt'
  | 'kein_bild'
  | 'bild_zu_gross'
  | 'kein_schluessel'
  | 'kontingent'
  | 'zeitueberschreitung'
  | 'modell_fehler'
  | 'modell_json'
  | 'bild_unlesbar'
  | 'unbekannt'

interface ErrorBody {
  code: ExtractionErrorCode
  /** Bereits auf Deutsch und direkt anzeigbar. */
  message: string
  /** Die Rohantwort, falls es eine gab — hilft beim Nachschärfen des Prompts. */
  raw?: string
}

/**
 * Die App läuft auf einer anderen Adresse als die Funktion, deshalb braucht der
 * Browser diese Kopfzeilen — sonst blockt er die Antwort, bevor die App sie
 * sieht. `*` ist hier vertretbar: Ohne gültiges Anmelde-Token kommt niemand
 * über Schritt 1 hinaus, egal von welcher Adresse aus.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Obergrenze für das Bild, gemessen an der Base64-Länge.
 *
 * Ein Bon-Foto mit 2000 px langer Kante und Qualität 0,8 liegt bei 300–700 KB,
 * base64 also bei rund 1 MB. 8 MB lassen reichlich Luft und verhindern
 * trotzdem, dass ein versehentlich unverkleinertes Bild die Funktion sprengt.
 */
const MAX_IMAGE_CHARS = 8 * 1024 * 1024

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function fail(code: ExtractionErrorCode, message: string, status: number, raw?: string): Response {
  const body: ErrorBody = raw === undefined ? { code, message } : { code, message, raw }
  return json(body, status)
}

/* --------------------------------------------- Was der Haushalt schon weiß */

/** So wenig wie möglich: nur, was ein Vorschlag braucht. */
type Client = ReturnType<typeof createClient>

/**
 * Die gelernten Zuordnungen des Haushalts, fertig zum Nachschlagen.
 *
 * Vier flache Abfragen statt eines verschachtelten Selects — aus demselben
 * Grund wie in `src/data/queries.ts`: Die Beziehungen hängen an
 * zusammengesetzten Fremdschlüsseln, denen PostgREST nicht zuverlässig folgt.
 * Für einen Familienhaushalt sind das ein paar hundert Zeilen.
 *
 * **Schlägt eine Abfrage fehl, kommt eine leere Karte zurück statt eines
 * Fehlers.** Der Scan soll daran nicht scheitern: Ohne Gedächtnis liefert das
 * Modell eben wieder einen Vorschlag, und der Nutzer korrigiert ihn. Markieren
 * statt ablehnen gilt auch hier.
 */
async function loadKnownProducts(supabase: Client, householdId: string): Promise<KnownProducts> {
  const known: KnownProducts = new Map()

  const [mappings, products, links, traits] = await Promise.all([
    supabase
      .from('product_mappings')
      .select('raw_text, canonical_product_id')
      .eq('household_id', householdId),
    supabase
      .from('canonical_products')
      .select('id, name, category_key, milk_heat, milk_homogenized')
      .eq('household_id', householdId),
    supabase
      .from('canonical_product_traits')
      .select('canonical_product_id, trait_id')
      .eq('household_id', householdId),
    supabase.from('traits').select('id, key').eq('household_id', householdId),
  ])

  if (mappings.error || products.error || links.error || traits.error) {
    console.error('Zuordnungen konnten nicht geladen werden:', mappings.error ?? products.error)
    return known
  }

  const traitKeyById = new Map(
    (traits.data ?? []).map((row) => [String(row.id), String(row.key)]),
  )

  const traitKeysByProduct = new Map<string, string[]>()
  for (const link of links.data ?? []) {
    const key = traitKeyById.get(String(link.trait_id))
    if (!key) continue
    const list = traitKeysByProduct.get(String(link.canonical_product_id)) ?? []
    list.push(key)
    traitKeysByProduct.set(String(link.canonical_product_id), list)
  }

  const productById = new Map(
    (products.data ?? []).map((row) => [
      String(row.id),
      {
        canonicalProductId: String(row.id),
        name: String(row.name),
        categoryKey: String(row.category_key),
        traitKeys: traitKeysByProduct.get(String(row.id)) ?? [],
        milkHeat: String(row.milk_heat) as MilkHeat,
        milkHomogenized: String(row.milk_homogenized) as MilkHomogenized,
      },
    ]),
  )

  for (const mapping of mappings.data ?? []) {
    const product = productById.get(String(mapping.canonical_product_id))
    if (!product) continue
    known.set(mappingKey(String(mapping.raw_text)), product)
  }

  return known
}

interface RequestBody {
  /** Das JPEG als Base64, ohne den `data:`-Vorspann. */
  image?: unknown
  /** Standardmäßig `image/jpeg`; der Kamera-Screen liefert nichts anderes. */
  mimeType?: unknown
}

Deno.serve(async (request: Request): Promise<Response> => {
  // Der Vorab-Anruf des Browsers. Er trägt nie ein Token und darf deshalb auch
  // keines brauchen.
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (request.method !== 'POST') {
    return fail('unbekannt', 'Diese Adresse nimmt nur POST-Anfragen entgegen.', 405)
  }

  /* ------------------------------------------------------ 1. Anmeldung */

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return fail('nicht_angemeldet', 'Bitte melde dich an, um Bons zu scannen.', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return fail('unbekannt', 'Die Funktion ist nicht vollständig eingerichtet.', 500)
  }

  /*
   * Der Client bekommt das Token des Nutzers mit. Damit gelten für jede Abfrage
   * unten dieselben Zugriffsregeln wie in der App: Die Funktion sieht genau die
   * Merkmale des Haushalts, zu dem der Anrufer gehört, und keine fremden.
   */
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return fail(
      'nicht_angemeldet',
      'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an und versuch es noch einmal.',
      401,
    )
  }

  /* ------------------------------------------- 2. Merkmale und Kategorien */

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle()

  const householdId = (membership as { household_id?: string } | null)?.household_id
  if (!householdId) {
    return fail('kein_haushalt', 'Zu diesem Konto gehört noch kein Haushalt.', 403)
  }

  const [traitResult, categoryResult] = await Promise.all([
    supabase
      .from('traits')
      .select('key, description')
      .eq('household_id', householdId)
      // Nur aktive Merkmale erreichen das Modell. Ein abgeschaltetes Merkmal
      // soll ab dem nächsten Scan nicht mehr vorgeschlagen werden.
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('categories')
      .select('key, name')
      .eq('household_id', householdId)
      .order('sort_order'),
  ])

  if (traitResult.error || categoryResult.error) {
    return fail(
      'unbekannt',
      'Die Merkmale des Haushalts konnten nicht geladen werden. Bitte später noch einmal versuchen.',
      500,
    )
  }

  const traits = (traitResult.data ?? []) as Array<{ key: string; description: string }>
  const categories = (categoryResult.data ?? []) as Array<{ key: string; name: string }>

  if (categories.length === 0) {
    return fail(
      'kein_haushalt',
      'Für diesen Haushalt sind noch keine Kategorien angelegt.',
      500,
    )
  }

  /* ------------------------------------------------------------ 3. Bild */

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return fail('kein_bild', 'Die Anfrage war unvollständig. Bitte noch einmal scannen.', 400)
  }

  const image = typeof body.image === 'string' ? body.image : ''
  if (image.length === 0) {
    return fail('kein_bild', 'Es wurde kein Bild mitgeschickt. Bitte noch einmal scannen.', 400)
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return fail(
      'bild_zu_gross',
      'Das Bild ist zu groß. Bitte den Bon noch einmal mit der Kamera in der App aufnehmen.',
      413,
    )
  }

  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'

  /* --------------------------------------------------------- 4. Mistral */

  const apiKey = Deno.env.get('MISTRAL_API_KEY')
  if (!apiKey) {
    return fail(
      'kein_schluessel',
      'Die Bon-Erkennung ist noch nicht eingerichtet: In Supabase fehlt das Secret MISTRAL_API_KEY.',
      500,
    )
  }

  /*
   * Die gelernten Zuordnungen. Sie werden **vor** dem Modellaufruf angestoßen
   * und erst nach der Prüfung gebraucht — so laufen sie neben den vierzehn
   * Sekunden beim Modell her und kosten keine zusätzliche Wartezeit.
   */
  const knownProducts = loadKnownProducts(supabase, householdId)

  const outcome = await callMistral({
    apiKey,
    // Ohne dieses Secret gilt die Voreinstellung aus mistral.ts.
    model: Deno.env.get('MISTRAL_MODEL') ?? undefined,
    systemPrompt: buildSystemPrompt({ traits, categories }),
    userPrompt: USER_PROMPT,
    imageDataUrl: `data:${mimeType};base64,${image}`,
  })

  if (!outcome.ok) {
    // `detail` ist die technische Ursache. Sie geht ins Funktions-Protokoll,
    // aber nie in die Oberfläche.
    console.error('Mistral:', outcome.reason, outcome.detail)

    if (outcome.reason === 'kontingent') {
      return fail(
        'kontingent',
        'Das Kontingent bei Mistral ist gerade erschöpft. Bitte in ein paar Minuten noch einmal versuchen.',
        429,
      )
    }
    if (outcome.reason === 'zeitueberschreitung') {
      return fail(
        'zeitueberschreitung',
        'Die Erkennung hat zu lange gedauert. Bitte noch einmal versuchen.',
        504,
      )
    }
    return fail(
      'modell_fehler',
      'Die Bon-Erkennung ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
      502,
    )
  }

  /* ------------------------------------------------------- 5. Prüfen */

  const parsed = parseModelJson(outcome.text)
  if (parsed === null) {
    return fail(
      'modell_json',
      'Die Antwort der Erkennung war unbrauchbar. Bitte den Bon noch einmal scannen.',
      502,
      // Die Rohantwort kommt mit: nur an ihr lässt sich sehen, warum es
      // schiefging, und nur so lässt sich der Prompt nachschärfen.
      outcome.text,
    )
  }

  if (isUnreadable(parsed)) {
    return fail(
      'bild_unlesbar',
      'Auf dem Foto war kein lesbarer Kassenzettel zu erkennen. Bitte flach hinlegen, gut ausleuchten und die ganze Länge aufnehmen.',
      422,
      outcome.text,
    )
  }

  const extraction = validateExtraction(parsed, {
    categoryKeys: categories.map((category) => category.key),
    traitKeys: traits.map((trait) => trait.key),
  })

  /* ------------------------------------------------- 6. Bekanntes einsetzen */

  // Ein Rohtext, den der Haushalt schon kennt, übernimmt Name, Kategorie und
  // Merkmale aus der Datenbank — der Vorschlag des Modells wird dafür verworfen
  // (PROJEKT.md, Kernprinzip).
  const resolved = applyKnownProducts(extraction, await knownProducts)

  /* ---------------------------------------------------------- 7. Antwort */

  const response: ExtractionResponse = {
    extraction: resolved,
    model: outcome.model,
    durationMs: outcome.durationMs,
    raw: outcome.text,
  }

  return json(response, 200)
})
