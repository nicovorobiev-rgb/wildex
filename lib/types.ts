/**
 * lib/types.ts — Compatibility shim (Infra layer)
 *
 * @deprecated
 * This file is a thin re-export shim introduced in R1.8.
 * The canonical source of truth for ALL domain types is `engine/types.ts`
 * (spec/architecture.md §4, §9).
 *
 * R3.5 expanded the re-export list to include Challenge, Battle, Friend,
 * and FriendRequest — now canonical in engine/types.ts.
 * CaptureForBattle was removed in R6.3: BattleStats now includes `id` directly,
 * and simulateBattle accepts BattleStats. Use BattleStats (or BattleInput from
 * engine/battle.ts) instead.
 *
 * TODO(post-v0.2): Delete this file and migrate every `from "@/lib/types"`
 * import to `from "@/engine/types"` directly.
 */

// Re-export every type from engine/types so all existing `from "@/lib/types"`
// import sites continue to resolve without modification.
// @deprecated — import from @/engine/types directly in new code.
export type {
  // Battle primitives
  Element,
  Rarity,
  BattleStats,
  Turn,
  BattleLog,
  BattleResult,
  // Capture
  StatKey,
  Stat,
  Allocated,
  Capture,
  CaptureSelect,
  // Social / multiplayer
  Challenge,
  Battle,
  Friend,
  FriendRequest,
} from '../engine/types';
