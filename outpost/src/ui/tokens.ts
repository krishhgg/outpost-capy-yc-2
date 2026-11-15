import { DEEP, FONT, INK, PARCH, POP, WOOD } from "../pixel";

// The design tokens every primitive reads. pixel.tsx stays the source of the core look (faces, ink, parchment, wood,
// the water and the pop spring); this file re-exports them and adds the colors, type sizes and spacing the new
// screens share, so a screen imports one place.
export { DEEP, FONT, INK, PARCH, POP, WOOD };

export const COLOR = {
  gold: "#FFC83A",
  goldPale: "#FFE88C",
  goldDeep: "#C48412",
  green: "#5BC44A",
  greenPale: "#A6EC7C",
  greenDeep: "#2F8A2C",
  // Muted on purpose: a miss is information, not an alarm. The tab bar's #E5403A stays the only bright red.
  red: "#C25B4E",
  redPale: "#F0B2A8",
  redDeep: "#8A3A32",
  slate: "#46567A",
  teal: "#2EB8A6",
  tealPale: "#BFF5EC",
  orange: "#F07A2A",
  orangePale: "#FFB070",
  orangeDeep: "#B04A10",
  violet: "#C9A8FF", // forecasts and test-only figures, as the HUD's "test" tag
  violetPale: "#E8DCFF",
  sign: "#FFD65C", // sub lines on wood and links on water
  foam: "#F5E6C8", // small print on water
  night: "#1C110B", // the HUD counters' dark bar
  white: "#FFFFFF",
} as const;

// Point sizes. Outlined titles take these as `size` and draw 1.22x larger; plain Text uses them as is.
export const TYPE = {
  hero: 64, // the one big number on a screen
  title: 34, // WoodHeader titles
  heading: 22, // section headers, card titles
  body: 17, // most text
  label: 15, // tags, captions
  tiny: 13, // the smallest tag text
} as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

// Outlines: a panel's is 3 pt, a tag's or chip's 2 pt. Nothing is rounded.
export const LINE = { panel: 3, tag: 2 } as const;

// Whole-cent money: 120 -> "$1.20", 300 -> "$3".
export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
// 1234 -> "1,234".
// A bonus multiplier with two decimals, so a small move still shows, and no trailing zero: 1.8x, 1.67x, 2.0x.
export const mult = (m: number) => `${m.toFixed(2).replace(/(\.\d)0$/, "$1")}x`;
export const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
