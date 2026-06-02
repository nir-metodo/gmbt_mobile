import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
  sku: string;
  category: string;
  link: string;
  images: string[];
  customFields?: Record<string, any>;
}

export interface CatalogCustomColumn {
  id: string;
  key: string;
  label: string;
  type: string;
  showInQuote?: boolean;
  searchable?: boolean;
  options?: string[];
}

export interface CatalogFieldsConfig {
  description?: boolean;
  unitPrice?: boolean;
  sku?: boolean;
  category?: boolean;
  link?: boolean;
}

export interface CatalogData {
  catalogItems: CatalogItem[];
  catalogCustomColumns: CatalogCustomColumn[];
  catalogFieldsConfig?: CatalogFieldsConfig;
}

export const catalogApi = {
  async getAll(organization: string): Promise<CatalogData> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, {
      organization,
    });
    const raw = response.data || {};
    return {
      catalogItems: Array.isArray(raw.catalogItems) ? raw.catalogItems : [],
      catalogCustomColumns: Array.isArray(raw.catalogCustomColumns) ? raw.catalogCustomColumns : [],
      catalogFieldsConfig: raw.catalogFieldsConfig || undefined,
    };
  },

  async save(organization: string, items: CatalogItem[], customColumns: CatalogCustomColumn[]): Promise<void> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, {
      organization,
    });
    const existing = response.data || {};
    await axiosInstance.post(ENDPOINTS.SAVE_QUOTE_BRANDING, {
      organization,
      brandingData: {
        ...existing,
        catalogItems: items,
        catalogCustomColumns: customColumns,
      },
    });
  },

  async deleteItem(organization: string, itemId: string, allItems: CatalogItem[], customColumns: CatalogCustomColumn[]): Promise<CatalogItem[]> {
    const updated = allItems.filter((i) => i.id !== itemId);
    await this.save(organization, updated, customColumns);
    return updated;
  },
};
