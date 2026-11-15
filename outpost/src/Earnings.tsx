import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useClock } from "./Feed";
import { Outlined, Sea, WoodHeader } from "./pixel";
import { Badge, Button, Card, COLOR, DEEP, EmptyState, FONT, HonestyLabel, INK, PARCH, feel, money, mult, thousands } from "./ui";

type Summary = FunctionReturnType<typeof api.rewards.summary>;
type Row = Summary["videos"][number];
type Gate = Row["gate1"];

const x = mult;

// Projected earnings and the Outpost bonus. Each right swipe is a bet that the video clears two gates: the brand
// accepts it on Whop, and it performs. The bonus multiplies what the videos are projected to earn, and it moves with
// how often those bets come good, so approving everything costs you.
export function Earnings({ device }: { device: string }) {
  const now = useClock(60_000);
  const data = useQuery(api.rewards.summary, { deviceId: device, minute: Math.floor(now / 60_000) });
  const sub = !data ? "Adding it up…" : `${x(data.multiplier)} Outpost bonus`;
  return (
    <View style={s.fill}>
      <Sea />
      <WoodHeader title="EARNINGS" sub={sub} subID="earnings-sub" />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="earnings">
        {!data ? <View style={s.slot}><Card loading /></View>
          : data.videos.length === 0 ? (
            <>
              <Bonus data={data} />
              <View style={s.slot}>
                <EmptyState who="courier" title="No bets yet" testID="earnings-empty"
                  body="Swipe right on a bounty video to post it. Each one you approve shows its projected earnings here."
                  action={{ label: "Go to the Feed", onPress: () => router.navigate("/feed"), testID: "earnings-empty-feed" }} />
              </View>
            </>
          ) : (
            <>
              <Bonus data={data} />
              <Totals data={data} />
              <Text style={s.section}>YOUR VIDEOS</Text>
              {data.videos.map(r => <VideoCard key={r.videoId} r={r} device={device} multiplier={data.multiplier} demo={data.demoControls} />)}
              {data.history.length > 0 && <History data={data} />}
            </>
          )}
        <Text style={s.footnote}>
          Projections, not payouts. Whop pays the brand's rate. The bonus is Outpost's own and isn't paid out yet.
        </Text>
      </ScrollView>
    </View>
  );
}

function Bonus({ data }: { data: Summary }) {
  const resolved = data.passed + data.failed;
  const line = resolved === 0 ? "No results yet. Your first right calls start it climbing."
    : `${data.passed} of ${resolved} right so far`;
  return (
    <View style={s.slot}>
      <Card title="Outpost bonus" sub="Rewards the videos you pick" testID="earnings-bonus">
        <View style={s.hero}>
          <Outlined size={48} color={COLOR.gold}>{x(data.multiplier)}</Outlined>
          <Text style={s.heroOf}>of {x(data.max)}</Text>
        </View>
        <View style={s.meter} accessible accessibilityLabel={`Bonus ${x(data.multiplier)} of ${x(data.max)}`}>
          <View style={[s.meterFill, { width: `${((data.multiplier - 1) / (data.max - 1)) * 100}%` }]} />
        </View>
        <Text style={s.body} testID="earnings-accuracy">{line}</Text>
        <View style={s.stakes} testID="earnings-stakes">
          <Badge label={`Next right call ${x(data.ifPass)}`} tone="green" size="sm" />
          <Badge label={`Next wrong call ${x(data.ifFail)}`} tone="red" size="sm" />
        </View>
        <Text style={s.small}>
          A right call: the brand accepts the video and it clears the campaign's minimum views without missing. A video
          that gets denied or flops counts against you, so swipe right only on the ones you'd bet on.
        </Text>
      </Card>
    </View>
  );
}

function Totals({ data }: { data: Summary }) {
  return (
    <View style={s.slot}>
      <Card title="Projected" sub="All your bounty videos" testID="earnings-totals">
        <View style={s.split}>
          <View style={s.half}>
            <Text style={s.label}>FROM WHOP</Text>
            <Text style={s.money} testID="earnings-projected">{money(data.projectedCents)}</Text>
          </View>
          <View style={s.half}>
            <Text style={s.label}>WITH YOUR BONUS</Text>
            <Text style={[s.money, s.gold]} testID="earnings-boosted">{money(data.boostedCents)}</Text>
          </View>
        </View>
        <HonestyLabel kind="estimated" detail />
        <View style={s.scale} testID="earnings-scale">
          <Text style={s.label}>IF YOU SCALE UP</Text>
          {data.scale.map(p => (
            <Text key={p.perDay} style={s.body} testID={`earnings-scale-${p.perDay}`}>
              {p.perDay} videos a day: <Text style={s.bold}>{money(p.monthlyCents)}</Text> a month at {x(data.multiplier)}
            </Text>
          ))}
        </View>
      </Card>
    </View>
  );
}

function GateLine({ name, g, testID }: { name: string; g: Gate; testID: string }) {
  const tone = g.gate === "pass" ? "green" : g.gate === "fail" ? "red" : "parch";
  return (
    <View style={s.gate} testID={testID}>
      <Text style={s.gateName}>{name}</Text>
      <Badge label={g.label} tone={tone} size="sm" icon={g.gate === "pass" ? "check" : undefined} dashed={g.gate === "pending"} />
    </View>
  );
}

function VideoCard({ r, device, multiplier, demo }: { r: Row; device: string; multiplier: number; demo: boolean }) {
  const settle = useMutation(api.rewards.settleDemo);
  const [busy, setBusy] = useState(false);
  const good = Math.max(5000, (r.minViews ?? 0) * 3);
  const flop = Math.max(10, Math.floor((r.minViews ?? 400) / 4));
  const run = (accepted: boolean, views: number) => {
    setBusy(true);
    feel("commit");
    settle({ deviceId: device, videoId: r.videoId as Id<"videos">, accepted, views }).finally(() => setBusy(false));
  };
  const outcome = r.outcome === "pass" ? <Badge label="RIGHT CALL" tone="green" icon="check" size="sm" />
    : r.outcome === "fail" ? <Badge label="WRONG CALL" tone="red" size="sm" />
    : <Badge label="IN PLAY" tone="parch" size="sm" dashed />;
  return (
    <View style={s.slot}>
      <Card title={r.brand} testID={`earnings-video-${r.videoId}`}>
        <View style={s.stakes}>
          {outcome}
          {r.demo && <Badge label="Demo result" tone="violet" size="sm" dashed testID={`earnings-demo-${r.videoId}`} />}
        </View>
        {r.title ? <Text style={s.title} numberOfLines={2}>{r.title}</Text> : null}
        <GateLine name="Brand review" g={r.gate1} testID={`earnings-gate1-${r.videoId}`} />
        <GateLine name="Performance" g={r.gate2} testID={`earnings-gate2-${r.videoId}`} />
        <View style={s.split}>
          <View style={s.half}>
            <Text style={s.label}>{r.viewsSource === "actual" ? "VIEWS" : "FORECAST VIEWS"}</Text>
            <Text style={s.figure}>{thousands(r.views)}</Text>
          </View>
          <View style={s.half}>
            <Text style={s.label}>PROJECTED</Text>
            <Text style={s.figure} testID={`earnings-cents-${r.videoId}`}>
              {money(r.projectedCents)} <Text style={s.gold}>→ {money(r.boostedCents)}</Text>
            </Text>
            <Text style={s.small}>with {x(multiplier)} bonus</Text>
          </View>
        </View>
        {r.viewsSource === "forecast" && <HonestyLabel kind="forecast" />}
        {demo && (
          <View style={s.demo} testID={`earnings-demo-controls-${r.videoId}`}>
            <Text style={s.label}>DEMO CONTROL · ENTER A RESULT BY HAND</Text>
            <View style={s.stakes}>
              <Button label={`Accepted, ${thousands(good)} views`} size="sm" bevel="green" disabled={busy}
                onPress={() => run(true, good)} testID={`earnings-demo-good-${r.videoId}`} />
              <Button label={`Accepted, ${thousands(flop)} views`} size="sm" bevel="orange" disabled={busy}
                onPress={() => run(true, flop)} testID={`earnings-demo-flop-${r.videoId}`} />
              <Button label="Denied" size="sm" variant="secondary" disabled={busy}
                onPress={() => run(false, 0)} testID={`earnings-demo-deny-${r.videoId}`} />
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

function History({ data }: { data: Summary }) {
  return (
    <View style={s.slot}>
      <Card title="Bonus history" sub="Newest first" testID="earnings-history">
        {data.history.map((h, i) => (
          <View key={`${h.videoId}-${i}`} style={[s.hist, i > 0 && s.histLine]} testID={`earnings-history-${i}`}>
            <View style={s.histText}>
              <Text style={s.bold} numberOfLines={1}>{h.brand}{h.demo ? " · demo" : ""}</Text>
              <Text style={s.small} numberOfLines={1}>{h.reason}</Text>
            </View>
            <Text style={[s.histMove, { color: h.to >= h.from ? COLOR.greenDeep : COLOR.redDeep }]}>{x(h.from)} → {x(h.to)}</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: DEEP },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 32 },
  slot: { marginTop: 14 },
  section: {
    marginTop: 22, color: COLOR.sign, fontSize: 16, fontFamily: FONT.bold, letterSpacing: 1,
    textShadowColor: INK, textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 0,
  },
  hero: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  heroOf: { color: PARCH.ink, fontSize: 18, fontFamily: FONT.semi, marginBottom: 10 },
  meter: { height: 14, borderWidth: 2, borderColor: INK, backgroundColor: PARCH.bottom, marginTop: 6 },
  meterFill: { height: "100%", backgroundColor: COLOR.gold },
  body: { color: PARCH.ink, fontSize: 17, fontFamily: FONT.semi, lineHeight: 22, marginTop: 8 },
  small: { color: PARCH.ink, fontSize: 14, fontFamily: FONT.semi, lineHeight: 18, marginTop: 6, opacity: 0.85 },
  bold: { color: PARCH.ink, fontFamily: FONT.bold, fontSize: 17 },
  stakes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  split: { flexDirection: "row", gap: 12, marginTop: 10 },
  half: { flex: 1 },
  label: { color: PARCH.ink, fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.5, opacity: 0.8 },
  money: { color: PARCH.ink, fontSize: 30, fontFamily: FONT.bold },
  gold: { color: COLOR.goldDeep },
  figure: { color: PARCH.ink, fontSize: 21, fontFamily: FONT.bold },
  scale: { marginTop: 12 },
  title: { color: PARCH.ink, fontSize: 19, fontFamily: FONT.bold, lineHeight: 22, marginTop: 8 },
  gate: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  gateName: { color: PARCH.ink, fontSize: 16, fontFamily: FONT.semi },
  demo: { marginTop: 12, paddingTop: 10, borderTopWidth: 2, borderTopColor: PARCH.bottom, borderStyle: "dashed" },
  hist: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  histLine: { borderTopWidth: 1, borderTopColor: PARCH.bottom },
  histText: { flex: 1 },
  histMove: { fontSize: 17, fontFamily: FONT.bold },
  footnote: {
    alignSelf: "center", color: COLOR.foam, fontSize: 14, fontFamily: FONT.semi, marginTop: 16, textAlign: "center",
    lineHeight: 18, textShadowColor: INK, textShadowOffset: { width: 0, height: 1.5 }, textShadowRadius: 0,
  },
});
