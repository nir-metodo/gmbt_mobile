import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './translations/he';
import en from './translations/en';

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: 'he',
  fallbackLng: 'he',
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

export default i18n;
