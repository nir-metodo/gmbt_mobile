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
  // Provenance for events synced FROM an external calendar (Google/Microsoft). Empty for local events.
  sourceCalendarName?: string;
  sourceExternalCalendarId?: string;
  userId: string;
  organization: string;
  attendeeEmail: string;
  attendees?: string[];
  linkedEntityType: string;
  linkedEntityId: string;
  linkedEntityName: string;
  linkedEntities?: Array<{ type: string; id: string; name: string }>;
  recurrence?: string; // 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  recurrenceUntil?: string; // yyyy-MM-dd
  reminderEnabled: boolean;
  reminderMinutesBefore: number;
  pushReminderEnabled?: boolean;
  shared?: boolean;
  // Event status: 'confirmed' | 'tentative' | 'cancelled' (mirrors the web calendar).
  status?: string;
  // What happened with the event: '' (scheduled) | 'held' | 'no_show' | 'postponed' | 'cancelled'.
  outcome?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineItem {
  id: string;
  type: string; // created | rescheduled | outcome | status | owner | note
  text?: string;
  from?: string;
  to?: string;
  userName?: string;
  createdOn?: string;
}

// "Did the meeting happen?" outcomes (mirrors the web calendar).
export const OUTCOME_META: Record<string, { he: string; en: string; icon: string; bg: string; fg: string }> = {
  held:      { he: 'התקיימה',              en: 'Held',      icon: 'check-circle-outline', bg: '#dcfce7', fg: '#166534' },
  no_show:   { he: 'לא התקיימה (לא הגיע)', en: 'No-show',   icon: 'account-off-outline',  bg: '#fee2e2', fg: '#991b1b' },
  postponed: { he: 'נדחתה',                en: 'Postponed', icon: 'calendar-clock',       bg: '#fef3c7', fg: '#92400e' },
  cancelled: { he: 'בוטלה',                en: 'Cancelled', icon: 'close-circle-outline', bg: '#e5e7eb', fg: '#374151' },
};
export const OUTCOME_KEYS = Object.keys(OUTCOME_META);
const AWAITING_WINDOW_DAYS = 14;

// An event that already ended (over an hour ago, within the last 2 weeks) with no outcome yet is
// "awaiting update" — the card then offers one-tap Held / No-show / Postponed buttons.
export function isAwaitingOutcome(ev: Pick<CalendarEvent, 'startDate' | 'endDate' | 'endTime' | 'startTime' | 'allDay' | 'outcome' | 'status'>): boolean {
  if (ev.outcome) return false;
  if ((ev.status || '').toLowerCase() === 'cancelled') return false;
  const sd = (ev.startDate || '').split('T')[0];
  const ed = (ev.endDate || '').split('T')[0] || sd;
  if (!ed) return false;
  const time = ev.allDay ? '23:59' : (ev.endTime || ev.startTime || '23:59');
  const end = new Date(`${ed}T${time}`).getTime();
  if (Number.isNaN(end)) return false;
  const age = Date.now() - end;
  return age > 60 * 60 * 1000 && age < AWAITING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export interface CalendarInfo {
  id: string;
  name: string;
  type: string;
  color: string;
  connectionId: string;
  isShared: boolean;
  sharedWithUserIds?: string[];
  // Per-user color overrides (userId → hex), mirrors the web calendar so a shared event shows in the
  // assigned team member's color.
  userColors?: Record<string, string>;
  // External calendars linked INTO this (internal) host calendar for two-way sync. Used to resolve
  // which connection a synced external event belongs to.
  linkedExternalCalendars?: Array<{ connectionId: string; externalCalendarId: string; color?: string }>;
  isDefault?: boolean;
  // Last provider-sync failure surfaced by the backend, so the UI can warn the user (mirrors web).
  lastSyncError?: string;
}

export interface CalendarSettings {
  defaultView: string;       // 'day' | 'week' | 'month' | 'list' (mobile maps day/week → month)
  defaultDuration: number;   // minutes
  defaultCalendarId: string;
  notifyBeforeEvent: boolean;
  notifyBeforeMinutes: number;
  defaultAssignSelf: boolean; // pre-assign new events to the creator (editable in the form)
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
    sourceCalendarName: raw.sourceCalendarName || raw.SourceCalendarName || '',
    sourceExternalCalendarId: raw.sourceExternalCalendarId ?? raw.SourceExternalCalendarId ?? '',
    userId: raw.userId || raw.UserId || '',
    organization: raw.organization || raw.Organization || '',
    attendeeEmail: raw.attendeeEmail || raw.AttendeeEmail || '',
    attendees: raw.attendees || raw.Attendees || [],
    linkedEntityType: raw.linkedEntityType || raw.LinkedEntityType || '',
    linkedEntityId: raw.linkedEntityId || raw.LinkedEntityId || '',
    linkedEntityName: raw.linkedEntityName || raw.LinkedEntityName || '',
    linkedEntities: raw.linkedEntities || raw.LinkedEntities || [],
    recurrence: raw.recurrence || raw.Recurrence || 'none',
    recurrenceUntil: (raw.recurrenceUntil || raw.RecurrenceUntil || '').split('T')[0],
    reminderEnabled: raw.reminderEnabled ?? raw.ReminderEnabled ?? false,
    reminderMinutesBefore: raw.reminderMinutesBefore ?? raw.ReminderMinutesBefore ?? 15,
    pushReminderEnabled: raw.pushReminderEnabled ?? raw.PushReminderEnabled ?? false,
    shared: (raw.shared ?? raw.Shared) !== false, // legacy events (no field) default to shared
    status: (raw.status || raw.Status || 'confirmed').toString().toLowerCase(),
    outcome: (raw.outcome || raw.Outcome || '').toString().toLowerCase(),
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

  // Record what happened with an event; optional note is saved in the event's timeline.
  async setOutcome(organization: string, eventId: string, outcome: string, note: string, userName: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CALENDAR_EVENT_OUTCOME, {
      organization, id: eventId, outcome, note, userName,
    });
    return response.data;
  },

  async getTimeline(organization: string, entityType: 'event' | 'email', key: string): Promise<TimelineItem[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_ENTITY_TIMELINE, { organization, entityType, key });
    return Array.isArray(response.data) ? response.data : [];
  },

  async addTimelineNote(organization: string, entityType: 'event' | 'email', key: string, text: string, userName: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.ADD_ENTITY_TIMELINE_NOTE, { organization, entityType, key, text, userName });
    return response.data;
  },

  async deleteEvent(organization: string, eventId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_CALENDAR_EVENT, {
      organization,
      id: eventId,
    });
    return response.data;
  },

  // Mirrors the web app: non-admins pass their userId so the server returns only calendars they can
  // see (own + "all team" shared + calendars shared specifically with them). Admins omit userId and
  // get every calendar. Without this a regular user would receive the whole org's calendar list.
  async getCalendars(organization: string, userId?: string): Promise<CalendarInfo[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALENDARS, { organization, userId });
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
      userColors: c.userColors || c.UserColors || {},
      linkedExternalCalendars: Array.isArray(c.linkedExternalCalendars || c.LinkedExternalCalendars)
        ? (c.linkedExternalCalendars || c.LinkedExternalCalendars)
        : [],
      isDefault: c.isDefault || c.IsDefault || false,
      lastSyncError: c.lastSyncError || c.LastSyncError || '',
    }));
  },

  // Org/user calendar preferences (default view/duration/calendar + reminder defaults). Mirrors the
  // web app's GetCalendarSettings. Returns sensible fallbacks on any error.
  async getSettings(organization: string, userId?: string): Promise<CalendarSettings> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_CALENDAR_SETTINGS, { organization, userId });
      const s = response.data || {};
      return {
        defaultView: (s.defaultView || s.DefaultView || '').toString().toLowerCase(),
        defaultDuration: Number(s.defaultDuration ?? s.DefaultDuration ?? 60),
        defaultCalendarId: s.defaultCalendarId || s.DefaultCalendarId || '',
        notifyBeforeEvent: (s.notifyBeforeEvent ?? s.NotifyBeforeEvent) !== false,
        notifyBeforeMinutes: Number(s.notifyBeforeMinutes ?? s.NotifyBeforeMinutes ?? 15),
        defaultAssignSelf: (s.defaultAssignSelf ?? s.DefaultAssignSelf) !== false,
      };
    } catch {
      return { defaultView: '', defaultDuration: 60, defaultCalendarId: '', notifyBeforeEvent: true, notifyBeforeMinutes: 15, defaultAssignSelf: true };
    }
  },

  // Pull the latest events from a calendar's external provider (Google/Microsoft) into Gambot, so
  // externally-created events show up here — mirrors the web app's per-calendar sync button.
  async syncCalendar(organization: string, calendarId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SYNC_CALENDAR, { organization, calendarId });
    return response.data;
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
