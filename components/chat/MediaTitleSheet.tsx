import React, { useEffect, useState } from 'react';
import {
  View,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { mediaApi } from '../../services/api/media';
import type { MediaFolder } from '../../types';

const PRIMARY = '#2e6155';

export interface MediaTitleSaved {
  messageId: string;
  mediaTitle: string;
  mediaFolderId: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  organization: string;
  contactPhone: string;
  messageId: string;
  initialTitle?: string;
  initialFolderId?: string;
  placeholder?: string;
  userId?: string;
  onSaved: (u: MediaTitleSaved) => void;
}

/** Name a chat media message and/or file it under a media-library folder (with inline "new folder"). */
export function MediaTitleSheet({
  visible,
  onClose,
  organization,
  contactPhone,
  messageId,
  initialTitle = '',
  initialFolderId = '',
  placeholder,
  userId,
  onSaved,
}: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(initialTitle);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setFolderId(initialFolderId);
    setCreating(false);
    setNewFolderName('');
    setError('');
    setSaving(false);
    let cancelled = false;
    mediaApi
      .getFolders(organization)
      .then((list) => {
        if (cancelled) return;
        // Org-wide folders + folders private to this contact
        setFolders(list.filter((f: any) => f.scope !== 'contact' || f.contactPhone === contactPhone));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, organization, contactPhone, initialTitle, initialFolderId]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      let finalFolderId = folderId;
      if (creating) {
        const name = newFolderName.trim();
        if (!name) {
          setError('יש להזין שם לתיקייה');
          setSaving(false);
          return;
        }
        const res: any = await mediaApi.createFolder(organization, { name, color: '#6b7280', scope: 'organization' });
        finalFolderId = res?.message || res?.Message || '';
        if (!(res?.success ?? res?.Success) || !finalFolderId) throw new Error('create folder failed');
      }
      const ok = await mediaApi.updateMessageMedia(organization, contactPhone, messageId, title.trim(), finalFolderId || '');
      if (!ok) {
        setError('ההודעה לא נמצאה');
        setSaving(false);
        return;
      }
      onSaved({ messageId, mediaTitle: title.trim(), mediaFolderId: finalFolderId || '' });
      onClose();
    } catch {
      setError('השמירה נכשלה');
      setSaving(false);
    }
  };

  const chip = (label: string, selected: boolean, onPress: () => void, key?: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? '#d1fae5' : theme.colors.surfaceVariant, borderColor: selected ? PRIMARY : 'transparent' },
      ]}
    >
      <Text style={{ fontSize: 13, color: selected ? PRIMARY : theme.colors.onSurface, fontWeight: selected ? '700' : '500' }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable
            onPress={() => {}}
            style={[styles.sheet, { backgroundColor: theme.colors.surface, paddingBottom: insets.bottom + 16 }]}
          >
            <View style={styles.handle} />
            <Text variant="titleMedium" style={{ fontWeight: '700', color: theme.colors.onSurface, marginBottom: 12 }}>
              שם ותיקייה לקובץ
            </Text>

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>שם</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              placeholder={placeholder || 'למשל: לוגו להדפסה'}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              style={[styles.input, { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceVariant }]}
            />

            <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>תיקייה</Text>
            <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={styles.chips}>
              {chip('ללא תיקייה', !creating && folderId === '', () => { setCreating(false); setFolderId(''); }, 'none')}
              {folders.map((f) => chip(`📁 ${f.name}`, !creating && folderId === f.id, () => { setCreating(false); setFolderId(f.id); }, f.id))}
              {chip('+ תיקייה חדשה', creating, () => setCreating(true), 'new')}
            </ScrollView>
            {creating && (
              <TextInput
                value={newFolderName}
                onChangeText={setNewFolderName}
                maxLength={80}
                autoFocus
                placeholder="שם התיקייה החדשה"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[styles.input, { color: theme.colors.onSurface, backgroundColor: theme.colors.surfaceVariant, marginTop: 8 }]}
              />
            )}

            {error ? <Text style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Text style={{ color: theme.colors.onSurface }}>ביטול</Text>
              </Pressable>
              <Pressable onPress={save} disabled={saving} style={[styles.btn, { backgroundColor: PRIMARY, opacity: saving ? 0.7 : 1 }]}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>שמור</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#cbd5e1', marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4, textAlign: 'right' },
  input: { borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 15, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});

export default MediaTitleSheet;
