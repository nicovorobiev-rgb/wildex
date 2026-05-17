// Growth system. Animals earn XP from feeding and battles, age up at XP
// thresholds (or via Age Tonic), and on age-up the player gets +5 stat
// points to allocate across HP, Attack, Defense, Speed, Special.
//
// Effective stats = base (from capture) + allocated. No auto multiplier:
// players choose their build. Free-to-play players get all the same growth;
// shop items just save time.

import type { BattleStats } from './stats';
import { supabase } from './supabase';

export const MAX_AGE = 10;
export const POINTS_PER_AGE_UP = 5;

export type Stat = 'hp' | 'attack' | 'defense' | 'speed' | 'special';
export type Allocated = Record<Stat, number>;

export const STAT_LABEL: Record<Stat, string> = {
  hp: 'Health',
  attack: 'Strength',
  defense: 'Defense',
  speed: 'Speed',
  special: 'Stamina',
};

// Progressive curve: each age costs more than the last but stays reachable.
// 1→2: 60, 2→3: 148, 3→4: 250, ..., 9→10: 1062. Total ~4667 XP across all
// age-ups. With daily feeds + battle wins, ~3 weeks of casual play to max.
export function xpToNextAge(currentAge: number): number {
  return Math.round(60 * Math.pow(currentAge, 1.3));
}

export function ageLabel(age: number): string {
  if (age <= 1) return 'Hatchling';
  if (age <= 3) return 'Juvenile';
  if (age <= 5) return 'Adult';
  if (age <= 8) return 'Veteran';
  return 'Apex';
}

export function effectiveStats(base: BattleStats, allocated: Allocated): BattleStats {
  return {
    ...base,
    hp: base.hp + (allocated.hp ?? 0),
    attack: base.attack + (allocated.attack ?? 0),
    defense: base.defense + (allocated.defense ?? 0),
    speed: base.speed + (allocated.speed ?? 0),
    special: base.special + (allocated.special ?? 0),
  };
}

export type ShopItem = 'growth_treat' | 'age_tonic';
const FEED_XP: Record<'berry' | 'growth_treat', number> = { berry: 25, growth_treat: 38 };

export async function feed(captureId: string, item: 'berry' | 'growth_treat' = 'berry') {
  const { data, error } = await supabase.rpc('feed_capture', {
    p_capture: captureId,
    p_xp: FEED_XP[item],
    p_item: item === 'berry' ? null : item,
  });
  if (error) throw error;
  return data;
}

export async function ageUp(captureId: string, useTonic = false) {
  const { data, error } = await supabase.rpc('age_up', {
    p_capture: captureId,
    p_use_tonic: useTonic,
  });
  if (error) throw error;
  return data;
}

export async function allocate(captureId: string, stat: Stat, amount = 1) {
  const { data, error } = await supabase.rpc('allocate_point', {
    p_capture: captureId,
    p_stat: stat,
    p_amount: amount,
  });
  if (error) throw error;
  return data;
}

export async function getInventory(): Promise<Record<string, number>> {
  const { data } = await supabase.from('inventory').select('item, quantity');
  return Object.fromEntries((data ?? []).map((r) => [r.item, r.quantity]));
}

export const SHOP: { item: ShopItem; name: string; price: string; description: string; qty: number }[] = [
  {
    item: 'growth_treat',
    name: 'Growth Treats (×5)',
    price: '$0.99',
    description: 'Each treat counts as a daily feed and grants +50% XP. Daily feed cap (3) still applies.',
    qty: 5,
  },
  {
    item: 'age_tonic',
    name: 'Age Tonic',
    price: '$2.99',
    description: 'Instantly age up one animal. 7-day cooldown per animal. Animal must be ≥24h old.',
    qty: 1,
  },
];
