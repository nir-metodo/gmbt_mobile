import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button, SegmentedButtons, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { useRTL } from '../../../hooks/useRTL';
import { DS_CONTACT_FIELD, DS_HARDCODED, EmailTemplateVariable } from '../../../services/api/emailCampaigns';
import PickerSheet from './PickerSheet';
import { BRAND } from './emailCampaignHelpers';

interface Props {
  variables: EmailTemplateVariable[];
  columns: string[];
  onChange: (next: EmailTemplateVariable[]) => void;
}

/**
 * Maps each `{{variable}}` of the chosen template to either a fixed text or a contact field.
 * Uses the same stored shape (and the data-source ids the backend actually resolves at send time) as the web mapper.
 */
export default function EmailVariableMapper({ variables, columns, onChange }: Props) {
  const theme = useAppTheme();
  const { flexDirection, textAlign } = useRTL();
  const { i18n } = useTranslation();
  const he = i18n.language !== 'en';
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const patch = (idx: number, p: Partial<EmailTemplateVariable>) =>
    onChange(variables.map((v, i) => (i === idx ? { ...v, ...p } : v)));

  if (variables.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ textAlign, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
        {he ? 'התבנית כוללת משתנים. בחרו מה יוצג בכל אחד מהם:' : 'This template has variables. Choose what each one shows:'}
      </Text>
      {variables.map((v, idx) => {
        const mode = v.dataSource === DS_HARDCODED ? 'fixed' : v.dataSource === DS_CONTACT_FIELD ? 'field' : 'none';
        return (
          <View key={`${v.variable}-${idx}`} style={[styles.card, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outline }]}>
            <Text style={{ textAlign, fontWeight: '700', color: theme.colors.onSurface }}>{`{{${v.variable}}}`}</Text>
            <SegmentedButtons
              density="small"
              value={mode}
              onValueChange={(m) =>
                patch(idx, {
                  dataSource: m === 'fixed' ? DS_HARDCODED : m === 'field' ? DS_CONTACT_FIELD : '',
                  hardCodedValue: m === 'fixed' ? v.hardCodedValue : '',
                  contactField: m === 'field' ? v.contactField : '',
                })
              }
              buttons={[
                { value: 'none', label: he ? 'ללא' : 'None' },
                { value: 'fixed', label: he ? 'טקסט קבוע' : 'Fixed' },
                { value: 'field', label: he ? 'שדה איש קשר' : 'Contact field' },
              ]}
            />
            {mode === 'fixed' && (
              <TextInput
                mode="outlined"
                dense
                value={v.hardCodedValue}
                onChangeText={(t) => patch(idx, { hardCodedValue: t })}
                placeholder={he ? 'הטקסט להצגה' : 'Text to show'}
                style={{ backgroundColor: theme.colors.surface, textAlign }}
                outlineColor={theme.colors.outline}
                activeOutlineColor={BRAND}
              />
            )}
            {mode === 'field' &&
              (columns.length > 0 ? (
                <Button mode="outlined" icon="chevron-down" textColor={BRAND} onPress={() => setPickerFor(idx)} contentStyle={{ flexDirection: 'row-reverse' }}>
                  {v.contactField || (he ? 'בחר שדה' : 'Pick field')}
                </Button>
              ) : (
                <TextInput
                  mode="outlined"
                  dense
                  value={v.contactField}
                  onChangeText={(t) => patch(idx, { contactField: t })}
                  placeholder={he ? 'שם השדה (למשל name)' : 'Field name (e.g. name)'}
                  autoCapitalize="none"
                  style={{ backgroundColor: theme.colors.surface }}
                  outlineColor={theme.colors.outline}
                  activeOutlineColor={BRAND}
                />
              ))}
          </View>
        );
      })}
      <PickerSheet
        visible={pickerFor !== null}
        title={he ? 'בחירת שדה איש קשר' : 'Select contact field'}
        mode="single"
        items={columns.map((c) => ({ value: c, label: c }))}
        selected={pickerFor !== null ? [variables[pickerFor]?.contactField || ''] : []}
        searchPlaceholder={he ? 'חיפוש' : 'Search'}
        onDismiss={() => setPickerFor(null)}
        onConfirm={(sel) => pickerFor !== null && patch(pickerFor, { contactField: sel[0] })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
});
