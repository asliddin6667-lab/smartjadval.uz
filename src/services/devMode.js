// =====================================================================
//  smartjadval.UZ — LOKAL REJIM (dev mode)
//
//  MAQSAD: kompyuterda `npm run dev` bilan ishlaganda ilova bulutdan
//  UZILADI. Ya'ni sinov uchun kiritilgan sinflar, ustozlar va jadval
//  Supabase'ga YOZILMAYDI va bulutdagi haqiqiy ma'lumot ustidan
//  yozib yuborilmaydi.
//
//  QANDAY ISHLAYDI:
//    npm run dev    -> import.meta.env.DEV = true  -> LOKAL REJIM (bulut o'chiq)
//    npm run build  -> import.meta.env.DEV = false -> bulut YOQIQ (odatdagidek)
//
//  Ya'ni saytga deploy bo'ladigan build hech qanday o'zgarishsiz,
//  avvalgidek ishlaydi — bu qulf faqat dev serverda ta'sir qiladi.
//
//  ATAYLAB BULUTNI YOQISH (lokalda haqiqiy sinxronizatsiyani sinash uchun):
//    Brauzer Console'da:
//        localStorage.setItem("smartjadval_cloud_sync", "on"); location.reload();
//    Qaytarish:
//        localStorage.removeItem("smartjadval_cloud_sync"); location.reload();
//
//    Yoki loyiha ildizida `.env.local` fayl ochib:
//        VITE_CLOUD_SYNC=on
//
//  DIQQAT: `npm run preview` production build'ni ko'rsatadi — u yerda
//  bulut YOQIQ bo'ladi. Xavfsiz sinov uchun doim `npm run dev` ishlating.
// =====================================================================

const OVERRIDE_KEY = "smartjadval_cloud_sync";

function overrideValue() {
  try {
    return localStorage.getItem(OVERRIDE_KEY);
  } catch {
    return null; // localStorage bloklangan bo'lsa — e'tiborsiz
  }
}

// Bulutga yozish/o'qish o'chirilganmi?
export function isLocalOnly() {
  // Production build — bulut doim yoqiq
  if (!import.meta.env.DEV) return false;

  // Ataylab yoqilganmi? (localStorage yoki .env.local)
  if (overrideValue() === "on") return false;
  if (import.meta.env.VITE_CLOUD_SYNC === "on") return false;

  return true;
}

// ---------------------------------------------------------------------
//  KALIT PREFIKSI — lokal sinov ma'lumoti ALOHIDA "qutida" yotadi
//
//  Lokal rejimda barcha localStorage kalitlari `smartjadval_dev_` bilan
//  boshlanadi. Bulutga yuboradigan kod esa faqat `smartjadval_` ni
//  o'qiydi. Shu sababli lokalda kiritilgan sinov ma'lumoti bulutga
//  chiqishi JISMONAN mumkin emas — keyinchalik bulutni yoqib qo'ysangiz
//  ham, u boshqa kalitlarga qaraydi.
// ---------------------------------------------------------------------
export function storagePrefix() {
  return isLocalOnly() ? "smartjadval_dev_" : "smartjadval_";
}

// Lokal sinov ma'lumotini butunlay o'chirish. Faqat dev serverda
// `window.smartjadvalWipeLocal()` sifatida ulanadi (pastda) — saytdagi
// build'da bu funksiya umuman mavjud bo'lmaydi.
export function wipeLocalData() {
  if (typeof localStorage === "undefined") return 0;
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("smartjadval_")) doomed.push(k);
  }
  for (const k of doomed) {
    try { localStorage.removeItem(k); } catch { /* e'tiborsiz */ }
  }
  return doomed.length;
}

// Bulut yoqiq/o'chiqligini bir marta konsolga chiqaramiz — dev serverda
// qaysi rejimda ishlayotganingiz ko'rinib tursin.
let announced = false;
export function announceMode() {
  if (announced || typeof console === "undefined") return;
  announced = true;

  // Tozalash yordamchisi — FAQAT dev serverda mavjud bo'ladi
  if (import.meta.env.DEV && typeof window !== "undefined") {
    window.smartjadvalWipeLocal = () => {
      const n = wipeLocalData();
      console.log(`🧹 ${n} ta kalit o'chirildi. Sahifa yangilanmoqda...`);
      location.reload();
    };
  }
  if (isLocalOnly()) {
    console.log(
      "%c🔌 LOKAL REJIM — bulut uzilgan",
      "background:#7c3aed;color:#fff;padding:3px 8px;border-radius:6px;font-weight:700",
      "\nMa'lumotlar faqat shu brauzerda, `smartjadval_dev_` kalitlarida saqlanadi." +
      "\nSupabase'dagi haqiqiy maktab ma'lumotiga TEGILMAYDI." +
      "\nSinov ma'lumotini tozalash: smartjadvalWipeLocal()" +
      "\nBulutni yoqish: localStorage.setItem(\"smartjadval_cloud_sync\",\"on\"); location.reload();"
    );
  } else if (import.meta.env.DEV) {
    console.log(
      "%c☁️ BULUT YOQIQ (lokal serverda)",
      "background:#dc2626;color:#fff;padding:3px 8px;border-radius:6px;font-weight:700",
      "\nDIQQAT: o'zgarishlar HAQIQIY bazaga yoziladi!" +
      "\nO'chirish: localStorage.removeItem(\"smartjadval_cloud_sync\"); location.reload();"
    );
  }
}
