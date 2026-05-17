import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { BattleStats } from '../lib/stats';

type Capture = {
  id: string;
  common_name: string;
  scientific_name: string;
  score: number;
  stats: BattleStats;
};

export default function Dex() {
  const [items, setItems] = useState<Capture[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('captures')
        .select('id, common_name, scientific_name, score, stats')
        .order('created_at', { ascending: false });
      if (data) setItems(data as Capture[]);
    })();
  }, []);

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(c) => c.id}
      ListEmptyComponent={<Text style={styles.empty}>No captures yet. Go find something.</Text>}
      renderItem={({ item }) => (
        <View style={[styles.card, rarityStyle(item.stats.rarity)]}>
          <View style={styles.row}>
            <Text style={styles.name}>{item.common_name}</Text>
            <Text style={styles.rarity}>{item.stats.rarity}</Text>
          </View>
          <Text style={styles.sci}>{item.scientific_name}</Text>
          <View style={styles.statsRow}>
            <Stat label="HP" v={item.stats.hp} />
            <Stat label="ATK" v={item.stats.attack} />
            <Stat label="DEF" v={item.stats.defense} />
            <Stat label="SPD" v={item.stats.speed} />
            <Stat label="SPC" v={item.stats.special} />
          </View>
          <Text style={styles.element}>{item.stats.element.toUpperCase()}</Text>
        </View>
      )}
    />
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{v}</Text>
    </View>
  );
}

function rarityStyle(r: BattleStats['rarity']) {
  const map = {
    common: '#1a3324',
    uncommon: '#1b4d2e',
    rare: '#1e4d6b',
    epic: '#5a2a7a',
    legendary: '#7a5a14',
  } as const;
  return { borderColor: map[r] };
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  empty: { color: '#9fb9aa', textAlign: 'center', marginTop: 64 },
  card: { backgroundColor: '#0f2418', padding: 14, borderRadius: 12, borderWidth: 2, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#e7f5ec', fontSize: 18, fontWeight: '700' },
  rarity: { color: '#7be39a', fontSize: 11, textTransform: 'uppercase' },
  sci: { color: '#9fb9aa', fontStyle: 'italic', marginBottom: 6 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  stat: { alignItems: 'center', flex: 1 },
  statLabel: { color: '#9fb9aa', fontSize: 10 },
  statValue: { color: '#e7f5ec', fontWeight: '700' },
  element: { color: '#7be39a', fontSize: 11, marginTop: 6 },
});
