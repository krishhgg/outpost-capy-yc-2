# Backend

The backend is a Convex deployment. Its code is in `outpost/convex/`. This page lists every module and its main functions. For how the pieces fit together, see [architecture.md](architecture.md).

Three kinds of caller reach these functions:

| Caller | Can call | Auth |
|---|---|---|
| The app | Public queries and mutations that take `deviceId` | The device id must belong to a user (`userFor()` in `lib.ts`) |
| The studio worker | Public functions in `studio.ts` | Every call passes `key`, checked against `WORKER_SECRET` by `requireWorker()` |
| The builder | Internal functions, including everything in `admin.ts` | Convex dashboard or `npx convex run`. Not reachable from a phone |

## Environment variables

Set these on the Convex deployment with `npx convex env set NAME value` or in the dashboard. None of them go in the app.

| Variable | Read in | What it does | If unset |
|---|---|---|---|
| `WORKER_SECRET` | `lib.ts` | Shared secret for the studio worker | Every `studio.*` call fails with "bad worker key" |
| `MAX_USERS` | `feed.ts` | Most users the deployment accepts | 5 |
| `ZERNIO_API_KEY` | `post.ts`, `views.ts`, `admin.ts`, `hood.ts` | Posting and view counts | Real posts fail with "Posting key missing". Views are not read |
| `WHOP_API_KEY` | `whop.ts`, `hood.ts` | Shop raid setup and payment polling | Setup stops at the first step with "Waiting on the Whop key" |
| `WHOP_ENV` | `raids.ts` | `production` would use the live Whop API | Sandbox. Setup refuses to run in production |
| `WHOP_WEBHOOK_SECRET` | `whop.ts` | Overrides the webhook signing secret stored in `kv` | The secret saved when setup made the webhook |
| `PUBLIC_SITE_URL` | `whop.ts` | Public base URL of the deployment's HTTP actions, for the Whop webhook | No webhook. Payments arrive only by polling |
| `SUPERMEMORY_API_KEY` | `memory.ts`, `hood.ts` | Taste memory | Notes stay in Convex. The call is logged as skipped |

The Under the hood screen shows "Waiting on its key" for Zernio, Whop and Supermemory when their key is missing.

## Modules

### feed.ts

The Feed and the user record.

| Function | Kind | What it does |
|---|---|---|
| `ensureUser` | mutation | Finds or creates the user for a device id, follows the phone's time zone, refills the video buffer and starts a Scout search if finds are low. Rejects new users past `MAX_USERS` |
| `next` | query | Up to 12 ready videos with their playback URL, hook, length, remake label and Scout price |
| `status` | query | Studio counts (`queued`, `making`, `ready`), the steps in progress, the worker's last heartbeat, total views, the three newest posted videos for the post tray, and posts going out now |
| `swipe` | mutation | Records a right or left swipe. Right adds a `posts` row per platform and schedules it. Left with a reason saves a taste note, syncs it to Supermemory and queues a remake. Left without one deletes the file |

`REASONS` maps the remake keys to labels: `hook` (Hook too slow), `visuals` (Boring visuals), `voice` (Voice), `long` (Too long), `topic` (Wrong topic), `more` (Say more).

### studio.ts

The studio worker's API. Every function takes `key`.

| Function | Kind | What it does |
|---|---|---|
| `queue` | query | Up to 12 queued jobs, remakes first, then by rank |
| `claim` | mutation | Moves a queued video to `making` and returns everything the writer needs |
| `stage` | mutation | Sets the current step and renews the claim |
| `uploadUrl` | mutation | A Convex storage upload URL |
| `finish` | mutation | Saves a finished video as `ready`, or records a failure. Two failures mark it `failed` |
| `beat` | mutation | Heartbeat for the `laptop` worker row |
| `log` | mutation | Writes a `calls` row for the worker's Claude, Kokoro, Compound and upload steps |
| `recentCalls` | query | The 60 newest calls across all users |
| `sweep` | internal mutation | Returns claims older than 3 minutes to the queue. Run by cron |

### post.ts

Posting through Zernio.

| Function | Kind | What it does |
|---|---|---|
| `publish` | internal action | Sends one `posts` row according to its mode |
| `begin` | internal mutation | Checks the row is due, the queue isn't paused and the file exists, then marks it `publishing` |
| `settle` | internal mutation | Writes the result: `live`, `failed`, `dry_run`, `skipped` or still `publishing` |
| `check` | internal action | Asks Zernio for the post's status until the platform gives a URL |
| `retry` | internal mutation | Requeues a post after a network error, 429 or 5xx, up to 3 times, 15 seconds apart |
| `savePublicUrl` | internal mutation | Keeps Zernio's media URL on the video for 6 days so the second platform reuses the upload |
| `call` | internal mutation | Writes a `calls` row. Other modules use it too |

How `publish` handles each mode:

| Mode | YouTube | Instagram |
|---|---|---|
| `dryRun` | No request. Logged as skipped, row becomes `dry_run` | Same |
| `private` | `visibility: "private"` | Skipped with "Instagram has no private mode" |
| `public` | `visibility: "public"` | Posted to the feed |

A real post:

1. `POST /media/presign`, then `PUT` the MP4 to the returned URL. Skipped when the video already has a recent public URL.
2. `POST /posts` with the caption plus "Made with AI.", `publishNow: true`, and `Idempotency-Key` set to the row id. YouTube gets `containsSyntheticMedia: true` and the title. Instagram gets `isAiGenerated: true`.
3. If the response has a platform URL, the row goes `live`. Otherwise `check` runs every 15 seconds for the first 10 checks, every minute until 40, then every 30 minutes. After 88 checks (about a day) the row fails with "Zernio gave no answer for a day".

### pace.ts

Spreads posts out.

| Function | Kind | What it does |
|---|---|---|
| `nextSlot` | helper | The earliest time that keeps a platform under `pacePerDay` posts in any 24 hours and inside a burst of 2 that refills one every 20 minutes |
| `slotFor` | helper | `nextSlot` over the user's reserved slots for one platform |
| `place` | helper | Sets the slot, marks the row `queued` if due or `held` if not, and schedules `post.publish` at the slot |
| `reslot` | internal mutation | Gives every held row a new slot, oldest approval first. Runs after the pace changes or the queue resumes |

While `drainPaused` is true, nothing sends. Held rows give up their slots and `reslot` places them again on resume.

### views.ts

| Function | Kind | What it does |
|---|---|---|
| `sync` | internal action | Reads views from Zernio's `/analytics` for live posts from the last 14 days, 40 posts a minute. Keeps the higher count. Logs one line per user only when views moved or a read failed. Run by cron |
| `recentLive` | internal query | The live posts in the window |
| `save` | internal mutation | Writes new counts and `viewsAt` |

### scout.ts

The Scout searches the public Whop marketplace. No key is needed.

| Function | Kind | What it does |
|---|---|---|
| `scoutIfLow` | helper | Starts a search when the user has fewer than 2 unswiped finds and the last search is at least 6 hours old. Called from `ensureUser` and both swipe mutations |
| `search` | internal action | Runs each query for the niche against `GET /products`. For the default niche the queries are `invoice`, `freelancer`, `client management` and `notion freelance`. Keeps paid USD products, ranked by members then rating |
| `save` | internal mutation | Saves up to 8 new finds the user hasn't seen |
| `next` | query | The best unswiped find |
| `swipe` | mutation | Right queues a video about the find, ranked just after the third ready card. Left drops it |

### memory.ts

Taste memory in Supermemory. Convex keeps the notes, so a remake never waits on Supermemory.

| Function | Kind | What it does |
|---|---|---|
| `syncNote` | internal action | Sends one note to `POST /v3/documents` with container tag `outpost_<userId>` and the note id as `customId`, then starts a refresh round |
| `kick` | internal mutation | Starts a new refresh round. A newer round stops older ones |
| `refresh` | internal action | Reads `/v3/documents/documents` and `/v4/profile` every 20 seconds, up to 15 tries, and caches what was learned in `taste` |
| `syncPending` | internal mutation | Resends notes that never synced. With `all: true` it resends every note |
| `save` | internal mutation | Writes the cache if the round is still current |

### raids.ts

The shop raid. The product is fixed in `SHOP_PRODUCT`: "Notion Client Invoice Template" at $9.

| Function | Kind | What it does |
|---|---|---|
| `start` | mutation | Creates a raid and its offer and schedules `whop.setup`. Returns the existing raid unless it failed |
| `retry` | mutation | Clears steps in error and runs setup again |
| `watch` | mutation | Keeps payment polling on for 10 more minutes. The Base calls it while on screen |
| `mine` | query | The latest raid with its steps, stars, offer and 5 newest sales, plus the vault: real earnings, real sales and test sales |
| `recordPayment` | internal mutation | Records one payment from the webhook or the poll. The payment id dedupes both paths. Updates sales, net and stars |
| `setStep` | internal mutation | Marks a setup step. When all three are done the raid goes `live` and polling starts |
| `forSetup`, `saveOffer`, `pollNext` | internal | Helpers for `whop.ts` |

Goal and stars: `GOAL_CENTS` is 2500. `starsFor()` lights star 1 at half the goal, star 2 at the first sale, star 3 at the goal. Test sales count toward the raid, never toward the vault's real earnings.

### whop.ts

| Function | Kind | What it does |
|---|---|---|
| `setup` | internal action | Creates the product (`POST /products`), the $9 one-time checkout (`POST /checkout_configurations`), and a `payment.succeeded` webhook (`POST /webhooks`) when `PUBLIC_SITE_URL` is set. The product and checkout requests carry idempotency keys. Refuses to run unless Whop is in sandbox |
| `poll` | internal action | Reads up to 10 pages of `GET /payments` for the product and records each paid one. Reschedules itself every 4 seconds while the raid is watched |
| `verifyWebhook` | helper | Checks the Standard Webhooks signature and a 5 minute timestamp window |
| `fromPayment` | helper | Pulls the payment id, product, checkout and amounts out of a Whop payment |
| `kvGet`, `kvSet`, `webhookSecret` | internal | Store and read the webhook URL and signing secret |

Whop calls are logged with a summary chosen per call, so the signing secret never reaches the `calls` table.

### http.ts

One route: `POST /whop/webhook`. It verifies the signature, parses the body, and passes `payment.succeeded` events to `raids.recordPayment`. A bad signature gets 401.

### earnings.ts

`summary({ deviceId })` computes everything from live posts, their views, the user's submissions and swipes: estimated
pending and approved earnings per video (per 1K views above the campaign's minimum, capped per clip, or the flat reward),
Hit/Solid/Miss verdicts against the user's baseline, and the taste score with its tier inputs. `mark({ deviceId, score? })`
saves the score the Away card showed on Collect, so the next card compares against what the user saw.

### you.ts

`summary` (query) feeds the You tab, the Feed's streak line and the widget. It returns the streak, the streak on each of the next few days if nothing more is approved, freezes left, whether today is kept, a 5-week calendar, totals, the top 8 live videos with per-platform views, and the platforms still waiting on a first count. The phone passes its local date as `phoneDay` only so the query reruns at midnight.

A day counts toward the streak when at least one video was approved that day. `streakOf()` in `lib.ts` walks back from today. A missed day uses one of the user's freezes, and each streak gets its own allowance.

### away.ts

| Function | Kind | What it does |
|---|---|---|
| `summary` | query | Videos made, posts gone live, views gained and sales since the last Collect |
| `collect` | mutation | Saves the time and view total the card showed, so the next card starts from there |

### hood.ts

`calls` (query) feeds the Under the hood screen: one row per service with its role, last call and whether its key is missing, the 60 newest calls, the 20 newest taste notes with their sync state, and the Supermemory cache.

### admin.ts

Builder-only switches. Run them with `npx convex run admin:<name> '<json args>'` or from the dashboard.

| Function | What it does |
|---|---|
| `users` | Lists users with id, mode, pace and pause state |
| `setMode` | Sets `postingMode` to `dryRun`, `private` or `public` |
| `setPace` | Sets posts per day per platform, 1 to 24, and reslots held posts |
| `setPaused` | Pauses or resumes sending. Resume reslots held posts |
| `linkZernio` | Reads the Zernio-connected YouTube and Instagram accounts and saves them as the user's `connections` |
| `requeueFailed` | Puts every `failed` and `making` video back in the queue |
| `requeueReady` | Deletes a user's unwatched videos and remakes them in the current studio format |
| `requeueVideos` | The same for chosen unwatched videos, by id. Each keeps its place in the queue and the Feed |
| `wipeVideos` | Development reset. Deletes all videos, swipes, posts, notes, taste and day counts, then refills |
| `rebuildDays` | Rebuilds the daily counts from swipes and finished videos |

Example:

```sh
npx convex run admin:users
npx convex run admin:setMode '{"userId": "<id>", "mode": "private"}'
npx convex run admin:linkZernio '{"userId": "<id>"}'
```

### lib.ts

Shared helpers: `userFor`, `ownVideo`, `requireWorker`, `livePosts`, `refill` (keeps `BUFFER` = 10 videos), `bumpDay`, `dayOf`, `shiftDay`, `streakOf`, `logCall`.

## Crons

From `convex/crons.ts`:

| Name | Every | Runs |
|---|---|---|
| `studio sweep` | 1 minute | `studio.sweep` |
| `read views` | 20 minutes | `views.sync` |

## Scheduled jobs

Everything else is scheduled by the code that needs it:

| Job | Scheduled by | When |
|---|---|---|
| `post.publish` | `pace.place` | At the post's slot |
| `post.publish` (retry) | `post.retry` | 15 seconds after a retryable error |
| `post.check` | `post.publish`, itself | 15 s, then 1 min, then 30 min apart |
| `pace.reslot` | `admin.setPace`, `admin.setPaused` | At once |
| `memory.syncNote` | `feed.swipe`, `memory.syncPending` | At once |
| `memory.refresh` | `memory.kick`, itself | Every 20 seconds, up to 15 times |
| `scout.search` | `scoutIfLow` | At once |
| `whop.setup` | `raids.start`, `raids.retry` | At once |
| `whop.poll` | `raids.setStep`, `raids.watch`, `raids.pollNext` | Every 4 seconds while the raid is watched |
| `views.sync` (next batch) | `views.sync` | 1 minute later, while posts remain |

## Typecheck

CI (`.github/workflows/typecheck.yml`) runs on pull requests that touch `outpost/`. It type-checks the app with `npx tsc --noEmit`, the Convex functions with `npx tsc --noEmit -p convex`, and checks the worker's syntax with `node --check studio/worker.mjs`.
