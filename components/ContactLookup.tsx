import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Text, Avatar, IconButton } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import { useRTL } from '../hooks/useRTL';
import { contactsApi } from '../services/api/contacts';
import { getInitials } from '../utils/formatters';
import type { Contact } from '../types';

interface SelectedContact {
  id: string;
  name: string;
  phoneNumber: string;
}

interface ContactLookupProps {
  visible: boolean;
  organization: string;
  onSelect: (contact: SelectedContact) => void;
  onDismiss: () => void;
}

export default function ContactLookup({ visible, organization, onSelect, onDismiss }: ContactLookupProps) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isRTL, flexDirection, textAlign, writingDirection } = useRTL();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSearched(false);
      searchContacts('');
    }
  }, [visible]);

  const searchContacts = useCallback(
    async (term: string) => {
      if (!organization) return;
      setLoading(true);
      try {
        const data = await contactsApi.search(organization, term, 30);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    },
    [organization],
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        searchContacts(text.trim());
      }, 350);
    },
    [searchContacts],
  );

  const handleSelect = useCallback(
    (contact: Contact) => {
      onSelect({
        id: contact.id,
        name: contact.name,
        phoneNumber: contact.phoneNumber,
      });
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: { item: Contact }) => (
      <Pressable
        onPress={() => handleSelect(item)}
        style={({ pressed }) => [
          styles.contactRow,
          { flexDirection, backgroundColor: pressed ? `${theme.colors.primary}10` : 'transparent' },
        ]}
      >
        <Avatar.Text
          size={40}
          label={getInitials(item.name)}
          style={{ backgroundColor: theme.colors.primaryContainer }}
          labelStyle={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14 }}
        />
        <View style={[styles.contactInfo, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onSurface, fontWeight: '600' }}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant }}
            numberOfLines={1}
          >
            {item.phoneNumber}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={isRTL ? 'chevron-left' : 'chevron-right'}
          size={20}
          color={theme.colors.onSurfaceVariant}
          style={{ opacity: 0.4 }}
        />
      </Pressable>
    ),
    [handleSelect, theme, flexDirection, isRTL],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
        {/* Header */}
        <View style={[styles.header, { flexDirection, borderBottomColor: theme.colors.outlineVariant }]}>
          <IconButton
            icon="close"
            size={22}
            iconColor={theme.colors.onSurface}
            onPress={onDismiss}
          />
          <Text
            variant="titleMedium"
            style={{ color: theme.colors.onSurface, fontWeight: '700', flex: 1, textAlign: 'center' }}
          >
            {t('common.selectContact')}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        {/* Search input */}
        <View style={[styles.searchContainer, { backgroundColor: theme.colors.surfaceVariant }]}>
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={theme.colors.onSurfaceVariant}
            style={{ marginEnd: 8 }}
          />
          <TextInput
            value={query}
            onChangeText={handleQueryChange}
            placeholder={t('common.searchContacts')}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            style={[
              styles.searchInput,
              { color: theme.colors.onSurface, textAlign, writingDirection },
            ]}
            autoFocus
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => handleQueryChange('')}>
              <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.onSurfaceVariant} />
            </Pressable>
          )}
        </View>

        {/* Results */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : searched && results.length === 0 ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons
              name="account-search-outline"
              size={48}
              color={theme.colors.onSurfaceVariant}
              style={{ opacity: 0.4 }}
            />
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}
            >
              {t('common.noContactsFound')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id || item.phoneNumber}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
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
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 8,
    paddingBottom: 24,
  },
  contactRow: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
});
