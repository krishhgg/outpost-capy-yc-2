import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ownVideo, userFor } from "./lib";
import { estimate, gather, grade, median } from "./earnings";

// The accuracy multiplier and projected earnings. A right swipe is a bet that the video clears two gates: the brand
// accepts the submission on Whop (gate 1), and the post performs decently (gate 2: it reaches the campaign's minimum
// views and isn't graded a Miss against the user's baseline). Every right swipe that clears both raises the user's
// accuracy; one that fails either gate lowers it. The multiplier runs from 1x toward 5x on that accuracy, so approving
// everything costs you. It counts PRIOR extra wrong calls, so one lucky swipe can't jump to 5x, and so every right
// call raises it and every wrong call lowers it, however many results came before.

export const MAX_MULTIPLIER = 5;
export const PRIOR = 3;
// Gate 2 waits this long before a slow video counts as a Miss. Content Rewards reviews within about 48 hours too.
const WINDOW_MS = 48 * 3600 * 1000;
// Before the user has a baseline of their own, a usual video is taken to do twice the campaign's minimum views (and at
// least this many), so a fresh account's forecasts aren't all under the minimum and worth nothing.
const DEFAULT_BASELINE = 500;
// The forecast score (0 to 100) the studio gives each video maps to views: 60 is the user's usual, every 15 points
// above doubles it and every 15 below halves it.
const FORECAST_MID = 60;
const FORECAST_DOUBLING = 15;

export type Gate = "pass" | "fail" | "pending";

export function multiplierFor(passed: number, failed: number) {
  return Math.round((1 + ((MAX_MULTIPLIER - 1) * passed) / (passed + failed + PRIOR)) * 100) / 100;
}

export function forecastViews(score: number, baseline: number) {
  return Math.round(baseline * 2 ** ((score - FORECAST_MID) / FORECAST_DOUBLING));
}

type Sub = Doc<"submissions">;
const ORDER: Sub["status"][] = ["approved", "submitted", "pending", "manual", "denied", "failed"];

function gate1(sub: Sub | null): { gate: Gate; label: string; at: number | null } {
  if (!sub) return { gate: "pending", label: "Not posted yet", at: null };
  if (sub.status === "approved") return { gate: "pass", label: "Accepted", at: sub.resolvedAt ?? sub.submittedAt ?? sub._creationTime };
  if (sub.status === "denied" || sub.status === "failed") {
    return { gate: "fail", label: sub.status === "denied" ? "Denied" : "Submission failed", at: sub.resolvedAt ?? sub._creationTime };
  }
  if (sub.status === "manual") return { gate: "pending", label: "Not submitted on Whop yet", at: null };
  return { gate: "pending", label: "Waiting on review", at: null };
}

async function everything(ctx: QueryCtx, user: Doc<"users">) {
  const { live, submissions, items, inputs } = await gather(ctx, user);
  const graded = new Map(grade(inputs.items, inputs.accountBaseline).map(g => [g.videoId, g]));
  const counted = inputs.items.filter(i => i.counted).map(i => i.views);
  const own = user.baselineViews ?? (counted.length >= 2 ? median(counted) : null);

  // Each right-swiped bounty video once, in swipe order.
  const right = new Map<Id<"videos">, number>();
  for (const s of inputs.swipes) if (s.dir === "right" && !right.has(s.videoId)) right.set(s.videoId, s.at);

  const subsByVideo = new Map<Id<"videos">, Sub[]>();
  for (const s of submissions) subsByVideo.set(s.videoId, [...(subsByVideo.get(s.videoId) ?? []), s]);
  const postsByVideo = new Map<Id<"videos">, Doc<"posts">[]>();
  for (const p of live) postsByVideo.set(p.videoId, [...(postsByVideo.get(p.videoId) ?? []), p]);

  const bounties = new Map<Id<"bounties">, Doc<"bounties"> | null>();
  const now = Date.now();
  const rows = [];
  for (const [videoId, swipedAt] of right) {
    const video = await ctx.db.get(videoId);
    if (!video?.bountyId) continue;
    if (!bounties.has(video.bountyId)) bounties.set(video.bountyId, await ctx.db.get(video.bountyId));
    const bounty = bounties.get(video.bountyId);
    if (!bounty) continue;

    const subs = subsByVideo.get(videoId) ?? [];
    const sub = ORDER.map(st => subs.find(s => s.status === st)).find(Boolean) ?? null;
    const posts = postsByVideo.get(videoId) ?? [];
    const item = items.get(videoId);
    const g = graded.get(videoId);
    const demo = posts.some(p => p.demo) || subs.some(s => s.demo);
    const forecast = video.predicted?.score ?? FORECAST_MID;
    const forecastV = forecastViews(forecast, own ?? Math.max(DEFAULT_BASELINE, 2 * (bounty.minViews ?? 0)));

    const one = gate1(posts.length ? sub : null);
    let two: { gate: Gate; label: string; at: number | null } = { gate: "pending", label: "Waiting for views", at: null };
    if (item?.counted) {
      const viewsAt = Math.max(...posts.map(p => p.viewsAt ?? p.liveAt ?? p.slotAt));
      const minOk = item.views >= (bounty.minViews ?? 0);
      const notMiss = g?.verdict !== "miss";
      const final = demo || now - item.liveAt >= WINDOW_MS;
      if (minOk && notMiss) two = { gate: "pass", label: g?.verdict === "hit" ? "Hit" : "Performing", at: viewsAt };
      else if (final) {
        two = { gate: "fail", label: !minOk ? "Under the minimum views" : "Miss", at: demo ? viewsAt : item.liveAt + WINDOW_MS };
      } else two = { gate: "pending", label: !minOk ? "Under the minimum so far" : "Behind so far", at: null };
    }

    const outcome: Gate = one.gate === "fail" || two.gate === "fail" ? "fail" : one.gate === "pass" && two.gate === "pass" ? "pass" : "pending";
    const resolvedAt = outcome === "pass" ? Math.max(one.at!, two.at!)
      : outcome === "fail" ? Math.min(...[one, two].filter(x => x.gate === "fail").map(x => x.at!))
      : null;

    const views = item?.counted ? item.views : forecastV;
    const projectedCents = one.gate === "fail" ? 0 : estimate(bounty, views);
    rows.push({
      videoId, bountyId: bounty._id, brand: bounty.brand, title: video.script?.hook ?? video.brief?.hook ?? "",
      swipedAt, forecast, views, viewsSource: item?.counted ? ("actual" as const) : ("forecast" as const),
      minViews: bounty.minViews ?? null, ratePer1kCents: bounty.ratePer1kCents ?? null, maxPerClipCents: bounty.maxPerClipCents ?? null,
      projectedCents, gate1: one, gate2: two, outcome, resolvedAt, demo,
    });
  }

  // Replay results in the order they landed, so each one shows what it did to the multiplier.
  let passed = 0;
  let failed = 0;
  const history = [];
  for (const r of rows.filter(r => r.resolvedAt !== null).sort((a, b) => a.resolvedAt! - b.resolvedAt!)) {
    const from = multiplierFor(passed, failed);
    if (r.outcome === "pass") passed++; else failed++;
    history.push({
      videoId: r.videoId, brand: r.brand, title: r.title, outcome: r.outcome, at: r.resolvedAt!, demo: r.demo,
      reason: r.outcome === "pass" ? `${r.gate1.label}, ${r.gate2.label.toLowerCase()}` : (r.gate1.gate === "fail" ? r.gate1.label : r.gate2.label),
      from, to: multiplierFor(passed, failed),
    });
  }
  const multiplier = multiplierFor(passed, failed);
  return { rows, history: history.reverse(), passed, failed, multiplier };
}

export const summary = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const user = await userFor(ctx, deviceId);
    const { rows, history, passed, failed, multiplier } = await everything(ctx, user);
    const videos = rows.map(r => ({ ...r, boostedCents: Math.round(r.projectedCents * multiplier) })).sort((a, b) => b.swipedAt - a.swipedAt);
    const open = videos.filter(r => r.outcome !== "fail");
    const projectedCents = open.reduce((n, r) => n + r.projectedCents, 0);
    const average = open.length ? projectedCents / open.length : 0;
    return {
      multiplier, max: MAX_MULTIPLIER,
      accuracy: passed + failed ? passed / (passed + failed) : null,
      passed, failed, pending: rows.length - passed - failed,
      // What the next result would do, so a right swipe shows its stakes.
      ifPass: multiplierFor(passed + 1, failed), ifFail: multiplierFor(passed, failed + 1),
      projectedCents, boostedCents: Math.round(projectedCents * multiplier),
      // Thirty days at a steady pace, if each video does as projected, at today's multiplier.
      scale: [3, 10].map(perDay => ({ perDay, monthlyCents: Math.round(average * perDay * 30 * multiplier) })),
      videos, history,
      demoControls: process.env.DEMO_CONTROLS === "1",
    };
  },
});

// The demo control. Content Rewards has no API for review results and they take up to 48 hours, so on stage the
// builder enters a video's result by hand: accepted or denied, and its views. Everything it writes is flagged `demo`,
// and the app labels those results "Demo result". Off unless the deployment sets DEMO_CONTROLS=1.
export const settleDemo = mutation({
  args: { deviceId: v.string(), videoId: v.id("videos"), accepted: v.boolean(), views: v.number() },
  handler: async (ctx, { deviceId, videoId, accepted, views }) => {
    if (process.env.DEMO_CONTROLS !== "1") throw new ConvexError("Demo controls are off");
    const user = await userFor(ctx, deviceId);
    const video = await ownVideo(ctx, user, videoId);
    if (!video.bountyId) throw new ConvexError("Not a bounty video");
    const now = Date.now();
    const count = Math.max(0, Math.round(views));
    let posts = (await ctx.db.query("posts").withIndex("by_video", q => q.eq("videoId", videoId)).collect())
      .filter(p => p.userId === user._id);
    if (!posts.length) {
      const id = await ctx.db.insert("posts", {
        userId: user._id, videoId, platform: "instagram", status: "live", mode: "public",
        views: count, viewsAt: now, slotAt: now, liveAt: now, checks: 0, demo: true,
      });
      posts = [(await ctx.db.get(id))!];
    } else {
      // One post carries the views, so the total is what the builder typed.
      for (const [i, p] of posts.entries()) {
        await ctx.db.patch(p._id, { status: "live", views: i === 0 ? count : 0, viewsAt: now, liveAt: p.liveAt ?? now, demo: true });
      }
    }
    const status = accepted ? ("approved" as const) : ("denied" as const);
    for (const p of posts) {
      const sub = await ctx.db.query("submissions").withIndex("by_post", q => q.eq("postId", p._id)).first();
      if (sub) await ctx.db.patch(sub._id, { status, resolvedAt: now, demo: true });
      else {
        await ctx.db.insert("submissions", {
          userId: user._id, bountyId: video.bountyId, videoId, postId: p._id, url: p.url ?? "",
          status, submittedAt: now, resolvedAt: now, checks: 0, demo: true,
        });
      }
    }
    return null;
  },
});
