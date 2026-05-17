import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { allocate, ageLabel, ageUp, effectiveStats, feed, getInventory, POINTS_PER_AGE_UP, STAT_LABEL, xpToNextAge, type Stat } from '../lib/growth';
import type { BattleStats } from '../lib/stats';
import { supabase } from '../lib/supabase';

type Capture = {
  id: string;
  common_name: string;
  stats: BattleStats;
  xp: number;
  age: number;
  pending_points: number;
  allocated: Record<Stat, number>;
};

export default function Grow() {
  const [items, setItems] = useState<Capture[]>([]);
  const [inv, setInv] = useState<Record<string, number>>({});

  async function refresh() {
    const { data } = await supabase
      .from('captures')
      .select('id, common_name, stats, xp, age, pending_points, allocated')
      .order('created_at', { ascending: false });
    if (data) setItems(data as Capture[]);
    setInv(await getInventory());
  }
  useEffect(() => { refresh(); }, []);

  async function doFeed(c: Capture, item: 'berry' | 'growth_treat') {
    try { await feed(c.id, item); refresh(); }
    catch (e: any) { Alert.alert('Cannot feed', String(e.message ?? e)); }
  }

  async function doAge(c: Capture, tonic: boolean) {
    try { await ageUp(c.id, tonic); refresh(); }
    catch (e: any) { Alert.alert('Cannot age up', String(e.message ?? e)); }
  }

  async function doAllocate(c: Capture, stat: Stat) {
    try { await allocate(c.id, stat, 1); refresh(); }
    catch (e: any) { Alert.alert('Cannot allocate', String(e.message ?? e)); }
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.invRow}>
        <Text style={styles.invText}>Treats: {inv.growth_treat ?? 0}</Text>
        <Text style={styles.invText}>Tonics: {inv.age_tonic ?? 0}</Text>
      </View>

      {items.map((c) => {
        const eff = effectiveStats(c.stats, c.allocated);
        const nextXp = xpToNextAge(c.age);
        const canAgeFree = c.xp >= nextXp && c.age < 10;
        return (
          <View key={c.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>{c.common_name}</Text>
              <Text style={styles.age}>{ageLabel(c.age)} · Age {c.age}</Text>
            </View>

            <Text style={styles.xp}>XP {c.xp} / {nextXp}</Text>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.min(100, (c.xp / nextXp) * 100)}%` }]} /></View>

            <View style={styles.statsGrid}>
              {(['hp','attack','defense','speed','special'] as Stat[]).map((s) => (
                <View key={s} style={styles.statCell}>
                  <Text style={styles.statLabel}>{STAT_LABEL[s]}</Text>
                  <Text style={styles.statValue}>
                    {eff[s]}
                    {c.allocated[s] > 0 && <Text style={styles.statBonus}> (+{c.allocated[s]})</Text>}
                  </Text>
                  {c.pending_points > 0 && (
                    <Pressable style={styles.plus} onPress={() => doAllocate(c, s)}>
                      <Text style={styles.plusText}>+</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>

            {c.pending_points > 0 && (
              <Text style={styles.pending}>{c.pending_points} unspent points</Text>
            )}

            <View style={styles.btnRow}>
              <Pressable style={[styles.btn, styles.btnFeed]} onPress={() => doFeed(c, 'berry')}>
                <Text style={styles.btnText}>Feed berry</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnTreat, !inv.growth_treat && styles.disabled]}
                onPress={() => doFeed(c, 'growth_treat')}
                disabled={!inv.growth_treat}
              >
                <Text style={styles.btnText}>Treat</Text>
              </Pressable>
            </View>

            <View style={styles.btnRow}>
              <Pressable
                style={[styles.btn, styles.btnAge, !canAgeFree && styles.disabled]}
                onPress={() => doAge(c, false)}
                disabled={!canAgeFree}
              >
                <Text style={styles.btnText}>Age up</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnTonic, !inv.age_tonic && styles.disabled]}
                onPress={() => doAge(c, true)}
                disabled={!inv.age_tonic}
              >
                <Text style={styles.btnText}>Use tonic</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 12 },
  invRow: { flexDirection: 'row', justifyContent: 'space-around', padding: 12, backgroundColor: '#0f2418', borderRadius: 10 },
  invText: { color: '#7be39a', fontWeight: '700' },
  card: { backgroundColor: '#0f2418', padding: 14, borderRadius: 12, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#e7f5ec', fontSize: 18, fontWeight: '700' },
  age: { color: '#7be39a', fontSize: 12 },
  xp: { color: '#9fb9aa', fontSize: 12 },
  bar: { height: 6, backgroundColor: '#16321f', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#2bbd6a' },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  statCell: { alignItems: 'center', flex: 1 },
  statLabel: { color: '#9fb9aa', fontSize: 10 },
  statValue: { color: '#e7f5ec', fontWeight: '700' },
  statBonus: { color: '#7be39a', fontSize: 11 },
  plus: { marginTop: 4, backgroundColor: '#2bbd6a', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: '#fff', fontWeight: '800' },
  pending: { color: '#7be39a', textAlign: 'center', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  btnFeed: { backgroundColor: '#2bbd6a' },
  btnTreat: { backgroundColor: '#3a8a55' },
  btnAge: { backgroundColor: '#1e4d6b' },
  btnTonic: { backgroundColor: '#7a5a14' },
  btnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.35 },
});
