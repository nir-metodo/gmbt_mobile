import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import { toStr, type InsightField } from '../../utils/submissionsInsights';

export type SubmissionKind = 'form' | 'document';

export interface SubmissionRow {
  key: string;
  label: string;
  type: string;
  value: string;
}

/** One response (web-form submission, or a document-template form / signed document) in a unified shape. */
export interface SubmissionRecord {
  id: string;
  kind: SubmissionKind;
  sourceId: string;
  sourceTitle: string;
  submittedAt: string;
  name: string;
  phone: string;
  email: string;
  /** fieldKey -> answer as string (used by the analytics helpers). */
  data: Record<string, string>;
  /** Ordered, labelled answers for the detail view (decorative fields removed). */
  rows: SubmissionRow[];
  /** Signed / filled PDF (documents only). */
  pdfUrl?: string;
  signed?: boolean;
  formId?: string;
  documentId?: string;
}

export interface SubmissionSource {
  id: string;
  title: string;
  kind: SubmissionKind;
  count: number;
  fields: InsightField[];
}

export interface SubmissionsBundle {
  records: SubmissionRecord[];
  sources: SubmissionSource[];
}

// Decorative web-form field types never carry an answer.
const DECORATIVE = ['heading', 'paragraph', 'divider', 'image'];

const normalizeWebForms = (raw: any): SubmissionsBundle => {
  const forms: any[] = Array.isArray(raw?.Forms) ? raw.Forms : [];
  const subs: any[] = Array.isArray(raw?.Data) ? raw.Data : [];
  const byId: Record<string, { title: string; fields: any[] }> = {};
  forms.forEach((f) => {
    byId[f.id] = { title: f.title || '', fields: Array.isArray(f.fields) ? f.fields : [] };
  });

  const records: SubmissionRecord[] = subs.map((s) => {
    const meta = byId[s.formId];
    const rawData = s.data || {};
    const data: Record<string, string> = {};
    Object.keys(rawData).forEach((k) => {
      data[k] = toStr(rawData[k]);
    });
    let name = '';
    let phone = s.contactPhone || '';
    let email = '';
    (meta?.fields || []).forEach((f: any) => {
      const v = data[f?.id];
      if (!v) return;
      if (f.variable === 'contact.name') name = v;
      if (f.variable === 'contact.phone') phone = phone || v;
      if (f.variable === 'contact.email') email = v;
    });
    const rows: SubmissionRow[] = meta?.fields?.length
      ? meta.fields
          .filter((f: any) => f?.id && !DECORATIVE.includes(f.type) && data[f.id] !== undefined)
          .map((f: any) => ({ key: f.id, label: f.label || f.id, type: f.type || 'text', value: data[f.id] }))
      : Object.keys(data).map((k) => ({ key: k, label: k, type: 'text', value: data[k] }));
    return {
      id: s.id,
      kind: 'form',
      sourceId: s.formId,
      sourceTitle: s.formTitle || meta?.title || '',
      submittedAt: s.submittedAt || '',
      name,
      phone,
      email,
      data,
      rows,
      formId: s.formId,
    };
  });

  const counts: Record<string, number> = {};
  records.forEach((r) => {
    counts[r.sourceId] = (counts[r.sourceId] || 0) + 1;
  });
  const sources: SubmissionSource[] = forms
    .filter((f) => counts[f.id] > 0)
    .map((f) => ({
      id: f.id,
      title: f.title || f.id,
      kind: 'form' as const,
      count: counts[f.id],
      fields: (Array.isArray(f.fields) ? f.fields : [])
        .filter((fl: any) => fl?.id && !DECORATIVE.includes(fl.type))
        .map((fl: any) => ({ key: fl.id, label: fl.label || fl.id, type: fl.type || 'text', options: fl.options, ratingMax: fl.ratingMax })),
    }));
  return { records, sources };
};

const normalizeDocuments = (raw: any): SubmissionsBundle => {
  const subs: any[] = Array.isArray(raw?.Submissions) ? raw.Submissions : [];
  const tplList: any[] = Array.isArray(raw?.Templates) ? raw.Templates : [];

  const records: SubmissionRecord[] = subs.map((s) => {
    const fd = s.fieldData || {};
    const data: Record<string, string> = {};
    Object.keys(fd).forEach((k) => {
      data[k] = toStr(fd[k]);
    });
    const fields: any[] = Array.isArray(s.fields) ? s.fields : [];
    const seen = new Set<string>();
    const rows: SubmissionRow[] = fields.map((f) => {
      seen.add(f.key);
      return { key: f.key, label: f.label || f.key, type: f.type || 'text', value: data[f.key] ?? '' };
    });
    Object.keys(data).forEach((k) => {
      if (!seen.has(k)) rows.push({ key: k, label: k, type: 'text', value: data[k] });
    });
    return {
      id: s.submissionId,
      kind: 'document',
      sourceId: s.templateId || '',
      sourceTitle: s.templateName || '',
      submittedAt: s.submittedAt || '',
      name: s.signerName || '',
      phone: s.signerPhone || '',
      email: s.signerEmail || '',
      data,
      rows,
      pdfUrl: s.filledPdfUrl || undefined,
      signed: s.kind === 'signature',
      documentId: s.documentId,
    };
  });

  const fieldsByTemplate: Record<string, InsightField[]> = {};
  subs.forEach((s) => {
    const tId = s.templateId || '';
    const list = fieldsByTemplate[tId] || (fieldsByTemplate[tId] = []);
    (Array.isArray(s.fields) ? s.fields : []).forEach((f: any) => {
      if (f?.key && !list.some((x) => x.key === f.key)) list.push({ key: f.key, label: f.label || f.key, type: f.type || 'text' });
    });
  });

  const sources: SubmissionSource[] = tplList.map((t) => ({
    id: t.templateId || '',
    title: t.templateName || '',
    kind: 'document' as const,
    count: Number(t.count) || 0,
    fields: fieldsByTemplate[t.templateId || ''] || [],
  }));
  return { records, sources };
};

export const submissionsApi = {
  async getWebFormSubmissions(organization: string): Promise<SubmissionsBundle> {
    const res = await axiosInstance.post(ENDPOINTS.WEBFORMS_GET_SUBMISSIONS, { organization });
    return normalizeWebForms(res.data);
  },

  async getDocumentSubmissions(organization: string): Promise<SubmissionsBundle> {
    const res = await axiosInstance.post(ENDPOINTS.DOC_TEMPLATES_GET_SUBMISSIONS, { organization });
    if (res.data?.Success === false) throw new Error(res.data?.Error || 'load failed');
    return normalizeDocuments(res.data);
  },

  /** Server-rendered Q&A PDF of one web-form submission; returns the file URL. */
  async getWebFormPdfUrl(organization: string, formId: string, submissionId: string): Promise<string | null> {
    const res = await axiosInstance.post(ENDPOINTS.WEBFORMS_SUBMISSION_PDF, { organization, formId, submissionId });
    return res.data?.Url || null;
  },
};
