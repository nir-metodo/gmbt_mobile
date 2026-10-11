import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useRowDirection } from '../../hooks/useRowDirection';
import { BRAND, fmtNum, SectionCard, StatTile } from '../dashboard/ui';
import { ExpandableBars, RecordList } from '../dashboard/records';
import { generateAiReport } from '../../services/api/dashboard';

const EXAMPLES = [
  { key: 'reports.ai.ex1', fallback: 'כמה לידים נסגרו החודש לפי מקור' },
  { key: 'reports.ai.ex2', fallback: 'אילו פניות פתוחות הכי הרבה זמן' },
  { key: 'reports.ai.ex3', fallback: 'ביצועי הנציגים החודש' },
  { key: 'reports.ai.ex4', fallback: 'מה 10 אנשי הקשר הפעילים ביותר' },
];

/** Ask Gambot AI for a custom report (web AiReportPanel): one prompt box, one result. */
export default function AiPanel({ org, userId }: { org: string; userId: string }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const dir = useRowDirection();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (text?: string) => {
    const p = (text ?? prompt).trim();
    if (!p || loading) return;
    setPrompt(p);
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await generateAiReport(org, userId, p);
      if (res?.Success) setReport(res.Data);
      else setError(res?.Message || t('reports.ai.error', 'שגיאה ביצירת הדוח'));
    } catch {
      setError(t('reports.ai.errorRetry', 'שגיאה ביצירת הדוח. נסו שוב.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <SectionCard title={t('reports.ai.title', 'דוח AI מותאם')} icon="robot-outline" color="#7c3aed">
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder={t('reports.ai.placeholder', 'מה תרצו לדעת?')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          multiline
          style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outlineVariant || '#cbd5e1', backgroundColor: theme.colors.surfaceVariant }]}
        />
        <Pressable
          onPress={() => run()}
          disabled={loading || !prompt.trim()}
          style={[styles.send, { opacity: loading || !prompt.trim() ? 0.5 : 1, flexDirection: dir }]}
        >
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="auto-fix" size={18} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('reports.ai.generate', 'צור דוח')}</Text>
        </Pressable>
        {!report && !loading ? (
          <View style={{ marginTop: 12, gap: 6 }}>
            {EXAMPLES.map((e) => (
              <Pressable key={e.key} onPress={() => run(t(e.key, e.fallback))} style={[styles.example, { flexDirection: dir, borderColor: theme.colors.outlineVariant || '#e2e8f0' }]}>
                <MaterialCommunityIcons name="lightbulb-outline" size={16} color="#d97706" />
                <Text style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface }}>{t(e.key, e.fallback)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {error ? <Text style={{ color: '#dc2626', marginTop: 10 }}>{error}</Text> : null}
      </SectionCard>

      {report ? (
        <>
          {report.title ? <Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.onSurface, marginHorizontal: 14, marginBottom: 6 }}>{report.title}</Text> : null}
          {report.summary ? <Text style={{ fontSize: 13, color: theme.colors.onSurfaceVariant, marginHorizontal: 14, marginBottom: 12 }}>{report.summary}</Text> : null}
          {(report.kpis || []).length > 0 ? (
            <View style={[styles.tiles, { flexDirection: dir }]}>
              {report.kpis.map((k: any, i: number) => (
                <StatTile key={i} label={`${k.label || ''}${k.change ? ` (${k.change})` : ''}`} value={typeof k.value === 'number' ? fmtNum(k.value) : String(k.value ?? '')} width="48%" />
              ))}
            </View>
          ) : null}
          {(report.charts || []).map((c: any, i: number) => (
            <SectionCard key={i} title={c.title} icon="chart-bar" color={BRAND}>
              <ExpandableBars
                items={(c.labels || []).map((label: string, li: number) => ({ label, count: Number(c.datasets?.[0]?.data?.[li]) || 0 }))}
                limit={15}
              />
            </SectionCard>
          ))}
          {(report.tables || []).map((tb: any, i: number) => (
            <SectionCard key={i} title={tb.title} icon="table" color={BRAND}>
              <RecordList
                limit={20}
                rows={(tb.rows || []).map((row: any[], ri: number) => ({
                  key: String(ri),
                  primary: String(row?.[0] ?? '-'),
                  secondary: (tb.columns || [])
                    .slice(1)
                    .map((col: string, ci: number) => `${col}: ${row?.[ci + 1] ?? '-'}`)
                    .join(' · '),
                }))}
              />
            </SectionCard>
          ))}
          {(report.insights || []).length > 0 ? (
            <SectionCard title={t('reports.ai.insights', 'תובנות')} icon="lightbulb-on-outline" color="#d97706">
              {report.insights.map((ins: string, i: number) => (
                <Text key={i} style={{ fontSize: 13, color: theme.colors.onSurface, marginBottom: 6 }}>
                  • {ins}
                </Text>
              ))}
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 70, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14, textAlignVertical: 'top' },
  send: { marginTop: 10, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', gap: 8 },
  example: { alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  tiles: { flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
});
