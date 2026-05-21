// components/theme.ts — Wildex v0.2 design tokens.
// SINGLE source of truth for all components. Mirrors spec/design-brief.md §2-§4.
// Zero React/RN imports — pure values, importable from anywhere.

export const colors = {
  bg: {
    canvas:      '#0b1d12',
    surface:     '#0f2418',
    surfaceAlt:  '#16321f',
    elevated:    '#1a3d27',
    overlay:     'rgba(11,29,18,0.95)',
  },
  text: {
    primary:     '#e7f5ec',
    secondary:   '#9fb9aa',
    muted:       '#6b8579',
    accent:      '#7be39a',
    inverse:     '#0b1d12',
  },
  border: {
    subtle:      '#1a3d27',
    default:     '#234a32',
    focus:       '#7be39a',
  },
  brand: {
    primary:      '#2bbd6a',
    primaryHover: '#34d178',
    primaryDim:   '#1f8a4d',
  },
  element: {
    beast:   '#b6743a',
    avian:   '#7cc4e0',
    aquatic: '#3a7fc4',
    reptile: '#6fae5a',
    insect:  '#c4a83a',
    flora:   '#5fb27a',
    fungal:  '#a07acf',
    unknown: '#6b8579',
  },
  rarity: {
    common:    '#8a9a90',
    uncommon:  '#5fb27a',
    rare:      '#3a8fc4',
    epic:      '#a060d0',
    legendary: '#e0a040',
  },
  status: {
    success: '#2bbd6a',
    warning: '#e0a040',
    error:   '#d33b3b',
    info:    '#3a8fc4',
  },
} as const;

export const typography = {
  family: {
    sans:   'System',
    mono:   'ui-monospace',
    italic: 'System',
  },
  size:    { xs: 11, sm: 13, base: 15, lg: 18, xl: 22, '2xl': 32 },
  weight:  { regular: '400' as const, medium: '600' as const, bold: '700' as const, heavy: '800' as const },
  leading: { tight: 1.15, normal: 1.35, loose: 1.5 },
} as const;

export const space  = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
export const radius = { none: 0, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;
export const border = { hairline: 1, default: 2, thick: 4 } as const;

// React Native shadow tokens (iOS shadow props + Android elevation).
// Web shadow strings from design-brief are translated to RN shape here.
export const shadow = {
  card:   { shadowColor: '#000', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2,  elevation: 2  },
  raised: { shadowColor: '#000', shadowOpacity: 0.5, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 8  },
  glow:   { shadowColor: '#7be39a', shadowOpacity: 0.35, shadowOffset: { width: 0, height: 0 }, shadowRadius: 12, elevation: 0 },
} as const;

export type Element = keyof typeof colors.element;
export type Rarity  = keyof typeof colors.rarity;
