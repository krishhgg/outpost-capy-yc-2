import { Tabs } from "expo-router/tabs";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useDevice } from "../../session";
import { TabBar } from "../../TabBar";
import { DEEP } from "../../pixel";

// Left to right the way the loop runs: Bounties (pick a campaign), Feed (swipe its videos), Base (the app opens here,
// at "/"), Earnings (what the swipes are projected to make), You. The Feed tab carries a badge with the number of
// videos waiting for a swipe.
export default function TabLayout() {
  const device = useDevice();
  const status = useQuery(api.feed.status, device ? { deviceId: device } : "skip");
  const ready = status?.studio.ready ?? 0;
  return (
    <Tabs tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: DEEP } }}>
      <Tabs.Screen name="bounties" options={{ title: "Bounties" }} />
      <Tabs.Screen name="feed" options={{ title: "Feed", tabBarBadge: ready > 0 ? ready : undefined }} />
      <Tabs.Screen name="index" options={{ title: "Base" }} />
      <Tabs.Screen name="earnings" options={{ title: "Earnings" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}
