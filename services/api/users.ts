import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { OrgUser } from '../../types';

export const usersApi = {
  async getAll(organization: string): Promise<OrgUser[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_USERS, {
      organization,
    });
    const raw = response.data;
    const items = raw?.Data ?? raw?.data ?? raw?.users ?? (Array.isArray(raw) ? raw : []);
    const list = Array.isArray(items) ? items : [];
    // The backend (.NET UserData) serializes in PascalCase (UserName/FullName/Email), while the app
    // reads camelCase (userName/fullname/name). Normalize both casings so every user picker
    // (leads/cases/quotes/tasks) shows names instead of blank rows.
    return list.map((u: any) => {
      const uid = u.uID || u.uid || u.userId || u.id || '';
      // Match the robust fallback the contacts picker uses (incl. email as last resort) so a user
      // with only an email still renders instead of showing a blank row.
      const displayName =
        u.userName || u.UserName || u.fullname || u.FullName || u.name || u.Name || u.email || u.Email || '';
      return {
        ...u,
        uID: uid,
        userId: u.userId || uid,
        id: u.id || uid,
        userName: displayName,
        fullname: u.fullname || u.FullName || displayName,
        name: u.name || u.Name || displayName,
        email: u.email || u.Email || '',
      } as OrgUser;
    });
  },

  async getRegularUsers(organization: string): Promise<OrgUser[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_REGULAR_USERS, {
      organization,
    });
    return response.data || [];
  },

  async create(organization: string, user: Partial<OrgUser> & { password: string }): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_USER, {
      organization,
      ...user,
    });
    return response.data;
  },

  async update(organization: string, user: Partial<OrgUser>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_USER, {
      organization,
      ...user,
    });
    return response.data;
  },

  async delete(organization: string, userId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_USER, {
      organization,
      userId,
    });
    return response.data;
  },
};
