// ——— Ta'lim tili: sinf ↔ fan mosligi ———
// Sinfda `eduLang` ("uz" | "ru"), fanda `lang` ("uz" | "ru" | "both") turadi.
// "both" — UMUMIY fan: bitta fan sifatida ham o'zbek, ham rus sinfida ko'rinadi.
// Shu sababli unga biriktirilgan ustoz ham ikkala sinfda chiqadi (ustoz fan
// orqali topiladi — `teachersForSubject`).
// Eski ma'lumotlarda maydon bo'lmasligi mumkin — standart "uz".

export const LANG_BOTH = "both";

export function classLangOf(c) {
  return c?.eduLang || "uz";
}

export function subjectLangOf(s) {
  return s?.lang || "uz";
}

// Fan shu tildagi sinfga tegishlimi?
export function subjectFitsLang(subject, classLang) {
  const sl = subjectLangOf(subject);
  return sl === LANG_BOTH || sl === (classLang || "uz");
}

// Ikki fan tili kesishadimi? ("both" hamma bilan kesishadi) — takror nom tekshiruvi uchun
export function langsOverlap(a, b) {
  return a === LANG_BOTH || b === LANG_BOTH || a === b;
}

export function langIcon(lang) {
  if (lang === LANG_BOTH) return "🌐";
  return lang === "ru" ? "🇷🇺" : "🇺🇿";
}

export function langLabel(lang) {
  if (lang === LANG_BOTH) return "🌐 Umumiy";
  return lang === "ru" ? "🇷🇺 Rus" : "🇺🇿 O'zbek";
}
