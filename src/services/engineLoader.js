// =====================================================================
//  JADVAL TUZISH DVIGATELINI SERVERDAN YUKLASH
//
//  NIMA UCHUN KERAK:
//  Ma'lumot allaqachon himoyalangan — obunasiz foydalanuvchi bulutga
//  hech narsa yoza olmaydi (RLS: has_active_sub()). Lekin jadval TUZISH
//  brauzerda bajarilardi, ya'ni bundle'ni patch qilgan odam obunasiz
//  ham jadval tuzib, Excel'ga chiqarib olishi mumkin edi.
//
//  Endi dvigatel (src/engine/scheduleEngine.js) bundle'ga UMUMAN
//  kirmaydi. Ilova uni ishga tushirish paytida `schedule-engine`
//  Edge Function'idan so'raydi; funksiya esa avval obunani tekshiradi
//  va faqat shundan keyin kodni beradi.
//
//  BU KRIPTOGRAFIK HIMOYA EMAS: obunasi bor odam kodni tarmoq
//  panelidan saqlab qolishi mumkin. Maqsad — "eshikni qulflash":
//  obunasi YO'Q odamda dvigatel umuman bo'lmaydi.
//
//  Yuklash yo'li: fetch (Authorization header bilan) -> matn ->
//  Blob -> dynamic import. `import(url)` header yubora olmaydi,
//  shuning uchun avval fetch qilinadi; eval ishlatilmaydi — kod
//  oddiy ES modul sifatida yuklanadi.
// =====================================================================
import { SUPABASE_FN_URL, ANON_KEY } from "./supabaseClient";
import { getFreshSession } from "./authService";

// Supabase'da deploy qilingan funksiya nomi
const ENGINE_FN = "schedule-engine";

// Yuklangan modul (sessiya davomida bir marta olinadi)
let engine = null;
// Ayni paytda ketayotgan yuklash — ikki marta so'ralmasin
let pending = null;

export function isEngineLoaded() {
  return !!engine;
}

export async function loadEngine() {
  if (engine) return engine;
  if (pending) return pending;

  pending = (async () => {
    // ——— LOKAL REJIM (`npm run dev`) ———
    // Dev serverda dvigatel to'g'ridan-to'g'ri manbadan olinadi:
    // Edge Function deploy qilinmagan bo'lsa ham ishlab turaversin.
    // `import.meta.env.DEV` production build'da `false` ga aylanadi va
    // Vite butun shoxni (import bilan birga) olib tashlaydi — tekshiruv:
    // npm run build && npm run check:bundle
    if (import.meta.env.DEV) {
      const mod = await import("../engine/scheduleEngine.js");
      engine = mod;
      return mod;
    }

    // Token eskirgan bo'lsa yangilanadi (authService dagi naqsh)
    const session = await getFreshSession();

    let res;
    try {
      res = await fetch(`${SUPABASE_FN_URL}/${ENGINE_FN}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
        },
      });
    } catch {
      throw new Error(
        "Jadval tuzish moduli yuklanmadi — internetga ulanishni tekshiring va qayta urinib ko'ring."
      );
    }

    if (res.status === 402 || res.status === 403) {
      throw new Error(
        "Obuna faol emas — jadval tuzish serverda bloklandi. To'lovni rasmiylashtirgach qayta urinib ko'ring."
      );
    }
    if (res.status === 401) {
      throw new Error("Sessiya muddati tugagan. Sahifani yangilab, qaytadan kiring.");
    }
    if (!res.ok) {
      throw new Error(`Jadval tuzish moduli yuklanmadi (server javobi: ${res.status}).`);
    }

    const code = await res.text();
    if (!code || code.length < 1000) {
      throw new Error("Jadval tuzish moduli buzuq keldi. Sahifani yangilab ko'ring.");
    }

    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (typeof mod.generateSchedule !== "function") {
        throw new Error("Jadval tuzish moduli tanilmadi.");
      }
      engine = mod;
      return mod;
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  try {
    return await pending;
  } finally {
    // Xato bo'lsa keyingi bosishda qayta urinish mumkin bo'lsin
    if (!engine) pending = null;
  }
}
