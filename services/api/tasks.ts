import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Task } from '../../types';

export const tasksApi = {
  async getAll(organization: string, userId?: string, dataVisibility?: string): Promise<Task[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASKS, {
      organizationName: organization,
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
    });
    const raw = response.data;
    const items = raw?.tasks || raw?.Tasks || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getByContact(organization: string, phoneNumber: string): Promise<Task[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASKS, {
      organizationName: organization,
      phoneNumber,
    });
    const raw = response.data;
    const items = raw?.tasks || raw?.Tasks || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async create(organization: string, task: Partial<Task>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_TASK, {
      organization,
      ...task,
    });
    return response.data;
  },

  async update(organization: string, task: Partial<Task>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_TASK, {
      organization,
      ...task,
    });
    return response.data;
  },

  async complete(organization: string, taskId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.COMPLETE_TASK, {
      organization,
      taskId,
    });
    return response.data;
  },

  async delete(organization: string, taskId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_TASK, {
      organization,
      taskId,
    });
    return response.data;
  },
};
