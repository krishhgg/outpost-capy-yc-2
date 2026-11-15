import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { livePosts, userFor } from "./lib";

// Estimated earnings and the taste score, from real rows only: live posts and their view counts, submissions and the
// statuses Whop gave them, and the user's swipes. Nothing here depends on the clock, so the query reruns exactly when
// one of those rows changes. The only thing stored is the score at the user's last Collect (`mark`).

type Status = Doc<"submissions">["status"];
type Verdict = "hit" | "solid" | "miss";

// A video beats its baseline by this much to be a Hit, and falls short of it below MISS. Same as HIT_AT and MISS_UNDER in
// src/ui/Badge.tsx, which the app's badges use.
const HIT = 1.5;
const MISS = 0.8;
// Earlier counted posts the baseline needs, when no account baseline is set.
const MIN_EARLIER = 2;
// Scored posts before the score stops being provisional.
const NEEDED = 5;
// Swipes before pickiness gives a provisional score.
const MIN_SWIPES = 3;

export type Item = {
  videoId: Id<"videos">;
  bountyId: Id<"bounties"> | null;
  title: string;
  liveAt: number;
  views: number;
  counted: boolean;
  url: string | null;
};

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Each video against the median of the user's earlier counted videos, or the account baseline when a builder set one.
// A video is scored once the platform has counted it and there is a baseline. The app labels a verdict on a video under
// two days old "so far", since views still climb.
export function grade(items: Item[], accountBaseline: number | null) {
  const live = [...items].sort((a, b) => a.liveAt - b.liveAt);
  return live.map((item, i) => {
    const earlier = live.slice(0, i).filter(e => e.counted).map(e => e.views);
    const baseline = accountBaseline ?? (earlier.length >= MIN_EARLIER ? median(earlier) : null);
    // Plus one on both sides, so a baseline of 0 views still compares.
    const ratio = item.counted && baseline !== null ? (item.views + 1) / (baseline + 1) : null;
    const verdict: Verdict | null = ratio === null ? null : ratio >= HIT ? "hit" : ratio >= MISS ? "solid" : "miss";
    return { ...item, baseline, ratio, verdict };
  });
}

// Healthy pickiness approves 20-50% of clips. Approving everything or nothing scores low.
function pickScore(share: number) {
  const p = share * 100;
  if (p < 20) return 30 + 30 * (p / 20);
  if (p <= 50) return 70 - Math.abs(p - 35) * (10 / 15);
  return 60 - 30 * ((p - 50) / 50);
}

type Inputs = { items: Item[]; swipes: Doc<"swipes">[]; submissions: Doc<"submissions">[]; accountBaseline: number | null };

// The taste score: scaled(approval rate x performance). Performance is the median of the scored
// videos' views over their baselines; the approval rate is Whop-approved over settled submissions, left out until Whop
// settles one. Until NEEDED videos are scored the score is provisional: pickiness, blended with the videos scored so far.
function tasteOf({ items, swipes, submissions, accountBaseline }: Inputs) {
  const graded = grade(items, accountBaseline);
  const scored = graded.filter(g => g.ratio !== null);
  const hits = scored.filter(g => g.verdict === "hit").length;
  const settled = submissions.filter(s => s.status === "approved" || s.status === "denied");
  const approvedSubs = settled.filter(s => s.status === "approved").length;
  const approvalRate = settled.length ? approvedSubs / settled.length : null;
  const approvedClips = swipes.filter(s => s.dir === "right").length;
  const pickiness = swipes.length ? approvedClips / swipes.length : null;

  const perf = scored.length ? median(scored.map(g => g.ratio!)) * (approvalRate ?? 1) : null;
  const perfScore = perf === null ? null : (100 * perf) / (perf + 1);
  const pick = pickiness !== null && swipes.length >= MIN_SWIPES ? pickScore(pickiness) : null;
  const n = scored.length;
  const raw = n >= NEEDED ? perfScore
    : perfScore !== null && pick !== null ? (pick * (NEEDED - n) + perfScore * n) / NEEDED
    : perfScore ?? pick;
  return {
    graded, score: raw === null ? null : Math.max(0, Math.min(100, Math.round(raw))), provisional: n < NEEDED, scored: n,
    hits, approvalRate, approvedSubs, settledSubs: settled.length, pickiness, approvedClips, seenClips: swipes.length,
  };
}

// Content Rewards pays per 1K views above a minimum, up to a cap per clip. A per-submission bounty pays its reward.
export function estimate(b: Doc<"bounties">, views: number) {
  if (b.rewardKind === "per_submission") return b.rewardCents ?? 0;
  if (!b.ratePer1kCents || views < (b.minViews ?? 0)) return 0;
  const cents = Math.floor((views * b.ratePer1kCents) / 1000);
  return b.maxPerClipCents !== undefined ? Math.min(cents, b.maxPerClipCents) : cents;
}

// The rows everything here reads: live posts grouped into one item per video (platform views summed), the user's
// submissions and swipes.
export async function gather(ctx: QueryCtx, user: Doc<"users">) {
  const live = await livePosts(ctx, user._id);
  const submissions = await ctx.db.query("submissions").withIndex("by_user", q => q.eq("userId", user._id)).collect();
  const swipes = await ctx.db.query("swipes").withIndex("by_user_day", q => q.eq("userId", user._id)).collect();
  const items = new Map<Id<"videos">, Item>();
  for (const p of live) {
    let item = items.get(p.videoId);
    if (!item) {
      const video = await ctx.db.get(p.videoId);
      item = {
        videoId: p.videoId, bountyId: video?.bountyId ?? null, title: video?.script?.hook ?? "",
        liveAt: p.liveAt ?? p.slotAt, views: 0, counted: false, url: p.url ?? null,
      };
      items.set(p.videoId, item);
    }
    item.views += p.views;
    item.counted ||= p.viewsAt !== undefined || p.views > 0;
    item.liveAt = Math.min(item.liveAt, p.liveAt ?? p.slotAt);
    item.url ??= p.url ?? null;
  }
  const inputs: Inputs = { items: [...items.values()], swipes, submissions, accountBaseline: user.baselineViews ?? null };
  return { live, submissions, items, inputs };
}

// A video's posts can carry several submissions; the one furthest along speaks for it.
const ORDER: Status[] = ["approved", "submitted", "pending", "manual", "denied", "failed"];

export const summary = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const user = await userFor(ctx, deviceId);
    const { live, submissions, items, inputs } = await gather(ctx, user);
    const subByPost = new Map(submissions.map(s => [s.postId, s]));
    const bounties = new Map<Id<"bounties">, Doc<"bounties"> | null>();
    const bountyOf = async (id: Id<"bounties">) => {
      if (!bounties.has(id)) bounties.set(id, await ctx.db.get(id));
      return bounties.get(id)!;
    };

    // Earnings per submitted post: approved counts as approved, submitted and pending as pending, denied and failed as
    // nothing. A manual row isn't on Whop until the user submits it there, so its estimate waits apart.
    let pendingCents = 0;
    let approvedCents = 0;
    let unsubmittedCents = 0;
    const money = new Map<Id<"videos">, { estCents: number; statuses: Status[]; url: string | null }>();
    for (const p of live) {
      const item = items.get(p.videoId)!;
      if (!item.bountyId) continue;
      const row = money.get(p.videoId) ?? { estCents: 0, statuses: [], url: null };
      money.set(p.videoId, row);
      const sub = subByPost.get(p._id);
      if (!sub) continue;
      row.statuses.push(sub.status);
      row.url ??= sub.url;
      const bounty = await bountyOf(item.bountyId);
      if (!bounty || sub.status === "denied" || sub.status === "failed") continue;
      const cents = estimate(bounty, p.views);
      row.estCents += cents;
      if (sub.status === "approved") approvedCents += cents;
      else if (sub.status === "manual") unsubmittedCents += cents;
      else pendingCents += cents;
    }

    const taste = tasteOf(inputs);
    const graded = new Map(taste.graded.map(g => [g.videoId, g]));

    const perVideo = [];
    for (const [videoId, row] of money) {
      const item = items.get(videoId)!;
      const g = graded.get(videoId);
      perVideo.push({
        videoId, bountyId: item.bountyId!, brand: (await bountyOf(item.bountyId!))?.brand ?? "",
        url: row.url ?? item.url, views: item.views, estCents: row.estCents,
        status: ORDER.find(s => row.statuses.includes(s)) ?? null,
        title: item.title, liveAt: item.liveAt, verdict: g?.verdict ?? null, ratio: g?.ratio ?? null,
      });
    }
    perVideo.sort((a, b) => b.liveAt - a.liveAt);

    // Every live video, newest first, with its verdict.
    const posts = taste.graded.slice().reverse().map(g => ({
      videoId: g.videoId, title: g.title, liveAt: g.liveAt, views: g.views, counted: g.counted, url: g.url,
      baseline: g.baseline, ratio: g.ratio, verdict: g.verdict,
    }));
    // The Away card's best and worst post: graded videos by ratio, or counted ones by views before any are graded.
    const gradedPosts = posts.filter(p => p.ratio !== null).sort((a, b) => b.ratio! - a.ratio!);
    const ranked = gradedPosts.length ? gradedPosts : posts.filter(p => p.counted).sort((a, b) => b.views - a.views);

    const score = taste.score;
    return {
      pendingCents,
      approvedCents,
      // Estimated from posts still waiting for the user to submit them on Whop.
      unsubmittedCents,
      perVideo,
      tasteScore: score ?? 0,
      // The change since the score saved at the user's last Collect (`mark`). There is no view history, so a score
      // recomputed for an earlier time would use today's views; the saved one is what the user actually saw.
      tasteTrend: score !== null && user.tasteScore !== undefined ? score - user.tasteScore : 0,
      // Videos scored against a baseline: what moves the score out of calibrating.
      settledCount: taste.scored,
      taste: {
        // empty: nothing to score yet. calibrating: a provisional score. scored: NEEDED videos scored.
        state: score === null ? ("empty" as const) : taste.provisional ? ("calibrating" as const) : ("scored" as const),
        // The app names the tier with tierFor() in src/ui.
        score,
        scored: taste.scored,
        needed: NEEDED,
        hits: taste.hits,
        hitRate: taste.scored ? taste.hits / taste.scored : null,
        approvalRate: taste.approvalRate,
        approvedSubmissions: taste.approvedSubs,
        settledSubmissions: taste.settledSubs,
        pickiness: taste.pickiness,
        approvedClips: taste.approvedClips,
        seenClips: taste.seenClips,
        baselineFrom: user.baselineViews !== undefined ? ("account" as const) : ("earlier posts" as const),
      },
      posts,
      away: {
        scoreFrom: user.tasteScore ?? null,
        scoreTo: score,
        best: ranked[0] ?? null,
        worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      },
    };
  },
});

// Saves the taste score the Away card showed when the user tapped Collect, so the next card and the trend compare with
// the score the user actually saw, even if views or a submission changed while the card was open. Without a shown
// score it saves the score as it is now.
export const mark = mutation({
  args: { deviceId: v.string(), score: v.optional(v.number()) },
  handler: async (ctx, { deviceId, score: shown }) => {
    const user = await userFor(ctx, deviceId);
    const score = shown !== undefined ? Math.max(0, Math.min(100, Math.round(shown))) : tasteOf((await gather(ctx, user)).inputs).score;
    if (score !== null) await ctx.db.patch(user._id, { tasteScore: score });
    return null;
  },
});
