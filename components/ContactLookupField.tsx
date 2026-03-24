import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, TextInput, Divider } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import type { Contact } from '../types';

interface Props {
  contactSearch: string;
  contactResults: Contact[];
  contactSearching: boolean;
  selectedContact: Contact | null;
  brandColor: string;
  onSearch: (text: string) => void;
  onSelect: (contact: Contact) => void;
  onClear: () => void;
}

export default function ContactLookupField({
  contactSearch,
  contactResults,
  contactSearching,
  selectedContact,
  brandColor,
  onSearch,
  onSelect,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { textAlign } = useRTL();

  if (selectedContact) {
    return (
      <TouchableOpacity
        onPress={onClear}
        style={[styles.selectedContact, { backgroundColor: brandColor + '15', borderColor: brandColor + '40' }]}
      >
        <View style={[styles.avatar, { backgroundColor: brandColor }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
            {(selectedContact.fullName || selectedContact.name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
            {selectedContact.fullName || selectedContact.name}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {selectedContact.phoneNumber || selectedContact.phone}
          </Text>
        </View>
        <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        label={t('common.searchContact')}
        value={contactSearch}
        onChangeText={onSearch}
        mode="outlined"
        style={[styles.input, { textAlign }]}
        activeOutlineColor={brandColor}
        left={<TextInput.Icon icon="account-search-outline" />}
        right={contactSearching ? <TextInput.Icon icon="loading" /> : undefined}
      />
      {contactResults.length > 0 && (
        <View style={[styles.dropdown, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
          {contactResults.map((c, i) => (
            <React.Fragment key={c.id || c.phoneNumber || i}>
              {i > 0 && <Divider />}
              <TouchableOpacity style={styles.row} onPress={() => onSelect(c)}>
                <View style={[styles.rowAvatar, { backgroundColor: brandColor + '20' }]}>
                  <Text style={{ color: brandColor, fontWeight: '700', fontSize: 13 }}>
                    {(c.fullName || c.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                    {c.fullName || c.name}
                  </Text>
                  <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {c.phoneNumber || c.phone}
                  </Text>
                </View>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 10 },
  input: { marginBottom: 12 },
  dropdown: {
    borderRadius: 10,
    borderWidth: 1,
    marginTop: -8,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  rowAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  selectedContact: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
    gap: 10,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
