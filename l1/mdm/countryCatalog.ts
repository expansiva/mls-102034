/// <mls fileReference="_102034_/l1/mdm/countryCatalog.ts" enhancement="_blank" />
import { isProtectedPrivacyCountry } from '/_102034_/l1/mdm/personAccess.js';
import { countryCodes } from '/_102034_/l1/mdm/countryCodes.js';

export interface MdmCountryOption {
  readonly code: string;
  readonly name: string;
  readonly requiresPrivacyConsent: boolean;
}

interface RegionDisplayNames {
  of(code: string): string | undefined;
}

interface RegionDisplayNamesConstructor {
  new (locales: string[], options: { type: 'region' }): RegionDisplayNames;
  supportedLocalesOf(locales: string[]): string[];
}

interface IntlWithRegionNames {
  DisplayNames?: RegionDisplayNamesConstructor;
}

const catalogCache = new Map<string, readonly MdmCountryOption[]>();

function regionNamesApi(): RegionDisplayNamesConstructor | undefined {
  const intl = (globalThis as { Intl?: IntlWithRegionNames }).Intl;
  return typeof intl?.DisplayNames === 'function' ? intl.DisplayNames : undefined;
}

function presentationLocale(locale: string | undefined): string {
  if (!locale) {
    return 'en';
  }
  const DisplayNames = regionNamesApi();
  if (!DisplayNames) {
    return 'en';
  }
  try {
    const supported = DisplayNames.supportedLocalesOf([locale]);
    return supported.length > 0 ? supported[0] : 'en';
  } catch {
    return 'en';
  }
}

function localizedName(code: string, englishName: string, locale: string): string {
  const DisplayNames = regionNamesApi();
  if (!DisplayNames) {
    return englishName;
  }
  try {
    const value = new DisplayNames([locale], { type: 'region' }).of(code);
    if (typeof value === 'string' && value.trim() && value !== code) {
      return value;
    }
  } catch {
    // ICU missing or locale rejected at construction time.
  }
  return englishName;
}

function buildCatalog(locale: string): readonly MdmCountryOption[] {
  return Object.freeze(countryCodes.map((entry) => Object.freeze({
    code: entry.code,
    name: localizedName(entry.code, entry.englishName, locale),
    requiresPrivacyConsent: isProtectedPrivacyCountry(entry.code),
  })));
}

/** Stable by code. Default locale is en. Caller filters and sort are out of this API. */
export function getCountryCatalog(locale?: string): readonly MdmCountryOption[] {
  const resolved = presentationLocale(locale);
  const cached = catalogCache.get(resolved);
  if (cached) {
    return cached;
  }
  const built = buildCatalog(resolved);
  catalogCache.set(resolved, built);
  return built;
}
