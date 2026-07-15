import type { Locale as DateFnsLocale } from "date-fns/locale";
import { de, enUS, es, fr, hi, ptBR, tr } from "date-fns/locale";

export { resolveLocalized } from "./resolve";

export const locales = ["en", "fr", "de", "tr", "hi", "es", "pt"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeDetails: Record<Locale, { name: string; flag: string }> = {
  en: { name: "English", flag: "🇺🇸" },
  fr: { name: "Français", flag: "🇫🇷" },
  de: { name: "Deutsch", flag: "🇩🇪" },
  tr: { name: "Türkçe", flag: "🇹🇷" },
  hi: { name: "हिंदी", flag: "🇮🇳" },
  es: { name: "Español", flag: "🇪🇸" },
  pt: { name: "Português", flag: "🇧🇷" },
};

export const dateFnsLocales: Record<Locale, DateFnsLocale> = {
  en: enUS,
  fr,
  de,
  tr,
  hi,
  es,
  pt: ptBR,
};
