import React from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, space, typography } from './theme';
import Card from './Card';
import { ElementChip } from './ElementChip';
import { RarityBadge } from './RarityBadge';
import { Button } from './Button';
import type { Element, Rarity } from '@/engine/types';

export interface IdResultCardProps {
  commonName:     string;
  scientificName: string;
  /** Confidence score in [0, 1]. */
  confidence:     number;
  element:        Element;
  rarity:         Rarity;
  imageUri:       string;
  onAccept:       () => void;
  onRetake:       () => void;
  loading?:       boolean;
}

const SCREEN_WIDTH = Dimensions.get('window').width;

function ConfidencePct({ value }: { value: number }): React.ReactElement {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <Text style={styles.confidence}>
      {pct}
      <Text style={styles.confidenceSuffix}>% match</Text>
    </Text>
  );
}

export function IdResultCard({
  commonName,
  scientificName,
  confidence,
  element,
  rarity,
  imageUri,
  onAccept,
  onRetake,
  loading = false,
}: IdResultCardProps): React.ReactElement {
  return (
    <View style={styles.root}>
      {/* Hero image — full width, 1:1 aspect */}
      <View style={styles.heroWrap}>
        <Image
          source={{ uri: imageUri }}
          style={styles.hero}
          resizeMode="cover"
          accessibilityLabel={commonName}
        />
        {loading && (
          <View style={styles.heroOverlay}>
            <ActivityIndicator color={colors.text.accent} size="large" />
          </View>
        )}
      </View>

      {/* Detail card */}
      <Card variant="elevated" padding={4}>
        {/* Names row */}
        <View style={styles.namesRow}>
          <View style={styles.namesBlock}>
            <Text style={styles.commonName} numberOfLines={1}>
              {commonName}
            </Text>
            <Text style={styles.scientificName} numberOfLines={1}>
              {scientificName}
            </Text>
          </View>
          <RarityBadge rarity={rarity} />
        </View>

        {/* Chips + confidence */}
        <View style={styles.metaRow}>
          <ElementChip element={element} size="sm" />
          <ConfidencePct value={confidence} />
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <View style={styles.actionBtn}>
            <Button
              label="Retake"
              onPress={onRetake}
              variant="secondary"
              size="md"
              fullWidth
              disabled={loading}
            />
          </View>
          <View style={styles.actionBtn}>
            <Button
              label="Add to Dex"
              onPress={onAccept}
              variant="primary"
              size="md"
              fullWidth
              loading={loading}
            />
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  heroWrap: {
    width:        SCREEN_WIDTH,
    aspectRatio:  1,
    borderRadius: radius.lg,
    overflow:     'hidden',
    marginBottom: space[3],
  },
  hero: {
    width:  '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11,29,18,0.6)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  namesRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            space[2],
    marginBottom:   space[2],
  },
  namesBlock: {
    flex:    1,
    minWidth: 0,
    gap:     space[1],
  },
  commonName: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.lg,
    fontWeight:  typography.weight.bold,
    color:       colors.text.primary,
    lineHeight:  typography.size.lg * typography.leading.tight,
  },
  scientificName: {
    fontFamily:   typography.family.italic,
    fontSize:     typography.size.sm,
    fontWeight:   typography.weight.regular,
    fontStyle:    'italic',
    color:        colors.text.secondary,
    lineHeight:   typography.size.sm * typography.leading.normal,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           space[3],
    marginBottom:  space[4],
  },
  confidence: {
    fontFamily:  typography.family.sans,
    fontSize:    typography.size.base,
    fontWeight:  typography.weight.bold,
    color:       colors.text.accent,
  },
  confidenceSuffix: {
    fontWeight: typography.weight.regular,
    color:      colors.text.secondary,
  },
  actions: {
    flexDirection: 'row',
    gap:           space[2],
  },
  actionBtn: {
    flex: 1,
  },
});
