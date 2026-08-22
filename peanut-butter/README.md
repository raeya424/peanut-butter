# Peanut Butter

A playlist discovery and streaming site for a school CS project — sign up,
add songs you actually have the rights to (search Apple's official 30-second
previews, upload your own file, or paste a direct link), build playlists,
search the whole class's library, and stream through a real player with a
queue. An admin account can moderate or remove anything.

This is a full Next.js app (App Router), not a Claude artifact — it's meant
to be pushed to GitHub and deployed for real. It was built and
production-built (`next build`) successfully before being handed to you, so
the code itself is solid; what's left is wiring up your own accounts for
the three services it depends on.

## What it needs, and why

| Piece | What it's for | Where it comes from |
|---|---|---|
| Redis (key–value store) | The shared song/playlist library and user accounts | Upstash Redis, via the Vercel Marketplace (or direct from upstash.com) |
| Blob storage | Uploaded cover images and audio files | Vercel Blob |
| Anthropic API key | The school-appropriateness check on new songs | console.anthropic.com |

None of this costs anything at this scale — Upstash's free tier is 500k
commands/month, Vercel Blob's free tier is a few GB, and the moderation
calls are small.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev
```

## Deploying — Option A: Vercel (most tested path)

1. Push this project to a GitHub repo.
2. On vercel.com, import the repo. It'll detect Next.js automatically.
3. Before the first deploy finishes mattering, add the storage:
   - **Storage → Create Database → search "Redis"** (Upstash, via the
     Marketplace — Vercel's own KV product was retired in favor of this).
     Connect it to the project; Vercel injects `KV_REST_API_URL` /
     `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
     `UPSTASH_REDIS_REST_TOKEN` — the code checks both names, since Vercel
     has used both at different times).
   - **Storage → Create Database → Blob**. Connect it; this injects
     `BLOB_READ_WRITE_TOKEN` automatically.
4. In **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` — your own key from console.anthropic.com
   - `ADMIN_SIGNUP_CODE` — pick something only you and your teacher know
5. Redeploy (Deployments → ⋯ → Redeploy) so the new env vars take effect.

That's it — `vercel.com/<your-project>` is live.

## Deploying — Option B: Wasmer Edge

Wasmer now runs full Next.js apps, API routes included, through their
Node-compatible WebAssembly runtime (Edge.js) — not just static exports.
Two ways to do it, both documented at docs.wasmer.io:

**Connect GitHub (simplest):** go to wasmer.io, connect the repo. Wasmer
detects Next.js from `next.config.js` and the build scripts and handles
`next build` + deployment on every push automatically — no config files
needed in the repo for this path.

**CLI:** install the Wasmer CLI, then from the project root run
`wasmer app create` (it interactively scaffolds the `wasmer.toml` /
`app.yaml` files Wasmer's own tooling expects — better to let it generate
those than for either of us to hand-write them) and then `wasmer deploy`.

Either way, set the same four values as secrets/env vars (via
`wasmer secret add <NAME> <VALUE>`, or the `env:` section of `app.yaml`, or
the dashboard): the Redis URL/token pair, `BLOB_READ_WRITE_TOKEN`,
`ANTHROPIC_API_KEY`, and `ADMIN_SIGNUP_CODE`.

One honest caveat: Wasmer's full-Node-compatibility runtime is quite new
(launched within the last several months), so while the officially
supported path should work, it hasn't had nearly as much mileage as
Vercel's native Node runtime — if you hit a dependency-compatibility snag
with `@upstash/redis` or `@vercel/blob` specifically, Vercel is the
fallback with the shortest path back to working.

## Real songs via search

The "Search previews" tab in Add Song calls Apple's public iTunes Search
API for real, official 30-second preview clips — that's the actual legal
ceiling for streaming commercial music without a label license; full-length
tracks from Spotify/Apple Music/Deezer aren't available to pull into a
project like this by design, that's what protects the licensing deals those
platforms pay for. Upload or paste-a-link are there for anything you fully
own the rights to.

## The one thing this doesn't do, on purpose

No YouTube-link-to-MP3 conversion. Ripping and rehosting audio from YouTube
for other people to stream is copyright infringement regardless of
"educational use" framing, so that piece was left out rather than built
with just a warning label next to it.

## Admin account

During sign-up, entering the `ADMIN_SIGNUP_CODE` you set creates an admin
account. That check happens server-side (`/api/verify-admin`) so the real
code never ships in the browser bundle — only tell people the code out of
band.

Admins get a dedicated Admin panel with three sections:

- **Pending approval** — every song a regular student submits lands here
  and is NOT public until an admin approves it. Each row can be previewed,
  edited before approving, approved (goes public), or rejected (removed and
  its uploaded files cleaned up).
- **Song requests** — students who can't add a song themselves can send a
  title/artist request from the "Request" button in the top bar. Requests
  show up here for an admin to act on or dismiss.
- **Public songs** — everything currently live, each editable (cover, name,
  artist(s), album, release date) or able to be taken down.

Songs an admin adds from their own account are auto-approved and skip the
queue. Songs added by regular students always go to pending review first.

## Admin workflow

Editing a song lets an admin change its cover image, title, artist(s),
album, and release date. Taking a song down removes it and cleans up its
stored files. These controls are admin-only; regular students can add
songs (which go to review) and request songs by title.


## Known limits

- Uploaded covers are capped at 8MB, audio at 20MB (both enforced
  server-side, not just in the UI).
- The appropriateness check is a real gate (it can block a save), but if
  `ANTHROPIC_API_KEY` isn't set or the call fails, it fails open with a
  warning rather than blocking saves entirely — an admin is still the
  backstop.
- Accounts are a lightweight demo scheme (a password hash in Redis, no
  real session/JWT infrastructure) — good enough for a class project, not
  for anything that needs real security.
