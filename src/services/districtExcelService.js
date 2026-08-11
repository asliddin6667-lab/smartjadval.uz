// =====================================================================
//  smartjadval — districtExcelService.js
//
//  Tuman admini yuklagan Excel ma'lumotlari (ustozlar, soat setkasi,
//  dars jadvali) uchun Supabase CRUD.
//
//  Joylashuvi: src/services/districtExcelService.js
//  RLS: tuman admini faqat o'z tumani ma'lumotlarini ko'radi/yozadi
//  (district_excel_data.sql skriptida sozlangan).
// =====================================================================
import { supabase } from "./supabaseClient";

const TABLE = "district_excel_data";

/**
 * Tumanning barcha Excel ma'lumotlarini yuklab, frontend uchun qulay
 * store ko'rinishiga keltiradi:
 *   { [schoolId]: { teachers: {...}, setka: {...}, jadval: {...} } }
 *
 * RLS o'zi filtrlaydi — tuman admini faqat o'z tumanini oladi.
 */
export async function fetchExcelStore() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("school_id, data_type, file_name, rows, classes, uploaded_at");

  if (error) throw new Error(error.message || "Excel ma'lumotlarini yuklab bo'lmadi");

  const store = {};
  for (const row of data || []) {
    if (!store[row.school_id]) store[row.school_id] = {};
    store[row.school_id][row.data_type] = {
      fileName: row.file_name || "",
      rows: Array.isArray(row.rows) ? row.rows : [],
      classes: Array.isArray(row.classes) ? row.classes : undefined,
      uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).getTime() : 0,
    };
  }
  return store;
}

/**
 * Bitta maktab uchun bitta tur ma'lumotini saqlash (upsert).
 * Avval yuklangan bo'lsa — ustidan yoziladi.
 */
export async function upsertExcelData({ schoolId, districtId, type, fileName, rows, classes }) {
  if (!districtId) throw new Error("Tuman aniqlanmadi — qaytadan login qiling");

  const { error } = await supabase.from(TABLE).upsert(
    {
      school_id: schoolId,
      district_id: districtId,
      data_type: type,
      file_name: fileName || null,
      rows: rows || [],
      classes: classes || null,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "school_id,data_type" }
  );

  if (error) throw new Error(error.message || "Serverga saqlab bo'lmadi");
}

/** Bitta maktabning bitta tur ma'lumotini o'chirish. */
export async function deleteExcelData(schoolId, type) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("school_id", schoolId)
    .eq("data_type", type);

  if (error) throw new Error(error.message || "O'chirib bo'lmadi");
}
