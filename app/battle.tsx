import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { simulate, type BattleResult } from '../lib/battle';
import type { BattleStats } from '../lib/stats';
import { supabase } from '../lib/supabase';

type Capture = { id: string; common_name: string; stats: BattleStats };

export default function Battle() {
  const [roster, setRoster] = useState<Capture[]>([]);
  const [a, setA] = useState<Capture | null>(null);
  const [b, setB] = useState<Capture | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('captures').select('id, common_name, stats').limit(20);
      if (data) setRoster(data as Capture[]);
    })();
  }, []);

  function fight() {
    if (!a || !b) return;
    setResult(simulate(a.stats, b.stats, `${a.id}:${b.id}:${Date.now()}`));
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Pick your fighter</Text>
      <Roster items={roster} picked={a} onPick={setA} />
      <Text style={styles.title}>Pick opponent</Text>
      <Roster items={roster} picked={b} onPick={setB} />

      <Pressable style={[styles.fight, (!a || !b) && styles.disabled]} onPress={fight} disabled={!a || !b}>
        <Text style={styles.fightText}>FIGHT</Text>
      </Pressable>

      {result && (
        <View style={styles.result}>
          <Text style={styles.winner}>
            Winner: {result.winner === 'a' ? a?.common_name : b?.common_name}
          </Text>
          {result.log.slice(-10).map((l, i) => (
            <Text key={i} style={styles.logLine}>
              T{l.turn} — {l.attacker === 'a' ? a?.common_name : b?.common_name} hit for {l.damage}
              {l.crit ? ' (crit!)' : ''}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Roster({
  items, picked, onPick,
}: { items: Capture[]; picked: Capture | null; onPick: (c: Capture) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roster}>
      {items.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.chip, picked?.id === c.id && styles.chipPicked]}
          onPress={() => onPick(c)}
        >
          <Text style={styles.chipName}>{c.common_name}</Text>
          <Text style={styles.chipMeta}>{c.stats.element} · {c.stats.rarity}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 12 },
  title: { color: '#7be39a', fontWeight: '700', fontSize: 16, marginTop: 8 },
  roster: { gap: 8, paddingVertical: 4 },
  chip: { padding: 10, backgroundColor: '#16321f', borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  chipPicked: { borderColor: '#7be39a' },
  chipName: { color: '#e7f5ec', fontWeight: '700' },
  chipMeta: { color: '#9fb9aa', fontSize: 11 },
  fight: {
    padding: 18, borderRadius: 12, backgroundColor: '#d33b3b', alignItems: 'center', marginTop: 16,
  },
  disabled: { opacity: 0.4 },
  fightText: { color: '#fff', fontWeight: '800', fontSize: 18, letterSpacing: 2 },
  result: { marginTop: 16, padding: 14, backgroundColor: '#0f2418', borderRadius: 12, gap: 4 },
  winner: { color: '#7be39a', fontWeight: '800', fontSize: 18, marginBottom: 8 },
  logLine: { color: '#9fb9aa', fontSize: 12 },
});
