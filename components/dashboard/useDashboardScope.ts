import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { getDataVisibility, hasPermission, PermissionFeature } from '../../constants/permissions';
import type { DashboardScope } from '../../services/api/dashboard';

const FULL_VISIBILITY_FEATURES = ['messages', 'contacts', 'leads', 'cases', 'tasks', 'quotes', 'orders'];

export type DashEntity = 'messages' | 'contacts' | 'leads' | 'cases' | 'tasks' | 'orders' | 'quotes' | 'payments';

/** Permission feature that gates each dashboard card. */
export const ENTITY_PERMISSION: Record<DashEntity, PermissionFeature | null> = {
  messages: 'chats',
  contacts: 'contacts',
  leads: 'leads',
  cases: 'cases',
  tasks: 'tasks',
  orders: 'orders',
  quotes: 'quotes',
  payments: null, // admin only, see fetchPaymentsHeadline
};

/**
 * Same manager/employee rule as the web Dashboard: an admin, or anyone whose data visibility is "all" on
 * every entity, sees the org-wide picture; everyone else sees "my" dashboard.
 */
export function useDashboardScope() {
  const user = useAuthStore((s) => s.user);
  return useMemo(() => {
    const role = user?.SecurityRole;
    const visibility = (feature: string) => getDataVisibility(user?.DataVisibility as any, role, feature);
    const isAdminUser = !!role && role.toLowerCase().includes('admin');
    const isAdmin = isAdminUser || FULL_VISIBILITY_FEATURES.every((k) => visibility(k) === 'all');
    const uid = (user as any)?.uID || user?.userId || '';
    const can = (feature: PermissionFeature) => hasPermission(user?.Permissions, role, feature);
    const canEntity = (e: DashEntity) => {
      const f = ENTITY_PERMISSION[e];
      return f ? can(f) : isAdminUser;
    };
    const scope: DashboardScope = {
      org: user?.organization || '',
      uid,
      userName: (user as any)?.UserName || user?.fullname || user?.name,
      isAdmin,
      isAdminUser,
      visibility,
    };
    return { user, scope, can, canEntity, isAdmin, isAdminUser, org: scope.org, uid };
  }, [user]);
}
