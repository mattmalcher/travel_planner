# Share store worker

The other half of hosted share links (issue #116). ~100 lines over one KV
namespace: it takes a blob of ciphertext, keeps it for 30 days, and hands it
back by id.

It cannot read what it stores. The app encrypts client-side with AES-GCM-256
and puts the key in the URL **fragment**, which browsers never send in an HTTP
request — so the key reaches the recipient's browser and nothing else. Whoever
holds the whole link holds both halves, which is the same thing a `#d1=` link
already meant: the link *is* the secret.

## Deploy

```bash
cd worker
npm install -g wrangler          # or npx wrangler
wrangler kv namespace create KV  # only if you need a new namespace
wrangler deploy
```

`wrangler.jsonc` carries the namespace id and the allowed origins. The app
points at `https://travel-planner-share.matmalcher.workers.dev` by default;
point a build somewhere else with `SHARE_ENDPOINT=… npm run build`, or at
nothing at all with `SHARE_ENDPOINT= npm run build`, which builds a page that
only ever produces the long fragment links.

Local run against `make host`:

```bash
wrangler dev   # add http://localhost:8345 to ALLOWED_ORIGINS first
SHARE_ENDPOINT=http://localhost:8787 npm run build
```

## API

| | | |
|---|---|---|
| `POST /` | body = raw ciphertext, ≤1 MB | `201 {id, ttl}` |
| `GET /:id` | | `200` bytes, or `404` |
| `OPTIONS` | | `204` preflight |

Anything else is `405`. A request from an origin not in `ALLOWED_ORIGINS` is
`403`; a request with no `Origin` at all (curl, a bot) may read — the bytes are
ciphertext — but never write.

## Things to set up in the dashboard, once

Neither can be expressed in `wrangler.jsonc`, and the free tier's limits make
both worth having:

- **Rate limiting rule** — ~10 `POST`s per IP per minute. It runs in front of
  the Worker, so blocked requests cost no KV quota at all.
- **Usage alert** on the Workers dashboard. The free tier allows **1,000 KV
  writes per day account-wide**; past that, writes fail until 00:00 UTC. That
  is not a crisis — the app falls back to a `#d1=` link silently, and the user
  gets a working share either way — but it is worth knowing about.

Storage, for the same reason: 1 GB free. At 30-day retention that is 1,000
writes/day × 30 × average payload; a realistic encrypted itinerary is a few kB,
so the write quota binds long before the storage does.

## Not done here, on purpose

Turnstile or proof-of-work on the write endpoint — the origin check plus rate
limiting come first, and this only needs revisiting if abuse actually shows up
in the logs. Likewise R2 or Durable Objects for read-after-write consistency:
KV is eventually consistent and a recipient in another region can 404 for a
second or two, which the client covers by retrying over ~2s.
