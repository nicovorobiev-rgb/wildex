// Async multiplayer. Player A picks a fighter + opens a challenge, sharing a
// friend code. Player B accepts with their own fighter. Server simulates and
// stores the result — clients re-run the same seed for animated playback.

import { simulate } from './battle';
import type { BattleStats } from './stats';
import { supabase } from './supabase';

export type Challenge = {
  id: string;
  code: string;
  challenger_id: string;
  challenger_capture: string;
  challenger_stats: BattleStats;
  opponent_id: string | null;
  opponent_capture: string | null;
  opponent_stats: BattleStats | null;
  seed: string | null;
  winner: 'a' | 'b' | null;
  created_at: string;
};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function openChallenge(captureId: string, stats: BattleStats): Promise<Challenge> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const code = genCode();
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      code,
      challenger_id: user.id,
      challenger_capture: captureId,
      challenger_stats: stats,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Challenge;
}

export async function acceptChallenge(code: string, captureId: string, stats: BattleStats) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: ch, error: e1 } = await supabase
    .from('challenges')
    .select('*')
    .eq('code', code.toUpperCase())
    .is('opponent_id', null)
    .single();
  if (e1 || !ch) throw new Error('Challenge not found or already accepted');
  if (ch.challenger_id === user.id) throw new Error("Can't fight yourself");

  const seed = `${ch.challenger_capture}:${captureId}:${ch.id}`;
  const result = simulate(ch.challenger_stats as BattleStats, stats, seed);

  const { data, error } = await supabase
    .from('challenges')
    .update({
      opponent_id: user.id,
      opponent_capture: captureId,
      opponent_stats: stats,
      seed,
      winner: result.winner,
    })
    .eq('id', ch.id)
    .select()
    .single();
  if (error) throw error;
  return { challenge: data as Challenge, result };
}

export async function listMyChallenges(): Promise<Challenge[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('challenges')
    .select('*')
    .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as Challenge[];
}
