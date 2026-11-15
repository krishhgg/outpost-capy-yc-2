import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Image, Modal, Pressable, StyleSheet, Text, View, type HostInstance } from "react-native";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { router, usePathname } from "expo-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { useDevice } from "./session";
import type { Who } from "./Agents";
import { Portrait } from "./Portrait";
import { ICON, type IconName } from "./Hud";
import { centerOf, clearPending, getPending, setAwayUp, setPending, targets, type Point } from "./collect";
import { Block, FONT, INK, Outlined, PARCH, PixelButton, WOOD } from "./pixel";
import { TierUp } from "./Payoff";
import { TIERS, tierFor } from "./ui";
import { FRESH_MS } from "./You";

type Summary = FunctionReturnType<typeof api.away.summary>;
// The taste side of the card: the score when the user last collected and now, and the best and worst post.
type Taste = FunctionReturnType<typeof api.earnings.summary>["away"];

const AWAY_MS = 20 * 60_000; // shorter breaks go straight to the app
const COUNT_MS = 600;
const STEP_MS = 420; // between the lines landing one by one
const GOLD = "#FFC83A";
const FLY_MS = 520; // one icon's flight to its counter
const LAUNCH_MS = 180; // the card fades this long before the first icon leaves
const GAP_MS = 70; // between icons leaving
const SETTLE_MS = 450; // after the last landing, before the card closes

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function since(t: number) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "long" })} ${time}`;
}

// Counts from `from` to `to`, easing out. `skip` jumps to the end.
function useCountUp(from: number, to: number, skip: boolean) {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (skip || from === to) { setN(to); return; }
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / COUNT_MS);
      setN(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, skip]);
  return n;
}

// Checks at launch, and when the app returns after more than 20 minutes in the background. Each check asks the
// server for a fresh summary, and the screen opens only if something happened. It sits above the tabs, so it
// opens over whichever tab is showing.
export function Away() {
  const device = useDevice();
  const convex = useConvex();
  const collect = useMutation(api.away.collect);
  const mark = useMutation(api.earnings.mark);
  const status = useQuery(api.feed.status, device ? { deviceId: device } : "skip");
  // Lives here rather than in the sheet, so the chime keeps ringing after the sheet closes.
  const chime = useAudioPlayer(require("../assets/sounds/collect.wav"));
  const [shown, setShown] = useState<Summary | null>(null);
  const [taste, setTaste] = useState<Taste | null>(null);

  useEffect(() => {
    if (!device) return;
    let leftAt = 0;
    const check = (launch: boolean) => Promise.all([
      convex.query(api.away.summary, { deviceId: device }),
      convex.query(api.earnings.summary, { deviceId: device }).then(e => e.away ?? null).catch(() => null),
    ]).then(([d, t]) => {
      const news = d.made + d.posted + d.sales.count + (d.views.to - d.views.from);
      // At launch the app can't know when it was last open, so it uses the last Collect instead.
      if (news > 0 && (!launch || Date.now() - d.since > AWAY_MS)) { setTaste(t); setShown(d); }
      else if (launch) setAwayUp(false);
    }).catch(() => { if (launch) setAwayUp(false); });
    check(true);
    const sub = AppState.addEventListener("change", s => {
      if (s === "background") leftAt = Date.now();
      else if (s === "active" && leftAt) {
        if (Date.now() - leftAt > AWAY_MS) check(false);
        leftAt = 0;
      }
    });
    return () => sub.remove();
  }, [convex, device]);

  // While the card is open, the Base's counters leave out what it is about to give.
  useEffect(() => {
    if (shown) setPending({ views: shown.views.to - shown.views.from, cents: shown.sales.netCents });
    else clearPending();
    if (shown) setAwayUp(true);
  }, [shown]);
  // The loot flies only when the Base and its counters are on screen.
  const onBase = usePathname() === "/";

  if (!shown || !device) return device ? <TierWatch device={device} /> : null;
  // Videos waiting in the Feed, so the button can take you straight to them.
  const ready = status?.studio.ready ?? 0;
  const collectNow = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    chime.seekTo(0).catch(() => {});
    chime.play();
    collect({ deviceId: device, at: shown.at, views: shown.views.to }).catch(() => {});
    if (taste?.scoreTo !== null && taste?.scoreTo !== undefined) mark({ deviceId: device, score: taste.scoreTo }).catch(() => {});
  };
  const finish = () => {
    setShown(null);
    setAwayUp(false);
    if (ready > 0) router.navigate("/feed");
  };
  return <Sheet s={shown} taste={taste} ready={ready} onBase={onBase} onCollect={collectNow} onDone={finish} />;
}

// A tier reached while the app is open gets its moment. The first score after launch only sets the mark, so opening
// the app never celebrates an old tier.
function TierWatch({ device }: { device: string }) {
  const taste = useQuery(api.earnings.summary, { deviceId: device })?.taste;
  const tier = taste?.score === null || taste?.score === undefined ? null : tierFor(taste.score);
  const rank = tier ? TIERS.indexOf(tier) : null;
  const last = useRef<number | null>(null);
  const [up, setUp] = useState<{ name: string; provisional: boolean } | null>(null);
  useEffect(() => {
    if (rank === null || !tier) return;
    if (last.current !== null && rank > last.current) setUp({ name: tier.name, provisional: taste?.state === "calibrating" });
    last.current = rank;
  }, [rank]);
  return up ? <TierUp name={up.name} provisional={up.provisional} onDone={() => setUp(null)} /> : null;
}

const VERDICT = { hit: "HIT", solid: "SOLID", miss: "MISS" } as const;

// "Taste score 58 → 62", with the change in green or muted red. A first score has nothing to compare with.
function ScoreLine({ t }: { t: Taste }) {
  const diff = t.scoreFrom === null || t.scoreTo === null ? 0 : t.scoreTo - t.scoreFrom;
  return (
    <View style={st.scoreLine}>
      <Image source={ICON.star} style={st.star} />
      <View style={st.lineBody}>
        <Text style={st.rowLabel}>Taste score</Text>
        <View style={st.scoreRow}>
          <Text style={st.scoreValue}>{t.scoreFrom === null || t.scoreFrom === t.scoreTo ? String(t.scoreTo) : `${t.scoreFrom} → ${t.scoreTo}`}</Text>
          {diff !== 0 && <Text style={[st.delta, { color: diff > 0 ? "#2F8A2C" : "#8A3A32" }]}>{diff > 0 ? `+${diff}` : String(diff)}</Text>}
        </View>
      </View>
    </View>
  );
}

// The best and worst post: by their verdict against the baseline once graded, by views before that.
function PostsLine({ t }: { t: Taste }) {
  const say = (p: NonNullable<Taste["best"]>) => p.verdict && p.ratio !== null
    ? `${VERDICT[p.verdict]} ${p.ratio.toFixed(1)}x${Date.now() - p.liveAt < FRESH_MS ? " so far" : ""}` : `${p.views.toLocaleString()} views`;
  return (
    <View style={st.postsBody}>
      {t.best && <Text style={st.postLine} numberOfLines={1}><Text style={st.postKey}>Best </Text>{`${say(t.best)} · ${t.best.title}`}</Text>}
      {t.worst && <Text style={st.postLine} numberOfLines={1}><Text style={st.postKey}>Worst </Text>{`${say(t.worst)} · ${t.worst.title}`}</Text>}
    </View>
  );
}

// A run of icons from a line of the card to a header counter. Each landing gives the counter its share.
type Leg = { icon: IconName; key: "views" | "cents"; amount: number; from: Point; to: Point; n: number };

function Sheet({ s, taste, ready, onBase, onCollect, onDone }:
  { s: Summary; taste: Taste | null; ready: number; onBase: boolean; onCollect: () => void; onDone: () => void }) {
  const tick = useAudioPlayer(require("../assets/sounds/tick.wav"));
  const [skip, setSkip] = useState(false);
  const gained = s.views.to - s.views.from;
  const work = [
    s.made > 0 && plural(s.made, "video") + " made",
    s.posted > 0 && `${s.posted} posted`,
  ].filter(Boolean).join(" · ");
  // The lines land one at a time with a tick, like loot being counted out. A tap anywhere shows the rest at once.
  // The score change leads, then the best and worst post, then what the agents did.
  const scoreRow = !!taste && taste.scoreTo !== null;
  const postsRow = !!taste?.best;
  const rows = [scoreRow, postsRow, work !== "", s.sales.count > 0, gained > 0].filter(Boolean).length;
  // Views alone is the whole story, so it gets the card the way loot does in a game: centered and big.
  const hero = rows === 1 && gained > 0;
  const [landed, setLanded] = useState(0);
  useEffect(() => {
    if (skip) { setLanded(rows); return; }
    if (landed >= rows) return;
    const t = setTimeout(() => {
      tick.seekTo(0).catch(() => {});
      tick.play();
      Haptics.selectionAsync().catch(() => {});
      setLanded(n => n + 1);
    }, landed === 0 ? 300 : STEP_MS);
    return () => clearTimeout(t);
  }, [landed, skip, rows]);
  let next = 0;
  const lands = () => next++ < landed;

  // Collect: the card fades, the loot spills from its lines and arcs into the counters, one tick per landing.
  const viewsAt = useRef<HostInstance>(null);
  const salesAt = useRef<HostInstance>(null);
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const fade = useSharedValue(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const pressed = useRef(false);
  const press = async () => {
    if (pressed.current) return;
    pressed.current = true;
    setSkip(true);
    onCollect();
    const [eye, coin, v, c] = onBase
      ? await Promise.all([centerOf(targets.get("hud-views")), centerOf(targets.get("hud-vault")), centerOf(viewsAt.current), centerOf(salesAt.current)])
      : [null, null, null, null];
    const next: Leg[] = [];
    if (eye && v && gained > 0) next.push({ icon: "eye", key: "views", amount: gained, from: v, to: eye, n: Math.min(8, gained) });
    if (coin && c && s.sales.netCents > 0) next.push({ icon: "coin", key: "cents", amount: s.sales.netCents, from: c, to: coin, n: Math.min(6, s.sales.count + 3) });
    if (!next.length) return onDone();
    setLegs(next);
    fade.value = withTiming(0, { duration: LAUNCH_MS });
    let last = 0;
    for (const leg of next) {
      for (let i = 1; i <= leg.n; i++) {
        const at = LAUNCH_MS + (i - 1) * GAP_MS + FLY_MS;
        last = Math.max(last, at);
        timers.current.push(setTimeout(() => {
          tick.seekTo(0).catch(() => {});
          tick.play();
          Haptics.selectionAsync().catch(() => {});
          setPending({ ...getPending(), [leg.key]: Math.round(leg.amount * (leg.n - i) / leg.n) });
        }, at));
      }
    }
    timers.current.push(setTimeout(onDone, last + SETTLE_MS));
  };
  const dim = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Modal transparent animationType="fade" visible>
      <Animated.View style={[st.dim, dim]} pointerEvents="none" />
      <Pressable style={st.backdrop} onPress={() => setSkip(true)} disabled={!!legs} testID="away">
        <Animated.View entering={FadeInDown.duration(250)} style={dim}>
          <Block style={st.card} depth={4} lift={6}>
            <View style={st.board}>
              <View style={[st.grain, { top: 12 }]} /><View style={[st.grain, { top: 32 }]} />
              <Outlined size={24} width={2}>While you were away</Outlined>
              <Text style={st.since}>Since {since(s.since)}</Text>
              <View style={st.boardEdge} />
            </View>
            <View style={st.body}>
              {scoreRow && (
                <Reveal on={lands()} testID="away-score"><ScoreLine t={taste!} /></Reveal>
              )}
              {postsRow && (
                <Line on={lands()} who="courier" style={scoreRow ? st.row : undefined} testID="away-posts">
                  <PostsLine t={taste!} />
                </Line>
              )}
              {work !== "" && (
                <Line on={lands()} who="director" style={scoreRow || postsRow ? st.row : undefined} testID="away-work">
                  <Text style={st.work}>{work}</Text>
                </Line>
              )}
              {/* A divider separates a line from the one above it, so the first line has none. */}
              {s.sales.count > 0 && (
                <Line on={lands()} who="merchant" style={work !== "" || scoreRow || postsRow ? st.row : undefined} testID="away-sales">
                  <Text style={st.rowLabel}>{s.sales.test ? "Test sales" : "Sales"}</Text>
                  <Text style={st.rowValue} ref={salesAt}>+{s.sales.count} · {money(s.sales.netCents)}</Text>
                </Line>
              )}
              {hero && (
                <Hero on={lands()}>
                  <View ref={viewsAt} collapsable={false}><Views gained={gained} skip={skip} hero /></View>
                </Hero>
              )}
              {gained > 0 && !hero && (
                <Line on={lands()} who="courier" style={work !== "" || s.sales.count > 0 || scoreRow || postsRow ? st.row : undefined}
                  testID="away-views">
                  <View ref={viewsAt} collapsable={false}><Views gained={gained} skip={skip} /></View>
                </Line>
              )}

              <PixelButton label={ready > 0 ? `Collect and review ${ready}` : "Collect"} size={24} onPress={press}
                testID="away-collect" style={st.collect} />
              <Text style={st.next}>Views refresh about every hour.</Text>
            </View>
          </Block>
        </Animated.View>
      </Pressable>
      {legs?.map(leg => Array.from({ length: leg.n }, (_, i) => {
        // The loot spills in a ring around the line it came from, then leaves one icon at a time.
        const a = (i / leg.n) * Math.PI * 2;
        const from = { x: leg.from.x + Math.cos(a) * 28, y: leg.from.y + Math.sin(a) * 16 };
        return <Loot key={`${leg.key}${i}`} icon={leg.icon} from={from} to={leg.to} delay={LAUNCH_MS + i * GAP_MS} />;
      }))}
    </Modal>
  );
}

// One icon of loot: it waits where it spilled, then arcs up and into its counter, shrinking to the counter icon's size.
function Loot({ icon, from, to, delay }: { icon: IconName; from: Point; to: Point; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: FLY_MS, easing: Easing.in(Easing.quad) }));
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: p.value >= 1 ? 0 : 1,
    transform: [
      { translateX: from.x + (to.x - from.x) * p.value - LOOT / 2 },
      { translateY: from.y + (to.y - from.y) * p.value - 70 * Math.sin(Math.PI * p.value) - LOOT / 2 },
      { scale: 1 - 0.35 * p.value },
    ],
  }));
  return <Animated.Image source={ICON[icon]} style={[st.loot, style]} pointerEvents="none" />;
}
const LOOT = 30;

// A line of the card, with the agent who did it. Before it lands it is an invisible copy that holds its space, so
// nothing below it moves.
function Line({ on, who, style, testID, children }: { on: boolean; who: Who; style?: object; testID: string; children: ReactNode }) {
  const inner = <><Portrait who={who} /><View style={st.lineBody}>{children}</View></>;
  return on
    ? <Animated.View entering={FadeInDown.duration(220)} style={[st.line, style]} testID={testID}>{inner}</Animated.View>
    : <View style={[st.line, style, { opacity: 0 }]}>{inner}</View>;
}

// A line without an agent, holding its space until it lands like a Line does.
function Reveal({ on, testID, children }: { on: boolean; testID: string; children: ReactNode }) {
  return on
    ? <Animated.View entering={FadeInDown.duration(220)} testID={testID}>{children}</Animated.View>
    : <View style={{ opacity: 0 }}>{children}</View>;
}

// The views line on its own: an eye over the count, centered, holding its space until it lands like a Line does.
function Hero({ on, children }: { on: boolean; children: ReactNode }) {
  const inner = <><Image source={ICON.eye} style={st.heroEye} />{children}</>;
  return on
    ? <Animated.View entering={FadeInDown.duration(220)} style={st.hero} testID="away-views">{inner}</Animated.View>
    : <View style={[st.hero, { opacity: 0 }]}>{inner}</View>;
}

// The count starts when its line lands, since that is when it mounts for real. It sits over its label and steps down a
// size as the number gets longer, so a big total still fits a 375 pt phone. The size comes from the final total, so it
// holds still while the count runs.
function Views({ gained, skip, hero }: { gained: number; skip: boolean; hero?: boolean }) {
  const views = useCountUp(0, gained, skip);
  const len = `+${gained.toLocaleString()}`.length;
  const size = hero && len <= 8 ? 56 : len <= 11 ? 44 : 34; // 56 holds +999,999 and 44 holds +99,999,999
  return (
    <View style={hero && st.heroBody}>
      <Outlined size={size} width={size > 40 ? 3 : 2} color={GOLD}>{`+${views.toLocaleString()}`}</Outlined>
      <Text style={st.bigLabel}>{hero ? "views on your live posts" : "views"}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(20,10,30,0.72)" },
  backdrop: { flex: 1, justifyContent: "center", padding: 22 },
  loot: { position: "absolute", left: 0, top: 0, width: LOOT, height: LOOT },
  card: { padding: 0 },
  board: { backgroundColor: WOOD.base, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, overflow: "hidden" },
  grain: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: WOOD.grain },
  boardEdge: { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, borderTopWidth: 3, borderTopColor: INK, backgroundColor: WOOD.lip },
  since: { color: "#FFD65C", fontSize: 17, fontFamily: FONT.semi, marginTop: 4 },
  body: { padding: 18, paddingBottom: 22 },
  work: { color: PARCH.ink, fontSize: 21, fontFamily: FONT.bold },
  line: { flexDirection: "row", alignItems: "center", gap: 12 },
  lineBody: { flex: 1 },
  row: { marginTop: 14, paddingTop: 12, borderTopWidth: 2, borderTopColor: PARCH.bottom },
  rowLabel: { color: PARCH.soft, fontSize: 18, fontFamily: FONT.semi },
  rowValue: { color: "#2F8A2C", fontSize: 24, fontFamily: FONT.bold },
  bigLabel: { color: PARCH.ink, fontSize: 20, fontFamily: FONT.bold, marginTop: -2 },
  hero: { alignItems: "center", paddingTop: 4 },
  heroEye: { width: 40, height: 40, marginBottom: 2 },
  heroBody: { alignItems: "center" },
  collect: { marginTop: 20 },
  next: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.regular, textAlign: "center", marginTop: 10 },
  scoreLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  star: { width: 44, height: 44 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  scoreValue: { color: PARCH.ink, fontSize: 30, fontFamily: FONT.bold },
  delta: { fontSize: 24, fontFamily: FONT.bold },
  postsBody: { gap: 2 },
  postLine: { color: PARCH.ink, fontSize: 16, fontFamily: FONT.semi },
  postKey: { color: PARCH.soft, fontFamily: FONT.bold },
});
