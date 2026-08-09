import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAssignments } from './assign.ts'

/**
 * Tests für Durchgang 2 — die Zuordnung.
 *
 * Der wichtigste Fall steht ganz unten: Zugeordnet wird über den **Rohtext**,
 * nicht über die Reihenfolge. Ein Modell, das eine Zeile ausfallen lässt, würde
 * sonst alles Folgende um eins verschieben — und aus dem Spülmittel würde die
 * Milch. Das wäre ein Fehler, den niemand bemerkt, weil er plausibel aussieht.
 */

const CONTEXT = {
  categoryKeys: ['produce', 'dairy', 'nonfood'],
  traitKeys: ['milch', 'industriezucker'],
  rawTexts: ['G&G H-MILCH 1,5%', 'SPUELMITTEL ZITRONE'],
}

/** Kürzel für „das Modell hat genau diese Zuordnungen geliefert". */
function answer(zuordnungen: unknown[]): string {
  return JSON.stringify({ zuordnungen })
}

const MILCH = {
  rohtext: 'G&G H-MILCH 1,5%',
  name: 'H-Milch 1,5 % Fett',
  kategorie: 'dairy',
  merkmale: ['milch'],
  milch_erhitzung: 'uht',
  milch_homogenisiert: 'unbekannt',
}

const SPUELI = {
  rohtext: 'SPUELMITTEL ZITRONE',
  name: 'Spülmittel Zitrone',
  kategorie: 'nonfood',
  merkmale: [],
  milch_erhitzung: 'unbekannt',
  milch_homogenisiert: 'unbekannt',
}

test('validateAssignments', async (t) => {
  await t.test('nimmt eine saubere Antwort an', () => {
    const result = validateAssignments(answer([MILCH, SPUELI]), CONTEXT)
    const milch = result.byRawText.get('g&g h-milch 1,5%')!

    assert.equal(milch.name, 'H-Milch 1,5 % Fett')
    assert.equal(milch.categoryKey, 'dairy')
    assert.deepEqual(milch.traitKeys, ['milch'])
    assert.equal(milch.milkHeat, 'uht')
    assert.equal(milch.source, 'model')
    assert.equal(result.warnings.length, 0)
  })

  await t.test('findet den Rohtext unabhängig von der Schreibweise', () => {
    const result = validateAssignments(answer([{ ...MILCH, rohtext: '  g&g h-milch 1,5%  ' }]), {
      ...CONTEXT,
      rawTexts: ['G&G H-MILCH 1,5%'],
    })
    assert.equal(result.byRawText.size, 1)
  })

  await t.test('verwirft eine unbekannte Kategorie, statt sie anzulegen', () => {
    const result = validateAssignments(answer([{ ...MILCH, kategorie: 'gibtsnicht' }]), CONTEXT)
    assert.equal(result.byRawText.get('g&g h-milch 1,5%')?.categoryKey, null)
    assert.equal(result.warnings.some((w) => w.code === 'kategorie_unbekannt'), true)
  })

  await t.test('verwirft erfundene Merkmale', () => {
    const result = validateAssignments(
      answer([{ ...MILCH, merkmale: ['milch', 'quatsch', 'noch_ein_quatsch'] }]),
      CONTEXT,
    )
    assert.deepEqual(result.byRawText.get('g&g h-milch 1,5%')?.traitKeys, ['milch'])
    const warning = result.warnings.find((w) => w.code === 'merkmal_verworfen')!
    // Gesammelt in einer Meldung, nicht eine je Zeile — sonst steht da eine Wand.
    assert.equal(warning.message.includes('quatsch'), true)
    assert.equal(warning.message.includes('noch_ein_quatsch'), true)
  })

  await t.test('rät bei den Milch-Feldern nie', () => {
    const result = validateAssignments(
      answer([{ ...MILCH, milch_erhitzung: 'ultrahoch', milch_homogenisiert: 'vielleicht' }]),
      CONTEXT,
    )
    const milch = result.byRawText.get('g&g h-milch 1,5%')!
    assert.equal(milch.milkHeat, 'unbekannt')
    assert.equal(milch.milkHomogenized, 'unbekannt')
  })

  await t.test('verwirft Zuordnungen zu Texten, nach denen niemand gefragt hat', () => {
    const erfunden = { ...MILCH, rohtext: 'STAND NIE AUF DEM BON' }
    const result = validateAssignments(answer([MILCH, erfunden]), CONTEXT)
    assert.equal(result.byRawText.size, 1)
    assert.equal(result.byRawText.has('stand nie auf dem bon'), false)
  })

  await t.test('meldet, wenn eine Zuordnung fehlt', () => {
    const result = validateAssignments(answer([MILCH]), CONTEXT)
    assert.equal(result.byRawText.size, 1)
    const warning = result.warnings.find((w) => w.code === 'zuordnung_unvollstaendig')!
    assert.equal(warning.message.includes('1 Position'), true)
  })

  await t.test('ordnet über den Rohtext zu, nicht über die Reihenfolge', () => {
    // Das Modell lässt die Milch aus und liefert nur das Spülmittel. Über die
    // Reihenfolge zugeordnet bekäme die Milch jetzt „Spülmittel Zitrone" und
    // die Kategorie nonfood — plausibel aussehend und komplett falsch.
    const result = validateAssignments(answer([SPUELI]), CONTEXT)
    assert.equal(result.byRawText.has('g&g h-milch 1,5%'), false)
    assert.equal(result.byRawText.get('spuelmittel zitrone')?.name, 'Spülmittel Zitrone')
  })

  await t.test('nimmt bei doppeltem Rohtext den ersten', () => {
    const result = validateAssignments(
      answer([MILCH, { ...MILCH, name: 'Etwas anderes' }]),
      CONTEXT,
    )
    assert.equal(result.byRawText.get('g&g h-milch 1,5%')?.name, 'H-Milch 1,5 % Fett')
  })

  await t.test('überlebt eine kaputte Antwort', () => {
    for (const raw of ['', 'Das kann ich nicht.', '{"zuordnungen":[]}', '{"etwas":"anderes"}']) {
      const result = validateAssignments(raw, CONTEXT)
      assert.equal(result.byRawText.size, 0)
      assert.equal(result.warnings.some((w) => w.code === 'zuordnung_ausgefallen'), true)
    }
  })

  await t.test('nimmt die Antwort auch aus einem Codeblock', () => {
    const raw = '```json\n' + answer([MILCH]) + '\n```'
    assert.equal(validateAssignments(raw, CONTEXT).byRawText.size, 1)
  })
})
