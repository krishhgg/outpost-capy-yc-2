import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useIsFocused } from "expo-router";
import { FONT, INK, Outlined, PARCH, POP } from "./pixel";
import { click, tick } from "./click";
import { targets } from "./collect";

// The pixel icons drawn by art/icons.py.
export const ICON = {
  flame: require("../assets/ui/flame.png"),
  flame2: require("../assets/ui/flame2.png"),
  flameoff: require("../assets/ui/flameoff.png"),
  ice: require("../assets/ui/ice.png"),
  check: require("../assets/ui/check.png"),
  house: require("../assets/ui/house.png"),
  person: require("../assets/ui/person.png"),
  eye: require("../assets/ui/eye.png"),
  coin: require("../assets/ui/coin.png"),
  gear: require("../assets/ui/gear.png"),
  play: require("../assets/ui/play.png"),
  glass: require("../assets/ui/glass.png"),
  lock: require("../assets/ui/lock.png"),
  star: require("../assets/base/star-lit.png"),
};
export type IconName = keyof typeof ICON;

// A number that counts to its new value instead of jumping. The first value after loading appears as is, so opening a
// screen doesn't animate. Undefined is loading.
export function useTicker(value: number | undefined, ms = 650) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value === undefined || from.current === undefined || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    from.current = value;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

// A resource counter for the header: an icon riding the left end of a dark bar, the value in outlined type, and an
// optional tag such as "test" so a test-mode figure never passes for real money. It bumps when its value or icon
// changes, so a number that moves gets noticed. The first value after loading doesn't count as a change.
// A counter with `onPress` is a button that goes where that number comes from, the way a game's resource bar does.
export function Counter({ icon, value, tag, label, testID, onPress }:
  { icon: IconName; value: string; tag?: string; label: string; testID?: string; onPress?: () => void }) {
  const pop = useSharedValue(1);
  const last = useRef<string | null>(null);
  const key = `${icon}:${value}`;
  useEffect(() => {
    if (value === "…") return;
    if (last.current !== null && last.current !== key) {
      pop.value = withSequence(withTiming(1.3, { duration: 120 }), withSpring(1, POP));
    }
    last.current = key;
  }, [key]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const body = (pressed: boolean) => (
    <Animated.View style={[h.counter, style, pressed && h.pressed]}>
      <View style={h.bar}>
        <Outlined size={16}>{value}</Outlined>
        {tag ? <Text style={h.tag}>{tag}</Text> : null}
      </View>
      <Image source={ICON[icon]} style={h.counterIcon} ref={el => { if (testID && el) targets.set(testID, el); }} />
    </Animated.View>
  );
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={label}>{body(false)}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      onPress={() => { click(); Haptics.selectionAsync().catch(() => {}); onPress(); }}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

// A speech bubble that bobs over a building when it has something for you. Tapping it goes there. When its text
// changes, say the Studio finishing a video, it bumps with a tick like a game's collector. A change made while you're
// on another tab bumps when you come back.
export function Bubble({ icon, text, x, y, onPress, testID, label }:
  { icon: IconName; text: string; x: number; y: number; onPress: () => void; testID?: string; label: string }) {
  const bob = useSharedValue(0);
  const pop = useSharedValue(1);
  const last = useRef(text);
  const focused = useIsFocused();
  useEffect(() => {
    bob.value = withRepeat(withSequence(withTiming(-5, { duration: 650 }), withTiming(0, { duration: 650 })), -1);
  }, []);
  useEffect(() => {
    if (!focused || last.current === text) return;
    last.current = text;
    pop.value = withSequence(withTiming(1.3, { duration: 120 }), withSpring(1, POP));
    tick();
  }, [text, focused]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }, { scale: pop.value }] }));
  return (
    <Animated.View style={[h.bubbleWrap, { left: x - 60, top: y - 46 }, style]}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={10}
        onPress={() => { click(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}>
        {({ pressed }) => (
          <View style={[h.bubble, pressed && { transform: [{ scale: 0.9 }] }]}>
            <Image source={ICON[icon]} style={h.bubbleIcon} />
            <Text style={h.bubbleText}>{text}</Text>
          </View>
        )}
      </Pressable>
      <View style={h.tail} pointerEvents="none" />
    </Animated.View>
  );
}

const h = StyleSheet.create({
  counter: { height: 30, justifyContent: "center" },
  pressed: { opacity: 0.7 },
  bar: {
    marginLeft: 12, paddingLeft: 20, paddingRight: 10, height: 26, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#1C110B", borderWidth: 2, borderColor: INK,
  },
  counterIcon: { position: "absolute", left: 0, width: 28, height: 28 },
  tag: { color: "#C9A8FF", fontSize: 15, fontFamily: FONT.semi },
  bubbleWrap: { position: "absolute", width: 120, alignItems: "center" },
  bubble: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: PARCH.top, borderWidth: 3, borderColor: INK,
    borderBottomWidth: 5, paddingHorizontal: 8, paddingVertical: 4,
  },
  bubbleIcon: { width: 24, height: 24 },
  bubbleText: { color: PARCH.ink, fontSize: 20, fontFamily: FONT.bold },
  tail: { width: 10, height: 10, backgroundColor: PARCH.top, borderColor: INK, borderRightWidth: 3, borderBottomWidth: 3, transform: [{ rotate: "45deg" }], marginTop: -8 },
});
