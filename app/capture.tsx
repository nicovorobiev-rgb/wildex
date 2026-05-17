import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { identifyAnimal, type IdSuggestion } from '../lib/inaturalist';
import { rollStats } from '../lib/stats';
import { uploadCaptureImage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function Capture() {
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdSuggestion[] | null>(null);

  if (!perm) return <View style={styles.root} />;
  if (!perm.granted) {
    return (
      <View style={styles.root}>
        <Text style={styles.text}>Camera permission required.</Text>
        <Pressable style={styles.btn} onPress={requestPerm}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  async function snap() {
    if (!camRef.current) return;
    setBusy(true);
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 0.7, base64: false, exif: true });
      if (!photo) return;

      let coords: { latitude: number; longitude: number } | null = null;
      const loc = await Location.getForegroundPermissionsAsync();
      if (loc.granted) {
        const pos = await Location.getCurrentPositionAsync({});
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      }

      const suggestions = await identifyAnimal(photo.uri);
      setResult(suggestions);

      const top = suggestions[0];
      if (!top) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const captureId = `${user.id}-${Date.now()}`;
        const stats = rollStats(captureId, top);
        const imageUrl = await uploadCaptureImage(photo.uri, captureId).catch(() => null);
        await supabase.from('captures').insert({
          id: captureId,
          user_id: user.id,
          taxon_id: top.taxonId,
          common_name: top.commonName,
          scientific_name: top.scientificName,
          score: top.score,
          stats,
          lat: coords?.latitude ?? null,
          lng: coords?.longitude ?? null,
          image_url: imageUrl,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.overlay}>
        {busy && <ActivityIndicator size="large" color="#7be39a" />}
        {result && result[0] && (
          <View style={styles.idCard}>
            <Text style={styles.idTitle}>{result[0].commonName}</Text>
            <Text style={styles.idSub}>{result[0].scientificName}</Text>
            <Text style={styles.idScore}>{(result[0].score * 100).toFixed(0)}% match</Text>
            <Pressable style={styles.btn} onPress={() => router.push('/dex')}>
              <Text style={styles.btnText}>Add to dex</Text>
            </Pressable>
          </View>
        )}
        {!result && (
          <Pressable style={styles.shutter} onPress={snap} disabled={busy}>
            <View style={styles.shutterInner} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 32, gap: 16 },
  text: { color: '#e7f5ec', fontSize: 16 },
  shutter: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  idCard: {
    backgroundColor: 'rgba(11,29,18,0.95)', padding: 20, borderRadius: 16,
    width: '100%', gap: 6, alignItems: 'center',
  },
  idTitle: { color: '#7be39a', fontSize: 22, fontWeight: '700' },
  idSub: { color: '#9fb9aa', fontStyle: 'italic' },
  idScore: { color: '#e7f5ec', marginBottom: 8 },
  btn: { padding: 14, borderRadius: 10, backgroundColor: '#2bbd6a', width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
