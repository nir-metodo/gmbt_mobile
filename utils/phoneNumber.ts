// Phone-number normalization for WhatsApp, mirroring the web `cleanPhoneNumber`
// logic (src/components/Contacts/NewContactForm.js). Numbers are stored WITHOUT
// a leading "+", as a full international number (e.g. 972505278310). The trunk
// "0" is stripped and the selected country dial code is applied.

export interface Country {
  code: string;   // ISO-2
  name: string;   // English name
  nameHe: string; // Hebrew name
  dial: string;   // dial code, digits only (e.g. "972")
  flag: string;   // emoji flag
}

// Focused but practical list; Israel first (default).
export const COUNTRIES: Country[] = [
  { code: 'IL', name: 'Israel', nameHe: 'ישראל', dial: '972', flag: '🇮🇱' },
  { code: 'US', name: 'United States', nameHe: 'ארצות הברית', dial: '1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', nameHe: 'בריטניה', dial: '44', flag: '🇬🇧' },
  { code: 'FR', name: 'France', nameHe: 'צרפת', dial: '33', flag: '🇫🇷' },
  { code: 'DE', name: 'Germany', nameHe: 'גרמניה', dial: '49', flag: '🇩🇪' },
  { code: 'IT', name: 'Italy', nameHe: 'איטליה', dial: '39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', nameHe: 'ספרד', dial: '34', flag: '🇪🇸' },
  { code: 'RU', name: 'Russia', nameHe: 'רוסיה', dial: '7', flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine', nameHe: 'אוקראינה', dial: '380', flag: '🇺🇦' },
  { code: 'NL', name: 'Netherlands', nameHe: 'הולנד', dial: '31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', nameHe: 'בלגיה', dial: '32', flag: '🇧🇪' },
  { code: 'CH', name: 'Switzerland', nameHe: 'שווייץ', dial: '41', flag: '🇨🇭' },
  { code: 'AT', name: 'Austria', nameHe: 'אוסטריה', dial: '43', flag: '🇦🇹' },
  { code: 'SE', name: 'Sweden', nameHe: 'שוודיה', dial: '46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', nameHe: 'נורווגיה', dial: '47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', nameHe: 'דנמרק', dial: '45', flag: '🇩🇰' },
  { code: 'PL', name: 'Poland', nameHe: 'פולין', dial: '48', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', nameHe: 'פורטוגל', dial: '351', flag: '🇵🇹' },
  { code: 'GR', name: 'Greece', nameHe: 'יוון', dial: '30', flag: '🇬🇷' },
  { code: 'TR', name: 'Turkey', nameHe: 'טורקיה', dial: '90', flag: '🇹🇷' },
  { code: 'CA', name: 'Canada', nameHe: 'קנדה', dial: '1', flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico', nameHe: 'מקסיקו', dial: '52', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', nameHe: 'ברזיל', dial: '55', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', nameHe: 'ארגנטינה', dial: '54', flag: '🇦🇷' },
  { code: 'IN', name: 'India', nameHe: 'הודו', dial: '91', flag: '🇮🇳' },
  { code: 'CN', name: 'China', nameHe: 'סין', dial: '86', flag: '🇨🇳' },
  { code: 'JP', name: 'Japan', nameHe: 'יפן', dial: '81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', nameHe: 'קוריאה', dial: '82', flag: '🇰🇷' },
  { code: 'AU', name: 'Australia', nameHe: 'אוסטרליה', dial: '61', flag: '🇦🇺' },
  { code: 'ZA', name: 'South Africa', nameHe: 'דרום אפריקה', dial: '27', flag: '🇿🇦' },
  { code: 'AE', name: 'UAE', nameHe: 'איחוד האמירויות', dial: '971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', nameHe: 'ערב הסעודית', dial: '966', flag: '🇸🇦' },
  { code: 'EG', name: 'Egypt', nameHe: 'מצרים', dial: '20', flag: '🇪🇬' },
  { code: 'JO', name: 'Jordan', nameHe: 'ירדן', dial: '962', flag: '🇯🇴' },
  { code: 'CY', name: 'Cyprus', nameHe: 'קפריסין', dial: '357', flag: '🇨🇾' },
  { code: 'RO', name: 'Romania', nameHe: 'רומניה', dial: '40', flag: '🇷🇴' },
  { code: 'GE', name: 'Georgia', nameHe: 'גאורגיה', dial: '995', flag: '🇬🇪' },
  { code: 'TH', name: 'Thailand', nameHe: 'תאילנד', dial: '66', flag: '🇹🇭' },
  { code: 'PH', name: 'Philippines', nameHe: 'פיליפינים', dial: '63', flag: '🇵🇭' },
  { code: 'IE', name: 'Ireland', nameHe: 'אירלנד', dial: '353', flag: '🇮🇪' },
];

export const DEFAULT_COUNTRY: Country = COUNTRIES[0]; // Israel

/**
 * Normalize a raw phone number to WhatsApp format (no "+", full international).
 * Mirrors the web logic, generalized to the supplied country dial code.
 *
 * Examples (dial "972"):
 *   "0505278310"    -> "972505278310"
 *   "050-5278310"   -> "972505278310"
 *   "972505278310"  -> "972505278310"
 *   "9720505278310" -> "972505278310"
 *   "505278310"     -> "972505278310"
 */
export function cleanPhoneNumber(rawPhone: string, dialCode: string = DEFAULT_COUNTRY.dial): string {
  let cleaned = (rawPhone || '').replace(/\D/g, '');
  if (!cleaned) return '';

  const dc = (dialCode || DEFAULT_COUNTRY.dial).replace(/\D/g, '') || DEFAULT_COUNTRY.dial;

  // Collapse a duplicated country code: "972972..." -> "972..."
  while (cleaned.startsWith(dc + dc)) {
    cleaned = cleaned.substring(dc.length);
  }

  // "<dc>0..." -> drop the trunk "0" right after the country code
  if (cleaned.startsWith(dc + '0')) {
    cleaned = dc + cleaned.substring(dc.length + 1);
  }

  // Already starts with this country code -> done
  if (cleaned.startsWith(dc)) {
    return cleaned;
  }

  // Local number with a leading trunk "0" -> swap the 0 for the country code
  if (cleaned.startsWith('0')) {
    return dc + cleaned.substring(1);
  }

  // No country code and no trunk 0. If it's already long enough to be a full
  // international number (another country pasted in), keep it as-is; otherwise
  // treat it as a local number and prepend the selected country code.
  if (cleaned.length >= 11) {
    return cleaned;
  }
  return dc + cleaned;
}

/**
 * Split a stored full number into the matching country + the local part (the
 * digits after the country code), so an existing contact can be edited with the
 * right country pre-selected. Falls back to Israel.
 */
export function splitPhoneNumber(fullNumber: string): { country: Country; local: string } {
  const digits = (fullNumber || '').replace(/\D/g, '');
  if (!digits) return { country: DEFAULT_COUNTRY, local: '' };

  // Prefer the longest matching dial code (e.g. "972" over "9").
  const matches = COUNTRIES.filter((c) => digits.startsWith(c.dial)).sort((a, b) => b.dial.length - a.dial.length);
  if (matches.length > 0) {
    const country = matches[0];
    return { country, local: digits.substring(country.dial.length) };
  }
  return { country: DEFAULT_COUNTRY, local: digits };
}
