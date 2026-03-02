import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { OrgUser } from '../../types';

export const usersApi = {
  async getAll(organization: string): Promise<OrgUser[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_USERS, {
      organization,
    });
    const raw = response.data;
    const items = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
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
