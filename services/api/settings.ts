import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export const settingsApi = {
  async getSettings(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_SETTINGS, {
      organization,
    });
    return response.data;
  },

  async updateSettings(organization: string, settings: Record<string, any>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_SETTINGS, {
      organization,
      ...settings,
    });
    return response.data;
  },

  async getCompanyLogo(organization: string): Promise<string | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_COMPANY_LOGO, {
      organization,
    });
    return response.data?.logoUrl || null;
  },

  async getOrgDisplayName(organization: string): Promise<string> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ORG_DISPLAY_NAME, {
      organization,
    });
    return response.data?.displayName || organization;
  },
};
