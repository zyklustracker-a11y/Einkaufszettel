/**
 * Edge Function „erkennen" — zwei Durchgänge über eine Adresse.
 *
 * Sie ist der einzige Ort, an dem der Mistral-Schlüssel liegt (PROJEKT.md).
 * Er steht als Secret `MISTRAL_API_KEY` in der Supabase-Projektkonfiguration
 * und taucht weder im Browser noch im Repository auf.
 *
 * ---------------------------------------------------------------------------
 * DURCHGANG 1 — STRUKTUR.  Anfrage mit `image`.
 * ---------------------------------------------------------------------------
 *
 *   1. Anmeldung prüfen. Ohne gültiges Token endet hier alles — sonst könnte
 *      jeder Fremde das freie Kontingent verbrauchen.
 *   2. Bild an Mistral, mit dem *statischen* Struktur-Prompt: nur abschreiben,
 *      keine Namen, keine Kategorien. Daneben, gleichzeitig, die gelernten
 *      Zuordnungen des Haushalts laden.
 *   3. Antwort prüfen und umrechnen (`validate.ts`).
 *   4. Bekannte Rohtexte aus der Datenbank auflösen (`mappings.ts`).
 *   5. Ergebnis zurückgeben — mit `offeneRohtexte`: die Artikel, für die es noch
 *      keine Zuordnung gibt. Ist die Liste leer, ist der Scan fertig.
 *
 * ---------------------------------------------------------------------------
 * DURCHGANG 2 — ZUORDNUNG.  Anfrage mit `rohtexte`, ohne Bild.
 * ---------------------------------------------------------------------------
 *
 *   1. Anmeldung prüfen (wie oben).
 *   2. Aktive Merkmale und Kategorien des Haushalts laden und daraus den
 *      Zuordnungs-Prompt bauen.
 *   3. Textaufruf bei Mistral — ohne Bild, deshalb schnell und billig.
 *   4. Antwort prüfen (`assign.ts`) und die Zuordnungen zurückgeben.
 *
 * **Warum zwei Aufrufe und nicht einer, der beides macht?** Weil der Browser
 * sonst nicht sehen könnte, wo er steht: Der Fortschrittsbalken soll nichts
 * behaupten, was er nicht beobachtet (PROJEKT.md). Und weil ein Ausfall von
 * Durchgang 2 dann den ganzen Bon mitrisse — so hält der Browser das Ergebnis
 * von Durchgang 1 bereits in der Hand und kann den Korrektur-Screen auch ohne
 * Zuordnung zeigen. Der teure Teil ist ja geschafft.
 *
 * **Gespeichert wird hier nichts.** Geschrieben wird erst beim „Speichern" im
 * Korrektur-Screen, und zwar über die Datenbankfunktion `save_receipt` — in
 * einer Transaktion, damit kein halber Bon zurückbleiben kann. Diese Funktion
 * liest nur.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  STRUCTURE_SYSTEM_PROMPT,
  STRUCTURE_USER_PROMPT,
  buildAssignmentPrompt,
  buildAssignmentUserPrompt,
} from './prompt.ts'
import { DEFAULT_TEXT_MODEL, callMistral } from './mistral.ts'
import type { MistralFailure } from './mistral.ts'
import { isUnreadable, parseModelJson, validateExtraction } from './validate.ts'
import type {
  ExtractedSuggestion,
  Extraction,
  MilkHeat,
  MilkHomogenized,
} from './validate.ts'
import { applyKnownProducts, mappingKey } from './mappings.ts'
import type { KnownProducts } from './mappings.ts'
import { validateAssignments } from './assign.ts'

/* -------------------------------------------------- Was die Funktion liefert */

/** Die Antwort auf Durchgang 1. Steht wortgleich in `src/lib/extraction.ts`. */
interface StructureResponse {
  extraction: Extraction
  /** Das benutzte Modell, für den Aufklappbereich im Korrektur-Screen. */
  model: string
  /** Dauer des Modell-Aufrufs in Millisekunden. */
  durationMs: number
  /** Die unverarbeitete Antwort des Modells — Grundlage zum Nachschärfen. */
  raw: string
  /**
   * Rohtexte ohne Zuordnung — genau das, was Durchgang 2 braucht. Leer heißt:
   * Der Haushalt kennt jeden Artikel auf diesem Bon, es ist nichts mehr zu tun.
   */
  offeneRohtexte: string[]
}

/** Eine geprüfte Zuordnung, wie Durchgang 2 sie zurückgibt. */
interface AssignmentRow extends ExtractedSuggestion {
  /** Der Rohtext, zu dem sie gehört — daran setzt der Browser sie ein. */
  rawText: string
}

/** Die Antwort auf Durchgang 2. Steht wortgleich in `src/lib/extraction.ts`. */
interface AssignmentResponse {
  assignments: AssignmentRow[]
  /** Warnungen aus der Prüfung, etwa verworfene Merkmale. */
  warnings: Extraction['warnings']
  model: string
  durationMs: number
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
  | 'modell_abgelehnt'
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

/**
 * Höchstzahl der Rohtexte je Zuordnungs-Anfrage.
 *
 * Ein langer Bon hat vierzig Positionen; hundert sind reichlich Luft und
 * verhindern trotzdem, dass jemand die Adresse als Textgenerator benutzt.
 */
const MAX_RAW_TEXTS = 100

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

/** Aus einem Fehlschlag beim Modell wird eine Antwort für den Nutzer. */
function failFromMistral(reason: MistralFailure, model: string, detail: string): Response {
  /*
   * Der Unterschied, der beim Suchen Stunden spart: Eine abgelehnte Anfrage ist
   * keine Störung bei Mistral, sondern fast immer ein Modellname im Secret, den
   * es nicht gibt oder den der eigene Tarif nicht freigibt. Deshalb stehen hier
   * der benutzte Name und der Wortlaut der Schnittstelle in der Meldung — sonst
   * sucht der Nutzer den Fehler bei Mistral statt in seiner Einrichtung.
   */
  if (reason === 'modell_abgelehnt') {
    return fail(
      'modell_abgelehnt',
      `Mistral hat die Anfrage abgelehnt. Benutztes Modell: „${model}". Antwort der ` +
        `Schnittstelle: ${detail} — wenn du MISTRAL_MODEL oder MISTRAL_TEXT_MODEL gesetzt hast, ` +
        'prüfe den Namen oder entferne das Secret wieder.',
      502,
    )
  }
  if (reason === 'kontingent') {
    return fail(
      'kontingent',
      'Das Kontingent bei Mistral ist gerade erschöpft. Bitte in ein paar Minuten noch einmal versuchen.',
      429,
    )
  }
  if (reason === 'zeitueberschreitung') {
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
 * Fehlers.** Der Scan soll daran nicht scheitern: Ohne Gedächtnis liefert
 * Durchgang 2 eben wieder einen Vorschlag, und der Nutzer korrigiert ihn.
 * Markieren statt ablehnen gilt auch hier.
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

/** Die aktiven Merkmale und die Kategorien — die Zutaten des Zuordnungs-Prompts. */
async function loadPromptContext(supabase: Client, householdId: string) {
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

  if (traitResult.error || categoryResult.error) return null

  return {
    traits: (traitResult.data ?? []) as Array<{ key: string; description: string }>,
    categories: (categoryResult.data ?? []) as Array<{ key: string; name: string }>,
  }
}

interface RequestBody {
  /** Das JPEG als Base64, ohne den `data:`-Vorspann. Durchgang 1. */
  image?: unknown
  /** Standardmäßig `image/jpeg`; der Kamera-Screen liefert nichts anderes. */
  mimeType?: unknown
  /** Die zuzuordnenden Rohtexte. Ihre Anwesenheit macht daraus Durchgang 2. */
  rohtexte?: unknown
}

/* ================================================================= Durchgang 1 */

async function handleStructure(
  supabase: Client,
  householdId: string,
  apiKey: string,
  image: string,
  mimeType: string,
): Promise<Response> {
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
    // Statisch: Struktur hat mit den Merkmalen des Haushalts nichts zu tun.
    systemPrompt: STRUCTURE_SYSTEM_PROMPT,
    userPrompt: STRUCTURE_USER_PROMPT,
    imageDataUrl: `data:${mimeType};base64,${image}`,
  })

  if (!outcome.ok) {
    // `detail` ist die technische Ursache. Sie geht ins Funktions-Protokoll,
    // aber nie in die Oberfläche.
    console.error('Mistral (Struktur):', outcome.reason, outcome.detail)
    return failFromMistral(outcome.reason, outcome.model, outcome.detail)
  }

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

  // Ein Rohtext, den der Haushalt schon kennt, übernimmt Name, Kategorie und
  // Merkmale aus der Datenbank (PROJEKT.md, Kernprinzip).
  const extraction = applyKnownProducts(validateExtraction(parsed), await knownProducts)

  /*
   * Was jetzt noch offen ist, geht in Durchgang 2. Doppelte Rohtexte werden
   * zusammengefasst — derselbe Artikel zweimal auf dem Bon braucht keine zwei
   * Zuordnungen und würde das Modell nur zum Erfinden von Unterschieden
   * verleiten.
   */
  const seen = new Set<string>()
  const offeneRohtexte: string[] = []
  for (const item of extraction.items) {
    if (item.kind !== 'artikel' || item.suggestion !== null) continue
    const key = mappingKey(item.rawText)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    offeneRohtexte.push(item.rawText)
  }

  const response: StructureResponse = {
    extraction,
    model: outcome.model,
    durationMs: outcome.durationMs,
    raw: outcome.text,
    offeneRohtexte,
  }

  return json(response, 200)
}

/* ================================================================= Durchgang 2 */

async function handleAssignment(
  supabase: Client,
  householdId: string,
  apiKey: string,
  rawTexts: string[],
): Promise<Response> {
  const context = await loadPromptContext(supabase, householdId)
  if (context === null) {
    return fail(
      'unbekannt',
      'Die Merkmale des Haushalts konnten nicht geladen werden. Bitte später noch einmal versuchen.',
      500,
    )
  }
  if (context.categories.length === 0) {
    return fail('kein_haushalt', 'Für diesen Haushalt sind noch keine Kategorien angelegt.', 500)
  }

  const outcome = await callMistral({
    apiKey,
    // Reine Textarbeit — dafür braucht es kein Vision-Modell.
    model: Deno.env.get('MISTRAL_TEXT_MODEL') ?? DEFAULT_TEXT_MODEL,
    systemPrompt: buildAssignmentPrompt(context),
    userPrompt: buildAssignmentUserPrompt(rawTexts),
  })

  if (!outcome.ok) {
    console.error('Mistral (Zuordnung):', outcome.reason, outcome.detail)
    return failFromMistral(outcome.reason, outcome.model, outcome.detail)
  }

  const result = validateAssignments(outcome.text, {
    categoryKeys: context.categories.map((category) => category.key),
    traitKeys: context.traits.map((trait) => trait.key),
    rawTexts,
  })

  /*
   * Zurück geht der Rohtext in der Schreibweise, nach der gefragt wurde — nicht
   * die des Modells. Der Browser setzt die Zuordnung darüber ein, und eine
   * stillschweigend „verbesserte" Schreibweise fände dort keine Zeile mehr.
   */
  const assignments: AssignmentRow[] = []
  for (const rawText of rawTexts) {
    const suggestion = result.byRawText.get(mappingKey(rawText))
    if (suggestion) assignments.push({ ...suggestion, rawText })
  }

  const response: AssignmentResponse = {
    assignments,
    warnings: result.warnings,
    model: outcome.model,
    durationMs: outcome.durationMs,
    raw: outcome.text,
  }

  return json(response, 200)
}

/* ===================================================================== Einstieg */

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
   * unten dieselben Zugriffsregeln wie in der App: Die Funktion sieht genau den
   * Haushalt, zu dem der Anrufer gehört, und keinen fremden.
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

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle()

  const householdId = (membership as { household_id?: string } | null)?.household_id
  if (!householdId) {
    return fail('kein_haushalt', 'Zu diesem Konto gehört noch kein Haushalt.', 403)
  }

  const apiKey = Deno.env.get('MISTRAL_API_KEY')
  if (!apiKey) {
    return fail(
      'kein_schluessel',
      'Die Bon-Erkennung ist noch nicht eingerichtet: In Supabase fehlt das Secret MISTRAL_API_KEY.',
      500,
    )
  }

  /* ------------------------------------------------ 2. Welcher Durchgang? */

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return fail('kein_bild', 'Die Anfrage war unvollständig. Bitte noch einmal scannen.', 400)
  }

  // Rohtexte statt Bild: Das ist die Zuordnung.
  if (Array.isArray(body.rohtexte)) {
    const rawTexts = body.rohtexte
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, MAX_RAW_TEXTS)

    if (rawTexts.length === 0) {
      return fail('kein_bild', 'Es wurden keine Texte zum Zuordnen mitgeschickt.', 400)
    }

    return await handleAssignment(supabase, householdId, apiKey, rawTexts)
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

  return await handleStructure(supabase, householdId, apiKey, image, mimeType)
})
