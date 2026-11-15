import { useEffect, useState } from "react";
import { Dimensions, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useClock } from "./Feed";
import { Counter, ICON, useTicker, type IconName } from "./Hud";
import { Badge, Button, Card, HonestyLabel, NumberTicker, TierProgress, TIERS, tierFor, VerdictBadge, money, type Tone } from "./ui";
import type { FunctionReturnType } from "convex/server";
import { Block, DEEP, FONT, INK, Outlined, PARCH, PixelButton, Plaque, POP, Sea, UNDER_PLAQUE, WoodHeader } from "./pixel";

const { width: W } = Dimensions.get("window");
const GAP = 6;
const CELL = Math.floor((W - 24 - 28 - 6 - GAP * 6) / 7); // card margins, padding and outline, then the gaps
const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const GOLD = "#FFC83A";
export const MILESTONES = [3, 7, 14, 30];
const ICE = "#9CC4FF";
export const PLAT = {
  youtube: { name: "YouTube", mark: require("../assets/ui/yt.png") },
  instagram: { name: "Instagram", mark: require("../assets/ui/ig.png") },
} as const;

// "2026-11-14" to "November". Noon, so no time zone can move it to the day before.
const monthName = (day: string) => new Date(`${day}T12:00:00`).toLocaleString("en-US", { month: "long" });
// The grid's weeks can start in the month before: "October – November".
const monthSpan = (from: string, to: string) => monthName(from) === monthName(to) ? monthName(to) : `${monthName(from)} – ${monthName(to)}`;

// 1234 -> "1.2k", 25000 -> "25k".
export function compact(n: number) {
  if (n < 1000) return String(n);
  const [d, unit] = n < 1e6 ? [1e3, "k"] : [1e6, "M"];
  return `${(n / d).toFixed(n / d < 10 ? 1 : 0).replace(/\.0$/, "")}${unit}`;
}

// The phone's local date as YYYY-MM-DD.
export function localDay(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function You({ device }: { device: string }) {
  const phoneDay = localDay(useClock(60_000));
  const data = useQuery(api.you.summary, { deviceId: device, phoneDay });
  const earnings = useQuery(api.earnings.summary, { deviceId: device });
  const [month, setMonth] = useState(false);
  const [allPosts, setAllPosts] = useState(false);
  if (!data) return <View style={s.fill} />;
  const { streak, todayDone, freezesLeft, calendar, totals } = data;
  const line = todayDone ? "Today counts. Come back tomorrow."
    : streak > 0 ? "Approve one video today to keep it going."
    : "Approve a video to start a streak.";
  // The calendar ends with the week that holds today, Sunday first.
  const week = calendar.slice(-7);
  const earlier = calendar.slice(0, -7);
  // The month grid starts at the week of the first kept or frozen day, so a new account doesn't see weeks of empty
  // tiles that read as missed days. With none before this week there is no grid, and no link to it.
  const firstMarked = earlier.findIndex(c => c.approved > 0 || c.frozen);
  const past = firstMarked < 0 ? [] : earlier.slice(firstMarked - (firstMarked % 7));
  const posts = data.posts;
  // A platform with posts but not one count yet says so once above the list, and its chips just say "soon".
  const waiting = data.waiting;
  const dryRun = data.mode === "dryRun";
  // Each live video's verdict against the user's baseline, from the same rows as the list.
  const verdicts = new Map((earnings?.posts ?? []).map(p => [p.videoId as string, p]));

  return (
    <View style={s.fill}>
      <Sea />
      {/* Views stay in view here as on the Base and the Feed. The streak card right below is the streak, so it isn't
          repeated in the header. */}
      <WoodHeader title="YOU" sub={line} below={
        <View style={s.hud}>
          <Counter icon="eye" value={compact(totals.views)} testID="you-hud-views" label={`${totals.views} views`} />
          <PendingCounter device={device} testID="you-hud-pending" />
          <ScoreCounter device={device} testID="you-hud-score" />
        </View>
      } />
      <ScrollView style={s.flex} contentContainerStyle={{ paddingBottom: 28 }} testID="you">
        <Taste e={earnings} />
        <Earnings e={earnings} device={device} />

        <Block style={s.card} lift={4} testID="you-streak">
          <View style={s.heroRow}>
            <Flame />
            <View>
              <Outlined size={64} width={3} color={GOLD}>{String(streak)}</Outlined>
              <Text style={s.heroLabel}>DAY STREAK</Text>
            </View>
            <View style={[s.todayChip, todayDone ? s.chipDone : s.chipTodo]} testID="you-today">
              {todayDone && <Image source={ICON.check} style={s.chipIcon} />}
              <Text style={s.chipText}>{todayDone ? "Done today" : "Approve 1 today"}</Text>
            </View>
          </View>

          <View style={s.strip} testID="you-week">
            {week.map((c, i) => (
              <Day key={c.day} letter={WEEK[i]} date={Number(c.day.slice(8))} lit={c.approved > 0} frozen={c.frozen}
                future={c.future} today={c.day === data.today} pulse={c.day === data.today && !todayDone} />
            ))}
          </View>

          <Milestones streak={streak} />

          <View style={s.freezeRow} testID="you-freezes">
            {Array.from({ length: freezesLeft }, (_, i) => <Image key={i} source={ICON.ice} style={s.ice} />)}
            <Text style={s.freeze}>
              {freezesLeft > 0 ? `${freezesLeft} freeze${freezesLeft === 1 ? "" : "s"} left. One covers a day you miss.`
                : "No freezes left. Miss a day and the streak resets."}
            </Text>
          </View>

          {past.length > 0 && (
            <Pressable onPress={() => setMonth(m => !m)} hitSlop={8} testID="you-month-toggle" accessibilityRole="button">
              <Text style={s.monthLink}>{month ? "Hide month" : "See month"}</Text>
            </Pressable>
          )}
          {month && past.length > 0 && (
            <View testID="you-calendar">
              {/* This week is the strip above, so the grid holds the weeks before it. */}
              <Text style={s.monthTitle}>{monthSpan(past[0].day, past[past.length - 1].day)}</Text>
              <View style={s.week}>{WEEK.map((d, i) => <Text key={i} style={[s.cell, s.weekday]}>{d}</Text>)}</View>
              <View style={s.grid}>
                {past.map(c => {
                  const first = c.day.endsWith("-01");
                  // Kept days wear the strip's flame tile and frozen days its ice, so both views mark a day the same way.
                  const mark = c.approved > 0 ? ICON.flame : c.frozen ? ICON.ice : null;
                  return (
                    <View key={c.day} testID={c.approved > 0 ? "you-day-lit" : undefined}
                      style={[s.cell, s.box, c.approved > 0 && s.lit, c.frozen && s.frozen,
                        c.day.slice(0, 7) !== data.today.slice(0, 7) && s.otherMonth]}>
                      {/* The 1st carries its month's short name, so the grid shows where one month ends and the next begins. */}
                      {first && <Text style={s.monthTag}>{monthName(c.day).slice(0, 3).toUpperCase()}</Text>}
                      {mark ? <Image source={mark} style={first ? s.gridMarkSmall : s.dayFlame} />
                        : <Text style={s.date}>{Number(c.day.slice(8))}</Text>}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </Block>

        {/* What it all added up to, right under the streak, so the totals are on the first screen. A dry run never posts,
            so live posts and views would sit at zero. It shows what did happen instead. */}
        {dryRun ? (
          <>
            <View style={s.tiles} testID="you-totals">
              <Tile icon="check" label="Approved" value={String(totals.approved)} />
              <Tile icon="play" label="Made" value={String(totals.made)} />
            </View>
            <Text style={s.footnote}>{`${totals.remakes} sent back · ${totals.skipped} skipped`}</Text>
          </>
        ) : (
          <>
            <View style={s.tiles} testID="you-totals">
              <Tile icon="check" label="Approved" value={String(totals.approved)} />
              {/* Videos, not posts, so it matches the Live now list below. The posts and the approvals that never went
                  out are counted in the line under the tiles. */}
              <Tile icon="play" label="Videos live" value={String(totals.videos)} />
              <Tile icon="eye" label="Views" value={compact(totals.views)} />
            </View>
            <Text style={s.footLead}>
              {totals.videos === totals.live ? `${totals.live} post${totals.live === 1 ? "" : "s"} live`
                : `${totals.videos} video${totals.videos === 1 ? "" : "s"} live as ${totals.live} post${totals.live === 1 ? "" : "s"}`}
            </Text>
            <Text style={s.footnote}>
              {`${totals.made} made · ${totals.remakes} sent back · ${totals.skipped} skipped\n`
                + (totals.dryRun ? `${totals.dryRun} approved in a dry run · ` : "") + "views update about hourly"}
            </Text>
          </>
        )}

        {/* No count here: the rows are videos and the totals above count posts, so a count here would disagree with one. */}
        <Plaque title="Live now" style={s.plaque} />
        <Block style={[s.card, UNDER_PLAQUE]} lift={4} testID="you-posts">
          {posts.length > 0 ? <>
            {waiting.length > 0 && (
              <Text style={s.waiting} testID="you-posts-waiting">
                {`${waiting.map(pl => PLAT[pl].name).join(" and ")} views: Zernio hasn't sent counts yet.`}
              </Text>
            )}
            {/* The top three, most viewed first, with the rest one tap away. */}
            {(allPosts ? posts : posts.slice(0, 3)).map((v, i) => (
            <View key={v.id} style={[s.post, i === 0 && s.firstPost]} testID="you-post">
              <View style={s.postHead}>
                {i === 0 && v.views > 0 && <View style={s.topTag} testID="you-post-top"><Text style={s.topText}>TOP</Text></View>}
                <Text style={s.postTitle} numberOfLines={1}>{v.title}</Text>
                <Verdict post={verdicts.get(v.id)} />
              </View>
              <View style={s.plats}>
                {v.platforms.map(p => (
                  <Pressable key={p.id} style={({ pressed }) => [s.plat, pressed && { opacity: 0.7 }]} disabled={!p.url}
                    onPress={() => p.url && Linking.openURL(p.url)} testID={`you-post-${p.platform}`}
                    accessibilityRole={p.url ? "link" : undefined}
                    accessibilityLabel={`${PLAT[p.platform].name}: ${p.counted ? `${p.views} views` : "not counted yet"}`}>
                    <Image source={PLAT[p.platform].mark} style={s.platMark} />
                    <Text style={s.platName}>{PLAT[p.platform].name}</Text>
                    {p.counted ? (
                      <>
                        <Image source={ICON.eye} style={s.postEye} />
                        <Text style={[s.postViews, p.views === 0 && s.zero]}>{compact(p.views)}</Text>
                      </>
                    ) : <Text style={s.pending}>{waiting.includes(p.platform) ? "soon" : "counting"}</Text>}
                  </Pressable>
                ))}
              </View>
            </View>
            ))}
            {posts.length > 3 && (
              <Pressable onPress={() => setAllPosts(a => !a)} hitSlop={8} testID="you-posts-toggle" accessibilityRole="button">
                <Text style={s.monthLink}>{allPosts ? "Show top 3" : `Show all ${posts.length} videos`}</Text>
              </Pressable>
            )}
          </> : (
            <View style={s.empty}>
              <Text style={s.emptyText}>
                {dryRun ? "Posting is a dry run, so approved videos don't go live." : "Nothing live yet. Approve a video and it posts at the next slot."}
              </Text>
              {!dryRun && <PixelButton label="Open the Feed" size={20} bevel="green" onPress={() => router.navigate("/feed")} testID="you-open-feed" />}
            </View>
          )}
        </Block>

      </ScrollView>
    </View>
  );
}

type Earn = FunctionReturnType<typeof api.earnings.summary>;
type Post = Earn["posts"][number];

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
export const ESTIMATE = "Estimated, not guaranteed, pending Whop review.";

// The taste score and estimated pending earnings as header counters, for any screen's resource bar. Both count to a new
// value and bump. The pending figure is an estimate, so it always wears "est"; a provisional score wears "prov" instead
// of its tier. They live here rather than in Hud.tsx because src/ui imports Hud.
export function ScoreCounter({ device, onPress, testID = "hud-score" }: { device: string; onPress?: () => void; testID?: string }) {
  const t = useQuery(api.earnings.summary, { deviceId: device })?.taste;
  const n = useTicker(t?.score ?? undefined);
  const tier = t?.score === null || t?.score === undefined ? null : tierFor(t.score);
  return <Counter icon="star" value={!t ? "…" : n === undefined ? "–" : String(n)} testID={testID} onPress={onPress}
    tag={!tier ? undefined : t?.state === "calibrating" ? "prov" : tier.name}
    label={!t ? "Taste score loading" : !tier ? "No taste score yet"
      : `Taste score ${t.score}, ${tier.name}${t.state === "calibrating" ? ", provisional" : ""}`} />;
}

export function PendingCounter({ device, onPress, testID = "hud-pending" }: { device: string; onPress?: () => void; testID?: string }) {
  const e = useQuery(api.earnings.summary, { deviceId: device });
  const n = useTicker(e?.pendingCents);
  return <Counter icon="coin" value={n === undefined ? "…" : money(n)} tag="est" testID={testID} onPress={onPress}
    label={e ? `${money(e.pendingCents)} estimated pending. ${ESTIMATE}` : "Pending earnings loading"} />;
}

// Under two days old a post's views are still climbing, so its verdict is "so far".
export const FRESH_MS = 2 * 86_400_000;

// Hit, Solid or Miss against the user's baseline.
export function Verdict({ post }: { post: Pick<Post, "verdict" | "ratio" | "liveAt"> | undefined | null }) {
  if (!post?.verdict || post.ratio === null) return null;
  return <VerdictBadge verdict={post.verdict} ratio={post.ratio} size="sm" reason={Date.now() - post.liveAt < FRESH_MS ? "so far" : undefined} />;
}

// The taste score, its tier and the way to the next one, then the three percentages it comes from. Until five posts
// are scored against the baseline the score is provisional and says so, with the count.
function Taste({ e }: { e: Earn | undefined }) {
  const t = e?.taste;
  if (!t || !e) return <Card loading testID="you-taste" style={s.cardGap} />;
  const pick = t.pickiness;
  const extreme = pick !== null && t.seenClips >= 5 && (pick >= 0.9 || pick <= 0.1);
  const pickNote = pick === null ? "Swipe a few clips to see it."
    : extreme && pick >= 0.9 ? "You approve almost everything. Skip the weak ones; that's what scores you."
    : extreme ? "You're turning almost everything down. Approve the ones you'd watch."
    : pick >= 0.2 && pick <= 0.5 ? "Healthy: 20-50% is the sweet spot."
    : pick > 0.5 ? "A bit generous. 20-50% is the sweet spot." : "Very picky. 20-50% is the sweet spot.";
  return (
    <Card style={s.cardGap} testID="you-taste">
      <Text style={s.tasteLabel}>TASTE SCORE</Text>
      {t.score === null ? (
        <Text style={s.tasteNote} testID="you-taste-empty">
          No score yet. Swipe 3 clips for a provisional score from your pickiness; it turns real as your posts get views.
        </Text>
      ) : (
        <TierProgress score={t.score} testID="you-tier"
          calibrating={t.state === "calibrating" ? { scored: t.scored, needed: t.needed } : undefined} />
      )}
      {e.tasteTrend !== 0 && (
        <Text style={[s.trend, { color: e.tasteTrend > 0 ? "#2F8A2C" : "#8A3A32" }]} testID="you-trend">
          {`${e.tasteTrend > 0 ? "▲ +" : "▼ "}${e.tasteTrend} since you last collected`}
        </Text>
      )}
      {t.state === "calibrating" && (
        <Text style={s.tasteNote}>
          {t.scored === 0 ? "From your pickiness for now. Each post with views, compared with your earlier posts, makes it real."
            : "Your pickiness, blended with the posts scored so far."}
        </Text>
      )}
      <View style={s.stats}>
        <Stat label="Hit rate" value={pct(t.hitRate)} testID="you-hit-rate"
          sub={t.scored ? `${t.hits} of ${t.scored} beat your baseline 1.5x` : "No posts scored yet"} />
        <Stat label="Approval" value={pct(t.approvalRate)} testID="you-approval-rate"
          sub={t.settledSubmissions ? `Whop approved ${t.approvedSubmissions} of ${t.settledSubmissions}` : "Waiting on Whop"} />
        <Stat label="Pickiness" value={pct(pick)} testID="you-pickiness"
          sub={pick === null ? "No swipes yet" : `Approved ${t.approvedClips} of ${t.seenClips} clips`} />
      </View>
      <Text style={[s.tasteNote, extreme && s.warn]} testID="you-pickiness-note">{pickNote}</Text>
      <Text style={s.fine}>
        {`Score = approval rate × views vs your baseline (the median of your earlier posts${t.baselineFrom === "account" ? ", set for this account" : ""}). Hit is 1.5x or more, Miss under 0.8x. Tiers: ${TIERS.map(x => x.name).join(", ")}.`}
      </Text>
    </Card>
  );
}

function Stat({ label, value, sub, testID }: { label: string; value: string; sub: string; testID: string }) {
  return (
    <View style={s.stat} testID={testID}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statSub}>{sub}</Text>
    </View>
  );
}

const STATUS: Record<string, { text: string; tone: Tone }> = {
  manual: { text: "NOT ON WHOP YET", tone: "orange" },
  pending: { text: "SUBMITTING", tone: "gold" },
  submitted: { text: "SUBMITTED", tone: "slate" },
  approved: { text: "APPROVED", tone: "green" },
  denied: { text: "DENIED", tone: "red" },
  failed: { text: "FAILED", tone: "red" },
};

// Estimated pending and approved money from bounty posts, each with its views, estimate and Whop status.
function Earnings({ e, device }: { e: Earn | undefined; device: string }) {
  const rows = e?.perVideo ?? [];
  return (
    <Card title="Earnings" style={s.cardGap} loading={!e} testID="you-earnings">
      <View style={s.moneyRow}>
        <View>
          <NumberTicker value={e?.pendingCents} format={money} size={40} outlined={false} color="#2F8A2C" testID="you-pending" />
          <Text style={s.moneyLabel}>pending</Text>
        </View>
        <View style={s.moneyRight}>
          <NumberTicker value={e?.approvedCents} format={money} size={26} outlined={false} delta={false} testID="you-approved" />
          <Text style={s.moneyLabel}>approved</Text>
        </View>
      </View>
      <View style={s.honesty}><HonestyLabel kind="estimated" detail testID="you-earnings-label" /></View>
      {!!e?.unsubmittedCents && (
        <Text style={s.tasteNote} testID="you-earnings-unsubmitted">{`+${money(e.unsubmittedCents)} more (est.) once you submit your posts on Whop.`}</Text>
      )}
      {rows.length === 0 ? (
        <Text style={s.emptyText}>No bounty posts live yet. Take a bounty, approve a clip, and its views earn here.</Text>
      ) : rows.map(r => <EarnRow key={r.videoId} r={r} device={device} />)}
    </Card>
  );
}

// One bounty video: brand, verdict, estimate, views and where its submission stands. A manual submission carries the
// "Submit on Whop" flow: the post URL to paste there, the campaign page, then "I submitted it". A video posted to both
// platforms has a row per post, so the flow repeats until none is left. A submission the user reported themselves is a
// label, not a Whop-confirmed status.
function EarnRow({ r, device }: { r: Earn["perVideo"][number]; device: string }) {
  const sub = useQuery(api.submit.forVideo, { deviceId: device, videoId: r.videoId });
  const mark = useMutation(api.submit.markSubmitted);
  const [busy, setBusy] = useState(false);
  const status = sub?.status ?? r.status;
  const st = status ? STATUS[status] : null;
  return (
    <View style={s.earnRow} testID="you-earning">
      <View style={s.earnHead}>
        <Text style={s.brand} numberOfLines={1}>{r.brand || "Bounty"}</Text>
        <Verdict post={r} />
        <Text style={s.earnCents}>{money(r.estCents)}</Text>
      </View>
      <Pressable style={({ pressed }) => [s.earnHead, pressed && { opacity: 0.7 }]} disabled={!r.url}
        onPress={() => r.url && Linking.openURL(r.url)} accessibilityRole={r.url ? "link" : undefined}>
        <Text style={s.earnTitle} numberOfLines={1}>{r.title}</Text>
        <Image source={ICON.eye} style={s.postEye} />
        <Text style={s.earnViews}>{compact(r.views)}</Text>
        {status === "submitted" && sub?.selfReported ? <Text style={s.selfReported} testID="you-earning-self">Submitted by you</Text>
          : <Badge label={st?.text ?? "NOT SUBMITTED"} tone={st?.tone ?? "parch"} size="sm" />}
      </Pressable>
      {status === "denied" && sub?.denialReason ? <Text style={s.denied}>{`Denied: ${sub.denialReason}`}</Text> : null}
      {sub?.status === "manual" && (
        <View style={s.submitBox} testID="you-submit">
          <Text style={s.submitLead}>{`Paste this post's link on ${sub.brand}'s campaign:`}</Text>
          <View style={s.urlRow}>
            <Text style={s.url} numberOfLines={1} selectable testID="you-submit-url">{sub.postUrl}</Text>
            <Pressable onPress={() => Share.share({ url: sub.postUrl, message: sub.postUrl }).catch(() => {})} hitSlop={6}
              accessibilityRole="button" accessibilityLabel="Copy or share the post link" testID="you-submit-copy">
              <Text style={s.copy}>Copy link</Text>
            </Pressable>
          </View>
          <View style={s.submitButtons}>
            <Button label="Submit on Whop" size="sm" bevel="green" style={s.flex}
              onPress={() => WebBrowser.openBrowserAsync(sub.deepLink).catch(() => {})} testID="you-submit-whop" />
            <Button label="I submitted it" size="sm" variant="secondary" style={s.flex} loading={busy} loadingLabel="Saving"
              onPress={() => { setBusy(true); mark({ deviceId: device, videoId: r.videoId }).finally(() => setBusy(false)); }}
              testID="you-submit-done" />
          </View>
        </View>
      )}
    </View>
  );
}

// Two frames swapped a few times a second, so the flame flickers like a sprite.
export function Flame({ size }: { size?: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => 1 - f), 260);
    return () => clearInterval(t);
  }, []);
  return <Image source={frame ? ICON.flame2 : ICON.flame} style={[s.flame, size ? { width: size, height: size } : null]} />;
}

// One day of this week. Today pulses until a video is approved.
function Day({ letter, date, lit, frozen, future, today, pulse }:
  { letter: string; date: number; lit: boolean; frozen: boolean; future: boolean; today: boolean; pulse: boolean }) {
  const glow = useSharedValue(1);
  useEffect(() => {
    glow.value = pulse ? withRepeat(withSequence(withTiming(1.12, { duration: 520 }), withTiming(1, { duration: 520 })), -1) : withTiming(1);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }] }));
  return (
    <View style={s.day}>
      <Text style={[s.dayLetter, today && s.dayLetterToday]}>{letter}</Text>
      <Animated.View style={[s.dayBox, lit && s.lit, frozen && s.frozen, future && s.future, today && s.today, style]}
        testID={lit ? "you-day-lit" : undefined}>
        {lit ? <Image source={ICON.flame} style={s.dayFlame} />
          : frozen ? <Image source={ICON.ice} style={s.dayFlame} />
          : <Text style={s.date}>{date}</Text>}
      </Animated.View>
    </View>
  );
}

// The streak's checkpoints as a path: each bar fills toward its milestone from the one before, and a reached
// milestone turns gold with a flame on it. The next one is outlined, with how many days are left. The streak banner
// in the Feed shows it too.
// `reached` is a milestone hit just now: its node pops once the banner it sits in has landed, and `onReach` fires with
// the pop for the sound.
export function Milestones({ streak, reached, onReach }: { streak: number; reached?: number; onReach?: () => void }) {
  const next = MILESTONES.find(m => m > streak);
  const left = next ? next - streak : 0;
  const pop = useSharedValue(1);
  useEffect(() => {
    if (!reached) return;
    pop.value = withDelay(450, withSequence(withTiming(1.4, { duration: 180 }), withSpring(1, POP)));
    const t = setTimeout(() => onReach?.(), 450);
    return () => clearTimeout(t);
  }, [reached]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View style={s.miles} testID="you-milestones">
      <View style={s.mileRow}>
        {MILESTONES.map((m, i) => {
          const from = i === 0 ? 0 : MILESTONES[i - 1];
          const fill = Math.max(0, Math.min(1, (streak - from) / (m - from)));
          return (
            // The reached leg draws above the next one, so the next leg's track doesn't cover the node as it pops.
            <View key={m} style={[s.mileLeg, m === reached && { zIndex: 1 }]}>
              <View style={s.track}><View style={[s.trackFill, { width: `${fill * 100}%` }]} /></View>
              <Animated.View style={[s.mile, streak >= m && s.mileHit, m === next && s.mileNext, m === reached && popStyle]}>
                <Text style={s.mileNum}>{m}</Text>
                {streak >= m && <Image source={ICON.flame} style={s.mileFlame} />}
              </Animated.View>
            </View>
          );
        })}
      </View>
      <Text style={s.mileLine}>
        {next ? `${left} more day${left === 1 ? "" : "s"} to a ${next}-day streak` : "Every milestone reached. Keep it going."}
      </Text>
    </View>
  );
}

function Tile({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <Block style={s.tile} depth={3} lift={3}>
      <Image source={ICON[icon]} style={s.tileIcon} />
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </Block>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: DEEP },
  hud: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  cardGap: { marginHorizontal: 12, marginTop: 14 },
  tasteLabel: { color: PARCH.soft, fontSize: 16, fontFamily: FONT.bold, marginBottom: 6 },
  trend: { fontSize: 17, fontFamily: FONT.bold, marginTop: 8 },
  tasteNote: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.semi, marginTop: 8 },
  warn: { color: "#B04A10" },
  stats: { flexDirection: "row", gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: PARCH.top, borderWidth: 2, borderColor: PARCH.bottom, paddingHorizontal: 6, paddingVertical: 6, alignItems: "center" },
  statValue: { color: PARCH.ink, fontSize: 28, fontFamily: FONT.bold },
  statLabel: { color: PARCH.ink, fontSize: 15, fontFamily: FONT.bold, marginTop: -4 },
  statSub: { color: PARCH.soft, fontSize: 12, fontFamily: FONT.semi, textAlign: "center", marginTop: 2 },
  fine: { color: PARCH.soft, fontSize: 13, fontFamily: FONT.semi, marginTop: 10, lineHeight: 16 },
  moneyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  moneyRight: { alignItems: "flex-end" },
  moneyLabel: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.semi, marginTop: -4 },
  honesty: { marginTop: 8, marginBottom: 6 },
  earnRow: { paddingVertical: 8, gap: 4, borderTopWidth: 2, borderTopColor: PARCH.bottom },
  earnHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  brand: { color: PARCH.ink, fontSize: 18, fontFamily: FONT.bold, flexShrink: 1 },
  earnCents: { marginLeft: "auto", color: "#2F8A2C", fontSize: 18, fontFamily: FONT.bold },
  earnTitle: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.semi, flex: 1 },
  earnViews: { color: PARCH.ink, fontSize: 15, fontFamily: FONT.bold },
  selfReported: { color: PARCH.soft, fontSize: 14, fontFamily: FONT.semi, fontStyle: "italic" },
  denied: { color: "#8A3A32", fontSize: 15, fontFamily: FONT.semi },
  submitBox: { marginTop: 6, gap: 8, backgroundColor: PARCH.top, borderWidth: 2, borderColor: PARCH.bottom, padding: 8 },
  submitLead: { color: PARCH.ink, fontSize: 15, fontFamily: FONT.semi },
  urlRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  url: { flex: 1, color: PARCH.soft, fontSize: 14, fontFamily: FONT.semi },
  copy: { color: "#B04A10", fontSize: 16, fontFamily: FONT.bold },
  submitButtons: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  card: { marginHorizontal: 12, marginTop: 14, padding: 14, paddingBottom: 18 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  flame: { width: 72, height: 72 },
  heroLabel: { color: PARCH.ink, fontSize: 20, fontFamily: FONT.bold, marginTop: -12 },
  todayChip: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 2, borderColor: INK },
  chipDone: { backgroundColor: "#A6EC7C" },
  chipTodo: { backgroundColor: "#FFB070" },
  chipIcon: { width: 18, height: 18 },
  chipText: { color: PARCH.ink, fontSize: 16, fontFamily: FONT.bold },
  strip: { flexDirection: "row", gap: GAP, marginTop: 14 },
  day: { width: CELL, alignItems: "center" },
  dayLetter: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.bold, marginBottom: 4 },
  dayLetterToday: { color: "#F07A2A" },
  dayBox: { width: CELL, height: CELL, backgroundColor: PARCH.bottom, borderWidth: 2, borderColor: INK, alignItems: "center", justifyContent: "center" },
  dayFlame: { width: CELL - 14, height: CELL - 14 },
  freezeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  ice: { width: 26, height: 26 },
  freeze: { flex: 1, color: PARCH.soft, fontSize: 16, fontFamily: FONT.semi, marginLeft: 2 },
  monthLink: { color: "#B04A10", fontSize: 17, fontFamily: FONT.bold, marginTop: 12 },
  week: { flexDirection: "row", gap: GAP, marginTop: 10, marginBottom: 6 },
  weekday: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.bold, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  cell: { width: CELL },
  box: { height: CELL, backgroundColor: PARCH.bottom, borderWidth: 2, borderColor: INK, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  lit: { backgroundColor: GOLD },
  gridMarkSmall: { width: CELL - 24, height: CELL - 24 },
  frozen: { backgroundColor: ICE },
  future: { opacity: 0.35 },
  otherMonth: { opacity: 0.45 },
  monthTitle: { color: PARCH.ink, fontSize: 19, fontFamily: FONT.bold, marginTop: 10 },
  monthTag: { color: PARCH.ink, fontSize: 10, fontFamily: FONT.bold, marginBottom: -3 },
  today: { borderWidth: 3, borderColor: "#F07A2A" },
  date: { color: PARCH.ink, fontSize: 16, fontFamily: FONT.bold },
  plaque: { marginTop: 24 },
  post: { paddingVertical: 9, gap: 6, borderTopWidth: 2, borderTopColor: PARCH.bottom },
  firstPost: { borderTopWidth: 0, paddingTop: 0 },
  postHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  topTag: { backgroundColor: GOLD, borderWidth: 2, borderColor: INK, paddingHorizontal: 5 },
  topText: { color: INK, fontSize: 13, fontFamily: FONT.bold },
  postTitle: { color: PARCH.ink, fontSize: 17, fontFamily: FONT.semi, flex: 1 },
  plats: { flexDirection: "row", gap: 8 },
  plat: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: PARCH.top, borderWidth: 2, borderColor: PARCH.bottom, paddingHorizontal: 7, paddingVertical: 2 },
  platMark: { width: 18, height: 18 },
  platName: { color: PARCH.soft, fontSize: 14, fontFamily: FONT.semi, marginRight: 2 },
  postEye: { width: 16, height: 16 },
  postViews: { color: "#2F8A2C", fontSize: 16, fontFamily: FONT.bold },
  zero: { color: PARCH.soft },
  pending: { color: PARCH.soft, fontSize: 14, fontFamily: FONT.semi },
  waiting: { color: PARCH.soft, fontSize: 15, fontFamily: FONT.semi, marginBottom: 8 },
  empty: { gap: 12, paddingTop: 4 },
  emptyText: { color: PARCH.soft, fontSize: 17, fontFamily: FONT.semi },
  tiles: { flexDirection: "row", gap: 8, marginHorizontal: 12, marginTop: 14 },
  tile: { flex: 1, alignItems: "center", paddingTop: 10, paddingBottom: 14 },
  tileIcon: { width: 28, height: 28 },
  tileValue: { color: PARCH.ink, fontSize: 37, fontFamily: FONT.bold, marginTop: 2 },
  tileLabel: { color: PARCH.soft, fontSize: 16, fontFamily: FONT.semi },
  miles: { marginTop: 16 },
  mileRow: { flexDirection: "row", alignItems: "center" },
  mileLeg: { flex: 1, flexDirection: "row", alignItems: "center" },
  track: { flex: 1, height: 12, marginRight: -2, backgroundColor: PARCH.bottom, borderWidth: 2, borderColor: INK, overflow: "hidden" },
  trackFill: { height: "100%", backgroundColor: GOLD },
  mile: { width: 36, height: 36, alignItems: "center", justifyContent: "center", backgroundColor: PARCH.bottom, borderWidth: 2, borderColor: INK },
  mileHit: { backgroundColor: GOLD },
  mileNext: { borderWidth: 3, borderColor: "#F07A2A" },
  mileFlame: { position: "absolute", top: -20, width: 20, height: 20 },
  mileNum: { color: PARCH.ink, fontSize: 18, fontFamily: FONT.bold },
  mileLine: { color: PARCH.ink, fontSize: 17, fontFamily: FONT.semi, marginTop: 8 },
  // The small print under the tiles sits on the water with a hard ink shadow, quieter than the tiles above it.
  footLead: {
    alignSelf: "center", color: "#FFFFFF", fontSize: 18, fontFamily: FONT.bold, marginHorizontal: 12, marginTop: 12,
    textAlign: "center", textShadowColor: INK, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0,
  },
  footnote: {
    alignSelf: "center", color: "#F5E6C8", fontSize: 14, fontFamily: FONT.semi, marginHorizontal: 12, marginTop: 4,
    textAlign: "center", lineHeight: 18, textShadowColor: INK, textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 0,
  },
});
