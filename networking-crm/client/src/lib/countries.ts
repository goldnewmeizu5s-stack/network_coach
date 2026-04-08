// Convert ISO 3166-1 alpha-2 country code to flag emoji
export function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  const offset = 0x1f1e6 - 65; // 'A' = 65
  return String.fromCodePoint(
    upper.charCodeAt(0) + offset,
    upper.charCodeAt(1) + offset
  );
}

// Common country names (Russian) for display
export const COUNTRY_NAMES: Record<string, string> = {
  RU: "Россия",
  UA: "Украина",
  BY: "Беларусь",
  KZ: "Казахстан",
  UZ: "Узбекистан",
  GE: "Грузия",
  AM: "Армения",
  AZ: "Азербайджан",
  MD: "Молдова",
  KG: "Кыргызстан",
  TJ: "Таджикистан",
  TM: "Туркменистан",
  LV: "Латвия",
  LT: "Литва",
  EE: "Эстония",
  US: "США",
  GB: "Великобритания",
  DE: "Германия",
  FR: "Франция",
  IT: "Италия",
  ES: "Испания",
  PT: "Португалия",
  NL: "Нидерланды",
  BE: "Бельгия",
  CH: "Швейцария",
  AT: "Австрия",
  SE: "Швеция",
  NO: "Норвегия",
  DK: "Дания",
  FI: "Финляндия",
  PL: "Польша",
  CZ: "Чехия",
  SK: "Словакия",
  HU: "Венгрия",
  RO: "Румыния",
  BG: "Болгария",
  HR: "Хорватия",
  RS: "Сербия",
  ME: "Черногория",
  SI: "Словения",
  GR: "Греция",
  TR: "Турция",
  CY: "Кипр",
  IL: "Израиль",
  AE: "ОАЭ",
  SA: "Саудовская Аравия",
  QA: "Катар",
  BH: "Бахрейн",
  KW: "Кувейт",
  OM: "Оман",
  EG: "Египет",
  MA: "Марокко",
  TN: "Тунис",
  CN: "Китай",
  JP: "Япония",
  KR: "Южная Корея",
  IN: "Индия",
  TH: "Таиланд",
  VN: "Вьетнам",
  ID: "Индонезия",
  MY: "Малайзия",
  SG: "Сингапур",
  PH: "Филиппины",
  AU: "Австралия",
  NZ: "Новая Зеландия",
  CA: "Канада",
  MX: "Мексика",
  BR: "Бразилия",
  AR: "Аргентина",
  CL: "Чили",
  CO: "Колумбия",
  PE: "Перу",
  ZA: "ЮАР",
  NG: "Нигерия",
  KE: "Кения",
  IE: "Ирландия",
  IS: "Исландия",
  LU: "Люксембург",
  MC: "Монако",
  MT: "Мальта",
  BA: "Босния",
  MK: "Северная Македония",
  AL: "Албания",
  LK: "Шри-Ланка",
  MM: "Мьянма",
  NP: "Непал",
  PK: "Пакистан",
  BD: "Бангладеш",
  TW: "Тайвань",
  HK: "Гонконг",
  MN: "Монголия",
};

export function getCountryName(code: string): string {
  if (!code) return "";
  return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase();
}

export function getCountryLabel(code: string): string {
  if (!code) return "";
  return `${countryCodeToFlag(code)} ${getCountryName(code)}`;
}
