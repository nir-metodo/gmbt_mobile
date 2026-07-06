import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface CalendarEvent {
  id: string;
  calendarId: string;
  connectionId: string;
  title: string;
  description: string;
  startDate: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  color: string;
  source: string;
  userId: string;
  organization: string;
  attendeeEmail: string;
  attendees?: string[];
  linkedEntityType: string;
  linkedEntityId: string;
  linkedEntityName: string;
  reminderEnabled: boolean;
  reminderMinutesBefore: number;
  pushReminderEnabled?: boolean;
  shared?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  type: string;
  color: string;
  connectionId: string;
  isShared: boolean;
  sharedWithUserIds?: string[];
  isDefault?: boolean;
}

export interface Connection {
  id: string;
  provider: string;
  status: string;
  email: string;
  name: string;
}

function normalizeConnection(raw: any): Connection {
  return {
    id: raw.Id || raw.id || '',
    provider: (raw.provider || raw.Provider || raw.type || raw.connectionType || '').toLowerCase(),
    status: (raw.status || raw.Status || '').toLowerCase(),
    email: raw.Profile?.email || raw.profile?.email || raw.email || raw.Email || '',
    name: raw.connectionName || raw.ConnectionName || raw.Name || raw.name || '',
  };
}

function normalizeEvent(raw: any): CalendarEvent {
  return {
    id: raw.id || raw.Id || '',
    calendarId: raw.calendarId || raw.CalendarId || '',
    connectionId: raw.connectionId || raw.ConnectionId || '',
    title: raw.title || raw.Title || '',
    description: raw.description || raw.Description || '',
    startDate: raw.startDate || raw.StartDate || '',
    startTime: raw.startTime || raw.StartTime || '',
    endDate: raw.endDate || raw.EndDate || '',
    endTime: raw.endTime || raw.EndTime || '',
    allDay: raw.allDay || raw.AllDay || false,
    location: raw.location || raw.Location || '',
    color: raw.color || raw.Color || 'green',
    source: raw.source || raw.Source || 'internal',
    userId: raw.userId || raw.UserId || '',
    organization: raw.organization || raw.Organization || '',
    attendeeEmail: raw.attendeeEmail || raw.AttendeeEmail || '',
    attendees: raw.attendees || raw.Attendees || [],
    linkedEntityType: raw.linkedEntityType || raw.LinkedEntityType || '',
    linkedEntityId: raw.linkedEntityId || raw.LinkedEntityId || '',
    linkedEntityName: raw.linkedEntityName || raw.LinkedEntityName || '',
    reminderEnabled: raw.reminderEnabled ?? raw.ReminderEnabled ?? false,
    reminderMinutesBefore: raw.reminderMinutesBefore ?? raw.ReminderMinutesBefore ?? 15,
    pushReminderEnabled: raw.pushReminderEnabled ?? raw.PushReminderEnabled ?? false,
    shared: (raw.shared ?? raw.Shared) !== false, // legacy events (no field) default to shared
    createdAt: raw.createdAt || raw.CreatedAt || '',
    updatedAt: raw.updatedAt || raw.UpdatedAt || '',
  };
}

export const calendarApi = {
  async getEvents(organization: string, userId?: string): Promise<CalendarEvent[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALENDAR_EVENTS, {
      organization,
      userId,
    });
    const data = response.data;
    const events = Array.isArray(data) ? data : (data?.events || data?.Events || []);
    return events.map(normalizeEvent);
  },

  async createEvent(organization: string, userId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_CALENDAR_EVENT, {
      organization,
      userId,
      ...event,
    });
    return normalizeEvent(response.data);
  },

  async updateEvent(organization: string, eventId: string, event: Partial<CalendarEvent>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CALENDAR_EVENT, {
      organization,
      id: eventId,
      ...event,
    });
    return response.data;
  },

  async deleteEvent(organization: string, eventId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_CALENDAR_EVENT, {
      organization,
      id: eventId,
    });
    return response.data;
  },

  async getCalendars(organization: string): Promise<CalendarInfo[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALENDARS, { organization });
    const data = response.data;
    const calendars = Array.isArray(data) ? data : (data?.calendars || data?.Calendars || []);
    return calendars.map((c: any) => ({
      id: c.id || c.Id || '',
      name: c.name || c.Name || '',
      type: c.type || c.Type || 'internal',
      color: c.color || c.Color || '#10b981',
      connectionId: c.connectionId || c.ConnectionId || '',
      isShared: c.isShared || c.IsShared || false,
      sharedWithUserIds: c.sharedWithUserIds || c.SharedWithUserIds || [],
      isDefault: c.isDefault || c.IsDefault || false,
    }));
  },

  async getConnections(organization: string): Promise<Connection[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONNECTIONS, { organization });
    const data = response.data;
    const connections = data?.connections || data?.Connections || (Array.isArray(data) ? data : []);
    return connections
      .map(normalizeConnection)
      .filter((c: Connection) =>
        (c.provider === 'google' || c.provider === 'microsoft') &&
        (c.status === 'connected' || c.status === 'active' || !c.status)
      );
  },
};
