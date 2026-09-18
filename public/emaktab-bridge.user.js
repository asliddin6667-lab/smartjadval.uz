// ==UserScript==
// @name         Smartjadval → eMaktab ko'prigi
// @namespace    https://smartjadval.uz/
// @version      1.7.0
// @description  Smartjadval.uz da tuzilgan dars jadvalini eMaktab (kundalik.com) «Darslar jadvali sxemasi» setkasiga joylashtiradi
// @author       smartjadval.uz
// @match        https://schools.emaktab.uz/*
// @match        https://*.emaktab.uz/*
// @match        https://*.kundalik.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// @updateURL    https://smartjadval.uz/emaktab-bridge.user.js
// @downloadURL  https://smartjadval.uz/emaktab-bridge.user.js
// ==/UserScript==

// ⚠️ SKRIPTGA TEGSANGIZ `@version` NI OSHIRING.
//
//  Tampermonkey yangilanishni FAQAT versiya raqami bo'yicha aniqlaydi:
//  fayl o'zgarsa-yu raqam o'sha qolsa, o'rnatilgan nusxa eski holicha
//  ishlab yuraveradi va tuzatishlar foydalanuvchiga yetib bormaydi.

// =====================================================================
//  SMARTJADVAL → eMAKTAB KO'PRIGI
//
//  NEGA KERAK: eMaktab sessiyasi cookie bilan ishlaydi, smartjadval.uz
//  esa boshqa domen — u yerdan so'rov yuborib bo'lmaydi (CORS). Shuning
//  uchun ko'chirish eMaktab sahifasining O'ZIDA, foydalanuvchi nomidan
//  bajariladi.
//
//  ISHLATISH (ikki yo'l):
//    1) Tampermonkey — shu faylni o'rnating, eMaktab sahifasida
//       o'ng pastda «SJ» tugmasi chiqadi.
//    2) Tampermonkeysiz — Smartjadval «eMaktab» bo'limidagi tugma
//       skriptni nusxalab beradi, uni eMaktab sahifasida F12 →
//       Console ga qo'yib Enter bosiladi.
//
//  ISHLASHI: jadval JSON'i qo'yiladi, sinf tanlanadi va
//  «▶ Joylashtirish» bosiladi. Darslar eMaktab'ning O'Z API'si orqali
//  yaratiladi (5-QISM) — oyna ochib-yopib o'tirilmaydi. API javob
//  bermasa DOM orqali ishlaydigan zaxira yo'l qoladi (6-QISM).
//
//  «🔍 O'rganish» rejimi — nosozlik uchun: eMaktab so'rov shaklini
//  o'zgartirsa, bitta darsni qo'lda qo'shib yozuvni olish va API
//  ta'rifini yangilash mumkin.
//
//  ⚠️ SKRIPT «NASHR ETISH» NI BOSMAYDI. U faqat SXEMANI to'ldiradi.
//     Nashr — haqiqiy jurnallarga ta'sir qiladi, uni siz o'zingiz,
//     ko'zdan kechirib bosasiz.
// =====================================================================

(function () {
  "use strict";

  // ⚠️ SKRIPT IKKINCHI MARTA QO'YILGANDA JADVAL O'QILISHI SHART.
  //
  //  «⚡ Hammasi birga» matni `window.__SJ_JADVAL__ = {...}` bilan
  //  boshlanadi va keyin shu skript keladi. Panel allaqachon qurilgan
  //  bo'lsa oddiygina `return` qilish YETMAYDI — yangi jadval
  //  o'zgaruvchiga yozilgan bo'lsa ham e'tiborsiz qolar va foydalanuvchi
  //  «nega eski jadval turibdi?» deb qolardi.
  if (window.__SJ_BRIDGE__) {
    window.__SJ_BRIDGE__.ochish();
    window.__SJ_BRIDGE__.yangiJadval();
    return;
  }

  // ⚠️ FAQAT DARS JADVALI BO'LIMIDA ISHLAYDI.
  //
  //  `@match` butun `*.emaktab.uz` ni qamraydi (URL oldindan ma'lum
  //  emas edi), lekin panel jurnallarda, hisobotlarda, sinflar
  //  ro'yxatida — hech qayerda kerak emas. U yerlarda «SJ» tugmasi
  //  faqat xalaqit beradi. Konsolga qo'lda qo'yilganda esa cheklov
  //  ishlamasligi kerak: foydalanuvchi ataylab ishga tushirgan bo'ladi.
  const QOLDA = typeof GM_info === "undefined";   // Tampermonkeysiz — Console
  if (!QOLDA && !/\/v2\/schedules/i.test(location.pathname)) return;

  // Qabul qilinadigan jadval formati versiyalari (emaktabExport.js dagi
  // `EMAKTAB_FORMAT_VERSION`). 2 — `emaktab` id xaritasi bilan, 1 — usiz
  // (u holda nomlar bo'yicha moslashtirish ishlaydi).
  const V = [1, 2];
  const LS_MAP = "sj_emaktab_map_v1";       // qo'lda moslashtirilgan nomlar
  const LS_JADVAL = "sj_emaktab_jadval_v1"; // oxirgi jadval (sinflar bo'ylab yuriladi)
  const LS_OCHIQ = "sj_emaktab_panel_ochiq"; // panel ochiq turganmi
  const LS_REC_ON = "sj_emaktab_rec_on";     // «O'rganish» yozuvi yoqiqmi
  const LS_REC = "sj_emaktab_rec_data";      // yozib olingan so'rovlar

  // ⚠️ eMAKTAB — KLASSIK KO'P SAHIFALI SAYT.
  //
  //  Har bosilgan havola butun sahifani qaytadan yuklaydi, ya'ni skript
  //  ham noldan ishga tushadi va panel yopiq holatga qaytadi. 40+ sinfni
  //  birma-bir o'tkazayotganda buni har safar qayta ochish zerikarli.
  //  Sahifa yangilanishini to'xtatib bo'lmaydi — lekin panelning holatini
  //  eslab qolish mumkin.
  const ochiqEdi = (() => {
    try { return localStorage.getItem(LS_OCHIQ) === "1"; } catch { return false; }
  })();
  const ochiqYoz = (v) => {
    try { localStorage.setItem(LS_OCHIQ, v ? "1" : "0"); } catch { /* e'tiborsiz */ }
  };

  // ===================================================================
  //  1-QISM. NOM MOSLASHTIRISH
  //  (src/utils/emaktabNames.js ning nusxasi — bu skript boshqa domenda
  //   mustaqil ishlaydi, import qila olmaydi. O'sha fayl o'zgarsa —
  //   bu yer ham yangilansin.)
  // ===================================================================
  const CYR = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"j",з:"z",и:"i",й:"y",
    к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
    х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sh",ъ:"",ы:"i",ь:"",э:"e",ю:"yu",я:"ya",
    ў:"o",қ:"q",ғ:"g",ҳ:"h",ҷ:"j",
  };
  const APOS = /['‘’ʻʼ´`]/g;

  // Natija keshlanadi: bitta dars uchun yuzlab taqqoslash bo'ladi va
  // ro'yxat variantlari har safar ayni nomlar bilan qaytadi.
  const NK_CACHE = new Map();

  function normKey(raw) {
    const src = String(raw == null ? "" : raw);
    if (NK_CACHE.has(src)) return NK_CACHE.get(src);
    const s = src.toLowerCase().replace(APOS, "");
    let out = "";
    for (const ch of s) out += Object.prototype.hasOwnProperty.call(CYR, ch) ? CYR[ch] : ch;
    out = out.replace(/[^a-z0-9]/g, "");
    if (NK_CACHE.size < 5000) NK_CACHE.set(src, out);
    return out;
  }

  // ⚠️ HARF QISMI BIR NECHTA SO'ZDAN IBORAT BO'LISHI MUMKIN.
  //
  //  eMaktabda «2 A O» va «2A» — IKKITA BOSHQA sinf. Ilgari faqat
  //  birinchi harf olinardi (`[A-Za-z]{0,3}` bo'shliqda to'xtardi) va
  //  ikkalasi ham `2a` kalitini berardi — sinflar to'qnashib biri
  //  yo'qolardi (jonli maktabda 43 sinfdan 41 tasi qolgan edi).
  //  «sinf», «(rus)» kabi qo'shimchalarda to'xtaymiz.
  //  ⚠️ src/utils/emaktabNames.js dagi `parseClassName` bilan BIR XIL.
  function classKey(raw) {
    const s = String(raw == null ? "" : raw).replace(APOS, "").trim();
    const m = s.match(/(\d{1,2})\s*[-–—_. ]?\s*([\s\S]*)$/);
    if (!m) return normKey(s);
    const d = Number(m[1]) || 0;
    if (!d) return normKey(s);
    let harf = "";
    for (const soz of String(m[2] || "").split(/[\s\-–—_.]+/)) {
      if (!soz) continue;
      if (!/^[A-Za-zЀ-ӿ]{1,3}$/.test(soz)) break;
      harf += normKey(soz);
    }
    return d + harf;
  }

  function teacherKeys(raw) {
    const s = String(raw == null ? "" : raw).replace(APOS, "").trim();
    const w = s.split(/[\s.]+/).filter(Boolean);
    if (!w.length) return { toliq: "", qisqa: "" };
    return {
      toliq: normKey(s),
      qisqa: normKey(w[0]) + w.slice(1).map((x) => (normKey(x)[0] || "")).join(""),
    };
  }

  function sameTeacher(a, b) {
    const x = teacherKeys(a), y = teacherKeys(b);
    if (!x.qisqa || !y.qisqa) return false;
    return x.toliq === y.toliq || x.qisqa === y.qisqa;
  }

  // ⚠️ src/utils/emaktabNames.js dagi SUBJECT_SYNONYMS bilan AYNI
  // bo'lishi shart. Ilgari bu yerda qisqartirilgan nusxa turardi va
  // «Tabiiy fan (Science)» yo'q edi — natijada o'sha dars jonli
  // maktabda «mos nom topilmadi» bo'lib tushmay qoldi.
  const SYN = [
    ["Ona tili","Родной язык"],
    ["Ona tili va o'qish savodxonligi","Русский язык и грамотность чтения"],
    ["O'qish savodxonligi","Грамотность чтения","Чтение"],
    ["Adabiyot","Литература"],
    ["Badiiy adabiyot","Художественная литература"],
    ["Ifodali o'qish","Выразительное чтение"],
    ["Sinfdan tashqari o'qish","Внеклассное чтение"],
    ["Alifbe","Азбука","Букварь"],
    ["Yozuv","Письмо"],
    ["Husnixat","Чистописание"],
    ["Nutq o'stirish","Развитие речи"],
    ["O'zbek tili","Узбекский язык"],
    ["Ingliz tili","Английский язык","English"],
    ["Rus tili","Русский язык"],
    ["Matematika","Математика"],
    ["Algebra","Алгебра"],
    ["Geometriya","Геометрия"],
    ["Mental arifmetika","Ментальная арифметика"],
    ["Mnemonika","Мнемоника"],
    ["Tabiatshunoslik","Природоведение"],
    ["Tabiiy fan (Science)","Естествознание (Science)","Естественные науки"],
    ["Biologiya","Биология"],
    ["Kimyo","Химия"],
    ["Fizika","Физика"],
    ["Astranomiya","Астрономия","Astronomiya"],
    ["Geografiya","География"],
    ["Tarix","История"],
    ["O'zbekiston tarixi","История Узбекистана"],
    ["Jahon tarixi","Всемирная история"],
    ["Tarixdan hikoyalar","Рассказы по истории"],
    ["Huquq","Право"],
    ["Davlat va huquq asoslari","Основы государства и права"],
    ["Iqtisodiy bilim asoslari","Основы экономических знаний"],
    ["Tadbirkorlik asoslari","Основы предпринимательства"],
    ["Tarbiya","Воспитание"],
    ["Kelajak soati","Час будущего"],
    ["Tanqidiy fikrlash","Критическое мышление"],
    ["Informatika","Информатика"],
    ["Informatika va axborot texnologiyalari","Информатика и информационные технологии"],
    ["Texnologiya","Технология","Mehnat","Труд"],
    ["Chizmachilik","Черчение"],
    ["Tasviriy san'at","Изобразительное искусство","Изо"],
    ["Musiqa","Музыка"],
    ["Musiqa madaniyati","Музыкальная культура"],
    ["Jismoniy tarbiya","Физическая культура","Jismoniy madaniyat","Физическое воспитание"],
    ["Chaqiruvga qadar boshlang'ich tayyorgarlik","Начальная допризывная подготовка"],
    ["Boshlang'ich ta'lim","Начальное образование"],
    ["Tanlov fanlari","Предметы по выбору"],
  ];
  const SYN_MAP = new Map();
  SYN.forEach((row, i) => row.forEach((n) => { const k = normKey(n); if (k && !SYN_MAP.has(k)) SYN_MAP.set(k, i); }));
  const synGroup = (s) => (SYN_MAP.has(normKey(s)) ? SYN_MAP.get(normKey(s)) : -1);

  // ⚠️ YOZUV TURI — "cyr" yoki "lat".
  //
  //  `normKey()` kirillni lotinga o'giradi, shuning uchun «Математика» va
  //  «Matematika» BIR XIL kalit beradi. eMaktab ro'yxatida ikkalasi ham
  //  bo'ladi (rus va o'zbek sinflari uchun) — kalit bo'yicha tanlasak
  //  birinchi uchragani olinadi va rus sinfiga lotincha fan tushadi.
  //  Undan keyin ustoz ro'yxati ham noto'g'ri fandan so'raladi.
  //  Shuning uchun bir xil kalitli nomzodlar orasidan nishon bilan AYNI
  //  yozuvdagisi tanlanadi.
  function scriptOf(raw) {
    const s = String(raw == null ? "" : raw);
    const cyr = (s.match(/[Ѐ-ӿ]/g) || []).length;
    const lat = (s.match(/[A-Za-z]/g) || []).length;
    if (cyr > lat) return "cyr";
    return lat > 0 ? "lat" : "";
  }

  // Ro'yxatdan eng mos elementni topish.
  // list — satrlar yoki { label } obyektlari. Qaytadi { qiymat, ishonch }.
  function bestMatch(target, list, kind) {
    const lab = (x) => (x == null ? "" : (typeof x === "string" ? x : String(x.label || x.name || x.text || "")));
    if (!target || !list || !list.length) return { qiymat: null, ishonch: "" };
    const nk = normKey(target);

    if (kind === "ustoz") {
      let f = list.find((x) => normKey(lab(x)) === nk);
      if (f) return { qiymat: f, ishonch: "aniq" };
      f = list.find((x) => sameTeacher(lab(x), target));
      if (f) return { qiymat: f, ishonch: "sinonim" };
      const fam = normKey(String(target).trim().split(/[\s.]+/)[0] || "");
      if (fam.length >= 4) {
        const byFam = list.filter((x) => normKey(lab(x)).startsWith(fam));
        if (byFam.length === 1) return { qiymat: byFam[0], ishonch: "qismiy" };
      }
      return { qiymat: null, ishonch: "" };
    }

    if (kind === "sinf") {
      const k = classKey(target);
      const f = list.find((x) => classKey(lab(x)) === k);
      return f ? { qiymat: f, ishonch: "aniq" } : { qiymat: null, ishonch: "" };
    }

    // Aniq moslik. Bir nechta nomzod bo'lsa («Математика» va «Matematika»
    // kaliti bir xil) — nishon bilan ayni yozuvdagisi olinadi.
    const sc = scriptOf(target);
    const aniq = list.filter((x) => normKey(lab(x)) === nk);
    if (aniq.length) {
      const bir = sc ? aniq.find((x) => scriptOf(lab(x)) === sc) : null;
      return { qiymat: bir || aniq[0], ishonch: "aniq" };
    }

    const g = synGroup(target);
    if (g >= 0) {
      const syn = list.filter((x) => synGroup(lab(x)) === g);
      if (syn.length) {
        const bir = sc ? syn.find((x) => scriptOf(lab(x)) === sc) : null;
        return { qiymat: bir || syn[0], ishonch: "sinonim" };
      }
    }
    if (nk.length >= 5) {
      const part = list.filter((x) => {
        const o = normKey(lab(x));
        return o.length >= 5 && (o.indexOf(nk) >= 0 || nk.indexOf(o) >= 0);
      });
      if (part.length === 1) return { qiymat: part[0], ishonch: "qismiy" };
    }
    return { qiymat: null, ishonch: "" };
  }

  // ===================================================================
  //  2-QISM. KICHIK YORDAMCHILAR
  // ===================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();

  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }

  // Shart bajarilguncha kutish (tanaffus bilan so'rov yubormaydi — faqat DOM tekshiradi)
  async function waitFor(fn, timeout = 8000, step = 60) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  // Qiymatni React/Angular/jQuery ham sezadigan qilib qo'yish
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    ["input", "change"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
    if (window.jQuery) { try { window.jQuery(el).trigger("change"); } catch { /* jQuery yo'q bo'lsa e'tiborsiz */ } }
  }

  // Haqiqiy sichqoncha bosishiga o'xshash ketma-ketlik (ba'zi vidjetlar
  // faqat mousedown/mouseup ni tinglaydi, click ni emas)
  function realClick(el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]
      .forEach((t) => {
        const E = t.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        try { el.dispatchEvent(new E(t, opts)); } catch { /* eski brauzer */ }
      });
    return true;
  }

  function hover(el) {
    if (!el) return;
    ["pointerover", "mouseover", "mouseenter", "mousemove"].forEach((t) => {
      try { el.dispatchEvent(new MouseEvent(t, { bubbles: t !== "mouseenter", cancelable: true, view: window })); } catch { /* */ }
    });
  }

  const cut = (s, n = 4000) => { const x = String(s == null ? "" : s); return x.length > n ? x.slice(0, n) + "…[qisqartirildi]" : x; };

  // ⚠️ eMAKTAB JSON'IDA ISMLAR QAYTA-QAYTA HTML-KODLANGAN.
  //
  //  `tlfe` javobida haqiqiy misol:
  //    "Inomjonov Ortiqjon Iqboljon o&amp;amp;#39;g&amp;amp;#39;li"
  //  ya'ni apostrof bir necha marta kodlangan (`'` → `&#39;` → `&amp;#39;` …).
  //  Bitta o'tishda yechilmaydi, shuning uchun o'zgarish to'xtagunicha
  //  takrorlanadi (ko'pi bilan 5 marta — cheksiz sikl bo'lmasin).
  //
  //  Bu eMaktabning O'Z ma'lumotidagi nuqson: ba'zi ismlar saqlashda
  //  kesilib ham qolgan («…o&amp;amp;amp;am»). Uni bu yerdan tuzatib
  //  bo'lmaydi — faqat ko'rinadigan qilamiz.
  function unesc(raw) {
    let s = String(raw == null ? "" : raw);
    const el = document.createElement("textarea");
    for (let i = 0; i < 5; i++) {
      if (!/&[a-z]+;|&#\d+;/i.test(s)) break;
      el.innerHTML = s;
      const next = el.value;
      if (next === s) break;
      s = next;
    }
    return s.trim();
  }

  // ===================================================================
  //  3-QISM. YOZUVCHI (o'rganish rejimi)
  //
  //  Foydalanuvchi BITTA darsni qo'lda qo'shadi — skript esa sahifa
  //  qanday so'rov yuborganini va qanday oyna ochilganini yozib oladi.
  //  Natija dasturchiga beriladi va aniq drayver yoziladi.
  // ===================================================================
  // ⚠️ YOZUV SAHIFA ALMASHGANDA HAM DAVOM ETISHI SHART.
  //
  //  Aniqlanishi kerak bo'lgan amallarning ko'pi (sxema yaratish,
  //  darslarni nashr etish) sahifani ALMASHTIRADI. Yozuv faqat xotirada
  //  turgan paytda o'sha almashuv uni o'chirib yuborardi — foydalanuvchi
  //  «yoqqandim, nima bo'ldi?» degan holatga tushardi.
  //
  //  Shuning uchun yozuv holati ham, yozib olingan so'rovlar ham
  //  localStorage da yuriladi va yangi sahifada davom ettiriladi.
  //  DOM nusxalari saqlanmaydi — ular og'ir va faqat joriy sahifaga
  //  tegishli; asosiy qiymat tarmoq so'rovlarida.
  const REC_MAX = 120;   // so'rovlar chegarasi (kvota to'lib ketmasin)

  const REC = {
    yoniq: (() => { try { return localStorage.getItem(LS_REC_ON) === "1"; } catch { return false; } })(),
    tarmoq: (() => {
      try { return JSON.parse(localStorage.getItem(LS_REC) || "[]") || []; } catch { return []; }
    })(),
    dom: [],
    obs: null,
  };

  function recSaqla() {
    if (!REC.yoniq) return;
    try {
      if (REC.tarmoq.length > REC_MAX) REC.tarmoq = REC.tarmoq.slice(-REC_MAX);
      localStorage.setItem(LS_REC, JSON.stringify(REC.tarmoq));
    } catch { /* kvota to'lsa yozuv xotirada qolaveradi */ }
  }

  (function hookNetwork() {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__sj = { metod: m, url: String(u) };
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (REC.yoniq && this.__sj) {
        const rec = { tur: "xhr", metod: this.__sj.metod, url: this.__sj.url, sorov: cut(typeof body === "string" ? body : (body ? "[" + String(body) + "]" : "")) };
        REC.tarmoq.push(rec);
        recSaqla();   // so'rov ketishi bilanoq — sahifa almashsa ham qolsin
        this.addEventListener("load", () => {
          rec.holat = this.status;
          try { rec.javob = cut(this.responseText, 2000); } catch { rec.javob = "[o'qib bo'lmadi]"; }
          recSaqla();
        });
      }
      return _send.apply(this, arguments);
    };

    const _fetch = window.fetch;
    if (_fetch) {
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const metod = (init && init.method) || (input && input.method) || "GET";
        let rec = null;
        if (REC.yoniq) {
          rec = { tur: "fetch", metod, url: String(url), sorov: cut((init && typeof init.body === "string") ? init.body : "") };
          REC.tarmoq.push(rec);
          recSaqla();
        }
        return _fetch.apply(this, arguments).then((res) => {
          if (rec) {
            rec.holat = res.status;
            try {
              res.clone().text().then((t) => { rec.javob = cut(t, 2000); recSaqla(); });
            } catch { /* oqim o'qilmadi */ }
          }
          return res;
        });
      };
    }
  })();

  function recStart(davom) {
    REC.yoniq = true;
    if (!davom) { REC.tarmoq = []; }      // yangi yozuv — eskisi tozalanadi
    REC.dom = [];
    try {
      localStorage.setItem(LS_REC_ON, "1");
      if (!davom) localStorage.removeItem(LS_REC);
    } catch { /* e'tiborsiz */ }
    REC.obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.closest && n.closest("#sj-bridge-host")) continue;   // o'z panelimiz
          if (!visible(n)) continue;
          if (REC.dom.length >= 25) return;
          REC.dom.push({
            teg: n.tagName,
            klass: n.className && String(n.className).slice(0, 200),
            html: cut(n.outerHTML, 6000),
            boshqaruv: formControls(n),
          });
        }
      }
    });
    REC.obs.observe(document.body, { childList: true, subtree: true });
  }

  function recStop() {
    REC.yoniq = false;
    try { localStorage.setItem(LS_REC_ON, "0"); } catch { /* e'tiborsiz */ }
    if (REC.obs) { REC.obs.disconnect(); REC.obs = null; }
  }

  // Elementning ichidagi barcha kiritish maydonlari — tuzilishi bilan
  function formControls(root) {
    const out = [];
    root.querySelectorAll("select, input, textarea, [role=combobox], [role=listbox]").forEach((el) => {
      const item = {
        teg: el.tagName, turi: el.type || "", nomi: el.name || "", id: el.id || "",
        klass: String(el.className || "").slice(0, 160),
        qiymat: String(el.value || "").slice(0, 120),
      };
      if (el.tagName === "SELECT") {
        item.variantlar = [...el.options].slice(0, 400).map((o) => ({ v: o.value, t: txt(o) }));
      }
      out.push(item);
    });
    root.querySelectorAll("button, a, [role=button]").forEach((el) => {
      const t = txt(el);
      if (t) out.push({ teg: el.tagName, matn: t.slice(0, 60), klass: String(el.className || "").slice(0, 160) });
    });
    return out;
  }

  function recDump() {
    return JSON.stringify({
      sj_orgatish: 1,
      sahifa: location.href,
      sarlavha: document.title,
      vaqt: new Date().toISOString(),
      tarmoq: REC.tarmoq,
      dom: REC.dom,
      setka: gridReport(),
    }, null, 2);
  }

  // ===================================================================
  //  4-QISM. SETKANI TOPISH
  //
  //  Sxema jadvali: yuqorida kun ustunlari (Dush…Yak), chapda soat
  //  raqamlari (1…9). Jadvalni SARLAVHASI bo'yicha topamiz — sinf/id
  //  nomlariga tayanmaymiz, ular eMaktab yangilanishida o'zgaradi.
  // ===================================================================
  const KUNLAR = [
    ["dush", "pon", "mon"], ["sesh", "vto", "tue"], ["chor", "sre", "wed"],
    ["pay", "chet", "thu"], ["jum", "pyat", "fri"], ["shan", "sub", "sat"], ["yak", "vos", "sun"],
  ];

  function dayIndexOf(headerText) {
    const k = normKey(headerText);
    if (!k) return -1;
    for (let i = 0; i < KUNLAR.length; i++) {
      if (KUNLAR[i].some((p) => k.startsWith(p))) return i + 1;   // 1 = Dushanba
    }
    return -1;
  }

  // Sahifadagi barcha jadvalni baholab, eng ko'p kun ustuni borini tanlaymiz
  function findGrid() {
    const tables = [...document.querySelectorAll("table")];
    let best = null;
    for (const tb of tables) {
      if (!visible(tb)) continue;
      const rows = [...tb.rows];
      if (rows.length < 2) continue;

      // kun sarlavhasi qaysi qatorda? (odatda birinchi, lekin har doim emas)
      let headRow = -1, cols = null;
      for (let r = 0; r < Math.min(3, rows.length); r++) {
        const map = new Map();
        [...rows[r].cells].forEach((c, i) => {
          const d = dayIndexOf(txt(c));
          if (d > 0 && !map.has(d)) map.set(d, i);
        });
        if (map.size >= 5) { headRow = r; cols = map; break; }
      }
      if (headRow < 0) continue;

      // soat qatorlari: birinchi katagi raqam
      const soatlar = new Map();
      for (let r = headRow + 1; r < rows.length; r++) {
        const first = txt(rows[r].cells[0] || null);
        const n = parseInt(first, 10);
        if (Number.isFinite(n) && n > 0 && n < 30 && String(n) === first) {
          if (!soatlar.has(n)) soatlar.set(n, rows[r]);
        }
      }
      if (soatlar.size < 2) continue;

      const score = cols.size * 10 + soatlar.size;
      if (!best || score > best.score) best = { table: tb, cols, soatlar, score };
    }
    return best;
  }

  // Sahifa QAYSI SINFNIKI — yo'lakchadagi «3-B (2026/2027)» dan olinadi.
  //
  //  ⚠️ BU XAVFSIZLIK TEKSHIRUVI. Ko'prik darsni URL dagi `schedule` ga
  //  yozadi, ya'ni AYNI SHU sinf sxemasiga. Panelda boshqa sinf tanlansa,
  //  uning darslari begona sinfga tushib ketadi va buni faqat keyin,
  //  qo'lda o'chirib chiqish bilan tuzatish mumkin.
  function pageClassName() {
    const re = /(\d{1,2}\s*[-–—]?\s*[A-Za-zЀ-ӿ]{0,3})\s*\(\s*\d{4}\s*[/–-]\s*\d{4}\s*\)/;
    for (const el of document.querySelectorAll("a, h1, h2")) {
      const m = txt(el).match(re);
      if (m) return m[1].trim();
    }
    const m2 = String(document.title || "").match(re);
    return m2 ? m2[1].trim() : "";
  }

  function gridReport() {
    const g = findGrid();
    if (!g) return { topildi: false, jadvallar: document.querySelectorAll("table").length };
    const bitta = g.soatlar.values().next().value;
    return {
      topildi: true,
      kunUstunlari: [...g.cols.entries()],
      soatlar: [...g.soatlar.keys()],
      namunaQator: cut(bitta ? bitta.outerHTML : "", 4000),
    };
  }

  // Katakni topish.
  //
  //  ASOSIY YO'L — KATAK ID'SI. eMaktab setkasida har bir katakda
  //  `id="d<kun>_<soat>"` turadi: kun 1 = Dushanba … 6 = Shanba,
  //  0 = Yakshanba (JS `getDay()` bilan bir xil), soat = qator raqami.
  //  Bizning `kun` ham 1 = Dushanba, ya'ni to'g'ridan-to'g'ri mos keladi.
  //  Bu ustun sanashdan ishonchliroq: katakka dars tushib tuzilishi
  //  o'zgarsa ham id joyida qoladi, `colspan` esa indeksni surib yuboradi.
  //
  //  ZAXIRA YO'L — sarlavha bo'yicha topilgan ustun indeksi (id naqshi
  //  eMaktab yangilanishida o'zgarib ketsa ishlaydi).
  function cellAt(grid, kun, soat) {
    const byId = document.getElementById(`d${kun % 7}_${soat}`);
    if (byId && grid.table.contains(byId)) return byId;
    const row = grid.soatlar.get(soat);
    const col = grid.cols.get(kun);
    if (!row || col == null) return null;
    return row.cells[col] || null;
  }

  // ===================================================================
  //  5-QISM. ASOSIY DRAYVER — eMAKTAB API'SI
  //
  //  «🔍 O'rganish» yozuvidan aniqlangan (18.09.2026). Sahifaning o'zi
  //  aynan shu so'rovlarni yuboradi:
  //
  //   1) GET  /v2/AjaxPages/scheduleitemnew?schedule=&day=&lesson=&subject=
  //      → «Yangi darsni yaratish» formasining HTML'i. Undan olinadi:
  //        `__RequestVerificationToken`, `#subject` (fan id'lari) va
  //        `#subgroup` (guruhlar — «Butun sinf» qiymati sinf id'siga teng).
  //   2) POST /v2/ajax?xss=&a=tlfe&sid=   body: subid=<fanId>
  //      → shu fanni o'qitadigan ustozlar: [{pid, pn}]
  //   3) POST /v2/ajax?xss=&a=plfe&sid=   body: subject=<fanId>
  //      → xonalar (bu maktabda bo'sh qaytdi)
  //   4) POST /v2/ajax?xss=&a=createScheduleItem&schedule=&
  //           __RequestVerificationToken=&day=&lesson=&subject=&
  //           subgroup=&teacher=&place=
  //      → yaratilgan dars: {"id":"…","sn":"…","idt":"<p>…</p>"}
  //
  //  Hamma parametr QUERY STRING da ketadi, tana bo'sh (tlfe/plfe
  //  bundan mustasno). Sessiya cookie bilan — shuning uchun
  //  `credentials: "same-origin"` SHART.
  //
  //  NEGA DOM EMAS: oynani ochib-yopish har dars uchun 1-2 soniya
  //  va ustoz ro'yxati fan o'zgarganda qayta yuklanadi. API bilan
  //  bitta dars ~150 ms, natija esa serverdan aniq javob bo'lib keladi.
  // ===================================================================
  const enc = encodeURIComponent;

  const API = {
    tayyor: false,
    xss: "", token: "", schoolId: "", scheduleId: "", groupId: "",
    bosh: null,            // { kun, soat } — ro'yxat so'rash uchun BO'SH katak
    band: new Set(),       // shu yurishda TO'LDIRILGAN kataklar ("kun_soat")
    fanlar: [],            // [{ v, label }] — butun maktab fanlari
    fanKesh: new Map(),    // fanId → { guruhlar, ustozlar, xonalar }

    async init() {
      const q = new URLSearchParams(location.search);
      this.schoolId = q.get("school") || "";
      this.scheduleId = q.get("schedule") || "";
      this.groupId = q.get("group") || "";
      if (!this.scheduleId) {
        throw new Error("URL da `schedule` yo'q — chorak sxemasi sahifasida emassiz");
      }
      // `xss` — sessiyaga bog'liq token, sahifa ichidagi havolalarda turadi
      const m = document.documentElement.innerHTML.match(/[?&]xss=([0-9a-f]{16,})/);
      this.xss = m ? m[1] : "";
      if (!this.xss) throw new Error("sahifadan `xss` tokeni topilmadi");

      const { katak, f } = await this.boshKatak();
      this.bosh = katak;
      this.token = f.token;
      this.fanlar = f.fanlar;
      if (!this.token) throw new Error("__RequestVerificationToken topilmadi");
      if (!this.fanlar.length) throw new Error("fanlar ro'yxati bo'sh");
      this.tayyor = true;
      return { fanlar: this.fanlar.length, katak };
    },

    // ⚠️ FORMA FAQAT BO'SH KATAK UCHUN TO'LIQ QAYTADI.
    //
    //  Band katakda eMaktab forma o'rniga xato sahifasini beradi:
    //  «Jadvalning ushbu katagida boshqa darsni yaratib bo'lmadi».
    //  Unda `__RequestVerificationToken` BOR, lekin bironta ro'yxat yo'q —
    //  ya'ni tokenni tekshirish yetarli emas, fanlar ham bo'lishi shart.
    //  Ilgari forma har doim 1-kun 1-soat uchun so'ralardi va o'sha katak
    //  band bo'lsa API umuman ulanmasdi.
    async boshKatak() {
      const nomzodlar = [];
      const g = findGrid();
      if (g) {
        for (const soat of g.soatlar.keys()) {
          for (const kun of g.cols.keys()) {
            if (this.band.has(`${kun}_${soat}`)) continue;   // biz to'ldirganmiz
            const c = cellAt(g, kun, soat);
            if (c && !txt(c)) nomzodlar.push({ kun, soat });
          }
        }
      }
      // Setka topilmasa yoki hammasi band ko'rinsa — ko'r-ko'rona sinaymiz
      if (!nomzodlar.length) {
        for (let soat = 1; soat <= 12; soat++) {
          for (let kun = 1; kun <= 6; kun++) {
            if (!this.band.has(`${kun}_${soat}`)) nomzodlar.push({ kun, soat });
          }
        }
      }
      for (const n of nomzodlar.slice(0, 20)) {
        const f = await this.forma(0, n);
        if (f.fanlar.length) return { katak: n, f };
      }
      throw new Error("bo'sh katak topilmadi — setkada bitta katakni bo'shating");
    },

    // ⚠️ `bosh` KATAK ISH DAVOMIDA BAND BO'LIB QOLADI.
    //
    //  Ro'yxatlar bo'sh katak orqali so'raladi, lekin o'sha katakka dars
    //  tushishi mumkin (birinchi dars aynan shunga tushgan edi). Undan
    //  keyin forma xato sahifasini qaytaradi va `guruhlar` bo'sh chiqadi —
    //  natijada QOLGAN HAMMA dars «guruh ro'yxati bo'sh» deb rad etilardi.
    //  Shuning uchun forma bo'sh kelsa yangi bo'sh katak topib qayta
    //  so'raymiz. To'ldirilgan kataklar `band` to'plamida yuriladi:
    //  API rejimida sahifa DOM'i yangilanmaydi, ya'ni ularni faqat o'zimiz
    //  bilamiz.
    async formaBoshda(fanId) {
      let f = await this.forma(fanId);
      if (!f.fanlar.length) {
        const yangi = await this.boshKatak();
        this.bosh = yangi.katak;
        this.token = yangi.f.token || this.token;
        f = fanId ? await this.forma(fanId) : yangi.f;
      }
      return f;
    },

    // «Yangi dars» formasi. `fanId` berilsa — o'sha fanning guruhlari qaytadi.
    // `katak` berilmasa init topgan bo'sh katak ishlatiladi.
    async forma(fanId, katak) {
      const k = katak || this.bosh || { kun: 1, soat: 1 };
      const url = `/v2/AjaxPages/scheduleitemnew?schedule=${enc(this.scheduleId)}`
        + `&day=${k.kun % 7}&lesson=${k.soat}&subject=${enc(fanId || 0)}&_=${Date.now()}`;
      const r = await fetch(url, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
      if (!r.ok) throw new Error(`forma HTTP ${r.status}`);
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const opts = (id) => [...doc.querySelectorAll(`#${id} option`)]
        .map((o) => ({ v: o.value, label: txt(o) }))
        .filter((o) => o.v && o.label);
      const tok = doc.querySelector('input[name="__RequestVerificationToken"]');
      return { token: tok ? tok.value : "", fanlar: opts("subject"), guruhlar: opts("subgroup") };
    },

    async ajax(a, body) {
      const r = await fetch(`/v2/ajax?xss=${enc(this.xss)}&a=${a}&sid=${enc(this.schoolId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    },

    // Fanga tegishli guruh / ustoz / xona ro'yxatlari — fan bo'yicha keshlanadi.
    // Kesh bo'lmasa har dars uchun 3 ta ortiqcha so'rov ketardi.
    async fanMalumoti(fanId) {
      if (this.fanKesh.has(fanId)) return this.fanKesh.get(fanId);
      const f = await this.formaBoshda(fanId);
      const royxat = (matn) => {
        const js = JSON.parse(matn);
        return Array.isArray(js)
          ? js.map((x) => ({ v: String(x.pid != null ? x.pid : (x.id != null ? x.id : "")),
                             label: unesc(x.pn != null ? x.pn : (x.name != null ? x.name : "")) }))
              .filter((x) => x.v && x.label)
          : [];
      };
      let ustozlar = [], xonalar = [];
      try { ustozlar = royxat(await this.ajax("tlfe", `subid=${enc(fanId)}`)); } catch { ustozlar = []; }
      try { xonalar = royxat(await this.ajax("plfe", `subject=${enc(fanId)}`)); } catch { xonalar = []; }
      const val = { guruhlar: f.guruhlar, ustozlar, xonalar };
      this.fanKesh.set(fanId, val);
      return val;
    },

    async yarat({ kun, soat, fanId, guruhId, ustozId, xonaId }) {
      const p = new URLSearchParams({
        xss: this.xss,
        a: "createScheduleItem",
        schedule: this.scheduleId,
        __RequestVerificationToken: this.token,
        day: String(kun % 7),
        lesson: String(soat),
        subject: fanId,
        subgroup: guruhId,
        teacher: ustozId || "",
        place: xonaId || "",
      });
      const r = await fetch(`/v2/ajax?${p.toString()}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const matn = await r.text();
      let js = null;
      try { js = JSON.parse(matn); } catch { /* xato javobi JSON emas */ }
      if (js && js.id) {
        // Katak endi band — ro'yxat so'rash uchun boshqasi kerak bo'ladi
        this.band.add(`${kun}_${soat}`);
        return { ok: true, yozuv: js };
      }
      // Server xatoni HTML yoki oddiy matn bilan qaytaradi — tegini tozalaymiz
      const toza = matn.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { ok: false, sabab: toza ? cut(toza, 160) : `HTTP ${r.status}` };
    },
  };

  // ===================================================================
  //  5B-QISM. eMAKTABDAN MA'LUMOT YIG'ISH
  //
  //  NEGA: nomlarni taxmin bilan solishtirish har doim xato manbai —
  //  «Математика» ↔ «Matematika» chalkashuvi, ustozning ismi ikki xil
  //  yozilishi va h.k. Agar Smartjadval'dagi fan/ustoz/sinf yozuvida
  //  eMaktab'ning O'Z id'si tursa, taqqoslash umuman kerak bo'lmaydi.
  //
  //  Bundan tashqari eMaktab har bir fanga FAQAT biriktirilgan ustozni
  //  qabul qiladi (`tlfe` ro'yxati). Shu ro'yxat Smartjadval'ga tushsa,
  //  jadval tuzayotganda ham faqat o'sha ustozlar taklif qilinadi —
  //  ya'ni «ustoz topilmadi» xatosi yuklashda emas, TUZISHDA ko'rinadi.
  //
  //  Yig'iladi: sinflar, fanlar, ustozlar (qaysi fanga ruxsat bergan)
  //  va xonalar. Dars vaqtlari (qo'ng'iroqlar) hozircha olinmaydi —
  //  ularning endpointi hali aniqlanmagan, maktab ularni Smartjadval'da
  //  o'zi kiritadi.
  // ===================================================================
  async function collectSchoolData({ xonalarHam = true, onProgress } = {}) {
    if (!API.tayyor) await API.init();
    const say = (matn) => { if (onProgress) onProgress(matn); };

    // ——— Sinflar: jadvallar ro'yxati sahifasidagi `group=` havolalari ———
    say("sinflar ro'yxati olinmoqda…");
    const sinflar = [];
    try {
      const r = await fetch(`/v2/schedules/?school=${enc(API.schoolId)}`, { credentials: "same-origin" });
      if (r.ok) {
        const doc = new DOMParser().parseFromString(await r.text(), "text/html");
        const korilgan = new Set();
        doc.querySelectorAll('a[href*="group="]').forEach((a) => {
          const m = String(a.getAttribute("href") || "").match(/[?&]group=(\d+)/);
          const nom = txt(a);
          if (!m || !nom || korilgan.has(m[1])) return;
          korilgan.add(m[1]);
          sinflar.push({ id: m[1], nom });
        });
      }
    } catch { /* sahifa ochilmasa sinflar bo'sh qoladi — import buni aytadi */ }

    // ——— Fanlar: forma ro'yxati (butun maktab bo'yicha) ———
    const fanlar = API.fanlar.map((f) => ({ id: f.v, nom: f.label }));

    // ——— Ustozlar va xonalar: HAR FAN uchun alohida so'rov ———
    // Bu qismi uzoq (fan soniga teng so'rov), shuning uchun progress bor.
    const ustozMap = new Map();   // ustozId → { id, nom, fanIdlari[] }
    const xonaMap = new Map();
    for (let i = 0; i < fanlar.length; i++) {
      const fan = fanlar[i];
      say(`fan ${i + 1}/${fanlar.length}: ${fan.nom}`);
      let info;
      try { info = await API.fanMalumoti(fan.id); } catch { continue; }
      info.ustozlar.forEach((u) => {
        if (!ustozMap.has(u.v)) ustozMap.set(u.v, { id: u.v, nom: u.label, fanIdlari: [] });
        ustozMap.get(u.v).fanIdlari.push(fan.id);
      });
      if (xonalarHam) info.xonalar.forEach((x) => { if (!xonaMap.has(x.v)) xonaMap.set(x.v, { id: x.v, nom: x.label }); });
    }

    const maktabNomi = txt(document.querySelector('a[href*="/v2/school"]')) || "";
    return {
      sj_emaktab_malumot: 1,
      sana: new Date().toISOString(),
      maktab: { id: API.schoolId, nom: maktabNomi },
      sinflar,
      fanlar,
      ustozlar: [...ustozMap.values()],
      xonalar: [...xonaMap.values()],
    };
  }

  // Nomni ro'yxatdan topish: avval qo'lda moslashtirilgan juftlik, keyin bestMatch
  function matchName(list, name, kind, xarita) {
    if (!name) return { ok: false, sabab: "nom bo'sh" };
    if (!list || !list.length) return { ok: false, sabab: "eMaktab ro'yxati bo'sh" };
    const qolda = xarita && xarita[kind] && xarita[kind][name];
    if (qolda) {
      const f = list.find((x) => x.label === qolda);
      if (f) return { ok: true, id: f.v, label: f.label, ishonch: "qo'lda" };
    }
    const m = bestMatch(name, list, kind);
    if (!m.qiymat) return { ok: false, sabab: "mos nom topilmadi" };
    return { ok: true, id: m.qiymat.v, label: m.qiymat.label, ishonch: m.ishonch };
  }

  // Nomga biriktirilgan eMaktab id'sini ro'yxatdan topish.
  //
  //  Jadval faylida `emaktab.fanlar["Математика"] = "2146…"` turgan bo'lsa
  //  (ya'ni maktab ma'lumoti eMaktab'dan import qilingan) — taqqoslash
  //  umuman bajarilmaydi. Bu «Математика» ↔ «Matematika» chalkashuvini
  //  ham, ustoz ismining ikki xil yozilishini ham butunlay yo'q qiladi.
  function byId(list, xarita, nom, tur) {
    const jadval = xarita && xarita[tur];
    const id = jadval ? jadval[nom] : null;
    if (!id) return null;
    const f = list.find((x) => x.v === String(id));
    return f ? { ok: true, id: f.v, label: f.label, ishonch: "id" }
             : { ok: false, sabab: `id ${id} eMaktab ro'yxatida yo'q (ma'lumot eskirgan)` };
  }

  // Bitta darsni API orqali joylashtirish
  async function placeLessonApi(dars, paket, xarita, opt) {
    const idlar = (paket && paket.emaktab) || null;

    const fan = byId(API.fanlar, idlar, dars.fan, "fanlar")
      || matchName(API.fanlar, dars.fan, "fan", xarita);
    if (!fan.ok) return { ok: false, sabab: `fan «${dars.fan}»: ${fan.sabab}` };

    const info = await API.fanMalumoti(fan.id);

    // Guruh. Odatiy holat — «Butun sinf», uning qiymati sinf (group) id'siga teng.
    const butun = info.guruhlar.find((g) => g.v === API.groupId) || info.guruhlar[0];
    if (!butun) return { ok: false, sabab: "eMaktab'da bu fan uchun guruh ro'yxati bo'sh" };
    let guruhId = butun.v;
    let ogoh = "";
    if (dars.guruh) {
      const g = info.guruhlar.length > 1 ? bestMatch(dars.guruh, info.guruhlar, "fan") : { qiymat: null };
      if (g.qiymat) guruhId = g.qiymat.v;
      else ogoh = `«${dars.guruh}» eMaktab'da sozlanmagan — butun sinfga qo'yildi`;
    }

    let ustozId = "", ustozLabel = "";
    if (dars.ustoz) {
      // ⚠️ Ustoz SHU FANNING ro'yxatida bo'lishi shart. eMaktab har fanga
      // faqat biriktirilgan ustozni qabul qiladi, shuning uchun id bo'lsa
      // ham uni `info.ustozlar` ichidan izlaymiz — topilmasa sabab aniq:
      // biriktiruv eMaktab'da yo'q, ya'ni nom moslashtirishning aybi emas.
      const u = byId(info.ustozlar, idlar, dars.ustoz, "ustozlar")
        || matchName(info.ustozlar, dars.ustoz, "ustoz", xarita);
      if (u.ok) { ustozId = u.id; ustozLabel = u.label; }
      else {
        const bor = idlar && idlar.ustozlar && idlar.ustozlar[dars.ustoz];
        ogoh = (ogoh ? ogoh + "; " : "") + (bor
          ? `ustoz «${dars.ustoz}» eMaktab'da «${fan.label}» faniga biriktirilmagan — ustozsiz`
          : `ustoz «${dars.ustoz}» topilmadi (${u.sabab}) — ustozsiz`);
      }
    }

    let xonaId = "";
    if (opt.xona && dars.xona) {
      const x = byId(info.xonalar, idlar, dars.xona, "xonalar")
        || matchName(info.xonalar, dars.xona, "xona", xarita);
      if (x.ok) xonaId = x.id;
    }

    const izoh = `${fan.label}${ustozLabel ? " · " + ustozLabel : ""}`;
    if (opt.sinov) return { ok: true, sinov: true, izoh: `${izoh} (yuborilmadi)`, ogoh };

    const r = await API.yarat({ kun: dars.kun, soat: dars.soat, fanId: fan.id, guruhId, ustozId, xonaId });
    if (!r.ok) return { ok: false, sabab: r.sabab };
    return { ok: true, izoh, ogoh };
  }

  // ===================================================================
  //  5V-QISM. SXEMALAR — ro'yxat va yaratish
  //
  //  ⚠️ SXEMA YARATISH XHR EMAS, ODDIY FORMA YUBORISHI.
  //  «🔍 O'rganish» yozuvi uni ushlay olmadi: brauzer navigatsiyasi
  //  `fetch`/`XMLHttpRequest` hook'lariga tushmaydi. Lekin URL'lar
  //  hammasini aytdi (18.09.2026 yozuvi):
  //
  //    …/generator?school=&group=&view=new&period=       ← forma sahifasi
  //    …/generator?school=&group=&view=edit&schedule=<YANGI>&message=schedulecreated
  //
  //  Shuning uchun formani o'zimiz o'qiymiz, maydonlarini o'zimiz
  //  yuboramiz va natijaviy URL'dan yangi `schedule` id'sini olamiz.
  // ===================================================================
  function sxemaUrl(group, period, qoshimcha) {
    return `/v2/schedules/generator?school=${enc(API.schoolId)}`
      + `&group=${enc(group)}&period=${enc(period)}${qoshimcha || ""}`;
  }

  // Sinfning mavjud sxemalari: [{ id, nom }]
  async function sxemalar(group, period) {
    const r = await fetch(sxemaUrl(group, period), { credentials: "same-origin" });
    if (!r.ok) throw new Error(`sxemalar ro'yxati HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    const out = [];
    doc.querySelectorAll('a[href*="schedule="]').forEach((a) => {
      const m = String(a.getAttribute("href") || "").match(/[?&]schedule=(\d+)/);
      const nom = txt(a);
      if (m && nom && !out.some((x) => x.id === m[1])) out.push({ id: m[1], nom });
    });
    return out;
  }

  // Sxema ICHI BO'SHMI? — mavjud sxemani to'ldirish xavfsizmi shundan
  //  aniqlanadi. Ilgari mavjud sxema SO'ZSIZ o'tkazib yuborilardi:
  //  maktab avvaldan bo'sh sxema yaratib qo'ygan bo'lsa (jonli maktabda
  //  aynan shunday edi) «Hamma sinfga» ularning birortasini to'ldirmasdi.
  //
  //  ⚠️ NOANIQLIK — «BO'SH EMAS» deb qaraladi. Sahifa ochilmasa yoki
  //  setka topilmasa `false` qaytadi, ya'ni sxemaga TEGILMAYDI:
  //  ustiga yozilsa darslar IKKILANADI.
  async function sxemaBoshmi(group, period, schedId) {
    let doc;
    try {
      const r = await fetch(sxemaUrl(group, period, `&view=edit&schedule=${enc(schedId)}`),
        { credentials: "same-origin" });
      if (!r.ok) return false;
      doc = new DOMParser().parseFromString(await r.text(), "text/html");
    } catch { return false; }
    const kataklar = [...doc.querySelectorAll('[id^="d"]')]
      .filter((el) => /^d[0-6]_\d+$/.test(el.id));
    if (!kataklar.length) return false;
    // Bo'sh katakda faqat «+» qo'shish tugmasi turadi
    return !kataklar.some((el) => txt(el).replace(/[+\s]/g, ""));
  }

  // Formadagi «Nomi» maydoni: nomlangan, ko'rinadigan MATN maydoni.
  //  Qidiruv qutilari (`q`, `search`, `query`) chetlab o'tiladi —
  //  aks holda sarlavhadagi qidiruv formasi «sxema formasi» deb
  //  qabul qilinardi.
  function nomMaydoni(form) {
    const els = [...form.querySelectorAll("input, textarea")];
    return els.find((el) => {
      const n = String(el.getAttribute("name") || "");
      if (!n) return false;
      if (/^(q|search|query|term)$/i.test(n)) return false;
      if (/token/i.test(n)) return false;
      const t = String(el.getAttribute("type") || "").toLowerCase();
      if (el.tagName === "TEXTAREA") return true;
      return t === "text" || t === "";
    }) || null;
  }

  async function sxemaYarat(group, period, nom) {
    const url = sxemaUrl(group, period, "&view=new");
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`sxema formasi HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");

    // ⚠️ SAHIFADA BIR NECHTA FORMA BOR (yuqoridagi qidiruv, tildan
    //  chiqish va h.k.). `querySelector("form")` BIRINCHISINI oladi —
    //  unda matn maydoni yo'q va «nom maydoni topilmadi» chiqadi
    //  (jonli maktabda hamma sinfda shu xato bergan, 18.09.2026).
    //  Kerakli forma — ichida MATN maydoni borisi; ular bir nechta
    //  bo'lsa yashirin token'lisi ustun (sxema formasi shunday).
    const formalar = [...doc.querySelectorAll("form")]
      .filter((f) => nomMaydoni(f));
    const form = formalar.find((f) => f.querySelector('input[name*="Token" i]'))
      || formalar[0];
    if (!form) {
      // Xato xabari TASHXIS bilan: sahifada qanday forma borligini
      // ko'rsatadi, aks holda sababini konsolda qidirish kerak bo'ladi.
      const tashxis = [...doc.querySelectorAll("form")]
        .map((f, i) => `#${i}[` + [...f.querySelectorAll("input, select, textarea")]
          .map((e) => `${(e.getAttribute("name") || "?")}:${e.getAttribute("type") || e.tagName.toLowerCase()}`)
          .join(",") + "]")
        .join(" ") || "forma umuman yo'q";
      throw new Error(`sxema formasi topilmadi (matn maydoni yo'q) — ${tashxis}`);
    }

    // Formadagi HAMMA maydon qaytariladi (jumladan yashirin token),
    // faqat nom maydoniga sxema nomi yoziladi.
    const nomEl = nomMaydoni(form);
    const fd = new URLSearchParams();
    let nomYozildi = false;
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const n = el.getAttribute("name");
      if (!n) return;
      const t = String(el.getAttribute("type") || "").toLowerCase();
      if (t === "submit" || t === "button" || t === "image") return;
      if (t === "checkbox" || t === "radio") {
        if (el.hasAttribute("checked")) fd.append(n, el.getAttribute("value") || "on");
        return;
      }
      if (el === nomEl) { fd.append(n, nom); nomYozildi = true; return; }
      fd.append(n, el.getAttribute("value") || "");
    });
    if (!nomYozildi) throw new Error("formada nom maydoni topilmadi");

    const action = form.getAttribute("action");
    const post = (!action || action === "#") ? url : new URL(action, location.origin).href;
    const metod = String(form.getAttribute("method") || "post").toLowerCase() === "get"
      ? "GET" : "POST";
    const r2 = metod === "GET"
      ? await fetch(post + (post.includes("?") ? "&" : "?") + fd.toString(),
        { credentials: "same-origin" })
      : await fetch(post, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: fd.toString(),
      });

    // Yo'naltirilgan manzilda yangi id turadi
    const m = String(r2.url || "").match(/[?&]schedule=(\d+)/);
    if (m) return m[1];

    // Yo'naltirish bo'lmasa — ro'yxatdan nomi bo'yicha qidiramiz
    const royxat = await sxemalar(group, period);
    const topildi = royxat.find((x) => normKey(x.nom) === normKey(nom));
    if (topildi) return topildi.id;
    throw new Error("yangi sxema id'si aniqlanmadi");
  }

  // Sinf nomi → eMaktabdagi `group` id. Jadvallar ro'yxati sahifasidan.
  async function sinfGuruhlari() {
    const r = await fetch(`/v2/schedules/?school=${enc(API.schoolId)}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`sinflar ro'yxati HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    const map = new Map();
    doc.querySelectorAll('a[href*="group="]').forEach((a) => {
      const m = String(a.getAttribute("href") || "").match(/[?&]group=(\d+)/);
      const nom = txt(a);
      if (!m || !nom) return;
      const k = classKey(nom);
      if (k && !map.has(k)) map.set(k, { id: m[1], nom });
    });
    return map;
  }

  // ===================================================================
  //  6-QISM. ZAXIRA DRAYVER (DOM orqali)
  //
  //  API yo'li ishlamay qolsa (eMaktab so'rov shaklini o'zgartirsa)
  //  shu yo'l qoladi: katakdagi «+» bosiladi, ochilgan oynadagi
  //  ro'yxatlar MAZMUNI bo'yicha tanib olinadi va «Saqlash» bosiladi.
  //  Sekinroq va taxminiyroq — shuning uchun faqat zaxira.
  // ===================================================================

  // Katakdagi «qo'shish» tugmasini topish
  function addButtonIn(cell) {
    hover(cell);
    const cands = [...cell.querySelectorAll("a, button, i, span, div, img")];
    const byClass = cands.find((el) => /add|plus|create|new|dobav/i.test(String(el.className || "") + " " + (el.getAttribute("title") || "")));
    if (byClass) return byClass;
    const byText = cands.find((el) => txt(el) === "+" );
    if (byText) return byText;
    const link = cands.find((el) => el.tagName === "A" && visible(el));
    return link || cell;
  }

  // Ichida tanlash maydoni bor, ko'rinib turgan oyna/formaga o'xshash elementlar
  function candidateForms() {
    return [...document.querySelectorAll("div, form, section")]
      .filter((el) => {
        if (el.closest("#sj-bridge-host")) return false;
        if (!visible(el)) return false;
        if (!el.querySelector("select, input[type=text], [role=combobox]")) return false;
        const st = getComputedStyle(el);
        return st.position === "fixed" || st.position === "absolute"
          || /modal|dialog|popup|overlay|lesson|edit/i.test(String(el.className || ""));
      })
      .sort((a, b) => b.querySelectorAll("select, input").length - a.querySelectorAll("select, input").length);
  }

  function findOpenForm() {
    return candidateForms()[0] || null;
  }

  // Formadagi ro'yxatlarni MAZMUNI bo'yicha tanish:
  // fan ro'yxatida bizning fanlarimiz, ustoz ro'yxatida ustozlarimiz bo'ladi.
  // Tanish ARZON bo'lishi shart: u har bir dars uchun 2-3 marta chaqiriladi.
  // Shuning uchun nomlarning FAQAT bir qismi (NAMUNA) bo'yicha baholanadi —
  // ro'yxatni aniqlash uchun 25 ta nom yetarli, lekin 100 ustoz × 400 variant
  // har safar qayta hisoblansa panel sekinlashib qoladi.
  const NAMUNA = 25;

  function classifySelects(form, paket) {
    const selects = [...form.querySelectorAll("select")].filter(visible);
    const score = (sel, list, kind) => {
      const opts = [...sel.options].map(txt).filter(Boolean);
      if (!opts.length || !list.length) return 0;
      const namuna = list.slice(0, NAMUNA);
      let hit = 0;
      for (const name of namuna) if (bestMatch(name, opts, kind).ishonch) hit++;
      return hit / namuna.length;
    };
    const out = { fan: null, ustoz: null, xona: null };
    let bestFan = 0, bestUstoz = 0;
    selects.forEach((sel) => {
      const f = score(sel, paket.fanlar || [], "fan");
      const u = score(sel, paket.ustozlar || [], "ustoz");
      if (f > bestFan && f >= 0.2) { bestFan = f; out.fan = sel; }
      if (u > bestUstoz && u >= 0.2) { bestUstoz = u; out.ustoz = sel; }
    });
    if (out.fan && out.fan === out.ustoz) {            // bitta ro'yxat ikkalasiga da'vogar
      if (bestFan >= bestUstoz) out.ustoz = null; else out.fan = null;
    }
    // Xona ro'yxati: qisqa nomli ("12", "IT xona 1") va kamida ikkita variantli.
    // Ikkita shart ham kerak — aks holda bitta variantli har qanday ro'yxat
    // (masalan yashirin "chorak" tanlovi) xona deb olinadi va soat buziladi.
    out.xona = selects.find((s) => {
      if (s === out.fan || s === out.ustoz) return false;
      const opts = [...s.options].map(txt).filter(Boolean);
      if (opts.length < 2) return false;
      return opts.slice(0, 6).every((t) => /^[\wЀ-ӿ\- ]{1,20}$/.test(t));
    }) || null;
    out.hammasi = selects;
    return out;
  }

  // Ro'yxatdan kerakli variantni tanlash (moslashtirish jadvali bilan)
  function pickOption(sel, name, kind, xarita) {
    if (!sel || !name) return { ok: false, sabab: "ro'yxat yoki nom yo'q" };
    const opts = [...sel.options].map((o) => ({ el: o, label: txt(o) })).filter((o) => o.label);
    const qolda = xarita && xarita[kind] && xarita[kind][name];
    if (qolda) {
      const f = opts.find((o) => o.label === qolda);
      if (f) { setValue(sel, f.el.value); return { ok: true, tanlandi: f.label, ishonch: "qo'lda" }; }
    }
    const m = bestMatch(name, opts, kind);
    if (!m.qiymat) return { ok: false, sabab: "mos nom topilmadi" };
    setValue(sel, m.qiymat.el.value);
    return { ok: true, tanlandi: m.qiymat.label, ishonch: m.ishonch };
  }

  function saveButtonIn(form) {
    const re = /^(saqlash|сохранить|ok|qo.?shish|добавить|save|tayyor|готово)$/i;
    const btns = [...form.querySelectorAll("button, input[type=submit], a, [role=button]")].filter(visible);
    return btns.find((b) => re.test(txt(b) || b.value || "")) || btns.find((b) => /save|submit|ok/i.test(String(b.className || ""))) || null;
  }

  function closeButtonIn(form) {
    const re = /^(bekor|отмена|cancel|yopish|закрыть|×|x)$/i;
    const btns = [...form.querySelectorAll("button, a, [role=button]")].filter(visible);
    return btns.find((b) => re.test(txt(b))) || null;
  }

  // Bitta darsni joylashtirish
  async function placeLesson(grid, dars, paket, xarita, opt) {
    const cell = cellAt(grid, dars.kun, dars.soat);
    if (!cell) return { ok: false, sabab: `setkada ${dars.kun}-kun ${dars.soat}-soat katagi yo'q` };

    // Sahifada ochilishidan OLDIN ham tanlash maydoni bor panellar bo'lishi
    // mumkin (filtrlar, yashirin formalar). Shuning uchun faqat YANGI paydo
    // bo'lgan oyna qabul qilinadi — aks holda skript begona formani to'ldiradi.
    const oldingi = new Set(candidateForms());
    realClick(addButtonIn(cell));
    const form = await waitFor(() => candidateForms().find((el) => !oldingi.has(el)), opt.kutish);
    if (!form) return { ok: false, sabab: "dars qo'shish oynasi ochilmadi" };

    const sel = classifySelects(form, paket);
    if (!sel.fan) {
      const c = closeButtonIn(form); if (c) realClick(c);
      return { ok: false, sabab: "oynada fan ro'yxati topilmadi" };
    }

    const rFan = pickOption(sel.fan, dars.fan, "fan", xarita);
    if (!rFan.ok) {
      const c = closeButtonIn(form); if (c) realClick(c);
      return { ok: false, sabab: `fan «${dars.fan}»: ${rFan.sabab}` };
    }

    // Fan tanlangach ustoz ro'yxati ko'pincha QAYTA yuklanadi — kutamiz
    await sleep(opt.tanaffus);
    let rUstoz = { ok: true, tanlandi: "" };
    if (dars.ustoz) {
      const sel2 = classifySelects(form, paket);
      rUstoz = pickOption(sel2.ustoz || sel.ustoz, dars.ustoz, "ustoz", xarita);
    }
    if (dars.xona && opt.xona) {
      const sel3 = classifySelects(form, paket);
      pickOption(sel3.xona || sel.xona, dars.xona, "xona", xarita);
    }

    const save = saveButtonIn(form);
    if (!save) return { ok: false, sabab: "«Saqlash» tugmasi topilmadi" };
    if (opt.sinov) {
      const c = closeButtonIn(form); if (c) realClick(c);
      return { ok: true, sinov: true, izoh: `fan → ${rFan.tanlandi}${rUstoz.tanlandi ? ", ustoz → " + rUstoz.tanlandi : ""}` };
    }
    realClick(save);

    // Oyna yopilishini kutamiz — yopilmasa saqlanmagan deb hisoblaymiz
    const yopildi = await waitFor(() => !document.contains(form) || !visible(form), opt.kutish);
    if (!yopildi) return { ok: false, sabab: "saqlangandan keyin oyna yopilmadi (xato chiqqan bo'lishi mumkin)" };
    if (!dars.ustoz) return { ok: true, izoh: `fan → ${rFan.tanlandi} (ustozsiz)` };
    if (!rUstoz.ok) return { ok: true, ogoh: `ustoz «${dars.ustoz}» tanlanmadi: ${rUstoz.sabab}` };
    return { ok: true, izoh: `${rFan.tanlandi} · ${rUstoz.tanlandi}` };
  }

  // ===================================================================
  //  7-QISM. PANEL (Shadow DOM — sahifa uslublari aralashmasin)
  // ===================================================================
  const host = document.createElement("div");
  host.id = "sj-bridge-host";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const sh = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  sh.innerHTML = `
    <style>
      :host,*{box-sizing:border-box;}
      .wrap{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;}
      .fab{width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-weight:800;font-size:15px;
        box-shadow:0 8px 24px rgba(79,70,229,.45);}
      .panel{display:none;width:400px;max-height:82vh;overflow:auto;background:#0f172a;
        border:1px solid #1e293b;border-radius:16px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);}
      .panel.ochiq{display:block;}
      h3{margin:0 0 2px;font-size:15px;color:#fff;}
      .sub{color:#94a3b8;font-size:11.5px;margin-bottom:10px;}
      .qadam{border:1px solid #1e293b;border-radius:11px;padding:10px;margin-bottom:9px;background:#111a2e;}
      .qadam b{color:#c7d2fe;font-size:12px;display:block;margin-bottom:6px;}
      button.b{border:none;border-radius:9px;padding:8px 11px;font-weight:700;font-size:12px;
        cursor:pointer;margin:2px 3px 2px 0;font-family:inherit;}
      .b-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
      .b-alt{background:#1e293b;color:#cbd5e1;border:1px solid #334155;}
      .b-warn{background:#7c2d12;color:#fed7aa;}
      textarea{width:100%;height:76px;background:#020617;border:1px solid #1e293b;border-radius:9px;
        color:#cbd5e1;padding:7px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
      .log{background:#020617;border:1px solid #1e293b;border-radius:9px;padding:7px;height:150px;
        overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;}
      .ok{color:#4ade80;} .xato{color:#f87171;} .ogoh{color:#fbbf24;} .dim{color:#64748b;}
      .qator{display:flex;gap:6px;align-items:center;margin:5px 0;flex-wrap:wrap;}
      label{font-size:11.5px;color:#94a3b8;display:flex;gap:5px;align-items:center;}
      input[type=number]{width:58px;background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:3px 5px;}
      select.s{background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:4px 6px;font-size:12px;max-width:200px;}
      .x{position:absolute;right:10px;top:10px;background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;}
      .holat{font-size:11.5px;color:#93c5fd;margin:6px 0;}
      .pb{height:5px;background:#1e293b;border-radius:3px;overflow:hidden;margin:6px 0;}
      .pb i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6366f1,#22d3ee);transition:width .2s;}
    </style>
    <div class="wrap">
      <button class="fab" id="fab" title="Smartjadval ko'prigi">SJ</button>
      <div class="panel" id="panel" style="position:relative;">
        <button class="x" id="yopish">✕</button>
        <h3>Smartjadval → eMaktab</h3>
        <div class="sub">Sxema setkasini to'ldiradi. «Nashr etish» ni siz bosasiz.</div>

        <div class="qadam">
          <b>1. Jadval ma'lumoti</b>
          <textarea id="json" placeholder="Smartjadval → eMaktab bo'limidan nusxa olingan JSON shu yerga qo'yiladi…"></textarea>
          <div class="qator">
            <button class="b b-alt" id="fayl">📂 Fayldan</button>
            <button class="b b-alt" id="oqish">✔ Tekshirish</button>
            <button class="b b-alt" id="unut" title="Brauzerda saqlangan jadvalni o'chirish">🗑</button>
            <span class="holat" id="holat"></span>
          </div>
          <input type="file" id="fileinp" accept=".json,application/json" style="display:none">
        </div>

        <div class="qadam">
          <b>2. Sinf</b>
          <div class="qator">
            <select class="s" id="sinf"><option value="">— avval JSON tekshirilsin —</option></select>
          </div>
          <div class="holat" id="setkaHolat">Setka hali tekshirilmadi.</div>
        </div>

        <div class="qadam">
          <b>3. Joylashtirish</b>
          <div class="qator">
            <label><input type="checkbox" id="xona"> xona ham</label>
            <label><input type="checkbox" id="otkaz" checked> band katakni o'tkazib yuborish</label>
          </div>
          <div class="qator">
            <label>tanaffus <input type="number" id="tanaffus" value="350" min="0" step="50"> ms</label>
            <label>kutish <input type="number" id="kutish" value="8000" min="1000" step="500"> ms</label>
          </div>
          <div class="qator">
            <button class="b b-alt" id="sinov">🧪 Sinov (1 dars, saqlamaydi)</button>
            <button class="b b-main" id="yur">▶ Joylashtirish</button>
            <button class="b b-warn" id="toxta" style="display:none">■ To'xtatish</button>
          </div>
          <div class="pb"><i id="pbar"></i></div>
        </div>

        <div class="qadam">
          <b>🏫 Hamma sinfga (ketma-ket)</b>
          <div class="dim" style="font-size:11px;margin-bottom:6px;">
            Har sinf uchun sxema yaratib, darslarni to'ldiradi. Sxemasi
            allaqachon bor sinf O'TKAZIB YUBORILADI — ikkilanish bo'lmasin.
            «Nashr etish» baribir qo'lda qoladi.
          </div>
          <div class="qator">
            <label>sxema nomi <input type="text" id="chorakNom" value="1 chorak"
              style="width:110px;background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:3px 6px;"></label>
          </div>
          <div class="qator">
            <label><input type="checkbox" id="mavjudHam"> DARSI BOR sxemaga ham yozish (darslar ikkilanadi!)</label>
          </div>
          <div class="qator">
            <button class="b b-main" id="hamma">🏫 Hamma sinfga</button>
            <span class="holat" id="hammaHolat"></span>
          </div>
        </div>

        <div class="qadam">
          <b>📥 eMaktab'dan ma'lumot olish</b>
          <div class="dim" style="font-size:11px;margin-bottom:6px;">
            Sinflar, fanlar, ustozlar (qaysi fanga ruxsat berilgani bilan) va
            xonalar fayl bo'lib yuklanadi. Uni Smartjadval «eMaktab» bo'limiga
            yuklasangiz — nomlar taxmin qilinmay, id bo'yicha aniq ishlaydi.
          </div>
          <div class="qator">
            <label><input type="checkbox" id="xonaYig" checked> xonalar ham</label>
            <button class="b b-alt" id="yigish">📥 Yig'ish va saqlash</button>
            <span class="holat" id="yigHolat"></span>
          </div>
        </div>

        <div class="qadam">
          <b>🔤 Nom mosligi (kerak bo'lsa)</b>
          <div class="dim" style="font-size:11px;margin-bottom:6px;">
            Avtomatik topilmagan nomlar uchun. Har qatorda:
            <code>Smartjadval nomi = eMaktab nomi</code>
          </div>
          <textarea id="xarita" style="height:58px"
            placeholder="Rus tili = Русский язык&#10;Munavvarov A.M. = Munavvarov Akmal Murodovich"></textarea>
          <div class="qator">
            <button class="b b-alt" id="xaritaSaqla">💾 Saqlash</button>
            <span class="holat" id="xaritaHolat"></span>
          </div>
        </div>

        <div class="qadam">
          <b>🔍 O'rganish rejimi — birinchi marta shuni bajaring</b>
          <div class="dim" style="font-size:11px;margin-bottom:6px;">
            «Yozishni boshlash» → setkada BITTA darsni QO'LDA qo'shing →
            «Yozishni to'xtatish» → natijani nusxalab dasturchiga bering.
          </div>
          <div class="qator">
            <button class="b b-alt" id="recOn">⏺ Yozishni boshlash</button>
            <button class="b b-alt" id="recOff">⏹ To'xtatish va nusxalash</button>
            <button class="b b-alt" id="recSave">💾 Faylga saqlash</button>
          </div>
        </div>

        <div class="log" id="log"></div>
      </div>
    </div>`;

  const $ = (id) => sh.getElementById(id);
  const panel = $("panel");
  let paket = null;
  let toxtat = false;
  const xarita = JSON.parse(localStorage.getItem(LS_MAP) || '{"fan":{},"ustoz":{},"xona":{}}');

  function log(msg, cls) {
    const el = $("log");
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  $("fab").onclick = () => ochiqYoz(panel.classList.toggle("ochiq"));
  $("yopish").onclick = () => { panel.classList.remove("ochiq"); ochiqYoz(false); };
  $("fayl").onclick = () => $("fileinp").click();
  $("fileinp").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $("json").value = String(r.result || ""); parse(); };
    r.readAsText(f);
  };

  function parse() {
    try {
      const raw = $("json").value.trim();
      if (!raw) throw new Error("bo'sh");
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.sinflar)) throw new Error("bu Smartjadval fayli emas");
      if (!V.includes(Number(p.v))) {
        log(`⚠ Fayl versiyasi ${p.v}, skript ${V.join("/")} ni biladi — natija noto'g'ri bo'lishi mumkin`, "ogoh");
      }
      paket = p;
      const sel = $("sinf");
      sel.innerHTML = "";
      p.sinflar.forEach((s, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `${s.nom} — ${s.darslar.length} dars`;
        sel.appendChild(o);
      });
      $("holat").textContent = `✔ ${p.sinflar.length} sinf, ${p.sinflar.reduce((n, s) => n + s.darslar.length, 0)} dars`;

      // Id xaritasi bormi? Bu natijaning aniqligini belgilaydi.
      const e = p.emaktab || {};
      const nFan = Object.keys(e.fanlar || {}).length;
      const nUst = Object.keys(e.ustozlar || {}).length;
      if (nFan || nUst) {
        log(`🔗 eMaktab id'lari bor (${nFan} fan, ${nUst} ustoz) — nomlar taxmin qilinmaydi.`, "ok");
      } else {
        log("ℹ eMaktab id'lari yo'q — nomlar bo'yicha moslashtiriladi. «📥 Yig'ish» ni bajarib, faylni Smartjadval'ga import qilsangiz aniqroq bo'ladi.", "dim");
      }

      // Sahifadagi sinfni ro'yxatdan O'ZI tanlaymiz — noto'g'ri sinf
      // tanlash eng xavfli xato, uni imkon qadar oldindan yopamiz.
      const sahifaSinf = pageClassName();
      if (sahifaSinf) {
        const i = p.sinflar.findIndex((s) => classKey(s.nom) === classKey(sahifaSinf));
        if (i >= 0) {
          sel.value = String(i);
          log(`Sahifa «${sahifaSinf}» sinfiniki — ro'yxatdan o'zi tanlandi.`, "dim");
        } else {
          log(`⚠ Sahifadagi «${sahifaSinf}» sinfi jadval faylida yo'q.`, "ogoh");
        }
      }

      // ⚠️ JADVAL BRAUZERDA ESLAB QOLINADI.
      //
      //  Maktabda 40+ sinf bor, har birining eMaktabdagi sxemasi ALOHIDA
      //  sahifa (`schedule` id sinfga xos). Ya'ni foydalanuvchi sahifadan
      //  sahifaga o'tadi va har o'tishda panel noldan quriladi. Faylni
      //  40 marta qayta tanlash — bekorga sarflangan vaqt, shuning uchun
      //  jadval shu yerda saqlanadi va keyingi sahifada o'zi yuklanadi.
      try { localStorage.setItem(LS_JADVAL, raw); } catch { /* kvota to'lsa e'tiborsiz */ }

      checkGrid();
      return true;
    } catch (err) {
      $("holat").textContent = "✖ " + err.message;
      paket = null;
      return false;
    }
  }
  $("oqish").onclick = parse;

  $("unut").onclick = () => {
    try { localStorage.removeItem(LS_JADVAL); } catch { /* e'tiborsiz */ }
    $("json").value = "";
    $("sinf").innerHTML = '<option value="">— jadval yo\'q —</option>';
    $("holat").textContent = "";
    paket = null;
    log("🗑 Saqlangan jadval o'chirildi.", "dim");
  };

  function checkGrid() {
    const g = findGrid();
    if (!g) {
      $("setkaHolat").innerHTML = "<span class='xato'>Setka topilmadi — «Darslarni ishlab chiqish» ichidagi chorak sxemasini oching.</span>";
      return null;
    }
    $("setkaHolat").innerHTML = `<span class='ok'>Setka topildi: ${g.cols.size} kun, ${g.soatlar.size} soat.</span>`;
    return g;
  }

  async function run(sinov) {
    if (!paket && !parse()) { log("✖ Avval JSON ni tekshiring", "xato"); return; }
    const idx = Number($("sinf").value || 0);
    const sinf = paket.sinflar[idx];
    if (!sinf) { log("✖ Sinf tanlanmadi", "xato"); return; }

    // ⚠️ Darslar URL dagi `schedule` ga yoziladi — sahifa qaysi sinfniki
    // bo'lsa, o'shanga. Panelda boshqa sinf tanlangan bo'lsa TO'XTAYMIZ.
    const sahifaSinf = pageClassName();
    if (sahifaSinf && classKey(sahifaSinf) !== classKey(sinf.nom)) {
      log(`✖ Sahifa «${sahifaSinf}» sinfiniki, panelda esa «${sinf.nom}» tanlangan.`, "xato");
      log("   Darslar shu sahifadagi sxemaga yoziladi — boshqa sinfnikini yuborib bo'lmaydi.", "xato");
      log(`   «${sahifaSinf}» ni tanlang yoki «${sinf.nom}» sinfining sxemasini oching.`, "dim");
      return;
    }

    const opt = {
      tanaffus: Number($("tanaffus").value) || 350,
      kutish: Number($("kutish").value) || 8000,
      xona: $("xona").checked,
      otkaz: $("otkaz").checked,
      sinov: !!sinov,
    };
    const ish = sinov ? sinf.darslar.slice(0, 1) : sinf.darslar;
    if (!ish.length) { log("✖ Bu sinfda dars yo'q", "xato"); return; }

    const g = checkGrid();

    // API ni bir marta tayyorlaymiz. Ulanmasa — zaxira DOM yo'li qoladi.
    if (!API.tayyor) {
      try {
        const info = await API.init();
        log(`✔ eMaktab API ulandi — ${info.fanlar} ta fan `
          + `(ro'yxat ${info.katak.kun}-kun ${info.katak.soat}-soat bo'sh katagidan olindi)`, "ok");
      } catch (err) {
        log(`⚠ API ulanmadi (${err.message}) — zaxira DOM yo'liga o'tildi`, "ogoh");
      }
    }
    if (!API.tayyor && !g) {
      log("✖ Na API, na setka topildi — chorak sxemasi sahifasini oching", "xato");
      return;
    }

    toxtat = false;
    $("toxta").style.display = "";
    $("yur").disabled = true; $("sinov").disabled = true;
    log(`▶ ${sinf.nom}: ${ish.length} ta dars${sinov ? " (SINOV — yuborilmaydi)" : ""}`, "ok");

    let ok = 0, xato = 0, otkazildi = 0;
    for (let i = 0; i < ish.length; i++) {
      if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
      const d = ish[i];
      const yorliq = `${d.kun}-kun ${d.soat}-soat ${d.fan}${d.guruh ? " (" + d.guruh + ")" : ""}`;
      const cell = g ? cellAt(g, d.kun, d.soat) : null;

      // Band katak. API rejimida setka DOM'i yangilanmaydi, shuning uchun
      // bu tekshiruv faqat OLDINDAN turgan darsni ushlaydi — ayni yurishda
      // qo'yilganlari halaqit bermaydi (guruhli darslar shu sababli ishlaydi).
      //
      // SINOVDA o'tkazib yuborilmaydi: sinov hech narsa yozmaydi, ya'ni
      // ikkilanish xavfi yo'q. Aks holda birinchi dars band katakka tushsa
      // sinov hech narsani tekshirmay tugab qolardi.
      if (opt.otkaz && !sinov && cell && txt(cell)) {
        otkazildi++;
        log(`↷ ${yorliq} — katakda dars bor, o'tkazib yuborildi`, "dim");
        $("pbar").style.width = Math.round(((i + 1) / ish.length) * 100) + "%";
        continue;
      }

      let r;
      try {
        r = API.tayyor
          ? await placeLessonApi(d, paket, xarita, opt)
          : await placeLesson(g, d, paket, xarita, opt);
      } catch (err) {
        r = { ok: false, sabab: "kutilmagan xato: " + err.message };
      }

      if (r.ok) {
        ok++;
        log(`✔ ${yorliq} — ${r.izoh || ""}`, r.ogoh ? "ogoh" : "ok");
        if (r.ogoh) log("   ⚠ " + r.ogoh, "ogoh");
        // API rejimida katak o'zi yangilanmaydi — belgilab qo'yamiz,
        // foydalanuvchi ish borayotganini ko'rib tursin.
        if (cell && !sinov) cell.style.background = "#dcfce7";
      } else {
        xato++;
        log(`✖ ${yorliq} — ${r.sabab}`, "xato");
      }
      $("pbar").style.width = Math.round(((i + 1) / ish.length) * 100) + "%";
      await sleep(opt.tanaffus);
    }

    $("toxta").style.display = "none";
    $("yur").disabled = false; $("sinov").disabled = false;
    log(`— Yakun: ${ok} joylandi, ${xato} xato${otkazildi ? `, ${otkazildi} o'tkazib yuborildi` : ""} —`, xato ? "ogoh" : "ok");
    if (!sinov && ok) {
      if (API.tayyor) log("🔄 Sahifani yangilang (F5) — darslar setkada ko'rinadi.", "dim");
      log("Keyin «Nashr etish» ni O'ZINGIZ bosing.", "dim");
    }
  }

  $("yur").onclick = () => run(false);
  $("sinov").onclick = () => run(true);
  $("toxta").onclick = () => { toxtat = true; };

  // ===================================================================
  //  HAMMA SINFGA — ketma-ket
  //
  //  Har sinfning eMaktabdagi sxemasi ALOHIDA (`schedule` id sinfga xos),
  //  shuning uchun sinfma-sinf yuriladi: sxema yaratiladi, `API` o'sha
  //  sxemaga qayta sozlanadi va darslar joylanadi.
  //
  //  ⚠️ MAVJUD SXEMA O'TKAZIB YUBORILADI. Ichida allaqachon dars bo'lishi
  //  mumkin va biz uni ko'ra olmaymiz (boshqa sinfning DOM'i bizda yo'q) —
  //  ustiga yozsak darslar IKKILANADI. Shuning uchun faqat YANGI yaratilgan
  //  sxema to'ldiriladi; mavjudini to'ldirish alohida belgi bilan yoqiladi.
  //
  //  ⚠️ TIZIMLI XATODA TO'XTAYMIZ. Bir sinfda hech narsa joylashmasa,
  //  qolgan 42 sinfda ham joylashmaydi — 43 marta xato yozib chiqishning
  //  ma'nosi yo'q, sababini darrov ko'rsatgan afzal.
  async function hammaSinf() {
    if (!paket && !parse()) { log("✖ Avval jadvalni yuklang", "xato"); return; }
    const period = new URLSearchParams(location.search).get("period") || "";
    if (!period) {
      log("✖ URL da `period` yo'q — istalgan sinfning chorak sxemasi sahifasidan boshlang", "xato");
      return;
    }
    const chorakNomi = String($("chorakNom").value || "").trim();
    if (!chorakNomi) { log("✖ Sxema nomi bo'sh", "xato"); return; }

    const opt = {
      tanaffus: Number($("tanaffus").value) || 350,
      xona: $("xona").checked,
      mavjudHam: $("mavjudHam").checked,
      sinov: false,
    };

    toxtat = false;
    $("toxta").style.display = "";
    $("hamma").disabled = true; $("yur").disabled = true; $("sinov").disabled = true;

    try {
      if (!API.tayyor) await API.init();
      log(`✔ API tayyor — ${API.fanlar.length} ta fan`, "ok");

      const guruhlar = await sinfGuruhlari();
      log(`🏫 eMaktabda ${guruhlar.size} ta sinf topildi`, "dim");

      const ishlar = paket.sinflar.filter((s) => s.darslar.length);
      let jamiOk = 0, jamiXato = 0, otkazildi = 0;

      for (let i = 0; i < ishlar.length; i++) {
        if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
        const sinf = ishlar[i];
        $("hammaHolat").textContent = `${i + 1}/${ishlar.length}: ${sinf.nom}`;
        $("pbar").style.width = Math.round(((i + 1) / ishlar.length) * 100) + "%";

        const g = guruhlar.get(classKey(sinf.nom));
        if (!g) {
          // Shu darajadagi eMaktab nomlarini ko'rsatamiz — foydalanuvchi
          // qaysi biri mos kelishini darhol ko'radi («1-F» yo'q, lekin
          // «1 G» bor kabi holatlar ko'p uchraydi).
          const dj = String(sinf.nom).match(/\d{1,2}/);
          const yaqin = dj
            ? [...guruhlar.values()]
              .filter((x) => (String(x.nom).match(/\d{1,2}/) || [])[0] === dj[0])
              .map((x) => x.nom).join(", ")
            : "";
          log(`✖ ${sinf.nom} — eMaktabda bunday sinf yo'q`
            + (yaqin ? ` (shu darajada: ${yaqin})` : ""), "xato");
          jamiXato++;
          continue;
        }

        let schedId;
        try {
          const royxat = await sxemalar(g.id, period);
          const bor = royxat.find((x) => normKey(x.nom) === normKey(chorakNomi));
          // Mavjud sxema ICHI BO'SH bo'lsa to'ldiriladi — darslar
          // ikkilanmaydi. Ichida dars bo'lsa (yoki bilib bo'lmasa)
          // tegilmaydi; «mavjud sxemani ham to'ldirish» belgisi shu
          // to'siqni ONGLI ravishda ochadi.
          if (bor && !opt.mavjudHam && !(await sxemaBoshmi(g.id, period, bor.id))) {
            otkazildi++;
            log(`↷ ${sinf.nom} — «${chorakNomi}» sxemasida dars bor, tegilmadi`, "dim");
            continue;
          }
          schedId = bor ? bor.id : await sxemaYarat(g.id, period, chorakNomi);
          log(bor
            ? `＝ ${sinf.nom} — mavjud «${chorakNomi}» sxemasi to'ldiriladi`
            : `＋ ${sinf.nom} — «${chorakNomi}» sxemasi yaratildi`, "dim");
        } catch (err) {
          jamiXato++;
          log(`✖ ${sinf.nom} — sxema: ${err.message}`, "xato");
          continue;
        }

        // API ni SHU sinfga sozlaymiz. Kesh tozalanishi SHART: `guruhlar`
        // (subgroup) ro'yxati sinfga xos, eski kesh begona sinfniki bo'ladi.
        API.scheduleId = schedId;
        API.groupId = g.id;
        API.band = new Set();
        API.bosh = null;
        API.fanKesh = new Map();
        try {
          const f0 = await API.formaBoshda(0);
          if (f0.token) API.token = f0.token;
          if (!API.bosh) API.bosh = { kun: 1, soat: 1 };
        } catch (err) {
          jamiXato++;
          log(`✖ ${sinf.nom} — forma: ${err.message}`, "xato");
          continue;
        }

        let ok = 0, xato = 0;
        for (const d of sinf.darslar) {
          if (toxtat) break;
          let r;
          try { r = await placeLessonApi(d, paket, xarita, opt); }
          catch (err) { r = { ok: false, sabab: "kutilmagan xato: " + err.message }; }
          if (r.ok) { ok++; if (r.ogoh) log(`   ⚠ ${sinf.nom} ${d.kun}/${d.soat}: ${r.ogoh}`, "ogoh"); }
          else { xato++; log(`   ✖ ${sinf.nom} ${d.kun}-kun ${d.soat}-soat ${d.fan} — ${r.sabab}`, "xato"); }
          await sleep(opt.tanaffus);
        }
        jamiOk += ok; jamiXato += xato;
        log(`${ok === sinf.darslar.length ? "✔" : "⚠"} ${sinf.nom}: ${ok}/${sinf.darslar.length} joylandi`,
          xato ? "ogoh" : "ok");

        // Tizimli nosozlik — davom etishning ma'nosi yo'q
        if (ok === 0 && xato > 0) {
          log("✖ Bu sinfda birorta dars joylashmadi — to'xtatildi. "
            + "Sababini yuqoridagi xatolardan ko'ring.", "xato");
          break;
        }
      }

      log(`— YAKUN: ${jamiOk} dars joylandi, ${jamiXato} xato`
        + `${otkazildi ? `, ${otkazildi} sinf o'tkazib yuborildi` : ""} —`, jamiXato ? "ogoh" : "ok");
      log("🔄 Har sinfni ochib ko'zdan kechiring va «Nashr etish» ni O'ZINGIZ bosing.", "dim");
    } catch (err) {
      log("✖ " + err.message, "xato");
    }

    $("toxta").style.display = "none";
    $("hamma").disabled = false; $("yur").disabled = false; $("sinov").disabled = false;
    $("hammaHolat").textContent = "";
  }

  $("hamma").onclick = hammaSinf;

  // ——— Qo'lda moslashtirilgan nomlar ———
  // Tur (fan/ustoz/xona) so'ralmaydi: juftlik uchalasiga ham yoziladi.
  // Nom to'plamlari kesishmaydi, shuning uchun bu xavfsiz va ortiqcha
  // savol berishdan qutqaradi.
  function xaritaMatni() {
    const juft = new Map();
    ["fan", "ustoz", "xona"].forEach((k) => {
      Object.entries(xarita[k] || {}).forEach(([a, b]) => juft.set(a, b));
    });
    return [...juft.entries()].map(([a, b]) => `${a} = ${b}`).join("\n");
  }

  $("xarita").value = xaritaMatni();
  $("xaritaSaqla").onclick = () => {
    const yangi = { fan: {}, ustoz: {}, xona: {} };
    let n = 0;
    $("xarita").value.split("\n").forEach((qator) => {
      const i = qator.indexOf("=");
      if (i < 1) return;
      const a = qator.slice(0, i).trim();
      const b = qator.slice(i + 1).trim();
      if (!a || !b) return;
      yangi.fan[a] = b; yangi.ustoz[a] = b; yangi.xona[a] = b;
      n++;
    });
    Object.assign(xarita, yangi);
    try { localStorage.setItem(LS_MAP, JSON.stringify(xarita)); } catch { /* xotira to'la bo'lsa e'tiborsiz */ }
    $("xaritaHolat").textContent = `✔ ${n} ta juftlik saqlandi`;
  };

  // ——— eMaktabdan ma'lumot yig'ish ———
  $("yigish").onclick = async () => {
    const btn = $("yigish");
    btn.disabled = true;
    $("yigHolat").textContent = "boshlandi…";
    log("📥 eMaktab'dan ma'lumot yig'ilmoqda — bu bir necha daqiqa olishi mumkin.", "ok");
    try {
      const data = await collectSchoolData({
        xonalarHam: $("xonaYig").checked,
        onProgress: (m) => { $("yigHolat").textContent = m; },
      });
      const nom = `emaktab-malumot_${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = nom; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("yigHolat").textContent = "✔ tayyor";
      log(`✔ ${data.sinflar.length} sinf, ${data.fanlar.length} fan, `
        + `${data.ustozlar.length} ustoz, ${data.xonalar.length} xona — «${nom}» saqlandi`, "ok");
      if (!data.sinflar.length) {
        log("⚠ Sinflar ro'yxati bo'sh chiqdi — «Dars jadvali» bosh sahifasi ochilmagan bo'lishi mumkin.", "ogoh");
      }
      log("Endi uni Smartjadval → «eMaktab» bo'limidagi «📥 Import» ga bering.", "dim");
    } catch (err) {
      $("yigHolat").textContent = "✖ " + err.message;
      log("✖ Yig'ish bajarilmadi: " + err.message, "xato");
    }
    btn.disabled = false;
  };

  $("recOn").onclick = () => {
    recStart(false);
    log("⏺ Yozuv yoqildi. Endi kerakli amalni qo'lda bajaring — sahifa "
      + "almashsa ham yozuv davom etadi.", "ok");
  };
  $("recOff").onclick = async () => {
    recStop();
    const dump = recDump();
    $("json").value = dump;
    try {
      await navigator.clipboard.writeText(dump);
      log(`⏹ Yozuv to'xtadi: ${REC.tarmoq.length} so'rov, ${REC.dom.length} oyna. Nusxa olindi ✓`, "ok");
    } catch {
      log(`⏹ Yozuv to'xtadi: ${REC.tarmoq.length} so'rov, ${REC.dom.length} oyna. Yuqoridagi maydondan qo'lda nusxalang.`, "ogoh");
    }
    log("Shu matnni dasturchiga bering — keyin joylashtirish aniq ishlaydi.", "dim");
  };

  // Nusxa olish ko'p bosqichli va adashtiradi (bufer almashib ketadi,
  // matn o'nlab ming belgi). Fayl esa to'g'ridan-to'g'ri «Yuklamalar» ga
  // tushadi — dasturchiga berish ancha oson.
  $("recSave").onclick = () => {
    const matn = $("json").value;
    if (!matn.trim()) { log("✖ Saqlaydigan narsa yo'q — avval yozuvni to'xtating", "xato"); return; }
    const url = URL.createObjectURL(new Blob([matn], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dump.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log("💾 «Yuklamalar» papkasiga dump.json saqlandi ✓", "ok");
  };

  // Smartjadval «⚡ Hammasi birga» tugmasi jadvalni shu o'zgaruvchiga
  // qo'yadi. Skript qayta qo'yilganda ham shu funksiya chaqiriladi
  // (yuqoridagi qorovulga qarang).
  function yangiJadval() {
    if (!window.__SJ_JADVAL__) return false;
    $("json").value = JSON.stringify(window.__SJ_JADVAL__);
    const ok = parse();
    panel.classList.add("ochiq");
    return ok;
  }

  // Oldingi sahifada yuklangan jadvalni tiklash — 40+ sinfni birma-bir
  // o'tkazayotganda faylni har safar qayta tanlash kerak bo'lmasin.
  function saqlanganJadval() {
    let raw = "";
    try { raw = localStorage.getItem(LS_JADVAL) || ""; } catch { raw = ""; }
    if (!raw) return false;
    $("json").value = raw;
    const ok = parse();
    if (!ok) { try { localStorage.removeItem(LS_JADVAL); } catch { /* e'tiborsiz */ } }
    return ok;
  }

  // Console'dan qo'lda tekshirish uchun (nosozlik qidirilganda asqotadi)
  window.__SJ_BRIDGE__ = {
    ochish: () => panel.classList.add("ochiq"),
    yangiJadval,
    setka: findGrid,
    hisobot: gridReport,
    oyna: findOpenForm,
    api: API,
    paket: () => paket,
  };

  // Avval «Hammasi birga» dan kelgan jadval, bo'lmasa oxirgi saqlangani
  const yuklandi = yangiJadval() || saqlanganJadval();

  // Oldingi sahifada panel ochiq turgan bo'lsa — ochiq qoldiramiz
  if (ochiqEdi) panel.classList.add("ochiq");

  // Yozuv oldingi sahifada yoqilgan bo'lsa — DAVOM ettiramiz.
  // Aynan shu holat kerak: sxema yaratish, nashr etish va boshqa
  // muhim amallar sahifani almashtiradi.
  if (REC.yoniq) {
    recStart(true);
    panel.classList.add("ochiq");
    log(`⏺ Yozuv DAVOM etyapti — ${REC.tarmoq.length} ta so'rov yozildi. `
      + "Amalni tugatgach «⏹ To'xtatish va nusxalash» ni bosing.", "ogoh");
  }

  // Setka holati DARROV ko'rinsin: foydalanuvchi to'g'ri sahifada
  // turganini JSON kutmasdan bilishi kerak.
  checkGrid();

  log(yuklandi
    ? "Ko'prik tayyor — jadval eslab qolingan. Sinfni tekshirib «▶ Joylashtirish» ni bosing."
    : "Ko'prik tayyor. Jadvalni «📂 Fayldan» bilan yuklang.", "dim");
})();
