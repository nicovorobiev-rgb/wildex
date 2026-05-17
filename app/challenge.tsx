import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { acceptChallenge, listMyChallenges, openChallenge, type Challenge } from '../lib/multiplayer';
import type { BattleStats } from '../lib/stats';
import { supabase } from '../lib/supabase';

type Capture = { id: string; common_name: string; stats: BattleStats };

export default function ChallengeScreen() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [picked, setPicked] = useState<Capture | null>(null);
  const [code, setCode] = useState('');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [history, setHistory] = useState<Challenge[]>([]);

  async function refresh() {
    const { data } = await supabase.from('captures').select('id, common_name, stats').limit(20);
    if (data) setCaptures(data as Capture[]);
    setHistory(await listMyChallenges());
  }
  useEffect(() => { refresh(); }, []);

  async function challenge() {
    if (!picked) return;
    try {
      const ch = await openChallenge(picked.id, picked.stats);
      setOpenCode(ch.code);
    } catch (e: any) { Alert.alert('Failed', String(e.message ?? e)); }
  }

  async function accept() {
    if (!picked || !code) return;
    try {
      const { result } = await acceptChallenge(code, picked.id, picked.stats);
      Alert.alert('Battle done', `Winner: ${result.winner === 'a' ? 'challenger' : 'you'}`);
      setCode('');
      refresh();
    } catch (e: any) { Alert.alert('Failed', String(e.message ?? e)); }
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h}>Your fighter</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {captures.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, picked?.id === c.id && styles.chipPicked]}
            onPress={() => setPicked(c)}
          >
            <Text style={styles.chipName}>{c.common_name}</Text>
            <Text style={styles.chipMeta}>{c.stats.element} · {c.stats.rarity}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.h}>Open a challenge</Text>
      <Pressable style={[styles.btn, !picked && styles.disabled]} onPress={challenge} disabled={!picked}>
        <Text style={styles.btnText}>Generate code</Text>
      </Pressable>
      {openCode && (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Share this code</Text>
          <Text style={styles.code}>{openCode}</Text>
        </View>
      )}

      <Text style={styles.h}>Accept a code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        placeholderTextColor="#6b8579"
        autoCapitalize="characters"
        style={styles.input}
      />
      <Pressable style={[styles.btn, (!picked || !code) && styles.disabled]} onPress={accept} disabled={!picked || !code}>
        <Text style={styles.btnText}>Fight!</Text>
      </Pressable>

      <Text style={styles.h}>History</Text>
      {history.map((h) => (
        <View key={h.id} style={styles.history}>
          <Text style={styles.histCode}>{h.code}</Text>
          <Text style={styles.histResult}>{h.winner ? `winner: ${h.winner}` : 'pending'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 10 },
  h: { color: '#7be39a', fontWeight: '700', marginTop: 12 },
  row: { gap: 8 },
  chip: { padding: 10, backgroundColor: '#16321f', borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  chipPicked: { borderColor: '#7be39a' },
  chipName: { color: '#e7f5ec', fontWeight: '700' },
  chipMeta: { color: '#9fb9aa', fontSize: 11 },
  btn: { padding: 14, borderRadius: 10, backgroundColor: '#2bbd6a', alignItems: 'center' },
  disabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700' },
  codeBox: { backgroundColor: '#0f2418', padding: 16, borderRadius: 12, alignItems: 'center' },
  codeLabel: { color: '#9fb9aa', fontSize: 12, marginBottom: 4 },
  code: { color: '#7be39a', fontSize: 32, fontWeight: '800', letterSpacing: 4 },
  input: { backgroundColor: '#0f2418', color: '#e7f5ec', padding: 14, borderRadius: 10, fontSize: 16, letterSpacing: 2 },
  history: { flexDirection: 'row', justifyContent: 'space-between', padding: 10, backgroundColor: '#0f2418', borderRadius: 8 },
  histCode: { color: '#e7f5ec', fontWeight: '700' },
  histResult: { color: '#9fb9aa', fontSize: 12 },
});
