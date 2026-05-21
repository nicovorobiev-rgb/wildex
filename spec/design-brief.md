# Wildex v0.2 — Visual Design Brief

Self-contained brief for the next-wave build agents. Source of truth for tokens, components, and per-screen layouts. Mobile-first (iPhone 14 viewport, 390×844 pt). Expo / React Native, native-first. Web is a static preview SPA — do not design web-only features.

---

## 1. Mood & References

Warm, mossy, "field-naturalist at dusk." The existing splash (`#0b1d12`) and accent (`#7be39a`, `#2bbd6a`) anchor the brand in dim-forest dark. The look should feel like a hand-bound field journal lit by a phone screen — naturalistic, slightly tactile, never neon. The game layer (stats, rarity, battles) borrows restrained game-UI conventions: chunky stat blocks, element/rarity chips, rare flashes of saturated color only on rarity reveals and crit damage.

References to mimic, in order of weight:
1. **Pokémon Sleep** — warm dark UI, rounded cards, soft glow accents on key moments.
2. **iNaturalist** — taxonomy chips, species cards, scientific-italic typography, low-chroma palette.
3. **Halide / Obscura camera apps** — minimalist camera overlay, single dominant shutter, restrained HUD.
4. **Monster Hunter Now** — rarity tier color language, stat-block hierarchy on creature cards.
5. **Things 3** — restraint, generous spacing, type-driven hierarchy without ornament.

---

## 2. Color Tokens

All extracted or extended from the existing palette. Single dark theme — see §7.

```json
{
  "bg": {
    "canvas":      "#0b1d12",
    "surface":     "#0f2418",
    "surfaceAlt":  "#16321f",
    "elevated":    "#1a3d27",
    "overlay":     "rgba(11,29,18,0.95)"
  },
  "text": {
    "primary":     "#e7f5ec",
    "secondary":   "#9fb9aa",
    "muted":       "#6b8579",
    "accent":      "#7be39a",
    "inverse":     "#0b1d12"
  },
  "border": {
    "subtle":      "#1a3d27",
    "default":     "#234a32",
    "focus":       "#7be39a"
  },
  "brand": {
    "primary":     "#2bbd6a",
    "primaryHover":"#34d178",
    "primaryDim":  "#1f8a4d"
  },
  "element": {
    "beast":       "#b6743a",
    "avian":       "#7cc4e0",
    "aquatic":     "#3a7fc4",
    "reptile":     "#6fae5a",
    "insect":      "#c4a83a",
    "flora":       "#5fb27a",
    "fungal":      "#a07acf"
  },
  "rarity": {
    "common":      "#8a9a90",
    "uncommon":    "#5fb27a",
    "rare":        "#3a8fc4",
    "epic":        "#a060d0",
    "legendary":   "#e0a040"
  },
  "status": {
    "success":     "#2bbd6a",
    "warning":     "#e0a040",
    "error":       "#d33b3b",
    "info":        "#3a8fc4"
  }
}
```

Notes:
- `rarity.*` matches the existing `dex.tsx` border-color map but lifts saturation so chips read against `bg.surface`.
- `element.*` uses iNaturalist-adjacent natural hues; never use brand green for an element to avoid collision with primary CTAs.
- The fight button red (`#d33b3b`) becomes `status.error` and is reused for damage-taken animations.

---

## 3. Typography

System fonts only (no custom font shipping in v0.2 — keeps bundle small and respects platform feel). iOS: SF Pro. Android: Roboto. Scientific names use the system italic.

```json
{
  "family": {
    "sans":   "System",
    "mono":   "ui-monospace, Menlo, monospace",
    "italic": "System (italic style)"
  },
  "size":   { "xs": 11, "sm": 13, "base": 15, "lg": 18, "xl": 22, "2xl": 32 },
  "weight": { "regular": "400", "medium": "600", "bold": "700", "heavy": "800" },
  "leading":{ "tight": 1.15, "normal": 1.35, "loose": 1.5 }
}
```

Rules:
- `2xl/heavy` reserved for the wordmark on Home and rarity reveal moments only.
- Stat values: `base/bold`. Stat labels: `xs/medium` in `text.secondary`.
- Scientific names: `sm/regular italic` in `text.secondary`.
- Body text caps at `base`; never use `xs` for anything tappable.
- Line height `tight` for headings; `normal` for body; `loose` only for empty-state copy.

---

## 4. Spacing & Radius

4-pt grid. Match React Native's natural integer pixel rendering.

```json
{
  "space":  { "0": 0, "1": 4, "2": 8, "3": 12, "4": 16, "5": 20, "6": 24, "8": 32, "10": 40, "12": 48 },
  "radius": { "none": 0, "sm": 6, "md": 10, "lg": 14, "xl": 20, "pill": 999 },
  "border": { "hairline": 1, "default": 2, "thick": 4 },
  "shadow": {
    "card":   "0 1px 2px rgba(0,0,0,0.4)",
    "raised": "0 4px 12px rgba(0,0,0,0.5)",
    "glow":   "0 0 12px rgba(123,227,154,0.35)"
  }
}
```

Default screen padding: `space.4` (16). Card internal padding: `space.4`. Vertical rhythm between sections: `space.6` (24). Touch targets: 44×44 pt minimum (Apple HIG).

---

## 5. Core Components

Build into `components/` (currently empty per audit). Each is platform-agnostic React Native, accepts a `style` override prop, and pulls all colors/spacing from `theme.ts`.

| # | Component | Purpose | Key props | Used by |
|---|---|---|---|---|
| 1 | `Screen` | Root container: safe-area, default padding, dark bg | `padded?`, `scroll?` | all screens |
| 2 | `Text` | Themed Text wrapper | `variant: 'h1'\|'h2'\|'body'\|'caption'\|'mono'`, `tone` | all screens |
| 3 | `Button` | Primary tappable | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'`, `loading`, `disabled`, `iconLeft` | index, capture, battle, sign-in, shop |
| 4 | `IconButton` | Square icon-only button | `icon`, `size`, `tone` | capture (close), challenge (back) |
| 5 | `Card` | Surface container with optional border tone | `tone?: rarity \| element`, `padding` | dex, grow, challenge |
| 6 | `StatRow` | Horizontal HP/ATK/DEF/SPD/SPC strip | `stats: BattleStats`, `delta?: Partial<BattleStats>` | dex, grow, battle (preview), challenge |
| 7 | `StatBar` | Single labeled animated bar | `label`, `value`, `max`, `tone` | battle (active HP) |
| 8 | `ElementChip` | Pill showing element with element color | `element: Element` | dex, battle, challenge, grow |
| 9 | `RarityBadge` | Small uppercase rarity label w/ rarity color | `rarity: Rarity` | dex, capture (reveal), challenge |
| 10 | `CaptureCard` | Full-width creature card: name + sci + stats + chips + thumb | `capture`, `onPress?` | dex (list item), grow |
| 11 | `CaptureChip` | Compact horizontal-scroll picker chip | `capture`, `selected`, `onPick` | battle, challenge (replaces inline `Roster`) |
| 12 | `BattleSlot` | Large active-fighter card during a fight | `capture`, `hp`, `isAttacking` | battle |
| 13 | `BattleLogLine` | Single turn entry in the battle log | `turn`, `actor`, `damage`, `crit?` | battle |
| 14 | `ShutterButton` | Camera capture button | `busy`, `onPress` | capture |
| 15 | `CameraOverlay` | Top/bottom gradient + framing guides over CameraView | `topSlot?`, `bottomSlot?` | capture |
| 16 | `IdResultCard` | Bottom-sheet style ID match card | `commonName`, `scientificName`, `score`, `rarity`, `onAccept` | capture |
| 17 | `EmptyState` | Centered illustration + copy + CTA | `title`, `body`, `cta?` | dex, challenge, grow (no captures) |
| 18 | `SectionHeader` | Small all-caps label above a list | `label`, `accessoryRight?` | battle, challenge, shop |
| 19 | `FormField` | Labeled input wrapper | `label`, `error?`, children | sign-in, challenge (friend code) |
| 20 | `Divider` | 1-px subtle separator | `inset?` | dex, shop |
| 21 | `Toast` | Top-of-screen ephemeral feedback | `tone`, `message` | capture (id failed), battle (win/loss), shop |
| 22 | `LoadingPulse` | Skeleton block matching CaptureCard shape | `count?` | dex, grow loading states |
| 23 | `RarityReveal` | Full-screen overlay that flashes rarity on first reveal | `rarity`, `onDismiss` | capture (after successful ID) |
| 24 | `FriendCodeChip` | Mono-spaced 6-char code with copy affordance | `code`, `onCopy` | challenge |
| 25 | `PaywallSheet` | Bottom sheet listing subscription value props + CTA | `offering`, `onPurchase` | shop |

---

## 6. Per-Screen Layouts

iPhone 14 viewport (390×844). All sketches show portrait orientation. Safe-area top ≈ 47, bottom ≈ 34.

### 6.1 `index` (Home)

```
┌──────────────────────────────────────┐
│ [safe area]                          │
│                                      │
│              WILDEX                  │  ← Text h1 (2xl/heavy, accent)
│   Photograph. Collect. Battle.       │  ← Text caption (sm, secondary)
│                                      │
│  ┌────────────────────────────────┐  │
│  │         📷  Capture            │  │  ← Button primary
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │         📔  My Dex             │  │  ← Button secondary
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │         🌱  Grow & Feed        │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │         ⚔️  Local Battle       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │         🤝  Challenges         │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │         💎  Shop               │  │
│  └────────────────────────────────┘  │
│                                      │
│      Signed in as nico@…  · out      │  ← Text caption muted
└──────────────────────────────────────┘
```
Components: `Screen`, `Text`, `Button` ×6, `IconButton` (sign-out).
Flow: (1) Auth-gated mount checks session → (2) tap any card to navigate → (3) sign-out chip at bottom for account swap.

### 6.2 `capture`

```
┌──────────────────────────────────────┐
│ ╔══════════════════════════════════╗ │  ← top gradient (CameraOverlay)
│ ║ ✕                            ⚡  ║ │  ← close · flash toggle (future)
│ ║                                  ║ │
│ ║       [ live camera feed ]       ║ │  ← CameraView fullscreen
│ ║                                  ║ │
│ ║         ┌──────────┐             ║ │  ← framing guides (subtle)
│ ║         │          │             ║ │
│ ║         └──────────┘             ║ │
│ ║                                  ║ │
│ ║                                  ║ │
│ ║              ◯  ← ShutterButton  ║ │
│ ║                                  ║ │
│ ╚══════════════════════════════════╝ │  ← bottom gradient
└──────────────────────────────────────┘

After snap (IdResultCard slides up):
┌──────────────────────────────────────┐
│  ┌────────────────────────────────┐  │
│  │  Western Honey Bee     RARE    │  │
│  │  Apis mellifera                │  │
│  │  ●●●●●○○  87% match            │  │
│  │  [insect]                      │  │
│  │  ┌──────────────────────────┐  │  │
│  │  │     Add to dex           │  │  │
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```
Components: `CameraOverlay`, `IconButton`, `ShutterButton`, `IdResultCard` (uses `RarityBadge`, `ElementChip`, `Button`), `RarityReveal` for epic/legendary first hits.
Flow: (1) permission gate → (2) frame + shoot → (3) busy spinner during iNat call → (4) `IdResultCard` with accept/retry; epic+ triggers `RarityReveal`.

### 6.3 `dex`

```
┌──────────────────────────────────────┐
│  My Dex                       [⌕]    │  ← header (Text h2 + IconButton)
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Western Honey Bee       RARE   │  │  ← CaptureCard
│  │ Apis mellifera                 │  │
│  │ HP  ATK  DEF  SPD  SPC         │  │  ← StatRow
│  │ 42   38   29   55   31         │  │
│  │ [insect]                       │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Mallard Duck         COMMON    │  │
│  │ Anas platyrhynchos             │  │
│  │ ...                            │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ...                            │  │
│                                      │
└──────────────────────────────────────┘
```
Components: `Screen` (scroll), `SectionHeader`, `CaptureCard` (composes `RarityBadge`, `StatRow`, `ElementChip`), `EmptyState`, `LoadingPulse`.
Flow: (1) hook fetches `useCaptures()` → (2) sorted newest-first → (3) tap card → detail view (post-v0.2).

### 6.4 `battle`

```
┌──────────────────────────────────────┐
│  Local Battle                        │
│                                      │
│  PICK YOUR FIGHTER                   │  ← SectionHeader
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ →         │  ← CaptureChip horizontal scroll
│  └──┘ └──┘ └──┘ └──┘ └──┘            │
│                                      │
│  PICK OPPONENT                       │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ →               │
│  └──┘ └──┘ └──┘ └──┘                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           FIGHT                │  │  ← Button danger
│  └────────────────────────────────┘  │
│                                      │
│  ─────── result ───────              │
│  Winner: Honey Bee                   │
│  T1 — Bee hit for 14                 │  ← BattleLogLine ×N
│  T2 — Duck hit for 9 (crit!)         │
│  ...                                 │
│  seed: bee:duck:1718...              │  ← mono caption
└──────────────────────────────────────┘
```
Components: `SectionHeader` ×2, `CaptureChip` ×N, `Button` (FIGHT), `BattleSlot` (during active animation phase, post-tap), `StatBar` (HP), `BattleLogLine`, `Text` mono for seed.
Flow: (1) load roster via `useCaptures()` → (2) pick A, pick B → (3) FIGHT → animated `BattleSlot` HP bars descend, log appends per turn → (4) winner card.

### 6.5 `auth` / `sign-in` (v0.2 needs polish)

```
┌──────────────────────────────────────┐
│                                      │
│              WILDEX                  │
│       Sign in to save captures       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │       Continue with Apple      │  │  ← Button primary (white on iOS HIG)
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │       Continue with Google     │  │  ← Button secondary
│  └────────────────────────────────┘  │
│                                      │
│  ─────────── or ─────────────        │  ← Divider with inline label
│                                      │
│  Email                               │
│  ┌────────────────────────────────┐  │
│  │ you@example.com                │  │  ← FormField (TextInput)
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │       Email me a code          │  │
│  └────────────────────────────────┘  │
│                                      │
│  By signing in you agree to ToS      │  ← Text caption muted
└──────────────────────────────────────┘
```
Components: `Screen`, `Text`, `Button` ×3, `Divider`, `FormField`, `Toast` (for OTP errors).
Flow: (1) tap Apple/Google → native flow → home; or (2) enter email → submit OTP → enter code → home.

### 6.6 `challenge` (friends / async battles)

```
┌──────────────────────────────────────┐
│  Challenges                          │
│                                      │
│  YOUR CODE                           │
│  ┌────────────────────────────────┐  │
│  │  W3K-9PX           [copy]      │  │  ← FriendCodeChip
│  └────────────────────────────────┘  │
│  Share with a friend to be challenged│  ← Text caption secondary
│                                      │
│  ENTER A CODE                        │
│  ┌────────────────────────────────┐  │
│  │  ______                        │  │  ← FormField mono
│  └────────────────────────────────┘  │
│                                      │
│  PICK YOUR FIGHTER                   │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ →               │  ← CaptureChip
│  └──┘ └──┘ └──┘ └──┘                 │
│                                      │
│  ┌────────────────────────────────┐  │
│  │       Send challenge           │  │  ← Button primary
│  └────────────────────────────────┘  │
│                                      │
│  RECENT                              │
│  ✓ Beat Mira's Red Fox · 2h ago     │  ← row (Text + status icon)
│  ✗ Lost to Sam's Heron · yesterday   │
└──────────────────────────────────────┘
```
Components: `SectionHeader` ×4, `FriendCodeChip`, `FormField`, `CaptureChip` ×N, `Button`, history row uses `Text` + small status icon.
Flow: (1) view own code → share → (2) friend enters code in their app → (3) pick fighter, submit → server resolves → result row appears in RECENT for both.

---

## 7. Dark Mode Policy

**Single dark theme.** Recommend against shipping a light theme in v0.2:
- The brand splash bg (`#0b1d12`) is dark by design; light mode would require a parallel palette + per-component overrides that 9 screens cannot afford right now.
- Camera + outdoor capture flows are easier to see at dusk/dawn with a dark UI.
- `app.json` declares `userInterfaceStyle: "automatic"` — we should override to `"dark"` so the system never forces light variants of native components.

Revisit in v0.4 once the component layer is stable and a theme provider exists.

---

## 8. Iconography

**Use `@expo/vector-icons` (Ionicons set as default).** Reasons:
- Already bundled with Expo — zero extra deps, no font loading config.
- Ionicons matches iOS visual weight cleanly and has Android-equivalent glyphs.
- `lucide-react-native` is tempting but adds ~150 KB and a font loading step.

Convention: import via `<Ionicons name="camera-outline" size={…} color={tokens.text.primary} />`. Always pass an explicit color from `theme.ts` (never a magic string). Outline variants by default; filled variants for active tab / selected state only.

Key glyphs used in v0.2: `camera-outline`, `book-outline`, `leaf-outline`, `flash-outline`, `close`, `chevron-back`, `copy-outline`, `checkmark-circle`, `close-circle`, `logo-apple`, `logo-google`, `diamond-outline` (shop), `flame-outline` (battle).

---

## 9. Motion & Feedback

Keep motion minimal and purposeful — every animation should map to a game event.

**Use `react-native-reanimated` (already a peer dep of expo-router) for shared values; fall back to RN `Animated` for one-off opacity/scale.** No external animation libs.

| Event | Treatment | Library |
|---|---|---|
| Tap any `Button` | Scale to 0.97, 80 ms, ease-out | Reanimated |
| Capture success (ID returned) | `IdResultCard` slides up 250 ms `easeOutCubic` | Reanimated |
| Rarity reveal (rare+) | `RarityReveal` overlay: bg fade-in 200 ms, badge scale 0.6→1.0 with spring, glow pulse 2× | Reanimated |
| Battle hit | `BattleSlot` shake (translateX ±6 px, 4 oscillations, 320 ms), HP bar tweens to new value 400 ms | Reanimated |
| Crit | Add screen flash (white at 0.15 opacity, 120 ms) + scale damage number to 1.4 | Reanimated |
| List item appear (Dex first paint) | Stagger fade+slide-up 200 ms per item, max 6 items animated | Reanimated `entering` API |
| Toast | Slide-in from top 200 ms, auto-dismiss after 2.5 s | Reanimated |
| Loading | `LoadingPulse` skeleton uses opacity 0.4↔0.8 loop, 1.2 s | Reanimated |

Haptics: use `expo-haptics` (already supported). Light impact on `Button` press; medium impact on FIGHT and on capture success; notification-success on rarity reveal rare+.

---

## 10. Open Design Questions (need human input)

1. **Capture artwork strategy.** The `assets/` directory is empty (no `icon.png`, no `splash.png` despite `app.json` referencing them). Are we shipping illustrated creature artwork, real photos only, or both? This determines whether `CaptureCard` needs a thumbnail slot and whether the dex feels like a photo album or an illustrated bestiary.
2. **Rarity-tier visual weight.** Should legendary captures get persistent gold borders + glow in the dex, or is the reveal moment enough and the dex stays flat? Persistent flashy borders risk visual noise in a long dex; flat dex underutilizes the rarity system.
3. **Battle animation scope.** Is v0.2 happy with HP-bar-and-log-only battles, or do we need creature sprite swap-ins (which would require an art pipeline we don't have)? Brief assumes log-only for v0.2.
4. **Web parity.** Should the web build show "install the app" empty states on `capture` (current behavior), or fully hide unsupported routes from the web nav? Affects how `index.tsx` renders on web.
5. **Friend-code vs username.** Are friend codes (6-char) the only social primitive in v0.2, or should we also surface a display name / avatar? Avatars would add a profile screen and storage upload flow not currently scoped.
