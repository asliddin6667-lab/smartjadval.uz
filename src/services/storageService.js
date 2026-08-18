// =====================================================================
//  localStorage bilan ishlash
//
//  KALIT PREFIKSI REJIMGA BOG'LIQ:
//    lokal rejim (npm run dev) -> "smartjadval_dev_..."
//    bulut yoqiq (sayt)        -> "smartjadval_..."
//
//  NIMA UCHUN: lokalda kiritilgan sinov ma'lumoti ALOHIDA "qutida"
//  yotadi. Bulutga yuboradigan kod (cloudSync) faqat oddiy prefiksni
//  o'qiydi — demak lokal sinov ma'lumoti bulutga chiqishi JISMONAN
//  mumkin emas, hatto keyinchalik bulut yoqib qo'yilsa ham.
//
//  Prefiks modul yuklanganda BIR MARTA hisoblanadi — rejim almashuvi
//  sahifani yangilashni talab qiladi (devMode.js da shunday yozilgan).
// =====================================================================
import { storagePrefix } from "./devMode";

const PREFIX = storagePrefix();

export function loadData(key, fallback = []) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function saveData(key, value) {
  localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
}

export function removeData(key) {
  localStorage.removeItem(`${PREFIX}${key}`);
}

export function loadUserData(userId, key, fallback = []) {
  if (!userId) return fallback;
  return loadData(`user_${userId}_${key}`, fallback);
}

export function saveUserData(userId, key, value) {
  if (!userId) return;
  saveData(`user_${userId}_${key}`, value);
}
