import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Easing, type SharedValue, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring,
  withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { Block, FONT, INK, Outlined, PARCH, POP } from "./pixel";
import type { Who } from "./Agents";
import { Portrait } from "./Portrait";
import { Flame, Milestones, MILESTONES } from "./You";
import { ICON } from "./Hud";

// What a swipe pays back, the way a game answers every tap: a sound, a number that flies up, a line saying what the
// studio does next, and a banner the first time a day's streak is kept. Every number shown is a real count.
type Shot = { id: number } & (
  | { kind: "pop"; text: string }
  | { kind: "toast"; text: string; sub?: string; who?: Who }
  | { kind: "streak"; days: number });
type New = Shot extends infer S ? (S extends Shot ? Omit<S, "id"> : never) : never;

export function usePayoff() {
  const [shots, setShots] = useState<Shot[]>([]);
  const next = useRef(0);
  const postSound = useAudioPlayer(require("../assets/sounds/post.wav"));
  const remakeSound = useAudioPlayer(require("../assets/sounds/remake.wav"));
  const starSound = useAudioPlayer(require("../assets/sounds/star.wav"));
  const play = (p: typeof postSound) => { p.seekTo(0).catch(() => {}); p.play(); };
  const add = (s: New) => {
    const id = ++next.current;
    // A new toast replaces the one showing, so two quick swipes don't stack lines.
    setShots(list => [...list.filter(x => s.kind !== "toast" || x.kind !== "toast"), { ...s, id } as Shot]);
  };
  const drop = (id: number) => setShots(list => list.filter(x => x.id !== id));

  return {
    // With a bounty, the toast says where the post is going, and the studio's forecast rides under it, labeled as one.
    post: (bounty?: { brand: string; forecast?: number | null }) => {
      play(postSound);
      add({ kind: "pop", text: "+1 APPROVED" });
      if (bounty) add({ kind: "toast", text: `Posting + submitting to ${bounty.brand}`, who: "courier",
        sub: typeof bounty.forecast === "number" ? `Forecast ${bounty.forecast}/100 · a guess, not a result` : undefined });
    },
    remake: (reason: string) => { play(remakeSound); add({ kind: "toast", text: `Remaking it · ${reason}`, sub: "It comes back in a few cards", who: "director" }); },
    skip: () => add({ kind: "toast", text: "Skipped" }),
    // True while the streak banner shows, for anything that should step aside for it.
    banner: shots.some(s => s.kind === "streak"),
    streak: (days: number) => {
      play(starSound);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      add({ kind: "streak", days });
    },
    // Pops and the streak banner go over the card.
    layer: (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {shots.map(s => s.kind === "pop" ? <Pop key={s.id} text={s.text} onDone={() => drop(s.id)} />
          : s.kind === "streak" ? <Streak key={s.id} days={s.days} onDone={() => drop(s.id)} onReach={() => {
            play(starSound);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          }} /> : null)}
      </View>
    ) as ReactNode,
    // Toasts drop over the Feed's header strip, so they never cover the card.
    toasts: (
      <View style={s.toastSlot} pointerEvents="none">
        {shots.map(s => s.kind === "toast" ? <Toast key={s.id} text={s.text} sub={s.sub} who={s.who} onDone={() => drop(s.id)} /> : null)}
      </View>
    ) as ReactNode,
  };
}

function useTimeout(ms: number, fn: () => void) {
  useEffect(() => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }, []);
}

// The milestone's colors: gold, pale and orange, the banner's own. Its burst and falling bits use only these, so nothing
// green or grey flies over the gold.
const GOLDS = ["#FFC83A", "#FFF4C4", "#FF8A2B"];

// The burst behind "+1 APPROVED": square pixel bits thrown out from the middle of the card, falling a little as they go.
// Fixed angles and sizes, so every post bursts the same way.
const BITS = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + (i % 2 ? 0.15 : -0.1),
  dist: i % 3 === 0 ? 200 : i % 3 === 1 ? 155 : 115,
  size: i % 4 === 0 ? 18 : 12,
  color: ["#FFC83A", "#5BC94A", "#FFF4C4", "#FF8A2B"][i % 4],
}));

function Bit({ angle, dist, size, color }: (typeof BITS)[number]) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }); }, []);
  const style = useAnimatedStyle(() => ({
    transform: [
      // Whole points, so the bits stay crisp squares.
      { translateX: Math.round(Math.cos(angle) * dist * t.value) },
      { translateY: Math.round(Math.sin(angle) * dist * t.value + 70 * t.value * t.value) },
      // Shrinks away over its last third rather than fading, so it never turns muddy over the dark scrim.
      { scale: Math.round(size * Math.min(1, 3 * (1 - t.value))) / size },
    ],
  }));
  return <Animated.View style={[s.bit, { width: size, height: size, left: -size / 2, top: -size / 2, backgroundColor: color }, style]} />;
}

// "+1 APPROVED" punches in over the card with a burst of bits behind it, then floats up and fades.
function Pop({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useSharedValue(0);
  const scale = useSharedValue(0.5);
  useEffect(() => {
    scale.value = withSequence(withTiming(1.25, { duration: 140 }), withSpring(1, POP));
    t.value = withDelay(350, withTiming(1, { duration: 650, easing: Easing.in(Easing.quad) }));
  }, []);
  useTimeout(1050, onDone);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateY: -150 * t.value }, { scale: scale.value }],
  }));
  return (
    <View style={s.pop} testID="payoff-pop">
      <View style={s.burst}>{BITS.map((b, i) => <Bit key={i} {...b} />)}</View>
      <Animated.View style={style}>
        <Outlined size={36} width={3} color="#FFC83A">{text}</Outlined>
      </Animated.View>
    </View>
  );
}

// A line at the top of the deck saying what happens to the card you sent back.
function Toast({ text, sub, who, onDone }: { text: string; sub?: string; who?: Who; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withSequence(withTiming(1, { duration: 180 }), withDelay(2200, withTiming(0, { duration: 220 })));
  }, []);
  useTimeout(2700, onDone);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: -16 * (1 - t.value) }] }));
  return (
    <Animated.View style={[s.toastWrap, style]} testID="payoff-toast">
      <Block bevel="slate" depth={3} lift={3} style={[s.toast, who && s.toastRow]}>
        {who ? <Portrait who={who} /> : null}
        <View style={who ? s.toastLines : s.center0}>
          <Text style={s.toastText} numberOfLines={1}>{text}</Text>
          {sub ? <Text style={s.toastSub}>{sub}</Text> : null}
        </View>
      </Block>
    </Animated.View>
  );
}

// Milestone days only: the gold sunburst from `art/rays.py` turning slowly behind the banner for the whole hold, the
// way a game reveals a star.
const RAYS = require("../assets/ui/rays.png");

function Rays({ fade }: { fade: SharedValue<number> }) {
  const turn = useSharedValue(0);
  const grow = useSharedValue(0.3);
  useEffect(() => {
    turn.value = withTiming(120, { duration: 4000, easing: Easing.linear }); // 30 degrees a second
    grow.value = withSpring(1, POP);
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ rotate: `${turn.value}deg` }, { scale: grow.value }] }));
  return <Animated.Image source={RAYS} style={[s.rays, style]} />;
}

// Milestone days only: pixel bits falling the full height of the screen behind the banner, starting in a stagger so
// they keep coming for most of the hold. Fixed columns, sizes and delays, so every milestone falls the same way.
const FALL = Array.from({ length: 48 }, (_, i) => ({
  x: ((i * 37) % 100) / 100,
  size: i % 5 === 0 ? 16 : i % 2 ? 10 : 12,
  delay: ((i * 53) % 48) * 32,
  ms: 1400 + ((i * 29) % 7) * 130,
  sway: (i % 2 ? 1 : -1) * (8 + (i % 4) * 6),
  color: GOLDS[i % 3],
}));

function Fall({ x, size, delay, ms, sway, color, fade }: (typeof FALL)[number] & { fade: SharedValue<number> }) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withTiming(1, { duration: ms, easing: Easing.linear })); }, []);
  const style = useAnimatedStyle(() => ({
    opacity: (t.value === 0 ? 0 : 1) * fade.value,
    transform: [
      // Whole points, so the bits stay crisp squares.
      { translateX: Math.round(Math.sin(t.value * Math.PI * 2) * sway) },
      { translateY: Math.round(t.value * (height + 40)) },
      // Shrinks away over its last fifth rather than fading, like the burst's bits.
      { scale: Math.round(size * Math.min(1, 5 * (1 - t.value))) / size },
    ],
  }));
  return <Animated.View style={[s.bit, { width: size, height: size, left: Math.round(x * (width - size)), top: -size - 20, backgroundColor: color }, style]} />;
}

// The first approval of the day keeps the streak. It gets the biggest moment in the app, with the milestone path under
// it so the next goal is in view. A day that reaches a milestone (3, 7, 14, 30) is named for it, bursts, holds longer,
// turns rays behind the banner, rains bits, and pops the milestone it reached on the path with a chime (`onReach`).
function Streak({ days, onDone, onReach }: { days: number; onDone: () => void; onReach: () => void }) {
  const milestone = MILESTONES.includes(days);
  const hold = milestone ? 3600 : 2900;
  const scale = useSharedValue(0.3);
  const fade = useSharedValue(1);
  useEffect(() => {
    scale.value = withSequence(withTiming(1.15, { duration: 180 }), withSpring(1, POP));
    fade.value = withDelay(hold - 400, withTiming(0, { duration: 300 }));
  }, []);
  useTimeout(hold, onDone);
  const style = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: scale.value }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: 0.72 * fade.value }));
  return (
    <View style={s.center}>
      {/* Dims the card underneath, so the banner reads as the whole moment rather than a sticker over a video. */}
      <Animated.View style={[s.scrim, scrim]} />
      {milestone && <View style={s.rayBox}><Rays fade={fade} /></View>}
      {milestone && <View style={StyleSheet.absoluteFill}>{FALL.map((b, i) => <Fall key={i} {...b} fade={fade} />)}</View>}
      {/* Thrown farther than a post's burst, so the bits clear the banner's edges. */}
      {milestone && <View style={s.burstMid}>{BITS.map((b, i) => <Bit key={i} {...b} color={GOLDS[i % 3]} dist={b.dist * 1.7} />)}</View>}
      <Animated.View style={[s.streakWrap, style]} testID="payoff-streak">
        <Block bevel="gold" depth={5} lift={4} style={s.streak}>
          <Flame size={56} />
          <Outlined size={milestone ? 34 : 40} width={3}>{milestone ? `${days}-DAY STREAK` : `DAY ${days}`}</Outlined>
          <Text style={s.streakSub}>{`${milestone ? "Milestone reached." : "Streak kept."} Day ${days + 1} starts tomorrow.`}</Text>
          <Block depth={3} style={s.path}><Milestones streak={days} reached={milestone ? days : undefined} onReach={onReach} /></Block>
        </Block>
      </Animated.View>
    </View>
  );
}

// A new taste tier: the whole screen dims, the star bursts gold and the tier's name lands, with the milestone chime and a
// success haptic. A provisional score's tier says so. Tap or wait to close.
export function TierUp({ name, provisional, onDone }: { name: string; provisional: boolean; onDone: () => void }) {
  const star = useAudioPlayer(require("../assets/sounds/star.wav"));
  const scale = useSharedValue(0.3);
  useEffect(() => {
    star.seekTo(0).catch(() => {});
    star.play();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    scale.value = withSequence(withTiming(1.15, { duration: 180 }), withSpring(1, POP));
  }, []);
  useTimeout(3600, onDone);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Modal transparent animationType="fade" visible>
      <Pressable style={s.tierScrim} onPress={onDone} testID="tier-up">
        <View style={s.burstMid}>{BITS.map((b, i) => <Bit key={i} {...b} color={GOLDS[i % 3]} dist={b.dist * 1.7} />)}</View>
        <Animated.View style={[s.streakWrap, style]}>
          <Block bevel="gold" depth={5} lift={4} style={s.streak}>
            <Image source={ICON.star} style={s.tierStar} />
            <Outlined size={30} width={3}>TIER UP</Outlined>
            <Outlined size={44} width={3} color="#FFF4C4">{name.toUpperCase()}</Outlined>
            <Text style={s.streakSub}>{provisional ? "Provisional: your score is still calibrating." : "Your taste score reached a new tier."}</Text>
          </Block>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  tierScrim: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(36,21,43,0.78)" },
  tierStar: { width: 64, height: 64 },
  pop: { position: "absolute", left: 0, right: 0, top: "38%", alignItems: "center" },
  burst: { position: "absolute", left: "50%", top: 22, width: 0, height: 0 },
  bit: { position: "absolute", borderWidth: 2, borderColor: INK },
  toastSlot: { position: "absolute", left: 12, right: 12, bottom: 0 },
  toastWrap: { alignSelf: "stretch" },
  toast: { paddingHorizontal: 14, paddingTop: 7, paddingBottom: 10, alignItems: "center" },
  // With a portrait the lines sit beside it, left-aligned.
  toastRow: { flexDirection: "row", gap: 10, paddingLeft: 8 },
  toastLines: { flexShrink: 1 },
  center0: { alignItems: "center" },
  toastText: { color: "#fff", fontSize: 19, fontFamily: FONT.bold },
  toastSub: { color: "#C9D4F2", fontSize: 15, fontFamily: FONT.semi, marginTop: 1 },
  center: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  // Past the Feed deck area's 26 pt top and 18 pt bottom margins, so the dimming runs from the header to the tab bar with
  // no bright strip of water at either edge.
  scrim: { position: "absolute", left: 0, right: 0, top: -26, bottom: -18, backgroundColor: INK },
  burstMid: { position: "absolute", left: "50%", top: "50%", width: 0, height: 0 },
  streakWrap: { width: "88%" },
  streak: { alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  // Room above the nodes for the reached one's flame at the top of its pop, which the path's border would cut off.
  path: { alignSelf: "stretch", marginTop: 12, paddingHorizontal: 12, paddingTop: 20, paddingBottom: 10 },
  // The scrim's bounds, clipped, so the rays run off every edge without painting over the header or the tab bar.
  rayBox: { position: "absolute", left: 0, right: 0, top: -26, bottom: -18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  // Wide enough that a ray reaches the deck area's corners at any angle.
  rays: { position: "absolute", width: 780, height: 780 },
  streakSub: { color: PARCH.ink, fontSize: 17, fontFamily: FONT.semi, marginTop: 4 },
});
