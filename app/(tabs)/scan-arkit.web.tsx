import { Redirect } from 'expo-router';

// Web stub - redirect to coach since scan-arkit is not available on web
export default function ScanARKitWeb() {
  return <Redirect href="/(tabs)/coach" />;
}
