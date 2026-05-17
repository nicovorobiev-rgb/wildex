# Wildex

Photograph real wild animals → build a dex → battle 1v1.

Expo (React Native) + Supabase + iNaturalist computer-vision API.

## Setup

```bash
cd ~/Downloads/wildex
npm install
cp .env.example .env.local
# Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm run ios
```

## Supabase

1. Create a project at supabase.com
2. SQL editor → run `supabase/schema.sql`
3. Storage → create a public bucket `captures`
4. Auth → enable Email + Apple (for iOS launch)

## iNaturalist

The free `/v1/computervision/score_image` endpoint works for prototypes. For production, register an app and use a bearer token — pass it as the second arg to `identifyAnimal`.

## iOS build

```bash
npm i -g eas-cli
eas login
eas build:configure
npm run build:ios
```

You'll need an Apple Developer account ($99/yr) to submit to the App Store.

## Files

- `app/` — Expo Router screens (`index`, `capture`, `dex`, `battle`)
- `lib/inaturalist.ts` — species ID
- `lib/stats.ts` — deterministic stat generation per capture
- `lib/battle.ts` — deterministic 1v1 simulator
- `lib/supabase.ts` — Supabase client
- `supabase/schema.sql` — DB schema with RLS
- `DESIGN.md` — battle design, anti-cheat, monetization
