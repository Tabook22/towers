import { useSyncExternalStore } from 'react';
import arabic from './ar.json';
import reviewArabic from './review-ar.json';
export type Language = 'en' | 'ar';
const storageKey = 'iip_language';
function initialLanguage(): Language {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'en' || saved === 'ar') return saved; } catch { /* private storage */ }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
let language = initialLanguage();
const listeners = new Set<() => void>();
export function getLanguage() { return language; }
export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* still works this session */ }
  if (typeof document !== 'undefined') { document.documentElement.lang = next; document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr'; }
  listeners.forEach(listener => listener());
}
export function useLanguage() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getLanguage, () => 'en' as Language); }
export function translate(text: string | null | undefined, lang: Language, values: readonly unknown[] = []): string {
  if (text == null) return '';
  const normalized = text.trim();
  const translated = (arabic as Record<string, string>)[normalized] ?? (reviewArabic as Record<string,string>)[normalized];
  const source = lang === 'ar' && translated !== undefined ? text.slice(0, text.indexOf(normalized)) + translated + text.slice(text.indexOf(normalized) + normalized.length) : text;
  // Decode authored JSX entities before inserting values; never transform user values.
  return source.replace(/&apos;|&#39;|&quot;|&amp;|&lt;|&gt;/g, entity => ({ '&apos;': "'", '&#39;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' })[entity]!)
    .replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)] ?? '') : match);
}
/** For interface copy and enumerated option labels only. Never use on user-entered content or API values. */
export function tr(text: string | null | undefined, values: readonly unknown[] = []) { return translate(text, language, values); }
export function locale() { return language === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB'; }
export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleDateString(locale(), options);
}
if (typeof document !== 'undefined') { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'; }
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === storageKey && (event.newValue === 'ar' || event.newValue === 'en')) setLanguage(event.newValue); });
