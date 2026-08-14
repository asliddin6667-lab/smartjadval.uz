// =====================================================================
//  Analytics.jsx — VAKANSIYA VA YUKLAMA TAHLILI (qayta eksport)
//
//  DIQQAT: bu faylda ilgari VacancyAnalysis moduli TO'LIQ NUSXALANGAN
//  edi. Ikkita nusxa bo'lgani uchun `VacancyAnalysis.jsx` ga kiritilgan
//  o'zgarishlar maktab panelida ko'rinmay qolardi (tuman paneli
//  `./VacancyAnalysis` dan, maktab paneli esa shu fayldan import
//  qilardi).
//
//  Endi yagona manba — `src/pages/VacancyAnalysis.jsx`.
//  Bu fayl faqat qayta eksport qiladi, shuning uchun eski importlar
//  (`from "./Analytics"`) sinmaydi:
//
//    import VacancyAnalysis from "./Analytics";            // default
//    import { computeVacancy } from "./Analytics";          // named
//
//  Yangi kod yozganda to'g'ridan-to'g'ri "./VacancyAnalysis" dan
//  import qilish tavsiya etiladi.
// =====================================================================

export {
  default,
  computeVacancy,
  vacancySummaryText,
  poolSignature,
  VacancyBadge,
  VacancyReport,
  DEFAULT_MAX_HOURS,
} from "./VacancyAnalysis";
