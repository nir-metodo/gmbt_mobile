import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable, Platform } from 'react-native';
import { Text, TextInput, FAB, Card, IconButton, Button, Chip, Menu, Portal, Modal, ActivityIndicator, Divider, Switch } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Calendar from 'expo-calendar';
import { useAuthStore } from '../../../../stores/authStore';
import { calendarApi, CalendarEvent, CalendarInfo, Connection } from '../../../../services/api/calendar';
import { useAppTheme } from '../../../../hooks/useAppTheme';

const BRAND_COLOR = '#2e6155';

function toLocalDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatTime(time: string): string {
  if (!time) return '';
  return time;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export default function CalendarScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useAppTheme();
  const { user } = useAuthStore();
  const isRTL = i18n.language === 'he';
  const textAlign = isRTL ? 'right' as const : 'left' as const;
  const isDark = theme.dark;

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter
  const [dateFilter, setDateFilter] = useState<'upcoming' | 'today' | 'week' | 'all'>('upcoming');

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formStartDate, setFormStartDate] = useState(new Date());
  const [formEndDate, setFormEndDate] = useState(new Date());
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndTime, setFormEndTime] = useState('10:00');
  const [formAllDay, setFormAllDay] = useState(false);
  const [formCalendarId, setFormCalendarId] = useState('');
  const [formConnectionId, setFormConnectionId] = useState('');
  const [formAttendees, setFormAttendees] = useState<string[]>([]);
  const [formAttendeeInput, setFormAttendeeInput] = useState('');
  const [formAddToLocalCalendar, setFormAddToLocalCalendar] = useState(true);
  const [formLinkedEntityName, setFormLinkedEntityName] = useState('');
  const [formLinkedEntityType, setFormLinkedEntityType] = useState('');
  const [formLinkedEntityId, setFormLinkedEntityId] = useState('');
  const [formReminderEnabled, setFormReminderEnabled] = useState(true);
  const [formReminderMinutes, setFormReminderMinutes] = useState(15);
  const [showReminderMenu, setShowReminderMenu] = useState(false);
  const [formShared, setFormShared] = useState(true);

  // Date pickers
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // Calendar/Connection picker
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [showConnectionMenu, setShowConnectionMenu] = useState(false);

  const org = user?.organization || '';

  const loadData = useCallback(async () => {
    if (!org) return;
    try {
      const [evts, cals, conns] = await Promise.all([
        calendarApi.getEvents(org, user?.userId),
        calendarApi.getCalendars(org),
        calendarApi.getConnections(org),
      ]);
      setEvents(evts);
      setCalendars(cals);
      setConnections(conns);
    } catch (e) {
      console.error('Calendar load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [org, user?.userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredEvents = useMemo(() => {
    const today = toLocalDateStr(new Date());
    const todayDate = new Date();
    const weekEnd = new Date(todayDate);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = toLocalDateStr(weekEnd);

    let filtered = [...events];
    if (dateFilter === 'today') {
      filtered = filtered.filter(e => e.startDate === today);
    } else if (dateFilter === 'upcoming') {
      filtered = filtered.filter(e => e.startDate >= today);
    } else if (dateFilter === 'week') {
      filtered = filtered.filter(e => e.startDate >= today && e.startDate <= weekEndStr);
    }

    filtered.sort((a, b) => {
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;
      return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
    });
    return filtered;
  }, [events, dateFilter]);

  const openCreateModal = () => {
    const now = new Date();
    setEditingEvent(null);
    setFormTitle('');
    setFormDescription('');
    setFormLocation('');
    setFormStartDate(now);
    setFormEndDate(now);
    setFormStartTime('09:00');
    setFormEndTime('10:00');
    setFormAllDay(false);
    setFormCalendarId(calendars[0]?.id || '');
    setFormConnectionId(connections[0]?.id || '');
    setFormAttendees([]);
    setFormAttendeeInput('');
    setFormAddToLocalCalendar(true);
    setFormLinkedEntityName('');
    setFormLinkedEntityType('');
    setFormLinkedEntityId('');
    setFormReminderEnabled(true);
    setFormReminderMinutes(15);
    setFormShared(true);
    setModalVisible(true);
  };

  const openEditModal = (event: CalendarEvent) => {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDescription(event.description);
    setFormLocation(event.location);
    const sd = event.startDate ? new Date(event.startDate + 'T12:00:00') : new Date();
    const ed = event.endDate ? new Date(event.endDate + 'T12:00:00') : new Date();
    setFormStartDate(isNaN(sd.getTime()) ? new Date() : sd);
    setFormEndDate(isNaN(ed.getTime()) ? new Date() : ed);
    setFormStartTime(event.startTime || '09:00');
    setFormEndTime(event.endTime || '10:00');
    setFormAllDay(event.allDay);
    setFormCalendarId(event.calendarId || calendars[0]?.id || '');
    setFormConnectionId(event.connectionId || connections[0]?.id || '');
    setFormAttendees(event.attendees || (event.attendeeEmail ? [event.attendeeEmail] : []));
    setFormAttendeeInput('');
    setFormAddToLocalCalendar(false);
    setFormLinkedEntityName(event.linkedEntityName || '');
    setFormLinkedEntityType(event.linkedEntityType || '');
    setFormLinkedEntityId(event.linkedEntityId || '');
    setFormReminderEnabled(event.reminderEnabled ?? true);
    setFormReminderMinutes(event.reminderMinutesBefore ?? 15);
    setFormShared(event.shared !== false);
    setModalVisible(true);
  };

  const addAttendee = () => {
    const email = formAttendeeInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'כתובת אימייל לא תקינה' : 'Invalid email address');
      return;
    }
    if (formAttendees.includes(email)) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'נמען כבר קיים' : 'Attendee already added');
      return;
    }
    setFormAttendees([...formAttendees, email]);
    setFormAttendeeInput('');
  };

  const removeAttendee = (email: string) => {
    setFormAttendees(formAttendees.filter(a => a !== email));
  };

  const createLocalCalendarEvent = async (eventPayload: any) => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Calendar permissions not granted');
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const writableCalendars = calendars.filter(c => c.allowsModifications);
      if (writableCalendars.length === 0) {
        console.warn('No writable calendars found');
        return;
      }

      const defaultCal = writableCalendars.find(c => c.isPrimary) || writableCalendars[0];

      const startDateTime = new Date(`${eventPayload.startDate}T${eventPayload.startTime || '00:00'}`);
      const endDateTime = new Date(`${eventPayload.endDate}T${eventPayload.endTime || '23:59'}`);

      await Calendar.createEventAsync(defaultCal.id, {
        title: eventPayload.title,
        startDate: startDateTime,
        endDate: endDateTime,
        location: eventPayload.location || '',
        notes: eventPayload.description || '',
        allDay: eventPayload.allDay || false,
        alarms: eventPayload.reminderEnabled
          ? [{ relativeOffset: -(eventPayload.reminderMinutesBefore || 15) }]
          : [],
      });
    } catch (err) {
      console.warn('Failed to create local calendar event:', err);
    }
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', isRTL ? 'שם האירוע חובה' : 'Event title is required');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        title: formTitle.trim(),
        description: formDescription.trim(),
        location: formLocation.trim(),
        startDate: toLocalDateStr(formStartDate),
        startTime: formAllDay ? '' : formStartTime,
        endDate: toLocalDateStr(formEndDate),
        endTime: formAllDay ? '' : formEndTime,
        allDay: formAllDay,
        calendarId: formCalendarId,
        connectionId: formConnectionId,
        attendees: formAttendees,
        attendeeEmail: formAttendees[0] || '',
        linkedEntityType: formLinkedEntityType,
        linkedEntityId: formLinkedEntityId,
        linkedEntityName: formLinkedEntityName,
        reminderEnabled: formReminderEnabled,
        reminderMinutesBefore: formReminderMinutes,
        pushReminderEnabled: formReminderEnabled,
        shared: formShared,
      };

      if (editingEvent) {
        await calendarApi.updateEvent(org, editingEvent.id, payload);
      } else {
        await calendarApi.createEvent(org, user?.userId || '', payload);

        if (formAddToLocalCalendar) {
          await createLocalCalendarEvent(payload);
        }
      }
      setModalVisible(false);
      loadData();
    } catch (e: any) {
      Alert.alert(isRTL ? 'שגיאה' : 'Error', e?.message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (event: CalendarEvent) => {
    Alert.alert(
      isRTL ? 'מחיקת אירוע' : 'Delete Event',
      isRTL ? `למחוק את "${event.title}"?` : `Delete "${event.title}"?`,
      [
        { text: isRTL ? 'ביטול' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'מחק' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await calendarApi.deleteEvent(org, event.id);
              loadData();
            } catch (e: any) {
              Alert.alert(isRTL ? 'שגיאה' : 'Error', e?.message || 'Failed');
            }
          },
        },
      ]
    );
  };

  const getCalendarName = (calId: string) => calendars.find(c => c.id === calId)?.name || '';
  const getConnectionLabel = (connId: string) => {
    const c = connections.find(cn => cn.id === connId);
    return c ? `${c.provider === 'google' ? 'Google' : 'Microsoft'} — ${c.email}` : '';
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outlineVariant }]}>
        <IconButton icon="arrow-right" onPress={() => router.back()} iconColor={theme.colors.onSurface} />
        <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>{isRTL ? 'יומן אירועים' : 'Calendar Events'}</Text>
        <IconButton icon="refresh" onPress={() => { setRefreshing(true); loadData(); }} iconColor={theme.colors.onSurface} />
      </View>

      {/* Filters */}
      <View style={[styles.filterRow, { backgroundColor: theme.colors.surface }]}>
        {(['upcoming', 'today', 'week', 'all'] as const).map(f => (
          <Chip
            key={f}
            selected={dateFilter === f}
            onPress={() => setDateFilter(f)}
            style={[{ backgroundColor: isDark ? theme.colors.surfaceVariant : '#f3f4f6' }, dateFilter === f && styles.filterChipActive]}
            textStyle={[{ fontSize: 12, color: theme.colors.onSurfaceVariant }, dateFilter === f && styles.filterChipTextActive]}
          >
            {f === 'upcoming' ? (isRTL ? 'קרובים' : 'Upcoming') :
             f === 'today' ? (isRTL ? 'היום' : 'Today') :
             f === 'week' ? (isRTL ? 'השבוע' : 'This Week') :
             (isRTL ? 'הכול' : 'All')}
          </Chip>
        ))}
      </View>

      {/* Events list */}
      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 80 }}>
        {filteredEvents.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={48} color={theme.colors.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>{isRTL ? 'אין אירועים' : 'No events'}</Text>
          </View>
        )}
        {filteredEvents.map(event => (
          <Card key={event.id} style={[styles.eventCard, { backgroundColor: theme.custom.cardBackground }]} onPress={() => openEditModal(event)}>
            <Card.Content>
              <View style={styles.eventHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, { color: theme.colors.onSurface }]}>{event.title}</Text>
                  <Text style={[styles.eventDate, { color: theme.colors.onSurfaceVariant }]}>
                    {formatDisplayDate(event.startDate)} {formatTime(event.startTime)}
                    {event.endTime ? ` - ${formatTime(event.endTime)}` : ''}
                  </Text>
                </View>
                <IconButton icon="delete-outline" size={20} iconColor="#ef4444" onPress={() => handleDelete(event)} />
              </View>
              {event.location ? (
                <View style={styles.eventDetail}>
                  <MaterialCommunityIcons name="map-marker-outline" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text style={[styles.eventDetailText, { color: theme.colors.onSurfaceVariant }]}>{event.location}</Text>
                </View>
              ) : null}
              {event.linkedEntityName ? (
                <View style={styles.eventDetail}>
                  <MaterialCommunityIcons name="link-variant" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text style={[styles.eventDetailText, { color: theme.colors.onSurfaceVariant }]}>{event.linkedEntityName}</Text>
                </View>
              ) : null}
              {event.attendeeEmail ? (
                <View style={styles.eventDetail}>
                  <MaterialCommunityIcons name="account-outline" size={14} color={theme.colors.onSurfaceVariant} />
                  <Text style={[styles.eventDetailText, { color: theme.colors.onSurfaceVariant }]}>{event.attendeeEmail}</Text>
                </View>
              ) : null}
            </Card.Content>
          </Card>
        ))}
      </ScrollView>

      {/* FAB */}
      <FAB icon="plus" style={styles.fab} onPress={openCreateModal} color="white" />

      {/* Create/Edit Modal */}
      <Portal>
        <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}>
          <ScrollView>
            <Text style={[styles.modalTitle, { color: theme.colors.onSurface }]}>
              {editingEvent ? (isRTL ? 'עריכת אירוע' : 'Edit Event') : (isRTL ? 'אירוע חדש' : 'New Event')}
            </Text>

            <TextInput
              label={isRTL ? 'כותרת *' : 'Title *'}
              value={formTitle}
              onChangeText={setFormTitle}
              mode="outlined"
              style={[styles.formInput, { textAlign, backgroundColor: theme.colors.surface }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
            />

            {/* Calendar picker */}
            {calendars.length > 0 && (
              <Menu
                visible={showCalendarMenu}
                onDismiss={() => setShowCalendarMenu(false)}
                anchor={
                  <Pressable onPress={() => setShowCalendarMenu(true)}>
                    <View pointerEvents="none">
                      <TextInput
                        label={isRTL ? 'יומן' : 'Calendar'}
                        value={getCalendarName(formCalendarId) || (isRTL ? 'יומן ראשי' : 'Main Calendar')}
                        mode="outlined"
                        editable={false}
                        style={[styles.formInput, { textAlign }]}
                        outlineColor={theme.colors.outline}
                        activeOutlineColor={BRAND_COLOR}
                        right={<TextInput.Icon icon="chevron-down" />}
                      />
                    </View>
                  </Pressable>
                }
              >
                {calendars.map(cal => (
                  <Menu.Item
                    key={cal.id}
                    title={cal.name}
                    onPress={() => { setFormCalendarId(cal.id); setShowCalendarMenu(false); }}
                  />
                ))}
              </Menu>
            )}

            {/* Connection picker */}
            {connections.length > 0 && (
              <Menu
                visible={showConnectionMenu}
                onDismiss={() => setShowConnectionMenu(false)}
                anchor={
                  <Pressable onPress={() => setShowConnectionMenu(true)}>
                    <View pointerEvents="none">
                      <TextInput
                        label={isRTL ? 'חיבור (Google / Microsoft)' : 'Connection (Google / Microsoft)'}
                        value={getConnectionLabel(formConnectionId) || (isRTL ? '-- ללא חיבור --' : '-- No connection --')}
                        mode="outlined"
                        editable={false}
                        style={[styles.formInput, { textAlign }]}
                        outlineColor={theme.colors.outline}
                        activeOutlineColor={BRAND_COLOR}
                        right={<TextInput.Icon icon="chevron-down" />}
                      />
                    </View>
                  </Pressable>
                }
              >
                <Menu.Item
                  title={isRTL ? '-- ללא חיבור --' : '-- No connection --'}
                  onPress={() => { setFormConnectionId(''); setShowConnectionMenu(false); }}
                />
                {connections.map(conn => (
                  <Menu.Item
                    key={conn.id}
                    title={`${conn.provider === 'google' ? 'Google' : 'Microsoft'} — ${conn.email}`}
                    onPress={() => { setFormConnectionId(conn.id); setShowConnectionMenu(false); }}
                  />
                ))}
              </Menu>
            )}

            {/* Start Date */}
            <Pressable onPress={() => setShowStartDatePicker(true)}>
              <View pointerEvents="none">
                <TextInput
                  label={isRTL ? 'תאריך התחלה' : 'Start Date'}
                  value={formatDisplayDate(toLocalDateStr(formStartDate))}
                  mode="outlined"
                  editable={false}
                  style={[styles.formInput, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  right={<TextInput.Icon icon="calendar" onPress={() => setShowStartDatePicker(true)} />}
                />
              </View>
            </Pressable>

            {/* Start Time */}
            {!formAllDay && (
              <Pressable onPress={() => setShowStartTimePicker(true)}>
                <View pointerEvents="none">
                  <TextInput
                    label={isRTL ? 'שעת התחלה' : 'Start Time'}
                    value={formStartTime}
                    mode="outlined"
                    editable={false}
                    style={[styles.formInput, { textAlign }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={BRAND_COLOR}
                    right={<TextInput.Icon icon="clock-outline" onPress={() => setShowStartTimePicker(true)} />}
                  />
                </View>
              </Pressable>
            )}

            {/* End Date */}
            <Pressable onPress={() => setShowEndDatePicker(true)}>
              <View pointerEvents="none">
                <TextInput
                  label={isRTL ? 'תאריך סיום' : 'End Date'}
                  value={formatDisplayDate(toLocalDateStr(formEndDate))}
                  mode="outlined"
                  editable={false}
                  style={[styles.formInput, { textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  right={<TextInput.Icon icon="calendar" onPress={() => setShowEndDatePicker(true)} />}
                />
              </View>
            </Pressable>

            {/* End Time */}
            {!formAllDay && (
              <Pressable onPress={() => setShowEndTimePicker(true)}>
                <View pointerEvents="none">
                  <TextInput
                    label={isRTL ? 'שעת סיום' : 'End Time'}
                    value={formEndTime}
                    mode="outlined"
                    editable={false}
                    style={[styles.formInput, { textAlign }]}
                    outlineColor={theme.colors.outline}
                    activeOutlineColor={BRAND_COLOR}
                    right={<TextInput.Icon icon="clock-outline" onPress={() => setShowEndTimePicker(true)} />}
                  />
                </View>
              </Pressable>
            )}

            {/* All Day toggle */}
            <Pressable onPress={() => setFormAllDay(!formAllDay)} style={styles.allDayRow}>
              <MaterialCommunityIcons
                name={formAllDay ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={24}
                color={BRAND_COLOR}
              />
              <Text style={[styles.allDayText, { color: theme.colors.onSurface }]}>{isRTL ? 'יום שלם' : 'All Day'}</Text>
            </Pressable>

            {/* Location */}
            <TextInput
              label={isRTL ? 'מיקום' : 'Location'}
              value={formLocation}
              onChangeText={setFormLocation}
              mode="outlined"
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              left={<TextInput.Icon icon="map-marker-outline" />}
            />

            {/* Attendees (multiple) */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.colors.onSurface, fontWeight: '600', marginBottom: 6, textAlign }}>
                {isRTL ? 'נמענים / משתתפים' : 'Attendees'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput
                  label={isRTL ? 'אימייל נמען' : 'Attendee email'}
                  value={formAttendeeInput}
                  onChangeText={setFormAttendeeInput}
                  mode="outlined"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.formInput, { flex: 1, marginBottom: 0, textAlign }]}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND_COLOR}
                  left={<TextInput.Icon icon="email-outline" />}
                  onSubmitEditing={addAttendee}
                />
                <IconButton icon="plus-circle" iconColor={BRAND_COLOR} size={28} onPress={addAttendee} />
              </View>
              {formAttendees.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {formAttendees.map((email) => (
                    <Chip
                      key={email}
                      onClose={() => removeAttendee(email)}
                      style={{ backgroundColor: theme.colors.surfaceVariant }}
                      textStyle={{ fontSize: 12, color: theme.colors.onSurface }}
                    >
                      {email}
                    </Chip>
                  ))}
                </View>
              )}
            </View>

            {/* Add to local device calendar */}
            {!editingEvent && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 }}>
                <Text style={{ color: theme.colors.onSurface, fontSize: 14 }}>
                  {isRTL ? 'הוסף ליומן המכשיר' : 'Add to device calendar'}
                </Text>
                <Switch
                  value={formAddToLocalCalendar}
                  onValueChange={setFormAddToLocalCalendar}
                  color={BRAND_COLOR}
                />
              </View>
            )}

            {/* Linked Entity */}
            <TextInput
              label={isRTL ? 'שייך ל' : 'Related To'}
              value={formLinkedEntityName}
              onChangeText={setFormLinkedEntityName}
              mode="outlined"
              style={[styles.formInput, { textAlign }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
              left={<TextInput.Icon icon="link-variant" />}
            />

            {/* Description */}
            <TextInput
              label={isRTL ? 'תיאור' : 'Description'}
              value={formDescription}
              onChangeText={setFormDescription}
              mode="outlined"
              multiline
              numberOfLines={3}
              style={[styles.formInput, { textAlign, minHeight: 80 }]}
              outlineColor={theme.colors.outline}
              activeOutlineColor={BRAND_COLOR}
            />

            {/* Shared with the calendar's team (only when the selected calendar is shared) */}
            {(() => {
              const selCal = calendars.find(c => c.id === formCalendarId);
              const calShared = !!selCal && (selCal.isShared || (Array.isArray(selCal.sharedWithUserIds) && selCal.sharedWithUserIds.length > 0));
              if (!calShared) return null;
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 }}>
                  <Text style={{ color: theme.colors.onSurface, fontSize: 14, flex: 1 }}>
                    {isRTL ? 'משותף עם צוות היומן' : 'Shared with calendar team'}
                  </Text>
                  <Switch value={formShared} onValueChange={setFormShared} color={BRAND_COLOR} />
                </View>
              );
            })()}

            {/* Reminder */}
            <View style={styles.reminderSection}>
              <Pressable onPress={() => setFormReminderEnabled(!formReminderEnabled)} style={styles.allDayRow}>
                <MaterialCommunityIcons
                  name={formReminderEnabled ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={BRAND_COLOR}
                />
                <Text style={styles.allDayText}>{isRTL ? 'תזכורת' : 'Reminder'}</Text>
              </Pressable>
              {formReminderEnabled && (
                <Menu
                  visible={showReminderMenu}
                  onDismiss={() => setShowReminderMenu(false)}
                  anchor={
                    <Pressable onPress={() => setShowReminderMenu(true)}>
                      <Chip icon="bell-outline" style={styles.reminderChip} textStyle={{ fontSize: 13 }}>
                        {formReminderMinutes < 60
                          ? (isRTL ? `${formReminderMinutes} דקות לפני` : `${formReminderMinutes} min before`)
                          : formReminderMinutes < 1440
                            ? (isRTL ? `${formReminderMinutes / 60} שעות לפני` : `${formReminderMinutes / 60}h before`)
                            : (isRTL ? 'יום לפני' : '1 day before')}
                      </Chip>
                    </Pressable>
                  }
                >
                  {[5, 10, 15, 30, 60, 120, 1440].map(mins => (
                    <Menu.Item
                      key={mins}
                      title={mins < 60
                        ? (isRTL ? `${mins} דקות לפני` : `${mins} min before`)
                        : mins < 1440
                          ? (isRTL ? `${mins / 60} שעות לפני` : `${mins / 60}h before`)
                          : (isRTL ? 'יום לפני' : '1 day before')}
                      onPress={() => { setFormReminderMinutes(mins); setShowReminderMenu(false); }}
                    />
                  ))}
                </Menu>
              )}
            </View>

            {/* Action buttons */}
            <View style={styles.modalActions}>
              <Button
                mode="contained"
                onPress={handleSave}
                loading={saving}
                disabled={saving}
                buttonColor={BRAND_COLOR}
                textColor="white"
                style={styles.saveBtn}
              >
                {editingEvent ? (isRTL ? 'עדכן' : 'Update') : (isRTL ? 'צור אירוע' : 'Create Event')}
              </Button>
              <Button
                mode="outlined"
                onPress={() => setModalVisible(false)}
                textColor="#6b7280"
                style={styles.cancelBtn}
              >
                {isRTL ? 'ביטול' : 'Cancel'}
              </Button>
              {editingEvent && (
                <Button
                  mode="text"
                  onPress={() => { setModalVisible(false); handleDelete(editingEvent); }}
                  textColor="#ef4444"
                  icon="delete-outline"
                >
                  {isRTL ? 'מחק' : 'Delete'}
                </Button>
              )}
            </View>
          </ScrollView>

          {/* Date/Time Pickers */}
          {showStartDatePicker && (
            <DateTimePicker
              value={formStartDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                setShowStartDatePicker(false);
                if (date) {
                  setFormStartDate(date);
                  if (date > formEndDate) setFormEndDate(date);
                }
              }}
            />
          )}
          {showStartTimePicker && (
            <DateTimePicker
              value={(() => { const [h, m] = formStartTime.split(':'); const d = new Date(); d.setHours(parseInt(h) || 9, parseInt(m) || 0); return d; })()}
              mode="time"
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                setShowStartTimePicker(false);
                if (date) {
                  const h = date.getHours().toString().padStart(2, '0');
                  const m = date.getMinutes().toString().padStart(2, '0');
                  setFormStartTime(`${h}:${m}`);
                }
              }}
            />
          )}
          {showEndDatePicker && (
            <DateTimePicker
              value={formEndDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={formStartDate}
              onChange={(_, date) => {
                setShowEndDatePicker(false);
                if (date) setFormEndDate(date);
              }}
            />
          )}
          {showEndTimePicker && (
            <DateTimePicker
              value={(() => { const [h, m] = formEndTime.split(':'); const d = new Date(); d.setHours(parseInt(h) || 10, parseInt(m) || 0); return d; })()}
              mode="time"
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                setShowEndTimePicker(false);
                if (date) {
                  const h = date.getHours().toString().padStart(2, '0');
                  const m = date.getMinutes().toString().padStart(2, '0');
                  setFormEndTime(`${h}:${m}`);
                }
              }}
            />
          )}
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChipActive: { backgroundColor: BRAND_COLOR },
  filterChipTextActive: { color: 'white' },
  list: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 15, marginTop: 12 },
  eventCard: { marginBottom: 10, borderRadius: 12, elevation: 1 },
  eventHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  eventTitle: { fontSize: 16, fontWeight: '600' },
  eventDate: { fontSize: 13, marginTop: 2 },
  eventDetail: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  eventDetailText: { fontSize: 12 },
  fab: { position: 'absolute', bottom: 24, right: 24, backgroundColor: BRAND_COLOR, borderRadius: 28 },
  modal: {
    margin: 16,
    borderRadius: 16,
    padding: 20,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  formInput: { marginBottom: 12 },
  allDayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  allDayText: { fontSize: 14 },
  reminderSection: { marginBottom: 12 },
  reminderChip: { alignSelf: 'flex-start', marginLeft: 32, backgroundColor: '#0f766e20' },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  saveBtn: { borderRadius: 8 },
  cancelBtn: { borderRadius: 8 },
});
