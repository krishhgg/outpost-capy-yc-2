import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Image, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation, Easing, FadeInUp, FadeOut, withDelay, FadeOutUp, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn,
  type SharedValue,
} from "react-native-reanimated";
import { createVideoPlayer, VideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useAudioPlayer } from "expo-audio";
import { router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { FindCard } from "./Scout";
import { Block, DEEP, FONT, INK, Outlined, PARCH, PixelButton, POP, Sea, WOOD, WoodHeader } from "./pixel";
import { usePayoff } from "./Payoff";
import { Portrait } from "./Portrait";
import { Flame, localDay, Milestones, MILESTONES, PLAT } from "./You";
import { Counter, ICON } from "./Hud";
import { Badge, Button, Chip, COLOR, DemoNote, EmptyState, feel, HONESTY, mult, useToast } from "./ui";

const { width: W } = Dimensions.get("window");
type Clip = FunctionReturnType<typeof api.feed.next>[number];
type Mode = "dryRun" | "private" | "public";
const FIND_EVERY = 3; // videos swiped between Scout cards
const FRAME = 9; // the gold frame around a video: outline, gold, inner outline
const OVERHANG = 28; // how far the Post and Remake buttons hang below the card
const EDIT_ROW = 58; // room under the hanging buttons for the edit chips
const PEEK = 7; // how much of each card waiting behind the top one shows above it
type Outcome = "post" | "remake";
type Box = { w: number; h: number };
const GOLD = "#FFC83A";
// The first card of an app session leans right and back once, with the POST stamp showing, so the swipe is never a
// secret. Any touch on the deck first, or a swipe, cancels it.
let nudged = false;

const REASONS: [string, string][] = [
  ["hook", "Hook too slow"], ["visuals", "Boring visuals"], ["voice", "Voice"],
  ["long", "Too long"], ["topic", "Wrong topic"], ["more", "Say more"],
];
// The one-tap edits under the card. Each sends the video back for a remake with the reason it maps to; Note writes one.
const EDITS: [string, string][] = [["hook", "Punchier hook"], ["long", "Shorter"], ["visuals", "New look"]];

export function useClock(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function Feed({ device, active, findNow }: { device: string; active: boolean; findNow?: string }) {
  const rows = useQuery(api.feed.next, { deviceId: device });
  const status = useQuery(api.feed.status, { deviceId: device });
  const swipe = useMutation(api.feed.swipe);
  const find = useQuery(api.scout.next, { deviceId: device });
  const swipeFind = useMutation(api.scout.swipe);
  // A Scout card comes up after every few videos, while the Scout has finds left.
  const [sinceFind, setSinceFind] = useState(0);
  const [findGone, setFindGone] = useState<string | null>(null);
  const showFind = !!find && find.id !== findGone && sinceFind >= FIND_EVERY;
  useEffect(() => { if (findNow) setSinceFind(FIND_EVERY); }, [findNow]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  // The video whose remake reason is being picked, or whose note is being written from the Note chip.
  const [asking, setAsking] = useState<{ clip: Clip; note: boolean } | null>(null);
  // The bounty an approved video is going to, shown over the deck for a moment after the swipe lands.
  const [sent, setSent] = useState<{ id: string; brand: string; mode: Mode; forecast: number | null } | null>(null);
  const toast = useToast();
  // This session's swipes, for the segments along the top of the video. A session starts each time the Feed comes into view.
  const [outcomes, setOutcomes] = useState<{ id: Id<"videos">; o: Outcome }[]>([]);
  useEffect(() => { if (active) setOutcomes([]); }, [active]);
  const clips = useMemo(() => (rows ?? []).filter(r => !gone.has(r.id)), [rows, gone]);
  const now = useClock(5000);
  const payoff = usePayoff();
  // The first approval of the day flips todayDone. Seeing that flip while the Feed is open earns the streak banner.
  const you = useQuery(api.you.summary, { deviceId: device, phoneDay: localDay(now) });
  // What posting a bounty video puts on the line: the Outpost bonus after a right call and after a wrong one.
  const rewards = useQuery(api.rewards.summary, { deviceId: device });
  const stakes = rewards ? { now: rewards.multiplier, pass: rewards.ifPass, fail: rewards.ifFail } : null;
  const doneBefore = useRef<boolean | null>(null);
  const streakAt = useRef(0);
  const lastPost = useRef(false); // whether the latest swipe was a post
  useEffect(() => {
    if (!you) return;
    if (doneBefore.current === false && you.todayDone && active) { payoff.streak(you.streak); streakAt.current = Date.now(); }
    doneBefore.current = you.todayDone;
  }, [you?.todayDone]);

  // Resolves true once Convex has taken the swipe, so a payoff never celebrates a swipe that didn't count.
  const send = (clip: Clip, dir: "right" | "left", dwellMs: number, reason?: string, note?: string) =>
    swipe({ deviceId: device, videoId: clip.id, dir, dwellMs, reason, note }).then(r => r.ok, e => {
      // Put the card back so the swipe can be made again.
      console.warn("swipe failed", e);
      setGone(g => { const n = new Set(g); n.delete(clip.id); return n; });
      setOutcomes(o => o.filter(x => x.id !== clip.id));
      return false;
    });

  const leave = (clip: Clip, o: Outcome) => {
    lastPost.current = o === "post";
    setGone(g => new Set(g).add(clip.id));
    setOutcomes(x => [...x, { id: clip.id, o }]);
    setSinceFind(n => n + 1);
  };
  const remake = (clip: Clip, dwellMs: number, reason: string, label: string, note?: string) =>
    send(clip, "left", dwellMs, reason, note).then(ok => { if (ok) payoff.remake(label); });
  // A swipe, a button or an edit chip. An edit chip names its reason, so it goes straight back without the sheet.
  const onSwipe = (clip: Clip, dir: 1 | -1, dwellMs: number, edit?: string) => {
    leave(clip, dir > 0 ? "post" : "remake");
    if (dir > 0) send(clip, "right", dwellMs).then(ok => {
      if (!ok) return;
      payoff.post();
      if (!clip.bounty || !status) return;
      feel("success");
      setSent({ id: clip.id, brand: clip.bounty.brand, mode: status.mode, forecast: clip.predicted ? Math.round(clip.predicted.score) : null });
    });
    else if (edit) remake(clip, dwellMs, edit, EDITS.find(([k]) => k === edit)?.[1] ?? edit);
    else { dwell.current = dwellMs; setAsking({ clip, note: false }); }
  };
  // The Note chip keeps the card until the note is sent, so backing out of it changes nothing.
  const onNote = (clip: Clip, dwellMs: number) => { dwell.current = dwellMs; setAsking({ clip, note: true }); };
  const dwell = useRef(0);
  const swipedToday = outcomes.length > 0 || (!!you && you.todayCounts.approved + you.todayCounts.remakes > 0);

  const offline = !status || now - status.studio.lastSeen > 25_000;
  // Swiping the last card ends the session with a chime, unless the streak banner is sounding or about to: a last post
  // before today counted flips todayDone once Convex takes it. Leaving the Feed or the studio going offline cancels a
  // chime still waiting.
  const star = useAudioPlayer(require("../assets/sounds/star.wav"));
  const hadClips = useRef(false);
  useEffect(() => {
    if (rows === undefined) return;
    if (clips.length > 0) { hadClips.current = true; return; }
    if (!hadClips.current) return;
    hadClips.current = false;
    const streakDue = lastPost.current && !!you && !you.todayDone;
    if (!active || offline || streakDue || Date.now() - streakAt.current < 3000) return;
    const t = setTimeout(() => {
      if (Date.now() - streakAt.current < 3000) return;
      star.seekTo(0).catch(() => {});
      star.play();
    }, 500);
    return () => clearTimeout(t);
  }, [clips.length, rows === undefined, active, offline]);
  // A swiped card leaves the ready count at once; the server's count catches up when the swipe lands.
  const ready = status ? Math.max(0, status.studio.ready - (rows ?? []).filter(r => gone.has(r.id)).length) : null;
  const atRisk = !!you && !you.todayDone;
  const line = !status ? " " : offline ? "Studio offline · the laptop is asleep"
    : atRisk ? (you.streak === 0 ? "Post 1 video to start a streak"
      // On a day the next post reaches a milestone, the line names it, the reward the banner is about to give.
      : MILESTONES.includes(you.streak + 1) ? `Post 1 video to reach a ${you.streak + 1}-day streak`
      : `Post 1 video to keep your ${you.streak}-day streak`)
    // "Studio · voicing", not "making voicing". Each step is named once, so three videos rendering read "Studio · rendering".
    : status.studio.making ? `Studio · ${[...new Set(status.studio.stages)].join(", ")}`
    : status.studio.queued ? `Studio · ${status.studio.queued} queued` : "Studio · resting";
  // The newest post drops down over the header for a few seconds whenever its state changes (approved, posting,
  // live), then gets out of the way. Live links stay on the You tab.
  const latest = status?.recent[0];
  const sig = latest ? `${latest.videoId}:${latest.posts.map(p => `${p.platform}=${p.status}`).join(",")}` : "";
  const [trayUntil, setTrayUntil] = useState(0);
  // Once the newest post is live on a bounty, its submission waits for one tap on Whop. That flow lives on the You tab,
  // so a toast points there.
  const toSubmit = latest?.submission === "manual";
  const lastSubmit = useRef<string | null>(null);
  useEffect(() => {
    if (!latest) return;
    const key = `${latest.videoId}:${latest.submission ?? ""}`;
    const was = lastSubmit.current;
    lastSubmit.current = key;
    if (was === null || was === key || !toSubmit || !active) return;
    toast.show({ title: "Ready to submit on Whop", body: "Your post is live. Submit it from the You tab.", icon: "coin",
      action: { label: "Submit", onPress: () => router.navigate("/you") }, testID: "submit-toast" });
  }, [latest?.videoId, latest?.submission]);
  // Platforms seen turning live while the app is open. Each pops in turn with a tick; one already live on open doesn't.
  const lastSig = useRef("");
  // Kept with the state it came from, so a pill never pops for an older change.
  const [fresh, setFresh] = useState({ sig: "", live: [] as string[] });
  const tick = useAudioPlayer(require("../assets/sounds/tick.wav"));
  // The ticks wait for their pops. A newer post state drops its pops, and the tab stays mounted, so a new state, leaving
  // the Feed or unmounting it cancels any tick still waiting.
  const ticks = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { ticks.current.forEach(clearTimeout); ticks.current = []; }, [active, sig]);
  useEffect(() => {
    if (!sig || !latest) return;
    const [vid, was = ""] = lastSig.current.split(":");
    lastSig.current = sig;
    const before = new Map(vid === latest.videoId ? was.split(",").map(x => x.split("=") as [string, string]) : []);
    const turned = latest.posts.filter(p => p.status === "live" && before.has(p.platform) && before.get(p.platform) !== "live").map(p => p.platform);
    setFresh({ sig, live: turned });
    if (active) turned.forEach((_, i) => ticks.current.push(setTimeout(() => {
      tick.seekTo(0).catch(() => {});
      tick.play();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 250 + i * 350)));
    // On the Feed's first load the tray only drops for a post still on its way out. One that went out earlier is old news,
    // and the tray would cover the header line that says what today's streak needs.
    if (!vid && !latest.posts.some(p => p.status === "queued" || p.status === "publishing" || p.status === "held")) return;
    setTrayUntil(Date.now() + 8000);
  }, [sig]);
  const [box, setBox] = useState<Box | null>(null);
  return (
    <View style={s.screen}>
      <Sea />
      {/* A slim strip instead of a titled header: the tab bar already says this is the Feed, and the video gets the room.
          It carries the two numbers a session moves: the streak, and the videos left to review. */}
      <View style={s.top}>
        <WoodHeader title="" right={status && <ModeChip mode={status.mode} />}
          left={
            <View style={s.counters}>
              <Counter icon={you?.todayDone ? "flame" : "flameoff"} value={you ? String(you.streak) : "…"} testID="feed-streak"
                label={you ? `${you.streak} day streak${you.todayDone ? ", kept today" : ", not kept today yet"}` : "Streak loading"} />
              <Counter icon="play" value={ready === null ? "…" : String(ready)} testID="feed-ready"
                label={ready === null ? "Ready videos loading" : `${ready} videos ready`} />
            </View>
          }
          below={<Text style={[s.line, atRisk && !offline && s.lineRisk]} numberOfLines={1} testID="studio-line">{line}</Text>} />
        <View style={s.drop} pointerEvents="box-none">
          {/* The tray sits above the deck area, out of the streak banner's dimming, so it steps aside while the banner
              shows and drops back in after it for the rest of its time. */}
          {latest && now < trayUntil && !payoff.banner && (
            <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOutUp.duration(180)} style={s.dropIn}>
              <Tray item={latest} fresh={fresh.sig === sig ? fresh.live : []} sig={sig} />
            </Animated.View>
          )}
          {payoff.toasts}
        </View>
      </View>
      <View style={s.deckArea} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {rows === undefined ? <Empty text="Connecting…" />
          : clips.length === 0 ? (!swipedToday ? <NoVideos making={status?.studio.making ?? 0} />
            : <CaughtUp approved={you?.todayCounts.approved ?? 0} remakes={you?.todayCounts.remakes ?? 0}
                streak={you?.todayDone ? you.streak : 0} making={status?.studio.making ?? 0} stages={status?.studio.stages ?? []}
                queued={status?.studio.queued ?? 0} offline={offline}
                onFind={find && find.id !== findGone ? () => setSinceFind(FIND_EVERY) : undefined} />)
          : box && <Deck clips={clips} done={outcomes.map(x => x.o)} onSwipe={onSwipe} onNote={onNote} active={active && !asking && !showFind}
              stakes={stakes} box={box} behind={!showFind} tucked={!!latest && now < trayUntil} />}
        {sent && <Sending key={sent.id} brand={sent.brand} mode={sent.mode} forecast={sent.forecast} onDone={() => setSent(null)} />}
        {showFind && find && (
          <FindCard key={find.id} find={find} onSwipe={dir => {
            setFindGone(find.id);
            setSinceFind(0);
            swipeFind({ deviceId: device, findId: find.id, dir }).catch(e => { console.warn("find swipe failed", e); setFindGone(null); setSinceFind(FIND_EVERY); });
          }} />
        )}
        {payoff.layer}
      </View>
      <Modal visible={!!asking} transparent animationType="fade"
        onRequestClose={() => {
          if (asking && !asking.note) send(asking.clip, "left", dwell.current).then(ok => { if (ok) payoff.skip(); });
          setAsking(null);
        }}>
        {asking && (
          <ReasonSheet
            hook={asking.clip.hook}
            note={asking.note}
            onPick={(reason, note) => {
              if (asking.note) leave(asking.clip, "remake");
              remake(asking.clip, dwell.current, reason, reason === "more" ? "your note" : REASONS.find(([k]) => k === reason)?.[1] ?? reason, note);
              setAsking(null);
            }}
            onSkip={() => {
              if (!asking.note) send(asking.clip, "left", dwell.current).then(ok => { if (ok) payoff.skip(); });
              setAsking(null);
            }}
          />
        )}
      </Modal>
      {toast.node}
    </View>
  );
}

// Status tags are flat, a fill with a 2 pt outline, so they never look like something to press. Only buttons get a bevel.
const TAG = { gold: "#FFC83A", slate: "#46567A", green: "#5BC44A", teal: "#2EB8A6" } as const;
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

function ModeChip({ mode }: { mode: "dryRun" | "private" | "public" }) {
  const [label, bevel] = mode === "dryRun" ? ["Dry run · nothing posts", "gold"] as const
    : mode === "private" ? ["Private test", "slate"] as const : ["Posting live", "green"] as const;
  return (
    <View style={[s.chip, { backgroundColor: TAG[bevel] }]} testID="mode-chip">
      <Text style={[s.chipText, mode !== "dryRun" && { color: "#fff" }]}>{label}</Text>
    </View>
  );
}

// The end of a session, as a streak payoff: the day just kept, what today's swipes added up to, the next day to come
// back for, and what the studio is doing meanwhile. Every number is real.
function CaughtUp({ approved, remakes, streak, making, stages, queued, offline, onFind }:
  { approved: number; remakes: number; streak: number; making: number; stages: string[]; queued: number; offline: boolean; onFind?: () => void }) {
  const studio = offline ? "Studio offline · the laptop is asleep" : making > 0 ? [`Making ${making} now · ${stages[0]}`, queued > 0 ? `${queued} queued` : ""].filter(Boolean).join(" · ")
    : queued > 0 ? `${queued} video${queued === 1 ? "" : "s"} queued at the studio` : "The studio is resting";
  const shown = useCountUp(approved);
  return (
    <Animated.View entering={ZoomIn.springify().damping(12).mass(1).stiffness(180)} style={s.caughtWrap}>
      <Block style={s.caught} lift={4} testID="caught-up">
        <Outlined size={32} width={2.5}>ALL CAUGHT UP</Outlined>
        {streak > 0 ? (
          <View style={s.caughtHero} testID="caught-streak">
            <Flame size={60} />
            <View>
              <Outlined size={44} width={3} color={GOLD}>{`DAY ${streak}`}</Outlined>
              <Text style={s.caughtKept}>streak kept</Text>
            </View>
          </View>
        ) : <Image source={ICON.check} style={s.caughtIcon} />}
        <View style={s.caughtTiles} testID="caught-counts">
          <View style={s.caughtTile}><Text style={s.caughtNum}>{shown}</Text><Text style={s.caughtLabel}>approved today</Text></View>
          <View style={s.caughtTile}><Text style={s.caughtNum}>{remakes}</Text><Text style={s.caughtLabel}>sent back</Text></View>
        </View>
        {streak > 0 ? <Block depth={3} style={s.caughtPath}><Milestones streak={streak} /></Block> : null}
        <View style={s.caughtStudio}>
          {making > 0 && <View style={s.caughtCrew}><Portrait who="writer" /><Portrait who="director" /></View>}
          <Text style={s.caughtNext}>{studio}</Text>
        </View>
        {onFind && <PixelButton label="See the Scout's find" bevel="teal" size={20} onPress={onFind} testID="caught-find" style={s.caughtBtn} />}
        <Button label="Find more bounties" bevel="green" size="md" onPress={() => router.navigate("/bounties")} testID="caught-bounties"
          style={onFind ? s.caughtBtn2 : s.caughtBtn} />
        <PixelButton label="Back to Base" bevel="gold" size={20} onPress={() => router.navigate("/")} testID="caught-base" style={s.caughtBtn2} />
      </Block>
    </Animated.View>
  );
}

// Nothing to swipe and nothing swiped today. The Feed fills from bounties, so this points at the board.
function NoVideos({ making }: { making: number }) {
  return (
    <Animated.View entering={ZoomIn.springify().damping(12).mass(1).stiffness(180)} style={s.caughtWrap}>
      <EmptyState icon="coin" title="Take a paid bounty and its videos land here" testID="feed-empty"
        body={`Approve the ones worth posting. The brand pays per 1K views on Whop.${making > 0 ? `\nStudio · remaking ${making} for you` : ""}`}
        action={{ label: "Browse bounties", onPress: () => router.navigate("/bounties"), testID: "empty-bounties" }} />
      <DemoNote style={s.demoNote} />
    </Animated.View>
  );
}

// The moment after a bounty video is approved: where it's going, in the words the posting mode allows. Only public
// posts submit to the bounty, so a dry run or a private test says so instead.
function Sending({ brand, mode, forecast, onDone }: { brand: string; mode: Mode; forecast: number | null; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, []);
  const [line, sub] = mode === "public" ? ["Posting + submitting to", null]
    : mode === "private" ? ["Posting a private test for", "Private posts aren't submitted"]
    : ["Approved for", "Dry run · nothing posts or submits"];
  return (
    <Animated.View entering={ZoomIn.springify().damping(12).mass(1).stiffness(180)} exiting={FadeOut.duration(200)} style={s.sending}
      pointerEvents="none" testID="posting-banner" accessible accessibilityLabel={`${line} ${brand}${sub ? `. ${sub}` : ""}`}>
      <Block bevel="green" depth={3} lift={4} style={s.sendingCard}>
        <Outlined size={18} width={1.5}>{line}</Outlined>
        <Outlined size={28} color={COLOR.goldPale}>{brand}</Outlined>
        {sub || forecast !== null ? (
          <View style={s.sendingRow}>
            {sub ? <Text style={s.sendingSub}>{sub}</Text> : null}
            {forecast !== null ? <Badge label={`FORECAST ${forecast}`} tone="violet" size="sm" dashed /> : null}
          </View>
        ) : null}
        <DemoNote style={s.sendingNote} />
      </Block>
    </Animated.View>
  );
}

// The studio's 0-100 guess at how well the video meets its bounty's brief, labeled as a guess. Tap for the whole reason.
function Forecast({ score, reason }: { score: number; reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => { feel("tap"); setOpen(o => !o); }} style={s.forecast} testID="forecast-chip" accessibilityRole="button"
      accessibilityLabel={`Forecast ${Math.round(score)} out of 100: ${reason}`}>
      <Badge label={HONESTY.forecast.label} tone={HONESTY.forecast.tone} size="sm" dashed />
      <Text style={s.forecastScore}>{Math.round(score)}</Text>
      <Text style={s.forecastReason} numberOfLines={open ? 4 : 1}>{reason}</Text>
    </Pressable>
  );
}

// Counts a number up from where it was shown last, so today's total lands with a little run instead of just appearing.
function useCountUp(to: number, ms = 600) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = Date.now(), a = from.current;
    const t = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const v = Math.round(a + (to - a) * k);
      setN(v);
      from.current = v;
      if (k === 1) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [to]);
  return n;
}

function Empty({ text }: { text: string }) {
  return (
    <Block style={s.empty} lift={4}>
      <Text style={s.emptyText}>{text}</Text>
    </Block>
  );
}

type Recent = FunctionReturnType<typeof api.feed.status>["recent"][number];

// The newest approved video and where each platform's copy stands. Tap a live one to open it.
function Tray({ item, fresh, sig }: { item: Recent; fresh: string[]; sig: string }) {
  const dry = item.posts.every(p => p.status === "dry_run");
  return (
    <Block style={s.tray} depth={3} lift={3} testID="post-tray">
      <Text style={s.trayTag}>{dry ? "APPROVED" : "POSTED"}</Text>
      <Text style={s.trayHook} numberOfLines={1}>{item.hook}</Text>
      {item.posts.map(p => {
        const name = p.platform === "youtube" ? "YouTube" : "Instagram";
        const [short, full, color] =
          p.status === "live" ? ["Live", "Live, tap to open", "#2F8A2C"]
          : p.status === "queued" || p.status === "publishing" ? ["Posting", "Posting", "#B06A00"]
          : p.status === "held" ? [clock(p.slotAt), `Queued, goes out ${clock(p.slotAt)}`, "#B06A00"]
          : p.status === "dry_run" ? ["Dry run", "Dry run, not sent", PARCH.soft]
          : p.status === "skipped" ? ["Skipped", p.error ?? "Skipped", PARCH.soft]
          : ["Failed", `Failed: ${p.error ?? "share by hand"}`, "#C0392B"];
        const at = fresh.indexOf(p.platform);
        return (
          <Pill key={p.platform} live={p.status === "live"} pop={at < 0 ? -1 : 250 + at * 350} sig={sig}
            onPress={p.url ? () => WebBrowser.openBrowserAsync(p.url!) : undefined} testID={`post-${p.platform}`} label={`${name}: ${full}`}>
            <Image source={PLAT[p.platform].mark} style={s.pillMark} />
            <Text style={[s.pillText, { color: p.status === "live" ? "#fff" : color }]} numberOfLines={1}>{short}</Text>
          </Pill>
        );
      })}
    </Block>
  );
}

// A live post is something to press, so its pill gets the green bevel and a lift; the rest stay flat tags. A pill
// seen turning live pops once, `pop` ms after the tray updates, so two platforms land one after the other.
function Pill({ live, pop, sig, onPress, testID, label, children }:
  { live: boolean; pop: number; sig: string; onPress?: () => void; testID: string; label: string; children: ReactNode }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    // A newer state drops any pop still waiting from the last one.
    cancelAnimation(scale);
    scale.value = 1;
    if (pop >= 0) scale.value = withDelay(pop, withSequence(withTiming(1.3, { duration: 120 }), withSpring(1, POP)));
  }, [pop, sig]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Pressable disabled={!onPress} onPress={onPress} testID={testID} accessibilityLabel={label} accessibilityRole={onPress ? "link" : undefined}>
        {live ? <Block bevel="green" depth={2} lift={3} style={s.pill}>{children}</Block> : <View style={[s.pill, s.pillFlat]}>{children}</View>}
      </Pressable>
    </Animated.View>
  );
}

// The whole 9:16 video fits inside the deck area, so nothing on it is cropped, including the AI-made label at the
// bottom. The card sits in a gold frame with the Post and Remake buttons hanging off its bottom edge.
function Deck({ clips, done, onSwipe, onNote, active, stakes, box, behind, tucked }:
  { clips: Clip[]; done: Outcome[]; onSwipe: (c: Clip, dir: 1 | -1, dwellMs: number, edit?: string) => void;
    onNote: (c: Clip, dwellMs: number) => void; active: boolean; stakes: { now: number; pass: number; fail: number } | null;
    box: Box; behind: boolean; tucked: boolean }) {
  // While the post tray is down, the cards waiting behind slide in behind the top one, so the tray never sits on their edges.
  const tuck = useSharedValue(0);
  useEffect(() => { tuck.value = withTiming(tucked ? 1 : 0, { duration: 180 }); }, [tucked]);
  const innerW = Math.min(box.w - 24 - FRAME * 2, ((box.h - OVERHANG - EDIT_ROW - FRAME * 2) * 9) / 16);
  const card = { width: innerW + FRAME * 2, height: (innerW * 16) / 9 + FRAME * 2, left: (box.w - innerW) / 2 - FRAME };
  const players = useRef(new Map<string, VideoPlayer>());
  const committed = useRef<string | null>(null); // a card swiped away can't be swiped again by a second tap
  const thrown = useRef<string | null>(null); // the card a button has already thrown; a second tap can't redirect it
  const shownAt = useRef(Date.now());
  const shownId = useRef<string | null>(null);
  const x = useSharedValue(0);
  const hint = useSharedValue(0); // the POST stamp's opacity during the nudge
  const past = useSharedValue(0); // which side of the throw point a drag is on: 1 right, -1 left, 0 inside
  const stampPop = useSharedValue(1);
  const nudging = useSharedValue(false); // the nudge is moving x, so a touch can take it back
  const top = clips[0];
  const [, force] = useState(0);
  useEffect(() => {
    if (nudged || !active || !top) return;
    const t = setTimeout(() => {
      if (nudged || committed.current || thrown.current) return;
      nudged = true;
      nudging.value = true;
      // Eased back rather than sprung, so it doesn't swing past the middle and flash REMAKE. The callback runs however
      // the return ends, also when a drag, a throw or a touch replaces it.
      x.value = withSequence(withTiming(30, { duration: 280, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 420, easing: Easing.inOut(Easing.quad) }, () => { nudging.value = false; }));
      hint.value = withSequence(withTiming(0.6, { duration: 280 }), withTiming(0, { duration: 420 }));
    }, 1200);
    return () => clearTimeout(t);
  }, [active, top?.id]);

  // Keep the top card and the next two loaded, release the rest.
  useEffect(() => {
    const want = clips.slice(0, 3);
    let fresh = false;
    for (const c of want) {
      if (players.current.has(c.id)) continue;
      const p = createVideoPlayer({ uri: c.url });
      p.loop = true;
      players.current.set(c.id, p);
      if (c.id === top?.id) fresh = true;
    }
    for (const [id, p] of players.current) if (!want.some(c => c.id === id)) { p.release(); players.current.delete(id); }
    // A new clip arriving further down the deck leaves the card being watched alone.
    if (fresh || top?.id !== shownId.current) {
      shownId.current = top?.id ?? null;
      committed.current = null;
      thrown.current = null;
      for (const [id, p] of players.current) if (id === top?.id) { p.currentTime = 0; if (active) p.play(); } else p.pause();
      shownAt.current = Date.now();
      x.value = 0;
    }
    force(n => n + 1);
  }, [top?.id, clips.length]);
  // Only the Feed tab makes sound. Leaving it pauses the top card, coming back resumes it.
  useEffect(() => {
    const cur = top && players.current.get(top.id);
    if (!cur) return;
    if (active) { cur.play(); shownAt.current = Date.now(); } else cur.pause();
  }, [active]);
  // Clear the map too: a hot reload runs this cleanup and then reuses the ref.
  useEffect(() => () => { for (const p of players.current.values()) p.release(); players.current.clear(); }, []);

  const commit = (dir: 1 | -1, edit?: string) => {
    if (!top || committed.current === top.id) return;
    committed.current = top.id;
    nudged = true;
    Haptics.impactAsync(dir > 0 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    onSwipe(top, dir, Date.now() - shownAt.current, edit);
  };
  // The buttons and edit chips throw the card the same way a swipe does.
  const fling = (dir: 1 | -1, edit?: string) => {
    if (!top || thrown.current === top.id) return;
    thrown.current = top.id;
    nudged = true;
    x.value = withTiming(dir * W * 1.5, { duration: 220 }, finished => { if (finished) runOnJS(commit)(dir, edit); });
  };

  // A touch means they found the card, so the nudge never plays again. It also stops a nudge that's running, so the
  // POST stamp doesn't show under their finger: the card goes back to the middle, unless a drag moves it first. A
  // button throw that's running is left alone.
  const seen = () => { nudged = true; };
  const tickPast = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
  const pan = Gesture.Pan()
    .onBegin(() => {
      past.value = 0;
      runOnJS(seen)();
      cancelAnimation(hint);
      hint.value = 0;
      if (nudging.value) {
        nudging.value = false;
        x.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) });
      }
    })
    .onUpdate(e => {
      x.value = e.translationX;
      // Crossing the point where letting go throws the card ticks once and pops its stamp, so the thumb knows before it
      // lets go.
      const side = Math.abs(e.translationX) > W * 0.25 ? Math.sign(e.translationX) : 0;
      if (side === past.value) return;
      past.value = side;
      if (side === 0) return;
      runOnJS(tickPast)();
      stampPop.value = withSequence(withTiming(1.2, { duration: 90 }), withSpring(1, POP));
    })
    .onEnd(e => {
      const go = Math.abs(e.translationX) > W * 0.25 || Math.abs(e.velocityX) > 800;
      if (go) {
        const dir = (Math.sign(e.translationX || e.velocityX) || 1) as 1 | -1;
        x.value = withTiming(dir * W * 1.5, { duration: 160 }, finished => { if (finished) runOnJS(commit)(dir); });
      } else x.value = withSpring(0);
    });

  const topStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: `${interpolate(x.value, [-W, W], [-10, 10])}deg` }],
  }));
  // The cards waiting behind show their top edges above the top card. As the top card is dragged off, each one grows
  // into the place in front of it.
  const nextStyle = useBehind(x, card.height, 1, tuck);
  const thirdStyle = useBehind(x, card.height, 2, tuck);
  const postStamp = useAnimatedStyle(() => ({
    opacity: Math.max(hint.value, interpolate(x.value, [0, W * 0.25], [0, 1], "clamp")),
    transform: [{ rotate: "-10deg" }, { scale: x.value > 0 ? stampPop.value : 1 }],
  }));
  const remakeStamp = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-W * 0.25, 0], [1, 0], "clamp"),
    transform: [{ rotate: "10deg" }, { scale: x.value < 0 ? stampPop.value : 1 }],
  }));

  const next = clips[1] && players.current.get(clips[1].id);
  const cur = top && players.current.get(top.id);
  return (
    <View style={s.fill}>
      {clips[2] && (
        <Animated.View style={[s.card, card, thirdStyle, !behind && s.hidden]}>
          <Block bevel="gold" depth={3} lift={4} style={s.fill}><View style={s.screenIn} /></Block>
        </Animated.View>
      )}
      {next && (
        <Animated.View style={[s.card, card, nextStyle, !behind && s.hidden]}>
          <Block bevel="gold" depth={3} lift={4} style={s.fill}>
            <View style={s.screenIn}><VideoView player={next} style={s.video} nativeControls={false} contentFit="cover" /></View>
          </Block>
        </Animated.View>
      )}
      {cur && (
        <GestureDetector gesture={pan}>
          <Animated.View style={[s.card, card, topStyle]} testID="top-card">
            <Block bevel="gold" depth={3} lift={4} style={s.fill}>
              <View style={s.screenIn}>
                <VideoView key={top.id} player={cur} style={s.video} nativeControls={false} contentFit="cover" />
                <Segments key={`p${top.id}`} done={done} left={clips.length} player={cur} />
                {/* What the video is for and how it was made, stacked down the top-left corner under the segments. */}
                <View style={s.tags} pointerEvents="box-none">
                  {top.bounty ? (
                    <Badge label={`${top.bounty.brand} · ${top.bounty.rewardLabel}`} tone="gold" icon="coin" testID="bounty-tag" style={s.tagMax} />
                  ) : top.scout ? (
                    <View style={[s.badge, { backgroundColor: TAG.teal }]} testID="scout-label">
                      <Image source={ICON.glass} style={s.badgeIcon} />
                      <Text style={s.badgeText}>{`Scout pick · ${money(top.scout.priceCents)} Whop app`}</Text>
                    </View>
                  ) : null}
                  {top.remade ? (
                    <Badge label={`Remade: ${top.remade.label}`} tone="orange" testID="remade-label" />
                  ) : null}
                  {top.pregenerated ? (
                    <Badge label="Pregenerated for the demo" size="sm" dashed testID="pregenerated-label" />
                  ) : null}
                  {top.predicted ? <Forecast key={top.id} score={top.predicted.score} reason={top.predicted.reason} /> : null}
                  {top.bounty && stakes ? (
                    <Badge label={`Bonus ${mult(stakes.now)}: right call ${mult(stakes.pass)} · wrong call ${mult(stakes.fail)}`}
                      tone="ink" size="sm" testID="stakes-label" style={s.tagMax} />
                  ) : null}
                </View>
              </View>
            </Block>
            <Animated.View style={[s.stamp, s.post, postStamp]}><Block bevel="green" depth={3} style={s.stampFace}><Outlined size={34}>POST</Outlined></Block></Animated.View>
            <Animated.View style={[s.stamp, s.remake, remakeStamp]}><Block bevel="orange" depth={3} style={s.stampFace}><Outlined size={34}>REMAKE</Outlined></Block></Animated.View>
          </Animated.View>
        </GestureDetector>
      )}
      {cur && active && (
        <View style={[s.actions, { top: card.height - OVERHANG, left: card.left + 8, width: card.width - 16 }]} pointerEvents="box-none">
          <PixelButton label="REMAKE" bevel="orange" size={20} onPress={() => fling(-1)} testID="remake-button" style={s.action} />
          <PixelButton label="POST" bevel="green" size={20} onPress={() => fling(1)} testID="post-button" style={s.action} />
        </View>
      )}
      {cur && active && (
        <View style={[s.edits, { top: card.height + OVERHANG + 17 }]} pointerEvents="box-none" testID="edit-chips">
          {EDITS.map(([key, label]) => <Chip key={key} label={label} size="md" onPress={() => fling(-1, key)} testID={`edit-${key}`} style={s.editCell} />)}
          <Chip label="Note" size="md" onPress={() => onNote(top, Date.now() - shownAt.current)} testID="edit-note" style={s.editCell} />
        </View>
      )}
    </View>
  );
}

// Where you are in this session, the way Stories mark their segments along the top: one per video, gold once posted,
// orange once sent back, and the one on screen filling as it plays. At most 12. The last 6 swipes always keep their
// place, so a long deck can't push them out; past that the oldest drop off.
function Segments({ done, left, player }: { done: Outcome[]; left: number; player: VideoPlayer }) {
  const past = Math.min(done.length, Math.max(12 - left, 6));
  const ahead = Math.min(left, 12 - past);
  const behind = done.slice(done.length - past);
  return (
    <View style={s.segs} pointerEvents="none" testID="session-segments">
      {behind.map((o, i) => <View key={`d${i}`} style={[s.seg, { backgroundColor: o === "post" ? GOLD : "#F07A2A" }]} />)}
      {Array.from({ length: ahead }, (_, i) => (
        <View key={`a${i}`} style={s.seg}>{i === 0 && <Progress player={player} />}</View>
      ))}
    </View>
  );
}

// How far through its clip the top card is, filling the current segment.
function Progress({ player }: { player: VideoPlayer }) {
  const p = useSharedValue(0);
  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      const k = player.duration > 0 ? Math.min(1, currentTime / player.duration) : 0;
      // A loop jumps back to the start at once. Forward steps glide, so the line moves smoothly between events.
      p.value = k < p.value ? k : withTiming(k, { duration: 250, easing: Easing.linear });
    });
    return () => sub.remove();
  }, [player]);
  const style = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return <Animated.View style={[s.progressFill, style]} testID="clip-progress" />;
}

// Where the card `depth` places behind the top one sits: smaller, and raised so PEEK points of its frame show for each
// place. It moves up a place as the top card leaves, so the swap at the end of a swipe doesn't jump. At `tuck` 1 none of
// it shows.
function useBehind(x: SharedValue<number>, height: number, depth: number, tuck: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const d = depth - Math.min(Math.abs(x.value) / (W * 0.5), 1);
    const scale = 1 - 0.06 * d;
    return { transform: [{ translateY: -(PEEK * d * (1 - tuck.value) + (height * (1 - scale)) / 2) }, { scale }] };
  });
}

// The sheet names the video it's about, since the deck behind it has already moved on to the next card.
// From the Note chip it opens on the note box, and backing out keeps the video in the Feed.
function ReasonSheet({ hook, note: noteOnly, onPick, onSkip }:
  { hook: string; note: boolean; onPick: (reason: string, note?: string) => void; onSkip: () => void }) {
  const [writing, setWriting] = useState(noteOnly);
  const [note, setNote] = useState("");
  return (
    // The sheet rides up with the keyboard, so "Say more" keeps its note box and send button in view.
    <KeyboardAvoidingView behavior="padding" style={s.sheetWrap}>
      <Pressable style={s.fill} onPress={onSkip} />
      <Block style={s.sheet} depth={4} testID="reason-sheet">
        {/* The same wooden board as the Away card and the raid picker, so the sheet reads as a game menu. */}
        <View style={s.sheetBoard}>
          <View style={[s.sheetGrain, { top: 12 }]} /><View style={[s.sheetGrain, { top: 38 }]} />
          <Portrait who="director" />
          <Outlined size={22} style={s.sheetTitle}>What should the studio change?</Outlined>
          <View style={s.sheetEdge} />
        </View>
        {/* The video going back, as a small black card in the reel's own heavy type and stamped REMAKE, so it can't be
            mixed up with the next card behind the sheet. */}
        <View style={s.hookCard} testID="reason-hook" accessible accessibilityLabel={`Sending back ${hook}`}>
          <Text style={s.hookText} numberOfLines={2}>{hook}</Text>
          <Block bevel="orange" depth={2} style={s.hookStamp}><Outlined size={16}>REMAKE</Outlined></Block>
        </View>
        {writing ? (
          <View>
            <TextInput style={s.input} autoFocus value={note} onChangeText={setNote} placeholder="Tell the studio what to change"
              placeholderTextColor={PARCH.soft} maxLength={200} />
            <PixelButton label="Send it back" bevel="orange" size={20} disabled={!note.trim()} onPress={() => onPick("more", note.trim())} style={s.send} />
          </View>
        ) : (
          <View style={s.chips}>
            {REASONS.map(([key, label]) => (
              <Pressable key={key} style={s.reasonCell} testID={`reason-${key}`} onPress={() => key === "more" ? setWriting(true) : onPick(key)} accessibilityRole="button">
                {({ pressed }) => (
                  <View style={[s.reason, pressed && s.reasonDown]}>
                    <Text style={s.reasonText}>{label}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}
        <Pressable onPress={onSkip} hitSlop={8} testID="reason-skip"><Text style={s.skip}>{noteOnly ? "Keep it" : "Just skip it"}</Text></Pressable>
      </Block>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: DEEP },
  top: { zIndex: 2 },
  // Dropped lines cover the studio line and the peeking cards, never the counters a swipe just moved.
  drop: { position: "absolute", left: 0, right: 0, bottom: -PEEK * 2, height: 60 },
  dropIn: { position: "absolute", left: 0, right: 0, bottom: -6 }, // 6 pt below the mode chip
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderWidth: 2, borderColor: INK },
  chipText: { color: INK, fontSize: 16, fontFamily: FONT.bold },
  tray: { marginHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 10, paddingRight: 6, paddingTop: 7, paddingBottom: 9 },
  trayTag: { color: "#B06A00", fontSize: 15, fontFamily: FONT.bold },
  trayHook: { flex: 1, color: PARCH.ink, fontSize: 16, fontFamily: FONT.semi },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingTop: 3, paddingBottom: 5, maxWidth: 110 },
  hidden: { opacity: 0 },
  pillFlat: { backgroundColor: PARCH.top, borderWidth: 2, borderColor: INK, paddingBottom: 3 },
  pillMark: { width: 18, height: 18 },
  pillText: { fontSize: 15, fontFamily: FONT.bold, flexShrink: 1 },
  counters: { flexDirection: "row", gap: 6 },
  line: { color: "#FFD65C", fontSize: 17, fontFamily: FONT.semi, marginTop: 6 },
  lineRisk: { color: "#FFB347", fontFamily: FONT.bold },
  deckArea: { flex: 1, marginTop: 12 + PEEK * 2, marginBottom: 18 }, // room for the cards peeking above and the buttons below
  caughtWrap: { flex: 1, justifyContent: "center", marginHorizontal: 24, marginBottom: 40 },
  caughtIcon: { width: 48, height: 48, marginTop: 10 },
  caughtHero: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  caughtKept: { color: PARCH.ink, fontSize: 19, fontFamily: FONT.bold, marginTop: -4 },
  caughtTiles: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 14 },
  caughtTile: { flex: 1, alignItems: "center", backgroundColor: PARCH.top, borderWidth: 2, borderColor: INK, paddingTop: 4, paddingBottom: 8 },
  caughtNum: { color: PARCH.ink, fontSize: 36, fontFamily: FONT.bold },
  caughtLabel: { color: PARCH.soft, fontSize: 16, fontFamily: FONT.semi, marginTop: -4 },
  caughtStudio: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12 },
  caughtCrew: { flexDirection: "row", gap: 4 },
  caught: { alignItems: "center", paddingHorizontal: 18, paddingTop: 20, paddingBottom: 20 },
  caughtPath: { alignSelf: "stretch", marginTop: 14, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
  caughtNext: { color: PARCH.soft, fontSize: 17, fontFamily: FONT.semi, textAlign: "center", flexShrink: 1 },
  caughtBtn: { alignSelf: "stretch", marginTop: 16 },
  caughtBtn2: { alignSelf: "stretch", marginTop: 10 },
  empty: { marginHorizontal: 28, marginTop: 120, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 22 },
  emptyText: { color: PARCH.ink, fontSize: 21, fontFamily: FONT.semi, textAlign: "center", lineHeight: 28 },
  card: { position: "absolute", top: 0 },
  screenIn: { flex: 1, margin: FRAME - 5, borderWidth: 2, borderColor: INK, backgroundColor: "#000", overflow: "hidden" }, // 3 outline + 4 + 2 inner = FRAME
  video: { flex: 1 },
  segs: { position: "absolute", left: 6, right: 6, top: 5, height: 5, flexDirection: "row", gap: 3 },
  seg: { flex: 1, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: GOLD },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", paddingHorizontal: 8, paddingVertical: 4, borderWidth: 2, borderColor: INK },
  badgeIcon: { width: 20, height: 20, marginLeft: -2 },
  badgeText: { color: INK, fontSize: 16, fontFamily: FONT.bold },
  tags: { position: "absolute", top: 14, left: 10, right: 10, alignItems: "flex-start", gap: 5 },
  tagMax: { maxWidth: "100%" },
  forecast: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", backgroundColor: COLOR.violetPale, borderWidth: 2,
    borderColor: INK, borderStyle: "dashed", paddingLeft: 3, paddingRight: 7, paddingVertical: 3 },
  forecastScore: { color: INK, fontSize: 19, fontFamily: FONT.bold },
  forecastReason: { flexShrink: 1, color: PARCH.ink, fontSize: 15, fontFamily: FONT.semi },
  edits: { position: "absolute", left: 12, right: 12, flexDirection: "row", gap: 6 },
  editCell: { flexGrow: 1 },
  sending: { position: "absolute", left: 24, right: 24, bottom: EDIT_ROW + OVERHANG + 40, alignItems: "center" },
  sendingCard: { alignItems: "center", paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  sendingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sendingSub: { color: INK, fontSize: 16, fontFamily: FONT.semi },
  sendingNote: { marginTop: 8 },
  demoNote: { marginTop: 14 },
  stamp: { position: "absolute", top: 56 },
  stampFace: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  post: { left: 22 }, // tilted -10 degrees in postStamp
  remake: { right: 22 }, // tilted 10 degrees in remakeStamp
  actions: { position: "absolute", flexDirection: "row", justifyContent: "space-between" },
  action: { width: 128 },
  sheetWrap: { flex: 1, backgroundColor: "rgba(20,10,30,0.97)" }, // dark enough that the next card's hook can't be read
  sheet: { padding: 20, paddingBottom: 44, borderBottomWidth: 0 },
  sheetBoard: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: -20, marginTop: -20, marginBottom: 16,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, backgroundColor: WOOD.base, overflow: "hidden" },
  sheetGrain: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: WOOD.grain },
  sheetEdge: { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, borderTopWidth: 3, borderTopColor: INK, backgroundColor: WOOD.lip },
  sheetTitle: { flex: 1 },
  hookCard: { backgroundColor: "#141018", borderWidth: 2, borderColor: INK, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
    marginBottom: 16, marginTop: 4 },
  hookText: { color: "#F2F2F2", fontSize: 19, fontWeight: "900", letterSpacing: -0.5, lineHeight: 23, paddingRight: 70 },
  hookStamp: { position: "absolute", right: -6, top: -12, paddingHorizontal: 7, paddingTop: 1, paddingBottom: 5, transform: [{ rotate: "8deg" }] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reasonCell: { width: "48%", flexGrow: 1 },
  reason: { backgroundColor: PARCH.top, borderWidth: 2, borderColor: INK, borderBottomWidth: 5, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 9, alignItems: "center" },
  reasonDown: { borderBottomWidth: 2, marginTop: 3, backgroundColor: PARCH.bottom },
  reasonText: { color: PARCH.ink, fontSize: 20, fontFamily: FONT.bold },
  input: { backgroundColor: PARCH.top, color: PARCH.ink, borderWidth: 2, borderColor: INK, padding: 14, fontSize: 20, fontFamily: FONT.regular },
  send: { marginTop: 12 },
  skip: { color: PARCH.soft, textAlign: "center", marginTop: 18, fontSize: 18, fontFamily: FONT.semi },
});
