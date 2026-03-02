import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Pressable,
  ScrollView,
  Image,
  Alert,
  Dimensions,
  Linking,
} from 'react-native';
import {
  Appbar,
  Surface,
  Text,
  Chip,
  FAB,
  Portal,
  Modal,
  TextInput,
  Button,
  IconButton,
  ActivityIndicator,
  Searchbar,
  Menu,
  Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { mediaApi } from '../../../../services/api/media';
import { useAppTheme } from '../../../../hooks/useAppTheme';
import { useRTL } from '../../../../hooks/useRTL';
import { useAuthStore } from '../../../../stores/authStore';
import { getDataVisibility } from '../../../../constants/permissions';
import type { MediaFolder, MediaFile } from '../../../../types';

const BRAND_COLOR = '#2e6155';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 8;
const GRID_COLUMNS = 3;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

const FOLDER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

const TYPE_FILTERS = ['all', 'image', 'video', 'audio', 'document'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  image: { icon: 'file-image', color: '#6366f1' },
  video: { icon: 'file-video', color: '#ec4899' },
  audio: { icon: 'file-music', color: '#f59e0b' },
  document: { icon: 'file-document', color: '#0ea5e9' },
};

function formatFileSize(bytes?: number): string {
  if (!bytes) return '---';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeFromMime(mimeType?: string): string {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export default function MediaScreen() {
  const theme = useAppTheme();
  const { isRTL } = useRTL();
  const { t } = useTranslation();
  const router = useRouter();

  const user = useAuthStore((s) => s.user);
  const org = user?.organization || '';

  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);
  const [fabOpen, setFabOpen] = useState(false);
  const [fileMenuVisible, setFileMenuVisible] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [foldersData, filesData] = await Promise.all([
        mediaApi.getFolders(org),
        mediaApi.getFiles(org, {
          folderId: currentFolderId || undefined,
          fileType: typeFilter !== 'all' ? typeFilter : undefined,
          userId: user?.uID || user?.userId,
          dataVisibility: getDataVisibility(
            user?.DataVisibility,
            user?.SecurityRole,
            'mediaManager'
          ),
        }),
      ]);
      setFolders(foldersData);
      setFiles(filesData);
    } catch (err) {
      console.error('Failed to fetch media:', err);
    } finally {
      setLoading(false);
    }
  }, [org, currentFolderId, typeFilter, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter((f) => f.name?.toLowerCase().includes(q));
  }, [files, searchQuery]);

  const handleUploadFile = useCallback(async (source: 'gallery' | 'document') => {
    try {
      let result: any;
      if (source === 'gallery') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'all',
          quality: 0.8,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        const fileName = asset.fileName || `media_${Date.now()}.jpg`;
        const mimeType = asset.mimeType || 'image/jpeg';

        setUploading(true);
        await mediaApi.uploadFile(org, asset.uri, fileName, mimeType, {
          folderId: currentFolderId,
          uploadedBy: user?.uID || user?.userId,
          uploadedByName: user?.fullname,
        });
      } else {
        result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (result.canceled) return;
        const asset = result.assets[0];

        setUploading(true);
        await mediaApi.uploadFile(org, asset.uri, asset.name, asset.mimeType || 'application/octet-stream', {
          folderId: currentFolderId,
          uploadedBy: user?.uID || user?.userId,
          uploadedByName: user?.fullname,
        });
      }
      await fetchData();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [org, currentFolderId, user, fetchData]);

  const handleCreateFolder = useCallback(async () => {
    if (!folderName.trim()) return;
    try {
      await mediaApi.createFolder(org, {
        name: folderName.trim(),
        color: folderColor,
      });
      setFolderModalVisible(false);
      setFolderName('');
      setFolderColor(FOLDER_COLORS[0]);
      await fetchData();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  }, [org, folderName, folderColor, fetchData]);

  const handleDeleteFile = useCallback(async (fileId: string) => {
    Alert.alert(
      t('common.confirm'),
      t('media.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await mediaApi.deleteFile(org, fileId);
              await fetchData();
            } catch (err) {
              console.error('Failed to delete file:', err);
            }
          },
        },
      ]
    );
  }, [org, fetchData, t]);

  const handleCopyLink = useCallback(async (url: string) => {
    await Clipboard.setStringAsync(url);
    Alert.alert(t('media.linkCopied'));
  }, [t]);

  const currentFolder = useMemo(() => {
    return folders.find((f) => f.id === currentFolderId);
  }, [folders, currentFolderId]);

  const visibleFolders = useMemo(() => {
    if (currentFolderId) return [];
    return folders;
  }, [folders, currentFolderId]);

  const renderFolderItem = useCallback(({ item }: { item: MediaFolder }) => (
    <Pressable
      onPress={() => setCurrentFolderId(item.id)}
      style={({ pressed }) => [
        styles.folderCard,
        { backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.surface },
      ]}
    >
      <View style={[styles.folderIcon, { backgroundColor: (item.color || FOLDER_COLORS[0]) + '20' }]}>
        <MaterialCommunityIcons name="folder" size={28} color={item.color || FOLDER_COLORS[0]} />
      </View>
      <Text variant="labelMedium" numberOfLines={1} style={{ color: theme.colors.onSurface, textAlign: 'center', marginTop: 6 }}>
        {item.name}
      </Text>
      {item.fileCount != null && (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 11 }}>
          {item.fileCount} {t('media.files')}
        </Text>
      )}
    </Pressable>
  ), [theme, t]);

  const renderGridItem = useCallback(({ item }: { item: MediaFile }) => {
    const fileInfo = FILE_ICONS[item.type] || FILE_ICONS.document;
    const isImage = item.type === 'image';

    return (
      <Pressable
        onPress={() => item.url && Linking.openURL(item.url)}
        onLongPress={() => setFileMenuVisible(item.id)}
        style={[styles.gridItem, { backgroundColor: theme.colors.surface }]}
      >
        {isImage && item.url ? (
          <Image
            source={{ uri: item.thumbnailUrl || item.url }}
            style={styles.gridImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.gridPlaceholder, { backgroundColor: fileInfo.color + '15' }]}>
            <MaterialCommunityIcons name={fileInfo.icon as any} size={32} color={fileInfo.color} />
          </View>
        )}
        <View style={styles.gridLabel}>
          <Text variant="labelSmall" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
            {item.name}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>
            {formatFileSize(item.size)}
          </Text>
        </View>

        {fileMenuVisible === item.id && (
          <View style={[styles.fileMenu, { backgroundColor: theme.colors.surface }]}>
            <Pressable style={styles.fileMenuItem} onPress={() => { handleCopyLink(item.url); setFileMenuVisible(null); }}>
              <MaterialCommunityIcons name="link" size={16} color={theme.colors.onSurface} />
              <Text variant="bodySmall" style={{ marginStart: 8, color: theme.colors.onSurface }}>{t('media.copyLink')}</Text>
            </Pressable>
            <Pressable style={styles.fileMenuItem} onPress={() => { item.url && Linking.openURL(item.url); setFileMenuVisible(null); }}>
              <MaterialCommunityIcons name="download" size={16} color={theme.colors.onSurface} />
              <Text variant="bodySmall" style={{ marginStart: 8, color: theme.colors.onSurface }}>{t('media.download')}</Text>
            </Pressable>
            <Pressable style={styles.fileMenuItem} onPress={() => { handleDeleteFile(item.id); setFileMenuVisible(null); }}>
              <MaterialCommunityIcons name="delete" size={16} color="#E63946" />
              <Text variant="bodySmall" style={{ marginStart: 8, color: '#E63946' }}>{t('common.delete')}</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  }, [theme, fileMenuVisible, handleCopyLink, handleDeleteFile, t]);

  const renderListItem = useCallback(({ item }: { item: MediaFile }) => {
    const fileInfo = FILE_ICONS[item.type] || FILE_ICONS.document;

    return (
      <Surface style={[styles.listItem, { backgroundColor: theme.colors.surface }]} elevation={1}>
        <Pressable
          onPress={() => item.url && Linking.openURL(item.url)}
          style={[styles.listItemRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
        >
          {item.type === 'image' && item.url ? (
            <Image source={{ uri: item.thumbnailUrl || item.url }} style={styles.listThumbnail} resizeMode="cover" />
          ) : (
            <View style={[styles.listIcon, { backgroundColor: fileInfo.color + '15' }]}>
              <MaterialCommunityIcons name={fileInfo.icon as any} size={24} color={fileInfo.color} />
            </View>
          )}

          <View style={[styles.listInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
            <Text variant="titleSmall" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
              {item.name}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatFileSize(item.size)}
              {item.uploadedByName ? ` · ${item.uploadedByName}` : ''}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="link" size={18} onPress={() => handleCopyLink(item.url)} />
            <IconButton icon="delete-outline" size={18} iconColor="#E63946" onPress={() => handleDeleteFile(item.id)} />
          </View>
        </Pressable>
      </Surface>
    );
  }, [theme, isRTL, handleCopyLink, handleDeleteFile]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header style={{ backgroundColor: BRAND_COLOR }} mode="center-aligned">
        <Appbar.BackAction
          onPress={() => {
            if (currentFolderId) {
              setCurrentFolderId('');
            } else {
              router.back();
            }
          }}
          color="#FFF"
        />
        <Appbar.Content
          title={currentFolder?.name || t('media.title')}
          titleStyle={styles.headerTitle}
        />
        <Appbar.Action
          icon={searchVisible ? 'close' : 'magnify'}
          color="#FFF"
          onPress={() => { setSearchVisible(!searchVisible); if (searchVisible) setSearchQuery(''); }}
        />
        <Appbar.Action
          icon={viewMode === 'grid' ? 'format-list-bulleted' : 'grid'}
          color="#FFF"
          onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
        />
      </Appbar.Header>

      {searchVisible && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.colors.surface }}>
          <Searchbar
            placeholder={t('media.searchPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
            inputStyle={{ fontSize: 14, textAlign: isRTL ? 'right' : 'left' }}
            autoFocus
          />
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.filterRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
      >
        {TYPE_FILTERS.map((f) => (
          <Chip
            key={f}
            selected={typeFilter === f}
            onPress={() => setTypeFilter(f)}
            mode="flat"
            style={[
              styles.filterChip,
              typeFilter === f && { backgroundColor: BRAND_COLOR + '20' },
            ]}
            textStyle={typeFilter === f ? { color: BRAND_COLOR, fontWeight: '600' } : undefined}
            showSelectedOverlay={false}
          >
            {f === 'all' ? t('media.allFiles') : t(`media.${f === 'image' ? 'images' : f === 'video' ? 'videos' : f}` as any)}
          </Chip>
        ))}
      </ScrollView>

      {uploading && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator size="small" color={BRAND_COLOR} />
          <Text variant="bodySmall" style={{ color: BRAND_COLOR, marginStart: 8 }}>{t('media.uploading')}</Text>
        </View>
      )}

      <FlatList
        data={[
          ...(visibleFolders.length > 0 ? [{ __type: 'folders_header' as const }] : []),
          ...visibleFolders.map((f) => ({ __type: 'folder' as const, ...f })),
          ...(filteredFiles.length > 0 ? [{ __type: 'files_header' as const }] : []),
          ...filteredFiles.map((f) => ({ __type: 'file' as const, ...f })),
        ]}
        keyExtractor={(item: any) => item.__type === 'folders_header' ? 'fh' : item.__type === 'files_header' ? 'fileh' : item.id}
        numColumns={viewMode === 'grid' ? GRID_COLUMNS : 1}
        key={viewMode}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND_COLOR]} tintColor={BRAND_COLOR} />
        }
        renderItem={({ item }: { item: any }) => {
          if (item.__type === 'folders_header') {
            return (
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="folder-outline" size={18} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginStart: 6 }}>
                  {t('media.folders')}
                </Text>
              </View>
            );
          }
          if (item.__type === 'files_header') {
            return (
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="file-outline" size={18} color={theme.colors.onSurfaceVariant} />
                <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginStart: 6 }}>
                  {t('media.files')} ({filteredFiles.length})
                </Text>
              </View>
            );
          }
          if (item.__type === 'folder') {
            return renderFolderItem({ item } as any);
          }
          if (viewMode === 'grid') {
            return renderGridItem({ item } as any);
          }
          return renderListItem({ item } as any);
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="folder-image" size={56} color={theme.colors.onSurfaceVariant + '60'} />
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12, textAlign: 'center' }}>
              {t('media.noFiles')}
            </Text>
          </View>
        }
      />

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        actions={[
          {
            icon: 'image-plus',
            label: t('media.selectFiles'),
            onPress: () => handleUploadFile('gallery'),
            color: BRAND_COLOR,
          },
          {
            icon: 'file-upload',
            label: t('media.uploadFile'),
            onPress: () => handleUploadFile('document'),
            color: BRAND_COLOR,
          },
          {
            icon: 'folder-plus',
            label: t('media.createFolder'),
            onPress: () => setFolderModalVisible(true),
            color: BRAND_COLOR,
          },
        ]}
        onStateChange={({ open }) => setFabOpen(open)}
        fabStyle={{ backgroundColor: BRAND_COLOR }}
        color="#FFF"
      />

      <Portal>
        <Modal
          visible={folderModalVisible}
          onDismiss={() => setFolderModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleLarge" style={{ color: theme.colors.onSurface, textAlign: isRTL ? 'right' : 'left', marginBottom: 16 }}>
            {t('media.createFolder')}
          </Text>

          <TextInput
            label={t('media.folderName')}
            value={folderName}
            onChangeText={setFolderName}
            mode="outlined"
            style={{ marginBottom: 16 }}
            outlineColor={BRAND_COLOR + '40'}
            activeOutlineColor={BRAND_COLOR}
            textAlign={isRTL ? 'right' : 'left'}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {FOLDER_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setFolderColor(c)}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    folderColor === c && styles.colorCircleSelected,
                  ]}
                >
                  {folderColor === c && (
                    <MaterialCommunityIcons name="check" size={16} color="#FFF" />
                  )}
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.modalFooter, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Button mode="outlined" onPress={() => setFolderModalVisible(false)} style={styles.modalBtn} textColor={theme.colors.onSurfaceVariant}>
              {t('common.cancel')}
            </Button>
            <Button mode="contained" onPress={handleCreateFolder} style={styles.modalBtn} buttonColor={BRAND_COLOR} disabled={!folderName.trim()}>
              {t('common.create')}
            </Button>
          </View>
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#FFF', fontWeight: '700', fontSize: 18 },
  searchbar: { height: 40, borderRadius: 20, elevation: 0 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterChip: { borderRadius: 20 },
  uploadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: BRAND_COLOR + '10',
  },
  listContent: { padding: 16, paddingBottom: 100 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    width: SCREEN_WIDTH - 32,
  },
  folderCard: {
    width: GRID_ITEM_SIZE,
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: GRID_GAP,
    marginEnd: GRID_GAP,
  },
  folderIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridItem: {
    width: GRID_ITEM_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: GRID_GAP,
    marginEnd: GRID_GAP,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  gridImage: {
    width: '100%',
    height: GRID_ITEM_SIZE * 0.8,
  },
  gridPlaceholder: {
    width: '100%',
    height: GRID_ITEM_SIZE * 0.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: {
    padding: 8,
  },
  fileMenu: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    padding: 8,
    elevation: 4,
  },
  fileMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  listItem: {
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  listItemRow: {
    padding: 12,
    alignItems: 'center',
  },
  listThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  listIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    width: SCREEN_WIDTH - 32,
  },
  modalContainer: {
    margin: 20,
    borderRadius: 20,
    padding: 24,
  },
  colorCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleSelected: {
    borderWidth: 3,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  modalFooter: {
    gap: 12,
    marginTop: 8,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
  },
});
