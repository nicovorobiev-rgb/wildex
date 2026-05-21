'use client';
/**
 * app/capture.tsx — Wildex v0.2 Capture screen (R5.2 rewrite).
 *
 * Flow:
 *   1. Permission gate — request camera on mount; deny → explanation + settings link.
 *   2. Full-screen camera preview with HUD (back button + ShutterButton).
 *   3. ShutterButton press → takePictureAsync (base64 disabled, uri + exif).
 *   4. iNat identification → loading state → IdResultCard with top suggestion.
 *   5. "Retake" → back to camera preview. "Add to Dex" → useCreateCapture mutation.
 *   6. Success → router.push('/dex') with captureId param. Failures → Alert.
 *
 * Constraints:
 *   - No direct supabase calls — storage upload goes through useCreateCapture.
 *   - Top-level View (not Screen) so CameraView is full-bleed.
 *   - Web platform shows an unsupported stub.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { IdResultCard } from '@/components/IdResultCard';
import { ShutterButton } from '@/components/ShutterButton';
import { colors, space, typography } from '@/components/theme';
import { ELEMENT_MAP, RARITY_THRESHOLDS } from '@/engine/stats';
import type { Element, Rarity } from '@/engine/types';
import { useCreateCapture } from '@/hooks/useCaptures';
import { identifyAnimal, type IdSuggestion } from '@/lib/inaturalist';

// ---------------------------------------------------------------------------
// Env — iNat API token (optional; undefined is valid for dev/anonymous tier).
// ---------------------------------------------------------------------------

const INAT_TOKEN: string | undefined =
  process.env.EXPO_PUBLIC_INAT_TOKEN ?? undefined;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive game Element from iNat iconic taxon string. */
function elementFromIconicTaxon(iconicTaxon: string | null): Element {
  if (!iconicTaxon) return 'unknown';
  return ELEMENT_MAP[iconicTaxon] ?? 'unknown';
}

/** Derive game Rarity from iNat confidence score in [0, 1]. */
function rarityFromScore(score: number): Rarity {
  for (const [threshold, rarity] of RARITY_THRESHOLDS) {
    if (score > threshold) return rarity;
  }
  return 'common';
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

type Phase =
  | { tag: 'camera' }
  | { tag: 'identifying' }
  | { tag: 'result';   suggestion: IdSuggestion; photoUri: string }
  | { tag: 'saving';   suggestion: IdSuggestion; photoUri: string };

// ---------------------------------------------------------------------------
// Web stub
// ---------------------------------------------------------------------------

function WebUnsupported(): React.ReactElement {
  return (
    <View style={styles.centeredRoot}>
      <Ionicons name="camera-outline" size={48} color={colors.text.muted} />
      <Text style={styles.permTitle}>Camera not available on web</Text>
      <Text style={styles.permBody}>
        Safari restricts camera APIs we rely on. Use the Wildex iOS app to photograph creatures.
      </Text>
      <Pressable style={styles.settingsBtn} onPress={() => router.back()}>
        <Text style={styles.settingsBtnText}>Go back</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Permission denied view
// ---------------------------------------------------------------------------

function PermissionDenied({
  onRequest,
}: {
  onRequest: () => void;
}): React.ReactElement {
  function openSettings() {
    Linking.openSettings();
  }

  return (
    <View style={styles.centeredRoot}>
      <Ionicons name="camera-outline" size={48} color={colors.text.muted} />
      <Text style={styles.permTitle}>Camera access required</Text>
      <Text style={styles.permBody}>
        Wildex needs the camera to photograph animals. Grant access in Settings or tap below.
      </Text>
      <Pressable style={styles.settingsBtn} onPress={onRequest}>
        <Text style={styles.settingsBtnText}>Grant access</Text>
      </Pressable>
      <Pressable style={styles.ghostBtn} onPress={openSettings}>
        <Text style={styles.ghostBtnText}>Open Settings</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Camera HUD overlay
// ---------------------------------------------------------------------------

function CameraHUD({
  phase,
  onBack,
  onShutter,
}: {
  phase: Phase;
  onBack: () => void;
  onShutter: () => void;
}): React.ReactElement {
  const isBusy = phase.tag === 'identifying' || phase.tag === 'saving';
  const shutterVisible = phase.tag === 'camera' || phase.tag === 'identifying';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Top gradient bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.backBtn}
          onPress={onBack}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={28} color={colors.text.primary} />
        </Pressable>
      </View>

      {/* Bottom bar with shutter */}
      {shutterVisible && (
        <View style={styles.bottomBar}>
          <ShutterButton
            onPress={onShutter}
            capturing={isBusy}
            disabled={isBusy}
          />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function CaptureScreen(): React.ReactElement {
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>({ tag: 'camera' });

  const createCapture = useCreateCapture();

  // -- Web platform guard (expo-camera web shim unreliable on Safari) ---------
  if (Platform.OS === 'web') {
    return <WebUnsupported />;
  }

  // -- Permission loading -------------------------------------------------------
  if (!perm) {
    return <View style={styles.blackRoot} />;
  }

  // -- Permission denied --------------------------------------------------------
  if (!perm.granted) {
    return <PermissionDenied onRequest={requestPerm} />;
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleShutter() {
    if (phase.tag !== 'camera') return;
    const cam = camRef.current;
    if (!cam) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch { /* optional */ }

    setPhase({ tag: 'identifying' });

    let photoUri = '';
    try {
      const photo = await cam.takePictureAsync({
        quality: 0.8,
        base64: false,
        exif: true,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        Alert.alert('Capture failed', 'Could not read photo from camera. Please try again.');
        setPhase({ tag: 'camera' });
        return;
      }
      photoUri = photo.uri;
    } catch (err) {
      Alert.alert('Capture failed', err instanceof Error ? err.message : String(err));
      setPhase({ tag: 'camera' });
      return;
    }

    let suggestions: IdSuggestion[] = [];
    try {
      suggestions = await identifyAnimal(photoUri, INAT_TOKEN);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface iNat 429 gracefully (spec §2.11)
      const body = msg.includes('429')
        ? 'Rate-limited by iNaturalist — try again in a minute.'
        : `Could not identify the creature: ${msg}`;
      Alert.alert('Identification failed', body);
      setPhase({ tag: 'camera' });
      return;
    }

    const top = suggestions[0];
    if (!top) {
      Alert.alert(
        'No match',
        'Could not identify the creature. Try again with better lighting and a clearer view of the animal.',
      );
      setPhase({ tag: 'camera' });
      return;
    }

    setPhase({ tag: 'result', suggestion: top, photoUri });
  }

  function handleRetake() {
    setPhase({ tag: 'camera' });
  }

  function handleBack() {
    if (phase.tag === 'saving') return; // block nav during save
    router.back();
  }

  const handleAddToDex = useCallback(async () => {
    if (phase.tag !== 'result') return;
    const { suggestion, photoUri } = phase;

    setPhase({ tag: 'saving', suggestion, photoUri });

    try {
      const capture = await createCapture.mutateAsync({
        localImageUri: photoUri,
        taxon_id: suggestion.taxonId,
        common_name: suggestion.commonName,
        scientific_name: suggestion.scientificName,
        score: suggestion.score,
      });

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch { /* optional */ }

      // Navigate to dex with the new capture selected.
      router.push({ pathname: '/dex', params: { captureId: capture.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Save failed', msg);
      // Return to result card so the user can retry or retake.
      setPhase({ tag: 'result', suggestion, photoUri });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Narrow to phases that carry suggestion + photoUri (result or saving).
  const resultPhase =
    phase.tag === 'result' || phase.tag === 'saving' ? phase : null;

  return (
    <View style={styles.root}>
      {/* Full-bleed camera */}
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing="back"
      />

      {/* Camera HUD (back button + shutter) */}
      <CameraHUD
        phase={phase}
        onBack={handleBack}
        onShutter={handleShutter}
      />

      {/* Result card — shown after identification, sits over the frozen preview */}
      {resultPhase !== null && (
        <View style={styles.resultSheet}>
          <IdResultCard
            commonName={resultPhase.suggestion.commonName}
            scientificName={resultPhase.suggestion.scientificName}
            confidence={resultPhase.suggestion.score}
            element={elementFromIconicTaxon(resultPhase.suggestion.iconicTaxon)}
            rarity={rarityFromScore(resultPhase.suggestion.score)}
            imageUri={resultPhase.photoUri}
            onAccept={handleAddToDex}
            onRetake={handleRetake}
            loading={phase.tag === 'saving'}
          />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Full-bleed root — no Screen wrapper so camera is truly full-bleed.
  root: {
    flex:            1,
    backgroundColor: '#000',
  },
  blackRoot: {
    flex:            1,
    backgroundColor: '#000',
  },
  // Permission / web unsupported views
  centeredRoot: {
    flex:            1,
    backgroundColor: colors.bg.canvas,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: space[6],
    gap:             space[4],
  },
  permTitle: {
    color:      colors.text.primary,
    fontSize:   typography.size.xl,
    fontWeight: typography.weight.bold,
    textAlign:  'center',
  },
  permBody: {
    color:      colors.text.secondary,
    fontSize:   typography.size.base,
    textAlign:  'center',
    lineHeight: typography.size.base * typography.leading.normal,
  },
  settingsBtn: {
    backgroundColor:   colors.brand.primary,
    paddingVertical:   space[3],
    paddingHorizontal: space[8],
    borderRadius:      10,
    minWidth:          200,
    alignItems:        'center',
  },
  settingsBtnText: {
    color:      colors.text.inverse,
    fontSize:   typography.size.base,
    fontWeight: typography.weight.bold,
  },
  ghostBtn: {
    paddingVertical:   space[3],
    paddingHorizontal: space[8],
    minWidth:          200,
    alignItems:        'center',
  },
  ghostBtnText: {
    color:     colors.text.accent,
    fontSize:  typography.size.base,
    fontWeight: typography.weight.medium,
  },
  // Camera HUD
  topBar: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    paddingTop:      56, // safe-area approximation (no SafeAreaView on camera)
    paddingBottom:   space[4],
    paddingHorizontal: space[4],
    flexDirection:   'row',
    alignItems:      'center',
    // Subtle gradient-like overlay so icons are legible over any scene
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  backBtn: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
  },
  bottomBar: {
    position:        'absolute',
    bottom:          48, // above home indicator
    left:            0,
    right:           0,
    alignItems:      'center',
    paddingBottom:   space[4],
  },
  // Result sheet — sits over the (frozen) camera preview at bottom
  resultSheet: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    padding:         space[4],
    paddingBottom:   space[8],
    backgroundColor: colors.bg.overlay,
  },
});
