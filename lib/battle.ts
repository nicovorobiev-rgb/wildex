// Simple deterministic 1v1 battle engine. Turn-based, alternating attackers
// (faster speed goes first). Deterministic given (a, b, seed) so battles can
// be re-simulated server-side for anti-cheat.

import type { BattleStats, Element } from './stats';
import { rng } from './rng';

export type BattleLog = { turn: number; attacker: 'a' | 'b'; damage: number; crit: boolean }[];
export type BattleResult = { winner: 'a' | 'b'; log: BattleLog };

const TYPE_CHART: Record<Element, Partial<Record<Element, number>>> = {
  beast: { insect: 1.3, avian: 1.2, reptile: 0.8 },
  avian: { insect: 1.4, reptile: 1.1, aquatic: 0.8 },
  aquatic: { flora: 0.7, beast: 1.1, fungal: 1.2 },
  reptile: { aquatic: 1.2, insect: 1.1, avian: 0.8 },
  insect: { flora: 1.4, fungal: 1.2, avian: 0.7 },
  flora: { aquatic: 1.3, beast: 0.8, fungal: 0.7 },
  fungal: { flora: 1.3, insect: 0.8, beast: 1.1 },
  unknown: {},
};

function damage(att: BattleStats, def: BattleStats, r: number): { dmg: number; crit: boolean } {
  const crit = r < 0.08;
  const base = (att.attack * 2) / Math.max(1, def.defense);
  const mult = (TYPE_CHART[att.element]?.[def.element] ?? 1) * (crit ? 1.6 : 1);
  return { dmg: Math.max(1, Math.round(base * mult * (0.9 + r * 0.2))), crit };
}

export function simulate(a: BattleStats, b: BattleStats, seed: string): BattleResult {
  const r = rng(seed);
  let hpA = a.hp;
  let hpB = b.hp;
  const log: BattleLog = [];
  const aFirst = a.speed >= b.speed;
  let turn = 0;

  while (hpA > 0 && hpB > 0 && turn < 200) {
    turn++;
    const aTurn = aFirst ? turn % 2 === 1 : turn % 2 === 0;
    if (aTurn) {
      const { dmg, crit } = damage(a, b, r());
      hpB -= dmg;
      log.push({ turn, attacker: 'a', damage: dmg, crit });
    } else {
      const { dmg, crit } = damage(b, a, r());
      hpA -= dmg;
      log.push({ turn, attacker: 'b', damage: dmg, crit });
    }
  }

  // Explicit tie-break — was implicitly 'b' on equal HP (audit Code-5).
  // Falls through stat ladder, ending in a deterministic PRNG draw.
  let winner: 'a' | 'b';
  if      (hpA !== hpB)           winner = hpA > hpB ? 'a' : 'b';
  else if (a.attack  !== b.attack)  winner = a.attack  > b.attack  ? 'a' : 'b';
  else if (a.speed   !== b.speed)   winner = a.speed   > b.speed   ? 'a' : 'b';
  else if (a.defense !== b.defense) winner = a.defense > b.defense ? 'a' : 'b';
  else                              winner = r() < 0.5 ? 'a' : 'b';
  return { winner, log };
}
