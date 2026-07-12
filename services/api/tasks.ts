import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Task } from '../../types';

/**
 * Normalize any backend date value to a plain ISO string.
 * Task dates can arrive as an ISO string, a Firestore Timestamp object
 * ({ _seconds }/{ seconds }), an epoch number, or a "Timestamp: <iso>" prefixed
 * string. Returning a clean ISO string means every consumer (formatDueDate,
 * sorting, the leads today/upcoming buckets) can just `new Date(...)` it — the
 * previous raw pass-through is why lead-created tasks showed no due date and
 * silently broke sorting.
 */
function toIsoDate(val: any): string {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (typeof val === 'object') {
    const secs = val._seconds ?? val.seconds ?? val.Seconds;
    if (typeof secs === 'number') {
      const d = new Date(secs * 1000);
      return isNaN(d.getTime()) ? '' : d.toISOString();
    }
    return '';
  }
  if (typeof val === 'string') {
    const cleaned = val.startsWith('Timestamp: ') ? val.slice('Timestamp: '.length) : val;
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();
    // Fallback for legacy rows: the backend used to persist dueDate via a locale-formatted
    // ToString() (e.g. "7/8/2026 2:00:00 PM" or "07/08/2026 14:00:00"), which Hermes' Date
    // parser rejects (returns Invalid Date) → the list showed "no due date". Parse the common
    // M/D/YYYY[,] h:mm[:ss] [AM/PM] shape manually so those tasks still render until re-saved.
    const m = cleaned.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
    );
    if (m) {
      let [, mo, day, yr, hr, min, sec, ampm] = m;
      let h = parseInt(hr, 10);
      if (ampm) {
        const up = ampm.toUpperCase();
        if (up === 'PM' && h < 12) h += 12;
        if (up === 'AM' && h === 12) h = 0;
      }
      // These legacy strings are UTC instants (server wrote UTC via ToString), so build in UTC.
      const parsed = new Date(Date.UTC(+yr, +mo - 1, +day, h, +min, sec ? +sec : 0));
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return '';
  }
  return '';
}

/** Normalize a raw task object that may use PascalCase or camelCase field names */
function normalizeTask(raw: any): Task {
  return {
    id:               raw.id         || raw.Id         || raw.taskId    || raw.TaskId    || '',
    taskId:           raw.taskId     || raw.TaskId     || raw.id        || raw.Id        || '',
    title:            raw.title      || raw.Title      || raw.taskTitle || raw.TaskTitle || '',
    description:      raw.description  || raw.Description  || '',
    status:           (raw.status    || raw.Status     || 'open').toLowerCase(),
    priority:         (raw.priority  || raw.Priority   || 'medium').toLowerCase(),
    taskType:         raw.taskType   || raw.TaskType   || raw.type      || 'general',
    dueDate:          toIsoDate(raw.dueDate || raw.DueDate || raw.due_date),
    completedDate:    toIsoDate(raw.completedDate || raw.CompletedDate),
    createdOn:        toIsoDate(raw.createdOn || raw.CreatedOn || raw.createdAt || raw.CreatedAt),
    modifiedOn:       toIsoDate(raw.modifiedOn || raw.ModifiedOn),
    createdById:      raw.createdById    || raw.CreatedById    || '',
    createdByName:    raw.createdByName  || raw.CreatedByName  || '',
    assignedToId:     raw.assignedToId   || raw.AssignedToId   || raw.assignedTo   || '',
    assignedToName:   raw.assignedToName || raw.AssignedToName || raw.assignedToUser || '',
    modifiedById:     raw.modifiedById   || raw.ModifiedById   || '',
    modifiedByName:   raw.modifiedByName || raw.ModifiedByName || '',
    relatedTo:        raw.relatedTo      || raw.RelatedTo      || undefined,
    organization:     raw.organization   || raw.Organization   || '',
    relatedContactId: raw.relatedContactId || raw.RelatedContactId || '',
    relatedContactName: raw.relatedContactName || raw.RelatedContactName || raw.relatedEntityName || raw.RelatedEntityName || '',
    relatedContactPhone: raw.relatedContactPhone || raw.RelatedContactPhone || raw.relatedEntityPhone || raw.RelatedEntityPhone || '',
    reminderEnabled:  raw.reminderEnabled || raw.ReminderEnabled || false,
    reminderDate:     toIsoDate(raw.reminderDate || raw.ReminderDate || raw.reminderDateUTC || raw.ReminderDateUTC),
  } as Task;
}

export const tasksApi = {
  async getAll(organization: string, userId?: string, dataVisibility?: string): Promise<Task[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASKS, {
      organizationName: organization,
      userId: userId || '',
      dataVisibility: dataVisibility || 'all',
    });
    const raw = response.data;
    const items = raw?.tasks || raw?.Tasks || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items.map(normalizeTask) : [];
  },

  async getByContact(organization: string, phoneNumber: string): Promise<Task[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASKS, {
      organizationName: organization,
      phoneNumber,
    });
    const raw = response.data;
    const items = raw?.tasks || raw?.Tasks || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items.map(normalizeTask) : [];
  },

  async create(
    organization: string,
    task: Partial<Task>,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const { id, taskId, ...taskFields } = task as any;
    const response = await axiosInstance.post(ENDPOINTS.CREATE_TASK, {
      organizationName: organization,
      ...taskFields,
      user: {
        userId: userId || '',
        userName: userName || 'Gambot',
      },
    });
    return response.data;
  },

  async update(
    organization: string,
    task: Partial<Task>,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const resolvedTaskId = (task as any).taskId || (task as any).id || '';
    const { id, ...taskFields } = task as any;
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_TASK, {
      organizationName: organization,
      taskId: resolvedTaskId,
      ...taskFields,
      user: {
        userId: userId || '',
        userName: userName || 'Gambot',
      },
    });
    return response.data;
  },

  async complete(organization: string, taskId: string, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.COMPLETE_TASK, {
      organizationName: organization,
      taskId,
      user: {
        userId: userId || '',
        userName: userName || 'Gambot',
      },
    });
    return response.data;
  },

  async delete(organization: string, taskId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_TASK, {
      organizationName: organization,
      taskId,
    });
    return response.data;
  },

  async getById(organization: string, taskId: string): Promise<Task> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASK_BY_ID, {
      organization,
      taskId,
    });
    return normalizeTask(response.data);
  },

  async getActivity(organization: string, taskId: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TASK_ACTIVITY, {
      organizationName: organization,
      taskId,
    });
    const data = response.data;
    return data?.activities || data?.Activities || [];
  },

  async addComment(organization: string, taskId: string, text: string, userId: string, userName: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ADD_TASK_COMMENT, {
      organizationName: organization,
      taskId,
      text,
      user: { userId, userName },
    });
    return response.data;
  },
};
