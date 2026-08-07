import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { traits } from '../mocks/traits.ts'
import { healthScore, itemScore, itemTraitIds, itemTraits, traitSpending } from './score.ts'
import type { MilkHeat, MilkHomogenized, ReceiptItem, TraitId } from '../types.ts'

/**
 * The four control cases from PROJEKT.md are the point of this file: they pin
 * the group rule down so a later change to the weights cannot quietly break it.
 */

function item(
  name: string,
  totalCents: number,
  traitIds: TraitId[],
  milk?: { milkHeat?: MilkHeat; milkHomogenized?: MilkHomogenized },
): ReceiptItem {
  return {
    id: name,
    name,
    categoryId: 'staples',
    quantity: { kind: 'unknown' },
    totalCents,
    traitIds,
    ...milk,
  }
}

const weightOf = (id: TraitId) => traits.find((t) => t.id === id)?.weight

describe('shipped traits', () => {
  test('the eight defaults from PROJEKT.md are present, with the documented weights', () => {
    const expected = [
      // id, short, weight, group, active
      ['verarbeitet', 'V', -3, undefined, true],
      ['industriezucker', 'Z', -3, undefined, true],
      ['samenoel', 'Ö', -3, 'fette', true],
      ['pflanzenfett', 'P', -2, 'fette', true],
      ['gluten', 'G', -2, 'getreide', true],
      ['weizen', 'W', -3, 'getreide', true],
      ['milch', 'M', 0, 'milch_basis', true],
      ['zusatzstoffe', 'E', -2, undefined, false],
    ] as const

    for (const [id, short, weight, group, active] of expected) {
      const trait = traits.find((t) => t.id === id)
      if (!trait) throw new Error(`Merkmal ${id} fehlt`)
      assert.equal(trait.short, short, `${id}: Kürzel`)
      assert.equal(trait.weight, weight, `${id}: Gewicht`)
      assert.equal(trait.group, group, `${id}: Gruppe`)
      assert.equal(trait.active, active, `${id}: aktiv`)
    }
  })

  test('the milk traits carry the documented weights and groups', () => {
    assert.equal(weightOf('roh'), 2)
    assert.equal(weightOf('pasteurisiert'), 0)
    assert.equal(weightOf('esl'), -1)
    assert.equal(weightOf('uht'), -2)
    assert.equal(weightOf('homogenisiert'), -1)

    for (const id of ['milch', 'roh', 'pasteurisiert', 'esl', 'uht']) {
      assert.equal(traits.find((t) => t.id === id)?.group, 'milch_basis', `${id} gehört in milch_basis`)
    }
    // Outside the group on purpose — an independent processing step.
    assert.equal(traits.find((t) => t.id === 'homogenisiert')?.group, undefined)
  })

  test('every trait is within the −10…+10 range and has a badge of 1–2 characters', () => {
    for (const trait of traits) {
      assert.ok(trait.weight >= -10 && trait.weight <= 10, `${trait.id}: Gewicht außerhalb −10…+10`)
      assert.ok(trait.short.length >= 1 && trait.short.length <= 2, `${trait.id}: Kürzel zu lang`)
      assert.ok(trait.label.length > 0 && trait.description.length > 0 && trait.tip.length > 0)
    }
  })

  test('badge shorts are unique, otherwise two traits look the same', () => {
    const shorts = traits.map((t) => t.short)
    assert.equal(new Set(shorts).size, shorts.length, `doppelte Kürzel: ${shorts}`)
  })
})

describe('Gruppenregel – die vier Kontrollbeispiele aus PROJEKT.md', () => {
  test('Sauerteigbrot: gluten −2 + weizen −3 (Gruppe getreide) → −3', () => {
    assert.equal(itemScore(item('Sauerteigbrot', 249, ['gluten', 'weizen']), traits), -3)
  })

  test('Tiefkühlpizza: verarbeitet −3, fette −3, getreide −3 → −9', () => {
    const pizza = item('Tiefkühlpizza', 558, [
      'verarbeitet',
      'samenoel',
      'pflanzenfett',
      'weizen',
      'gluten',
    ])
    assert.equal(itemScore(pizza, traits), -9)
  })

  test('Rohmilch, nicht homogenisiert: milch 0 + roh +2 (Gruppe milch_basis) → +2', () => {
    const rohmilch = item('Rohmilch', 189, ['milch'], {
      milkHeat: 'roh',
      milkHomogenized: 'nein',
    })
    assert.equal(itemScore(rohmilch, traits), 2)
  })

  test('H-Milch, homogenisiert: uht −2 (Gruppe) + homogenisiert −1 (ohne Gruppe) → −3', () => {
    const hMilch = item('H-Milch', 129, ['milch'], {
      milkHeat: 'uht',
      milkHomogenized: 'ja',
    })
    assert.equal(itemScore(hMilch, traits), -3)
  })
})

describe('Gruppenregel im Detail', () => {
  test('der größte Betrag gewinnt, nicht der kleinste Wert', () => {
    // milch 0 gegen roh +2: der Betrag entscheidet, sonst verdrängte die Null
    // die Gutschrift.
    assert.equal(itemScore(item('x', 100, ['milch', 'roh']), traits), 2)
    assert.equal(itemScore(item('x', 100, ['milch', 'uht']), traits), -2)
    assert.equal(itemScore(item('x', 100, ['esl', 'uht']), traits), -2)
  })

  test('bei gleichem Betrag gewinnt das negativere Merkmal', () => {
    const tie = [
      { id: 'plus', label: '+', short: 'A', description: 'd', weight: 3, group: 'g', tip: 't', active: true, isDefault: false },
      { id: 'minus', label: '−', short: 'B', description: 'd', weight: -3, group: 'g', tip: 't', active: true, isDefault: false },
    ]
    assert.equal(itemScore(item('x', 100, ['plus', 'minus']), tie), -3)
    // Reihenfolge darf nichts ändern.
    assert.equal(itemScore(item('x', 100, ['minus', 'plus']), tie), -3)
  })

  test('Merkmale ohne Gruppe zählen einzeln', () => {
    // verarbeitet −3 und industriezucker −3 sind beide gruppenlos.
    assert.equal(itemScore(item('x', 100, ['verarbeitet', 'industriezucker']), traits), -6)
  })

  test('inaktive und unbekannte Merkmale zählen nicht', () => {
    // zusatzstoffe ist −2, aber standardmäßig aus.
    assert.equal(itemScore(item('x', 100, ['zusatzstoffe']), traits), 0)
    assert.equal(itemScore(item('x', 100, ['gibtesnicht']), traits), 0)
    assert.equal(itemScore(item('x', 100, ['gluten', 'gibtesnicht']), traits), -2)
  })

  test('ein doppelt vergebenes Merkmal zählt einmal', () => {
    assert.equal(itemScore(item('x', 100, ['verarbeitet', 'verarbeitet']), traits), -3)
  })

  test('ohne Merkmale ist der Beitrag null', () => {
    assert.equal(itemScore(item('Bananen', 200, []), traits), 0)
  })
})

describe('Milch-Eigenschaften', () => {
  test('unbekannt erzeugt kein Merkmal und zählt neutral', () => {
    const unknown = item('Gouda', 276, ['milch'], {
      milkHeat: 'unbekannt',
      milkHomogenized: 'unbekannt',
    })
    assert.deepEqual(itemTraitIds(unknown), ['milch'])
    assert.equal(itemScore(unknown, traits), 0)
  })

  test('milkHomogenized nein erzeugt kein Merkmal', () => {
    const item_ = item('Milch', 129, [], { milkHeat: 'pasteurisiert', milkHomogenized: 'nein' })
    assert.deepEqual(itemTraitIds(item_), ['pasteurisiert'])
  })

  test('die beiden Felder wirken unabhängig voneinander', () => {
    // Pasteurisiert (0) und homogenisiert (−1) treffen zusammen: −1.
    const both = item('Frischmilch', 129, ['milch'], {
      milkHeat: 'pasteurisiert',
      milkHomogenized: 'ja',
    })
    assert.equal(itemScore(both, traits), -1)
  })

  test('Milch-Merkmale hängen nicht an der Kategorie', () => {
    // Eine Lasagne enthält Milch, hat aber keine Erhitzungsangabe.
    const lasagne = item('Fertig-Lasagne', 558, ['milch', 'verarbeitet'])
    assert.equal(itemScore(lasagne, traits), -3)
  })
})

describe('Health-Score', () => {
  test('ohne Positionen ist der Score 100', () => {
    assert.equal(healthScore([], traits), 100)
  })

  test('ohne Merkmale ist der Score 100', () => {
    assert.equal(healthScore([item('Bananen', 200, []), item('Eier', 349, [])], traits), 100)
  })

  test('gewichtet nach Euro-Anteil, nicht nach Anzahl', () => {
    // Das teure Fertiggericht muss stärker durchschlagen als die Brötchen.
    const pizza = item('Fertiggericht', 1200, ['verarbeitet'])
    const roll = item('Toastbrötchen', 149, ['verarbeitet'])
    const plain = item('Bananen', 1200, [])

    const expensiveFlagged = healthScore([pizza, plain], traits)
    const cheapFlagged = healthScore([roll, plain], traits)
    assert.ok(
      expensiveFlagged < cheapFlagged,
      `teure Position muss stärker wirken (${expensiveFlagged} vs. ${cheapFlagged})`,
    )

    // 1200 ct mit −3 und 1200 ct mit 0 → Mittel −1,5 → 100 − 15 = 85.
    assert.equal(expensiveFlagged, 85)
  })

  test('positive Merkmale heben den Score, gedeckelt bei 100', () => {
    const rohmilch = item('Rohmilch', 500, ['milch'], { milkHeat: 'roh', milkHomogenized: 'nein' })
    assert.equal(healthScore([rohmilch], traits), 100)
  })

  test('Score bleibt in 0…100, auch bei sehr schlechter Last', () => {
    const awful = item('x', 100, ['verarbeitet', 'industriezucker', 'samenoel', 'weizen'])
    const score = healthScore([awful], traits)
    assert.ok(score >= 0 && score <= 100, `Score ${score} außerhalb 0…100`)
    // −3 −3 −3 −3 = −12 → 100 − 120 → gedeckelt auf 0.
    assert.equal(score, 0)
  })
})

describe('Ausgaben pro Merkmal', () => {
  const items = [
    item('Tiefkühlpizza', 558, ['verarbeitet', 'weizen', 'gluten']),
    item('Sauerteigbrot', 249, ['gluten', 'weizen']),
    item('Bananen', 200, []),
  ]

  test('summiert den vollen Positionsbetrag je Merkmal', () => {
    const rows = traitSpending(items, traits)
    const byId = new Map(rows.map((r) => [r.trait.id, r]))
    assert.equal(byId.get('gluten')?.amountCents, 807)
    assert.equal(byId.get('weizen')?.amountCents, 807)
    assert.equal(byId.get('verarbeitet')?.amountCents, 558)
    assert.equal(byId.get('gluten')?.itemCount, 2)
  })

  test('die Gruppenregel gilt hier NICHT – Gluten zählt trotz Weizen mit', () => {
    // Im Score verdrängt weizen das gluten; in der Ausgabenauswertung nicht.
    const rows = traitSpending([item('Brot', 249, ['gluten', 'weizen'])], traits)
    assert.equal(rows.find((r) => r.trait.id === 'gluten')?.amountCents, 249)
    assert.equal(rows.find((r) => r.trait.id === 'weizen')?.amountCents, 249)
  })

  test('absteigend sortiert, Merkmale ohne Ausgaben fallen raus', () => {
    const rows = traitSpending(items, traits)
    const amounts = rows.map((r) => r.amountCents)
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a))
    assert.ok(rows.every((r) => r.amountCents > 0))
    assert.ok(!rows.some((r) => r.trait.id === 'industriezucker'))
  })

  test('inaktive Merkmale erscheinen nicht', () => {
    const rows = traitSpending([item('Gummibärchen', 119, ['zusatzstoffe'])], traits)
    assert.ok(!rows.some((r) => r.trait.id === 'zusatzstoffe'))
  })
})

describe('itemTraits', () => {
  test('liefert die Merkmals-Objekte in Reihenfolge der Vergabe', () => {
    const applied = itemTraits(item('x', 100, ['verarbeitet', 'gluten']), traits)
    assert.deepEqual(
      applied.map((t) => t.short),
      ['V', 'G'],
    )
  })
})
