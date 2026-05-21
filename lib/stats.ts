// Deterministic stat generation from a captured animal.
// Maps iNaturalist iconicTaxon + a confidence score into battle stats.
// Same taxon + same capture id -> same stats (no rerolls).

import type { IdSuggestion } from './inaturalist';
import { rng } from './rng';

export type BattleStats = {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
  element: Element;
  rarity: Rarity;
};

export type Element = 'beast' | 'avian' | 'aquatic' | 'reptile' | 'insect' | 'flora' | 'fungal' | 'unknown';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

const ELEMENT_MAP: Record<string, Element> = {
  Mammalia: 'beast',
  Aves: 'avian',
  Actinopterygii: 'aquatic',
  Amphibia: 'aquatic',
  Reptilia: 'reptile',
  Insecta: 'insect',
  Arachnida: 'insect',
  Mollusca: 'aquatic',
  Plantae: 'flora',
  Fungi: 'fungal',
};

function rarityFromScore(score: number): Rarity {
  if (score > 0.97) return 'legendary';
  if (score > 0.9) return 'epic';
  if (score > 0.75) return 'rare';
  if (score > 0.5) return 'uncommon';
  return 'common';
}

const RARITY_BUDGET: Record<Rarity, number> = {
  common: 250,
  uncommon: 300,
  rare: 360,
  epic: 420,
  legendary: 500,
};

export function rollStats(captureId: string, top: IdSuggestion): BattleStats {
  const element = ELEMENT_MAP[top.iconicTaxon ?? ''] ?? 'unknown';
  // Clamp score into [0,1]; iNat is supposed to give us 0-1 (after the /100 normalization
  // in inaturalist.ts), but a NaN/negative/missing value would silently poison every stat.
  const score = Math.max(0, Math.min(1, Number(top.score) || 0));
  const rarity = rarityFromScore(score);
  const budget = RARITY_BUDGET[rarity];
  const r = rng(captureId);

  // Allocate 5 stat buckets from the budget with a bias by element.
  const weights = [1, 1, 1, 1, 1].map(() => 0.6 + r() * 0.8);
  const bias = ELEMENT_BIAS[element];
  for (let i = 0; i < 5; i++) weights[i] *= bias[i];
  const sum = weights.reduce((a, b) => a + b, 0);
  const alloc = weights.map((w) => Math.round((w / sum) * budget));

  return {
    hp: 20 + alloc[0],
    attack: 5 + alloc[1],
    defense: 5 + alloc[2],
    speed: 5 + alloc[3],
    special: 5 + alloc[4],
    element,
    rarity,
  };
}

// Per-element bias on [HP, ATK, DEF, SPD, SPC].
const ELEMENT_BIAS: Record<Element, number[]> = {
  beast: [1.1, 1.2, 1.0, 0.9, 0.8],
  avian: [0.9, 1.0, 0.8, 1.4, 0.9],
  aquatic: [1.0, 0.9, 1.0, 1.0, 1.1],
  reptile: [1.0, 1.1, 1.2, 0.8, 0.9],
  insect: [0.8, 1.0, 0.8, 1.3, 1.1],
  flora: [1.3, 0.7, 1.3, 0.6, 1.1],
  fungal: [1.0, 0.8, 1.0, 0.8, 1.4],
  unknown: [1, 1, 1, 1, 1],
};
