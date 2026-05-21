# Wildex Edge Functions — deploy + sequencing

Closes the **Critical** findings in `/AUDIT-SECURITY.md` (C-sec-1, C-sec-2, C-sec-5)
and is the path for C-sec-3 (the schema trigger blocks the insecure client write).

Functions:
- `accept-challenge` — server-side battle resolution. The accepting client now POSTs
  here instead of UPDATEing the challenges row directly. Server reads both
  `captures.stats` (authoritative) and writes `seed`/`winner` via service role.
- `revenuecat-webhook` — RevenueCat → inventory grants. The client `grant_purchase`
  RPC now rejects non-service-role callers (see schema.sql).

## Deploy order (do this in coordination — the schema migration is already in `schema.sql`)

```bash
# 1) Apply the schema migration in Supabase SQL editor (paste schema.sql contents)
# 2) Set the webhook shared secret
supabase secrets set REVENUECAT_WEBHOOK_SECRET=$(openssl rand -hex 32)

# 3) Deploy
supabase functions deploy accept-challenge       --no-verify-jwt
supabase functions deploy revenuecat-webhook     --no-verify-jwt

# 4) In RevenueCat dashboard → Webhooks:
#      URL:    https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
#      Header: Authorization: Bearer <same secret as above>

# 5) Switch the app's lib/multiplayer.ts acceptChallenge() to call this:
#      const res = await supabase.functions.invoke("accept-challenge",
#        { body: { challenge_id, opponent_capture_id } });
#    (and delete the client-side simulate() call there — the server is the
#    sole resolver now)
```

## What is *not* fixed yet (honest)
- **H2 (server-side capture creation)** — High but not Critical. The schema includes
  `revoke insert on captures from authenticated` commented out; uncomment + apply
  ONLY AFTER you build a `create-capture` Edge Function (the audit recommends
  doing this; not in this commit).
- **H3/H4 (public storage bucket + path-overwrite)** — change bucket to private +
  add Storage RLS policies in the Supabase Storage dashboard. Not editable in
  schema.sql.
- **H1 anti-cheat tiers** — none implemented; the audit was honest about that.

## Local test
```bash
supabase functions serve accept-challenge
# then curl with a real user JWT + a valid challenge id
```

## Adding create-capture (Highs batch)

After the steps above for accept-challenge / revenuecat-webhook:

```bash
# Deploy server-side capture creator (closes H-sec-2, partial H-sec-1)
supabase functions deploy create-capture --no-verify-jwt

# In the Supabase dashboard:
#  - Storage → captures bucket → set to PRIVATE
#  - SQL editor → run the Storage RLS policy block at the bottom of schema.sql
#  - SQL editor → uncomment + run the "revoke insert on captures" block
#    ONLY after the function is verified working
```

Tier-1 anti-cheat (EXIF freshness within 5 min) is enforced by the function.
Tiers 2-5 (GPS-vs-iNat-range, liveness, server-side iNat re-verify, trust
score) remain unimplemented per AUDIT-SECURITY.md H-sec-1; the function is
structured so they're a single-file edit when you're ready to add them.
