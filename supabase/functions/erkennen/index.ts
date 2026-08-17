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
 * **Ein Bon wird hier nicht gespeichert.** Geschrieben wird erst beim
 * „Speichern" im Korrektur-Screen, und zwar über die Datenbankfunktion
 * `save_receipt` — in einer Transaktion, damit kein halber Bon zurückbleiben
 * kann.
 *
 * ---------------------------------------------------------------------------
 * SEIT SCHRITT 6: DAS ERGEBNIS LANDET AUCH IM JOB
 * ---------------------------------------------------------------------------
 *
 * Schickt die App eine `jobId` mit, schreibt Durchgang 1 sein Ergebnis
 * zusätzlich in `scan_jobs`. Der Grund steht im Kopf von
 * `supabase/migrations/0005_hintergrund.sql`: Wechselt der Nutzer während des
 * Scans die App, friert Safari die Seite ein, und die Antwort kommt nirgends an
 * — obwohl sie fertig war. Über den Job holt die App sie beim Zurückkommen ab.
 *
 * **Das Bild wird dabei nicht abgelegt**, nur das Erkannte. Und ein Fehlschlag
 * beim Schreiben reißt den Scan nicht mit: Der Job ist ein Rettungsweg, kein
 * Bestandteil der Erkennung.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  STRUCTURE_JSON_SCHEMA,
  STRUCTURE_SYSTEM_PROMPT,
  STRUCTURE_TILED_USER_PROMPT,
  STRUCTURE_USER_PROMPT,
  buildAssignmentPrompt,
  buildAssignmentUserPrompt,
} from './prompt.ts'
import { DEFAULT_TEXT_MODEL, callMistral } from './mistral.ts'
import type { MistralFailure } from './mistral.ts'
import { isTruncated, logModelResponse, tail } from './debug.ts'
import { isUnreadable, recoverModelJson, validateExtraction } from './validate.ts'
import type {
  ExtractedSuggestion,
  Extraction,
  MilkHeat,
  MilkHomogenized,
} from './validate.ts'
import { applyKnownProducts, mappingKey } from './mappings.ts'
import type { KnownProducts } from './mappings.ts'
import { validateAssignments } from './assign.ts'
import { resolveExchangeRate } from './rates.ts'
import type { EcbObservation, ExchangeRate, RateStore } from './rates.ts'

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
  /**
   * Die gespeicherte Art dieses Händlers — `retail` oder `gastro`.
   *
   * **Nachgeschlagen, nicht geraten.** Der Händlername aus dem Bonkopf wird über
   * `merchant_key()` in `merchants` gesucht; ist er bekannt, kommt seine Art
   * zurück. Sonst `retail`.
   *
   * Das Konzept sieht vor, dass „das Modell die Art vorschlägt". Genau das
   * passiert hier bewusst NICHT: Durchgang 1 ist seit Schritt 4d ein reiner
   * Abschreiber, und jede zusätzliche Deutungsaufgabe konkurriert mit dem
   * Abtippen — daran ist der Prompt schon zweimal gescheitert (PROJEKT.md, 4c
   * und 4d). Der Nutzer tippt bei einem neuen Restaurant einmal auf „Gastro";
   * ab dem nächsten Bon desselben Ladens steht es von selbst da. Damit ist die
   * Zusicherung des Konzepts („einmal gesetzt, gilt für alle künftigen Bons")
   * erfüllt, ohne den empfindlichsten Teil der Erkennung anzufassen.
   */
  merchantKind: 'retail' | 'gastro'
  /**
   * Der EZB-Kurs zum Bon-Datum — nur bei einem Bon in Fremdwährung, sonst null.
   * Bei einem Euro-Bon, dem Normalfall, wird gar nichts abgerufen.
   */
  exchangeRate: ExchangeRate | null
  /**
   * Warum kein Kurs da ist, als fertiger deutscher Satz. Null heißt: Es gab
   * nichts zu holen (Euro-Bon) oder es hat geklappt.
   *
   * **Ein Fehlschlag reißt den Scan nicht mit.** Der Korrektur-Screen zeigt dann
   * ein Kursfeld für diesen einen Bon — markieren statt ablehnen, wie überall.
   */
  rateError: string | null
}

/** Die Antwort auf eine reine Kursanfrage (weder Bild noch Rohtexte). */
interface RateResponse {
  exchangeRate: ExchangeRate | null
  rateError: string | null
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

/**
 * Aus einem Fehlschlag beim Modell wird das, was der Nutzer zu lesen bekommt.
 *
 * Bewusst ein Wertepaar und keine fertige `Response`: Seit Schritt 6 muss
 * derselbe Grund an zwei Stellen landen — in der Antwort **und** im Scan-Job.
 * Zweimal formuliert wären das zwei Texte, die auseinanderlaufen.
 */
function mistralFailure(
  reason: MistralFailure,
  model: string,
  detail: string,
): { code: ExtractionErrorCode; message: string; status: number } {
  /*
   * Der Unterschied, der beim Suchen Stunden spart: Eine abgelehnte Anfrage ist
   * keine Störung bei Mistral, sondern fast immer ein Modellname im Secret, den
   * es nicht gibt oder den der eigene Tarif nicht freigibt. Deshalb stehen hier
   * der benutzte Name und der Wortlaut der Schnittstelle in der Meldung — sonst
   * sucht der Nutzer den Fehler bei Mistral statt in seiner Einrichtung.
   */
  if (reason === 'modell_abgelehnt') {
    return {
      code: 'modell_abgelehnt',
      message:
        `Die Bon-Erkennung hat die Anfrage abgelehnt. Benutztes Modell: „${model}". Antwort der ` +
        `Schnittstelle: ${detail} — wenn du MISTRAL_MODEL oder MISTRAL_TEXT_MODEL gesetzt hast, ` +
        'prüfe den Namen oder entferne das Secret wieder.',
      status: 502,
    }
  }
  if (reason === 'kontingent') {
    return {
      code: 'kontingent',
      message:
        'Das Kontingent für die Bon-Erkennung ist gerade erschöpft. Bitte in ein paar Minuten ' +
        'noch einmal versuchen.',
      status: 429,
    }
  }
  if (reason === 'zeitueberschreitung') {
    return {
      code: 'zeitueberschreitung',
      message: 'Die Erkennung hat zu lange gedauert. Bitte noch einmal versuchen.',
      status: 504,
    }
  }
  return {
    code: 'modell_fehler',
    message: 'Die Bon-Erkennung ist gerade nicht erreichbar. Bitte später noch einmal versuchen.',
    status: 502,
  }
}

/** Derselbe Grund als fertige Antwort — für Durchgang 2, der keinen Job kennt. */
function failFromMistral(reason: MistralFailure, model: string, detail: string): Response {
  const failure = mistralFailure(reason, model, detail)
  return fail(failure.code, failure.message, failure.status)
}

/* ------------------------------------------------------- Der Scan-Job */

/** So wenig wie möglich: nur, was ein Vorschlag braucht. */
type Client = ReturnType<typeof createClient>

/**
 * Das Ergebnis von Durchgang 1 in den Job schreiben.
 *
 * **Schlägt das fehl, passiert nichts weiter.** Der Job ist der Rettungsweg für
 * den Fall, dass die Antwort nirgends ankommt; er ist nicht Teil der Erkennung.
 * Eine Ausnahme an dieser Stelle würde einen fertig gelesenen Bon verwerfen, um
 * einen Zwischenspeicher zu retten — genau verkehrt herum.
 */
async function finishJob(
  supabase: Client,
  jobId: string | null,
  result: StructureResponse,
): Promise<void> {
  if (!jobId) return
  const { error } = await supabase
    .from('scan_jobs')
    .update({ status: 'done', result, finished_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'running')
  if (error) console.error('Scan-Job konnte nicht abgeschlossen werden:', error.message)
}

/**
 * Den Job als gescheitert vermerken — mit demselben Code und demselben deutschen
 * Satz, den auch die Antwort trägt.
 *
 * Ohne das stünde ein abgebrochener Scan für immer auf `running`, und die App
 * fragte beim Zurückkommen nach einem Ergebnis, das es nie geben wird.
 */
async function failJob(
  supabase: Client,
  jobId: string | null,
  code: ExtractionErrorCode,
  message: string,
): Promise<void> {
  if (!jobId) return
  const { error } = await supabase
    .from('scan_jobs')
    .update({
      status: 'failed',
      error_code: code,
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'running')
  if (error) console.error('Scan-Job konnte nicht als fehlgeschlagen vermerkt werden:', error.message)
}

/* --------------------------------------------- Was der Haushalt schon weiß */

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

/** Die aktiven Merkmale und Kategorien — die Zutaten des Zuordnungs-Prompts. */
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
      // `description` seit Schritt 5: Sie sagt dem Modell, was in die Kategorie
      // gehört und was nicht. Damit wirkt eine selbst angelegte Kategorie ab
      // dem nächsten Scan — ohne Codeänderung, ohne Ausrollen.
      .select('key, name, description')
      .eq('household_id', householdId)
      // Und nur die aktiven, aus demselben Grund wie bei den Merkmalen.
      .eq('active', true)
      .order('sort_order'),
  ])

  if (traitResult.error || categoryResult.error) return null

  return {
    traits: (traitResult.data ?? []) as Array<{ key: string; description: string }>,
    categories: (categoryResult.data ?? []).map((row) => ({
      key: String(row.key),
      name: String(row.name),
      // Die Spalte ist `not null default ''`; `?? ''` fängt trotzdem ab, dass
      // die Migration noch nicht gelaufen ist — dann fehlt sie ganz.
      description: String(row.description ?? ''),
    })),
  }
}

/**
 * Die gespeicherte Art eines Händlers.
 *
 * Die Suche macht die Datenbank (`merchant_kind_for`), weil sie über
 * `merchant_key()` läuft — dieselbe Normalform, mit der `save_receipt` Händler
 * zusammenführt. Ohne sie fände ein Bon, auf dem der Laden diesmal „REWE CITY"
 * statt „REWE" heißt, seine eigene Art nicht wieder.
 *
 * Bei jedem Zweifel `retail`: Wer nichts Gegenteiliges weiß, behauptet nichts —
 * und ein fälschlich als Gastro geführter Supermarkt fiele aus den Bestpreisen
 * heraus, ohne dass jemand nach dem Grund suchte. Deshalb reißt auch ein Fehler
 * hier den Scan nicht mit: Markieren statt ablehnen, wie überall.
 */
async function loadMerchantKind(
  supabase: Client,
  merchantName: string | null,
): Promise<'retail' | 'gastro'> {
  const name = (merchantName ?? '').trim()
  if (name === '') return 'retail'

  const { data, error } = await supabase.rpc('merchant_kind_for', { p_name: name })
  if (error) {
    console.error('Händlerart konnte nicht geladen werden:', error.message)
    return 'retail'
  }
  return data === 'gastro' ? 'gastro' : 'retail'
}

/* ------------------------------------------------------- Der Kurs-Speicher */

/**
 * `exchange_rates` als Zwischenspeicher, wie `rates.ts` ihn erwartet.
 *
 * Die Tabelle hängt an keinem Haushalt — ein Wechselkurs ist eine öffentliche
 * Tatsache. Geschrieben wird mit `ignoreDuplicates`: Ein einmal gespeicherter
 * Tag wird nie überschrieben, auch nicht von einem späteren Abruf.
 *
 * Schlägt das Lesen oder Schreiben fehl, kostet das höchstens eine zusätzliche
 * Anfrage bei der EZB. Deshalb wird hier nichts geworfen — der Scan hängt nicht
 * am Zwischenspeicher.
 */
function rateStore(supabase: Client): RateStore {
  return {
    async read(currency: string, onDate: string): Promise<number | null> {
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('rate')
        .eq('currency', currency)
        .eq('rate_date', onDate)
        .maybeSingle()

      if (error || !data) return null
      const rate = Number((data as { rate: unknown }).rate)
      return Number.isFinite(rate) && rate > 0 ? rate : null
    },

    async write(currency: string, observations: EcbObservation[]): Promise<void> {
      const { error } = await supabase.from('exchange_rates').upsert(
        observations.map((observation) => ({
          rate_date: observation.date,
          currency,
          // Gespeichert wird die Form, in der gerechnet wird: Betrag × rate =
          // Euro. Die Umkehrung macht `toEuroRate` in rates.ts.
          rate: Math.round((1 / observation.perEuro) * 1_000_000) / 1_000_000,
        })),
        { onConflict: 'rate_date,currency', ignoreDuplicates: true },
      )
      if (error) console.error('Kurse konnten nicht abgelegt werden:', error.message)
    },
  }
}

/**
 * Kurs zu Währung und Datum — oder ein Satz, warum es nicht ging.
 *
 * Bei Euro (oder ohne gelesene Währung) passiert nichts: Der Normalfall ist ein
 * deutscher Bon, und für den gibt es nichts abzurufen.
 */
async function resolveRate(
  supabase: Client,
  currency: string | null,
  onDate: string | null,
): Promise<RateResponse> {
  if (currency === null || currency === 'EUR') {
    return { exchangeRate: null, rateError: null }
  }

  // Ohne gelesenes Bon-Datum gilt heute. Der Nutzer kann das Datum im
  // Korrektur-Screen ändern; dann wird der Kurs neu geholt.
  const date = onDate ?? new Date().toISOString().slice(0, 10)

  const outcome = await resolveExchangeRate(rateStore(supabase), currency, date)
  return outcome.ok
    ? { exchangeRate: outcome.value, rateError: null }
    : { exchangeRate: null, rateError: outcome.failure.message }
}

interface RequestBody {
  /** Das JPEG als Base64, ohne den `data:`-Vorspann. Durchgang 1. */
  image?: unknown
  /**
   * Weitere Ausschnitte desselben Bons, ebenfalls als Base64 ohne Vorspann.
   *
   * Nur bei einem sehr langen Bon gesetzt (Seitenverhältnis über 1:4). Fehlt
   * das Feld, läuft alles wie vorher — eine ältere App, die es nicht kennt,
   * funktioniert unverändert weiter.
   */
  kacheln?: unknown
  /** Standardmäßig `image/jpeg`; der Kamera-Screen liefert nichts anderes. */
  mimeType?: unknown
  /** Die zuzuordnenden Rohtexte. Ihre Anwesenheit macht daraus Durchgang 2. */
  rohtexte?: unknown
  /**
   * Eine reine Kursanfrage: Währung plus Stichtag, ohne Bild und ohne Modell.
   *
   * Gebraucht, sobald der Nutzer im Korrektur-Screen das Bon-Datum oder die
   * Währung ändert — der Kurs richtet sich nach dem Bon-Datum, und ein
   * korrigiertes Datum muss deshalb einen neuen Kurs nach sich ziehen. Ohne
   * diesen Weg müsste der Nutzer ihn von Hand nachschlagen, obwohl die App ihn
   * holen kann.
   */
  waehrung?: unknown
  datum?: unknown
  /**
   * Der Scan-Job, in den Durchgang 1 sein Ergebnis zusätzlich schreibt.
   *
   * Fehlt er, läuft alles wie vorher — der Job ist ein Rettungsweg und keine
   * Voraussetzung. Eine App, die noch nichts davon weiß, funktioniert
   * unverändert weiter.
   */
  jobId?: unknown
}

/* ================================================================= Durchgang 1 */

async function handleStructure(
  supabase: Client,
  householdId: string,
  apiKey: string,
  image: string,
  /**
   * Weitere Ausschnitte desselben Bons, in gedruckter Reihenfolge.
   *
   * Leer im Normalfall. Gefüllt nur bei einem sehr langen Bon, den der Browser
   * in überlappende Kacheln geschnitten hat (Schritt 18) — dann ist `image` die
   * oberste Kachel und hier stehen die darunter.
   */
  tiles: string[],
  mimeType: string,
  /** Der Rettungsweg aus Schritt 6. Null: Die App hat keinen Job angelegt. */
  jobId: string | null,
): Promise<Response> {
  /** Jeder Fehlausgang vermerkt denselben Grund im Job und in der Antwort. */
  const abort = async (
    code: ExtractionErrorCode,
    message: string,
    status: number,
    raw?: string,
  ): Promise<Response> => {
    await failJob(supabase, jobId, code, message)
    return fail(code, message, status, raw)
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
    // Statisch: Struktur hat mit den Merkmalen des Haushalts nichts zu tun.
    systemPrompt: STRUCTURE_SYSTEM_PROMPT,
    userPrompt: tiles.length > 0 ? STRUCTURE_TILED_USER_PROMPT : STRUCTURE_USER_PROMPT,
    imageDataUrl: `data:${mimeType};base64,${image}`,
    extraImageDataUrls: tiles.map((tile) => `data:${mimeType};base64,${tile}`),
    // Die Form erzwingen statt sie zu erbitten. Kennt das Modell den Modus
    // nicht, steigt `mistral.ts` von selbst auf `json_object` herab.
    jsonSchema: STRUCTURE_JSON_SCHEMA,
  })

  if (!outcome.ok) {
    // `detail` ist die technische Ursache. Sie geht ins Funktions-Protokoll,
    // aber nie in die Oberfläche.
    console.error('Mistral (Struktur):', outcome.reason, outcome.detail)
    const failure = mistralFailure(outcome.reason, outcome.model, outcome.detail)
    return await abort(failure.code, failure.message, failure.status)
  }

  /*
   * Erst protokollieren, dann prüfen. Die Reihenfolge ist Absicht: Jeder
   * Fehlausgang unten kehrt zurück, und ein Protokoll, das erst nach der
   * Prüfung geschrieben wird, fehlt genau bei den Scans, um deretwillen es da
   * ist.
   */
  logModelResponse('struktur', outcome.model, outcome.durationMs, outcome.diagnostics, outcome.text)

  const recovered = recoverModelJson(outcome.text)
  const parsed = recovered.receipt
  if (parsed === null) {
    /*
     * Die Unterscheidung, um die es geht: An `max_tokens` abgeschnitten ist
     * etwas anderes als kaputt geschrieben. Sie steht als Fehler im Protokoll
     * und nicht nur als Hinweis, weil sie den nächsten Schritt bestimmt — die
     * eine Ursache braucht mehr Ausgabe-Budget, die andere einen besseren
     * Prompt.
     */
    console.error(
      'Struktur-JSON unlesbar:',
      JSON.stringify({
        finishReason: outcome.diagnostics.finishReason,
        truncated: isTruncated(outcome.diagnostics.finishReason),
        outputTokens: outcome.diagnostics.outputTokens,
        textLength: outcome.diagnostics.textLength,
        tail: tail(outcome.text),
      }),
    )
    return await abort(
      'modell_json',
      'Die Antwort der Erkennung war unbrauchbar. Bitte den Bon noch einmal scannen.',
      502,
      // Die Rohantwort kommt mit: nur an ihr lässt sich sehen, warum es
      // schiefging, und nur so lässt sich der Prompt nachschärfen.
      outcome.text,
    )
  }

  if (isUnreadable(parsed)) {
    return await abort(
      'bild_unlesbar',
      'Auf dem Foto war kein lesbarer Kassenzettel zu erkennen. Bitte flach hinlegen, gut ausleuchten und die ganze Länge aufnehmen.',
      422,
      outcome.text,
    )
  }

  // Ein Rohtext, den der Haushalt schon kennt, übernimmt Name, Kategorie und
  // Merkmale aus der Datenbank (PROJEKT.md, Kernprinzip).
  const base = applyKnownProducts(validateExtraction(parsed), await knownProducts)

  /*
   * War die Antwort unfertig, muss das bis in die Oberfläche sichtbar bleiben.
   *
   * Das ist die einzige Warnung, die sagt: Hier fehlt vielleicht etwas, **ohne
   * dass man es sehen kann**. Ein falsch gelesener Betrag fällt beim
   * Summenabgleich auf; eine Zeile, die nie angekommen ist, fällt nirgends auf
   * — außer hier. Ein stillschweigend geschlossenes Teilergebnis wäre die
   * gefährlichste Art von Fehler: eine, die aussieht wie ein Ergebnis.
   */
  const extraction: Extraction = recovered.repaired
    ? {
        ...base,
        warnings: [
          {
            code: 'antwort_abgeschnitten',
            message:
              'Die Erkennung wurde abgeschnitten, bevor der Bon zu Ende gelesen war. Die ' +
              'Positionen unten sind vollständig gelesen — es können aber welche fehlen. ' +
              'Bitte mit dem Papier abgleichen.',
          },
          ...base.warnings,
        ],
      }
    : base

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

  /*
   * Händlerart und Kurs. Beides hängt an der Modellantwort — den Händlernamen
   * und die Währung kennt man vorher nicht —, deshalb erst hier. Nebeneinander,
   * weil sie nichts voneinander wissen: Bei einem deutschen Bon kostet der
   * Kursteil ohnehin nichts, er wird gar nicht erst abgerufen.
   */
  const [merchantKind, rate] = await Promise.all([
    loadMerchantKind(supabase, extraction.merchantName),
    resolveRate(supabase, extraction.currency, extraction.purchasedOn),
  ])

  const response: StructureResponse = {
    extraction,
    model: outcome.model,
    durationMs: outcome.durationMs,
    raw: outcome.text,
    offeneRohtexte,
    merchantKind,
    exchangeRate: rate.exchangeRate,
    rateError: rate.rateError,
  }

  /*
   * Erst in den Job, dann zurück. Die Reihenfolge ist Absicht: Wäre die Antwort
   * schon unterwegs, während der Job noch geschrieben wird, könnte eine App, die
   * genau in diesem Moment aufwacht, einen `running`-Job sehen, obwohl das
   * Ergebnis längst da ist — und würde vergeblich weiter warten.
   */
  await finishJob(supabase, jobId, response)

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

  logModelResponse(
    'zuordnung',
    outcome.model,
    outcome.durationMs,
    outcome.diagnostics,
    outcome.text,
  )

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

  /*
   * Währung statt Bild: Das ist eine reine Kursanfrage. Sie kostet weder einen
   * Modellaufruf noch Kontingent und steht deshalb ganz vorn — bevor irgendetwas
   * Teures geprüft wird.
   */
  if (typeof body.waehrung === 'string') {
    const rate: RateResponse = await resolveRate(
      supabase,
      body.waehrung.trim().toUpperCase(),
      typeof body.datum === 'string' ? body.datum.trim() : null,
    )
    return json(rate, 200)
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

  const jobId = typeof body.jobId === 'string' && body.jobId.trim() !== '' ? body.jobId.trim() : null

  const image = typeof body.image === 'string' ? body.image : ''
  if (image.length === 0) {
    const message = 'Es wurde kein Bild mitgeschickt. Bitte noch einmal scannen.'
    // Auch hier den Job schließen: Ein Job, der auf `running` stehen bleibt,
    // meldet sich beim nächsten App-Start als offener Scan — und dahinter läge
    // nichts.
    await failJob(supabase, jobId, 'kein_bild', message)
    return fail('kein_bild', message, 400)
  }
  if (image.length > MAX_IMAGE_CHARS) {
    const message =
      'Das Bild ist zu groß. Bitte den Bon noch einmal mit der Kamera in der App aufnehmen.'
    await failJob(supabase, jobId, 'bild_zu_gross', message)
    return fail('bild_zu_gross', message, 413)
  }

  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'

  /*
   * Die weiteren Kacheln. Ihre Gesamtgröße zählt gegen dieselbe Obergrenze wie
   * das erste Bild — sonst ließe sich die Prüfung oben durch Aufteilen einfach
   * umgehen.
   */
  const tiles = Array.isArray(body.kacheln)
    ? body.kacheln.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

  const totalChars = image.length + tiles.reduce((sum, tile) => sum + tile.length, 0)
  if (totalChars > MAX_IMAGE_CHARS) {
    const message =
      'Das Bild ist zu groß. Bitte den Bon noch einmal mit der Kamera in der App aufnehmen.'
    await failJob(supabase, jobId, 'bild_zu_gross', message)
    return fail('bild_zu_gross', message, 413)
  }

  return await handleStructure(supabase, householdId, apiKey, image, tiles, mimeType, jobId)
})
