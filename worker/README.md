# Share store worker

The other half of hosted share links (issue #116, made mutable by #124). One KV
namespace: it takes a blob of ciphertext, keeps it for 30 days, and hands it
back by id. A blob is either **immutable** — POSTed, under an id the Worker
mints — or a **room**, PUT under an id the client derived from a key only it
holds, and replaceable so that a link can stay current.

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
| `PUT /:id` | body = ciphertext; `X-Share-Token:`, optional `If-Match:` | `200` + the **previous** bytes, `201` (slot was empty), `409` + the current bytes, `403`, `401` |
| `DELETE /:id` | `X-Share-Token:` | `204` |
| `OPTIONS` | | `204` preflight |

Anything else is `405`. A request from an origin not in `ALLOWED_ORIGINS` is
`403`; a request with no `Origin` at all (curl, a bot) may read — the bytes are
ciphertext — but never write or delete.

A room's `GET` answers `Cache-Control: no-store`; an immutable blob keeps
`max-age=3600`. The token hash beside the blob is the only thing that tells
them apart, and it is the only thing the Worker knows about either.

## Rooms

`PUT` **creates as well as replaces**. The first write to an empty slot stores
`SHA-256(token)` as KV metadata and claims it; later writes must present a
token hashing to the same value. That is safe because the id is derived from a
256-bit key nobody else holds (`src/lib/room-keys.js`), and it is what makes
expiry self-healing — a lapsed room comes back at the same id on the next push,
so every link already sent starts working again.

The Worker still cannot read anything: it holds a hash of a hash and ciphertext
it has no key for. It *does* see the token in flight, so its operator could
overwrite a room — but without the content key anything they write fails
AES-GCM authentication and reaches the recipient as a damaged link. Vandalism,
never forgery, which is the same trust position as being able to delete a blob.

`If-Match` is **best-effort and must not be relied on**. KV has no atomic
primitive, so it is read-then-put over an eventually consistent store: two
racing writes can both pass it, and the read itself can be ~60s stale. The
`200` response carrying the *previous* blob (swap semantics) is the other half
— the pusher checks it was the version it meant to replace — and anything that
slips past both is caught by the app's revision chain as a fork on the next
pull. A missed `409` never discards a trip; it only delays the conversation.
The real fix is a Durable Object, deliberately out of scope.

An immutable blob can never be turned into a room: with no token hash beside
it, no token can ever match, so `PUT` over a POSTed id is `403`.

## Rate limiting

~10 writes per IP per minute, via the `ratelimits` binding in
`wrangler.jsonc` — it deploys with the Worker and there is nothing to click.
The check sits above the method fork, so it covers `POST`, `PUT` and `DELETE`
alike, and it happens before the body is read and before KV is touched.

It is deliberately **not** a WAF rate limiting rule. Those are scoped to a
*zone*, and a `workers.dev` deploy is not in one, so that dashboard section
does not appear at all for this account — an earlier version of this README
sent you looking for it. If the Worker ever moves behind a custom domain, a
WAF rule becomes available and is strictly better (it refuses in front of the
Worker, costing no invocation); until then this is the only option.

`namespace_id` in that block is an arbitrary label, unique within this Worker.
It is not an account resource and there is nothing to create for it.

What this costs and buys: a blocked request still burns a Worker invocation
(100,000/day free), but it is refused before the body is read and before the
KV write, so the **1,000 writes/day** that actually bind stay spent on real
shares.

Be clear about how strong it is, because it is easy to overestimate. The
counter is cached on the machine serving the request and propagates
asynchronously, which makes it reliable *per connection* and permissive across
them. Verified against the deployed Worker:

| | |
|---|---|
| 30 POSTs, one keep-alive connection | 10 × `201`, then 20 × `429` |
| 40 POSTs, a fresh connection each | 40 × `201`, no limiting at all |

That is the documented behaviour, not a misconfiguration — Cloudflare calls
the API "permissive, eventually consistent, and intentionally designed to not
be used as an accurate accounting system". It stops one page or script in a
loop, which is the realistic failure. It does not stop someone cycling
connections on purpose; the backstop there is the daily write quota, which
degrades to a `#d1=` link rather than to a broken share.

If you want a hard limit, that needs a custom domain and a WAF rule.

Reads are not limited: they spend no write quota and serve `Cache-Control:
max-age=3600`, so a popular link mostly answers from cache.

## Things to set up in the dashboard, once

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
