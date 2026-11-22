/** Ringtones the user can pick for calls that ring in the app (the file is looped while the call rings). */
export interface Ringtone {
  id: string;
  he: string;
  en: string;
  // metro needs static require()s
  source: number;
}

export const RINGTONES: Ringtone[] = [
  { id: 'default', he: 'ברירת מחדל', en: 'Default', source: require('../assets/sounds/notification.wav') },
  { id: 'classic', he: 'טלפון קלאסי', en: 'Classic phone', source: require('../assets/sounds/ring_classic.wav') },
  { id: 'oldphone', he: 'טלפון ישן', en: 'Old bell phone', source: require('../assets/sounds/ring_oldphone.wav') },
  { id: 'digital', he: 'דיגיטלי', en: 'Digital', source: require('../assets/sounds/ring_digital.wav') },
  { id: 'chime', he: 'פעמון עדין', en: 'Soft chime', source: require('../assets/sounds/ring_chime.wav') },
  { id: 'marimba', he: 'מרימבה', en: 'Marimba', source: require('../assets/sounds/ring_marimba.wav') },
];

export function getRingtone(id?: string): Ringtone {
  return RINGTONES.find((r) => r.id === id) || RINGTONES[0];
}
