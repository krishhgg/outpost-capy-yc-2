/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as away from "../away.js";
import type * as bounties from "../bounties.js";
import type * as bountySeed from "../bountySeed.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as earnings from "../earnings.js";
import type * as feed from "../feed.js";
import type * as hood from "../hood.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as memory from "../memory.js";
import type * as pace from "../pace.js";
import type * as post from "../post.js";
import type * as raids from "../raids.js";
import type * as rewards from "../rewards.js";
import type * as scout from "../scout.js";
import type * as sources from "../sources.js";
import type * as studio from "../studio.js";
import type * as submit from "../submit.js";
import type * as testkit from "../testkit.js";
import type * as views from "../views.js";
import type * as whop from "../whop.js";
import type * as whopAuth from "../whopAuth.js";
import type * as you from "../you.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  away: typeof away;
  bounties: typeof bounties;
  bountySeed: typeof bountySeed;
  crons: typeof crons;
  demo: typeof demo;
  earnings: typeof earnings;
  feed: typeof feed;
  hood: typeof hood;
  http: typeof http;
  lib: typeof lib;
  memory: typeof memory;
  pace: typeof pace;
  post: typeof post;
  raids: typeof raids;
  rewards: typeof rewards;
  scout: typeof scout;
  sources: typeof sources;
  studio: typeof studio;
  submit: typeof submit;
  testkit: typeof testkit;
  views: typeof views;
  whop: typeof whop;
  whopAuth: typeof whopAuth;
  you: typeof you;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
