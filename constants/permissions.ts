export const PERMISSION_FEATURES = {
  chats: 'chats',
  phoneCalls: 'phoneCalls',
  campaigns: 'campaigns',
  templates: 'templates',
  contacts: 'contacts',
  customTables: 'customTables',
  tasks: 'tasks',
  leads: 'leads',
  botomation: 'botomation',
  formFlows: 'formFlows',
  gambotAI: 'gambotAI',
  dashboard: 'dashboard',
  reports: 'reports',
  activityLog: 'activityLog',
  connections: 'connections',
  widget: 'widget',
  catalog: 'catalog',
  settings: 'settings',
  users: 'users',
  cases: 'cases',
  quotes: 'quotes',
  esignature: 'esignature',
  mediaManager: 'mediaManager',
  orders: 'orders',
  inventory: 'inventory',
  purchasing: 'purchasing',
  employees: 'employees',
  invoices: 'invoices',
  emailInbox: 'emailInbox',
} as const;

export type PermissionFeature = keyof typeof PERMISSION_FEATURES;

const BASIC_ROLE_DEFAULTS: Record<string, boolean> = {
  chats: true,
  contacts: true,
  leads: true,
  tasks: true,
  cases: true,
  phoneCalls: true,
};

/**
 * Case-insensitive lookup of a permission value. The backend serializes permissions from a
 * typed class whose properties are PascalCase (e.g. `Chats`, `PhoneCalls`), while our feature
 * keys are camelCase (`chats`, `phoneCalls`). Normalizing both sides to lowercase makes the
 * check correct regardless of the JSON casing the API returns.
 */
const lookupPermission = (
  userPermissions: Record<string, boolean> | null | undefined,
  feature: PermissionFeature
): boolean | undefined => {
  if (!userPermissions) return undefined;
  const target = feature.toLowerCase();
  for (const key of Object.keys(userPermissions)) {
    if (key.toLowerCase() === target) {
      const v = userPermissions[key];
      return v === true || v === ('true' as any);
    }
  }
  return undefined;
};

export const hasPermission = (
  userPermissions: Record<string, boolean> | null | undefined,
  securityRole: string | undefined,
  feature: PermissionFeature
): boolean => {
  if (!securityRole) return true;
  const role = securityRole.toLowerCase();
  if (role === 'admin') return true;
  const explicit = lookupPermission(userPermissions, feature);
  if (explicit !== undefined) {
    return explicit;
  }
  if (role === 'basic' || role === 'chat') {
    return BASIC_ROLE_DEFAULTS[feature] === true;
  }
  return true;
};

/**
 * Returns the first tab route the user is actually allowed to see, following the same order
 * as the tab bar. Used as the post-login landing route so a user without `chats` permission
 * never lands on the (hidden) chats screen.
 */
export const getLandingRoute = (
  userPermissions: Record<string, boolean> | null | undefined,
  securityRole: string | undefined
): string => {
  if (hasPermission(userPermissions, securityRole, 'chats')) return '/(tabs)/chats';
  if (hasPermission(userPermissions, securityRole, 'contacts')) return '/(tabs)/contacts';
  if (hasPermission(userPermissions, securityRole, 'leads')) return '/(tabs)/leads';
  return '/(tabs)/more';
};

/** Data visibility values for phoneCalls: 'myPhoneCalls' (own) | 'allPhoneCalls' (all) */
export const PHONE_CALLS_VISIBILITY = {
  myPhoneCalls: 'own' as const,
  allPhoneCalls: 'all' as const,
} as const;

export const getDataVisibility = (
  dataVisibility: Record<string, string> | null | undefined,
  securityRole: string | undefined,
  feature: string
): 'all' | 'own' | 'byPhone' => {
  if (!securityRole) return 'all';
  if (securityRole.toLowerCase() === 'admin') return 'all';
  if (!dataVisibility) return 'all';

  const val = dataVisibility[feature];
  if (val === 'byPhone') return 'byPhone';
  if (val === 'myPhoneCalls' || val === 'own') return 'own';
  if (val === 'allPhoneCalls' || val === 'all') return 'all';
  return 'all';
};
