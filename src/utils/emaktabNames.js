// =====================================================================
//  NOM MOSLASHTIRISH — Smartjadval ↔ eMaktab (kundalik.com)
//
//  Ikkala platformada nomlar BIR XIL yozilmaydi:
//    sinf   — "3-B"  ↔  "3-Б", "3 б", "3B"
//    fan    — "Rus tili"  ↔  "Русский язык"
//    ustoz  — "Munavvarov A.M."  ↔  "Munavvarov Akmal Murodovich"
//
//  Shu sababli taqqoslash XOM MATN bo'yicha emas, NORMALLASHGAN kalit
//  bo'yicha ketadi. Bu fayl faqat SOF funksiyalardan iborat — brauzer
//  API'siga tegmaydi, chunki ayni algoritm ko'prik skriptida
//  (public/emaktab-bridge.user.js) ham takrorlangan.
//
//  ⚠️ Bu yerdagi mantiq o'zgarsa — ko'prik skriptidagi nusxasi ham
//  yangilansin: u boshqa domenda (schools.emaktab.uz) mustaqil ishlaydi,
//  shuning uchun import qila olmaydi.
// =====================================================================

// Kirill → lotin. eMaktab sinf harfini kirillda ham yozadi ("3-Б").
const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h", ҷ: "j",
};

// Apostrofning barcha ko'rinishi tashlab yuboriladi
const APOS = /['‘’ʻʼ´`]/g;

// ——— Umumiy normallashtirish ———
// "O'zbek tili" → "ozbektili", "Русский язык" → "russkiyyazik"
export function normKey(raw) {
  const s = String(raw ?? "").toLowerCase().replace(APOS, "");
  let out = "";
  for (const ch of s) out += Object.prototype.hasOwnProperty.call(CYR, ch) ? CYR[ch] : ch;
  return out.replace(/[^a-z0-9]/g, "");
}

// ——— SINF NOMI ———
// "3-B", "3 б", "3B", "3-Б sinf" → { daraja: 3, harf: "b", kalit: "3b" }
export function parseClassName(raw) {
  const s = String(raw ?? "").replace(APOS, "").trim();
  const m = s.match(/(\d{1,2})\s*[-–—_. ]?\s*([A-Za-zЀ-ӿ]{0,3})/);
  if (!m) return { daraja: 0, harf: "", kalit: normKey(s) };
  const daraja = Number(m[1]) || 0;
  const harf = normKey(m[2] || "");
  return { daraja, harf, kalit: daraja ? `${daraja}${harf}` : normKey(s) };
}

export function classKey(raw) {
  return parseClassName(raw).kalit;
}

// ——— USTOZ F.I.Sh. ———
// eMaktab ko'pincha "Munavvarov Akmal Murodovich", Smartjadval esa
// "Munavvarov A.M." yozadi. Shuning uchun ikkita kalit chiqariladi:
//   toliq — hamma so'z; qisqa — familiya + qolgan so'zlarning BOSH HARFI.
export function teacherKeys(raw) {
  const s = String(raw ?? "").replace(APOS, "").trim();
  const words = s.split(/[\s.]+/).filter(Boolean);
  if (!words.length) return { toliq: "", qisqa: "" };
  const fam = normKey(words[0]);
  const bosh = words.slice(1).map((w) => (normKey(w)[0] || "")).join("");
  return { toliq: normKey(s), qisqa: fam + bosh };
}

// Ikki yozuv bir odammi? ("Munavvarov A.M." ↔ "Munavvarov Akmal Murodovich")
export function sameTeacher(a, b) {
  const x = teacherKeys(a);
  const y = teacherKeys(b);
  if (!x.qisqa || !y.qisqa) return false;
  if (x.toliq === y.toliq) return true;
  return x.qisqa === y.qisqa;
}

// ——— FAN NOMLARI: o'zbekcha ↔ ruscha ———
// eMaktab'da fan sinfning ta'lim tilida yoziladi. Juftliklar QO'LDA
// tuzilgan: STANDARD_SUBJECTS (51 ta) va STANDARD_SUBJECTS_RU (50 ta)
// indeks bo'yicha mos EMAS, avtomatik juftlash noto'g'ri natija beradi.
const SUBJECT_SYNONYMS = [
  ["Ona tili", "Родной язык"],
  ["Ona tili va o'qish savodxonligi", "Русский язык и грамотность чтения"],
  ["O'qish savodxonligi", "Грамотность чтения", "Чтение"],
  ["Adabiyot", "Литература"],
  ["Badiiy adabiyot", "Художественная литература"],
  ["Ifodali o'qish", "Выразительное чтение"],
  ["Sinfdan tashqari o'qish", "Внеклассное чтение"],
  ["Alifbe", "Азбука", "Букварь"],
  ["Yozuv", "Письмо"],
  ["Husnixat", "Чистописание"],
  ["Nutq o'stirish", "Развитие речи"],
  ["O'zbek tili", "Узбекский язык"],
  ["Ingliz tili", "Английский язык", "English"],
  ["Rus tili", "Русский язык"],
  ["Matematika", "Математика"],
  ["Algebra", "Алгебра"],
  ["Geometriya", "Геометрия"],
  ["Mental arifmetika", "Ментальная арифметика"],
  ["Mnemonika", "Мнемоника"],
  ["Tabiatshunoslik", "Природоведение"],
  ["Tabiiy fan (Science)", "Естествознание (Science)", "Естественные науки"],
  ["Biologiya", "Биология"],
  ["Kimyo", "Химия"],
  ["Fizika", "Физика"],
  ["Astranomiya", "Астрономия", "Astronomiya"],
  ["Geografiya", "География"],
  ["Tarix", "История"],
  ["O'zbekiston tarixi", "История Узбекистана"],
  ["Jahon tarixi", "Всемирная история"],
  ["Tarixdan hikoyalar", "Рассказы по истории"],
  ["Huquq", "Право"],
  ["Davlat va huquq asoslari", "Основы государства и права"],
  ["Iqtisodiy bilim asoslari", "Основы экономических знаний"],
  ["Tadbirkorlik asoslari", "Основы предпринимательства"],
  ["Tarbiya", "Воспитание"],
  ["Kelajak soati", "Час будущего"],
  ["Tanqidiy fikrlash", "Критическое мышление"],
  ["Informatika", "Информатика"],
  ["Informatika va axborot texnologiyalari", "Информатика и информационные технологии"],
  ["Texnologiya", "Технология", "Mehnat", "Труд"],
  ["Chizmachilik", "Черчение"],
  ["Tasviriy san'at", "Изобразительное искусство", "Изо"],
  ["Musiqa", "Музыка"],
  ["Musiqa madaniyati", "Музыкальная культура"],
  ["Jismoniy tarbiya", "Физическая культура", "Jismoniy madaniyat", "Физическое воспитание"],
  ["Chaqiruvga qadar boshlang'ich tayyorgarlik", "Начальная допризывная подготовка"],
  ["Boshlang'ich ta'lim", "Начальное образование"],
  ["Tanlov fanlari", "Предметы по выбору"],
];

// normallashgan nom → sinonim guruhining raqami
const SYN_GROUP = (() => {
  const map = new Map();
  SUBJECT_SYNONYMS.forEach((row, i) => row.forEach((name) => {
    const k = normKey(name);
    if (k && !map.has(k)) map.set(k, i);
  }));
  return map;
})();

export function subjectGroup(raw) {
  const k = normKey(raw);
  return SYN_GROUP.has(k) ? SYN_GROUP.get(k) : -1;
}

// ⚠️ YOZUV TURI — "cyr" yoki "lat".
//
//  `normKey()` kirillni lotinga o'giradi, shuning uchun «Математика» va
//  «Matematika» BIR XIL kalit beradi. eMaktab ro'yxatida ikkalasi ham
//  turadi (rus va o'zbek sinflari uchun) — kalit bo'yicha tanlasak
//  birinchi uchragani olinadi va rus sinfiga lotincha fan tushadi.
//  Undan keyin ustoz ro'yxati ham NOTO'G'RI fan bo'yicha so'raladi,
//  ya'ni bitta xato ikkitasini tug'adi. Shuning uchun bir xil kalitli
//  nomzodlar orasidan nishon bilan AYNI yozuvdagisi tanlanadi.
export function scriptOf(raw) {
  const s = String(raw ?? "");
  const cyr = (s.match(/[Ѐ-ӿ]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  if (cyr > lat) return "cyr";
  return lat > 0 ? "lat" : "";
}

function labelOf(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  return String(x.label ?? x.name ?? x.nom ?? x.text ?? "");
}

// ——— Ro'yxatdan eng mos elementni topish ———
// Qaytadi: { qiymat, ishonch } — ishonch: "aniq" | "sinonim" | "qismiy" | ""
// Bo'sh "ishonch" = topilmadi, foydalanuvchi qo'lda tanlashi kerak.
export function bestMatch(target, list, kind = "fan") {
  if (!target || !Array.isArray(list) || !list.length) return { qiymat: null, ishonch: "" };
  const nk = normKey(target);

  if (kind === "ustoz") {
    const exact = list.find((x) => normKey(labelOf(x)) === nk);
    if (exact) return { qiymat: exact, ishonch: "aniq" };
    const same = list.find((x) => sameTeacher(labelOf(x), target));
    if (same) return { qiymat: same, ishonch: "sinonim" };
    // faqat familiya bo'yicha — bitta nomzod qolsagina ishonamiz
    const fam = normKey(String(target).trim().split(/[\s.]+/)[0] || "");
    if (fam.length >= 4) {
      const byFam = list.filter((x) => normKey(labelOf(x)).startsWith(fam));
      if (byFam.length === 1) return { qiymat: byFam[0], ishonch: "qismiy" };
    }
    return { qiymat: null, ishonch: "" };
  }

  if (kind === "sinf") {
    const k = classKey(target);
    const exact = list.find((x) => classKey(labelOf(x)) === k);
    return exact ? { qiymat: exact, ishonch: "aniq" } : { qiymat: null, ishonch: "" };
  }

  // fan / xona — bir nechta nomzod bo'lsa yozuv turi hal qiladi
  const sc = scriptOf(target);
  const aniq = list.filter((x) => normKey(labelOf(x)) === nk);
  if (aniq.length) {
    const bir = sc ? aniq.find((x) => scriptOf(labelOf(x)) === sc) : null;
    return { qiymat: bir || aniq[0], ishonch: "aniq" };
  }

  const g = subjectGroup(target);
  if (g >= 0) {
    const syn = list.filter((x) => subjectGroup(labelOf(x)) === g);
    if (syn.length) {
      const bir = sc ? syn.find((x) => scriptOf(labelOf(x)) === sc) : null;
      return { qiymat: bir || syn[0], ishonch: "sinonim" };
    }
  }

  // qismiy: biri ikkinchisining ichida ("Informatika" ⊂ "Informatika va AT").
  // Bitta nomzod qolsagina — aks holda noto'g'ri fan tanlanadi.
  if (nk.length >= 5) {
    const part = list.filter((x) => {
      const o = normKey(labelOf(x));
      return o.length >= 5 && (o.includes(nk) || nk.includes(o));
    });
    if (part.length === 1) return { qiymat: part[0], ishonch: "qismiy" };
  }
  return { qiymat: null, ishonch: "" };
}
