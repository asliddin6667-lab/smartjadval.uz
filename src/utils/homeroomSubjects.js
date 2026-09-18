// ═══════════════════════════════════════════════════════════════════
//  SINF RAHBARI QAYSI FANNI O'ZI BERADI
// ═══════════════════════════════════════════════════════════════════
//
//  1–4 sinfda darslarning deyarli hammasini BITTA ustoz — sinf rahbari
//  beradi. Shuning uchun «Sinf fanlari» sahifasida standart soatlar
//  qo'llanganda ustoz qidirib o'tirilmaydi: fanlar to'g'ridan-to'g'ri
//  o'sha rahbarga biriktiriladi.
//
//  UCHTA FAN bundan MUSTASNO — ular MUTAXASSIS ustozniki:
//    · chet tili (ingliz/nemis/fransuz; rus sinfida «иностранный язык»)
//    · jismoniy tarbiya
//    · informatika (va axborot texnologiyalari)
//
//  «Kelajak soati» — alohida qoida: u fan emas, SINF SOATI, shuning
//  uchun 1-sinfdan 11-sinfgacha HAR sinfda sinf rahbarida turadi
//  (boshlang'ich sinf chegarasi unga qo'llanmaydi).
//
//  ⚠️ NEGA NAQSH BO'YICHA. Maktablar ayni fanni har xil nomlaydi:
//  «Chet tili», «Ingliz tili», «Informatika va AT», «Физкультура»…
//  Aniq ro'yxat bilan solishtirsak, biroz boshqacha yozilgan nom
//  e'tibordan chetda qolar va rahbarga BEGONA fan biriktirilardi.
//  Shuning uchun nom `normName()` dan o'tkazilib, naqsh bo'yicha
//  tekshiriladi.
//
import { normName } from "./curriculum";
import { isFixedMondaySubject } from "./scheduleCore";
import { PRIMARY_MAX_GRADE } from "./homeroom";

// `normName()` apostrof, tinish belgisi va ortiqcha probelni olib tashlab,
// nomni kichik harfga keltiradi — naqshlar shu shaklga yozilgan.
const SPECIALIST_RE = [
  // ——— Chet tili ———
  /(chet|xorijiy)\s*til|ingliz|ingiliz|nemis|fransuz|franzuz|english|deutsch|francais/,
  /иностранн|английск|немецк|французск|инглиз|чет тил|хорижий тил/,
  // ——— Jismoniy tarbiya ———
  /jismoniy|jismon\b/,
  /физическ|физкультур|физ ра|жисмоний/,
  // ——— Informatika ———
  /informatika|informatsion texnologiya|axborot texnologiya|\bikt\b/,
  /информатик|информационны[ех] технологи|ахборот технология|\bикт\b/,
];

/** Fan mutaxassis ustozniki (sinf rahbariga biriktirilmaydi)mi? */
export function isSpecialistSubject(name) {
  const k = normName(name);
  return Boolean(k) && SPECIALIST_RE.some((re) => re.test(k));
}

/**
 * Standart soatlar qo'llanganda shu fan SINF RAHBARIGA biriktiriladimi?
 *
 * @param {{name?: string}} subject — fan (nomi bo'yicha aniqlanadi)
 * @param {number} grade — sinf raqami (1…11)
 */
export function homeroomTakesSubject(subject, grade) {
  const g = Number(grade || 0);
  // «Kelajak soati» — 1–11 sinfda, har doim rahbarda
  if (isFixedMondaySubject(subject)) return g >= 1 && g <= 11;
  // Qolgan fanlar — faqat boshlang'ich sinfda va mutaxassis fani bo'lmasa
  if (g < 1 || g > PRIMARY_MAX_GRADE) return false;
  return !isSpecialistSubject(subject?.name);
}
