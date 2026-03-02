import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { MediaFolder, MediaFile } from '../../types';

export const mediaApi = {
  async getFolders(organization: string): Promise<MediaFolder[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_MEDIA_FOLDERS, {
      organization,
    });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getFiles(
    organization: string,
    options?: {
      folderId?: string;
      fileType?: string;
      userId?: string;
      dataVisibility?: string;
      limit?: number;
    }
  ): Promise<MediaFile[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_MEDIA_FILES, {
      organization,
      folderId: options?.folderId || undefined,
      fileType: options?.fileType !== 'all' ? options?.fileType : undefined,
      scope: 'organization',
      limit: options?.limit || 200,
      dataVisibility: options?.dataVisibility || 'all',
      userId: options?.userId,
    });
    return Array.isArray(response.data) ? response.data : [];
  },

  async uploadFile(
    organization: string,
    fileUri: string,
    fileName: string,
    mimeType: string,
    options?: {
      folderId?: string;
      uploadedBy?: string;
      uploadedByName?: string;
    }
  ): Promise<any> {
    const formData = new FormData();
    formData.append('organization', organization);
    formData.append('folderId', options?.folderId || '');
    formData.append('scope', 'organization');
    formData.append('uploadedBy', options?.uploadedBy || '');
    formData.append('uploadedByName', options?.uploadedByName || '');
    formData.append('file', {
      uri: fileUri,
      type: mimeType,
      name: fileName,
    } as any);

    const response = await axiosInstance.post(ENDPOINTS.UPLOAD_MEDIA_FILE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async createFolder(
    organization: string,
    folder: { name: string; color: string; scope?: string }
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_MEDIA_FOLDER, {
      organization,
      ...folder,
      scope: folder.scope || 'organization',
    });
    return response.data;
  },

  async updateFolder(
    organization: string,
    folderId: string,
    updates: { name?: string; color?: string }
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_MEDIA_FOLDER, {
      organization,
      folderId,
      ...updates,
    });
    return response.data;
  },

  async deleteFile(organization: string, fileId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_MEDIA_FILE, {
      organization,
      fileId,
    });
    return response.data;
  },

  async deleteFolder(organization: string, folderId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_MEDIA_FOLDER, {
      organization,
      folderId,
    });
    return response.data;
  },
};
