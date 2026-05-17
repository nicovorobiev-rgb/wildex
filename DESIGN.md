# Wildex — Design Notes

A real-world creature collector. Photograph wild animals, build a dex, battle other players.

## Battle System

**Stat block** (per capture):
- HP, Attack, Defense, Speed, Special
- Element (derived from iNaturalist iconic taxon): beast, avian, aquatic, reptile, insect, flora, fungal
- Rarity (derived from ID confidence score): common → legendary

**Determinism.** Stats are generated once per capture from a seed (`captureId`). No rerolls. This keeps players from spamming the camera for better stats.

**Type chart.** Light rock-paper-scissors layered on element. e.g. avian beats insect (1.4×), insect beats flora (1.4×), flora beats aquatic (1.3×). Loose chart on purpose — players should be able to win with most matchups.

**Engine.** `lib/battle.ts` runs a deterministic alternating-attacker sim seeded by `(captureA, captureB, timestamp)`. Server can replay any battle to verify outcomes — clients can't fake wins.

## Anti-Cheat

The hardest problem. People will photograph Google Images, screen captures, etc.

**Tiered defense, cheapest first:**

1. **EXIF + freshness check.** Reject photos without recent EXIF timestamp or without a camera-matching device profile. Trivially bypassable but filters the laziest cheating.
2. **GPS bind.** Capture lat/lng with the photo. Reject obviously implausible (e.g. polar bear in Florida) — use iNaturalist's range data per taxon. This also enables regional dex entries.
3. **Liveness check.** Force a short video burst (1–2s) instead of a single frame. Run an on-device check that there's actual frame-to-frame variation consistent with a hand-held camera vs a static screen. Reuses the same iNat model on a key frame.
4. **Server re-verify.** Re-run identification server-side against the uploaded image. Reject if confidence drops below threshold — catches screenshot-cropped low-quality images.
5. **Trust score.** Per-user. New users get strict checks; long-time users with verified captures get fast-tracked. Drops to zero on repeat rejections.

**Battle anti-cheat.** Server holds capture stats. Client can't submit a stat block — it submits a battle request with capture IDs, server simulates the result. Same deterministic engine on both sides for instant-feedback UX.

## Monetization

Free-to-play with three layers:

1. **Cosmetics** — capture frames, dex themes, custom battle backgrounds. ~$2–5. No power.
2. **Wildex Pro subscription** — $4.99/mo. More daily capture slots, regional taxonomic info, advanced stat breakdowns, no ads, exclusive cosmetics.
3. **Lure packs** — consumables that increase rare-species spawn weighting in your area for 30 min (clients can request iNat for nearby observations as "tracks"). Not pay-to-win in battle, but enables faster collection.

**Anti-patterns to avoid:** never sell better stats. Never sell battle wins. Cosmetic-and-convenience only — protects the core photography loop and avoids App Store review issues with loot boxes.

**App Store note.** Apple takes 30% standard, 15% small business. Stay under 30% revenue mix on consumables to avoid loot-box scrutiny. Subscriptions need a clear value prop on the paywall screen.

## Roadmap

**v0.1 — prototype (this scaffold)**
- Camera → iNaturalist ID → deterministic stats → Supabase store → dex → local battle sim
- No realtime, no auth UI yet, no anti-cheat

**v0.2 — playable**
- Email/Apple auth (Supabase)
- Real photo upload (Supabase Storage)
- Friend codes, async battles (server validates result)
- iNat token + paid tier check

**v0.3 — public TestFlight**
- Liveness check
- GPS range validation
- Push notifications for battle results
- Daily quests

**v0.4 — App Store launch**
- Subscriptions (RevenueCat is the easy path)
- Cosmetic store
- Leaderboards
- Privacy review polish (NSCameraUsageDescription etc. already set)
