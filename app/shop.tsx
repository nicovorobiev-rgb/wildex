import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getOfferings, purchase } from '../lib/iap';
import { getInventory } from '../lib/growth';

export default function Shop() {
  const [packs, setPacks] = useState<any[]>([]);
  const [inv, setInv] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setPacks(await getOfferings()); } catch { /* not configured */ }
    setInv(await getInventory());
  }
  useEffect(() => { refresh(); }, []);

  async function buy(p: any) {
    setBusy(true);
    try { await purchase(p); refresh(); }
    catch (e: any) {
      if (!e?.userCancelled) Alert.alert('Purchase failed', String(e.message ?? e));
    } finally { setBusy(false); }
  }

  const isIOS = Platform.OS === 'ios';

  return (
    <View style={styles.root}>
      <View style={styles.invRow}>
        <Text style={styles.invText}>Treats: {inv.growth_treat ?? 0}</Text>
        <Text style={styles.invText}>Tonics: {inv.age_tonic ?? 0}</Text>
      </View>

      {!isIOS ? (
        <Text style={styles.notice}>
          The Wildex shop runs on the iOS App Store. On the web preview, purchases are disabled — you'll see them when the iOS app launches.
        </Text>
      ) : packs.length === 0 ? (
        <Text style={styles.notice}>
          Shop not yet configured. Set EXPO_PUBLIC_RC_API_KEY and run on a real device with App Store products active.
        </Text>
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(p) => p.identifier}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.product.title}</Text>
                <Text style={styles.desc}>{item.product.description}</Text>
              </View>
              <Pressable style={[styles.btn, busy && styles.disabled]} disabled={busy} onPress={() => buy(item)}>
                <Text style={styles.btnText}>{item.product.priceString}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  invRow: { flexDirection: 'row', justifyContent: 'space-around', padding: 12, backgroundColor: '#0f2418', borderRadius: 10 },
  invText: { color: '#7be39a', fontWeight: '700' },
  notice: { color: '#9fb9aa', textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f2418', padding: 14, borderRadius: 12, gap: 12 },
  name: { color: '#e7f5ec', fontWeight: '700', fontSize: 16 },
  desc: { color: '#9fb9aa', fontSize: 12, marginTop: 2 },
  btn: { backgroundColor: '#2bbd6a', padding: 12, paddingHorizontal: 16, borderRadius: 10 },
  disabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800' },
});
