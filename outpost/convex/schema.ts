import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const platform = v.union(v.literal("youtube"), v.literal("instagram"), v.literal("tiktok"));
export const postingMode = v.union(v.literal("dryRun"), v.literal("private"), v.literal("public"));

// A reel's beats are its lines. Older videos have three plain lines and none of the optional fields.
export const script = v.object({
  hook: v.string(),
  sub: v.optional(v.string()),
  lines: v.array(v.object({
    say: v.string(), label: v.string(),
    kind: v.optional(v.string()), who: v.optional(v.string()), items: v.optional(v.array(v.string())), value: v.optional(v.number()), unit: v.optional(v.string()),
  })),
  cta: v.string(),
  keyword: v.optional(v.string()),
  caption: v.string(),
  title: v.string(),
  angle: v.string(),
});

// What one queued video should be about, written ahead of time from trend research. The studio writes the script
// from it, and the render uses its set, second character and talking object when the template has them.
export const brief = v.object({
  format: v.string(), // the story format, like "dialogue skit" or "expectation vs reality"
  story: v.string(), // what happens, in a few sentences
  why: v.string(), // the trend it follows and why it should work
  hook: v.optional(v.string()),
  set: v.optional(v.string()),
  cast: v.optional(v.string()),
  buddy: v.optional(v.string()),
  palette: v.optional(v.number()),
});

export default defineSchema({
  users: defineTable({
    deviceId: v.string(),
    niche: v.string(),
    tz: v.string(),
    freezesLeft: v.number(),
    postingMode,
    pacePerDay: v.number(),
    drainPaused: v.boolean(),
    createdAt: v.number(),
    // What the user had seen when they last tapped Collect on the away screen.
    seen: v.optional(v.object({ at: v.number(), views: v.number() })),
    // When the Scout last searched the Whop marketplace for this user.
    scoutAt: v.optional(v.number()),
    phone: v.optional(v.string()),
    tasteScore: v.optional(v.number()),
    baselineViews: v.optional(v.number()),
  }).index("by_device", ["deviceId"]),

  connections: defineTable({
    userId: v.id("users"),
    platform,
    accountId: v.string(),
    handle: v.string(),
  }).index("by_user", ["userId"]),

  // queued: waiting for the laptop studio. making: claimed, `stage` says which step.
  videos: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("queued"), v.literal("making"), v.literal("ready"),
      v.literal("right"), v.literal("left"), v.literal("failed"),
    ),
    rank: v.number(),
    stage: v.optional(v.string()),
    parentId: v.optional(v.id("videos")),
    remakeReason: v.optional(v.string()),
    remakeNote: v.optional(v.string()),
    // A Scout find the user swiped right on. The studio writes this video about it.
    findId: v.optional(v.id("finds")),
    brief: v.optional(brief),
    script: v.optional(script),
    voice: v.optional(v.string()),
    palette: v.optional(v.number()),
    model: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    durationS: v.optional(v.number()),
    timings: v.optional(v.object({ writeMs: v.number(), voiceMs: v.number(), renderMs: v.number(), uploadMs: v.number() })),
    publicUrl: v.optional(v.object({ url: v.string(), at: v.number() })),
    attempts: v.number(),
    claimedAt: v.optional(v.number()),
    readyAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    bountyId: v.optional(v.id("bounties")),
    mode: v.optional(v.union(v.literal("original"), v.literal("clip"))),
    clip: v.optional(v.object({ sourceUrl: v.string(), startS: v.number(), endS: v.number(), hook: v.string(), captionStyle: v.string() })),
    // The studio's forecast of how well this video meets its bounty brief, 0 to 100, shown as a forecast.
    predicted: v.optional(v.object({ score: v.number(), reason: v.string() })),
    // Made ahead of time for the demo library. A clone shares its library video's storage file and never deletes it.
    pregenerated: v.optional(v.boolean()),
    sourceVideoId: v.optional(v.id("videos")),
  })
    .index("by_user_status_rank", ["userId", "status", "rank"])
    .index("by_status", ["status"])
    .index("by_status_rank", ["status", "rank"])
    .index("by_status_parent", ["status", "parentId"]),

  // Paid products the Scout found on the Whop marketplace for this user's niche.
  finds: defineTable({
    userId: v.id("users"),
    whopId: v.string(),
    title: v.string(),
    headline: v.string(),
    priceCents: v.number(),
    renews: v.boolean(),
    everyDays: v.optional(v.number()), // how often a subscription bills
    members: v.number(),
    rating: v.number(),
    reviews: v.number(),
    image: v.optional(v.string()),
    query: v.string(),
    status: v.union(v.literal("new"), v.literal("right"), v.literal("left")),
    at: v.number(),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_user_whop", ["userId", "whopId"]),

  swipes: defineTable({
    userId: v.id("users"),
    videoId: v.id("videos"),
    dir: v.union(v.literal("right"), v.literal("left")),
    reason: v.optional(v.string()),
    dwellMs: v.number(),
    day: v.string(),
    at: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  // One row per user per local day, bumped as things happen. The You tab reads these.
  days: defineTable({
    userId: v.id("users"),
    day: v.string(), // YYYY-MM-DD in the user's time zone
    made: v.number(),
    approved: v.number(),
    remakes: v.number(),
    skipped: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  tasteNotes: defineTable({
    userId: v.id("users"),
    text: v.string(),
    reasonKey: v.optional(v.string()),
    videoId: v.optional(v.id("videos")),
    sync: v.union(v.literal("pending"), v.literal("synced"), v.literal("failed")),
    deleted: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // What Supermemory has learned from a user's taste notes, cached so the studio and the hood never wait on it.
  taste: defineTable({
    userId: v.id("users"),
    gen: v.number(), // the newest round of checks; older rounds stop
    busy: v.boolean(), // Supermemory is still processing a note
    learned: v.array(v.string()),
    memories: v.array(v.object({ id: v.string(), text: v.string(), noteId: v.string(), related: v.array(v.string()) })),
    at: v.number(),
  }).index("by_user", ["userId"]),

  // queued, held, publishing and live rows reserve a slot at `slotAt`.
  posts: defineTable({
    userId: v.id("users"),
    videoId: v.id("videos"),
    platform,
    status: v.union(
      v.literal("queued"), v.literal("held"), v.literal("publishing"), v.literal("live"),
      v.literal("failed"), v.literal("dry_run"), v.literal("skipped"),
    ),
    mode: postingMode,
    providerId: v.optional(v.string()),
    url: v.optional(v.string()),
    views: v.number(),
    viewsAt: v.optional(v.number()), // the last time Zernio gave a count. Unset means the platform hasn't counted yet.
    slotAt: v.number(),
    liveAt: v.optional(v.number()),
    checks: v.number(),
    error: v.optional(v.string()),
    // Set by rewards.settleDemo: the outcome was entered with the demo control, not reported by a platform.
    demo: v.optional(v.boolean()),
  })
    .index("by_user_platform_slot", ["userId", "platform", "slotAt"])
    .index("by_video", ["videoId"])
    .index("by_provider", ["providerId"])
    .index("by_status_slot", ["status", "slotAt"]),

  // Every outside call, for the under-the-hood page.
  calls: defineTable({
    userId: v.optional(v.id("users")),
    videoId: v.optional(v.id("videos")),
    service: v.string(),
    op: v.string(),
    status: v.union(v.literal("ok"), v.literal("error"), v.literal("skipped")),
    ms: v.number(),
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_user_at", ["userId", "at"])
    .index("by_user_service_at", ["userId", "service", "at"]),

  workers: defineTable({
    name: v.string(),
    lastSeen: v.number(),
    current: v.optional(v.string()),
  }).index("by_name", ["name"]),

  // A raid has three stars that light on their own and a checklist of real setup steps.
  raids: defineTable({
    userId: v.id("users"),
    kind: v.literal("shop"),
    status: v.union(v.literal("setting_up"), v.literal("live"), v.literal("failed")),
    test: v.boolean(), // Whop sandbox: test card, no real money
    goalCents: v.number(),
    netCents: v.number(),
    sales: v.number(),
    stars: v.array(v.boolean()),
    steps: v.array(v.object({ key: v.string(), label: v.string(), state: v.union(v.literal("todo"), v.literal("done"), v.literal("error")), note: v.optional(v.string()) })),
    offerId: v.optional(v.id("offers")),
    watchUntil: v.number(), // poll Whop for payments until then
    pollGen: v.number(),
    firstSaleAt: v.optional(v.number()),
    startedAt: v.number(),
  }).index("by_user", ["userId"]),

  offers: defineTable({
    userId: v.id("users"),
    raidId: v.id("raids"),
    title: v.string(),
    priceCents: v.number(),
    whopProductId: v.optional(v.string()),
    checkoutId: v.optional(v.string()),
    purchaseUrl: v.optional(v.string()),
  }).index("by_checkout", ["checkoutId"]).index("by_product", ["whopProductId"]),

  ledger: defineTable({
    userId: v.id("users"),
    raidId: v.optional(v.id("raids")),
    offerId: v.optional(v.id("offers")),
    source: v.literal("whop"),
    externalId: v.string(), // pay_...
    grossCents: v.number(),
    netCents: v.number(),
    test: v.boolean(),
    via: v.union(v.literal("webhook"), v.literal("poll")),
    at: v.number(),
  }).index("by_external", ["externalId"]).index("by_user", ["userId"]),

  // Server-only values made at runtime, such as the Whop webhook signing secret. No public function reads this.
  kv: defineTable({ key: v.string(), value: v.string() }).index("by_key", ["key"]),

  // Paid bounties: Whop Bounties API rows, or read-only Content Rewards campaigns.
  bounties: defineTable({
    source: v.union(v.literal("whop_bounty"), v.literal("content_rewards")),
    externalId: v.string(), // bnty_... or the Content Rewards campaign id
    title: v.string(),
    brand: v.string(),
    description: v.string(),
    goalType: v.string(), // business_goal_type, or the Content Rewards category
    mode: v.union(v.literal("original"), v.literal("clip")),
    rewardKind: v.union(v.literal("per_submission"), v.literal("per_view")),
    rewardCents: v.optional(v.number()), // per accepted submission, net
    ratePer1kCents: v.optional(v.number()), // per 1K views
    minViews: v.optional(v.number()),
    maxPerClipCents: v.optional(v.number()),
    budgetCents: v.optional(v.number()),
    paidOutCents: v.optional(v.number()),
    spotsRemaining: v.optional(v.number()),
    rules: v.string(),
    checklist: v.optional(v.any()),
    sourceUrls: v.array(v.string()),
    url: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    syncedAt: v.number(),
    // The generation brief: the studio writes it with claude -p; seeded bounties carry a hand-written one.
    brief: v.optional(v.any()),
  }).index("by_source_external", ["source", "externalId"]).index("by_status", ["status"]),

  userBounties: defineTable({
    userId: v.id("users"),
    bountyId: v.id("bounties"),
    status: v.union(v.literal("active"), v.literal("dropped")),
    takenAt: v.number(),
  }).index("by_user", ["userId"]).index("by_user_bounty", ["userId", "bountyId"]),

  submissions: defineTable({
    userId: v.id("users"),
    bountyId: v.id("bounties"),
    videoId: v.id("videos"),
    postId: v.id("posts"),
    url: v.string(),
    externalId: v.optional(v.string()), // btys_...
    status: v.union(
      v.literal("pending"), v.literal("submitted"), v.literal("approved"),
      v.literal("denied"), v.literal("manual"), v.literal("failed"),
    ),
    denialReason: v.optional(v.string()),
    error: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    checks: v.number(),
    // Set by rewards.settleDemo: the review result was entered with the demo control, not reported by Whop.
    demo: v.optional(v.boolean()),
  }).index("by_post", ["postId"]).index("by_status", ["status"]).index("by_user", ["userId"]),

  // Server-only. No public function may return a token. A seam for real Whop accounts; unused in v1.
  whopAuth: defineTable({
    userId: v.id("users"),
    whopUserId: v.string(),
    username: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
  }).index("by_user", ["userId"]).index("by_whop_user", ["whopUserId"]),

  oauthStates: defineTable({ state: v.string(), userId: v.id("users"), at: v.number() }).index("by_state", ["state"]),

  // Texts to and from the user over iMessage. Unused in v1.
  messages: defineTable({
    userId: v.id("users"),
    direction: v.union(v.literal("out"), v.literal("in")),
    kind: v.string(),
    body: v.string(),
    providerId: v.optional(v.string()),
    at: v.number(),
  }).index("by_user_at", ["userId", "at"]),

  // Source footage for clip bounties, downloaded once on the laptop studio. `localKey` names the laptop file.
  sources: defineTable({
    bountyId: v.id("bounties"),
    url: v.string(),
    kind: v.union(v.literal("youtube"), v.literal("drive"), v.literal("direct"), v.literal("other")),
    status: v.union(
      v.literal("pending"), v.literal("downloading"), v.literal("ready"), v.literal("blocked"), v.literal("failed"),
    ),
    durationS: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    localKey: v.optional(v.string()),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_bounty", ["bountyId"]).index("by_status", ["status"]),
});
