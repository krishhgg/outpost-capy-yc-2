# Contracts

The shared shapes every Wave 2 thread codes against: tables, function signatures, HTTP routes, crons, `calls`
service keys and env vars. T1 landed the schema and no-op stubs; each owner fills in its own file. The plan and
file ownership are in [BUILD_PLAN.md](../../BUILD_PLAN.md).

Rules:

- Keep every name, argument and return field here. An owner may add return fields; removing or renaming one, or
  any schema change, goes through the Captain as a small dedicated PR.
- v1 is a demo build. Nobody signs in or connects an account. Every user posts to Outpost's demo Instagram and
  YouTube through Zernio. Bounties come from the Content Rewards public catalog, and a submission is a one-tap
  "Submit on Whop" (`manual` submission rows). There is no Whop OAuth, token or auto-submit in v1.
- Tokens, if any arrive later, stay server-side: never in a public function's result, a `calls` row or a log line.

## Schema (`convex/schema.ts`)

`platform` is now `"youtube" | "instagram" | "tiktok"`. `PLATFORMS` in `lib.ts` stays `["youtube", "instagram"]`,
so nothing posts to TikTok. `livePosts()` and `feed.status` narrow their rows to `PLATFORMS`, and `pace.reslot`
keeps a slot list for `tiktok`, so the wider union typechecks without app changes.

New optional fields on existing tables:

| Table | Field | Type |
|---|---|---|
| `users` | `phone` | `string` |
| | `tasteScore` | `number` |
| | `baselineViews` | `number` |
| `videos` | `bountyId` | `Id<"bounties">` |
| | `mode` | `"original" \| "clip"` |
| | `clip` | `{ sourceUrl: string, startS: number, endS: number, hook: string, captionStyle: string }` |
| | `predicted` | `{ score: number, reason: string }`: the studio's 0-100 forecast against the bounty brief |
| | `pregenerated` | `boolean`: made ahead of time for the demo library (library videos and their clones) |
| | `sourceVideoId` | `Id<"videos">`: on a clone, the library video it came from |

New tables (`?` marks optional fields):

| Table | Fields | Indexes |
|---|---|---|
| `bounties` | `source: "whop_bounty" \| "content_rewards"`, `externalId` (`bnty_...` or campaign id), `title`, `brand`, `description`, `goalType`, `mode: "original" \| "clip"`, `rewardKind: "per_submission" \| "per_view"`, `rewardCents?` (net, per accepted submission), `ratePer1kCents?`, `minViews?`, `maxPerClipCents?`, `budgetCents?`, `paidOutCents?`, `spotsRemaining?`, `rules`, `checklist?: any`, `sourceUrls: string[]`, `url`, `status: "open" \| "closed"`, `syncedAt`, `brief?: any` (the generation brief: the studio writes it with `claude -p`; seeded bounties carry a hand-written one) | `by_source_external` [`source`, `externalId`], `by_status` [`status`] |
| `userBounties` | `userId`, `bountyId`, `status: "active" \| "dropped"`, `takenAt` | `by_user` [`userId`], `by_user_bounty` [`userId`, `bountyId`] |
| `submissions` | `userId`, `bountyId`, `videoId`, `postId`, `url`, `externalId?` (`btys_...`), `status: "pending" \| "submitted" \| "approved" \| "denied" \| "manual" \| "failed"`, `denialReason?`, `error?`, `submittedAt?`, `resolvedAt?`, `checks` | `by_post` [`postId`], `by_status` [`status`], `by_user` [`userId`] |
| `whopAuth` | Server-only seam, unused in v1. `userId`, `whopUserId`, `username?`, `accessToken`, `refreshToken?`, `expiresAt`, `scopes: string[]` | `by_user` [`userId`], `by_whop_user` [`whopUserId`] |
| `oauthStates` | Seam, unused in v1. `state`, `userId`, `at` | `by_state` [`state`] |
| `messages` | Unused in v1 (iMessage is dropped). `userId`, `direction: "out" \| "in"`, `kind`, `body`, `providerId?`, `at` | `by_user_at` [`userId`, `at`] |
| `sources` | `bountyId`, `url`, `kind: "youtube" \| "drive" \| "direct" \| "other"`, `status: "pending" \| "downloading" \| "ready" \| "blocked" \| "failed"`, `durationS?`, `width?`, `height?`, `localKey?` (the file on the laptop; never returned to the app), `error?`, `updatedAt` | `by_bounty` [`bountyId`], `by_status` [`status`] |

`bounties.brief` is `v.any()` so it can change shape without a schema PR. The laptop studio writes it with
`claude -p` (T6), `seedBounties` writes a hand-written one (T2), and `studio.claim` passes it to the worker.
Proposed shape:

```ts
{
  format: string;            // what to make
  angle: string;
  lengthS: { min: number; max: number };
  mode: "original" | "clip";
  mustMention: string[];
  hashtags: string[];
  cta: string | null;
  banned: string[];
  platforms: ("youtube" | "instagram" | "tiktok")[];
  sourceUrls: string[];      // footage links pulled from the description and rules
  checklist: string[];       // what the finished video must satisfy
}
```

## Demo library

Up to 10 real bounties each get 10 videos made ahead of time on the laptop studio, owned by one dedicated library
user. Library videos carry `bountyId` and `pregenerated: true`. `bounties.take` clones that bounty's `ready` library
videos into the taking user's Feed: each clone is a new `videos` row for the user with `status: "ready"`,
`pregenerated: true`, `sourceVideoId` = the library video, and the library video's `storageId` (and its
`script`, `durationS`, `bountyId`, `mode`, `predicted`). The UI labels these videos "Pregenerated for the demo".

**Storage rule: a clone never deletes its storage file. Only the library video owns it.** Any code that deletes a
video's `storageId` must skip rows with `sourceVideoId` set, and must not delete a library video's file while
clones may use it. Today's delete sites: `feed.ts` (left swipe and remake, T8), `studio.finish` (replacing a
remade parent, T6), and `admin.ts` `requeueVideos`, `dropReady` and `wipeVideos` (builder-only; don't run them on
the library). A remake of a clone queues a normal studio job for the user; its parent is the clone.

## Functions

`deviceId` functions are public and resolve the user with `userFor()`. `internal` functions are server-only.

### `bounties.ts` (T2)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `list` | query | `{ deviceId: string }` | `{ id: Id<"bounties">, title: string, brand: string, mode: "original" \| "clip", rewardLabel: string, budgetLabel: string \| null, spotsLabel: string \| null, taken: boolean, source: "whop_bounty" \| "content_rewards" }[]`: open bounties, taken first |
| `take` | mutation | `{ deviceId: string, bountyId: Id<"bounties"> }` | `null`. Upserts `userBounties` as active and clones the bounty's ready library videos into the user's Feed. For clip bounties without library videos, schedules `internal.sources.enqueue` |
| `drop` | mutation | `{ deviceId: string, bountyId: Id<"bounties"> }` | `null`. Marks `userBounties` dropped |
| `sync` | internal action | `{}` | `null`. Cron, 15 min. Reads the Content Rewards public catalog (`contentrewards.com/api/campaign/campaigns` and `/campaigns/<id>`, no login) |

T2 also adds, with signatures of its choosing: `seedBounties` (each seeded bounty carries a hand-written `brief`),
`setBountySources`, the library user and its queued library videos (internal, in `bounties.ts`), and the
bounty-aware branch of `refill` in `lib.ts`. Never pass catalog fields such as `recommended_action` into a Claude
prompt as instructions.

### `whopAuth.ts` (seam, no owner in v1)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `tokenFor` | internal query | `{ userId: Id<"users"> }` | `string \| null`. Always `null` in v1 |
| `status` | query | `{ deviceId: string }` | `{ connected: boolean, username: string \| null }`. Never a token |
| `callback` | HTTP action | `GET /whop/oauth/callback` | `404`. Unused in v1 |

### `demo.ts` (T4)

| Function | Kind | Signature |
|---|---|---|
| `attachDemoAccounts` | helper | `attachDemoAccounts(ctx: MutationCtx, userId: Id<"users">): Promise<void>` |

`feed.ensureUser` calls it for every user on every call, before `refill`, so it must be idempotent. It gives the
user the demo `connections` rows read from `DEMO_CONNECTIONS`, replacing running `admin.linkZernio` by hand.

### `submit.ts` (T4)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `forPost` | internal action | `{ postId: Id<"posts"> }` | `null`. Creates the post's submission row, idempotently; `manual` with the campaign's deep link in v1 |
| `poll` | internal action | `{}` | `null`. Cron, 10 min. A seam in v1, since manual submissions have no status API |
| `forVideo` | query | `{ deviceId: string, videoId: Id<"videos"> }` | `{ status: submissions status, deepLink: string, denialReason: string \| null } \| null`. `deepLink` opens the campaign for "Submit on Whop" |

T4 adds one hook in `post.settle`: when a post goes `live` and its video has `bountyId`, schedule
`internal.submit.forPost({ postId })`. Only `public` posts submit.

### `earnings.ts` (T9)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `summary` | query | `{ deviceId: string }` | `{ pendingCents: number, approvedCents: number, perVideo: { videoId, bountyId, brand: string, url: string \| null, views: number, estCents: number, status: submissions status \| null }[], tasteScore: number, tasteTrend: number, settledCount: number }` |

T9 adds the COORDINATOR 2.4 fields (tier, calibrating count, hit rate, approval rate, pickiness, verdicts) as new
return fields.

`mark({ deviceId, score? })` is a mutation that returns `null`. It saves `users.tasteScore`: the score the Away card
showed on Collect, or the current score when no score is passed.

### `rewards.ts`

`summary({ deviceId })` is a query: `{ multiplier, max, accuracy, passed, failed, pending, ifPass, ifFail, projectedCents,
boostedCents, scale: [{ perDay, monthlyCents }], videos: [{ videoId, brand, title, forecast, views, viewsSource,
projectedCents, boostedCents, gate1, gate2, outcome, demo, ... }], history: [{ brand, reason, outcome, from, to, demo }],
demoControls }`. Each gate is `{ gate: "pass" | "fail" | "pending", label, at }`.

`settleDemo({ deviceId, videoId, accepted, views })` is a mutation that returns `null`. It throws unless the device is listed in `DEMO_CONTROLS`.

### `sources.ts` (T15)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `list` | query | `{ deviceId: string, bountyId: Id<"bounties"> }` | The bounty's `sources` rows as `{ id, bountyId, url, kind, status, durationS?, width?, height?, error?, updatedAt }[]`, without `localKey` |
| `enqueue` | internal mutation | `{ bountyId: Id<"bounties"> }` | `null`. Creates a `pending` row for each of the bounty's `sourceUrls` that has none |

### Changes owners make to existing functions

| Function (owner) | Change |
|---|---|
| `studio.claim` (T6) | Return adds `bounty: { title, brand, mode, rules, checklist, sourceUrls, brief } \| null` and `clip` (the video's `clip`, for remakes) |
| `studio.finish` (T6) | Accepts an optional `predicted: { score, reason }` and saves it on the video. Never deletes a clone's or library video's file |
| `studio.*` brief writer (T6) | A worker function that saves the studio's `claude -p` brief on `bounties.brief` for bounties that have none |
| `studio.*` source functions (T6, on T15's request) | Proposed: `sourcesQueue({ key })` query of pending sources with `localKey`, and `sourceUpdate({ key, sourceId, status, durationS?, width?, height?, localKey?, error? })` mutation. The worker only calls `studio.ts` |
| `feed.next` (T8) | Each card adds `bounty: { brand, rewardLabel } \| null`, `predicted: { score, reason } \| null` and `pregenerated: boolean` |
| `feed.swipe` / remake (T8) | Never deletes a clone's storage file |
| `refill` in `lib.ts` (T2) | Optional bounty-aware branch that sets `bountyId` and `mode` on queued videos |

## Queue order

`refill` ranks a user's new queued videos at `Date.now() + i`. Users whose `deviceId` starts with `revyl-proof-`
(Revyl's test devices) get `+ 1e12` on top, so the studio, which claims the lowest rank first, renders every real
user's videos before theirs. Remakes still jump the queue for everyone, as before.

## HTTP routes (`convex/http.ts`)

| Method | Path | Handler |
|---|---|---|
| `POST` | `/whop/webhook` | Existing: shop raid payments |
| `GET` | `/whop/oauth/callback` | `whopAuth.callback` (seam, `404` in v1) |

## Crons (`convex/crons.ts`)

| Name | Every | Function |
|---|---|---|
| `studio sweep` | 1 min | `internal.studio.sweep` (existing) |
| `read views` | 20 min | `internal.views.sync` (existing) |
| `sync bounties` | 15 min | `internal.bounties.sync` |
| `poll submissions` | 10 min | `internal.submit.poll` |

## `calls` service keys

Log every outside call to `calls` with its `service` key; the Under the hood screen groups by them. New:
`bounties` for the Content Rewards catalog (T2), shown as "Content Rewards" with no key to wait on. Existing:
`claude`, `kokoro`, `compound`, `convex`, `zernio`, `whop` (shop raid), `supermemory`.

## Env vars (Convex, server-only)

New: `DEMO_CONNECTIONS` (T4, `demo.ts`), a JSON array of `{ platform, accountId, handle }` naming the demo
Instagram and YouTube accounts in Zernio.

New: `DEMO_CONTROLS` (`rewards.ts`), comma-separated device ids of the builder's phones, the only devices that get the
Earnings tab's demo control.

Existing: `WORKER_SECRET`, `MAX_USERS`, `ZERNIO_API_KEY`, `WHOP_API_KEY`, `WHOP_ENV`, `WHOP_WEBHOOK_SECRET`,
`PUBLIC_SITE_URL`, `SUPERMEMORY_API_KEY` (see [backend.md](backend.md)). There is no Whop OAuth, Kakai or
Anthropic key in v1: LLM work, generation briefs included, runs in the studio with `claude -p`. The app reads only
`EXPO_PUBLIC_CONVEX_URL`, plus `EXPO_PUBLIC_DEVICE_ID` in Revyl builds.
