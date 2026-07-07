import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { ESignatureDocument } from '../../types';

export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  // Optional flag some orgs set to mark a template as usable for digital signature.
  // When absent we treat all templates as eligible (matches the web behavior).
  useForSignature?: boolean;
  signatureEnabled?: boolean;
}

export const esignatureApi = {
  async getDocuments(
    organizationName: string,
    dataVisibility: 'all' | 'own',
    userId: string | null
  ): Promise<ESignatureDocument[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ESIGNATURE_DOCS, {
      organizationName,
      dataVisibility,
      userId,
    });
    const raw = response.data;
    if (raw?.Success === false) return [];
    const items = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getDocumentById(
    organization: string,
    documentId: string
  ): Promise<ESignatureDocument> {
    const response = await axiosInstance.get(ENDPOINTS.GET_ESIGNATURE_DOC_BY_ID, {
      params: { organizationName: organization, documentId },
    });
    const raw = response.data;
    return raw?.Data ?? raw?.data ?? raw;
  },

  async createDocumentWithFile(formData: FormData): Promise<any> {
    const response = await axiosInstance.post(
      ENDPOINTS.CREATE_ESIGNATURE_DOC_WITH_FILE,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  async createDocument(
    organization: string,
    document: Partial<ESignatureDocument>
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_ESIGNATURE_DOC, {
      organization,
      ...document,
    });
    return response.data;
  },

  async deleteDocument(
    organization: string,
    documentId: string
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_ESIGNATURE_DOC, {
      organizationName: organization,
      documentId,
    });
    return response.data;
  },

  async sendReminder(
    organization: string,
    documentId: string
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SEND_ESIGNATURE_REMINDER, {
      organizationName: organization,
      documentId,
    });
    return response.data;
  },

  async getDocumentByToken(token: string): Promise<ESignatureDocument> {
    const response = await axiosInstance.get(ENDPOINTS.GET_ESIGNATURE_DOC, {
      params: { token },
    });
    return response.data;
  },

  async submitSignature(
    documentId: string,
    signatureData: string,
    signerName: string
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SUBMIT_SIGNATURE, {
      documentId,
      signatureData,
      signerName,
    });
    return response.data;
  },

  // List document templates available in the org. If any template is explicitly flagged for
  // signature use (useForSignature / signatureEnabled), we return only those; otherwise all
  // templates are returned — mirroring the web e-signature editor which lists every template.
  async getDocumentTemplates(organization: string): Promise<DocumentTemplate[]> {
    const response = await axiosInstance.post(ENDPOINTS.DOC_TEMPLATES_GET_ALL, { organization });
    const raw = response.data;
    const items: any[] = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    const mapped: DocumentTemplate[] = (Array.isArray(items) ? items : []).map((t) => ({
      id: t.id || t.Id || '',
      name: t.name || t.Name || t.id || '',
      description: t.description || t.Description || '',
      category: t.category || t.Category || '',
      useForSignature: t.useForSignature ?? t.UseForSignature,
      signatureEnabled: t.signatureEnabled ?? t.SignatureEnabled,
    })).filter((t) => t.id);
    const flagged = mapped.filter((t) => t.useForSignature === true || t.signatureEnabled === true);
    return flagged.length > 0 ? flagged : mapped;
  },

  // Create a signature request straight from a document template (no manual field placement —
  // the backend auto-generates default signature/name/date fields). Matches the web
  // "Send for e-signature" flow in DocumentTemplateGenerate.
  async createFromTemplate(payload: {
    organization: string;
    templateId: string;
    documentName?: string;
    language?: string;
    expiresInDays?: number;
    contactPhone?: string;
    signers?: any[];
    userId?: string;
    userName?: string;
    requiresSequentialSigning?: boolean;
  }): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ESIGNATURE_CREATE_FROM_TEMPLATE, payload);
    return response.data;
  },
};
