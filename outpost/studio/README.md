# The studio

The studio is the part of Outpost that makes the videos. It runs on the laptop, not in the cloud. For each video
the app asks for, it writes a script with Claude, voices it with Kokoro, renders it in Compound as a 3D animated
reel, and uploads the MP4 to Convex storage, where the app's Feed picks it up.

It costs nothing to run. Claude goes through the Claude Code subscription (`claude -p`), Kokoro runs locally, and
Compound renders on the Mac.

## Files

| File | What it does |
| --- | --- |
| `worker.mjs` | The long-running worker. Watches the Convex queue, makes each video, reports every step back to Convex. |
| `reel.mjs` | The reel format. The JSON schema Claude must fill, the writer's system prompt, how a script is stored in Convex, and `layout()`, which turns a script plus word timings into timed events. |
| `voice.py` | Kokoro voice server. Reads requests on stdin, writes a WAV and per-word timings. |
| `sfx.py` | Synthesizes the sound effects (boom, whoosh, tick, pop, riser, chime, thud, glitch, roll) and the music bed once. |
| `template/index.tsx` | The Compound project entry. Draws one scene per job: the 3D set, captions, the top label, cards and the end card. |
| `template/world.ts` | The 3D set, built with three.js: the freelancer, the invoice mascot, the desk, the phone, the grid floor and the night city, plus the camera shots. |
| `template/jobs.ts` | Types for the events `layout()` produces. The worker rewrites `JOBS` in the project copy for every render. |
| `template/package.json` | Pins the three.js version the worker installs into the Compound project. |

## One video, step by step

1. **Claim.** `api.studio.queue` lists videos waiting for the studio. The worker claims one with `api.studio.claim`,
   which returns the context: the niche, recent hooks to avoid, the viewer's swipe notes, what Supermemory learned,
   and, for a remake, the old script and the reason.
2. **Script.** `claude -p --model sonnet --json-schema SCRIPT_SCHEMA` writes the script. Up to three writers run at
   once (`WRITERS`). A video with a brief (see "Briefs" below) is written from it. Other fresh videos rotate through
   `ANGLES`; a Scout find sets the topic instead. Remakes for "hook",
   "too long" and "my note" rewrite the old script. Remakes for "visuals" and "voice" keep it.
3. **Voice.** Kokoro speaks the hook (without its `POV:` label), each beat, then the call to action, as separate
   parts. The narrator reads the hook, the call to action and every narrator beat; a line said in the scene gets the
   speaker's own voice (`VOICE_OF` in `reel.mjs`). `deepen()` lowers the voice about a semitone with ffmpeg and puts the tempo back, so the word timings still
   hold.
4. **Layout.** `layout()` in `reel.mjs` turns the script and the word timings into a flat, sorted list of events.
5. **Render.** The worker writes the job into the Compound project's `jobs.ts` and calls Compound's `export` tool
   over MCP. Renders run one at a time.
6. **Upload.** The MP4 goes to Convex storage through `api.studio.uploadUrl`, and `api.studio.finish` marks the
   video ready with its script, voice, palette and step timings.

Every step also writes a row through `api.studio.log`, which is what the app's "Studio" activity shows.

## What a reel looks like

The look follows short-form animated explainers: a blocky 3D character on a dark grid set, a hard cut about every
two seconds, and word-by-word captions with the key words lit up.

- **The cast.** One freelancer with glasses and a hoodie appears in every video, so the account has a recurring face.
  He is "you" in the narration. A brief can add a second character: a boss in a suit and tie, a client in a blazer,
  a friend in a cap, a coworker in a cardigan, a roommate in a hoodie, or a bald landlord with a moustache. Whoever
  speaks a line moves their mouth on it, and the other one turns to listen.
- **The sidekick.** A talking object stands nearby: the invoice, a piggy bank (`BROKE`, then `SAVED`), a calendar
  (`LATE`, then `DONE`) or a coffee mug (`EMPTY`, then `FULL`). His sidekick is a talking invoice whose stamp tells the story: worried while the
  money is late, a red `OVERDUE` stamp on a mistake, a green `PAID` stamp after the turn.
- **The set.** By default a glowing grid floor, a night city of lit windows fading into fog, dust in the air, a desk
  with a laptop showing a client list, and a phone. A brief can pick an open office with cubicles and a skyline, a
  bedroom at night with a lamp, or a brick cafe with a menu board instead; each has its own walls, floor, props and
  lighting. Five world palettes (navy, plum, teal, ember, forest) each come with
  their own hoodie colour.
- **Shots.** Close-up, medium close-up, two-shot with the invoice, wide, low hero angle, over the shoulder at the
  laptop, the invoice alone, a slow orbit, and overhead. Every shot drifts slowly, and a shock adds a camera kick.
- **Tints.** Night for the problem, alarm (red rim light, red grid, Dutch angle and a red flash) on a mistake, and
  a warm sunset from the twist on.
- **On top.** A small label names the part of the story (`THE MISTAKE · VAGUE DUE DATE`) with progress dashes
  under it. List, number and messages beats add a card in the top third: a numbered checklist, a counter that rolls
  up to its value, or client texts popping in. The call to action ends the reel in a card with its keyword lit.
- **Captions.** Montserrat ExtraBold at about two thirds down the frame, up to three words at a time, synced to
  the voice. The beat's punch words are yellow; red on a mistake, green on the twist.
- **Disclosure.** Every reel carries a small "AI-made video" line at the bottom.

## The script format

Claude returns JSON that matches `SCRIPT_SCHEMA` in `reel.mjs`:

| Field | Meaning |
| --- | --- |
| `hook` | Spoken first. `POV:` plus at most 9 words. |
| `sub` | A scene-setter shown on top during the hook, like `Friday, 11:52 PM`. Not spoken. |
| `hookAct`, `hookMood` | What the freelancer does and how he looks during the hook. |
| `beats` | 5 to 7 beats. Each has `kind`, `say`, `punch`, `items`, `value`, `unit`, `act` and `mood`. |
| `cta`, `keyword` | The spoken call to action, and the word lit up in the end card. |
| `caption`, `title`, `angle` | What gets posted, and the topic. |

Beat kinds: `statement`, `danger`, `question`, `list`, `number`, `messages`, `twist`. Acts: `talk`, `type`,
`phone`, `facepalm`, `shrug`, `point`, `think`, `shock`, `celebrate`, `wave`, `slump`. Moods: `neutral`, `happy`,
`worried`, `shocked`, `smug`, `sad`, `determined`.

Convex stores a script without `act`, `mood`, `hookAct` and `hookMood` (see `script` in `convex/schema.ts`), so
`fromStored()` fills in the usual act and mood for each kind when a remake reuses a stored script.

Each beat also has `who`: `narrator`, `you` (the freelancer, in first person) or `them` (the second character).
Without a second character, a `them` line falls back to the narrator.

## Briefs

A brief is a short plan for one video from trend research: `format` ("dialogue skit", "what if", "in this town"),
`story`, `why` (the trend it follows), and optional `hook`, `set` (`city`, `office`, `home`, `cafe`), `cast`
(`boss`, `client`, `friend`, `coworker`, `roommate`, `landlord`), `buddy` (`invoice`, `piggy`, `calendar`, `mug`) and
`palette`. The worker writes the script from it and builds the scene it asks for. A remake keeps its parent's brief.

```bash
# From outpost/. Queue a batch ahead of everything else the account has waiting (in this order).
npx convex run admin:queueBriefs '{"userId":"<user id>","briefs":[{"format":"...","story":"...","why":"..."}]}'
# List a user's ready videos with a link to each file, to check the renders.
npx convex run admin:readyUrls '{"userId":"<user id>"}'
# Make chosen ready videos again in place, for ones that fail a check. A briefed one is rewritten from its brief.
npx convex run admin:requeueVideos '{"videoIds":["<video id>"]}'
# Clear the ready videos of a dry-run account (deletes the files too).
npx convex run admin:dropReady '{"userId":"<user id>"}'
```

## From script to shots

`layout()` decides everything that depends on timing, so the template only draws what it is given:

- **Shots** (`k: "shot"`): each beat is one or more shots. A shot also says who talks (`talk`) and what the second
  character does (`act2`, `mood2`). A line the second character says opens on them (`them` close-up, or the
  `mascot` medium shot on card beats). A shot longer than about 1.7 s cuts again on a word, with
  a soft whoosh. The hook opens on a close-up then cuts to the two-shot. A mistake opens on a red close-up, the twist
  on a low angle at sunset, card beats on a medium shot framed low (`hud: true`) so the card has sky behind it, and
  plain beats rotate through the other cameras without repeating one twice in a row.
- **Captions** (`k: "cap"`) with `hi`, the character range to light up, and `tone`.
- **Labels** (`k: "tag"`), **cards** (`k: "card"`) and their rows (`item`, `count`, `bubble`).
- **Effects**: `flash` on a mistake, `ctaPop` for the end card, and `sfx` for every sound.

## How the 3D renders in Compound

Compound renders JSX scenes and lets a `<surface>` element hold a canvas you draw yourself. `Film` in
`template/index.tsx` builds the set with `buildWorld(palette)` and, in an effect on Compound's `useTicker().time()`,
calls `world.frame(shots, t)` to pose everyone and place the camera, renders with three.js, and copies the frame
into the surface. Everything is a function of the playhead, so a scrub, a capture and an export all draw the same
frame.

All reels in a mount share one WebGL renderer (`acquireRenderer` and `releaseRenderer` in `world.ts`), because
WebKit caps live WebGL contexts at about 16. Text stays in Compound's own `<text>` elements, which keeps it sharp.

Compound resolves `three` from the project's own `node_modules`. On start the worker installs the version pinned in
`template/package.json` with bun if the project doesn't have it, then copies `world.ts` and `index.tsx` in.

## Render settings and speed

A 28 s reel renders in about 40 s on an M-series MacBook. Compound exports it as 1080x1920 H.264 at about 11 Mb/s,
near 40 MB, which would fill Convex's free storage after a few dozen videos. A `compound.export` entry in the
project's `package.json` asking for 4 Mb/s made no difference, so `shrink()` in the worker re-encodes each export
with x264 at CRF 28 instead. That takes about 3 s and brings a 28 s reel from 38.6 MB to about 4.5 MB with no
visible change (SSIM 0.989).

Compound runs one export at a time across every project, including the user's own. When another export holds it,
the worker waits up to 10 minutes and tries again, and it gives each export 10 minutes before it restarts. Convex
takes back a video whose claim is 3 minutes old, so the worker renews the claim of every video still in progress
once a minute.

## Running it

```bash
cd outpost
while true; do node studio/worker.mjs; sleep 3; done
```

It needs:

- `.env.local` with `EXPO_PUBLIC_CONVEX_URL` and `.env.worker` with `WORKER_SECRET`.
- The Compound Beta app open. Its workspace is a network mount that only exists while the app runs; if the app
  quits, renders fail and the worker exits, and the loop restarts it.
- The Claude Code CLI signed in, Kokoro in the Python venv at `/tmp/ychack/voice/venv-ko`, ffmpeg, and bun.

The worker exits on purpose when Compound or the voice server dies or stops answering, so the loop above brings it
back clean.

### A second worker on its own backend

Each worker rewrites its Compound project's `jobs.ts` and template files when it starts, so two workers must not share
a project. To run a second one, such as a worker for a local `npx convex dev` backend next to the cloud one, copy the
project folder and point the worker at the copy and at the other backend:

```sh
CONVEX_URL=http://127.0.0.1:3210 STUDIO_PROJECT_DIR=<copy of the project folder> node studio/worker.mjs
```

Compound still exports one video at a time across all projects, so the two workers take turns rendering.

### Uploading videos made earlier

If videos for queued briefs were already made somewhere else (for example while Convex was unreachable), point
`PRERENDERED` at their folder and the worker uploads them instead of making them again:

```bash
PRERENDERED=/path/to/folder node studio/worker.mjs
```

The folder holds `<n>.mp4` with a `<n>.json` next to it shaped `{ brief, ok }`: `brief` is the brief the video was
made from and `ok` is what `studio.finish` takes, without `storageId`. A queued video picks the file whose
`brief.story` matches its own, uploads it, and marks the JSON `<n>.json.used` so it isn't used twice. Remakes and
videos with no match are made the normal way.

## Trying a change without the queue

To see a template change without touching the live studio, use a separate Compound project:

1. Create a folder in the Compound workspace, add a `package.json` with `"main": "index.tsx"`, and `bun add three@0.186.1`.
2. Copy `template/index.tsx`, `template/world.ts` and `template/jobs.ts` in, and copy the studio project's
   `assets/studio/sfx` folder.
3. Make one job: write a script with `claude -p` and `SCRIPT_SCHEMA`, voice it with `voice.py`, run `layout()`, and
   write the result into the copy's `jobs.ts`.
4. Open the folder with Compound's `open` tool, then use `capture` for contact sheets of frames and `export` for
   the MP4.
