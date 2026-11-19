import axiosInstance from './axiosInstance';
import { ENDPOINTS, WEB_APP_BASE_URL } from '../../constants/api';

export interface WebFormItem {
  id: string;
  title: string;
  description?: string;
  slug: string;
  status: 'published' | 'draft' | string;
}

/** URL-safe slug from a form title (supports Hebrew) — same rule as the web (`webFormSlug.js`). */
const generateFormSlug = (title: string) =>
  (title || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9א-ת-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const resolveFormSlug = (f: any): string => {
  const explicit = String(f?.slug || '').trim();
  if (explicit) return explicit;
  return generateFormSlug(f?.title || f?.name || '') || f?.id || f?.Id || '';
};

/** Public fill-in page of a published web form: `${web app}/forms/{org}/{slug}`. */
export const buildFormPublicUrl = (organization: string, form: Pick<WebFormItem, 'slug'>) =>
  organization && form.slug ? `${WEB_APP_BASE_URL}/forms/${organization}/${form.slug}` : '';

export const webFormsApi = {
  async getAll(organization: string): Promise<WebFormItem[]> {
    const res = await axiosInstance.post(ENDPOINTS.WEBFORMS_GET_ALL, { organization });
    const raw = res.data?.Data ?? res.data;
    const items: any[] = Array.isArray(raw) ? raw : [];
    return items
      .map((f) => ({
        id: f.id || f.Id || '',
        title: f.title || f.name || '',
        description: f.description || '',
        slug: resolveFormSlug(f),
        status: f.status || 'draft',
      }))
      .filter((f) => f.id);
  },
};
