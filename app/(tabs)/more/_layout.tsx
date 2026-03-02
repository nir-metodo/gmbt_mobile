import { Stack } from 'expo-router';

export default function MoreLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="tasks" />
      <Stack.Screen name="media" />
      <Stack.Screen name="phone-calls" />
      <Stack.Screen name="users" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="cases" />
      <Stack.Screen name="quotes" />
      <Stack.Screen name="esignature" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="dashboard" />
    </Stack>
  );
}
