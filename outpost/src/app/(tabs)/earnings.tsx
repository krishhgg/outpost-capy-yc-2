import { View } from "react-native";
import { Earnings } from "../../Earnings";
import { WithDevice } from "../../session";

export default function EarningsScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#07080B" }}>
      <WithDevice>{device => <Earnings device={device} />}</WithDevice>
    </View>
  );
}
