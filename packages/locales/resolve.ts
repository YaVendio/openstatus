export function resolveLocalized(
  i18n: Partial<Record<string, string>> | null | undefined,
  base: string,
  locale: string,
): string {
  const variant = i18n?.[locale];
  return variant && variant.length > 0 ? variant : base;
}
