import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, FlatList } from 'react-native';
import { Text, Modal, Portal, Searchbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  Country,
  cleanPhoneNumber,
  splitPhoneNumber,
} from '../utils/phoneNumber';

interface Props {
  label: string;
  value: string; // full normalized number, e.g. "972505278310"
  onChangeNumber: (fullNumber: string) => void;
  theme: any;
  helperText?: string;
  placeholder?: string;
  // Called when the user leaves the field, with the normalized full number.
  // Used by the contact form to run a "contact already exists?" check (like web).
  onBlurNormalized?: (fullNumber: string) => void;
}

/**
 * WhatsApp-style phone input: a country selector (flag + dial code with "+")
 * next to the local number field. Emits the full normalized number (no "+",
 * trunk "0" stripped, country code applied) — matching the web behaviour.
 */
export default function PhoneNumberInput({
  label,
  value,
  onChangeNumber,
  theme,
  helperText,
  placeholder,
  onBlurNormalized,
}: Props) {
  const { t, i18n } = useTranslation();
  const isHe = i18n.language !== 'en';

  const initial = useMemo(() => splitPhoneNumber(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<Country>(initial.country || DEFAULT_COUNTRY);
  const [local, setLocal] = useState<string>(initial.local || '');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [search, setSearch] = useState('');

  // Track what we last emitted so external value changes (e.g. loading an
  // existing contact) re-sync the fields without fighting user input.
  const lastEmitted = useRef<string>(value || '');

  useEffect(() => {
    if ((value || '') !== lastEmitted.current) {
      const split = splitPhoneNumber(value);
      setCountry(split.country || DEFAULT_COUNTRY);
      setLocal(split.local || '');
      lastEmitted.current = value || '';
    }
  }, [value]);

  const emit = (nextLocal: string, nextCountry: Country) => {
    const full = cleanPhoneNumber(nextLocal, nextCountry.dial);
    lastEmitted.current = full;
    onChangeNumber(full);
  };

  const handleLocalChange = (text: string) => {
    const digits = text.replace(/[^\d]/g, '');
    setLocal(digits);
    emit(digits, country);
  };

  // On blur, normalize immediately and SHOW the cleaned number to the user (e.g. the leading
  // trunk "0" is removed once the country code applies), so what gets saved is visible.
  const handleLocalBlur = () => {
    const full = cleanPhoneNumber(local, country.dial);
    const split = splitPhoneNumber(full);
    setCountry(split.country || country);
    setLocal(split.local);
    lastEmitted.current = full;
    onChangeNumber(full);
    onBlurNormalized?.(full);
  };

  const handleSelectCountry = (c: Country) => {
    setCountry(c);
    setPickerVisible(false);
    setSearch('');
    emit(local, c);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nameHe.includes(q) ||
        c.dial.includes(q.replace(/\D/g, '')),
    );
  }, [search]);

  return (
    <View>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}>
        {label}
      </Text>

      {/* Phone numbers are always LTR */}
      <View style={[styles.row, { borderColor: theme.colors.outline, backgroundColor: theme.custom.inputBackground }]}>
        <Pressable
          onPress={() => setPickerVisible(true)}
          style={[styles.countryBtn, { borderRightColor: theme.colors.outline }]}
        >
          <Text style={styles.flag}>{country.flag}</Text>
          <Text style={{ color: theme.colors.onSurface, fontSize: 15, fontWeight: '600' }}>
            +{country.dial}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={theme.colors.onSurfaceVariant} />
        </Pressable>

        <TextInput
          value={local}
          onChangeText={handleLocalChange}
          onBlur={handleLocalBlur}
          keyboardType="phone-pad"
          placeholder={placeholder ?? (isHe ? '050-5278310' : '50-5278310')}
          placeholderTextColor={theme.custom.placeholder}
          style={[styles.input, { color: theme.colors.onSurface }]}
        />
      </View>

      {helperText ? (
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
          {helperText}
        </Text>
      ) : null}

      <Portal>
        <Modal
          visible={pickerVisible}
          onDismiss={() => { setPickerVisible(false); setSearch(''); }}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.surface }]}
        >
          <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '700', marginBottom: 10 }}>
            {t('phoneInput.selectCountry', isHe ? 'בחר מדינה' : 'Select country')}
          </Text>
          <Searchbar
            placeholder={t('common.search', isHe ? 'חיפוש...' : 'Search...')}
            value={search}
            onChangeText={setSearch}
            style={{ backgroundColor: theme.custom.inputBackground, marginBottom: 8 }}
            inputStyle={{ fontSize: 14 }}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 380 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectCountry(item)}
                style={({ pressed }) => [
                  styles.countryRow,
                  { backgroundColor: pressed ? theme.colors.surfaceVariant : 'transparent' },
                ]}
              >
                <Text style={styles.flag}>{item.flag}</Text>
                <Text style={{ color: theme.colors.onSurface, flex: 1 }} numberOfLines={1}>
                  {isHe ? item.nameHe : item.name}
                </Text>
                <Text style={{ color: theme.colors.onSurfaceVariant }}>+{item.dial}</Text>
              </Pressable>
            )}
          />
        </Modal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Force LTR so the country code (+972) is always on the LEFT and the number reads
    // left-to-right, even when the app UI is Hebrew/RTL. Phone numbers are inherently LTR.
    direction: 'ltr',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRightWidth: 1,
  },
  flag: { fontSize: 18 },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  modal: {
    margin: 20,
    borderRadius: 16,
    padding: 16,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
});
