// =====================================================================
//  ZAXIRA NUSXA (JSON) — maktab ma'lumotini faylga yozish va qaytarish
//
//  Nima uchun: ma'lumot tasodifan o'chib ketsa (yoki bulut bo'sh blob
//  bilan ustidan yozilsa), qaytarishning yagona ishonchli yo'li — qo'lda
//  saqlangan JSON nusxa. Excel eksporti ma'lumotni TO'LIQ saqlamaydi
//  (id lar, sozlamalar, smenalar yo'q), shuning uchun tiklash uchun
//  faqat shu format ishlatiladi.
//
//  Fayl formati (v1):
//    {
//      "app": "smartjadval", "type": "school-backup", "version": 1,
//      "exportedAt": "2026-08-18T09:00:00.000Z",
//      "schoolName": "...",
//      "counts": { "classes": 12, ... },
//      "data": { settings, classes, subjects, teachers, classSubjects,
//                rooms, timeslots, lunchGroups, shifts, schedule }
//    }
//
//  O'qishda "data" o'ramisiz, kalitlari to'g'ridan-to'g'ri ildizda turgan
//  JSON ham qabul qilinadi — qo'lda yasalgan fayl ham ishlaydi.
// =====================================================================
import { SYNC_KEYS, EMPTY } from "./cloudSync";

export const BACKUP_VERSION = 1;

// Kalit massivmi yoki obyektmi — EMPTY dan aniqlanadi (yagona manba)
function isArrayKey(key) {
  return Array.isArray(EMPTY[key]);
}

function countOf(key, value) {
  if (isArrayKey(key)) return Array.isArray(value) ? value.length : 0;
  if (key === "schedule") {
    // jadvaldagi darslar soni: schedule[kun][slotId] = [dars, ...]
    let n = 0;
    Object.values(value || {}).forEach((bySlot) => {
      Object.values(bySlot || {}).forEach((list) => {
        if (Array.isArray(list)) n += list.length;
      });
    });
    return n;
  }
  return Object.keys(value || {}).length;
}

// Ekranda ko'rsatiladigan nomlar
export const KEY_LABELS = {
  settings: "Sozlamalar",
  classes: "Sinflar",
  subjects: "Fanlar",
  teachers: "O'qituvchilar",
  classSubjects: "Sinf-fan yuklamasi",
  rooms: "Xonalar",
  timeslots: "Dars vaqtlari",
  lunchGroups: "Obed guruhlari",
  shifts: "Smenalar",
  schedule: "Dars jadvali (darslar)",
};

// ——— Zaxira obyektini yig'ish ———
export function buildBackup(data, { schoolName = "" } = {}) {
  const payload = {};
  const counts = {};
  SYNC_KEYS.forEach((k) => {
    const v = data?.[k];
    payload[k] = v === undefined || v === null ? EMPTY[k] : v;
    counts[k] = countOf(k, payload[k]);
  });
  return {
    app: "smartjadval",
    type: "school-backup",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    schoolName: String(schoolName || data?.settings?.schoolName || ""),
    counts,
    data: payload,
  };
}

function safeFileName(schoolName) {
  const base = String(schoolName || "maktab")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40) || "maktab";
  return `smartjadval_zaxira_${base}_${new Date().toISOString().slice(0, 10)}.json`;
}

// ——— Faylga yozib, brauzerdan yuklab olish ———
export function downloadBackup(data, { schoolName = "" } = {}) {
  const backup = buildBackup(data, { schoolName });
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(backup.schoolName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup;
}

// ——— JSON matnini o'qish va tekshirish ———
// Qaytaradi: { data, counts, keys, meta }
//   data  — faqat faylda BOR va turi to'g'ri kalitlar
//   keys  — tiklanadigan kalitlar ro'yxati
// Xato bo'lsa Error tashlaydi.
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || ""));
  } catch {
    throw new Error("Fayl JSON formatida emas");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Fayl ichida obyekt yo'q");
  }

  // "data" o'rami bo'lmasa — ildizning o'zi ma'lumot deb qaraladi
  const src = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;

  const data = {};
  const counts = {};
  const bad = [];
  SYNC_KEYS.forEach((k) => {
    const v = src[k];
    if (v === undefined || v === null) return;      // faylda yo'q — tegilmaydi
    const wantArray = isArrayKey(k);
    const okType = wantArray ? Array.isArray(v) : typeof v === "object" && !Array.isArray(v);
    if (!okType) {
      bad.push(k);
      return;
    }
    data[k] = v;
    counts[k] = countOf(k, v);
  });

  const keys = Object.keys(data);
  if (!keys.length) {
    throw new Error(
      bad.length
        ? `Ma'lumot turlari noto'g'ri: ${bad.join(", ")}`
        : "Faylda tanish ma'lumot topilmadi (sinflar, fanlar, jadval …)"
    );
  }

  return {
    data,
    counts,
    keys,
    bad,
    meta: {
      version: Number(raw.version) || null,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : null,
      schoolName: typeof raw.schoolName === "string" ? raw.schoolName : "",
    },
  };
}
