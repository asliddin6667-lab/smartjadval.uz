// =====================================================================
//  FOYDALANUVCHI QIDIRUVI — EDU-ID, email, telefon, ism, maktab
//
//  EDU-ID ko'rinishi: "EDU-XXXXXX" (6 ta belgi, I/O/0/1 ishlatilmaydi).
//  Foydalanuvchi uni turlicha kiritishi mumkin:
//    "EDU-SDAZ6E", "edu sdaz6e", "SDAZ6E", "EDU—SDAZ6E", "sdaz 6e",
//    kirill harflar bilan ("ЕDU-SDАZ6Е" — ko'chirib qo'yganda) va h.k.
//  Shuning uchun ID'lar solishtirishdan oldin NORMALLASHTIRILADI:
//    - katta harfga o'tkaziladi
//    - kirill o'xshash harflar lotinga almashtiriladi
//    - harf va raqamdan boshqa hamma narsa (tire, bo'sh joy) olib tashlanadi
//    - "EDU" prefiksi olib tashlanadi
// =====================================================================

// Kirill -> lotin o'xshash harflar (ko'rinishi bir xil bo'lganlari)
const CYR_TO_LAT = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", О: "O",
  Р: "P", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S",
};

/** ID'ni solishtirish uchun kanonik ko'rinishga keltiradi (prefikssiz). */
export function normalizeEduId(value) {
  if (value == null) return "";
  let s = String(value).toUpperCase();
  s = s.replace(/[А-ЯЁІЈЅ]/g, (ch) => CYR_TO_LAT[ch] || ch);
  s = s.replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("EDU")) s = s.slice(3);
  return s;
}

/** Qidiruv matni EDU-ID'ga o'xshaydimi (6 ta belgili kod yoki EDU-... ). */
export function looksLikeEduId(query) {
  const raw = String(query || "").trim();
  if (!raw) return false;
  if (/^\s*edu\b/i.test(raw) || /^\s*edu[\s\-–—_]/i.test(raw)) return true;
  const core = normalizeEduId(raw);
  return /^[A-Z0-9]{6}$/.test(core) && /[A-Z]/.test(core) && /\d/.test(core);
}

/** Foydalanuvchining EDU-ID'si qidiruvga TO'LIQ mos keladimi. */
export function eduIdExact(uid, query) {
  const a = normalizeEduId(uid);
  const b = normalizeEduId(query);
  return !!a && !!b && a === b;
}

/** Foydalanuvchining EDU-ID'si qidiruvni QISMAN o'z ichiga oladimi. */
export function eduIdPartial(uid, query) {
  const a = normalizeEduId(uid);
  const b = normalizeEduId(query);
  if (!a || !b) return false;
  // Juda qisqa so'rov (1 belgi) bo'yicha ID'ni tekshirish shovqin beradi
  if (b.length < 2) return false;
  return a.includes(b);
}

/**
 * Umumiy qidiruv: ID, email, ism, maktab, telefon (raqamlar bo'yicha),
 * shuningdek Supabase id (UUID) boshlanishi bo'yicha.
 * user: { uid, id, email, name, schoolName, phone }
 */
export function userMatchesQuery(user, query) {
  const raw = String(query || "").trim();
  if (!raw) return true;
  const q = raw.toLowerCase();

  // 1) EDU-ID (normallashtirilgan, tire/bo'sh joy/registr farqsiz)
  if (eduIdExact(user.uid, raw) || eduIdPartial(user.uid, raw)) return true;

  // 2) Matnli maydonlar
  const fields = [user.uid, user.email, user.name, user.schoolName];
  if (fields.filter(Boolean).some((f) => String(f).toLowerCase().includes(q))) return true;

  // 3) Telefon — faqat raqamlar bo'yicha (+998 90 123-45-67 == 998901234567)
  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length >= 3 && user.phone) {
    if (String(user.phone).replace(/\D/g, "").includes(qDigits)) return true;
  }

  // 4) Ichki UUID (texnik qidiruv uchun)
  if (user.id && q.length >= 4 && String(user.id).toLowerCase().startsWith(q)) return true;

  return false;
}

/**
 * Natijalarni tartiblash: aniq EDU-ID mosligi birinchi, keyin qisman ID,
 * keyin qolganlari (asl tartib saqlanadi).
 */
export function rankUsersByQuery(list, query) {
  const raw = String(query || "").trim();
  if (!raw) return list;
  const score = (u) => {
    if (eduIdExact(u.uid, raw)) return 0;
    if (eduIdPartial(u.uid, raw)) return 1;
    return 2;
  };
  return list
    .map((u, i) => ({ u, i, s: score(u) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.u);
}
