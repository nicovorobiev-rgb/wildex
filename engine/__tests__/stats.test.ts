/**
 * engine/__tests__/stats.test.ts
 *
 * Test cases: S1-S4 from spec/test-plan.md §2.2 (Stats and mappings)
 *             plus supporting determinism case D2 from §2.1.
 *
 * Coverage goal: 100% lines + branches of engine/stats.ts.
 */

import {
  rollStats,
  ELEMENT_MAP,
  RARITY_THRESHOLDS,
  type BattleStats,
  type Element,
  type Rarity,
} from '../stats';

// ---------------------------------------------------------------------------
// S4 — Known-vector fixture (matches __tests__/__fixtures__/known-stats.json)
// ---------------------------------------------------------------------------

const KNOWN_VECTOR = {
  captureId: 'legend-test',
  taxonId: 1,
  iconicTaxon: 'Aves',
  score: 0.99,
  expected: {
    id: 'legend-test',
    hp: 81,
    attack: 101,
    defense: 101,
    speed: 162,
    special: 95,
    element: 'avian' as Element,
    rarity: 'legendary' as Rarity,
  },
};

// ---------------------------------------------------------------------------
// D2 — Additional known-seed vector (from test-plan §2.1 example D2)
// ---------------------------------------------------------------------------

const D2_VECTOR = {
  captureId: 'cap-001',
  taxonId: 12345,
  iconicTaxon: 'Mammalia',
  score: 0.78,
  expected: {
    id: 'cap-001',
    hp: 116,
    attack: 94,
    defense: 85,
    speed: 54,
    special: 51,
    element: 'beast' as Element,
    rarity: 'rare' as Rarity,
  },
};

// ---------------------------------------------------------------------------
// All iconic taxons from DESIGN.md with their expected elements
// ---------------------------------------------------------------------------

const TAXON_ELEMENT_TABLE: ReadonlyArray<readonly [string, Element]> = [
  ['Mammalia', 'beast'],
  ['Aves', 'avian'],
  ['Actinopterygii', 'aquatic'],
  ['Amphibia', 'aquatic'],
  ['Reptilia', 'reptile'],
  ['Insecta', 'insect'],
  ['Arachnida', 'insect'],
  ['Mollusca', 'aquatic'],
  ['Plantae', 'flora'],
  ['Fungi', 'fungal'],
];

// ---------------------------------------------------------------------------
// Rarity score boundaries derived from RARITY_THRESHOLDS
// Each entry: [score, expectedRarity, description]
// ---------------------------------------------------------------------------

const RARITY_BOUNDARY_TABLE: ReadonlyArray<readonly [number, Rarity, string]> = [
  // Scores exactly at the threshold are NOT above it — fall through to next tier.
  [0.97, 'epic', 'score=0.97 is not >0.97, should be epic'],
  [0.971, 'legendary', 'score=0.971 exceeds 0.97, should be legendary'],
  [0.9, 'rare', 'score=0.90 is not >0.90, should be rare'],
  [0.901, 'epic', 'score=0.901 exceeds 0.90, should be epic'],
  [0.75, 'uncommon', 'score=0.75 is not >0.75, should be uncommon'],
  [0.751, 'rare', 'score=0.751 exceeds 0.75, should be rare'],
  [0.5, 'common', 'score=0.50 is not >0.50, should be common'],
  [0.501, 'uncommon', 'score=0.501 exceeds 0.50, should be uncommon'],
  // Extreme values
  [0, 'common', 'score=0 is common'],
  [1, 'legendary', 'score=1 is legendary'],
  [0.98, 'legendary', 'score=0.98 is legendary'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statKeys(stats: BattleStats): (keyof BattleStats)[] {
  return ['id', 'hp', 'attack', 'defense', 'speed', 'special', 'element', 'rarity'];
}

// ---------------------------------------------------------------------------
// S1 — Every iconic taxon maps to the expected element; unknowns fall back.
// ---------------------------------------------------------------------------

describe('S1 — ELEMENT_MAP completeness and fallback', () => {
  test('ELEMENT_MAP contains every iconic taxon from DESIGN.md', () => {
    for (const [taxon] of TAXON_ELEMENT_TABLE) {
      expect(ELEMENT_MAP).toHaveProperty(taxon);
    }
  });

  test.each(TAXON_ELEMENT_TABLE)(
    'rollStats with iconicTaxon="%s" produces element="%s"',
    (taxon, expectedElement) => {
      const stats = rollStats('test-id', 0, taxon, 0.5);
      expect(stats.element).toBe(expectedElement);
    },
  );

  test('unmapped iconicTaxon falls back to element "unknown"', () => {
    const stats = rollStats('test-id', 0, 'Chromista', 0.5);
    expect(stats.element).toBe('unknown');
  });

  test('empty string iconicTaxon falls back to element "unknown"', () => {
    const stats = rollStats('test-id', 0, '', 0.5);
    expect(stats.element).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// S2 — RARITY_BUDGET monotonicity: higher score => >= stat budget.
// ---------------------------------------------------------------------------

describe('S2 — RARITY_THRESHOLDS monotonicity', () => {
  test('RARITY_THRESHOLDS is ordered from highest to lowest threshold', () => {
    const thresholds = RARITY_THRESHOLDS.map(([t]) => t);
    for (let i = 0; i < thresholds.length - 1; i++) {
      expect(thresholds[i]).toBeGreaterThan(thresholds[i + 1]);
    }
  });

  test('higher score produces rarity with >= stat total (monotonic budget)', () => {
    // Use fixed captureId/taxon so the only variable is budget from rarity.
    // A higher score can only equal or increase the budget — we verify the
    // rarity tier of a high-score roll is never below that of a low-score roll.
    const rarityOrder: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rankOf = (r: Rarity) => rarityOrder.indexOf(r);

    const low = rollStats('monotonic-test', 0, 'Aves', 0.5);
    const mid = rollStats('monotonic-test', 0, 'Aves', 0.78);
    const high = rollStats('monotonic-test', 0, 'Aves', 0.99);

    expect(rankOf(mid.rarity)).toBeGreaterThanOrEqual(rankOf(low.rarity));
    expect(rankOf(high.rarity)).toBeGreaterThanOrEqual(rankOf(mid.rarity));
  });
});

// ---------------------------------------------------------------------------
// S3 — Score thresholds produce expected rarity tiers (boundary cases).
// ---------------------------------------------------------------------------

describe('S3 — Score threshold → rarity tier mapping', () => {
  test.each(RARITY_BOUNDARY_TABLE)(
    'score=%f => rarity "%s" (%s)',
    (score, expectedRarity) => {
      const stats = rollStats('threshold-test', 0, 'Aves', score);
      expect(stats.rarity).toBe(expectedRarity);
    },
  );

  test('score clamped: negative score treated as 0 (common)', () => {
    const stats = rollStats('clamp-test', 0, 'Aves', -0.5);
    expect(stats.rarity).toBe('common');
  });

  test('score clamped: score > 1 treated as 1 (legendary)', () => {
    const stats = rollStats('clamp-test', 0, 'Aves', 1.5);
    expect(stats.rarity).toBe('legendary');
  });

  test('score NaN treated as 0 (common)', () => {
    const stats = rollStats('nan-test', 0, 'Aves', NaN);
    expect(stats.rarity).toBe('common');
  });
});

// ---------------------------------------------------------------------------
// S4 — Known-vector: fixed seed produces the exact committed stat block.
// ---------------------------------------------------------------------------

describe('S4 — Known-vector determinism', () => {
  test('legend-test / Aves / 0.99 produces the committed stat block', () => {
    const { captureId, taxonId, iconicTaxon, score, expected } = KNOWN_VECTOR;
    const stats = rollStats(captureId, taxonId, iconicTaxon, score);
    expect(stats).toEqual(expected);
  });

  test('cap-001 / Mammalia / 0.78 produces the committed D2 stat block', () => {
    const { captureId, taxonId, iconicTaxon, score, expected } = D2_VECTOR;
    const stats = rollStats(captureId, taxonId, iconicTaxon, score);
    expect(stats).toEqual(expected);
  });

  test('same inputs always produce the same output (idempotence, 10 runs)', () => {
    const { captureId, taxonId, iconicTaxon, score, expected } = KNOWN_VECTOR;
    for (let i = 0; i < 10; i++) {
      const stats = rollStats(captureId, taxonId, iconicTaxon, score);
      expect(stats).toEqual(expected);
    }
  });

  test('changing captureId changes the stat block', () => {
    const stats1 = rollStats('seed-a', 0, 'Aves', 0.8);
    const stats2 = rollStats('seed-b', 0, 'Aves', 0.8);
    // At minimum one numeric stat must differ (same element/rarity, different RNG path)
    const numericDiffers =
      stats1.hp !== stats2.hp ||
      stats1.attack !== stats2.attack ||
      stats1.defense !== stats2.defense ||
      stats1.speed !== stats2.speed ||
      stats1.special !== stats2.special;
    expect(numericDiffers).toBe(true);
  });

  test('taxonId does not affect stat output (reserved field)', () => {
    const statsA = rollStats('same-id', 1, 'Aves', 0.8);
    const statsB = rollStats('same-id', 99999, 'Aves', 0.8);
    expect(statsA).toEqual(statsB);
  });
});

// ---------------------------------------------------------------------------
// Shape and range guards — ensures 100% branch coverage of stat assembly.
// ---------------------------------------------------------------------------

describe('stat shape and numeric range', () => {
  const ELEMENTS: Element[] = [
    'beast', 'avian', 'aquatic', 'reptile', 'insect', 'flora', 'fungal', 'unknown',
  ];

  test.each(ELEMENTS)(
    'element "%s" produces positive hp/attack/defense/speed/special',
    (element) => {
      // Roll with a score that gives 'rare' rarity so budget is middle-of-range.
      const iconicTaxon = Object.entries(ELEMENT_MAP).find(([, v]) => v === element)?.[0]
        ?? 'Chromista'; // unknown element has no ELEMENT_MAP entry
      const stats = rollStats(`range-${element}`, 0, iconicTaxon, 0.8);
      expect(stats.hp).toBeGreaterThan(0);
      expect(stats.attack).toBeGreaterThan(0);
      expect(stats.defense).toBeGreaterThan(0);
      expect(stats.speed).toBeGreaterThan(0);
      expect(stats.special).toBeGreaterThan(0);
    },
  );

  test('returned object has exactly the expected keys', () => {
    const stats = rollStats('shape-test', 0, 'Aves', 0.5);
    const keys = Object.keys(stats).sort();
    expect(keys).toEqual(['attack', 'defense', 'element', 'hp', 'id', 'rarity', 'special', 'speed']);
  });
});
