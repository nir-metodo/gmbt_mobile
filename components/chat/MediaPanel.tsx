import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Dimensions,
  ActivityIndicator,
  TextInput,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { Text, IconButton, Surface } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Audio, Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import axiosInstance from '../../services/api/axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import { useAppTheme } from '../../hooks/useAppTheme';
import { chatsApi } from '../../services/api/chats';
import type { Message, WabaNumberInfo } from '../../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_COLUMNS = 3;
const GRID_SPACING = 2;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - GRID_SPACING * (GRID_COLUMNS + 1)) / GRID_COLUMNS;

const PRIMARY = '#2e6155';

type TabType = 'all' | 'image' | 'video' | 'audio' | 'document';

interface MediaItem {
  id: string;
  url: string;
  name: string;
  fileType: TabType;
  createdOn: any;
  source: 'chat' | 'uploaded';
  size?: number;
  direction?: string;
}

type SortMode = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc';

interface MediaPanelProps {
  visible: boolean;
  onClose: () => void;
  contactPhone: string;
  organization: string;
  messages?: Message[];
  wabaNumbers?: WabaNumberInfo[];
}

const TAB_TYPES: TabType[] = ['all', 'image', 'video', 'audio', 'document'];

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateVal: any): string {
  if (!dateVal) return '';
  try {
    const d = dateVal._seconds ? new Date(dateVal._seconds * 1000) : new Date(dateVal);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return '';
  }
}

function detectFileType(m: any): 'image' | 'video' | 'audio' | 'document' {
  const t = (m.type || m.mediaType || m.mimeType || '').toLowerCase();
  if (t === 'image' || t.startsWith('image/')) return 'image';
  if (t === 'video' || t.startsWith('video/')) return 'video';
  if (t === 'audio' || t.startsWith('audio/')) return 'audio';
  const url = (m.gmbt_mediaUrl || m.mediaUrl || m.MediaUrl || m.media_url || '').toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|heic|bmp|svg)(\?|$)/.test(url)) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm|m4v)(\?|$)/.test(url)) return 'video';
  if (/\.(mp3|ogg|aac|wav|m4a|opus)(\?|$)/.test(url)) return 'audio';
  return 'document';
}

function getMediaUrl(m: any): string {
  return m.gmbt_mediaUrl || m.mediaUrl || m.MediaUrl || m.media_url || '';
}

export function MediaPanel({ visible, onClose, contactPhone, organization, messages = [], wabaNumbers = [] }: MediaPanelProps) {
  const theme = useAppTheme();
  const wabaNumberIds = useMemo(() => wabaNumbers.map((n) => n.PhoneNumberId || n.phoneNumberId || '').filter(Boolean), [wabaNumbers]);

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [uploadedMedia, setUploadedMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedMessages, setFetchedMessages] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [showDateFromPicker, setShowDateFromPicker] = useState(false);
  const [showDateToPicker, setShowDateToPicker] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [numberFilter, setNumberFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date_desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (messages && messages.length > 0) return;
    if (!contactPhone || !organization) return;

    const fetchChatMessages = async () => {
      try {
        const res = await axiosInstance.post(ENDPOINTS.GET_MESSAGES, {
          organizationiD: organization,
          phoneNumber: contactPhone,
        });
        const msgs = (res.data || []).filter((m: any) => m.isHistoryMediaSuccess !== false);
        setFetchedMessages(msgs);
      } catch (err) {
        console.error('Error fetching chat messages for media:', err);
      }
    };
    fetchChatMessages();
  }, [contactPhone, organization, messages, visible]);

  const effectiveMessages = messages && messages.length > 0 ? messages : fetchedMessages;

  const chatMedia = useMemo<MediaItem[]>(() => {
    if (!effectiveMessages || !effectiveMessages.length) return [];
    return effectiveMessages
      .filter((m: any) => {
        const url = getMediaUrl(m);
        if (!url) return false;
        if (m.isHistoryMediaSuccess === false) return false;
        if (numberFilter) {
          const dir = (m.direction || '').toLowerCase();
          const num = (dir === 'outbound' ? (m.from || '') : (m.to || '')).replace(/\D/g, '');
          if (num && num !== numberFilter.replace(/\D/g, '')) return false;
        }
        return true;
      })
      .map((m: any) => {
        const fileType = detectFileType(m);
        return {
          id: m.id || m.messageId || Math.random().toString(36),
          url: getMediaUrl(m),
          name: m.caption || m.fileName || (fileType === 'image' ? 'תמונה' : fileType === 'video' ? 'סרטון' : 'קובץ'),
          fileType,
          createdOn: m.createdOn || m.timestamp,
          source: 'chat' as const,
          size: m.fileSize,
          direction: (m.direction || '').toLowerCase(),
        };
      })
      .sort((a, b) => {
        const da = a.createdOn?._seconds || new Date(a.createdOn || 0).getTime() / 1000;
        const db = b.createdOn?._seconds || new Date(b.createdOn || 0).getTime() / 1000;
        return db - da;
      });
  }, [effectiveMessages, numberFilter]);

  useEffect(() => {
    if (!visible) return;
    fetchUploadedMedia();
  }, [contactPhone, organization, visible]);

  const fetchUploadedMedia = async () => {
    if (!organization || !contactPhone) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axiosInstance.post(ENDPOINTS.GET_MEDIA_FILES, {
        organization,
        contactPhone,
        limit: 200,
      });
      setUploadedMedia(
        Array.isArray(res.data)
          ? res.data.map((f: any) => ({
              id: f.id || f.Id || Math.random().toString(36),
              url: f.url || f.fileUrl || '',
              name: f.name || f.fileName || 'File',
              fileType: detectFileType(f),
              createdOn: f.createdOn || f.uploadedOn,
              source: 'uploaded' as const,
              size: f.size || f.fileSize,
            }))
          : []
      );
    } catch (err) {
      console.error('Error fetching contact media:', err);
    } finally {
      setLoading(false);
    }
  };

  const allMedia = useMemo<MediaItem[]>(() => {
    let combined = [...chatMedia, ...uploadedMedia];
    if (activeTab !== 'all') combined = combined.filter((m) => m.fileType === activeTab);
    if (dateFrom || dateTo) {
      const fromTs = dateFrom ? dateFrom.getTime() / 1000 : 0;
      const toTs = dateTo ? dateTo.getTime() / 1000 + 86400 : Infinity;
      combined = combined.filter((m) => {
        const ts = m.createdOn?._seconds || new Date(m.createdOn || 0).getTime() / 1000;
        return ts >= fromTs && ts <= toTs;
      });
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      combined = combined.filter(
        (m) =>
          (m.name || '').toLowerCase().includes(q) ||
          (m.fileType || '').toLowerCase().includes(q)
      );
    }
    combined.sort((a, b) => {
      switch (sortMode) {
        case 'date_asc': {
          const da = a.createdOn?._seconds || new Date(a.createdOn || 0).getTime() / 1000;
          const db = b.createdOn?._seconds || new Date(b.createdOn || 0).getTime() / 1000;
          return da - db;
        }
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '', 'he');
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '', 'he');
        case 'date_desc':
        default: {
          const da = a.createdOn?._seconds || new Date(a.createdOn || 0).getTime() / 1000;
          const db = b.createdOn?._seconds || new Date(b.createdOn || 0).getTime() / 1000;
          return db - da;
        }
      }
    });
    return combined;
  }, [chatMedia, uploadedMedia, activeTab, searchTerm, dateFrom, dateTo, sortMode]);

  const visualMedia = useMemo(() => allMedia.filter((m) => m.fileType === 'image' || m.fileType === 'video'), [allMedia]);
  const fileMedia = useMemo(() => allMedia.filter((m) => m.fileType === 'document' || m.fileType === 'audio'), [allMedia]);

  const previewableItems = useMemo(() => allMedia.filter((m) => m.fileType === 'image' || m.fileType === 'video'), [allMedia]);

  const previewIndex = useMemo(
    () => (previewItem ? previewableItems.findIndex((m) => m.id === previewItem.id) : -1),
    [previewItem, previewableItems]
  );

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      stopAudio();
      setPreviewItem(null);
      setActiveTab('all');
      setSearchTerm('');
      setDateFrom(null);
      setDateTo(null);
      setNumberFilter('');
      setSortMode('date_desc');
      setShowSortMenu(false);
    }
  }, [visible]);

  const stopAudio = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setPlayingAudioId(null);
  }, []);

  const playAudio = useCallback(async (item: MediaItem) => {
    if (playingAudioId === item.id) {
      await stopAudio();
      return;
    }
    await stopAudio();
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: item.url },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingAudioId(null);
            sound.unloadAsync();
            soundRef.current = null;
          }
        }
      );
      soundRef.current = sound;
      setPlayingAudioId(item.id);
    } catch (err) {
      console.error('Error playing audio:', err);
    }
  }, [playingAudioId, stopAudio]);

  const handleDocumentPress = useCallback(async (item: MediaItem) => {
    try {
      await Linking.openURL(item.url);
    } catch {
      console.error('Cannot open URL:', item.url);
    }
  }, []);

  const handleDateFromChange = (_event: DateTimePickerEvent, date?: Date) => {
    setShowDateFromPicker(false);
    if (date) setDateFrom(date);
  };

  const handleDateToChange = (_event: DateTimePickerEvent, date?: Date) => {
    setShowDateToPicker(false);
    if (date) setDateTo(date);
  };

  const tabLabels: Record<TabType, string> = {
    all: 'הכל',
    image: 'תמונות',
    video: 'סרטונים',
    audio: 'אודיו',
    document: 'מסמכים',
  };

  const tabIcons: Record<TabType, string> = {
    all: 'view-grid',
    image: 'image',
    video: 'video',
    audio: 'music',
    document: 'file-document',
  };

  const renderGridItem = useCallback(({ item }: { item: MediaItem }) => (
    <Pressable
      style={styles.gridItem}
      onPress={() => setPreviewItem(item)}
    >
      {item.fileType === 'image' ? (
        <Image
          source={{ uri: item.url }}
          style={styles.gridImage}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={[styles.gridImage, styles.videoPlaceholder]}>
          <Image
            source={{ uri: item.url }}
            style={styles.gridImage}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.playOverlay}>
            <MaterialCommunityIcons name="play-circle" size={36} color="#fff" />
          </View>
        </View>
      )}
      <View style={styles.gridDateBadge}>
        <Text style={styles.gridDateText}>{formatDate(item.createdOn)}</Text>
      </View>
    </Pressable>
  ), []);

  const renderFileItem = useCallback(({ item }: { item: MediaItem }) => {
    const isAudio = item.fileType === 'audio';
    const isPlaying = playingAudioId === item.id;

    return (
      <Surface style={[styles.fileItem, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <View style={styles.fileItemRow}>
          <View style={[styles.fileIcon, { backgroundColor: isAudio ? '#FEF3C7' : '#F1F5F9' }]}>
            <MaterialCommunityIcons
              name={isAudio ? 'music' : 'file-document-outline'}
              size={24}
              color={isAudio ? '#F59E0B' : '#64748B'}
            />
          </View>
          <View style={styles.fileInfo}>
            <Text numberOfLines={1} style={[styles.fileName, { color: theme.colors.onSurface }]}>
              {item.name}
            </Text>
            <Text style={[styles.fileMeta, { color: theme.colors.onSurfaceVariant }]}>
              {formatFileSize(item.size)}{item.size ? ' · ' : ''}{formatDate(item.createdOn)}
              {item.direction ? ` · ${item.direction === 'outbound' ? '↑' : '↓'}` : ''}
            </Text>
          </View>
          {isAudio ? (
            <IconButton
              icon={isPlaying ? 'stop' : 'play'}
              size={24}
              iconColor={PRIMARY}
              onPress={() => playAudio(item)}
            />
          ) : (
            <IconButton
              icon="download"
              size={24}
              iconColor={theme.colors.onSurfaceVariant}
              onPress={() => handleDocumentPress(item)}
            />
          )}
        </View>
        {isAudio && isPlaying && (
          <View style={styles.audioPlaying}>
            <View style={styles.audioBar} />
            <View style={[styles.audioBar, { height: 16 }]} />
            <View style={[styles.audioBar, { height: 20 }]} />
            <View style={[styles.audioBar, { height: 12 }]} />
            <View style={[styles.audioBar, { height: 18 }]} />
            <Text style={styles.audioPlayingText}>מנגן...</Text>
          </View>
        )}
      </Surface>
    );
  }, [playingAudioId, theme, playAudio, handleDocumentPress]);

  const showVisual = activeTab === 'all' || activeTab === 'image' || activeTab === 'video';
  const showFiles = activeTab === 'all' || activeTab === 'document' || activeTab === 'audio';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <IconButton
            icon="close"
            size={24}
            iconColor="#fff"
            onPress={onClose}
            style={styles.closeBtn}
          />
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>מדיה וקבצים</Text>
            <Text style={styles.headerSubtitle}>{allMedia.length} קבצים</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={[styles.tabsContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
          <FlatList
            data={TAB_TYPES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.tabsList}
            renderItem={({ item: tab }) => (
              <Pressable
                onPress={() => setActiveTab(tab)}
                style={[
                  styles.tab,
                  activeTab === tab && styles.tabActive,
                ]}
              >
                <MaterialCommunityIcons
                  name={tabIcons[tab] as any}
                  size={16}
                  color={activeTab === tab ? '#fff' : '#64748b'}
                />
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tabLabels[tab]}
                </Text>
              </Pressable>
            )}
          />
        </View>

        {/* Search & Filters */}
        <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.outline }]}>
          <View style={[styles.searchInputContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={theme.colors.onSurfaceVariant} />
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="חיפוש לפי שם קובץ..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              style={[styles.searchInput, { color: theme.colors.onSurface }]}
            />
            {searchTerm.length > 0 && (
              <Pressable onPress={() => setSearchTerm('')}>
                <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
          <View style={styles.dateFilters}>
            <Pressable
              style={[styles.dateBtn, { backgroundColor: theme.colors.surfaceVariant }]}
              onPress={() => setShowDateFromPicker(true)}
            >
              <MaterialCommunityIcons name="calendar-start" size={16} color={dateFrom ? PRIMARY : theme.colors.onSurfaceVariant} />
              <Text style={[styles.dateBtnText, { color: dateFrom ? PRIMARY : theme.colors.onSurfaceVariant }]}>
                {dateFrom ? dateFrom.toLocaleDateString('he-IL') : 'מתאריך'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dateBtn, { backgroundColor: theme.colors.surfaceVariant }]}
              onPress={() => setShowDateToPicker(true)}
            >
              <MaterialCommunityIcons name="calendar-end" size={16} color={dateTo ? PRIMARY : theme.colors.onSurfaceVariant} />
              <Text style={[styles.dateBtnText, { color: dateTo ? PRIMARY : theme.colors.onSurfaceVariant }]}>
                {dateTo ? dateTo.toLocaleDateString('he-IL') : 'עד תאריך'}
              </Text>
            </Pressable>
            {(dateFrom || dateTo) && (
              <Pressable
                style={[styles.clearDateBtn]}
                onPress={() => { setDateFrom(null); setDateTo(null); }}
              >
                <MaterialCommunityIcons name="close" size={16} color="#dc2626" />
              </Pressable>
            )}
          </View>
          {/* Number filter & Sort */}
          <View style={styles.dateFilters}>
            {wabaNumberIds.length > 1 && (
              <View style={[styles.dateBtn, { backgroundColor: numberFilter ? '#d1fae5' : theme.colors.surfaceVariant, flex: 1 }]}>
                <MaterialCommunityIcons name="phone-outline" size={14} color={numberFilter ? PRIMARY : theme.colors.onSurfaceVariant} />
                <Pressable onPress={() => setNumberFilter(numberFilter ? '' : wabaNumberIds[0])} style={{ flex: 1 }}>
                  <Text style={[styles.dateBtnText, { color: numberFilter ? PRIMARY : theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                    {numberFilter
                      ? (wabaNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === numberFilter)?.DisplayNumber
                          || wabaNumbers.find((n) => (n.PhoneNumberId || n.phoneNumberId) === numberFilter)?.displayNumber
                          || numberFilter)
                      : 'כל המספרים'}
                  </Text>
                </Pressable>
                {numberFilter ? (
                  <Pressable onPress={() => setNumberFilter('')}>
                    <MaterialCommunityIcons name="close-circle" size={14} color={PRIMARY} />
                  </Pressable>
                ) : null}
              </View>
            )}
            <Pressable
              style={[styles.dateBtn, { backgroundColor: theme.colors.surfaceVariant, flex: wabaNumberIds.length > 1 ? 0.6 : 1 }]}
              onPress={() => setShowSortMenu(!showSortMenu)}
            >
              <MaterialCommunityIcons name="sort" size={16} color={theme.colors.onSurfaceVariant} />
              <Text style={[styles.dateBtnText, { color: theme.colors.onSurfaceVariant }]}>
                {sortMode === 'date_desc' ? 'חדש→ישן' : sortMode === 'date_asc' ? 'ישן→חדש' : sortMode === 'name_asc' ? 'א→ת' : 'ת→א'}
              </Text>
            </Pressable>
          </View>
          {showSortMenu && (
            <View style={[styles.sortMenu, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline }]}>
              {([['date_desc', 'חדש → ישן'], ['date_asc', 'ישן → חדש'], ['name_asc', 'לפי שם א→ת'], ['name_desc', 'לפי שם ת→א']] as [SortMode, string][]).map(([mode, label]) => (
                <Pressable
                  key={mode}
                  onPress={() => { setSortMode(mode); setShowSortMenu(false); }}
                  style={[styles.sortMenuItem, sortMode === mode && { backgroundColor: '#d1fae5' }]}
                >
                  <Text style={{ fontSize: 13, color: sortMode === mode ? PRIMARY : theme.colors.onSurface }}>{label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {wabaNumberIds.length > 1 && numberFilter === '' && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {wabaNumbers.map((num) => {
                const id = num.PhoneNumberId || num.phoneNumberId || '';
                const display = num.DisplayNumber || num.displayNumber || num.Label || num.label || id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setNumberFilter(id)}
                    style={[styles.numberChip, { backgroundColor: theme.colors.surfaceVariant }]}
                  >
                    <Text style={{ fontSize: 11, color: theme.colors.onSurface }}>{display}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {showDateFromPicker && (
          <DateTimePicker
            value={dateFrom || new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleDateFromChange}
          />
        )}
        {showDateToPicker && (
          <DateTimePicker
            value={dateTo || new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleDateToChange}
          />
        )}

        {/* Content */}
        <View style={styles.content}>
          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={PRIMARY} />
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>טוען...</Text>
            </View>
          ) : allMedia.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="folder-open-outline" size={64} color={theme.colors.outline} />
              <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>לא נמצאה מדיה</Text>
            </View>
          ) : showVisual && !showFiles ? (
            <FlatList
              data={visualMedia}
              keyExtractor={(item) => item.id}
              numColumns={GRID_COLUMNS}
              key="grid-only"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <View style={{ width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE, margin: GRID_SPACING / 2 }}>
                  {renderGridItem({ item } as any)}
                </View>
              )}
            />
          ) : !showVisual && showFiles ? (
            <FlatList
              data={fileMedia}
              keyExtractor={(item) => item.id}
              key="list-only"
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={renderFileItem}
            />
          ) : (
            <FlatList
              data={fileMedia}
              keyExtractor={(item) => item.id}
              key="mixed"
              contentContainerStyle={{ paddingVertical: 4 }}
              ListHeaderComponent={
                visualMedia.length > 0 ? (
                  <View style={styles.gridWrapper}>
                    {Array.from({ length: Math.ceil(visualMedia.length / GRID_COLUMNS) }).map((_, rowIdx) => {
                      const rowItems = visualMedia.slice(rowIdx * GRID_COLUMNS, (rowIdx + 1) * GRID_COLUMNS);
                      return (
                        <View key={`row-${rowIdx}`} style={styles.gridRow}>
                          {rowItems.map((item) => (
                            <View key={item.id} style={{ width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE, margin: GRID_SPACING / 2 }}>
                              {renderGridItem({ item } as any)}
                            </View>
                          ))}
                        </View>
                      );
                    })}
                    {fileMedia.length > 0 && (
                      <View style={styles.sectionDivider}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant }]}>
                          מסמכים ואודיו ({fileMedia.length})
                        </Text>
                      </View>
                    )}
                  </View>
                ) : null
              }
              renderItem={renderFileItem}
            />
          )}
        </View>

        {/* Upload FAB */}
        <View style={styles.fabRow}>
          <Pressable
            style={[styles.fabBtn, { backgroundColor: '#E91E63' }]}
            onPress={async () => {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') { Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה למצלמה'); return; }
              try {
                const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
                if (!result.canceled && result.assets?.[0]) {
                  const asset = result.assets[0];
                  await chatsApi.sendMediaMessage(organization, contactPhone, { uri: asset.uri, name: asset.fileName || `photo_${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' }, '', '', '');
                  fetchUploadedMedia();
                }
              } catch {}
            }}
          >
            <MaterialCommunityIcons name="camera" size={20} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.fabBtn, { backgroundColor: '#7C4DFF' }]}
            onPress={async () => {
              const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== 'granted') { Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה לגלריה'); return; }
              try {
                const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'] as any, quality: 0.8 });
                if (!result.canceled && result.assets?.[0]) {
                  const asset = result.assets[0];
                  const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video');
                  const mime = asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
                  await chatsApi.sendMediaMessage(organization, contactPhone, { uri: asset.uri, name: asset.fileName || `media_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`, type: mime }, '', '', '');
                  fetchUploadedMedia();
                }
              } catch {}
            }}
          >
            <MaterialCommunityIcons name="image-plus" size={20} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.fabBtn, { backgroundColor: '#0091EA' }]}
            onPress={async () => {
              try {
                const DocumentPicker = require('expo-document-picker');
                const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
                if (!result.canceled && result.assets?.[0]) {
                  const doc = result.assets[0];
                  await chatsApi.sendMediaMessage(organization, contactPhone, { uri: doc.uri, name: doc.name, type: doc.mimeType || 'application/octet-stream' }, '', '', '');
                  fetchUploadedMedia();
                }
              } catch {}
            }}
          >
            <MaterialCommunityIcons name="file-upload-outline" size={20} color="#fff" />
          </Pressable>
        </View>

        {/* Image/Video Preview Modal */}
        {previewItem && (
          <Modal visible animationType="fade" transparent onRequestClose={() => setPreviewItem(null)}>
            <View style={styles.previewOverlay}>
              <View style={styles.previewHeader}>
                <IconButton
                  icon="close"
                  size={28}
                  iconColor="#fff"
                  onPress={() => setPreviewItem(null)}
                />
                {previewableItems.length > 1 && (
                  <Text style={styles.previewCounter}>
                    {previewIndex + 1} / {previewableItems.length}
                  </Text>
                )}
                <IconButton
                  icon="download"
                  size={28}
                  iconColor="#fff"
                  onPress={() => handleDocumentPress(previewItem)}
                />
              </View>

              <View style={styles.previewContent}>
                {/* Navigation buttons */}
                {previewIndex > 0 && (
                  <Pressable
                    style={[styles.navBtn, styles.navBtnLeft]}
                    onPress={() => setPreviewItem(previewableItems[previewIndex - 1])}
                  >
                    <MaterialCommunityIcons name="chevron-left" size={32} color="#fff" />
                  </Pressable>
                )}
                {previewIndex < previewableItems.length - 1 && (
                  <Pressable
                    style={[styles.navBtn, styles.navBtnRight]}
                    onPress={() => setPreviewItem(previewableItems[previewIndex + 1])}
                  >
                    <MaterialCommunityIcons name="chevron-right" size={32} color="#fff" />
                  </Pressable>
                )}

                {previewItem.fileType === 'image' ? (
                  <Image
                    source={{ uri: previewItem.url }}
                    style={styles.previewImage}
                    contentFit="contain"
                    transition={200}
                  />
                ) : (
                  <Video
                    source={{ uri: previewItem.url }}
                    style={styles.previewVideo}
                    useNativeControls
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                  />
                )}
              </View>

              <View style={styles.previewFooter}>
                <Text style={styles.previewName} numberOfLines={1}>{previewItem.name}</Text>
                <Text style={styles.previewDate}>{formatDate(previewItem.createdOn)}</Text>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  closeBtn: {
    margin: 0,
  },
  headerTextContainer: {
    flex: 1,
    marginLeft: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
  tabsContainer: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  tabsList: {
    paddingHorizontal: 12,
    gap: 6,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 5,
    backgroundColor: '#f1f5f9',
  },
  tabActive: {
    backgroundColor: PRIMARY,
  },
  tabText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  searchContainer: {
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  dateFilters: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  dateBtnText: {
    fontSize: 12,
  },
  clearDateBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 40,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
  },
  listContent: {
    padding: GRID_SPACING,
  },
  gridWrapper: {
    paddingHorizontal: GRID_SPACING / 2,
  },
  gridRow: {
    flexDirection: 'row',
  },
  gridItem: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  videoPlaceholder: {
    position: 'relative',
    backgroundColor: '#1e293b',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
  },
  gridDateBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  gridDateText: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'center',
  },
  fileItem: {
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    padding: 12,
  },
  fileItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
  },
  fileMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  audioPlaying: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginTop: 8,
    paddingLeft: 56,
  },
  audioBar: {
    width: 4,
    height: 14,
    backgroundColor: PRIMARY,
    borderRadius: 2,
    opacity: 0.7,
  },
  audioPlayingText: {
    fontSize: 11,
    color: PRIMARY,
    marginLeft: 8,
  },
  sectionDivider: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Preview styles
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 8,
  },
  previewCounter: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  previewContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.2,
  },
  previewVideo: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 0.75,
  },
  navBtn: {
    position: 'absolute',
    top: '45%',
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    padding: 4,
  },
  navBtnLeft: {
    left: 8,
  },
  navBtnRight: {
    right: 8,
  },
  previewFooter: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  previewName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  previewDate: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
  sortMenu: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  sortMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  numberChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  fabRow: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    flexDirection: 'row',
    gap: 12,
  },
  fabBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
});

export default MediaPanel;
