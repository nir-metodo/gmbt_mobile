import React from 'react';
import { View, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';

export type NoteAttachment = {
  uri: string;
  name: string;
  type: string;
};

type Props = {
  attachment: NoteAttachment | null;
  onAttach: (file: NoteAttachment) => void;
  onRemove: () => void;
  primaryColor?: string;
};

export function NoteAttachmentRow({ attachment, onAttach, onRemove, primaryColor = '#25D366' }: Props) {
  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה למצלמה');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      onAttach({ uri: asset.uri, name: asset.fileName || `photo_${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' });
    }
  };

  const handleGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('הרשאה נדרשת', 'יש לאפשר גישה לגלריה');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'] as any, quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      onAttach({ uri: asset.uri, name: asset.fileName || `media_${Date.now()}.jpg`, type: asset.mimeType || 'image/jpeg' });
    }
  };

  const handleDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
    if (!result.canceled && result.assets?.[0]) {
      const doc = result.assets[0];
      onAttach({ uri: doc.uri, name: doc.name, type: doc.mimeType || 'application/octet-stream' });
    }
  };

  if (attachment) {
    const isImage = attachment.type.startsWith('image/');
    return (
      <View style={styles.previewRow}>
        {isImage ? (
          <Image source={{ uri: attachment.uri }} style={styles.previewThumb} contentFit="cover" />
        ) : (
          <View style={[styles.previewThumb, styles.fileThumb]}>
            <MaterialCommunityIcons name="file-document-outline" size={24} color="#666" />
          </View>
        )}
        <Text style={styles.previewName} numberOfLines={1}>{attachment.name}</Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <MaterialCommunityIcons name="close-circle" size={22} color="#E53935" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable style={[styles.btn, { backgroundColor: primaryColor + '18' }]} onPress={handleCamera}>
        <MaterialCommunityIcons name="camera" size={20} color={primaryColor} />
        <Text style={[styles.btnLabel, { color: primaryColor }]}>מצלמה</Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: '#7C4DFF18' }]} onPress={handleGallery}>
        <MaterialCommunityIcons name="image" size={20} color="#7C4DFF" />
        <Text style={[styles.btnLabel, { color: '#7C4DFF' }]}>גלריה</Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: '#0091EA18' }]} onPress={handleDocument}>
        <MaterialCommunityIcons name="file-upload-outline" size={20} color="#0091EA" />
        <Text style={[styles.btnLabel, { color: '#0091EA' }]}>קובץ</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  previewThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  fileThumb: {
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
  },
});
