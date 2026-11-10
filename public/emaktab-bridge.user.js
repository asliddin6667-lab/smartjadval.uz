// ==UserScript==
// @name         Smartjadval → eMaktab ko'prigi
// @namespace    https://smartjadval.uz/
// @version      1.16.2
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
//    1) Tampermonkey — shu faylni o'rnating. eMaktab'ning yuqori
//       menyusida (TA'LIM · MULOQOT · …) «SJ DARS JADVALI» bandi
//       chiqadi — bosilsa markazda katta dashboard oynasi ochiladi:
//       chapda jadval fayli, chorak va sozlamalar, o'ngda sinflar
//       jadvali (har sinfning sxemasi va holati bilan). Istalgan
//       sahifadan ishlaydi — schools.emaktab.uz dan tashqarida
//       bosilsa avval o'sha yerga o'tkazadi.
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

  // ⚠️ KO'PRIK `schools.<domen>` DA ISHLAYDI.
  //
  //  eMaktab API'si va sessiya cookie'si `schools.emaktab.uz` da
  //  (kundalik.com uchun `schools.kundalik.com`). `emaktab.uz/teachers`
  //  kabi boshqa subdomendan u yerga so'rov yuborib bo'lmaydi (CORS).
  //  Shuning uchun boshqa subdomenda faqat yuqori menyu bandi qo'yiladi
  //  (2B-QISM) — bosilsa `schools.` ga o'tkazadi va oyna u yerda ochiladi.
  //  `schools.` ichida esa dashboard ISTALGAN sahifada ishlaydi: sxema
  //  id'lari URL'dan emas, so'rovlar bilan topiladi.
  //  Konsolga qo'lda qo'yilganda cheklov yo'q — foydalanuvchi ataylab
  //  ishga tushirgan bo'ladi.
  const QOLDA = typeof GM_info === "undefined";   // Tampermonkeysiz — Console
  const KOPRIK_HOST = QOLDA || /^schools\./i.test(location.hostname);

  // Qabul qilinadigan jadval formati versiyalari (emaktabExport.js dagi
  // `EMAKTAB_FORMAT_VERSION`). 2 — `emaktab` id xaritasi bilan, 1 — usiz
  // (u holda nomlar bo'yicha moslashtirish ishlaydi).
  const V = [1, 2, 3];   // 3 — paketda `emaktab.guruhlar` (sinf ichidagi o'quv guruhlari id'lari)
  const LS_MAP = "sj_emaktab_map_v1";       // qo'lda moslashtirilgan nomlar
  const LS_JADVAL = "sj_emaktab_jadval_v1"; // oxirgi jadval (sinflar bo'ylab yuriladi)
  const LS_OCHIQ = "sj_emaktab_panel_ochiq"; // panel ochiq turganmi
  const LS_REC_ON = "sj_emaktab_rec_on";     // «O'rganish» yozuvi yoqiqmi
  const LS_REC = "sj_emaktab_rec_data";      // yozib olingan so'rovlar
  const LS_CHORAK = "sj_emaktab_choraklar_v1"; // topilgan chorak yorliqlari (maktab bo'yicha)

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
    ["O'qish","Чтение","Литературное чтение"],
    ["O'qish savodxonligi","Грамотность чтения"],
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
    ["Davlat va huquq asoslari","Основы государства и права","Dav-t va huquq asos.","Huquq asoslari"],
    ["Iqtisodiy bilim asoslari","Основы экономических знаний"],
    ["Tadbirkorlik asoslari","Основы предпринимательства"],
    ["Tarbiya","Воспитание"],
    ["Kelajak soati","Час будущего"],
    ["Tanqidiy fikrlash","Критическое мышление"],
    ["Informatika","Информатика"],
    ["Informatika va axborot texnologiyalari","Информатика и информационные технологии","Informatika va AT","Informatika va A.T.","Informatika va AKT","Axborot texnologiyalari","Информатика и ИТ","Информатика и ИКТ","Информационные технологии","Информатика и информ. технологии"],
    ["Texnologiya","Технология","Mehnat","Труд"],
    ["Chizmachilik","Черчение"],
    ["Tasviriy san'at","Изобразительное искусство","Изо"],
    ["Musiqa","Музыка"],
    ["Musiqa madaniyati","Музыкальная культура"],
    ["Jismoniy tarbiya","Физическая культура","Jismoniy madaniyat","Физическое воспитание"],
    ["Chaqiruvga qadar boshlang'ich tayyorgarlik","Начальная допризывная подготовка","CHQBT","ЧҚБТ","НДП"],
    ["Boshlang'ich ta'lim","Начальное образование"],
    ["Tanlov fanlari","Предметы по выбору"],
  ];
  const SYN_MAP = new Map();
  SYN.forEach((row, i) => row.forEach((n) => { const k = normKey(n); if (k && !SYN_MAP.has(k)) SYN_MAP.set(k, i); }));
  const synGroup = (s) => (SYN_MAP.has(normKey(s)) ? SYN_MAP.get(normKey(s)) : -1);
  // Qarindosh guruhlar — aniq sinonim topilmasa ikkinchi navbat.
  // ⚠️ src/utils/emaktabNames.js dagi SUBJECT_KIN bilan BIR XIL.
  const KIN = [
    ["O'qish","Чтение","Литературное чтение","O'qish savodxonligi","Грамотность чтения"],
  ];
  const KIN_MAP = new Map();
  KIN.forEach((row, i) => row.forEach((n) => { const k = normKey(n); if (k && !KIN_MAP.has(k)) KIN_MAP.set(k, i); }));
  const kinGroup = (s) => (KIN_MAP.has(normKey(s)) ? KIN_MAP.get(normKey(s)) : -1);

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
    const kg = kinGroup(target);
    if (kg >= 0) {
      const kin = list.filter((x) => kinGroup(lab(x)) === kg);
      if (kin.length) {
        const bir = sc ? kin.find((x) => scriptOf(lab(x)) === sc) : null;
        return { qiymat: bir || kin[0], ishonch: "sinonim" };
      }
    }
    // ⚠️ eMAKTAB FAN NOMINI ~20 BELGIGA KESADI VA SO'ZLARNI QISQARTIRADI:
    //  «Davlat va huquq asoslari» → «Dav-t va huquq asos.»,
    //  «Chaqiruvga qadar boshlang'ich tayyorgarlik» → «Chaqiruvga qadar bosh».
    //  Ichma-ich qidiruv («qismiy») buni topmaydi — «davtvahuquqasos»
    //  to'liq nomning bo'lagi emas. So'zma-so'z solishtiramiz.
    //  Jonli maktabda 21 dars aynan shu sababdan tushmadi (21.09.2026).
    //  ⚠️ src/utils/emaktabNames.js dagi `abbrevMatch` bilan BIR XIL.
    const qisq = list.filter((x) => abbrevMatch(lab(x), target) || abbrevMatch(target, lab(x)));
    if (qisq.length) {
      const bir = sc ? qisq.filter((x) => scriptOf(lab(x)) === sc) : [];
      const tanlov = bir.length ? bir : qisq;
      // Bir nechta nomzod qolsa — tavakkal qilmaymiz, aniqroq yo'l yo'q.
      if (tanlov.length === 1) return { qiymat: tanlov[0], ishonch: "qismiy" };
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

  // Nomni so'zlarga bo'lish: qisqartma qo'shimchasi («dav-t» → «dav»),
  // nuqta, qavs tashlanadi; har so'z normKey bilan tozalanadi.
  function sozlar(raw) {
    return String(raw == null ? "" : raw)
      .replace(APOS, "")
      .toLowerCase()
      .split(/[\s()]+/)
      .map((w) => normKey(w.replace(/-\S*$/, "")))
      .filter(Boolean);
  }

  // `qisqa` — `toliq` ning kesilgan/qisqartirilgan shaklimi?
  // Har bir qisqa so'z o'z o'rnidagi to'liq so'zning BOSHI bo'lishi shart;
  // bir harfli so'z faqat aynan teng bo'lsa o'tadi. Kamida so'zlarning
  // yarmi va ≥8 belgi mos kelsin — «va», «tili» kabi umumiy so'zlar bilan
  // tasodifiy moslik bo'lmasin («Tarix» ⊄ «Tarixdan hikoyalar»).
  function abbrevMatch(qisqa, toliq) {
    const a = sozlar(qisqa);
    const b = sozlar(toliq);
    if (!a.length || !b.length || a.length > b.length) return false;
    let umumiy = 0;
    for (let i = 0; i < a.length; i++) {
      if (!b[i].startsWith(a[i])) return false;
      if (a[i].length < 2 && a[i] !== b[i]) return false;
      umumiy += a[i].length;
    }
    return a.length * 2 >= b.length && umumiy >= 8;
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
  //  2B-QISM. YUQORI MENYU BANDI — «SJ DARS JADVALI»
  //
  //  eMaktab'ning asosiy menyusi (TA'LIM · MULOQOT · O'QITUVCHIGA ·
  //  TO'LOVLAR) oldiga o'z bandimiz qo'yiladi. O'ng pastdagi dumaloq
  //  «SJ» tugma ko'zga tashlanmas edi — foydalanuvchi ko'prikni qayerdan
  //  ochishni bilmay qolardi. Menyu bandi esa HAR sahifada, sayt
  //  uslubida turadi.
  //
  //  NEGA KLON: band TA'LIM bandining nusxasidan yasaladi — shrift,
  //  bo'shliq, hover rangi saytnikidan meros oladi; eMaktab uslubini
  //  o'zgartirsa ham band chetda qolmaydi. Faqat ichidagi matn va
  //  havola almashtiriladi, «faol» belgisi olib tashlanadi.
  //
  //  BOSILGANDA: dars jadvali bo'limida — panel ochiladi; boshqa
  //  sahifada — panel «ochiq» deb belgilanib, «Darslar jadvali»
  //  bo'limiga o'tiladi (u yerda skript qayta yuklanib panelni ochadi).
  //
  //  Menyu topilmasa hech narsa bo'lmaydi — eski «SJ» tugmasi qoladi.
  // ===================================================================
  const MENYU_BIRINCHI = new Set(["talim", "obrazovanie", "obuchenie", "education"]);
  const MENYU_QOSHNI = new Set(["muloqot", "obshenie", "communication",
    "oqituvchiga", "uchitelyu", "teacher", "tolovlar", "oplata", "platezhi", "payments"]);

  // Menyuning birinchi bandi (TA'LIM) — yonida MULOQOT/O'QITUVCHIGA turgani.
  // Sahifada «Ta'lim» so'zi boshqa joyda ham uchrashi mumkin, shuning
  // uchun qo'shni bandlar ham tekshiriladi.
  function menyuBirinchiBand() {
    for (const el of document.querySelectorAll("a")) {
      if (el.closest("#sj-bridge-host") || el.closest("#sj-menyu")) continue;
      if (!MENYU_BIRINCHI.has(normKey(txt(el))) || !visible(el)) continue;
      const qator = (el.closest("li") || el).parentElement;
      if (!qator) continue;
      const qoshni = [...qator.querySelectorAll("a")].some((x) => MENYU_QOSHNI.has(normKey(txt(x))));
      if (qoshni) return el;
    }
    return null;
  }

  function maktabId() {
    const q = new URLSearchParams(location.search).get("school");
    if (q) return q;
    for (const a of document.querySelectorAll('a[href*="school="]')) {
      const m = String(a.getAttribute("href") || "").match(/[?&]school=(\d+)/);
      if (m) return m[1];
    }
    return "";
  }

  // «Darslar jadvali» bo'limining TO'LIQ manzili — `schools.` subdomenida.
  //  Ilgari nisbiy `/v2/schedules/` edi: emaktab.uz/teachers dan bosilganda
  //  emaktab.uz/v2/schedules/ ga ketib 404 berardi (02.11.2026).
  function jadvalBolimiUrl() {
    const id = maktabId();
    const ildiz = location.hostname.split(".").slice(-2).join(".");   // emaktab.uz / kundalik.com
    return `https://schools.${ildiz}/v2/schedules/` + (id ? "?school=" + encodeURIComponent(id) : "");
  }

  // Bandni qo'yish. Qaytadi: true — qo'yildi (yoki allaqachon bor),
  // false — menyu hali topilmadi (chaqiruvchi kutib qayta uradi).
  function menyuBandiQosh(onClick) {
    if (document.getElementById("sj-menyu")) return true;
    const a = menyuBirinchiBand();
    if (!a) return false;
    const asl = a.closest("li") || a;
    const yangi = asl.cloneNode(true);
    yangi.id = "sj-menyu";
    // Klonda «faol» belgisi va sahifaning id'lari qolmasin
    [yangi, ...yangi.querySelectorAll("*")].forEach((el) => {
      if (el !== yangi) el.removeAttribute("id");
      [...el.classList].filter((c) => /active|selected|current/i.test(c))
        .forEach((c) => el.classList.remove(c));
    });
    const havola = yangi.matches("a") ? yangi : yangi.querySelector("a");
    if (!havola) return false;
    havola.href = KOPRIK_HOST ? "#smartjadval" : jadvalBolimiUrl();
    havola.title = "Smartjadval → eMaktab: dars jadvalini sxemaga joylashtirish";
    havola.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:7px;white-space:nowrap;">'
      + '<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:.72em;'
      + 'font-weight:800;letter-spacing:.05em;line-height:1.55;color:#fff;'
      + 'background:linear-gradient(135deg,#6366f1,#a855f7);'
      + 'box-shadow:0 2px 8px rgba(99,102,241,.45);">SJ</span>'
      + '<span>DARS JADVALI</span></span>';
    havola.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
    asl.parentNode.insertBefore(yangi, asl);
    return true;
  }

  // `schools.` dan TASHQARIDA — faqat menyu bandi, oyna yo'q.
  // Menyu ba'zan skriptdan keyin chiziladi, shuning uchun 6 s kutiladi.
  if (!KOPRIK_HOST) {
    // Oyna «ochiq» deb belgilanadi — `schools.` da skript qayta yuklanib
    // uni darrov ochadi (menyudan bosgan odam oynani kutadi).
    waitFor(() => menyuBandiQosh(() => { ochiqYoz(true); location.href = jadvalBolimiUrl(); }), 6000, 250);
    return;
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

  // Sahifada QAYSI CHORAK ochiq — yuqoridagi «1 chorak | 2 chorak | …»
  // yorliqlaridan. Sxema nomi shunga qarab taklif qilinadi.
  //
  //  ⚠️ ILGARI NOM «1 chorak» DEB QATTIQ YOZILGAN EDI. 2-chorak
  //  yorlig'ida turib «Hamma sinfga» bosilsa, 2-chorak davriga
  //  «1 chorak» nomli sxema yaratilardi — ro'yxatda chalg'ituvchi nom
  //  qolar, keyingi yurishda esa «1 chorak» nomli sxema izlanib
  //  topilmasdi (jonli maktabda 6-A da aynan shunday bo'ldi, 02.11.2026).
  //
  //  Aniqlash tartibi:
  //   1) havolasida URL dagi joriy `period` turgan yorliq;
  //      (sxema havolalari — `schedule=` lisi — chetlab o'tiladi: sxemaning
  //       o'zi ham «1 chorak» deb nomlangan bo'lishi mumkin)
  //   2) faol yorliq: havolasiz turgani yoki active/selected klasslisi.
  //  Topilmasa bo'sh qaytadi — chaqiruvchi «1 chorak» ni qoldiradi.
  const CHORAK_RE = /^\d{1,2}\s*[-–—]?\s*(chorak|четверть|yarim\s*yil|полугодие|semestr|семестр|trimestr|триместр)$/i;

  function joriyChorakNomi() {
    const period = new URLSearchParams(location.search).get("period") || "";
    const havola = (el) => el.closest("a") || el.querySelector("a");
    const nomzodlar = [...document.querySelectorAll("a, span, li, b, div")]
      .filter((el) => !el.closest("#sj-bridge-host") && el.children.length <= 1
        && CHORAK_RE.test(txt(el)) && visible(el));   // yashirin shablonlar emas
    if (!nomzodlar.length) return "";

    if (period) {
      const re = new RegExp("[?&]period=" + period + "(&|$)");   // 111 ≠ 1110
      const f = nomzodlar.find((el) => {
        const a = havola(el);
        const h = a ? String(a.getAttribute("href") || "") : "";
        return re.test(h) && !/[?&]schedule=/.test(h);
      });
      if (f) return txt(f);
    }

    const faol = nomzodlar.find((el) => {
      const a = havola(el);
      if (a && /[?&]schedule=/.test(String(a.getAttribute("href") || ""))) return false;
      const kl = [el, el.parentElement, a].filter(Boolean).map((x) => String(x.className || "")).join(" ");
      return /active|selected|current/i.test(kl) || !a;
    });
    return faol ? txt(faol) : "";
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

  // `xss` — sessiyaga bog'liq token. Havolada (`?xss=`, HTML'da `&amp;xss=`),
  //  kodlangan manzilda (`xss%3D`) yoki skript/atributda (`xss: "…"`,
  //  `data-xss="…"`) turishi mumkin. Faqat hex qabul qilinadi: noto'g'ri
  //  qiymat olinsa so'rovlar sababini aytmasdan rad etiladi.
  const xssIzla = (matn) => {
    const m = String(matn == null ? "" : matn)
      .match(/xss(?:%3D|[\w-]*["']?\s*[:=]\s*["']?)([0-9a-f]{16,})/i);
    return m ? m[1] : "";
  };

  // Sahifa yuborib bo'lgan so'rovlar manzilida ham token bor
  const xssSorovlardan = (w) => {
    try {
      return xssIzla(w.performance.getEntriesByType("resource").map((e) => e.name).join(" "));
    } catch { return ""; }
  };

  const API = {
    tayyor: false,         // sxemaga ulangan: token, fanlar, bo'sh katak bor
    umumiy: false,         // maktab id va xss bor (sxemasiz ham ishlaydigan qism)
    maktabNomi: "",
    xss: "", token: "", schoolId: "", scheduleId: "", groupId: "",
    bosh: null,            // { kun, soat } — ro'yxat so'rash uchun BO'SH katak
    band: new Set(),       // shu yurishda TO'LDIRILGAN kataklar ("kun_soat")
    fanlar: [],            // [{ v, label }] — butun maktab fanlari
    fanKesh: new Map(),    // fanId → { guruhlar, ustozlar, xonalar }

    // ⚠️ SXEMA SAHIFASIDA BO'LMASAK HAM ISHLAYDI.
    //
    //  Ilgari init URL'dagi `schedule` bo'lmasa to'xtab qolardi — dashboard
    //  esa istalgan sahifadan ochiladi. Maktab id'si URL'dan yoki sahifa
    //  havolalaridan, `xss` joriy sahifadan, bo'lmasa «Darslar jadvali»
    //  ro'yxati sahifasidan, u yerda ham bo'lmasa birinchi sinfning
    //  generator sahifasidan olinadi.
    async initUmumiy() {
      if (this.umumiy) return;
      const q = new URLSearchParams(location.search);
      this.schoolId = this.schoolId || q.get("school") || maktabId() || "";
      this.scheduleId = this.scheduleId || q.get("schedule") || "";
      this.groupId = this.groupId || q.get("group") || "";
      this.xss = this.xss || xssIzla(document.documentElement.innerHTML) || xssSorovlardan(window);
      let royxatHtml = "";
      // Maktab nomi — `/v2/school` havolasi (menyu bandi emas: TA'LIM ham shunga olib borishi mumkin)
      // «Mening maktabim», «Maktab sahifasi» kabi umumiy yorliqlar emas —
      // yo'lakchadagi haqiqiy nom («TURON ODOB-ILM») kerak.
      // Menyu va pastki menyu bandlari («O'qituvchi», «Mening sinflarim»…)
      // ham `/v2/school…` ga olib boradi — ular chetlab o'tiladi. Eng ishonchlisi
      // yo'lakchadagi havola: `…/v2/school?school=<id>` dan boshqa hech narsasi yo'q.
      const UMUMIY = new Set(["meningmaktabim", "maktabsahifasi", "maktab", "moyashkola", "shkola", "school",
        "myschool", "oqituvchi", "oqituvchiga", "uchitel", "uchitelyu", "teacher", "meningsinflarim", "moiklassy",
        "hisobotlar", "otchety", "jurnallar", "jurnaly", "darsjadvali", "raspisanie", "uyvazifasi", "domashniezadaniya",
        "administratsiya", "administraciya", "sinflar", "klassy", "oquvchilar", "ucheniki", "xodimlar", "sotrudniki"]);
      const maktabHavola = (root) => {
        let eng = "", engBall = -1;
        for (const a of root.querySelectorAll('a[href*="/v2/school"]')) {
          const t = txt(a), k = normKey(t);
          if (!t || !k || MENYU_BIRINCHI.has(k) || MENYU_QOSHNI.has(k) || UMUMIY.has(k)) continue;
          const h = String(a.getAttribute("href") || "");
          const ball = /\/v2\/school\/?\?school=\d+$/.test(h) ? 2 : (/[?&]school=\d+/.test(h) ? 1 : 0);
          if (ball > engBall) { eng = t; engBall = ball; }
          if (ball === 2) break;
        }
        return eng;
      };
      this.maktabNomi = this.maktabNomi || maktabHavola(document);
      if (!this.xss || !this.schoolId || !this.maktabNomi) {
        const r = await fetch(`/v2/schedules/${this.schoolId ? "?school=" + enc(this.schoolId) : ""}`,
          { credentials: "same-origin" });
        if (r.ok) {
          const html = await r.text();
          royxatHtml = html;
          if (!this.xss) this.xss = xssIzla(html);
          if (!this.schoolId) { const m = html.match(/[?&]school=(\d+)/); if (m) this.schoolId = m[1]; }
          if (!this.maktabNomi) {
            this.maktabNomi = maktabHavola(new DOMParser().parseFromString(html, "text/html"));
          }
        }
      }
      if (!this.schoolId) throw new Error("maktab id (`school`) topilmadi — schools.emaktab.uz da ekaningizni tekshiring");
      if (!this.xss) await this.xssOvla(royxatHtml);
      if (!this.xss) {
        throw new Error("eMaktab sessiya tokeni topilmadi. Sahifani yangilab qayta bosing; "
          + "takrorlansa eMaktab'dan chiqib qayta kiring.");
      }
      this.umumiy = true;
    },

    // ⚠️ FOYDALANUVCHI HECH QAYSI SAHIFAGA O'TMASLIGI KERAK: token bir bosishda
    //  o'zi topiladi. Sinflar bo'ylab yuriladi: sinf sahifalari → chorak
    //  yorliqlari → mavjud sxemaning tahrirlash sahifasi → dars formasi →
    //  oxirida shu sahifa yashirin iframe'da ochiladi (token skript bilan
    //  qo'yilgan bo'lsa). Hammasi faqat GET, hech narsa o'zgarmaydi.
    async xssOvla(royxatHtml) {
      const tashxis = [];
      const oqi = async (url) => {
        try {
          const r = await fetch(url, { credentials: "same-origin" });
          tashxis.push(`${url.split("?")[0]}: ${r.status}`);
          if (!r.ok) return "";
          const html = await r.text();
          if (!this.xss) this.xss = xssIzla(html);
          return html;
        } catch (err) { tashxis.push(`${url.split("?")[0]}: ${err.message}`); return ""; }
      };
      const hammasi = (re, matn) => [...new Set([...String(matn).matchAll(re)].map((m) => m[1]))];
      const school = enc(this.schoolId);
      let tahrirUrl = "";

      const guruhlar = hammasi(/[?&;]group=(\d+)/g, royxatHtml).slice(0, 5);
      for (const g of guruhlar) {
        const sahifa = [await oqi(sxemaUrl(g, "")), this.xss ? "" : await oqi(`/v2/schedules/view?school=${school}&group=${enc(g)}`)];
        if (this.xss) return;
        for (const p of hammasi(/[?&;]period=(\d+)/g, sahifa.join(" ")).slice(0, 4)) {
          sahifa.push(await oqi(sxemaUrl(g, p)));
          if (this.xss) return;
        }
        const matn = sahifa.join(" ");
        const sxema = hammasi(/[?&;]schedule=(\d+)/g, matn)[0];
        if (!sxema) continue;
        const period = (matn.match(/[?&;]period=(\d+)/) || [])[1] || "";
        tahrirUrl = sxemaUrl(g, period, `&view=edit&schedule=${enc(sxema)}`);
        await oqi(tahrirUrl);
        if (this.xss) return;
        await oqi(`/v2/AjaxPages/scheduleitemnew?schedule=${enc(sxema)}&day=1&lesson=1&subject=0`);
        if (this.xss) return;
        break;
      }
      await oqi(`/v2/school?school=${school}`);
      if (this.xss) return;

      const birinchi = guruhlar.length ? sxemaUrl(guruhlar[0], "") : "";
      if (tahrirUrl || birinchi) this.xss = await this.xssIframe(tahrirUrl || birinchi);
      if (!this.xss) console.warn("[Smartjadval] xss topilmadi:", tashxis.join(" | "));
    },

    // Token sahifa skripti bilan qo'yilganda `fetch` uni ko'rmaydi.
    // `@noframes` tufayli ko'prik skripti iframe ichida qayta ishga tushmaydi.
    xssIframe(url) {
      return new Promise((resolve) => {
        const f = document.createElement("iframe");
        f.style.cssText = "position:fixed;left:-9999px;top:0;width:1200px;height:800px;border:0";
        f.setAttribute("aria-hidden", "true");
        let vaqt = null, sanoq = null;
        const tugat = (v) => {
          clearTimeout(vaqt); clearInterval(sanoq);
          f.remove();
          resolve(v);
        };
        const tekshir = () => {
          try {
            return xssIzla(f.contentDocument.documentElement.innerHTML) || xssSorovlardan(f.contentWindow);
          } catch { return ""; }
        };
        f.onload = () => {
          let n = 0;
          sanoq = setInterval(() => {
            const v = tekshir();
            if (v || ++n >= 10) tugat(v);
          }, 400);
        };
        vaqt = setTimeout(() => tugat(""), 15000);
        f.src = url;
        document.body.appendChild(f);
      });
    },

    async init() {
      await this.initUmumiy();
      // Sxema sahifasida emasmiz — sxema sinfma-sinf beriladi (dashboard)
      if (!this.scheduleId) return { fanlar: 0, katak: null };

      const { katak, f } = await this.boshKatak();
      this.bosh = katak;
      this.token = f.token;
      this.fanlar = f.fanlar;
      if (!this.token) throw new Error("__RequestVerificationToken topilmadi");
      if (!this.fanlar.length) throw new Error("fanlar ro'yxati bo'sh");
      this.tayyor = true;
      return { fanlar: this.fanlar.length, katak };
    },

    // Fanlar ro'yxati uchun BIRORTA sxema kerak (forma sxemaga bog'liq).
    // Dashboard sxema sahifasidan tashqarida ochilganda: sinflar bo'ylab
    // yurib, topilgan birinchi sxemaga ulanadi.
    async birorSxema() {
      await this.initUmumiy();
      const g = await sinfGuruhlari();
      let chorakSinov = 0;
      for (const gr of g.values()) {
        let royxat = [];
        try { royxat = await sxemalar(gr.id, ""); } catch { royxat = []; }
        // Chorak ko'rsatilmagan sahifada sxema havolalari bo'lmasligi mumkin —
        // sxema borligiga qaramay «yo'q» demaslik uchun choraklar ham ko'riladi.
        // Faqat 5 ta sinfda: sxemasi yo'q maktabda yuzlab so'rov ketmasin.
        if (!royxat.length && chorakSinov < 5) {
          chorakSinov++;
          try {
            for (const c of (await choraklarOqi(gr.id)).royxat) {
              royxat = await sxemalar(gr.id, c.id);
              if (royxat.length) break;
            }
          } catch { royxat = []; }
        }
        if (!royxat.length) continue;
        this.scheduleId = royxat[0].id;
        this.groupId = gr.id;
        this.bosh = null; this.band = new Set(); this.fanKesh = new Map();
        const { katak, f } = await this.boshKatak();
        this.bosh = katak; this.token = f.token; this.fanlar = f.fanlar;
        if (this.token && this.fanlar.length) { this.tayyor = true; return; }
      }
      throw new Error("maktabda bironta sxema yo'q — avval «🗂 Hammasiga sxema yaratish» ni bosing");
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
    if (!API.fanlar.length) await API.birorSxema();
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

    // ——— O'quv guruhlari (subgroup): HAR SINF uchun alohida sahifa ———
    //
    //  NEGA: «Texnologiya» kabi fanlar sinfni bo'lib o'tiladi va eMaktab
    //  «Yangi dars» formasida «Kim ishtirok etmoqda» ro'yxatiga SHU
    //  sinfning o'quv guruhlarini («bollar», «qizlar»…) chiqaradi. Guruh
    //  nomi Smartjadval'da boshqacha yozilgan bo'lsa («1-qizlar») dars
    //  butun sinfga tushar, ikkinchi guruh esa «butun sinf uchun
    //  allaqachon dars mavjud» deb rad etilardi (jonli maktab, 09.11.2026).
    //  Guruhlar Smartjadval'ga tushsa «2 guruhga bo'lish» da aynan
    //  eMaktab'dagi nomlar tanlanadi va id bilan yuboriladi.
    //
    //  Sahifa: /v2/admin/class/class?class=<id>&school=<id>&view=subgroups
    //  Jadval: guruh nomi (havola) · o'quvchilar soni · o'zgartirilgan sana.
    //  Havoladagi raqamli parametr (subgroup=/group=/id=) guruh id'si deb
    //  olinadi; topilmasa id bo'sh qoladi — moslashtirish nom bo'yicha ketadi.
    if (sinflar.length) {
      say("o'quv guruhlari o'qilmoqda…");
      // Admin ro'yxatidagi `class=` id'lari jadvaldagi `group=` bilan bir
      // xil bo'lmasa — nom bo'yicha moslab olamiz.
      const adminId = new Map();
      try {
        const r = await fetch(`/v2/admin/class/default?school=${enc(API.schoolId)}`, { credentials: "same-origin" });
        if (r.ok) {
          const doc = new DOMParser().parseFromString(await r.text(), "text/html");
          doc.querySelectorAll('a[href*="class="]').forEach((a) => {
            const m = String(a.getAttribute("href") || "").match(/[?&]class=(\d+)/);
            const k = classKey(txt(a));
            if (m && k && !adminId.has(k)) adminId.set(k, m[1]);
          });
        }
      } catch { /* admin ro'yxati ochilmasa jadvaldagi id ishlatiladi */ }

      for (let i = 0; i < sinflar.length; i++) {
        const s = sinflar[i];
        const cid = adminId.get(classKey(s.nom)) || s.id;
        say(`guruhlar ${i + 1}/${sinflar.length}: ${s.nom}`);
        try {
          const r = await fetch(`/v2/admin/class/class?class=${enc(cid)}&school=${enc(API.schoolId)}&view=subgroups`,
            { credentials: "same-origin" });
          if (!r.ok) continue;
          const doc = new DOMParser().parseFromString(await r.text(), "text/html");
          const guruhlar = [];
          doc.querySelectorAll("table tr").forEach((tr) => {
            const a = tr.querySelector("td a[href]");
            if (!a) return;
            const nom = txt(a);
            // «Guruhni yaratish» kabi amal havolalari guruh emas
            if (!nom || /yaratish|создать|create|o[‘’'ʻʼ]?chirish|удалить/i.test(nom)) return;
            const href = String(a.getAttribute("href") || "");
            // class= va school= dan BOSHQA raqamli parametr — guruh id'si
            let id = "";
            for (const m of href.matchAll(/[?&]([A-Za-z_]+)=(\d{6,})/g)) {
              if (!/^(class|school)$/i.test(m[1])) { id = m[2]; break; }
            }
            const tds = [...tr.querySelectorAll("td")];
            const son = tds.map((td) => txt(td)).find((t, j) => j > 0 && /^\d{1,3}$/.test(t));
            guruhlar.push({ id, nom, oquvchilar: son ? Number(son) : 0 });
          });
          s.guruhlar = guruhlar;
        } catch { /* bitta sinf o'qilmasa qolganlari davom etadi */ }
      }
    }

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

    const maktabNomi = API.maktabNomi || txt(document.querySelector('a[href*="/v2/school"]')) || "";
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

  // ——— O'QUV GURUHI (subgroup) NOMI ———
  //
  //  eMaktab formasida guruh «O'quv guruhi: bollar» / «Учебная группа:
  //  мальчики» ko'rinishida, setkada esa «Kichik guruh bollar» bo'lib
  //  chiqadi. Smartjadval'da esa faqat «bollar». Solishtirishdan oldin
  //  shu old qo'shimchalar tashlanadi.
  //  ⚠️ src/utils/emaktabNames.js dagi `subgroupKey` bilan BIR XIL.
  const GURUH_PREFIKS = /^\s*(o[\u2018\u2019'ʻʼ`´]?quv\s+guruhi|kichik\s+guruh|guruh|учебная\s+группа|подгруппа|группа|subgroup|group)\s*[:\-–—]?\s*/i;
  function subgroupKey(raw) {
    return normKey(String(raw == null ? "" : raw).replace(GURUH_PREFIKS, ""));
  }
  const BUTUN_SINF = /^(butun\s+sinf|весь\s+класс|whole\s+class)$/i;

  // Dars guruhini eMaktab `#subgroup` ro'yxatidan topish.
  //  1) paketdagi id (Smartjadval eMaktab'dan import qilgan guruh id'si)
  //  2) old qo'shimchasiz aniq nom
  //  3) bestMatch (sinonim/qismiy) — faqat bitta nomzod qolsa
  //  Qaytadi { qiymat, ishonch } — topilmasa qiymat null.
  function guruhTop(guruhNom, royxat, guruhIdlar) {
    const nomzodlar = (royxat || []).filter((g) => !BUTUN_SINF.test(String(g.label || "").trim()));
    if (!guruhNom || !nomzodlar.length) return { qiymat: null, ishonch: "" };
    const id = guruhIdlar && guruhIdlar[guruhNom];
    if (id) {
      const f = nomzodlar.find((g) => String(g.v) === String(id));
      if (f) return { qiymat: f, ishonch: "id" };
    }
    const k = subgroupKey(guruhNom);
    if (k) {
      const aniq = nomzodlar.filter((g) => subgroupKey(g.label) === k);
      if (aniq.length === 1) return { qiymat: aniq[0], ishonch: "aniq" };
      if (aniq.length > 1) return { qiymat: aniq[0], ishonch: "aniq" };
    }
    const m = bestMatch(guruhNom, nomzodlar.map((g) => ({ v: g.v, label: String(g.label || "").replace(GURUH_PREFIKS, "") })), "fan");
    if (m.qiymat) {
      const f = nomzodlar.find((g) => g.v === m.qiymat.v);
      if (f) return { qiymat: f, ishonch: m.ishonch };
    }
    return { qiymat: null, ishonch: "" };
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
    if (!m.qiymat) return { ok: false, sabab: topilmadiSabab(name, list) };
    return { ok: true, id: m.qiymat.v, label: m.qiymat.label, ishonch: m.ishonch };
  }

  // «mos nom topilmadi» — lekin QAYSI nomlar bor edi? Foydalanuvchi buni
  // bilmasa «Nom mosligi» qutisiga nima yozishni ham bilmaydi (jonli
  // maktabda «Informatika va axborot texnologiyalari» shu sababdan 5 sinfda
  // tushmay qoldi — eMaktab uni boshqacha atagan, lekin jurnal buni
  // aytmagan). Shuning uchun o'xshash nomzodlar xatoning o'zida sanaladi.
  function oxshashNomlar(target, list, max) {
    const lab = (x) => (x == null ? "" : (typeof x === "string" ? x : String(x.label || x.name || x.text || "")));
    const nk = normKey(target);
    const sozlari = sozlar(target).filter((w) => w.length >= 4);
    const ildiz = nk.slice(0, 5);
    const out = [];
    const bor = new Set();
    for (const x of list) {
      const l = lab(x);
      const o = normKey(l);
      if (!o || bor.has(l)) continue;
      // Ball: boshi bir xil (3) > uzun so'zi bor (2) > nishon ichida (1)
      const ball = (ildiz.length >= 5 && o.startsWith(ildiz)) ? 3
        : (sozlari.some((w) => o.indexOf(w) >= 0) ? 2
        : ((o.length >= 5 && nk.indexOf(o) >= 0) ? 1 : 0));
      if (!ball) continue;
      bor.add(l);
      out.push({ l, ball });
    }
    out.sort((a, b) => b.ball - a.ball);
    return out.slice(0, max || 6).map((x) => x.l);
  }

  function topilmadiSabab(name, list) {
    const ox = oxshashNomlar(name, list, 6);
    if (!ox.length) return "mos nom topilmadi";
    return `mos nom topilmadi. eMaktab'da o'xshashlari: ${ox.map((n) => `«${n}»`).join(", ")}. `
      + `To'g'risini «Nom mosligi» qutisiga yozing, masalan: ${name} = ${ox[0]}`;
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
      const guruhIdlar = idlar && idlar.guruhlar && API.sinfNom ? idlar.guruhlar[API.sinfNom] : null;
      const g = guruhTop(dars.guruh, info.guruhlar, guruhIdlar);
      if (g.qiymat) guruhId = g.qiymat.v;
      else {
        // Guruh topilmasa dars BUTUN SINFGA tushadi — ikkinchi guruh esa
        // «butun sinf uchun allaqachon dars mavjud» bilan rad etiladi.
        // Shuning uchun eMaktab'da QAYSI guruhlar borligi aytiladi:
        // foydalanuvchi Smartjadval'dagi nomni shunga moslaydi.
        const bor = info.guruhlar
          .filter((x) => !BUTUN_SINF.test(String(x.label || "").trim()))
          .map((x) => String(x.label || "").replace(GURUH_PREFIKS, "").trim())
          .filter(Boolean);
        ogoh = `guruh «${dars.guruh}» eMaktab'da yo'q — butun sinfga qo'yildi`
          + (bor.length ? ` (eMaktab'da: ${bor.join(", ")})` : " (bu sinfda o'quv guruhlari sozlanmagan — eMaktab → Sinf → «O'quv guruhlari»)");
      }
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
      + `&group=${enc(group)}${period ? "&period=" + enc(period) : ""}${qoshimcha || ""}`;
  }

  // Hujjatdagi CHORAK YORLIQLARI → Map(periodId → nom) va havolasiz
  // (faol) yorliqning nomi. Id yorliq havolasidan, bo'lmasa element yoki
  // ota-onasining istalgan atributidan (onclick, data-*) olinadi. Shunda
  // ham topilmasa xom HTML'da `period=…` dan keyingi `</a>` gacha matn
  // ko'riladi — tuzilishi kutilmagan bo'lsa ham ishlasin.
  function choraklarDomdan(doc, html) {
    const out = new Map();
    let nomsiz = "";
    doc.querySelectorAll("a, span, li, b, div, td, button").forEach((el) => {
      if (el.children.length > 1 || !CHORAK_RE.test(txt(el))) return;
      const a = el.closest("a") || el.querySelector("a");
      const h = a ? String(a.getAttribute("href") || "") : "";
      if (/[?&]schedule=/.test(h)) return;
      const atr = [el, a, el.parentElement].filter(Boolean)
        .map((x) => [...x.attributes].map((at) => at.value).join(" ")).join(" ");
      const m = (h + " " + atr).match(/period=(\d+)/);
      if (m) { if (!out.has(m[1])) out.set(m[1], txt(el)); }
      else if (!nomsiz) nomsiz = txt(el);
    });
    if (out.size < 2 && html) {
      const re = /period=(\d+)[^>]*>([\s\S]{0,300}?)<\/a>/g;
      let m;
      while ((m = re.exec(html))) {
        const t = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (CHORAK_RE.test(t) && !out.has(m[1])) out.set(m[1], t);
      }
    }
    return { out, nomsiz };
  }

  // Choraklar ro'yxati: [{ id, nom }] va faol yorliq nomi.
  //
  //  Manbalar ketma-ket, yetarlisi topilguncha: 1) joriy sahifa (view yoki
  //  generator sahifasida yorliqlar turadi), 2) sinfning generator
  //  sahifasi, 3) sinfning `view` sahifasi. Faol yorliq havolasiz bo'lsa
  //  uning id'si URL'dan, bo'lmasa BOSHQA yorliq sahifasidan olinadi —
  //  u yerda avvalgi faol yorliq havolaga aylanadi.
  //  `tashxis` — topilmaganda jurnalga chiqariladi (markup o'zgargan bo'lsa
  //  sababini shu yerdan bilib olamiz).
  async function choraklarOqi(group) {
    const out = new Map();
    let nomsiz = "";
    const tashxis = [];
    const qosh = (res) => {
      res.out.forEach((v, k) => { if (!out.has(k)) out.set(k, v); });
      if (!nomsiz) nomsiz = res.nomsiz;
    };
    const urlP = new URLSearchParams(location.search).get("period") || "";
    const joriy = choraklarDomdan(document, "");
    qosh(joriy);
    if (joriy.nomsiz && urlP && !out.has(urlP)) out.set(urlP, joriy.nomsiz);
    tashxis.push(`sahifa: ${joriy.out.size} havola${joriy.nomsiz ? ", faol «" + joriy.nomsiz + "»" : ""}`);

    const oqi = async (nom, url) => {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) { tashxis.push(`${nom}: HTTP ${r.status}`); return; }
        const html = await r.text();
        if (!API.xss) API.xss = xssIzla(html);
        const res = choraklarDomdan(new DOMParser().parseFromString(html, "text/html"), html);
        qosh(res);
        const mu = String(r.url || "").match(/[?&]period=(\d+)/);
        if (res.nomsiz && mu && !out.has(mu[1]) && ![...out.values()].includes(res.nomsiz)) out.set(mu[1], res.nomsiz);
        tashxis.push(`${nom}: ${res.out.size} havola, period= ${(html.match(/period=\d+/g) || []).length} ta, `
          + `«chorak» ${(html.match(/chorak|четверть/gi) || []).length} ta${res.nomsiz ? ", faol «" + res.nomsiz + "»" : ""}`);
      } catch (err) { tashxis.push(`${nom}: ${err.message}`); }
    };
    if (out.size < 2) await oqi("generator", sxemaUrl(group, ""));
    if (out.size < 2) await oqi("view", `/v2/schedules/view?school=${enc(API.schoolId)}&group=${enc(group)}`);
    // Faol yorliqning id'si yo'q — boshqa yorliq sahifasida u havolaga aylanadi
    const yetmaydi = () => nomsiz && ![...out.values()].includes(nomsiz) && out.size;
    if (yetmaydi()) {
      const boshqa = [...out.keys()][0];
      await oqi("view (boshqa yorliq)", `/v2/schedules/view?school=${enc(API.schoolId)}&group=${enc(group)}&period=${enc(boshqa)}`);
      if (yetmaydi()) await oqi("generator (boshqa yorliq)", sxemaUrl(group, boshqa));
    }
    const royxat = [...out.entries()].map(([id, nom]) => ({ id, nom }))
      .sort((x, y) => (parseInt(x.nom, 10) || 0) - (parseInt(y.nom, 10) || 0));
    return { royxat, faol: nomsiz || joriyChorakNomi(), tashxis: tashxis.join("; ") };
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

  // Mavjud sxemaning BAND KATAKLARI — qaysi katakka yozish xavfsizligi
  //  shundan aniqlanadi. Ilgari mavjud sxema SO'ZSIZ o'tkazib yuborilardi:
  //  maktab avvaldan bo'sh sxema yaratib qo'ygan bo'lsa (jonli maktabda
  //  aynan shunday edi) «Hamma sinfga» ularning birortasini to'ldirmasdi.
  //
  //  ⚠️ NOANIQLIK — «TEGILMAYDI» degani. Sahifa ochilmasa yoki setka
  //  topilmasa `null` qaytadi va sxemaga umuman yozilmaydi: ustiga
  //  yozilsa darslar IKKILANADI.
  //  ⚠️ QAYTA YURISHDA OLDIN JOYLANGANLAR O'Z JOYIDA QOLADI. Ilgari
  //  ichida bitta dars bo'lsa ham butun sxema o'tkazib yuborilardi —
  //  birinchi yurishda 34/35 tushgan sinfning qolgan bitta darsini
  //  keyin qo'yib bo'lmasdi. Endi «band kataklar» TO'PLAMI qaytadi va
  //  faqat bo'sh kataklarga yoziladi.
  //
  //  Qaytadi: Set("kun_soat") — band kataklar; `null` — aniqlab
  //  bo'lmadi (sahifa ochilmadi / setka topilmadi) → sxemaga TEGILMAYDI.
  async function sxemaBandKataklar(group, period, schedId) {
    let doc;
    try {
      const r = await fetch(sxemaUrl(group, period, `&view=edit&schedule=${enc(schedId)}`),
        { credentials: "same-origin" });
      if (!r.ok) return null;
      doc = new DOMParser().parseFromString(await r.text(), "text/html");
    } catch { return null; }
    const kataklar = [...doc.querySelectorAll('[id^="d"]')]
      .filter((el) => /^d[0-6]_\d+$/.test(el.id));
    if (!kataklar.length) return null;
    const band = new Set();
    // ⚠️ GURUHLI KATAK — «Kichik guruh bollar» + «Kichik guruh qizlar».
    //  Ilgari katakda bitta narsa tursa butun katak «band» edi: birinchi
    //  guruh tushib ikkinchisi xato bo'lsa, qayta yurishda ikkinchi guruh
    //  umuman qo'yilmasdi (katak band). Endi katakdagi guruh nomlari ham
    //  o'qiladi: `band.guruhlar` = Map("kun_soat" → Set(subgroupKey)).
    //  Katakda guruhsiz (butun sinf) dars tursa Map'da yozuv bo'lmaydi.
    band.guruhlar = new Map();
    kataklar.forEach((el) => {
      // Bo'sh katakda faqat «+» qo'shish tugmasi turadi
      if (!txt(el).replace(/[+\s]/g, "")) return;
      const m = el.id.match(/^d([0-6])_(\d+)$/);
      // Sahifada kun 0 = Yakshanba; bizda 7. `kun % 7` bilan mos keladi.
      const key = `${Number(m[1]) === 0 ? 7 : Number(m[1])}_${m[2]}`;
      band.add(key);
      // Barg elementlar («Kichik guruh bollar» alohida qatorda turadi)
      const guruhlar = new Set();
      el.querySelectorAll("*").forEach((x) => {
        if (x.children.length) return;
        const t = txt(x);
        if (!t || !GURUH_PREFIKS.test(t)) return;
        const k = subgroupKey(t);
        if (k) guruhlar.add(k);
      });
      if (guruhlar.size) band.guruhlar.set(key, guruhlar);
    });
    return band;
  }

  // Dars sxemada ALLAQACHON turibdimi?
  //  - katak bo'sh → yo'q
  //  - katakda butun sinf darsi → ha (ustiga yozilmaydi)
  //  - katakda guruh darslari: shu guruh bor → ha; yo'q → yo'q (qo'shiladi);
  //    guruhsiz dars esa guruhli katakka sig'maydi → ha (o'tkaziladi)
  function darsJoyida(band, d) {
    if (!band) return false;
    const key = `${d.kun}_${d.soat}`;
    if (!band.has(key)) return false;
    const g = band.guruhlar ? band.guruhlar.get(key) : null;
    if (!g || !g.size) return true;
    if (!d.guruh) return true;
    return g.has(subgroupKey(d.guruh));
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
      // ⚠️ `getAttribute("value")` EMAS, `el.value`.
      //  `<select>` da `value` ATRIBUTI umuman yo'q — atribut bo'yicha
      //  o'qilsa har bir ro'yxat BO'SH ketardi va server formani
      //  «to'ldirilmagan» deb rad etardi: sxema yaratilmas, biz esa
      //  «yangi sxema id'si aniqlanmadi» deb yozardik (18.09.2026).
      //  `el.value` tanlangan variantni, `<textarea>` da esa ichidagi
      //  matnni to'g'ri qaytaradi.
      fd.append(n, el.value || "");
    });
    if (!nomYozildi) throw new Error("formada nom maydoni topilmadi");

    // «Yaratish» tugmasining o'zi ham yuboriladi: server ko'pincha
    // qaysi tugma bosilganini shundan biladi (bekor qilish/saqlash).
    const yubor = form.querySelector(
      'input[type="submit"][name], button[type="submit"][name], button[name]:not([type])'
    );
    if (yubor) {
      fd.append(yubor.getAttribute("name"),
        yubor.getAttribute("value") || txt(yubor) || "");
    }

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

    // ⚠️ SERVERNING XATOSINI JURNALGA CHIQARAMIZ.
    //  Yo'naltirish ham, yangi sxema ham yo'q — demak server formani
    //  RAD ETDI va sababini javob sahifasiga yozgan (ASP.NET buni
    //  `validation-summary-errors` / `field-validation-error` bilan
    //  belgilaydi). Busiz «id aniqlanmadi» degan quruq xabar qolar va
    //  sabab noma'lum bo'lardi.
    let sabab = "";
    try {
      const jd = new DOMParser().parseFromString(await r2.text(), "text/html");
      sabab = [...jd.querySelectorAll(
        ".validation-summary-errors, .field-validation-error, .error, .alert"
      )].map(txt).filter(Boolean).join("; ");
    } catch { /* javob o'qilmasa sababsiz qolamiz */ }
    throw new Error("yangi sxema id'si aniqlanmadi"
      + (sabab ? ` — server: ${cut(sabab, 160)}` : ` (HTTP ${r2.status})`));
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
    if (!m.qiymat) return { ok: false, sabab: topilmadiSabab(name, opts) };
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
  //  7-QISM. DASHBOARD (Shadow DOM — sahifa uslublari aralashmasin)
  //
  //  Ilgari ko'prik o'ng pastda kichkina yon panel edi: 400px kenglikda
  //  43 sinfning holatini ko'rib bo'lmasdi, «qaysi sinf tushdi, qaysi
  //  qoldi» faqat jurnal matnidan bilinardi. Endi bu markazda ochiladigan
  //  katta oyna: chapda sozlamalar (jadval fayli, chorak, parametrlar),
  //  o'ngda sinflar jadvali — har sinf uchun fayldagi dars soni, eMaktab
  //  mosligi, sxema holati va alohida «▶» tugmasi.
  //
  //  Oyna yuqori menyudagi «SJ DARS JADVALI» bandidan ochiladi (2B-QISM).
  //  Menyu topilmasa zaxira sifatida o'ng pastda dumaloq «SJ» tugma chiqadi.
  // ===================================================================
  const host = document.createElement("div");
  host.id = "sj-bridge-host";
  const sh = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  sh.innerHTML = `
    <style>
      :host,*{box-sizing:border-box;}
      .wrap{font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#e5e7eb;}
      .fab{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:none;width:54px;height:54px;
        border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6);
        color:#fff;font-weight:800;font-size:15px;box-shadow:0 8px 24px rgba(79,70,229,.45);}
      .fab.kor{display:block;}
      .ov{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;
        padding:16px;background:rgba(2,6,23,.66);backdrop-filter:blur(6px);}
      .ov.ochiq{display:flex;}
      .panel{width:min(1260px,100%);height:min(92vh,920px);display:flex;flex-direction:column;
        background:#0b1220;border:1px solid #1e293b;border-radius:20px;overflow:hidden;
        box-shadow:0 40px 120px rgba(0,0,0,.65);}
      .hd{display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid #1e293b;
        background:linear-gradient(90deg,#121c33,#0b1220);}
      .logo{width:42px;height:42px;border-radius:13px;flex:none;display:grid;place-items:center;
        background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;font-weight:900;font-size:15px;
        box-shadow:0 6px 18px rgba(99,102,241,.45);}
      .hd h3{margin:0;font-size:17px;color:#fff;line-height:1.2;}
      .hd .sub{color:#94a3b8;font-size:12px;}
      .sp{flex:1;}
      .chip{font-size:11px;padding:4px 10px;border-radius:999px;background:#1e293b;color:#cbd5e1;
        border:1px solid #334155;white-space:nowrap;}
      .chip.ok{background:#052e2b;color:#6ee7b7;border-color:#065f46;}
      .chip.xato{background:#3b0d0d;color:#fca5a5;border-color:#7f1d1d;}
      .chip.ogoh{background:#3b2305;color:#fcd34d;border-color:#78350f;}
      .x{background:#1e293b;border:1px solid #334155;color:#cbd5e1;cursor:pointer;font-size:15px;
        width:34px;height:34px;border-radius:10px;}
      .x:hover{background:#334155;color:#fff;}
      .body{flex:1;display:grid;grid-template-columns:360px 1fr;min-height:0;}
      .side{overflow:auto;padding:14px;border-right:1px solid #1e293b;background:#0d1526;}
      .main{display:flex;flex-direction:column;min-height:0;padding:14px 16px;gap:10px;}
      .qadam{border:1px solid #1e293b;border-radius:12px;padding:11px;margin-bottom:10px;background:#111a2e;}
      .qadam>b{color:#c7d2fe;font-size:12px;display:block;margin-bottom:7px;letter-spacing:.02em;}
      .qadam>b i{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:6px;
        background:#312e81;color:#c7d2fe;font-style:normal;font-size:11px;margin-right:6px;}
      details.qadam summary{cursor:pointer;color:#94a3b8;font-size:12px;font-weight:600;list-style:none;}
      details.qadam summary::before{content:"▸ ";color:#64748b;}
      details.qadam[open] summary::before{content:"▾ ";}
      details.qadam[open] summary{margin-bottom:8px;}
      button.b{border:none;border-radius:9px;padding:8px 12px;font-weight:700;font-size:12px;
        cursor:pointer;margin:2px 4px 2px 0;font-family:inherit;transition:filter .15s,transform .05s;}
      button.b:hover{filter:brightness(1.12);} button.b:active{transform:translateY(1px);}
      button.b:disabled{opacity:.45;cursor:not-allowed;filter:none;}
      .b-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
      .b-hero{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;padding:11px 18px;font-size:13px;
        box-shadow:0 6px 18px rgba(99,102,241,.35);}
      .b-alt{background:#1e293b;color:#cbd5e1;border:1px solid #334155;}
      .b-warn{background:#7c2d12;color:#fed7aa;}
      .b-mini{padding:4px 9px;font-size:11px;margin:0;}
      textarea{width:100%;height:70px;background:#020617;border:1px solid #1e293b;border-radius:9px;
        color:#cbd5e1;padding:7px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
      input[type=text],input[type=number],select.s{background:#020617;border:1px solid #1e293b;border-radius:7px;
        color:#e2e8f0;padding:5px 7px;font-size:12px;font-family:inherit;}
      input[type=number]{width:62px;}
      select.s{max-width:100%;}
      .qator{display:flex;gap:7px;align-items:center;margin:5px 0;flex-wrap:wrap;}
      label{font-size:11.5px;color:#94a3b8;display:flex;gap:5px;align-items:center;}
      .holat{font-size:11.5px;color:#93c5fd;margin:5px 0;}
      .dim{color:#64748b;} .ok{color:#4ade80;} .xato{color:#f87171;} .ogoh{color:#fbbf24;}
      .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
      .stat{background:#111a2e;border:1px solid #1e293b;border-radius:12px;padding:9px 12px;}
      .stat .n{font-size:22px;font-weight:800;color:#fff;line-height:1.1;}
      .stat .l{font-size:11px;color:#94a3b8;margin-top:2px;}
      .tb{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
      .tbw{flex:1;min-height:140px;overflow:auto;border:1px solid #1e293b;border-radius:12px;background:#0f172a;}
      table{width:100%;border-collapse:collapse;font-size:12.5px;}
      th{position:sticky;top:0;z-index:1;background:#111a2e;color:#94a3b8;font-weight:600;text-align:left;
        padding:8px 10px;border-bottom:1px solid #1e293b;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;}
      td{padding:6px 10px;border-bottom:1px solid #16213a;vertical-align:middle;white-space:nowrap;}
      tr:hover td{background:#111a2e;}
      td.c{text-align:center;} th.c{text-align:center;}
      .nom{font-weight:700;color:#fff;}
      .tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;}
      .t-ok{background:#052e2b;color:#6ee7b7;} .t-yoq{background:#1e293b;color:#94a3b8;}
      .t-ogoh{background:#3b2305;color:#fcd34d;} .t-xato{background:#3b0d0d;color:#fca5a5;}
      .t-ish{background:#1e3a8a;color:#bfdbfe;}
      .pb{height:6px;background:#1e293b;border-radius:3px;overflow:hidden;}
      .pb i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6366f1,#22d3ee);transition:width .2s;}
      .log{height:150px;flex:none;background:#020617;border:1px solid #1e293b;border-radius:10px;padding:8px;
        overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;}
      .bosh{padding:28px;text-align:center;color:#64748b;font-size:12.5px;}
      code{background:#1e293b;padding:1px 5px;border-radius:4px;font-size:11px;}
      @media (max-width:900px){.body{grid-template-columns:1fr;}.side{border-right:none;border-bottom:1px solid #1e293b;max-height:40vh;}.stats{grid-template-columns:repeat(2,1fr);}}
    </style>
    <div class="wrap">
      <button class="fab" id="fab" title="Smartjadval ko'prigi">SJ</button>
      <div class="ov" id="ov">
      <div class="panel" id="panel">
        <div class="hd">
          <div class="logo">SJ</div>
          <div>
            <h3>Dars jadvali — Smartjadval → eMaktab</h3>
            <div class="sub">Sxema setkasini to'ldiradi. «Nashr etish» ni siz bosasiz.</div>
          </div>
          <div class="sp"></div>
          <span class="chip" id="maktabChip">maktab…</span>
          <span class="chip" id="apiChip">API: tekshirilmadi</span>
          <button class="x" id="yopish" title="Yopish (Esc)">✕</button>
        </div>

        <div class="body">
        <div class="side">
          <div class="qadam">
            <b><i>1</i>Jadval fayli</b>
            <textarea id="json" placeholder="Smartjadval → eMaktab bo'limidan nusxa olingan JSON shu yerga qo'yiladi…"></textarea>
            <div class="qator">
              <button class="b b-alt" id="fayl">📂 Fayldan</button>
              <button class="b b-alt" id="oqish">✔ Tekshirish</button>
              <button class="b b-alt" id="unut" title="Brauzerda saqlangan jadvalni o'chirish">🗑</button>
            </div>
            <div class="holat" id="holat"></div>
            <input type="file" id="fileinp" accept=".json,application/json" style="display:none">
            <select class="s" id="sinf" style="display:none"><option value="">— avval JSON tekshirilsin —</option></select>
          </div>

          <div class="qadam">
            <b><i>2</i>Chorak va sxema</b>
            <div class="qator">
              <label>chorak <select class="s" id="chorakSel"><option value="">— yuklanmoqda… —</option></select></label>
            </div>
            <div class="qator">
              <label>sxema nomi <input type="text" id="chorakNom" value="1 chorak" style="width:130px"></label>
            </div>
            <div class="dim" style="font-size:10.5px;">
              Sxemasi yo'q sinfga «<span id="nomKo"></span>» nomli sxema yaratiladi,
              bo'sh kataklari to'ldiriladi, darsi bor katakka tegilmaydi.
            </div>
          </div>

          <div class="qadam">
            <b><i>3</i>Sozlamalar</b>
            <div class="qator">
              <label><input type="checkbox" id="xona"> xona ham</label>
              <label><input type="checkbox" id="otkaz" checked> band katakni o'tkazib yuborish</label>
            </div>
            <div class="qator">
              <label><input type="checkbox" id="mavjudHam"> DARSI BOR sxemaga ham yozish (darslar ikkilanadi!)</label>
            </div>
            <div class="qator">
              <label>tanaffus <input type="number" id="tanaffus" value="350" min="0" step="50"> ms</label>
              <label>kutish <input type="number" id="kutish" value="8000" min="1000" step="500"> ms</label>
            </div>
          </div>

          <details class="qadam">
            <summary>📥 eMaktab'dan ma'lumot olish</summary>
            <div class="dim" style="font-size:11px;margin-bottom:6px;">
              Sinflar, fanlar, ustozlar (qaysi fanga ruxsat berilgani bilan) va
              xonalar fayl bo'lib yuklanadi. Uni Smartjadval «eMaktab» bo'limiga
              yuklasangiz — nomlar taxmin qilinmay, id bo'yicha aniq ishlaydi.
            </div>
            <div class="qator">
              <label><input type="checkbox" id="xonaYig" checked> xonalar ham</label>
              <button class="b b-alt" id="yigish">📥 Yig'ish va saqlash</button>
            </div>
            <div class="holat" id="yigHolat"></div>
          </details>

          <details class="qadam">
            <summary>🔤 Nom mosligi (kerak bo'lsa)</summary>
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
          </details>

          <details class="qadam">
            <summary>🛠 Zaxira va nosozlik</summary>
            <div class="dim" style="font-size:11px;margin-bottom:6px;">
              Shu sahifada sxema setkasi ochiq bo'lsa, darslarni API'siz —
              oynani ochib-yopib (DOM orqali) ham joylash mumkin.
            </div>
            <div class="holat" id="setkaHolat">Setka hali tekshirilmadi.</div>
            <div class="qator">
              <button class="b b-alt" id="sinov">🧪 Sinov (1 dars)</button>
              <button class="b b-alt" id="yur">▶ Shu sahifa setkasiga</button>
            </div>
            <div class="dim" style="font-size:11px;margin:8px 0 6px;">
              <b style="color:#93c5fd">O'rganish rejimi</b> — eMaktab so'rov shaklini
              o'zgartirsa: «Yozishni boshlash» → setkada BITTA darsni QO'LDA
              qo'shing → «To'xtatish» → natijani dasturchiga bering.
            </div>
            <div class="qator">
              <button class="b b-alt" id="recOn">⏺ Yozishni boshlash</button>
              <button class="b b-alt" id="recOff">⏹ To'xtatish va nusxalash</button>
              <button class="b b-alt" id="recSave">💾 Faylga saqlash</button>
            </div>
          </details>
        </div>

        <div class="main">
          <div class="stats">
            <div class="stat"><div class="n" id="stSinf">–</div><div class="l">sinf (fayl / eMaktab)</div></div>
            <div class="stat"><div class="n" id="stDars">–</div><div class="l">dars fayl ichida</div></div>
            <div class="stat"><div class="n" id="stSxema">–</div><div class="l">sxemasi bor</div></div>
            <div class="stat"><div class="n" id="stTayyor">–</div><div class="l">joylangan sinf</div></div>
          </div>

          <div class="tb">
            <button class="b b-hero" id="hamma">🚀 Tanlangan sinflarga joylashtirish</button>
            <button class="b b-alt" id="sinovApi" title="Birinchi tanlangan sinfda nomlarni tekshiradi, hech narsa yozmaydi">🧪 Sinov</button>
            <button class="b b-alt" id="tekshir" title="Har sinfning sxemasi bor-yo'qligini va band kataklarini o'qiydi">🔄 Holatni tekshirish</button>
            <button class="b b-alt" id="sxemaHamma" title="Faqat sxema yaratadi, dars yozmaydi">🗂 Hammasiga sxema yaratish</button>
            <button class="b b-warn" id="toxta" style="display:none">■ To'xtatish</button>
            <div class="sp"></div>
            <span class="holat" id="hammaHolat"></span>
          </div>
          <div class="pb"><i id="pbar"></i></div>

          <div class="tbw">
            <table>
              <thead><tr>
                <th class="c" style="width:34px"><input type="checkbox" id="hammasiBelgi" checked title="Hammasini belgilash"></th>
                <th>Sinf</th><th>eMaktab</th><th class="c">Dars</th><th>Sxema</th><th>Holat</th><th class="c" style="width:60px"></th>
              </tr></thead>
              <tbody id="sinflarJadval"><tr><td colspan="7" class="bosh">Jadval fayli yuklanmagan. Chapda «📂 Fayldan» bilan yuklang yoki JSON ni qo'ying.</td></tr></tbody>
            </table>
          </div>

          <div class="log" id="log"></div>
        </div>
        </div>
      </div>
      </div>
    </div>`;

  const $ = (id) => sh.getElementById(id);
  const ov = $("ov");
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

  function ochish() { ov.classList.add("ochiq"); ochiqYoz(true); }
  function yopish() { ov.classList.remove("ochiq"); ochiqYoz(false); }
  $("fab").onclick = () => (ov.classList.contains("ochiq") ? yopish() : ochish());
  $("yopish").onclick = yopish;
  // Qoraygan fonga bosilsa yopiladi; ish ketayotganda yopilmaydi (tasodifan).
  ov.addEventListener("click", (e) => { if (e.target === ov && $("toxta").style.display === "none") yopish(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ov.classList.contains("ochiq") && $("toxta").style.display === "none") yopish();
  });

  $("fayl").onclick = () => $("fileinp").click();
  $("fileinp").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $("json").value = String(r.result || ""); parse(); };
    r.readAsText(f);
  };

  // ===================================================================
  //  SINFLAR JADVALI — dashboardning asosiy qismi
  //
  //  Har qator = fayldagi bitta sinf. Unga eMaktab'dagi guruh (nom
  //  bo'yicha), tanlangan chorakdagi sxema va joylash holati biriktiriladi.
  //  Faylsiz ham ishlaydi: u holda eMaktab sinflari ko'rsatiladi (sxema
  //  yaratish uchun jadval fayli kerak emas).
  // ===================================================================
  let guruhlar = null;      // Map(classKey → { id, nom }) — eMaktab sinflari
  let qatorlar = [];        // [{ key, nom, sinf, g, sxema, tag, holat, tanlangan }]
  let choraklar = [];       // [{ id, nom }] — eMaktab choraklari

  const joriyPeriod = () => $("chorakSel").value
    || new URLSearchParams(location.search).get("period") || "";

  async function guruhlarYukla(qayta) {
    if (guruhlar && !qayta) return guruhlar;
    await API.initUmumiy();
    guruhlar = await sinfGuruhlari();
    $("maktabChip").textContent = `${API.maktabNomi || "maktab"} · ${guruhlar.size} sinf`;
    return guruhlar;
  }

  function qatorlarQur() {
    const eski = new Map(qatorlar.map((q) => [q.key, q]));
    qatorlar = [];
    if (paket) {
      paket.sinflar.forEach((s) => {
        const key = classKey(s.nom);
        const q = eski.get(key) || { key, tanlangan: true, sxema: null, sxemalar: null, sxemaId: undefined, tag: "", holat: "" };
        q.nom = s.nom; q.sinf = s;
        q.g = guruhlar ? (guruhlar.get(key) || null) : null;
        if (!s.darslar.length) q.tanlangan = false;
        qatorlar.push(q);
      });
    } else if (guruhlar) {
      guruhlar.forEach((g, key) => {
        const q = eski.get(key) || { key, tanlangan: false, sxema: null, sxemalar: null, sxemaId: undefined, tag: "", holat: "" };
        q.nom = g.nom; q.sinf = null; q.g = g;
        qatorlar.push(q);
      });
    }
    qatorlar.sort((a, b) => {
      const da = parseInt(a.nom, 10) || 0, db = parseInt(b.nom, 10) || 0;
      return da - db || String(a.nom).localeCompare(String(b.nom));
    });
    chiz();
  }

  const tagHtml = (q) => {
    if (q.tag) return q.tag;
    if (!q.sinf) return '<span class="tag t-yoq">faylda yo\'q</span>';
    if (!q.sinf.darslar.length) return '<span class="tag t-yoq">dars yo\'q</span>';
    if (guruhlar && !q.g) return '<span class="tag t-xato">eMaktab\'da yo\'q</span>';
    return '<span class="tag t-yoq">kutmoqda</span>';
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function chiz() {
    const tb = $("sinflarJadval");
    if (!qatorlar.length) {
      tb.innerHTML = '<tr><td colspan="7" class="bosh">Jadval fayli yuklanmagan. Chapda «📂 Fayldan» bilan yuklang yoki JSON ni qo\'ying.</td></tr>';
    } else {
      tb.innerHTML = qatorlar.map((q, i) => {
        const dars = q.sinf ? q.sinf.darslar.length : 0;
        const em = guruhlar ? (q.g ? `<span class="ok">✔ ${esc(q.g.nom)}</span>` : '<span class="xato">✖ topilmadi</span>') : '<span class="dim">…</span>';
        // Sxema: shu chorakdagi sxemalar ro'yxati (tanlanadi) + joylash holati
        const chorakNom = String($("chorakNom").value || "").trim() || "1 chorak";
        let sx;
        // Faylda yo'q / darsi yo'q sinf uchun sxema o'qilmaydi — «yuklanmoqda» yolg'on bo'lardi
        if (!q.sxemalar) sx = (q.g && q.sinf && dars) ? '<span class="dim">yuklanmoqda…</span>' : '<span class="dim">—</span>';
        else {
          const tanlov = q.sxemaId == null ? sxemaTanlovOdatiy(q, chorakNom) : q.sxemaId;
          sx = `<select class="s" data-sx="${i}" style="max-width:170px;padding:2px 4px;font-size:11.5px;">`
            + q.sxemalar.map((x) => `<option value="${esc(x.id)}" ${x.id === tanlov ? "selected" : ""}>${esc(x.nom)}</option>`).join("")
            + `<option value="" ${tanlov === "" ? "selected" : ""}>＋ «${esc(chorakNom)}» (yo'q bo'lsa yaratiladi)</option></select>`;
          if (q.sxema && q.sxema.band != null) {
            sx += q.sxema.band.size ? ` <span class="ogoh">${q.sxema.band.size} band</span>` : ' <span class="dim">bo\'sh</span>';
          }
        }
        const mumkin = q.sinf && dars && q.g;
        return `<tr data-i="${i}">
          <td class="c"><input type="checkbox" data-belgi="${i}" ${q.tanlangan ? "checked" : ""} ${mumkin ? "" : "disabled"}></td>
          <td class="nom">${esc(q.nom)}</td>
          <td>${em}</td>
          <td class="c">${dars || '<span class="dim">0</span>'}</td>
          <td>${sx}</td>
          <td>${tagHtml(q)}${q.holat ? ` <span class="dim">${esc(q.holat)}</span>` : ""}</td>
          <td class="c">${mumkin ? `<button class="b b-main b-mini" data-yur="${i}" title="Faqat shu sinfga joylashtirish">▶</button>` : ""}</td>
        </tr>`;
      }).join("");
    }
    // Statistika
    const faylSinf = paket ? paket.sinflar.length : 0;
    $("stSinf").textContent = `${faylSinf} / ${guruhlar ? guruhlar.size : "–"}`;
    $("stDars").textContent = paket ? paket.sinflar.reduce((n, s) => n + s.darslar.length, 0) : "–";
    const sxBor = qatorlar.filter((q) => q.sxema).length;
    $("stSxema").textContent = qatorlar.some((q) => q.sxema !== null) ? sxBor : "–";
    $("stTayyor").textContent = qatorlar.filter((q) => q.tayyor).length || "–";
  }

  // Odatiy tanlov: nomi sxema nomiga mos sxema; bo'lmasa «yangi»
  const sxemaTanlovOdatiy = (q, nom) => {
    const f = (q.sxemalar || []).find((x) => normKey(x.nom) === normKey(nom));
    return f ? f.id : "";
  };
  $("sinflarJadval").addEventListener("change", (e) => {
    const i = e.target.getAttribute("data-belgi");
    if (i != null) qatorlar[Number(i)].tanlangan = e.target.checked;
    const j = e.target.getAttribute("data-sx");
    if (j != null) { qatorlar[Number(j)].sxemaId = e.target.value; qatorlar[Number(j)].sxema = null; }
  });

  // ===================================================================
  //  SXEMALARNI YUKLASH — har sinfning tanlangan chorakdagi sxemalari
  //
  //  Foydalanuvchi joylashtirishdan OLDIN qaysi sinfda qaysi sxema borligini
  //  ko'radi va kerak bo'lsa boshqasini tanlaydi. Fon rejimida, sinfma-sinf;
  //  chorak almashsa yoki amal boshlansa to'xtaydi (`sxSeq`).
  // ===================================================================
  let sxSeq = 0;
  let ishKetyapti = false;
  async function sxemalarYukla() {
    const seq = ++sxSeq;
    const period = joriyPeriod();
    if (!period || !guruhlar) return;
    const ish = qatorlar.filter((q) => q.g && q.sinf && q.sinf.darslar.length && !q.sxemalar);
    for (const q of ish) {
      if (seq !== sxSeq || ishKetyapti) return;
      try {
        const royxat = await sxemalar(q.g.id, period);
        if (seq !== sxSeq) return;
        q.sxemalar = royxat;
      } catch { q.sxemalar = null; }
      chiz();
      await sleep(120);
    }
  }
  $("sinflarJadval").addEventListener("click", (e) => {
    const b = e.target.closest("[data-yur]");
    if (b) bittaSinf(Number(b.getAttribute("data-yur")), false);
  });
  $("hammasiBelgi").onchange = (e) => {
    qatorlar.forEach((q) => { if (q.sinf && q.sinf.darslar.length && q.g) q.tanlangan = e.target.checked; });
    chiz();
  };

  function qatorBelgila(q, tagClass, matn, holat) {
    q.tag = `<span class="tag ${tagClass}">${esc(matn)}</span>`;
    q.holat = holat || "";
    chiz();
  }

  // ——— Choraklar: eMaktab'dan o'qiladi, URL dagi period oldindan tanlanadi ———
  async function choraklarYukla() {
    const sel = $("chorakSel");
    try {
      const g = await guruhlarYukla();
      const birinchi = g.values().next().value;
      if (!birinchi) throw new Error("eMaktab'da sinf topilmadi");
      const r = await choraklarOqi(birinchi.id);
      choraklar = r.royxat;
      // Topilgan ro'yxat eslab qolinadi: keyingi safar yorliqsiz sahifada
      // ham (masalan ro'yxat sahifasida) chorak tanlash mumkin bo'lsin.
      if (choraklar.length >= 2) {
        try { localStorage.setItem(LS_CHORAK, JSON.stringify({ maktab: API.schoolId, royxat: choraklar })); } catch { /* */ }
      } else {
        let kesh = null;
        try { kesh = JSON.parse(localStorage.getItem(LS_CHORAK) || "null"); } catch { kesh = null; }
        if (kesh && kesh.maktab === API.schoolId && Array.isArray(kesh.royxat) && kesh.royxat.length) {
          kesh.royxat.forEach((c) => { if (!choraklar.some((x) => x.id === c.id)) choraklar.push(c); });
          choraklar.sort((x, y) => (parseInt(x.nom, 10) || 0) - (parseInt(y.nom, 10) || 0));
          log("📅 Choraklar oldingi sahifada eslab qolingan ro'yxatdan olindi", "dim");
        }
      }
      if (!choraklar.length) throw new Error("chorak yorliqlari topilmadi [" + r.tashxis + "]");
      sel.innerHTML = choraklar.map((c) => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join("");
      const urlP = new URLSearchParams(location.search).get("period") || "";
      const faol = choraklar.find((c) => c.id === urlP) || choraklar.find((c) => c.nom === r.faol) || choraklar[0];
      sel.value = faol.id;
      chorakNomSinxron();
      log(`📅 Choraklar: ${choraklar.map((c) => c.nom).join(" · ")} — «${faol.nom}» tanlandi`, "dim");
      sxemalarYukla();
    } catch (err) {
      const urlP = new URLSearchParams(location.search).get("period") || "";
      sel.innerHTML = urlP ? `<option value="${esc(urlP)}">joriy sahifa choragi</option>`
                           : '<option value="">— topilmadi —</option>';
      log(`⚠ Choraklar ro'yxati olinmadi (${err.message})`
        + (urlP ? " — URL dagi chorak ishlatiladi" : " — biror sinfning «Dars jadvali» sahifasini (1 chorak … 4 chorak yorliqlari bor) ochib, oynani qayta oching"), "ogoh");
      if (urlP) sxemalarYukla();
    }
  }

  // Sxema nomi chorak nomiga ergashadi — foydalanuvchi qo'lda o'zgartirmaguncha
  let nomQolda = false;
  function chorakNomSinxron() {
    if (nomQolda) return;
    const sel = $("chorakSel");
    const o = sel.options[sel.selectedIndex];
    const nom = o && o.value ? o.textContent.trim() : joriyChorakNomi();
    if (nom) $("chorakNom").value = nom;
    nomKoYangila();
  }
  const nomKoYangila = () => {
    $("nomKo").textContent = String($("chorakNom").value || "").trim() || "1 chorak";
  };
  $("chorakNom").oninput = () => { nomQolda = true; nomKoYangila(); };
  $("chorakSel").onchange = () => {
    chorakNomSinxron();
    // Boshqa chorak — sxemalar ham, holat ham boshqa
    qatorlar.forEach((q) => { q.sxemalar = null; q.sxemaId = undefined; q.sxema = null; q.tag = ""; q.holat = ""; q.tayyor = false; });
    chiz();
    sxemalarYukla();
  };
  // Sxema nomi o'zgarsa odatiy tanlovlar qayta hisoblanadi
  $("chorakNom").addEventListener("input", () => { qatorlar.forEach((q) => { q.sxemaId = undefined; }); chiz(); });
  (() => { const t = joriyChorakNomi(); if (t) $("chorakNom").value = t; })();
  nomKoYangila();

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

      // Sahifadagi sinfni ro'yxatdan O'ZI tanlaymiz (zaxira DOM yo'li uchun) —
      // noto'g'ri sinf tanlash eng xavfli xato.
      const sahifaSinf = pageClassName();
      if (sahifaSinf) {
        const i = p.sinflar.findIndex((s) => classKey(s.nom) === classKey(sahifaSinf));
        if (i >= 0) sel.value = String(i);
      }

      // ⚠️ JADVAL BRAUZERDA ESLAB QOLINADI — har sahifada qayta tanlanmasin.
      try { localStorage.setItem(LS_JADVAL, raw); } catch { /* kvota to'lsa e'tiborsiz */ }

      qatorlarQur();
      guruhlarYukla().then(() => { qatorlarQur(); sxemalarYukla(); })
        .catch((err) => log(`⚠ eMaktab sinflari olinmadi: ${err.message}`, "ogoh"));
      checkGrid();
      return true;
    } catch (err) {
      $("holat").textContent = "✖ " + err.message;
      paket = null;
      qatorlarQur();
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
    qatorlarQur();
    log("🗑 Saqlangan jadval o'chirildi.", "dim");
  };

  function checkGrid() {
    const g = findGrid();
    if (!g) {
      $("setkaHolat").innerHTML = "<span class='dim'>Bu sahifada setka yo'q — zaxira yo'l ishlamaydi (asosiy yo'lga ta'sir qilmaydi).</span>";
      $("yur").disabled = true; $("sinov").disabled = true;
      return null;
    }
    $("setkaHolat").innerHTML = `<span class='ok'>Setka topildi: ${g.cols.size} kun, ${g.soatlar.size} soat.</span>`;
    $("yur").disabled = false; $("sinov").disabled = false;
    return g;
  }

  const sozlamalar = (sinov) => ({
    tanaffus: Number($("tanaffus").value) || 350,
    kutish: Number($("kutish").value) || 8000,
    xona: $("xona").checked,
    otkaz: $("otkaz").checked,
    mavjudHam: $("mavjudHam").checked,
    sinov: !!sinov,
  });

  function ishBoshlandi() {
    toxtat = false;
    ishKetyapti = true;
    sxSeq++;
    $("toxta").style.display = "";
    ["hamma", "sinovApi", "tekshir", "sxemaHamma", "yur", "sinov"].forEach((id) => { $(id).disabled = true; });
  }
  function ishTugadi() {
    ishKetyapti = false;
    $("toxta").style.display = "none";
    ["hamma", "sinovApi", "tekshir", "sxemaHamma"].forEach((id) => { $(id).disabled = false; });
    $("hammaHolat").textContent = "";
    checkGrid();
  }
  $("toxta").onclick = () => { toxtat = true; };

  // ===================================================================
  //  ZAXIRA: shu sahifa setkasiga DOM orqali (API ishlamay qolsa)
  // ===================================================================
  async function run(sinov) {
    if (!paket && !parse()) { log("✖ Avval JSON ni tekshiring", "xato"); return; }
    const idx = Number($("sinf").value || 0);
    const sinf = paket.sinflar[idx];
    if (!sinf) { log("✖ Sinf tanlanmadi", "xato"); return; }

    // ⚠️ Darslar URL dagi `schedule` ga yoziladi — sahifa qaysi sinfniki
    // bo'lsa, o'shanga. Jadvalda boshqa sinf tanlangan bo'lsa TO'XTAYMIZ.
    const sahifaSinf = pageClassName();
    if (!sahifaSinf) { log("✖ Bu sahifa qaysi sinfniki — aniqlanmadi. Chorak sxemasi sahifasini oching.", "xato"); return; }
    if (classKey(sahifaSinf) !== classKey(sinf.nom)) {
      log(`✖ Sahifa «${sahifaSinf}» sinfiniki, faylda shu sinf topilmadi (tanlangan: «${sinf.nom}»).`, "xato");
      return;
    }

    const opt = sozlamalar(sinov);
    const ish = sinov ? sinf.darslar.slice(0, 1) : sinf.darslar;
    if (!ish.length) { log("✖ Bu sinfda dars yo'q", "xato"); return; }

    const g = checkGrid();
    if (!g) { log("✖ Setka topilmadi — chorak sxemasi sahifasini oching", "xato"); return; }

    ishBoshlandi();
    log(`▶ ${sinf.nom} (zaxira DOM yo'li): ${ish.length} ta dars${sinov ? " (SINOV — yuborilmaydi)" : ""}`, "ok");

    let ok = 0, xato = 0, otkazildi = 0;
    for (let i = 0; i < ish.length; i++) {
      if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
      const d = ish[i];
      const yorliq = `${d.kun}-kun ${d.soat}-soat ${d.fan}${d.guruh ? " (" + d.guruh + ")" : ""}`;
      const cell = cellAt(g, d.kun, d.soat);
      if (opt.otkaz && !sinov && cell && txt(cell)) {
        otkazildi++;
        log(`↷ ${yorliq} — katakda dars bor, o'tkazib yuborildi`, "dim");
        continue;
      }
      let r;
      try { r = await placeLesson(g, d, paket, xarita, opt); }
      catch (err) { r = { ok: false, sabab: "kutilmagan xato: " + err.message }; }
      if (r.ok) {
        ok++;
        log(`✔ ${yorliq} — ${r.izoh || ""}`, r.ogoh ? "ogoh" : "ok");
        if (r.ogoh) log("   ⚠ " + r.ogoh, "ogoh");
        if (cell && !sinov) cell.style.background = "#dcfce7";
      } else {
        xato++;
        log(`✖ ${yorliq} — ${r.sabab}`, "xato");
      }
      $("pbar").style.width = Math.round(((i + 1) / ish.length) * 100) + "%";
      await sleep(opt.tanaffus);
    }
    ishTugadi();
    log(`— Yakun: ${ok} joylandi, ${xato} xato${otkazildi ? `, ${otkazildi} o'tkazib yuborildi` : ""} —`, xato ? "ogoh" : "ok");
    if (!sinov && ok) log("Keyin «Nashr etish» ni O'ZINGIZ bosing.", "dim");
  }
  $("yur").onclick = () => run(false);
  $("sinov").onclick = () => run(true);

  // ===================================================================
  //  BITTA SINFNI JOYLASHTIRISH — API orqali, sahifadan mustaqil
  //
  //  Har sinfning eMaktabdagi sxemasi ALOHIDA (`schedule` id sinfga xos):
  //  sxema topiladi (yo'q bo'lsa yaratiladi), `API` o'sha sxemaga qayta
  //  sozlanadi va darslar joylanadi. Qaysi sahifada turganimiz ahamiyatsiz —
  //  hamma narsa so'rovlar bilan bajariladi.
  //
  //  ⚠️ MAVJUD SXEMANING BAND KATAKLARIGA TEGILMAYDI. Band kataklar
  //  aniqlanmasa (sahifa ochilmadi) sxemaga umuman yozilmaydi — ustiga
  //  yozilsa darslar IKKILANADI. «DARSI BOR sxemaga ham yozish» belgisi
  //  shu to'siqni ONGLI ravishda ochadi.
  //
  //  Qaytadi: { ok, xato, oldindan, otkazildi(bool), xatoSabab }
  async function sinfniJoylashtir(q, period, chorakNomi, opt) {
    const sinf = q.sinf, g = q.g;
    const nat = { ok: 0, xato: 0, oldindan: 0, otkazildi: false };
    if (!g) {
      const dj = String(sinf.nom).match(/\d{1,2}/);
      const yaqin = dj && guruhlar
        ? [...guruhlar.values()].filter((x) => (String(x.nom).match(/\d{1,2}/) || [])[0] === dj[0]).map((x) => x.nom).join(", ")
        : "";
      log(`✖ ${sinf.nom} — eMaktabda bunday sinf yo'q${yaqin ? ` (shu darajada: ${yaqin})` : ""}`, "xato");
      qatorBelgila(q, "t-xato", "eMaktab'da yo'q", yaqin ? `o'xshash: ${yaqin}` : "");
      nat.xato = sinf.darslar.length;
      return nat;
    }

    qatorBelgila(q, "t-ish", "sxema…");
    let schedId;
    let band = new Set();
    try {
      const royxat = await sxemalar(g.id, period);
      q.sxemalar = royxat;
      // Jadvalda tanlangan sxema; tanlanmagan yoki «yangi» bo'lsa — nom bo'yicha
      const bor = (q.sxemaId && royxat.find((x) => x.id === q.sxemaId))
        || royxat.find((x) => normKey(x.nom) === normKey(chorakNomi)) || null;
      if (bor) {
        q.sxemaId = bor.id;
        band = await sxemaBandKataklar(g.id, period, bor.id);
        if (band == null) {
          if (!opt.mavjudHam) {
            log(`↷ ${sinf.nom} — «${chorakNomi}» sxemasining holati aniqlanmadi, tegilmadi`, "dim");
            q.sxema = { id: bor.id, nom: bor.nom, band: null };
            qatorBelgila(q, "t-ogoh", "tegilmadi", "sxema holati noma'lum");
            nat.otkazildi = true;
            return nat;
          }
          band = new Set();
        }
        if (opt.mavjudHam) band = new Set();
        q.sxema = { id: bor.id, nom: bor.nom, band };
      } else if (opt.sinov) {
        log(`↷ ${sinf.nom} — «${chorakNomi}» sxemasi yo'q; sinovda yaratilmaydi`, "dim");
        q.sxema = false;
        qatorBelgila(q, "t-ogoh", "sxema yo'q", "sinovda yaratilmaydi");
        nat.otkazildi = true;
        return nat;
      }
      schedId = bor ? bor.id : await sxemaYarat(g.id, period, chorakNomi);
      if (!bor) {
        q.sxema = { id: schedId, nom: chorakNomi, band: new Set() };
        q.sxemalar = royxat.concat([{ id: schedId, nom: chorakNomi }]);
        q.sxemaId = schedId;
      }
      log(bor
        ? `＝ ${sinf.nom} — mavjud «${bor.nom}» sxemasi` + (band.size ? ` (${band.size} katak band — ularga tegilmaydi)` : " bo'sh")
        : `＋ ${sinf.nom} — «${chorakNomi}» sxemasi yaratildi`, "dim");
    } catch (err) {
      log(`✖ ${sinf.nom} — sxema: ${err.message}`, "xato");
      qatorBelgila(q, "t-xato", "sxema xatosi", err.message.slice(0, 60));
      nat.xato = sinf.darslar.length;
      return nat;
    }

    const qoldi = sinf.darslar.filter((d) => !darsJoyida(band, d));
    nat.oldindan = sinf.darslar.length - qoldi.length;
    if (!qoldi.length) {
      log(`↷ ${sinf.nom} — hamma dars allaqachon joyida (${sinf.darslar.length} ta)`, "dim");
      q.tayyor = true;
      qatorBelgila(q, "t-ok", "joyida", `${sinf.darslar.length} dars oldindan`);
      return nat;
    }

    // API ni SHU sinfga sozlaymiz. Kesh tozalanishi SHART: `guruhlar`
    // (subgroup) ro'yxati sinfga xos. `band` oldindan to'ldiriladi —
    // ro'yxat so'raladigan «bo'sh katak» band katakka tushmasin.
    API.scheduleId = schedId;
    API.groupId = g.id;
    API.sinfNom = sinf.nom;
    API.band = new Set(band);
    API.bosh = null;
    API.fanKesh = new Map();
    for (let soat = 1; soat <= 12 && !API.bosh; soat++) {
      for (let kun = 1; kun <= 6; kun++) {
        if (!band.has(`${kun}_${soat}`)) { API.bosh = { kun, soat }; break; }
      }
    }
    try {
      const f0 = await API.formaBoshda(0);
      if (f0.token) API.token = f0.token;
      if (!API.fanlar.length) API.fanlar = f0.fanlar;
      if (!API.fanlar.length) throw new Error("fanlar ro'yxati bo'sh");
      if (!API.bosh) API.bosh = { kun: 1, soat: 1 };
      API.tayyor = true;
      $("apiChip").textContent = `API: ulandi · ${API.fanlar.length} fan`;
      $("apiChip").className = "chip ok";

      // Guruhli darslar bormi? Nomlar eMaktab guruhlariga mos kelishini
      // BIR MARTA, darslardan oldin aytamiz — har darsda takrorlamaymiz.
      const guruhNomlar = [...new Set(qoldi.map((d) => d.guruh).filter(Boolean))];
      if (guruhNomlar.length) {
        const idlar = paket && paket.emaktab && paket.emaktab.guruhlar ? paket.emaktab.guruhlar[sinf.nom] : null;
        const bor = (f0.guruhlar || []).filter((x) => !BUTUN_SINF.test(String(x.label || "").trim()));
        const qism = guruhNomlar.map((n) => {
          const m = guruhTop(n, f0.guruhlar || [], idlar);
          return m.qiymat ? `${n} → ${String(m.qiymat.label).replace(GURUH_PREFIKS, "").trim()} ✔` : `${n} ✖`;
        });
        const xatoBor = qism.some((t) => t.endsWith("✖"));
        log(`   👥 ${sinf.nom} guruhlari: ${qism.join(", ")}`
          + (xatoBor ? (bor.length
            ? ` — eMaktab'da: ${bor.map((x) => String(x.label).replace(GURUH_PREFIKS, "").trim()).join(", ")}`
            : " — eMaktab'da bu sinfga o'quv guruhlari sozlanmagan") : ""),
          xatoBor ? "ogoh" : "dim");
      }
    } catch (err) {
      log(`✖ ${sinf.nom} — forma: ${err.message}`, "xato");
      qatorBelgila(q, "t-xato", "forma xatosi", err.message.slice(0, 60));
      nat.xato = qoldi.length;
      return nat;
    }

    qatorBelgila(q, "t-ish", opt.sinov ? "sinov…" : "joylanmoqda…");
    let ok = 0, xato = 0;
    for (let i = 0; i < qoldi.length; i++) {
      if (toxtat) break;
      const d = qoldi[i];
      let r;
      try { r = await placeLessonApi(d, paket, xarita, opt); }
      catch (err) { r = { ok: false, sabab: "kutilmagan xato: " + err.message }; }
      if (r.ok) {
        ok++;
        if (opt.sinov) log(`   ✔ ${d.kun}-kun ${d.soat}-soat ${d.fan} → ${r.izoh}`, "ok");
        if (r.ogoh) log(`   ⚠ ${sinf.nom} ${d.kun}/${d.soat}: ${r.ogoh}`, "ogoh");
      } else {
        xato++;
        log(`   ✖ ${sinf.nom} ${d.kun}-kun ${d.soat}-soat ${d.fan} — ${r.sabab}`, "xato");
      }
      if (!opt.sinov && (i + 1) % 5 === 0) q.holat = `${i + 1}/${qoldi.length}`;
      await sleep(opt.sinov ? 0 : opt.tanaffus);
    }
    nat.ok = ok; nat.xato = xato;
    if (opt.sinov) {
      qatorBelgila(q, ok && !xato ? "t-ok" : (ok ? "t-ogoh" : "t-xato"), "sinov", `${ok} mos, ${xato} xato (yozilmadi)`);
    } else {
      q.tayyor = ok > 0 && xato === 0;
      qatorBelgila(q, xato ? (ok ? "t-ogoh" : "t-xato") : "t-ok",
        xato ? (ok ? "qisman" : "xato") : "joylandi",
        `${ok} joylandi${xato ? `, ${xato} xato` : ""}${nat.oldindan ? `, ${nat.oldindan} oldindan` : ""}`);
    }
    log(`${xato ? "⚠" : "✔"} ${sinf.nom}: ${ok} joylandi, ${xato} xato`
      + `${nat.oldindan ? `, ${nat.oldindan} oldindan joyida` : ""}${opt.sinov ? " (SINOV — yozilmadi)" : ""}`,
      xato ? "ogoh" : "ok");
    return nat;
  }

  // Umumiy tayyorgarlik: fayl, chorak, API, eMaktab sinflari
  async function tayyorla() {
    if (!paket && !parse()) { log("✖ Avval jadval faylini yuklang", "xato"); return null; }
    const period = joriyPeriod();
    if (!period) { log("✖ Chorak tanlanmagan — ro'yxat yuklanmagan bo'lsa chorak sxemasi sahifasini oching", "xato"); return null; }
    const chorakNomi = String($("chorakNom").value || "").trim();
    if (!chorakNomi) { log("✖ Sxema nomi bo'sh", "xato"); return null; }
    await guruhlarYukla();
    qatorlarQur();
    return { period, chorakNomi };
  }

  async function bittaSinf(i, sinov) {
    const q = qatorlar[i];
    if (!q || !q.sinf) return;
    ishBoshlandi();
    try {
      const t = await tayyorla();
      if (t) {
        $("hammaHolat").textContent = q.nom;
        await sinfniJoylashtir(q, t.period, t.chorakNomi, sozlamalar(sinov));
        if (!sinov) log("🔄 Sinfni ochib ko'zdan kechiring va «Nashr etish» ni O'ZINGIZ bosing.", "dim");
      }
    } catch (err) { log("✖ " + err.message, "xato"); }
    ishTugadi();
  }

  // ===================================================================
  //  TANLANGAN SINFLARGA — ketma-ket
  //
  //  ⚠️ TIZIMLI XATODA TO'XTAYMIZ. Bir sinfda hech narsa joylashmasa,
  //  qolgan 42 sinfda ham joylashmaydi — 43 marta xato yozib chiqishning
  //  ma'nosi yo'q, sababini darrov ko'rsatgan afzal.
  // ===================================================================
  async function hammaSinf(sinov) {
    ishBoshlandi();
    try {
      const t = await tayyorla();
      if (!t) { ishTugadi(); return; }
      const opt = sozlamalar(sinov);
      let ishlar = qatorlar.filter((q) => q.tanlangan && q.sinf && q.sinf.darslar.length);
      if (sinov) ishlar = ishlar.slice(0, 1);
      if (!ishlar.length) { log("✖ Birorta sinf tanlanmagan (yoki tanlanganlarda dars yo'q)", "xato"); ishTugadi(); return; }

      log(`🚀 ${ishlar.length} ta sinf, chorak «${t.chorakNomi}»${sinov ? " — SINOV, hech narsa yozilmaydi" : ""}`, "ok");
      const bosh = paket.sinflar.filter((s) => !s.darslar.length).map((s) => s.nom);
      if (bosh.length) log(`   darsi yo'q: ${bosh.slice(0, 12).join(", ")}${bosh.length > 12 ? ` … (jami ${bosh.length})` : ""}`, "dim");
      if (guruhlar && ishlar.length < guruhlar.size / 2 && !sinov) {
        log(`⚠ eMaktabda ${guruhlar.size} sinf bor, tanlanganlari esa ${ishlar.length} ta. `
          + "Fayl to'liqmi? Smartjadval → «eMaktab» da «Hammasi» ni bosib qayta nusxalang.", "ogoh");
      }

      let jamiOk = 0, jamiXato = 0, otkazildi = 0, jamiOldindan = 0;
      for (let i = 0; i < ishlar.length; i++) {
        if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
        const q = ishlar[i];
        $("hammaHolat").textContent = `${i + 1}/${ishlar.length}: ${q.nom}`;
        $("pbar").style.width = Math.round(((i + 1) / ishlar.length) * 100) + "%";
        const n = await sinfniJoylashtir(q, t.period, t.chorakNomi, opt);
        jamiOk += n.ok; jamiXato += n.xato; jamiOldindan += n.oldindan;
        if (n.otkazildi) otkazildi++;
        if (!sinov && n.ok === 0 && n.xato > 0 && !n.otkazildi && n.oldindan === 0) {
          log("✖ Bu sinfda birorta dars joylashmadi — to'xtatildi. Sababini yuqoridagi xatolardan ko'ring.", "xato");
          break;
        }
      }
      log(`— YAKUN: ${jamiOk} dars ${sinov ? "mos keldi" : "joylandi"}, ${jamiXato} xato`
        + `${jamiOldindan ? `, ${jamiOldindan} dars oldindan joyida edi` : ""}`
        + `${otkazildi ? `, ${otkazildi} sinf o'tkazib yuborildi` : ""} —`, jamiXato ? "ogoh" : "ok");
      if (!sinov) log("🔄 Har sinfni ochib ko'zdan kechiring va «Nashr etish» ni O'ZINGIZ bosing.", "dim");
    } catch (err) {
      log("✖ " + err.message, "xato");
    }
    ishTugadi();
  }
  $("hamma").onclick = () => hammaSinf(false);
  $("sinovApi").onclick = () => hammaSinf(true);

  // ===================================================================
  //  HOLATNI TEKSHIRISH — har sinfning sxemasi va band kataklari
  //  (hech narsa yozmaydi; «qaysi sinf qoldi?» savoliga javob)
  // ===================================================================
  async function holatTekshir() {
    ishBoshlandi();
    try {
      await guruhlarYukla(true);
      qatorlarQur();
      const period = joriyPeriod();
      const nom = String($("chorakNom").value || "").trim();
      if (!period) throw new Error("chorak tanlanmagan");
      const ish = qatorlar.filter((q) => q.g);
      log(`🔄 ${ish.length} ta sinfning «${nom}» sxemasi tekshirilmoqda…`, "dim");
      let bor = 0;
      for (let i = 0; i < ish.length; i++) {
        if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
        const q = ish[i];
        $("hammaHolat").textContent = `${i + 1}/${ish.length}: ${q.nom}`;
        $("pbar").style.width = Math.round(((i + 1) / ish.length) * 100) + "%";
        try {
          const royxat = await sxemalar(q.g.id, period);
          q.sxemalar = royxat;
          const s = (q.sxemaId && royxat.find((x) => x.id === q.sxemaId))
            || royxat.find((x) => normKey(x.nom) === normKey(nom));
          if (!s) { q.sxema = false; q.tag = ""; q.holat = ""; }
          else {
            bor++;
            const band = await sxemaBandKataklar(q.g.id, period, s.id);
            q.sxema = { id: s.id, nom: s.nom, band };
            const dars = q.sinf ? q.sinf.darslar.length : 0;
            if (band && dars && q.sinf.darslar.every((d) => darsJoyida(band, d))) {
              q.tayyor = true; q.tag = '<span class="tag t-ok">joyida</span>'; q.holat = "";
            } else { q.tag = ""; q.holat = ""; }
          }
        } catch (err) { q.sxema = null; q.holat = err.message.slice(0, 50); }
        chiz();
        await sleep(150);
      }
      log(`✔ Tekshirildi: ${bor} sinfda «${nom}» sxemasi bor, ${ish.length - bor} tasida yo'q`, "ok");
    } catch (err) { log("✖ " + err.message, "xato"); }
    ishTugadi();
  }
  $("tekshir").onclick = holatTekshir;

  // ===================================================================
  //  HAMMASIGA SXEMA YARATISH — faqat yaratadi, dars yozmaydi
  //
  //  eMaktabda «Darslar jadvalining yangi sxemasi» tugmasi bitta sinfga
  //  bitta sxema yaratadi: 43 sinf uchun 43 marta nom yozib chiqish
  //  kerak bo'ladi. Bu tugma o'sha ishni bir bosishda bajaradi.
  //  ⚠️ JADVAL FAYLI KERAK EMAS. ⚠️ SHU NOMLI SXEMASI BORI TEGILMAYDI.
  // ===================================================================
  async function hammagaSxema() {
    ishBoshlandi();
    try {
      const g = await guruhlarYukla();
      qatorlarQur();
      const period = joriyPeriod();
      const nom = String($("chorakNom").value || "").trim();
      if (!period) throw new Error("chorak tanlanmagan");
      if (!nom) throw new Error("sxema nomi bo'sh");
      log(`🗂 «${nom}» sxemasi ${g.size} ta sinfga yaratilmoqda…`, "ok");

      const royxat = [...g.values()];
      let yaratildi = 0, bor = 0, xato = 0;
      for (let i = 0; i < royxat.length; i++) {
        if (toxtat) { log("■ To'xtatildi", "ogoh"); break; }
        const gr = royxat[i];
        $("hammaHolat").textContent = `${i + 1}/${royxat.length}: ${gr.nom}`;
        $("pbar").style.width = Math.round(((i + 1) / royxat.length) * 100) + "%";
        // ⚠️ IKKI URINISH — har safar ro'yxat QAYTA o'qiladi, nusxa bo'lmasin.
        let holat = "", id = "";
        for (let urinish = 1; urinish <= 2; urinish++) {
          try {
            const mavjud = await sxemalar(gr.id, period);
            const m = mavjud.find((x) => normKey(x.nom) === normKey(nom));
            if (m) { holat = urinish === 1 ? "bor" : "yaratildi"; id = m.id; break; }
            id = await sxemaYarat(gr.id, period, nom);
            holat = "yaratildi";
            break;
          } catch (err) {
            holat = "xato:" + err.message;
            if (urinish < 2) await sleep(1200);
          }
        }
        const q = qatorlar.find((x) => x.key === classKey(gr.nom));
        if (holat === "bor") { bor++; log(`↷ ${gr.nom} — «${nom}» allaqachon bor`, "dim"); }
        else if (holat === "yaratildi") { yaratildi++; log(`＋ ${gr.nom} — «${nom}» yaratildi`, "ok"); }
        if (q && id && holat !== "" && !holat.startsWith("xato")) {
          if (!q.sxemalar) q.sxemalar = [];
          if (!q.sxemalar.some((x) => x.id === id)) q.sxemalar.push({ id, nom });
          q.sxemaId = id;
        }
        else { xato++; log(`✖ ${gr.nom} — ${holat.slice(5)}`, "xato"); }
        chiz();
        await sleep(400);   // eMaktabni bo'g'ib qo'ymaylik
      }
      log(`— YAKUN: ${yaratildi} ta sxema yaratildi${bor ? `, ${bor} tasida allaqachon bor edi` : ""}${xato ? `, ${xato} xato` : ""} —`, xato ? "ogoh" : "ok");
    } catch (err) {
      log("✖ " + err.message, "xato");
    }
    ishTugadi();
  }
  $("sxemaHamma").onclick = hammagaSxema;

  // ——— Qo'lda moslashtirilgan nomlar ———
  // Tur (fan/ustoz/xona) so'ralmaydi: juftlik uchalasiga ham yoziladi.
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
      const guruhli = data.sinflar.filter((s) => s.guruhlar && s.guruhlar.length).length;
      log(`✔ ${data.sinflar.length} sinf (${guruhli} tasida o'quv guruhlari bor), ${data.fanlar.length} fan, `
        + `${data.ustozlar.length} ustoz, ${data.xonalar.length} xona — «${nom}» saqlandi`, "ok");
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
  // Fayl «Yuklamalar» ga tushadi — dasturchiga berish nusxalashdan oson.
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
    ochish();
    return ok;
  }

  // Oldingi sahifada yuklangan jadvalni tiklash
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
    ochish,
    yangiJadval,
    setka: findGrid,
    hisobot: gridReport,
    oyna: findOpenForm,
    api: API,
    paket: () => paket,
    qatorlar: () => qatorlar,
  };

  // Avval «Hammasi birga» dan kelgan jadval, bo'lmasa oxirgi saqlangani
  const yuklandi = yangiJadval() || saqlanganJadval();

  // Oldingi sahifada oyna ochiq turgan bo'lsa (yoki menyudan kelingan) — ochiq
  if (ochiqEdi) ochish();

  // Yozuv oldingi sahifada yoqilgan bo'lsa — DAVOM ettiramiz.
  if (REC.yoniq) {
    recStart(true);
    ochish();
    log(`⏺ Yozuv DAVOM etyapti — ${REC.tarmoq.length} ta so'rov yozildi. `
      + "Amalni tugatgach «⏹ To'xtatish va nusxalash» ni bosing.", "ogoh");
  }

  // Yuqori menyudagi «SJ DARS JADVALI» bandi — bosilsa oyna ochiladi.
  // Menyu topilmasa (sahifada sarlavha yo'q) zaxira «SJ» tugmasi chiqadi.
  waitFor(() => menyuBandiQosh(ochish), 6000, 250).then((ok) => { if (!ok) $("fab").classList.add("kor"); });

  checkGrid();

  // eMaktab ma'lumotlari fon rejimida: maktab, sinflar, choraklar
  (async () => {
    try {
      await guruhlarYukla();
      qatorlarQur();
      await choraklarYukla();
    } catch (err) {
      $("maktabChip").textContent = "maktab: aniqlanmadi";
      $("maktabChip").className = "chip xato";
      log(`⚠ eMaktab bilan bog'lanmadi: ${err.message}. Siz schools.emaktab.uz da ekaningizga ishonch hosil qiling.`, "ogoh");
    }
  })();

  log(yuklandi
    ? "Ko'prik tayyor — jadval eslab qolingan. Chorakni tekshirib «🚀 Tanlangan sinflarga joylashtirish» ni bosing."
    : "Ko'prik tayyor. Jadvalni «📂 Fayldan» bilan yuklang.", "dim");
})();
