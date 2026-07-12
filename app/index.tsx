import { Redirect } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getEffectiveLandingRoute } from '../constants/permissions';

export default function Index() {
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const defaultScreen = useSettingsStore((s) => s.defaultScreen);
  const settingsInitialized = useSettingsStore((s) => s.settingsInitialized);

  if (!isInitialized) return null;

  if (user) {
    // Wait until the persisted default-screen preference is loaded so the first launch lands
    // on the chosen screen instead of momentarily falling back to the default.
    if (!settingsInitialized) return null;
    // Honor the user's preferred default screen (Settings), falling back to the first screen
    // they're permitted to see.
    const route = getEffectiveLandingRoute(user.Permissions, user.SecurityRole, defaultScreen);
    return <Redirect href={route as any} />;
  }

  return <Redirect href="/(auth)/login" />;
}
