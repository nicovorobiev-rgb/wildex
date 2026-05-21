// Async multiplayer. Player A picks a fighter + opens a challenge, sharing a
// friend code. Player B accepts with their own fighter. Server simulates and
// stores the result — clients re-run the same seed for animated playback.

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
  // Crypto-secure 8 chars from a 32-char unambiguous alphabet (audit H-code-8 + M2).
  // 32^8 = ~1.1e12 codes — collision-resistant. Unique index on `challenges.code`
  // + the retry below in openChallenge handles the rare collision (audit M3).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(8);
  const g: any = globalThis;
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(buf);
  else for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[buf[i] & 31];
  return out;
}

export async function openChallenge(captureId: string, stats: BattleStats): Promise<Challenge> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Retry on unique-violation (PG 23505). With 8-char crypto codes a
  // collision is astronomically rare, but a retry loop closes audit M3.
  for (let attempt = 0; attempt < 3; attempt++) {
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
    if (!error) return data as Challenge;
    if ((error as any).code !== '23505') throw error;
  }
  throw new Error('Could not generate a unique challenge code — try again');
}

export async function acceptChallenge(code: string, captureId: string, _stats: BattleStats) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Audit M2 — never SELECT challenges by code from the client. The function
  // looks up + validates server-side under service role, and the SELECT
  // policy now hides open challenges from authenticated clients entirely.
  const { data: fnRes, error: fnErr } = await supabase.functions.invoke('accept-challenge', {
    body: { code: code.toUpperCase(), opponent_capture_id: captureId },
  });
  if (fnErr) throw fnErr;
  if (fnRes?.error) throw new Error(String(fnRes.error));

  // Re-fetch the now-resolved challenge using the id the function returned.
  const { data: updated, error: e2 } = await supabase
    .from('challenges').select('*').eq('id', fnRes.challenge_id).single();
  if (e2 || !updated) throw new Error('Could not fetch resolved challenge');
  return {
    challenge: updated as Challenge,
    result: { winner: fnRes.winner as 'a' | 'b', log: fnRes.log ?? [] },
  };
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
