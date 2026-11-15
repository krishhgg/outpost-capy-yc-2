import { ConvexError, v } from "convex/values";
import { makeFunctionReference, type GenericDatabaseWriter, type GenericDataModel } from "convex/server";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Seed data for Revyl's proof users, the fixed EXPO_PUBLIC_DEVICE_ID builds in outpost/.revyl/config.yaml, so the
// Feed has clips to test without the laptop studio. Builder-only:
//   npx convex run testkit:seedProofUser '{"deviceId":"revyl-proof-ios-fixed-device-for-pull-request-proofs"}'
// It tops the user up to `count` ready test clips (default BUFFER, so the app's refill queues nothing for the studio)
// and deletes the user's queued videos so the laptop studio never renders for a test user.

const PREFIX = "revyl-proof-";
const BUFFER = 10;
const MAX = 20;

// A 3-second 360x640 H.264 clip, a gold square crossing a sea-blue frame (3.5 KB), made with:
// ffmpeg -f lavfi -i color=c=0x3EB4E2:s=360x640:r=10:d=3 -f lavfi -i color=c=0xFFC83A:s=120x120:r=10:d=3
//   -filter_complex "[0][1]overlay=x=(W-w)*t/3:y=(H-h)/2" -c:v libx264 -preset veryslow -crf 38
//   -pix_fmt yuv420p -profile:v main -movflags +faststart -an clip.mp4
const CLIP = "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";

async function proofUser(ctx: QueryCtx, deviceId: string) {
  if (!deviceId.startsWith(PREFIX)) throw new ConvexError(`testkit only seeds ${PREFIX}* devices`);
  const user = await ctx.db.query("users").withIndex("by_device", q => q.eq("deviceId", deviceId)).unique();
  if (!user) throw new ConvexError("no user for this device yet: launch its proof build once first");
  if (user.postingMode !== "dryRun") throw new ConvexError("this user is not in dryRun, so testkit leaves it alone");
  const ready = await ctx.db.query("videos")
    .withIndex("by_user_status_rank", q => q.eq("userId", user._id).eq("status", "ready")).take(MAX);
  return { user, ready: ready.length };
}

export const check = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => ({ ready: (await proofUser(ctx, deviceId)).ready }),
});

export const addReady = internalMutation({
  args: { deviceId: v.string(), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { deviceId, storageIds }) => {
    const { user, ready } = await proofUser(ctx, deviceId);
    const queued = await ctx.db.query("videos")
      .withIndex("by_user_status_rank", q => q.eq("userId", user._id).eq("status", "queued")).collect();
    for (const r of queued) await ctx.db.delete(r._id);
    const now = Date.now();
    for (const [i, storageId] of storageIds.entries()) {
      const n = ready + i + 1;
      await ctx.db.insert("videos", {
        userId: user._id, status: "ready", rank: now + i, storageId, durationS: 3, model: "testkit", attempts: 0, createdAt: now,
        script: {
          hook: `Revyl test clip ${n}`,
          lines: [{ say: "Seeded test clip for Revyl proofs.", label: "Test clip" }],
          cta: "Test data", caption: "Revyl test clip. Seeded test data for a dry-run user; it never posts.",
          title: `Revyl test clip ${n}`, angle: "test",
        },
      });
    }
    return { added: storageIds.length, ready: ready + storageIds.length, clearedQueued: queued.length };
  },
});

const checkRef = makeFunctionReference<"query", { deviceId: string }, { ready: number }>("testkit:check");
const addReadyRef = makeFunctionReference<"mutation", { deviceId: string; storageIds: Id<"_storage">[] },
  { added: number; ready: number; clearedQueued: number }>("testkit:addReady");

export const seedProofUser = internalAction({
  args: { deviceId: v.string(), count: v.optional(v.number()) },
  handler: async (ctx, { deviceId, count }): Promise<{ added: number; ready: number; clearedQueued: number }> => {
    const want = Math.max(1, Math.min(Math.round(count ?? BUFFER), MAX));
    const { ready } = await ctx.runQuery(checkRef, { deviceId });
    const bytes = Uint8Array.from(atob(CLIP), c => c.charCodeAt(0));
    const storageIds: Id<"_storage">[] = [];
    for (let i = ready; i < want; i++) storageIds.push(await ctx.storage.store(new Blob([bytes], { type: "video/mp4" })));
    try {
      return await ctx.runMutation(addReadyRef, { deviceId, storageIds });
    } catch (e) {
      for (const id of storageIds) await ctx.storage.delete(id);
      throw e;
    }
  },
});

// Deletes a stray test user and every row keyed to it, including its video files. Refuses a user that isn't in
// dryRun or that has connected accounts, so it can't remove a real poster.
export const purgeTestUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("no such user");
    if (user.postingMode !== "dryRun") throw new ConvexError("this user is not in dryRun, so testkit leaves it alone");
    if (await ctx.db.query("connections").withIndex("by_user", q => q.eq("userId", userId)).first()) {
      throw new ConvexError("this user has connected accounts, so testkit leaves it alone");
    }
    const gone: Record<string, number> = {};
    const drop = async (table: string, ids: Id<any>[]) => {
      for (const id of ids) await ctx.db.delete(id);
      gone[table] = ids.length;
    };
    const videos = await ctx.db.query("videos").withIndex("by_user_status_rank", q => q.eq("userId", userId)).collect();
    const posts = [];
    for (const video of videos) {
      posts.push(...await ctx.db.query("posts").withIndex("by_video", q => q.eq("videoId", video._id)).collect());
      // A demo library clone shares its library video's file with every other clone, so the library keeps it.
      if (video.storageId && !video.pregenerated && !video.sourceVideoId) await ctx.storage.delete(video.storageId);
    }
    await drop("posts", posts.map(r => r._id));
    await drop("videos", videos.map(r => r._id));
    await drop("finds", (await ctx.db.query("finds").withIndex("by_user_status", q => q.eq("userId", userId)).collect()).map(r => r._id));
    await drop("days", (await ctx.db.query("days").withIndex("by_user_day", q => q.eq("userId", userId)).collect()).map(r => r._id));
    await drop("swipes", (await ctx.db.query("swipes").withIndex("by_user_day", q => q.eq("userId", userId)).collect()).map(r => r._id));
    await drop("tasteNotes", (await ctx.db.query("tasteNotes").withIndex("by_user", q => q.eq("userId", userId)).collect()).map(r => r._id));
    await drop("taste", (await ctx.db.query("taste").withIndex("by_user", q => q.eq("userId", userId)).collect()).map(r => r._id));
    // userBounties arrives with the bounties schema; a scan works whether or not the table exists yet.
    const loose = ctx.db as unknown as GenericDatabaseWriter<GenericDataModel>;
    await drop("userBounties", (await loose.query("userBounties").filter(q => q.eq(q.field("userId"), userId)).collect()).map(r => r._id as Id<any>));
    await ctx.db.delete(userId);
    return gone;
  },
});
