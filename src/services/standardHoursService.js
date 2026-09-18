// =====================================================================
//  STANDART SOATLAR (tayanch o'quv reja) — bulut xizmati
//
//  Superadmin "Standart soatlar" sahifasida qaysi sinfda qaysi fan
//  necha soat bo'lishini belgilaydi. Ma'lumot Supabase'dagi
//  `standard_hours` jadvalida BITTA qatorda (id = 'global') JSONB
//  ko'rinishida yotadi:
//      { uz: [ { name, aliases[], h: { 1: 4, 2: 4, ... } } ], ru: [ ... ] }
//
//  Oddiy foydalanuvchi "⚡ Standart soatlar" tugmasini bosganda shu
//  ma'lumot ishlatiladi. Internet yo'q / jadval hali yaratilmagan bo'lsa —
//  localStorage keshi, u ham bo'lmasa ichki DEFAULT_CURRICULUM.
//
//  DIQQAT: bu maktab ma'lumoti EMAS — u lokal rejimda ham (npm run dev)
//  haqiqiy Supabase'dan o'qiladi, xuddi superadmin RPC lari kabi.
//  Jadval SQL si: standard_hours_setup.sql (Supabase SQL Editor'da bir marta).
// =====================================================================
import { supabase } from "./supabaseClient";
import { loadData, saveData } from "./storageService";
import { DEFAULT_CURRICULUM, normalizeCurriculum, withCurriculumDefaults, syncCurriculumHours } from "../utils/curriculum";

const CACHE_KEY = "standard_hours";
const ROW_ID = "global";

/* O'QISH yo'lining yagona tayyorlovchisi:
     1) bo'sh qolgan til ichki rejadan to'ldiriladi (`withCurriculumDefaults`);
     2) rus qatorlarining soati o'zbek juftidan olinadi (`syncCurriculumHours`).
   Ikkinchisi tufayli rus va o'zbek sinflari BIR XIL soat oladi, bulutda
   qanday yozuv turgan bo'lsa ham. Saqlashda qo'llanmaydi — bazaga
   superadmin yozgan narsa boradi. */
function forUse(c) {
  return syncCurriculumHours(withCurriculumDefaults(c));
}

// Keshdagi (yoki ichki) reja — sinxron, sahifa ochilishi bilan ishlatiladi
export function getCachedCurriculum() {
  const cached = normalizeCurriculum(loadData(CACHE_KEY, null));
  // Bo'sh qolgan til (odatda `ru`) ichki rejadan to'ldiriladi
  return cached ? forUse(cached) : DEFAULT_CURRICULUM;
}

/**
 * Bulutdan standart soatlarni o'qiydi.
 * @returns {Promise<{data: {uz: [], ru: []}, updatedAt: string|null, source: "cloud"|"cache"|"default"}>}
 */
export async function fetchStandardHours() {
  try {
    const { data, error } = await supabase
      .from("standard_hours")
      .select("data, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) throw error;

    const clean = normalizeCurriculum(data?.data);
    if (clean) {
      // Keshga bulutdagi holat AYNAN yoziladi; zaxira faqat qaytariladigan
      // qiymatga qo'llanadi, aks holda ichki reja bazadagidek ko'rinardi.
      saveData(CACHE_KEY, clean);
      return { data: forUse(clean), updatedAt: data?.updated_at || null, source: "cloud" };
    }
  } catch {
    // jadval yo'q / internet yo'q — keshga tushamiz
  }

  const cached = normalizeCurriculum(loadData(CACHE_KEY, null));
  if (cached) return { data: forUse(cached), updatedAt: null, source: "cache" };
  return { data: DEFAULT_CURRICULUM, updatedAt: null, source: "default" };
}

/**
 * Superadmin: standart soatlarni saqlaydi (RLS faqat superadminga ruxsat beradi).
 */
export async function saveStandardHours(curriculum) {
  const clean = normalizeCurriculum(curriculum);
  if (!clean) throw new Error("Saqlash uchun kamida bitta fan va soat kiriting");

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id || null;
  if (!userId) throw new Error("Sessiyangiz muddati tugagan. Sahifani yangilab, qaytadan kiring.");

  const { error } = await supabase
    .from("standard_hours")
    .upsert({ id: ROW_ID, data: clean, updated_at: new Date().toISOString(), updated_by: userId });

  if (error) {
    if (String(error.message || "").includes("standard_hours")) {
      throw new Error("standard_hours jadvali topilmadi — standard_hours_setup.sql ni Supabase SQL Editor'da ishga tushiring");
    }
    throw new Error(error.message || "Saqlashda xatolik");
  }

  saveData(CACHE_KEY, clean);
  return clean;
}
