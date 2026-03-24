import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  notes?: string;
  createdOn?: string;
}

export const suppliersApi = {
  async getAll(organization: string): Promise<Supplier[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_SUPPLIERS, { organization });
    const raw = response.data;
    const items = raw?.suppliers || raw?.Suppliers || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async create(organization: string, supplier: Partial<Supplier>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_SUPPLIER, { organization, ...supplier });
    return response.data;
  },

  async update(organization: string, supplierId: string, supplier: Partial<Supplier>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_SUPPLIER, { organization, supplierId, ...supplier });
    return response.data;
  },

  async delete(organization: string, supplierId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_SUPPLIER, { organization, supplierId });
    return response.data;
  },
};
