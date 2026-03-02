import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { ESignatureDocument } from '../../types';

export const esignatureApi = {
  async getDocuments(organization: string): Promise<ESignatureDocument[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ESIGNATURE_DOCS, {
      organization,
    });
    const raw = response.data;
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
};
