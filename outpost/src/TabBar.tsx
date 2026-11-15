import { useEffect } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/tabs";
import { ICON, type IconName } from "./Hud";
import { Block, FONT, INK, Outlined, WOOD } from "./pixel";
import { click } from "./click";

const TABS: Record<string, { icon: IconName; label: string }> = {
  bounties: { icon: "coin", label: "Bounties" },
  feed: { icon: "play", label: "Feed" },
  index: { icon: "house", label: "Base" },
  earnings: { icon: "star", label: "Earnings" },
  you: { icon: "person", label: "You" },
};

// The tab bar as a wooden plank, the same wood as the headers. The tab you're on rises out of it as a gold block.
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View style={[t.bar, { paddingBottom: Math.max(insets.bottom - 10, 8) }]} testID="tab-bar">
      <View style={t.wood} pointerEvents="none">
        {[0, 1, 2, 3].map(i => <View key={i} style={[t.grain, { top: 16 + i * 22 }]} />)}
      </View>
      <View style={t.edge} pointerEvents="none" />
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = index === state.index;
        const badge = descriptors[route.key].options.tabBarBadge;
        const onPress = () => {
          click();
          Haptics.selectionAsync().catch(() => {});
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        return (
          <Tab key={route.key} {...tab} focused={focused} badge={badge} onPress={onPress}
            testID={`tab-${route.name}`} label2={`${tab.label}, tab, ${index + 1} of ${state.routes.length}`} />
        );
      })}
    </View>
  );
}

function Tab({ icon, label, label2, focused, badge, onPress, testID }:
  { icon: IconName; label: string; label2: string; focused: boolean; badge?: number | string; onPress: () => void; testID: string }) {
  const lift = useSharedValue(focused ? 1 : 0);
  useEffect(() => { lift.value = withSpring(focused ? 1 : 0, { mass: 1, damping: 11, stiffness: 220 }); }, [focused]);
  const raised = useAnimatedStyle(() => ({ transform: [{ translateY: -12 * lift.value }, { scale: 0.9 + 0.1 * lift.value }] }));
  return (
    <Pressable style={t.tab} onPress={onPress} testID={testID} accessibilityRole="tab"
      accessibilityState={{ selected: focused }} accessibilityLabel={label2}>
      <Animated.View style={[t.face, raised]}>
        {focused ? (
          <Block bevel="gold" depth={4} style={t.gold}>
            <Image source={ICON[icon]} style={t.iconBig} />
            <Outlined size={14}>{label}</Outlined>
          </Block>
        ) : (
          <View style={t.plain}>
            <Image source={ICON[icon]} style={t.icon} />
            <Text style={t.label}>{label}</Text>
          </View>
        )}
        {/* The open tab's own header already shows its count, so its badge would only crowd the buttons above it. */}
        {badge !== undefined && !focused && (
          <View style={t.badge} testID={`${testID}-badge`}>
            <Text style={t.badgeText}>{String(badge)}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const t = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: WOOD.base, paddingTop: 6, borderTopWidth: 4, borderTopColor: INK },
  wood: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  grain: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: WOOD.grain },
  edge: { position: "absolute", left: 0, right: 0, top: 0, height: 3, backgroundColor: WOOD.lip },
  tab: { flex: 1, alignItems: "center", justifyContent: "flex-start", height: 62 },
  face: { alignItems: "center" },
  gold: { width: 78, alignItems: "center", paddingTop: 5, paddingBottom: 7 },
  plain: { width: 78, alignItems: "center", paddingTop: 8 },
  iconBig: { width: 34, height: 34 },
  icon: { width: 30, height: 30, opacity: 0.9 },
  label: { color: "#E8D2A6", fontSize: 16, fontFamily: FONT.bold, marginTop: 1 },
  badge: {
    position: "absolute", top: -6, right: 4, minWidth: 24, height: 22, paddingHorizontal: 5, alignItems: "center",
    justifyContent: "center", backgroundColor: "#E5403A", borderWidth: 2, borderColor: INK,
  },
  badgeText: { color: "#fff", fontSize: 16, fontFamily: FONT.bold, lineHeight: 18 },
});
