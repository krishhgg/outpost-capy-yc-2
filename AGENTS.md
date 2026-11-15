# AGENTS.md

Read this first. It orients any coding agent (Capy, Claude Code, Codex, Cursor) working on Outpost.

Building toward the demo? Read [BUILD_PLAN.md](BUILD_PLAN.md) first: it is the build plan, its wave and file-ownership rules, and the contracts.

## What Outpost is

**Get paid for your taste.** An iOS app where you swipe through AI-made vertical clips cut for real paid brand
bounties (Whop Content Rewards campaigns). Left kills a clip, an edit chip or short note tweaks it, right approves it.
An approved clip posts to the user's own social account and its public URL is submitted to the Whop campaign. Whop
pays the user directly per 1K views, so money never flows through Outpost. A scoreboard shows views, estimated
pending earnings and a taste score; the agent texts the user over iMessage.

## Direction vs today

The product direction is Charlie's brief, [BRIEF.md](BRIEF.md); read it before product work. The code in
`outpost/` is the starting point the brief's features get built on: today agents write, voice and render original 3D
explainer videos and post them to YouTube and Instagram. **Code is the truth about what is built. Never describe a
planned feature as working.**

| Feature | Status today | Where |
|---|---|---|
| Full-screen swipe feed (right = post, left = send back) | Built | `src/Feed.tsx`, `convex/feed.ts` |
| Posting | Built via Zernio to YouTube + Instagram, paced, `dryRun` / `private` / `public` modes. Brief wants TikTok/Reels/Shorts via an aggregator | `convex/post.ts`, `convex/pace.ts` |
| Views polling | Built: cron reads Zernio analytics every 20 min | `convex/views.ts`, `convex/crons.ts` |
| Bounty board (Whop Content Rewards campaigns) | Planned. Today's Scout searches Whop *products*, not campaigns | `convex/scout.ts` |
| Whop join + submit post URL | Planned. Nothing built | |
| Clip engine (cut brand footage into 9:16 clips) | Planned. Today's studio makes original reels | |
| Director edit chips | Partial: left-swipe reasons ("Hook too slow", "Too long"...) queue a full remake. One-tap param tweak + fast re-render is planned | `convex/feed.ts` (`REASONS`) |
| Scoreboard | Built: views, estimated pending and approved earnings per video, Whop review status with Submit on Whop, Hit/Solid/Miss verdicts against the user's baseline | `convex/earnings.ts`, `src/You.tsx`, `src/Away.tsx` |
| Accuracy bonus and projected earnings | Built: each right swipe on a bounty video is a bet on two gates (the brand accepts it on Whop, and it clears the campaign's minimum views without a Miss). Right calls raise an Outpost bonus from 1x toward 5x and wrong calls lower it. The Earnings tab shows each video's projected and boosted earnings, both gates, the bonus history and a scale-up line. A demo control, only on the builder devices listed in `DEMO_CONTROLS`, enters a review result by hand | `convex/rewards.ts`, `src/Earnings.tsx`, `src/Feed.tsx` |
| Taste score (approval rate x performance) | Built: 0 to 100 with a tier, provisional (from pickiness) until 5 posts are scored. Collect saves the score the Away card showed. Supermemory notes from left-swipe reasons still shape the writer | `convex/earnings.ts`, `convex/memory.ts` |
| iMessage agent | Planned. Nothing built | |
| Studio (claude -p script + Kokoro voice + Compound render) | Built: today's video pipeline, Convex job queue to MP4 upload. Starting point for the clip engine | `studio/`, `convex/studio.ts` |
| Shop raid | Built, Whop sandbox only: creates a $9 Notion template product + checkout, records test payments. Starting point for Whop bounty work | `convex/raids.ts`, `convex/whop.ts` |
| Pixel-art Base village, streaks, widget | Built. The home screen and daily loop that bounty features plug into | `src/Base.tsx`, `convex/you.ts`, `src/widgets/` |

Don't delete or rip out the studio, shop raid or village. Extend or adapt them to the brief instead.

## Repo map

| Path | What |
|---|---|
| `outpost/` | Everything that runs. See `outpost/AGENTS.md` for app/Convex/studio specifics |
| `outpost/src/` | Expo app. Routes in `outpost/src/app/`, components beside it |
| `outpost/convex/` | Convex backend. Schema in `convex/schema.ts`; `_generated/` is generated |
| `outpost/studio/` | Laptop studio worker (`worker.mjs`) and its Compound template |
| `outpost/docs/` | Architecture, app, backend, integrations, demo runbook (describe today's code, not the brief) |
| `research/`, `visuals/`, `engagement-research.md` | Background only, not specs |
| `hackathon.md` | Convex hackathon build log (`.agents/skills/convex-hackathon-skill`) |

Three runtime parts:

1. **App** (Expo SDK 58, React Native, Expo Router, iOS dev build). Talks **only** to Convex, never to an outside API.
2. **Backend** (Convex). All data, files, posting, crons and outside calls (Zernio, Whop, Supermemory).
3. **Studio worker** (Node on a laptop). Pulls jobs from Convex, renders, uploads back. Needs macOS-only tools
   (Compound, Kokoro, `claude` CLI, ffmpeg) with hardcoded local paths, so it will not run in a cloud sandbox.

## Commands

All from `outpost/`. Node 22 (what CI uses), npm.

```sh
npm ci                              # install
npx tsc --noEmit                    # typecheck app        (CI)
npx tsc --noEmit -p convex          # typecheck Convex     (CI)
node --check studio/worker.mjs      # syntax-check worker  (CI)
npx convex dev                      # push functions + watch; needs a Convex login or deploy key in env
npx expo run:ios                    # build the dev client (macOS + Xcode); later just `npx expo start`
while true; do node studio/worker.mjs; sleep 3; done   # studio worker, laptop only
```

CI (`.github/workflows/typecheck.yml`) runs the three checks on PRs touching `outpost/`. There is no lint or test
suite configured.

## Hard rules

- **Never commit secrets**: `.env*` files, Convex deploy keys, Whop keys, Zernio/Supermemory keys, Whop session
  cookies. Server secrets live in Convex env (`npx convex env set`); the app only gets `EXPO_PUBLIC_CONVEX_URL`.
- New users stay in `dryRun` posting. Only a builder changes mode, via internal `admin:setMode`. Never expose a
  public function that changes posting mode.
- Whop shop stays in sandbox (`WHOP_ENV` unset). Never post to real social accounts or submit to real Whop
  campaigns from tests or agents.
- Human posting volume only: a few posts per day per user's own account. No pooled or shared accounts, no botting.
- Mechanical steps (download, transcribe, cut, reframe, caption) are plain code. Use an LLM only for creative calls
  (moment picking, hooks, captions).
- Don't build a clip engine from scratch: use OpenShorts (MIT) or yt-dlp + Whisper/Deepgram + FFmpeg. No AGPL code
  (e.g. SupoClip).
- Don't change Convex deployment config or env files in unrelated PRs; the deployment is being migrated.
- Don't delete or rip out the studio, shop raid or village; extend or adapt them.
- Agents may merge PRs. Merge once CI is green and the PR does what it says. Never push directly to `main`: every change goes through a PR.

## Conventions

- The app calls Convex only, with live `useQuery` / `useMutation`. Outside APIs are called from Convex actions and
  every call is logged to the `calls` table (`internal.post.call` from actions, `logCall` in `convex/lib.ts` from
  mutations); the `/hood` screen shows it.
- No accounts: the app sends a keychain `deviceId`; Convex resolves it with `userFor()` in `convex/lib.ts`.
- The worker calls only the public functions in `convex/studio.ts`, passing `WORKER_SECRET` as `key`, checked
  by `requireWorker()`. Builder-only functions are `internal` (see `convex/admin.ts`).
- Schema changes go in `convex/schema.ts`; keep fields optional when existing rows lack them.
- Routes are files in `outpost/src/app/` (Expo Router); keep non-route code outside it.

## Definition of done

- The three CI checks pass locally and on the PR.
- Docs updated when behavior changes (`outpost/docs/*`, this file's status table).
- PR body says what changed and what was actually verified (and what wasn't, e.g. "not run on device").

## Deeper docs

- `BUILD_PLAN.md`: the build plan, wave and file-ownership rules, and the contracts
- `outpost/README.md`: setup and every environment variable
- `outpost/docs/architecture.md`: how the parts connect, data model
- `outpost/docs/backend.md`: every Convex module, crons, admin commands
- `outpost/docs/app.md`, `outpost/docs/integrations.md`, `outpost/docs/demo-runbook.md`
- `outpost/studio/README.md`: the studio worker
