// ──────────────────────────────────────────────────────────────
// Country normalizer — turns anything ("Russia", "Россия", "РФ",
// "ru", "RU", "россии", "Russian Federation", "United Arab Emirates",
// "ОАЭ", "Dubai") into a canonical ISO 3166-1 alpha-2 code, or null
// if the input is unrecognized.
//
// This is a pragmatic lookup table, not a full i18n library — we only
// need the countries our users realistically meet people in.
// ──────────────────────────────────────────────────────────────

const ISO_CODES = new Set([
  "RU","UA","BY","KZ","UZ","GE","AM","AZ","MD","KG","TJ","TM","LV","LT","EE",
  "US","GB","DE","FR","IT","ES","PT","NL","BE","CH","AT","SE","NO","DK","FI",
  "PL","CZ","SK","HU","RO","BG","HR","RS","ME","SI","GR","TR","CY","IL","AE",
  "SA","QA","BH","KW","OM","EG","MA","TN","CN","JP","KR","IN","TH","VN","ID",
  "MY","SG","PH","AU","NZ","CA","MX","BR","AR","CL","CO","PE","ZA","NG","KE",
  "IE","IS","LU","MC","MT","BA","MK","AL","LK","MM","NP","PK","BD","TW","HK",
  "MN","IR","IQ","JO","LB","SY","YE","CU","DO","PR","UY","VE","EC","BO","PY",
  "PA","CR","GT","NI","HN","SV","HT","TT","BS","JM","ZM","ZW","TZ","UG","GH",
  "CI","SN","DZ","LY","SD","AO","CM","RW","BW","NA","MZ","MG","AF","LA","KH",
]);

// name (lowercased) → ISO
const NAME_TO_ISO: Record<string, string> = {
  // Russia
  "россия": "RU", "российская федерация": "RU", "рф": "RU", "russia": "RU",
  "russian federation": "RU", "russian": "RU", "русский": "RU",
  // Post-soviet
  "украина": "UA", "ukraine": "UA",
  "беларусь": "BY", "белоруссия": "BY", "belarus": "BY",
  "казахстан": "KZ", "kazakhstan": "KZ",
  "узбекистан": "UZ", "uzbekistan": "UZ",
  "грузия": "GE", "georgia": "GE",
  "армения": "AM", "armenia": "AM",
  "азербайджан": "AZ", "azerbaijan": "AZ",
  "молдова": "MD", "moldova": "MD",
  "кыргызстан": "KG", "киргизия": "KG", "kyrgyzstan": "KG",
  "таджикистан": "TJ", "tajikistan": "TJ",
  "туркменистан": "TM", "turkmenistan": "TM",
  // Baltic
  "латвия": "LV", "latvia": "LV",
  "литва": "LT", "lithuania": "LT",
  "эстония": "EE", "estonia": "EE",
  // Anglosphere
  "сша": "US", "соединённые штаты": "US", "соединенные штаты": "US",
  "united states": "US", "united states of america": "US", "usa": "US", "america": "US",
  "америка": "US", "штаты": "US",
  "великобритания": "GB", "англия": "GB", "англии": "GB", "uk": "GB",
  "united kingdom": "GB", "britain": "GB", "england": "GB",
  "канада": "CA", "canada": "CA",
  "австралия": "AU", "australia": "AU",
  "новая зеландия": "NZ", "new zealand": "NZ",
  // Europe
  "германия": "DE", "germany": "DE", "deutschland": "DE",
  "франция": "FR", "france": "FR",
  "италия": "IT", "italy": "IT",
  "испания": "ES", "spain": "ES",
  "португалия": "PT", "portugal": "PT",
  "нидерланды": "NL", "голландия": "NL", "netherlands": "NL", "holland": "NL",
  "бельгия": "BE", "belgium": "BE",
  "швейцария": "CH", "switzerland": "CH",
  "австрия": "AT", "austria": "AT",
  "швеция": "SE", "sweden": "SE",
  "норвегия": "NO", "norway": "NO",
  "дания": "DK", "denmark": "DK",
  "финляндия": "FI", "finland": "FI",
  "ирландия": "IE", "ireland": "IE",
  "исландия": "IS", "iceland": "IS",
  "польша": "PL", "poland": "PL",
  "чехия": "CZ", "czech": "CZ", "czech republic": "CZ", "чешская республика": "CZ",
  "словакия": "SK", "slovakia": "SK",
  "венгрия": "HU", "hungary": "HU",
  "румыния": "RO", "romania": "RO",
  "болгария": "BG", "bulgaria": "BG",
  "хорватия": "HR", "croatia": "HR",
  "сербия": "RS", "serbia": "RS",
  "черногория": "ME", "montenegro": "ME",
  "словения": "SI", "slovenia": "SI",
  "греция": "GR", "greece": "GR",
  "турция": "TR", "turkey": "TR", "türkiye": "TR",
  "кипр": "CY", "cyprus": "CY",
  "люксембург": "LU", "luxembourg": "LU",
  "монако": "MC", "monaco": "MC",
  "мальта": "MT", "malta": "MT",
  "босния": "BA", "bosnia": "BA",
  "северная македония": "MK", "macedonia": "MK",
  "албания": "AL", "albania": "AL",
  // Middle East + North Africa
  "израиль": "IL", "israel": "IL",
  "оаэ": "AE", "эмираты": "AE", "uae": "AE", "united arab emirates": "AE", "emirates": "AE",
  "дубай": "AE", "dubai": "AE", "абу-даби": "AE", "abu dhabi": "AE",
  "саудовская аравия": "SA", "saudi arabia": "SA", "ksa": "SA", "saudi": "SA",
  "катар": "QA", "qatar": "QA",
  "бахрейн": "BH", "bahrain": "BH",
  "кувейт": "KW", "kuwait": "KW",
  "оман": "OM", "oman": "OM",
  "иран": "IR", "iran": "IR",
  "ирак": "IQ", "iraq": "IQ",
  "иордания": "JO", "jordan": "JO",
  "ливан": "LB", "lebanon": "LB",
  "сирия": "SY", "syria": "SY",
  "йемен": "YE", "yemen": "YE",
  "египет": "EG", "egypt": "EG",
  "марокко": "MA", "morocco": "MA",
  "тунис": "TN", "tunisia": "TN",
  "алжир": "DZ", "algeria": "DZ",
  // Asia
  "китай": "CN", "china": "CN", "prc": "CN",
  "япония": "JP", "japan": "JP",
  "южная корея": "KR", "корея": "KR", "south korea": "KR", "korea": "KR",
  "индия": "IN", "india": "IN",
  "таиланд": "TH", "thailand": "TH",
  "вьетнам": "VN", "vietnam": "VN",
  "индонезия": "ID", "indonesia": "ID",
  "малайзия": "MY", "malaysia": "MY",
  "сингапур": "SG", "singapore": "SG",
  "филиппины": "PH", "philippines": "PH",
  "шри-ланка": "LK", "шри ланка": "LK", "sri lanka": "LK",
  "мьянма": "MM", "myanmar": "MM",
  "непал": "NP", "nepal": "NP",
  "пакистан": "PK", "pakistan": "PK",
  "бангладеш": "BD", "bangladesh": "BD",
  "тайвань": "TW", "taiwan": "TW",
  "гонконг": "HK", "hong kong": "HK",
  "монголия": "MN", "mongolia": "MN",
  "афганистан": "AF", "afghanistan": "AF",
  "лаос": "LA", "laos": "LA",
  "камбоджа": "KH", "cambodia": "KH",
  // Americas
  "мексика": "MX", "mexico": "MX",
  "бразилия": "BR", "brazil": "BR",
  "аргентина": "AR", "argentina": "AR",
  "чили": "CL", "chile": "CL",
  "колумбия": "CO", "colombia": "CO",
  "перу": "PE", "peru": "PE",
  "куба": "CU", "cuba": "CU",
  "уругвай": "UY", "uruguay": "UY",
  "венесуэла": "VE", "venezuela": "VE",
  "эквадор": "EC", "ecuador": "EC",
  "панама": "PA", "panama": "PA",
  "коста-рика": "CR", "коста рика": "CR", "costa rica": "CR",
  // Africa (more)
  "юар": "ZA", "south africa": "ZA",
  "нигерия": "NG", "nigeria": "NG",
  "кения": "KE", "kenya": "KE",
  "танзания": "TZ", "tanzania": "TZ",
  "уганда": "UG", "uganda": "UG",
  "гана": "GH", "ghana": "GH",
  "ангола": "AO", "angola": "AO",
  "сенегал": "SN", "senegal": "SN",
  "зимбабве": "ZW", "zimbabwe": "ZW",
  "замбия": "ZM", "zambia": "ZM",
};

export function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already a valid 2-letter ISO code?
  if (trimmed.length === 2) {
    const up = trimmed.toUpperCase();
    if (ISO_CODES.has(up)) return up;
  }

  // Handle "RU / Russia" or "Russia (RU)" — peel ISO tokens out.
  const isoMatch = trimmed.match(/\b([A-Za-z]{2})\b/);
  if (isoMatch) {
    const up = isoMatch[1].toUpperCase();
    if (ISO_CODES.has(up) && trimmed.length <= 5) {
      return up;
    }
  }

  const key = trimmed.toLowerCase().replace(/[.,;:!?"'()]/g, "").trim();
  if (NAME_TO_ISO[key]) return NAME_TO_ISO[key];

  // Try stripping plural/case endings on a handful of common Russian forms
  for (const suffix of ["ии", "ию", "ией", "ия", "и", "ы", "у", "е"]) {
    if (key.endsWith(suffix)) {
      const stem = key.slice(0, -suffix.length);
      for (const ending of ["", "а", "я", "ь"]) {
        const candidate = stem + ending;
        if (NAME_TO_ISO[candidate]) return NAME_TO_ISO[candidate];
      }
    }
  }

  return null;
}

// Normalize-or-passthrough: returns ISO code when we can recognize it,
// otherwise returns the original trimmed string (falsy-safe). Use this
// when you want to preserve human-readable input but prefer ISO.
export function normalizeCountryKeepRaw(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return normalizeCountry(trimmed) ?? trimmed;
}
