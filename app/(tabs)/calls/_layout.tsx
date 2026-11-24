import { Stack } from 'expo-router';

// "Calls" bottom tab (shown instead of Contacts when the organization has telephony). The screen itself is the phone-calls screen.
export default function CallsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
