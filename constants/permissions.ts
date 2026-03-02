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

export const hasPermission = (
  userPermissions: Record<string, boolean> | null | undefined,
  securityRole: string | undefined,
  feature: PermissionFeature
): boolean => {
  if (!securityRole) return true;
  const role = securityRole.toLowerCase();
  if (role === 'admin') return true;
  if (userPermissions && feature in userPermissions) {
    return userPermissions[feature] === true;
  }
  if (role === 'basic' || role === 'chat') {
    return BASIC_ROLE_DEFAULTS[feature] === true;
  }
  return true;
};

/** Data visibility values for phoneCalls: 'myPhoneCalls' (own) | 'allPhoneCalls' (all) */
export const PHONE_CALLS_VISIBILITY = {
  myPhoneCalls: 'own' as const,
  allPhoneCalls: 'all' as const,
} as const;

export const getDataVisibility = (
  dataVisibility: Record<string, 'all' | 'own' | 'myPhoneCalls' | 'allPhoneCalls'> | null | undefined,
  securityRole: string | undefined,
  feature: string
): 'all' | 'own' => {
  if (!securityRole) return 'all';
  if (securityRole.toLowerCase() === 'admin') return 'all';
  if (!dataVisibility) return 'all';

  const val = dataVisibility[feature];
  if (val === 'myPhoneCalls' || val === 'own') return 'own';
  if (val === 'allPhoneCalls' || val === 'all') return 'all';
  return 'all';
};
