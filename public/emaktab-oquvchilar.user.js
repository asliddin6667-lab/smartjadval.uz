// ==UserScript==
// @name         Turon → eMaktab o'quvchilar sinxroni
// @namespace    https://smartjadval.uz/
// @version      0.9.7
// @description  Turon bazasidagi o'quvchilar ro'yxatini eMaktab (kundalik.com) «Odamlarni izlash» bo'limi bilan solishtiradi: yo'g'ini qo'shadi, ortiqchasini chiqaradi, sinfi o'zgarganini ko'chiradi
// @author       smartjadval.uz
// @match        https://schools.emaktab.uz/v2/admin/*
// @match        https://*.kundalik.com/v2/admin/*
// @match        https://*.xususiy-maktab.uz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @noframes
// @run-at       document-idle
// @updateURL    https://smartjadval.uz/emaktab-oquvchilar.user.js
// @downloadURL  https://smartjadval.uz/emaktab-oquvchilar.user.js
// ==/UserScript==

// ⚠️ SKRIPTGA TEGSANGIZ `@version` NI OSHIRING — Tampermonkey yangilanishni
//    faqat raqam bo'yicha biladi.

// =====================================================================
//  TURON → eMAKTAB O'QUVCHILAR SINXRONI
//
//  Bu skript DARS JADVALI KO'PRIGIDAN (emaktab-bridge.user.js) ALOHIDA.
//  IKKI SAYTDA ishlaydi, har birida o'z paneli bor:
//    • Turon (…xususiy-maktab.uz → O'quvchilar) — ro'yxatni YIG'ADI:
//      jadvalni sahifama-sahifa o'qib Tampermonkey xotirasiga yozadi.
//    • eMaktab «Boshqaruv → Odamlarni izlash» — SOLISHTIRADI va bajaradi:
//      https://schools.emaktab.uz/v2/admin/persons/default?school=…&group=students
//
//  ⚠️ IKKI DOMEN ORASIDA localStorage UMUMIY EMAS. Ro'yxat Tampermonkey
//  ning `GM_setValue` xotirasi orqali o'tadi (bitta skript — bitta xotira,
//  domen farq qilmaydi). Console'ga qo'lda qo'yilganda GM yo'q — u holda
//  Turon paneli JSON fayl yuklab beradi, eMaktab paneli «📂 Fayldan» oladi.
//
//  NIMA QILADI:
//    1) Turon ro'yxatini oladi (Turon sahifasidan avtomatik; yoki
//       Excel'dan nusxa, CSV, JSON).
//    2) eMaktabdagi o'quvchilar ro'yxatini sahifama-sahifa o'qiydi.
//    3) Ikkalasini solishtiradi:
//         ＋ qo'shish   — Turonda bor, eMaktabda yo'q
//         ➜ ko'chirish — ikkalasida bor, lekin sinfi boshqa
//         － chiqarish  — eMaktabda bor, Turonda yo'q
//         ＝ mos        — hammasi joyida
//    4) Tanlangan amallarni eMaktab formalari orqali bajaradi.
//
//  SINF NOMI QOIDASI (4 filial):
//    Turon «4-A» + filial:
//      Furqat   → eMaktab «4 A»     (bitta harf)
//      Oltiariq → eMaktab «4 A O»
//      Qo'qon   → eMaktab «4 A Q»
//      Yaypan   → eMaktab «4 A Y»
//    Filial harflari panelda o'zgartiriladi.
//    «8-Ijtimoiy», «Aniq 1», «Ijtimoiy1» — YO'NALISH nomi, sinf emas:
//    faqat raqam olinadi (8, 10) va bola shu filialdagi shu raqamli
//    sinflardan biriga tushadi (turgan bo'lsa tegilmaydi, yangisi eng kam
//    o'quvchili sinfga). Kerak bo'lsa «Sinf mosligi» bilan qo'lda ham beriladi.
//
//  ⚠️ CHIQARISH — QAYTARIB BO'LMAYDIGAN AMAL. Shuning uchun:
//    - hamma amal avval SINOV rejimida ko'rsatiladi (hech narsa yuborilmaydi);
//    - chiqarish ALOHIDA belgi bilan yoqiladi;
//    - ismi o'xshash juftlik (qo'shish + chiqarish) «shubhali» deb
//      ajratiladi va avtomatik bajarilmaydi — ism yozilishi farq qilsa
//      bola o'chirilib, nusxasi yaratilib qolmasin.
//
//  ⚠️ FORMALAR ANIQ O'RGANILMAGAN. eMaktabning «Shaxsni yaratish»,
//    «Sinfni o'zgartirish», «Maktabdan chiqarish» formalari maydon nomi
//    bo'yicha TAXMIN bilan to'ldiriladi (7-QISM). Birinchi marta SINOV
//    rejimida jurnaldagi «maydon → qiymat» ro'yxatini tekshiring. Mos
//    kelmasa «🔍 O'rganish» bilan bitta amalni qo'lda bajarib yozuvni
//    dasturchiga bering.
// =====================================================================

(function () {
  "use strict";

  // ⚠️ `@grant` bor — Tampermonkey skriptni QUMLOQDA (sandbox) yuritadi:
  //  `window` sahifaniki emas, nusxasi. Sahifaning fetch/XHR'ini ushlash
  //  va sahifa bilan umumiy bayroq qo'yish uchun `unsafeWindow` kerak.
  //  Console'da (grantsiz) ikkalasi bitta narsa.
  const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;
  if (W.__SJ_OQUVCHI__) { W.__SJ_OQUVCHI__.ochish(); return; }

  // ⚠️ QATTIQ TO'XTATISH. «■» bosilganda faqat keyingi bola emas, HOZIR
  //  ketayotgan so'rov ham uziladi: `sahifa()` va `formaYubor()` har
  //  so'rovdan oldin shu bayroqni tekshiradi va «■ To'xtatildi» xatosi bilan
  //  chiqadi. Aks holda usta 3-4 so'rovli bo'lgani uchun tugma bosilgach
  //  ham jurnal «o'zi ishlab ketayotgandek» to'lib turardi. Bayroq bu yerda
  //  (panel kodidan oldin) turadi — Turon rejimida panel kodi ishlamaydi.
  // Skript versiyasi jurnalda ko'rinsin (26.09.2026: brauzerda eski 0.9.1
  //  ishlab turgani faqat xabar matnidan bilindi). GM_info bo'lsa undan.
  const VERSIYA = (typeof GM_info !== "undefined" && GM_info && GM_info.script && GM_info.script.version) || "0.9.7";
  const HOLAT = { toxtat: false };
  const TOXTATILDI = "■ To'xtatildi";
  function toxtashniTekshir() { if (HOLAT.toxtat) throw new Error(TOXTATILDI); }

  // Qaysi saytdamiz? eMaktab — solishtirish; qolgani (Turon) — yig'ish.
  const EMAKTAB_REJIM = /emaktab\.uz$|kundalik\.com$/i.test(location.hostname);

  // Tampermonkey xotirasi (domenlararo). Yo'q bo'lsa — null.
  const GM_KEY = "sj_oq_turon_uzatma_v1";
  const gmOl = () => { try { return typeof GM_getValue === "function" ? (GM_getValue(GM_KEY, null) || null) : null; } catch { return null; } };
  const gmYoz = (v) => { try { if (typeof GM_setValue === "function") { GM_setValue(GM_KEY, v); return true; } } catch { /* */ } return false; };

  const LS_TURON = "sj_oq_turon_v1";     // oxirgi Turon ro'yxati (matn)
  // v2: kalit filial+kod bo'ldi — v1 yig'imi (kod bo'yicha, ustma-ust
  // yozilgan) ataylab o'qilmaydi, aks holda bir bola ikki kalit ostida qolardi.
  const LS_YIGIM = "sj_oq_turon_yigim_v2"; // Turon sahifasida yig'ilgan qatorlar
  const LS_FILIAL = "sj_oq_filial_v1";   // filial → harf
  const LS_SINF = "sj_oq_sinf_v1";       // qo'lda sinf mosligi
  const LS_OCHIQ = "sj_oq_panel_ochiq";
  const LS_REC_ON = "sj_oq_rec_on";
  const LS_REC = "sj_oq_rec_data";
  const LS_NATIJA = "sj_oq_natija_v1"; // solishtirish natijasi + qolgan amallar (F5 dan keyin davom)

  // ===================================================================
  //  1-QISM. NOM KALITLARI (emaktab-bridge.user.js dagi bilan bir xil)
  // ===================================================================
  const CYR = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"j",з:"z",и:"i",й:"y",
    к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
    х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sh",ъ:"",ы:"i",ь:"",э:"e",ю:"yu",я:"ya",
    ў:"o",қ:"q",ғ:"g",ҳ:"h",ҷ:"j",
  };
  const APOS = /['‘’ʻʼ´`]/g;

  function normKey(raw) {
    const s = String(raw == null ? "" : raw).toLowerCase().replace(APOS, "");
    let out = "";
    for (const ch of s) out += Object.prototype.hasOwnProperty.call(CYR, ch) ? CYR[ch] : ch;
    return out.replace(/[^a-z0-9]/g, "");
  }

  // «4 A O» → "4ao", «4-A» → "4a", «8-Ijtimoiy» → "8" (harf ≤3 bo'lmasa to'xtaydi)
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

  // O'quvchi ismi kalitlari.
  //  toliq — hamma so'z; qisqa — familiya + ism (birinchi ikki so'z);
  //  tartibsiz — so'zlar alifbo tartibida (Turon «Ism Familiya», eMaktab
  //  «Familiya Ism» yozgan bo'lsa ham mos kelsin).
  //  «o'g'li / qizi / ugli / kizi» qo'shimchalari tashlanadi — ular bir
  //  tomonda bo'lib, ikkinchisida bo'lmasligi mumkin.
  //  ⚠️ X ↔ H BIR XIL: «Xasanov» va «Hasanov», «Xusniddin» va «Husniddin»
  //  bitta odam (jonli ro'yxatda uchradi). Ism kalitida x→h qilinadi;
  //  sinf kalitiga tegilmaydi.
  function ismKalit(raw) {
    const s = String(raw == null ? "" : raw).replace(APOS, "").replace(/\s+/g, " ").trim();
    const w = s.split(" ").map((x) => normKey(x).replace(/x/g, "h").replace(/ovich$|ovna$|evich$|evna$/, ""))
      .filter((x) => x && !/^(ogli|ugli|qizi|kizi|уғли|қизи)$/.test(x));
    return {
      toliq: w.join(""),
      qisqa: w.slice(0, 2).join(""),
      tartibsiz: [...w].sort().join(""),
    };
  }

  // ===================================================================
  //  2-QISM. KICHIK YORDAMCHILAR
  // ===================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const enc = encodeURIComponent;
  const cut = (s, n = 4000) => { const x = String(s == null ? "" : s); return x.length > n ? x.slice(0, n) + "…[qisqartirildi]" : x; };

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

  // `__sj: 1` — o'z so'rovimiz, «O'rganish» yozuviga tushmasin (8-QISM)
  //
  //  ⚠️ «Failed to fetch» — ODATDA SESSIYA TUGAGAN (21.09.2026 da ko'rildi).
  //  eMaktab sessiyasi tugasa so'rov login sahifasiga yo'naltiriladi, u
  //  BOSHQA domen (login.emaktab.uz) — brauzer buni CORS deb rad etadi va
  //  quruq «Failed to fetch» beradi. Sahifa o'zi hali ochiq turgani
  //  adashtiradi. Shuning uchun xabar aniq yoziladi: F5 / qayta kirish.
  async function sahifa(url) {
    toxtashniTekshir();
    let r;
    HOLAT.oxirgiSorov = Date.now();   // keep-alive uchun: oxirgi haqiqiy so'rov vaqti
    try {
      r = await fetch(url, { credentials: "same-origin", __sj: 1 });
    } catch (err) {
      throw new Error(`so'rov ketmadi (${err.message}) — odatda sessiya tugagan yoki internet uzilgan. `
        + "Sahifani F5 bilan yangilang, kerak bo'lsa qayta kiring va yana bosing.");
    }
    if (/login|auth|signin/i.test(String(r.url || "")) && !/login|auth|signin/i.test(String(url))) {
      throw new Error("sessiya tugagan — login sahifasiga yo'naltirildi. Qayta kiring va yana bosing.");
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
    const html = await r.text();
    return { doc: new DOMParser().parseFromString(html, "text/html"), url: r.url || url, html };
  }

  function lsOl(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } }
  function lsYoz(k, v) { try { localStorage.setItem(k, v); } catch { /* kvota */ } }

  function yuklab(nom, matn, tur) {
    const url = URL.createObjectURL(matn instanceof Blob ? matn : new Blob([matn], { type: tur || "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const schoolId = new URLSearchParams(location.search).get("school") || "";

  // ===================================================================
  //  3-QISM. TURON RO'YXATINI O'QISH
  //
  //  Qabul qilinadi:
  //   - JSON massiv: [{ fio, sinf, filial, tugilgan, jins, telefon, kod }]
  //   - Excel'dan nusxa (TAB bilan ajratilgan) yoki CSV (; yoki ,) —
  //     birinchi qator SARLAVHA bo'lishi shart. Ustunlar nomi bo'yicha
  //     taniladi: «O'quvchi/FIO/F.I.O», «Sinf», «Filial/Maktab»,
  //     «Tug'ilgan», «Jins», «Telefon», «Kod», «Status».
  //  Filial «Turon Odob Ilm | Qo'qon» ko'rinishida bo'lsa «|» dan
  //  keyingi qism olinadi. Status ustuni bo'lsa faqat «Faol» qoladi.
  // ===================================================================
  function ustunTani(sarlavha) {
    const k = normKey(sarlavha);
    if (/^(fio|fish|oquvchi|ism|ismfamiliya|familiyaism|fullname|name)/.test(k)) return "fio";
    if (/^(sinf|class|klass|guruh)$/.test(k) || k === "sinfyonalish") return "sinf";
    // Turon jadvalidagi «E-MAKTAB» / «ERP» ustunlari — tugmalar, filial emas
    if (/^(emaktab|erp|amallar)$/.test(k)) return "";
    if (/(filial|maktab|branch|school)/.test(k)) return "filial";
    if (/(tugilgan|birth|sana)/.test(k)) return "tugilgan";
    if (/^(jins|gender|sex)$/.test(k)) return "jins";
    if (/(telefon|phone|tel)/.test(k)) return "telefon";
    if (/^(kod|code|id|std)/.test(k)) return "kod";
    if (/(status|holat)/.test(k)) return "status";
    if (/(daraja|yonalish)/.test(k)) return "daraja";
    return "";
  }

  function turonParse(matn) {
    const raw = String(matn || "").trim();
    if (!raw) throw new Error("ro'yxat bo'sh");

    let qatorlar = [];
    if (raw[0] === "[" || raw[0] === "{") {
      let js = JSON.parse(raw);
      if (js && !Array.isArray(js)) js = js.data || js.items || js.oquvchilar || js.students || [];
      if (!Array.isArray(js)) throw new Error("JSON massiv emas");
      qatorlar = js.map((o) => ({
        fio: o.fio || o.fish || o.full_name || o.fullName || o.name || o.oquvchi || "",
        sinf: o.sinf || o.class || o.class_name || o.group || "",
        filial: o.filial || o.branch || o.maktab || o.school || "",
        tugilgan: o.tugilgan || o.birthday || o.birth_date || o.tugilgan_sana || "",
        jins: o.jins || o.gender || o.sex || "",
        telefon: o.telefon || o.phone || "",
        kod: o.kod || o.code || o.student_code || o.id || "",
        status: o.status || o.holat || "",
        daraja: o.daraja || o.grade || "",
      }));
    } else {
      const lines = raw.split(/\r?\n/).filter((l) => l.trim());
      const ajrat = lines[0].includes("\t") ? "\t" : (lines[0].split(";").length > lines[0].split(",").length ? ";" : ",");
      const bol = (l) => l.split(ajrat).map((x) => x.replace(/^"|"$/g, "").trim());
      const sar = bol(lines[0]).map(ustunTani);
      if (!sar.includes("fio")) throw new Error("sarlavhada F.I.O ustuni topilmadi (birinchi qator sarlavha bo'lsin)");
      for (const l of lines.slice(1)) {
        const c = bol(l);
        const o = {};
        sar.forEach((n, i) => { if (n && c[i] != null) o[n] = o[n] || c[i]; });
        if (o.fio) qatorlar.push(o);
      }
    }

    const out = [];
    // ⚠️ FAQAT «FAOL» STATUSLI O'QUVCHILAR OLINADI (maktab talabi, 26.09.2026:
    //  «statusi faqat faol o'quvchilarni olsin»). Turonda «Jami 2874 / Faol
    //  2716» — nofaol, bitirgan, ketgan bolalar eMaktabga qo'shilmasin va
    //  eMaktabda bo'lsa CHIQARILSIN. Tashlab ketilganlar `out.nofaol` da
    //  qoladi — hisobotda «Nofaol (Turon)» varag'i va chiqarish sababi uchun.
    out.nofaol = [];
    const nofaolmi = (s) => !!s && (!/faol|active|aktiv/i.test(s) || /nofaol|no faol|faol emas|inactive|passiv|chiq|arxiv|ketgan|bitir/i.test(s));
    for (const q of qatorlar) {
      if (nofaolmi(String(q.status || ""))) {
        out.nofaol.push({ fio: unesc(String(q.fio || "")).replace(/\s+/g, " ").trim(), sinf: String(q.sinf || "").trim(), filial: String(q.filial || "").split("|").pop().trim(),
          kod: String(q.kod || "").trim(), tugilgan: String(q.tugilgan || "").trim(), status: String(q.status || "").trim() });
        continue;
      }
      let filial = String(q.filial || "");
      if (filial.includes("|")) filial = filial.split("|").pop();
      filial = filial.trim();
      const fio = unesc(String(q.fio || "")).replace(/\s+/g, " ").trim();
      if (!fio) continue;
      // Ustun «4-A 4-sinf» yoki «Ijtimoiy1 8-sinf» bo'lib kelsa — daraja ajratiladi
      let sinf = String(q.sinf || "").replace(/\s+/g, " ").trim();
      let daraja = String(q.daraja || "").trim();
      const md = sinf.match(/^(.*?)\s*(\d{1,2})\s*-?\s*sinf\s*$/i);
      if (md && md[1]) { sinf = md[1].trim(); daraja = daraja || md[2]; }
      out.push({
        fio, filial, sinf, daraja,
        tugilgan: String(q.tugilgan || "").trim(),
        jins: String(q.jins || "").trim(),
        telefon: String(q.telefon || "").trim(),
        kod: String(q.kod || "").trim(),
      });
    }
    if (!out.length) throw new Error("bironta faol o'quvchi topilmadi");
    return out;
  }

  // ===================================================================
  //  3B-QISM. TURON SAHIFASIDAN YIG'ISH
  //
  //  Turon (…xususiy-maktab.uz/head-office/students) — Laravel admin
  //  jadvali. Ustunlar sarlavhadan `ustunTani()` bilan taniladi:
  //  O'QUVCHI · SINF / YO'NALISH · TUG'ILGAN SANA · TELEFON · JINS · STATUS.
  //
  //  «O'QUVCHI» katagida BIR NECHTA matn bor: avatar harflari («RB»),
  //  F.I.O, kod («STD-2026-1092») va filial nishoni («Turon Odob Ilm |
  //  Qo'qon»). «SINF» katagida nishon («4-A») va daraja («4-sinf»).
  //  Shuning uchun katak MATN TUGUNLARIGA bo'lib o'qiladi.
  //
  //  Sahifalash: joriy URL + `page=N` fetch qilinadi (Laravel odati).
  //  Jadval server tomonda chizilmasa (fetch bo'sh qaytsa) — foydalanuvchi
  //  sahifalarni qo'lda varaqlaydi, har ochilgan sahifa O'ZI yig'iladi
  //  (MutationObserver), yig'im localStorage'da to'planadi.
  // ===================================================================
  function matnTugunlari(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = String(n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  }

  const KOD_RE = /^[A-Z]{2,5}-\d{2,4}-\d+$/;
  const SANA_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}/;

  // Turon o'quvchilar jadvalini topish va qatorlarini o'qish
  function turonJadval(doc) {
    for (const tb of doc.querySelectorAll("table")) {
      const bosh = tb.querySelector("thead tr") || tb.querySelector("tr");
      if (!bosh) continue;
      const cols = [...bosh.children].map((th) => ustunTani(txt(th)));
      if (!cols.includes("fio") || !cols.includes("sinf")) continue;

      const out = [];
      const qatorlar = tb.tBodies.length ? [...tb.tBodies].flatMap((b) => [...b.rows]) : [...tb.rows].slice(1);
      for (const tr of qatorlar) {
        const cells = [...tr.cells];
        if (cells.length < cols.length - 2) continue;
        const o = { fio: "", kod: "", filial: "", sinf: "", daraja: "", tugilgan: "", jins: "", telefon: "", status: "" };
        cols.forEach((n, i) => {
          const c = cells[i];
          if (!n || !c) return;
          const m = matnTugunlari(c);
          if (n === "fio") {
            m.forEach((t) => {
              if (KOD_RE.test(t)) { o.kod = o.kod || t; return; }
              if (t.includes("|")) { o.filial = o.filial || t.split("|").pop().trim(); return; }
              if (t.length <= 3 || /^\d+$/.test(t)) return;          // avatar «RB», tartib raqami
              if (!o.fio) o.fio = t;
            });
          } else if (n === "sinf") {
            m.forEach((t) => {
              const d = t.match(/^(\d{1,2})\s*-?\s*sinf$/i);
              if (d) { o.daraja = o.daraja || d[1]; return; }
              if (!o.sinf) o.sinf = t;
            });
          } else if (n === "filial") {
            const t = m.join(" ");
            if (t.includes("|")) o.filial = o.filial || t.split("|").pop().trim();
            else if (t && !o.filial) o.filial = t;
          } else if (n === "tugilgan") {
            const t = m.find((x) => SANA_RE.test(x)); if (t) o.tugilgan = t;
          } else if (n === "telefon") {
            const t = m.find((x) => /\d{7,}/.test(x.replace(/[\s()-]/g, ""))); if (t) o.telefon = t;
          } else {
            o[n] = o[n] || m.join(" ");
          }
        });
        if (o.fio) out.push(o);
      }
      return { jadval: tb, qatorlar: out };
    }
    return null;
  }

  // Sahifadagi umumiy sonlar: «Faol 2 771 ta» — yig'im to'liqligini tekshirish uchun
  function turonFaolSoni(doc) {
    const m = txt(doc.body).match(/Faol\s*([\d\s]{1,9})\s*ta/i);
    return m ? Number(m[1].replace(/\s/g, "")) || 0 : 0;
  }

  function yigimOl() {
    try { return JSON.parse(lsOl(LS_YIGIM, "")) || { vaqt: "", qatorlar: {} }; } catch { return { vaqt: "", qatorlar: {} }; }
  }
  function yigimYoz(y) { lsYoz(LS_YIGIM, JSON.stringify(y)); }

  // ⚠️ KOD FILIAL ICHIDA YAGONA, MAKTAB BO'YICHA EMAS (21.09.2026 da topildi).
  //
  //  «STD-2026-437» Furqatda ham, Oltiariqda ham bor — har filial o'z
  //  sanog'ini 1 dan yuritadi. Kalit faqat kod bo'lganida bir xil kodli
  //  bolalar ustma-ust yozilib, 2771 dan 1169 qolgan edi (eng katta kod
  //  ≈ 1175 — ya'ni kodlar soni). Furqat oxirgi sahifalarda kelgani uchun
  //  «g'olib» chiqib, Qo'qon 37, Oltiariq 4, Yaypan 7 ta qolgan edi.
  //  Shuning uchun kalit = FILIAL + kod.
  const qatorKaliti = (o) => `${normKey(o.filial)}|${o.kod || `${normKey(o.fio)}|${normKey(o.sinf)}`}`;

  // Qatorlarni yig'imga qo'shish.
  function yigimgaQosh(y, qatorlar) {
    let yangi = 0;
    qatorlar.forEach((o) => {
      const k = qatorKaliti(o);
      if (!y.qatorlar[k]) yangi++;
      y.qatorlar[k] = o;
    });
    if (yangi) y.vaqt = new Date().toISOString();
    return yangi;
  }

  // Baza URL — sahifaning O'Z sahifalash havolasidan (unda filtr
  // parametrlari saqlangan bo'ladi), bo'lmasa joriy manzil.
  function turonBazaUrl(doc) {
    const a = (doc || document).querySelector('a[href*="page="]');
    const u = new URL(a ? a.getAttribute("href") : location.href, location.origin);
    u.searchParams.delete("page");
    return u;
  }
  function turonUrl(baza, params) {
    const u = new URL(baza.href);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    return u.pathname + u.search;
  }
  function oxirgiSahifa(doc, hozirgi) {
    let oxirgi = hozirgi || 1;
    doc.querySelectorAll('a[href*="page="]').forEach((a) => {
      const m = String(a.getAttribute("href")).match(/[?&]page=(\d+)/);
      if (m) oxirgi = Math.max(oxirgi, Number(m[1]));
    });
    return oxirgi;
  }

  // ⚠️ RO'YXAT TO'LIQ YIG'ILMASA — AVVAL KALITNI TEKSHIRING (yuqoridagi
  //  `qatorKaliti`). 21.09.2026 da «1169/2771» aynan kalit xatosi edi,
  //  tartib esa barqaror chiqdi. Quyidagi usullar ehtiyot chorasi:
  //  server tartibi beqaror bo'lib qolsa ham ro'yxat to'liq yig'ilsin.
  //
  //  Usullar KETMA-KET sinaladi, ishlagani qoladi:
  //   1) BARQARORLIK TEKSHIRUVI: 1-sahifa ikki marta o'qiladi, to'plam
  //      farq qilsa — tartib beqaror.
  //   2) TARTIB PARAMETRI (sort=id, sort_by=id, …): u bilan 1-sahifa ikki
  //      martada bir xil kelsa — topildi.
  //   3) SAHIFA HAJMI (per_page/limit/…): bitta katta sahifada OFFSET yo'q,
  //      takror ham yo'q.
  //   4) SINF BO'YICHA FILTR: sahifadagi sinf ro'yxati (<select>) topilsa,
  //      har sinf alohida so'raladi — to'plam kichik, bir necha o'tishda
  //      to'liq yig'iladi.
  //   5) QAYTA O'TISH: yangi qator kelmay qolguncha (8 martagacha).
  //  Har usul natijasi jurnalga yoziladi — qaysi biri ishlagani ko'rinsin.
  const HAJM_NOMLARI = ["per_page", "perPage", "limit", "page_size", "pageSize", "length", "paginate", "size"];
  const TARTIB_PARAMLARI = [
    { sort: "id" }, { sort: "id", order: "asc" }, { sort: "id", direction: "asc" },
    { sort_by: "id" }, { sort_by: "id", sort_order: "asc" }, { sortBy: "id" }, { sortBy: "id", sortDesc: "false" },
    { order_by: "id" }, { orderBy: "id" }, { sort: "code" }, { sort: "created_at" }, { order: "id" },
  ];

  // To'plamlarni solishtirish (barqarorlik tekshiruvi)
  const toplamTeng = (a, b) => a.length === b.length && a.every((o, i) => qatorKaliti(o) === qatorKaliti(b[i]));

  // Sahifadagi sinf filtri (<select>): ≥3 varianti sinfga o'xshasa — o'sha
  function turonSinfSelect() {
    for (const sel of document.querySelectorAll("select[name]")) {
      const opts = [...sel.options].filter((o) => o.value
        && (SINF_RE.test(txt(o).replace(/\s*\d{1,2}\s*-?\s*sinf$/i, "")) || /^\d{1,2}\s*-\s*\S+/.test(txt(o))));
      if (opts.length >= 3) return { nomi: sel.getAttribute("name"), variantlar: opts.map((o) => ({ v: o.value, t: txt(o) })) };
    }
    return null;
  }

  // Sahifadagi STATUS filtri (<select>): «Faol» varianti bor tanlov — uning
  //  nomi va qiymati. To'liq o'qishda so'rovga majburan qo'shiladi.
  function turonFaolFiltr() {
    for (const sel of document.querySelectorAll("select[name]")) {
      const o = [...sel.options].find((x) => x.value && /^faol$/i.test(txt(x).trim()));
      if (o && sel.options.length <= 8) return { nomi: sel.getAttribute("name"), qiymat: o.value };
    }
    return null;
  }

  // Hamma sahifani fetch bilan o'qish.
  //  Qaytadi: { sahifalar, yangi, otishlar, usul, serverda, tashlandi }
  //  serverda=false — fetch qilingan HTML'da jadval yo'q (SPA), qo'lda varaqlash kerak.
  //
  //  ⚠️ YIG'IM YANGIDAN TUZILADI (26.09.2026). Ilgari sahifalar eski yig'im
  //  USTIGA qo'shilardi: Turonda nofaol qilingan yoki o'chirilgan bola
  //  «Faol» filtrli ro'yxatda boshqa chiqmaydi, lekin yig'imda eski «Faol»
  //  qatori qolib ketardi (Turon «Faol» 2716, yig'imda 2795). Endi to'liq
  //  o'qish alohida to'plamga yig'adi; to'liq chiqsa (maqsadga yetsa yoki
  //  maqsad noma'lum bo'lsa) eski yig'im BUTUNLAY almashtiriladi, yetmasa
  //  eskisiga qo'shiladi va ogohlantiriladi.
  async function turonHammaSahifa(eskiY, maqsad, onProgress, onLog) {
    const say = (m) => { if (onProgress) onProgress(m); };
    const ayt = (m, c) => { if (onLog) onLog(m, c); };
    const baza = turonBazaUrl(document);
    const faolF = turonFaolFiltr();
    if (faolF) {
      if (baza.searchParams.get(faolF.nomi) !== faolF.qiymat) {
        baza.searchParams.set(faolF.nomi, faolF.qiymat);
        ayt(`🔎 Status filtri majburan «Faol» qilindi (${faolF.nomi}=${faolF.qiymat}) — faqat faol o'quvchilar o'qiladi`, "ok");
      } else ayt(`✔ Status filtri «Faol» (${faolF.nomi}=${faolF.qiymat})`, "dim");
    } else ayt("• Sahifada status tanlovi topilmadi — nofaol qatorlar STATUS ustuni bo'yicha tashlanadi", "dim");
    const y = { vaqt: "", qatorlar: {} };
    const soni = () => Object.keys(y.qatorlar).length;
    let sahifalar = 0, jamiYangi = 0, otishlar = 0;
    const usul = [];

    const oqi = async (params) => {
      const pg = await sahifa(turonUrl(baza, params));
      sahifalar++;
      const j = turonJadval(pg.doc);
      return { doc: pg.doc, qatorlar: j ? j.qatorlar : [] };
    };

    // 1) Birinchi sahifa + barqarorlik tekshiruvi
    const p1 = await oqi({ page: 1 });
    if (!p1.qatorlar.length) return { sahifalar, yangi: 0, otishlar: 0, usul: "", serverda: false };
    const oddiy = p1.qatorlar.length;
    jamiYangi += yigimgaQosh(y, p1.qatorlar);
    let oxirgi = oxirgiSahifa(p1.doc, 1);
    await sleep(120);
    const p1b = await oqi({ page: 1 });
    let barqaror = toplamTeng(p1.qatorlar, p1b.qatorlar);
    ayt(barqaror ? "✔ Tartib barqaror ko'rinadi (1-sahifa ikki martada bir xil)" : "⚠ Tartib BEQAROR: 1-sahifa ikki martada har xil keldi", barqaror ? "dim" : "ogoh");

    let params = {};

    // 2) Tartib parametri
    if (!barqaror) {
      for (const tp of TARTIB_PARAMLARI) {
        say(`tartib sinovi: ${Object.entries(tp).map(([k, v]) => k + "=" + v).join("&")}…`);
        try {
          const a = await oqi({ page: 1, ...tp });
          if (!a.qatorlar.length) continue;
          await sleep(120);
          const b = await oqi({ page: 1, ...tp });
          if (toplamTeng(a.qatorlar, b.qatorlar)) {
            params = { ...tp }; barqaror = true;
            jamiYangi += yigimgaQosh(y, a.qatorlar);
            usul.push("tartib " + Object.entries(tp).map(([k, v]) => k + "=" + v).join("&"));
            ayt(`✔ Tartib parametri topildi: ${usul[usul.length - 1]}`, "ok");
            break;
          }
        } catch { /* bu param ishlamadi */ }
        await sleep(120);
      }
      if (!barqaror) ayt("• Tartib parametri topilmadi", "dim");
    }

    // 3) Sahifa hajmi
    let hajm = "";
    for (const nom of HAJM_NOMLARI) {
      say(`sahifa hajmi sinovi: ${nom}…`);
      try {
        const a = await oqi({ page: 1, ...params, [nom]: 500 });
        if (a.qatorlar.length > oddiy) {
          hajm = nom;
          jamiYangi += yigimgaQosh(y, a.qatorlar);
          oxirgi = oxirgiSahifa(a.doc, 1);
          usul.push(`hajm ${nom}=500 (${a.qatorlar.length} qator/sahifa)`);
          ayt(`✔ Sahifa hajmi parametri topildi: ${nom} — ${a.qatorlar.length} qator bir sahifada`, "ok");
          break;
        }
      } catch { /* bu nom ishlamadi */ }
      await sleep(120);
    }
    if (!hajm) ayt("• Sahifa hajmi parametri topilmadi", "dim");
    if (hajm) params[hajm] = 500;

    // 4) Sinf bo'yicha filtr — faqat tartib beqaror va hajm topilmagan bo'lsa
    let filtrlar = [null];
    if (!barqaror && !hajm) {
      const sel = turonSinfSelect();
      if (sel) {
        say(`sinf filtri sinovi: ${sel.nomi}…`);
        try {
          const a = await oqi({ page: 1, [sel.nomi]: sel.variantlar[0].v });
          const birSinf = a.qatorlar.length && a.qatorlar.length < oddiy + 1
            && new Set(a.qatorlar.map((o) => normKey(o.sinf))).size <= 2;
          if (a.qatorlar.length && (birSinf || a.qatorlar.length < oddiy)) {
            filtrlar = sel.variantlar.map((v) => ({ [sel.nomi]: v.v, _t: v.t }));
            usul.push(`sinf filtri ${sel.nomi} (${filtrlar.length} sinf)`);
            ayt(`✔ Sinf filtri ishlaydi: ${sel.nomi}, ${filtrlar.length} sinf alohida o'qiladi`, "ok");
          } else ayt("• Sinf filtri parametri ta'sir qilmadi", "dim");
        } catch { ayt("• Sinf filtri sinovi xato berdi", "dim"); }
      } else ayt("• Sahifada sinf ro'yxati (select) topilmadi", "dim");
    }

    // 5) O'tishlar
    const maxOtish = (barqaror || hajm) ? 1 : (filtrlar.length > 1 ? 3 : 8);
    for (let otish = 1; otish <= maxOtish; otish++) {
      otishlar++;
      let otishYangi = 0;
      for (const filtr of filtrlar) {
        const fp = filtr ? Object.fromEntries(Object.entries(filtr).filter(([k]) => k !== "_t")) : {};
        let fOxirgi = filtr ? 1 : oxirgi;
        for (let p = 1; p <= Math.max(fOxirgi, 500); p++) {
          say(`${otish}-o'tish${filtr ? " · " + filtr._t : ""}, ${p}-sahifa… (yig'ildi ${soni()}${maqsad ? "/" + maqsad : ""})`);
          const pg = await oqi({ page: p, ...params, ...fp });
          if (!pg.qatorlar.length) break;
          const yangi = yigimgaQosh(y, pg.qatorlar);
          otishYangi += yangi; jamiYangi += yangi;
          fOxirgi = oxirgiSahifa(pg.doc, fOxirgi);
          if (p >= fOxirgi) break;
          if (maqsad && soni() >= maqsad) break;
          await sleep(120);
        }
        if (maqsad && soni() >= maqsad) break;
      }
      ayt(`${otish}-o'tish: +${otishYangi} yangi, jami ${soni()}${maqsad ? "/" + maqsad : ""}`, "dim");
      if (maqsad && soni() >= maqsad) break;
      if (otish > 1 && otishYangi === 0) break;
    }
    // Yangi to'plam eski yig'im bilan solishtiriladi
    const eskiKalitlar = Object.keys(eskiY.qatorlar);
    const yangiKalitlar = eskiKalitlar.length ? Object.keys(y.qatorlar).filter((k) => !eskiY.qatorlar[k]).length : soni();
    const tashlanganlar = eskiKalitlar.filter((k) => !y.qatorlar[k]);
    const namuna = tashlanganlar.slice(0, 6).map((k) => { const o = eskiY.qatorlar[k]; return o ? `${o.fio} (${o.sinf})` : k; });
    const toliq = !maqsad || soni() >= maqsad;
    if (toliq) {
      eskiY.qatorlar = y.qatorlar;
      eskiY.vaqt = new Date().toISOString();
      if (tashlanganlar.length) {
        ayt(`🧹 Yig'im yangidan tuzildi: ${tashlanganlar.length} eskirgan qator olib tashlandi (Turon ro'yxatida endi yo'q — nofaol qilingan yoki o'chirilgan). `
          + "Ular eMaktabda bo'lsa CHIQARILADI." + (namuna.length ? " Masalan: " + namuna.join("; ") : ""), "ogoh");
      } else ayt("✔ Yig'im yangidan tuzildi, eskirgan qator yo'q", "dim");
    } else {
      yigimgaQosh(eskiY, Object.values(y.qatorlar));
      if (tashlanganlar.length) ayt(`⚠ To'liq o'qilmagani uchun eski yig'im saqlab qolindi (${tashlanganlar.length} qator bu o'tishda ko'rinmadi). To'liq chiqqach yig'im yangidan tuziladi.`, "ogoh");
    }
    yigimYoz(eskiY);
    return { sahifalar, yangi: yangiKalitlar, otishlar, usul: usul.join("; ") || "oddiy varaqlash", serverda: true, tashlandi: toliq ? tashlanganlar.length : 0 };
  }

  // Sahifa tuzilishi — dasturchi uchun tashxis (formalar, ro'yxatlar,
  // sahifalash havolalari, namuna qator). Yig'ish ishlamasa shu yuboriladi.
  function turonTashxis() {
    const j = turonJadval(document);
    return JSON.stringify({
      sj_turon_tashxis: 1, sahifa: location.href, vaqt: new Date().toISOString(),
      faol: turonFaolSoni(document),
      formalar: [...document.querySelectorAll("form")].map((f) => ({
        action: f.getAttribute("action") || "", metod: f.getAttribute("method") || "",
        maydonlar: [...f.querySelectorAll("input[name], select[name]")].map((el) => ({
          nomi: el.getAttribute("name"), turi: el.type || el.tagName, qiymat: cut(el.value, 80),
          variantlar: el.tagName === "SELECT" ? [...el.options].slice(0, 80).map((o) => ({ v: o.value, t: txt(o) })) : undefined,
        })),
      })),
      selectlar: [...document.querySelectorAll("select")].map((s) => ({
        nomi: s.getAttribute("name") || "", id: s.id || "", variantlar: [...s.options].slice(0, 80).map((o) => ({ v: o.value, t: txt(o) })),
      })),
      sahifalash: [...document.querySelectorAll('a[href*="page="]')].slice(0, 12).map((a) => a.getAttribute("href")),
      skriptlar: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")).slice(0, 30),
      jadval: j ? { qatorlar: j.qatorlar.length, namuna: j.qatorlar.slice(0, 3), html: cut(j.jadval.querySelector("tbody tr") ? j.jadval.querySelector("tbody tr").outerHTML : "", 5000) } : null,
    }, null, 2);
  }
  // ===================================================================
  //  4-QISM. SINF MOSLIGI — Turon sinfi → eMaktab sinf kaliti
  //
  //  Standart: «4-A» + filial harfi.
  //  Qo'lda jadval (har qatorda):  Turon sinf | filial = eMaktab sinf
  //    masalan:  8-Ijtimoiy | Furqat = 8 I
  //              Aniq 1 | Qo'qon = 10 A Q
  //  Filial bo'sh qoldirilsa hamma filialga tegishli.
  // ===================================================================
  const FILIAL_DEF = "Furqat =\nOltiariq = O\nQo'qon = Q\nYaypan = Y";

  function filialXarita(matn) {
    const map = new Map();
    String(matn || "").split("\n").forEach((q) => {
      const i = q.indexOf("=");
      if (i < 1) return;
      map.set(normKey(q.slice(0, i)), normKey(q.slice(i + 1)));
    });
    return map;
  }

  function sinfXarita(matn) {
    const map = new Map();   // "sinfKalit|filialKalit" → eMaktab classKey
    String(matn || "").split("\n").forEach((q) => {
      const i = q.indexOf("=");
      if (i < 1) return;
      const chap = q.slice(0, i).split("|");
      const sinf = normKey(chap[0]);
      const filial = normKey(chap[1] || "");
      const ong = q.slice(i + 1).trim();
      if (sinf && ong) map.set(`${sinf}|${filial}`, classKey(ong));
    });
    return map;
  }

  // Turon sinfini tahlil qilish.
  //
  //  Qaytadi:
  //    { kalit }            — harfli sinf («4-A» + Qo'qon → "4aq"): AYNAN shu sinf
  //    { daraja, naqsh }    — harfsiz («8-Ijtimoiy», «Aniq 1», «Ijtimoiy1»):
  //                           shu filialdagi shu DARAJAdagi istalgan sinf
  //    { sabab }            — aniqlab bo'lmadi
  //
  //  ⚠️ YO'NALISH NOMI (Ijtimoiy / Tabiiy / Aniq) SINF EMAS. Turonda yuqori
  //  sinflar yo'nalish bo'yicha yuradi («8-Ijtimoiy», yonida «8-sinf»),
  //  eMaktabda esa odatdagi «8 A», «8 B». Shuning uchun faqat RAQAM olinadi:
  //  bola eMaktabda o'sha raqamli sinfda tursa — tegilmaydi, yangi bo'lsa
  //  shu raqamli sinflardan eng kam o'quvchilisiga qo'shiladi (taqqosla()).
  //
  //  Filial belgisi: Furqat — qo'shimchasiz («8 A» → "8a"), boshqalari
  //  oxirida filialning bosh harfi («8 A Q» → "8aq"). Furqat naqshi
  //  boshqa filial qo'shimchasi bilan tugagan kalitlarni CHIQARIB tashlaydi.
  function turonSinf(o, filiallar, qolda) {
    const sinfK = normKey(o.sinf);
    const filK = normKey(o.filial);
    if (!sinfK) return { sabab: "sinf bo'sh" };

    const q = qolda.get(`${sinfK}|${filK}`) || qolda.get(`${sinfK}|`);
    if (q) return { kalit: q };

    // Filial ustuni umuman bo'lmasa — qo'shimcha harfsiz (bosh filial) deb olinadi
    if (filK && !filiallar.has(filK)) {
      return { sabab: `filial «${o.filial}» harflar jadvalida yo'q` };
    }
    const fHarf = filiallar.get(filK) || "";
    const boshqaHarflar = [...new Set([...filiallar.values()].filter((h) => h && h !== fHarf))].join("");

    const s = String(o.sinf).replace(APOS, "").trim();
    let daraja = 0, harf = "";
    // «4-A», «4 A», «4A» — raqam + 1-2 harf, boshqa hech narsa
    const m = s.match(/^(\d{1,2})\s*[-–—_. ]?\s*([A-Za-zЀ-ӿ]{1,2})$/);
    if (m) { daraja = Number(m[1]); harf = normKey(m[2]); }
    else {
      // «8-Ijtimoiy» → 8; «Ijtimoiy1» / «Aniq 1» → raqam «8-sinf» ustunidan
      const d = s.match(/^(\d{1,2})(?![\d])/) || String(o.daraja || "").match(/(\d{1,2})/);
      if (d) daraja = Number(d[1]);
      // Sinf ustunida faqat harf, daraja alohida ustunda: «A» + «4-sinf»
      const h = s.match(/^([A-Za-zЀ-ӿ]{1,2})$/);
      if (h && daraja) harf = normKey(h[1]);
    }
    if (!daraja) return { sabab: `«${o.sinf}» dan sinf raqami aniqlanmadi` };
    // `korinish` — eMaktabda kutilgan nom («4 A Q»), xabarlar uchun
    if (harf) {
      const korinish = `${daraja} ${harf.toUpperCase()}${fHarf ? " " + fHarf.toUpperCase() : ""}`;
      return { kalit: `${daraja}${harf}${fHarf}`, daraja, fHarf, korinish };
    }
    const naqsh = fHarf
      ? new RegExp(`^${daraja}[a-z]{1,2}${fHarf}$`)
      : new RegExp(`^${daraja}[a-z]{1,2}$`);
    const istisno = (!fHarf && boshqaHarflar) ? new RegExp(`^${daraja}[a-z][${boshqaHarflar}]$`) : null;
    return { daraja, fHarf, naqsh, istisno };
  }

  // Shu filial + darajadagi eMaktab sinf kalitlari
  function darajaSinflari(info, emkSinflar) {
    return [...emkSinflar.keys()].filter((k) => info.naqsh.test(k) && !(info.istisno && info.istisno.test(k)));
  }

  // ===================================================================
  //  5-QISM. eMAKTAB RO'YXATI — «Odamlarni izlash» sahifalari
  //
  //  URL: /v2/admin/persons/default?school=…&group=students&search=&class=&age=0
  //  Jadval ustunlari: FISH (havola) · Lavozim/toifa · Sinf · ✎ (tahrir).
  //  Sahifalash havolalari `page=` parametri bilan (eng katta raqam
  //  olinadi; bo'lmasa keyingi sahifa bo'sh kelguncha yuriladi).
  // ===================================================================
  // ⚠️ MANZIL QAT'IY «Odamlarni izlash» (22.09.2026): skript
  //  `/v2/admin/persons/*` ning hamma sahifasida (shaxs, ko'chirish ustasi)
  //  ishlaydi. Ilgari ro'yxat joriy manzildan o'qilardi — usta sahifasida
  //  turib bosilganda «0 o'quvchi» chiqqan. Endi yo'l va parametrlar
  //  har doim o'zimizniki.
  //  `qoshimcha` — {search: "Familiya Ism", group: "all"} kabi qo'shimcha
  //  parametrlar (mavjud odamni qidirish uchun, `mavjudniTop`).
  function royxatUrl(page, qoshimcha) {
    const u = new URL(location.origin + "/v2/admin/persons/default");
    u.searchParams.set("school", schoolId || new URL(location.href).searchParams.get("school") || "");
    u.searchParams.set("group", "students");
    u.searchParams.set("search", "");
    u.searchParams.set("class", "");
    u.searchParams.set("age", "0");
    if (page > 1) u.searchParams.set("page", String(page));
    if (qoshimcha) Object.entries(qoshimcha).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    return u.pathname + u.search;
  }

  const SINF_RE = /^\d{1,2}\s*[-–—]?\s*[A-Za-zЀ-ӿ]{1,3}(\s+[A-Za-zЀ-ӿ]{1,3})*$/;

  function idHref(href) {
    const h = String(href || "");
    const m = h.match(/[?&](?:person|user|personId|id)=(\d+)/i) || h.match(/\/(\d{6,})(?:[/?#]|$)/);
    return m ? m[1] : "";
  }

  // ⚠️ SINFSIZ O'QUVCHILAR HAM O'QILADI (21.09.2026 da 1302 dan 1228 chiqqan
  //  edi — 74 tasi sinfga biriktirilmagan). Ular tashlab ketilsa Turondagi
  //  ismi «yo'q» deb qo'shiladi va NUSXA paydo bo'ladi. Shuning uchun
  //  qator sinfsiz bo'lsa ham, lavozimi «O'quvchi» bo'lsa olinadi; sinfi
  //  keyin taqqoslashda biriktiriladi (ko'chirish).
  //
  //  Asosiy jadval sarlavhasi bo'yicha topiladi (FISH · Lavozim · Sinf),
  //  yon paneldagi «O'quvchilar 1302» kabi havolalar unga kirmaydi.
  // O'qilmagan qatorlar hisobi — «1302 dan 1230» kabi farqning sababi
  // jurnalda ko'rinsin (havolasiz / o'quvchi emas / kam katak).
  const OQILMADI = { havolasiz: 0, oquvchiEmas: 0, kamKatak: 0, namuna: "" };

  function qatorlarniOqi(doc) {
    const out = [];
    const jadvallar = [...doc.querySelectorAll("table")].filter((tb) => {
      const bosh = txt(tb.querySelector("thead tr") || tb.rows[0] || null);
      return /fish|f\.i\.o|фио|ism/i.test(bosh) && /sinf|класс|lavozim|toifa/i.test(bosh);
    });
    const manba = jadvallar.length ? jadvallar : [...doc.querySelectorAll("table")];
    const qatiq = !jadvallar.length;   // sarlavha topilmasa — eski, qattiq qoida (sinf shart)
    manba.forEach((tb) => {
      [...tb.rows].forEach((tr) => {
        const cells = [...tr.cells];
        if (tr.querySelector("th")) return;
        if (cells.length < 3) { if (jadvallar.length) { OQILMADI.kamKatak++; if (!OQILMADI.namuna) OQILMADI.namuna = cut(tr.outerHTML, 700); } return; }
        // ⚠️ ISMI HAVOLA BO'LMAGAN O'QUVCHILAR HAM O'QILADI (21.09.2026 da 72 ta
        //  shunday chiqdi — ehtimol hisobi faollashmagan). Ular tashlab
        //  ketilsa Turondagi ismi «yo'q» deb QAYTA qo'shiladi. Ism havolasiz
        //  bo'lsa — eng uzun matnli katak (lavozim va sinf emas) olinadi.
        const a = tr.querySelector("a[href]");
        const rolRe = /quvchi|ученик|student|qituvchi|учител|xodim/i;
        let fio = a ? unesc(txt(a)) : "";
        if (!fio) {
          const nomz = cells.map(txt).filter((s) => s && !SINF_RE.test(s) && !rolRe.test(s) && !/^\d+$/.test(s) && s.length > 4);
          fio = unesc(nomz.sort((x, y) => y.length - x.length)[0] || "");
          if (!fio) { OQILMADI.havolasiz++; if (!OQILMADI.namuna) OQILMADI.namuna = cut(tr.outerHTML, 700); return; }
        }
        const nomCell = a ? a.closest("td") : cells.find((c) => txt(c) === fio);
        const sinfCell = cells.find((c) => c !== nomCell && SINF_RE.test(txt(c)));
        const oquvchimi = /quvchi|ученик|student/i.test(cells.map(txt).join(" "));
        if (qatiq ? !sinfCell : !(sinfCell || oquvchimi)) { OQILMADI.oquvchiEmas++; if (!OQILMADI.namuna) OQILMADI.namuna = cut(tr.outerHTML, 700); return; }
        const havolalar = [...tr.querySelectorAll("a[href]")].map((x) => x.getAttribute("href"));
        const tahrir = havolalar.find((h) => /edit|tahrir|change/i.test(h)) || (a ? havolalar[havolalar.length - 1] : havolalar[0]) || "";
        out.push({
          id: (a ? idHref(a.getAttribute("href")) : "") || idHref(tahrir),
          fio,
          sinf: sinfCell ? txt(sinfCell) : "",
          havola: a ? a.getAttribute("href") : "",
          tahrir,
        });
      });
    });
    return out;
  }

  // ⚠️ eMAKTAB SINFLARI «SINFLAR» SAHIFASIDAN O'QILADI, o'quvchilar
  //  ro'yxatidan emas. O'quvchilar ro'yxatida faqat ICHIDA bola bor sinf
  //  ko'rinadi — yangi ochilgan bo'sh «8 A O» unda yo'q va skript uni
  //  «ochilmagan» deb hisoblagan edi (21.09.2026). Sinflar sahifasi
  //  (Dars jadvali → Sinflar, `/v2/schedules/?school=`) hamma sinfni
  //  `group=<id>` havolalari bilan beradi — dars jadvali ko'prigi ham
  //  shu sahifadan oladi.
  async function emaktabSinflari() {
    const { doc } = await sahifaTiklab(`/v2/schedules/?school=${enc(schoolId)}`);
    const out = [];
    const korilgan = new Set();
    doc.querySelectorAll('a[href*="group="]').forEach((a) => {
      const m = String(a.getAttribute("href") || "").match(/[?&]group=(\d+)/);
      const nom = txt(a);
      if (!m || !nom || korilgan.has(m[1]) || !/^\d{1,2}/.test(nom)) return;
      korilgan.add(m[1]);
      out.push({ id: m[1], nom });
    });
    return out;
  }

  function jamiSoni(doc) {
    const m = txt(doc.body).match(/topildi:?\s*(\d+)/i) || txt(doc.body).match(/найдено:?\s*(\d+)/i);
    return m ? Number(m[1]) : 0;
  }

  async function emaktabRoyxati(onProgress) {
    const say = (m) => { if (onProgress) onProgress(m); };
    const hamma = new Map();   // id yoki fio+sinf → yozuv
    const qosh = (list) => {
      let yangi = 0;
      list.forEach((o) => {
        const k = o.id || `${normKey(o.fio)}|${classKey(o.sinf)}`;
        if (!hamma.has(k)) { hamma.set(k, o); yangi++; }
      });
      return yangi;
    };

    OQILMADI.havolasiz = 0; OQILMADI.oquvchiEmas = 0; OQILMADI.kamKatak = 0; OQILMADI.namuna = "";
    say("1-sahifa…");
    const p1 = await sahifaTiklab(royxatUrl(1));
    const jami = jamiSoni(p1.doc);
    qosh(qatorlarniOqi(p1.doc));

    let oxirgi = oxirgiSahifa(p1.doc, 1);

    // ⚠️ PARALLEL O'QISH (22.09.2026: 2451 bola = 246 sahifa, birma-bir 150 ms
    //  kutish bilan 5+ daqiqa — sessiya o'qish tugamay uzilardi). Endi 6
    //  sahifa bir vaqtda, kutishsiz (~30–40 s). eMaktab sahifalash havolalari
    //  faqat yaqin oynani ko'rsatishi mumkin — `oxirgi` har sahifadan
    //  yangilanadi. Sahifa yangi qator bermasa va oxirgidan o'tgan bo'lsa
    //  to'xtaydi. Sessiya uzilsa `sahifaTiklab` uni tiklab qayta o'qiydi.
    const BATCH = 6;
    let p = 2;
    for (let tur = 0; tur < 200; tur++) {
      if (oxirgi === 1 && jami && hamma.size >= jami) break;
      const sahifalar = [];
      const chegara = Math.max(oxirgi, p);
      for (let k = 0; k < BATCH && p <= chegara && p <= 600; k++, p++) sahifalar.push(p);
      if (!sahifalar.length) break;
      say(`${sahifalar[0]}–${sahifalar[sahifalar.length - 1]}-sahifa… (${hamma.size}${jami ? "/" + jami : ""})`);
      const natijalar = await Promise.all(sahifalar.map(async (pp) => ({ pp, doc: (await sahifaTiklab(royxatUrl(pp))).doc })));
      let boshKeldi = false;
      for (const { doc } of natijalar) {
        const yangi = qosh(qatorlarniOqi(doc));
        oxirgi = Math.max(oxirgi, oxirgiSahifa(doc, oxirgi));
        if (!yangi) boshKeldi = true;          // sahifa takrorlandi yoki bo'sh
      }
      if (boshKeldi && p > oxirgi) break;
      if (jami && hamma.size >= jami) break;
    }
    return { royxat: [...hamma.values()], jami };
  }

  // `sahifa()` — sessiya uzilsa fonda tiklab (sessiyaniTikla) bir marta qayta
  //  urinadi. Ro'yxat o'qish va sinflar sahifasi uchun.
  async function sahifaTiklab(url) {
    try { return await sahifa(url); }
    catch (err) {
      if (err.message === TOXTATILDI || !/sessiya tugagan|so'rov ketmadi|Failed to fetch/i.test(err.message)) throw err;
      if (!(await sessiyaniTikla())) throw err;
      return sahifa(url);
    }
  }

  // ===================================================================
  //  6-QISM. TAQQOSLASH
  //
  //  Moslik tartibi:
  //   1) to'liq ism kaliti teng;
  //   2) so'zlar tartibsiz teng;
  //   3) familiya+ism teng va nishon sinflardan birida (sharifi yozilmagan);
  //  Qolganlar: Turondagi → «qoshish», eMaktabdagi → «chiqarish».
  //
  //  Nishon sinf: harfli («4-A») — aynan bitta; harfsiz («8-Ijtimoiy») —
  //  shu filialdagi shu raqamli HAMMA sinf. Bola ulardan birida tursa
  //  «mos», yo'qsa eng kam o'quvchili sinfga qo'shiladi/ko'chiriladi.
  //  Ikki ro'yxatda familiya+ism bir xil bo'lsa — «shubhali» juftlik,
  //  avtomatik bajarilmaydi.
  // ===================================================================
  function taqqosla(turon, emaktab, filiallar, qolda, sinflar = []) {
    const r = { qoshish: [], chiqarish: [], kochirish: [], mos: [], sinfsiz: [], shubhali: [] };

    const emkSinflar = new Map();   // classKey → eMaktab sinf nomi (ko'rinishi)
    // Avval «Sinflar» sahifasidagi TO'LIQ ro'yxat (bo'sh sinflar ham),
    // keyin o'quvchilar ro'yxatida uchraganlar (sahifa ochilmasa ham ishlasin)
    sinflar.forEach((s) => { const k = classKey(s.nom); if (k && !emkSinflar.has(k)) emkSinflar.set(k, s.nom); });
    emaktab.forEach((e) => { if (e.sinf) { const k = classKey(e.sinf); if (!emkSinflar.has(k)) emkSinflar.set(k, e.sinf); } });
    // Sinf ID'lari — yaratish formasidagi `group` ro'yxati bo'sh kelgani
    // uchun ID to'g'ridan-to'g'ri yuboriladi (formaToldir)
    const sinfIdlari = new Map();
    sinflar.forEach((s) => { const k = classKey(s.nom); if (k && !sinfIdlari.has(k)) sinfIdlari.set(k, s.id); });
    r.sinfIdlari = sinfIdlari;

    const eBy = { toliq: new Map(), tartibsiz: new Map(), qisqa: new Map() };
    emaktab.forEach((e) => {
      const k = ismKalit(e.fio);
      e._k = k; e._sinfK = classKey(e.sinf);
      if (!eBy.toliq.has(k.toliq)) eBy.toliq.set(k.toliq, e);
      if (!eBy.tartibsiz.has(k.tartibsiz)) eBy.tartibsiz.set(k.tartibsiz, e);
      if (!eBy.qisqa.has(k.qisqa)) eBy.qisqa.set(k.qisqa, []);
      eBy.qisqa.get(k.qisqa).push(e);
    });

    // Sinf to'lganligi: eMaktabdagi hozirgi soni + shu yurishda rejalashtirilganlar.
    // Harfsiz («8-Ijtimoiy») bolalar shu raqamli sinflarning eng kam
    // o'quvchilisiga tushadi — sinflar tekis to'lsin.
    const sinfSoni = new Map();
    emaktab.forEach((e) => { const k = classKey(e.sinf); sinfSoni.set(k, (sinfSoni.get(k) || 0) + 1); });
    const engKam = (kalitlar) => kalitlar.slice().sort((a, b) => (sinfSoni.get(a) || 0) - (sinfSoni.get(b) || 0) || a.localeCompare(b))[0];

    r.sinfXarita = new Map();   // «Turon sinf | filial» → eMaktab sinf(lar) — hisobot uchun

    // ⚠️ TURON DUBLIKATLARI (26.09.2026): 8 bola Turon ro'yxatida IKKI marta
    //  — bir qatori filial bilan, ikkinchisi filialsiz («(bo'sh): 12»).
    //  Filialli qatori eMaktabdagi odamga mos tushib, filialsiz nusxasi
    //  «eMaktabda yo'q» deb QO'SHISHga tushgan (server «allaqachon mavjud»
    //  dedi). To'liq ism + tug'ilgan sana bir xil qatorlar guruhlanadi:
    //  filiallisi qoladi, qolgani `turonDublikat` ga tushadi (jurnal + CSV).
    r.turonDublikat = [];
    {
      const guruhT = new Map();
      turon.forEach((t) => {
        const kk = ismKalit(t.fio).toliq + "|" + sanaNorm(t.tugilgan || "");
        if (!guruhT.has(kk)) guruhT.set(kk, []);
        guruhT.get(kk).push(t);
      });
      const tashla = new Set();
      guruhT.forEach((g) => {
        if (g.length < 2) return;
        const asosiy = g.find((t) => t.filial) || g[0];
        g.forEach((t) => { if (t !== asosiy) { tashla.add(t); r.turonDublikat.push({ t, asosiy }); } });
      });
      if (tashla.size) turon = turon.filter((t) => !tashla.has(t));
    }
    // Dublikat ismlar (familiya+ism) — eMaktabda ikki yozuv bo'lsa TEGILMAYDI
    const dublQisqa = new Set(r.turonDublikat.map((x) => ismKalit(x.t.fio).qisqa));

    // Familiya+ism Turonda necha marta uchraydi — yagona bo'lsa, eMaktabda
    // ham yagona bo'lsa, sharifi yozilmagan/boshqacha yozilgan bola ham
    // aynan o'sha (25 «shubhali» juftlikning ko'pi shu edi, 21.09.2026).
    const tQisqa = new Map();
    turon.forEach((t) => { const q = ismKalit(t.fio).qisqa; tQisqa.set(q, (tQisqa.get(q) || 0) + 1); });

    // ⚠️ OTASINING ISMI ZID BO'LSA — BOSHQA ODAM (26.09.2026: «Akramov
    //  Abdulloh BAHROM o'g'li» ↔ «Акрамов Абдуллох МУЗАФФАР ўғли»). Familiya+ism
    //  bo'yicha yagona moslik ham, shubhali juftlik ham shu qoidaga bo'ysunadi.
    //  Sharif faqat bir tomonda yozilgan bo'lsa zid emas (sharifsiz yozuv).
    const sozlar = (fio) => String(fio == null ? "" : fio).replace(APOS, "").split(/\s+/)
      .map((x) => normKey(x).replace(/x/g, "h").replace(/ovich$|ovna$|evich$|evna$/, ""))
      .filter((x) => x && !/^(ogli|ugli|qizi|kizi|уғли|қизи)$/.test(x));
    const darajasi = (k) => Number((String(k || "").match(/^\d{1,2}/) || [0])[0]) || 0;
    const sharifZid = (a, b) => {
      const sa = sozlar(a)[2] || "", sb = sozlar(b)[2] || "";
      return !!(sa && sb && sa !== sb && !sa.startsWith(sb) && !sb.startsWith(sa));
    };
    const boshqaOdam = (t, e) => {
      const dt = darajasi(t._sinfK), de = darajasi(e._sinfK);
      if (dt && de && Math.abs(dt - de) > 1) return `sinf farqi (${dt} ↔ ${de})`;
      if (sharifZid(t.fio, e.fio)) return `otasining ismi (${sozlar(t.fio)[2]} ↔ ${sozlar(e.fio)[2]})`;
      return "";
    };

    const ishlatildi = new Set();
    turon.forEach((t) => {
      const s = turonSinf(t, filiallar, qolda);
      const xk = `${t.sinf} | ${t.filial || "—"}`;
      t._sinfK = ""; t._emkSinf = "";

      const k = ismKalit(t.fio);
      let e = eBy.toliq.get(k.toliq) || eBy.tartibsiz.get(k.tartibsiz) || null;
      if (!e && tQisqa.get(k.qisqa) === 1) {
        const nomz = (eBy.qisqa.get(k.qisqa) || []).filter((x) => !ishlatildi.has(x));
        // ⚠️ SINF FARQI 1 DAN KATTA BO'LSA — BOSHQA ODAM. «Vahobjonov
        //  Kamronbek» eMaktabda 11-B, Turonda 3-sinf (Oltiariq) — familiya
        //  va ism bir xil, lekin ikki bola (21.09.2026). Sinfsiz eMaktab
        //  yozuvi yoki ±1 sinf (o'tgan yilgi yozuv) qabul qilinadi.
        const tDaraja = Number(s.daraja || (String(s.kalit || "").match(/^\d{1,2}/) || [0])[0]) || 0;
        const eDaraja = nomz.length === 1 ? Number((String(nomz[0]._sinfK).match(/^\d{1,2}/) || [0])[0]) || 0 : 0;
        const yaqinSinf = !eDaraja || !tDaraja || Math.abs(eDaraja - tDaraja) <= 1;
        if (nomz.length === 1 && (eBy.qisqa.get(k.qisqa) || []).length === 1 && yaqinSinf && !sharifZid(t.fio, nomz[0].fio)) e = nomz[0];
      }
      if (e && ishlatildi.has(e)) e = null;

      // ⚠️ TURON DUBLIKATI + eMAKTABDA IKKI YOZUV — HECH NARSA QILINMAYDI
      //  (26.09.2026). Qaysi yozuv asl, qaysi sinf to'g'ri — skript bilmaydi;
      //  ko'chirsa ham, chiqarsa ham xato bo'lishi mumkin. Hamma yozuv
      //  «shubhali»ga tushadi, maktab qo'lda hal qiladi.
      if (dublQisqa.has(k.qisqa)) {
        const hammasi = (eBy.qisqa.get(k.qisqa) || []).filter((x) => !ishlatildi.has(x));
        if (hammasi.length >= 2) {
          hammasi.forEach((x) => { ishlatildi.add(x); r.shubhali.push({ t, e: x, izoh: `Turon dublikati — eMaktabda ${hammasi.length} yozuv bor (${hammasi.map((y) => y.sinf || "sinfsiz").join(", ")}); qaysi biri asl ekanini qo'lda aniqlang, Turondagi ortiqcha qatorni o'chiring` }); });
          return;
        }
      }

      if (s.sabab) {
        r.sinfXarita.set(xk, `✖ ${s.sabab}`);
        r.sinfsiz.push({ t, e, sabab: s.sabab }); if (e) ishlatildi.add(e); return;
      }

      // Nishon sinf(lar)ni aniqlash
      let nomzodlar;
      if (s.kalit) {
        nomzodlar = emkSinflar.has(s.kalit) ? [s.kalit] : [];
        t._sinfK = s.kalit;
        if (!nomzodlar.length) {
          // Shu darajadagi mavjud sinflarni ko'rsatamiz — foydalanuvchi darrov ko'rsin
          const yaqin = darajaSinflari({ naqsh: s.fHarf ? new RegExp(`^${s.daraja}[a-z]{1,2}${s.fHarf}$`) : new RegExp(`^${s.daraja}[a-z]{1,2}$`), istisno: null }, emkSinflar)
            .map((x) => emkSinflar.get(x)).join(", ");
          // ⚠️ BOSHQA FILIAL SINFIGA TUSHIRILMAYDI. Qo'qonning «4-A» si faqat
          //  «4 A Q» ga; u eMaktabda ochilmagan bo'lsa bola KUTADI — sinf
          //  ochilgach keyingi sinxronda qo'shiladi. «4 A» (Furqat) ga
          //  qo'shib yuborish — noto'g'ri filialga o'quvchi tushishi.
          const sabab = `eMaktabda «${s.korinish || s.kalit}» sinfi hali ochilmagan — sinf ochilgach qo'shiladi`
            + (yaqin ? ` (bu filialda bor: ${yaqin})` : "");
          r.sinfXarita.set(xk, `✖ ${sabab}`);
          r.sinfsiz.push({ t, e, sabab }); if (e) ishlatildi.add(e); return;
        }
      } else {
        nomzodlar = darajaSinflari(s, emkSinflar);
        if (!nomzodlar.length) {
          const sabab = `eMaktabda ${s.daraja}-sinf (${t.filial || "bosh filial"}) hali ochilmagan — sinf ochilgach qo'shiladi`;
          r.sinfXarita.set(xk, `✖ ${sabab}`);
          r.sinfsiz.push({ t, e, sabab }); if (e) ishlatildi.add(e); return;
        }
      }
      r.sinfXarita.set(xk, nomzodlar.map((x) => emkSinflar.get(x)).sort().join(" / "));
      // Maqbul sinflar ro'yxati bolada qoladi — mavjud odam topilganda
      // (mavjudOdam) shulardan birida tursa ko'chirilmaydi
      t._nomzodlar = nomzodlar.slice();

      // Sharifsiz yozuv: familiya+ism nomzod sinflarning birida yagona bo'lsa — o'sha
      if (!e) {
        const nomz = (eBy.qisqa.get(k.qisqa) || []).filter((x) => !ishlatildi.has(x) && nomzodlar.includes(x._sinfK) && !sharifZid(t.fio, x.fio));
        if (nomz.length === 1) e = nomz[0];
      }

      if (e && nomzodlar.includes(e._sinfK)) {
        // Bola allaqachon to'g'ri sinfda (harfsiz holatda — shu raqamli
        // sinflardan birida) — TEGILMAYDI
        ishlatildi.add(e);
        t._sinfK = e._sinfK; t._emkSinf = e.sinf;
        r.mos.push({ t, e });
        return;
      }
      const nishon = engKam(nomzodlar);
      t._sinfK = nishon; t._emkSinf = emkSinflar.get(nishon); t._sinfId = sinfIdlari.get(nishon) || "";
      sinfSoni.set(nishon, (sinfSoni.get(nishon) || 0) + 1);
      if (!e) { r.qoshish.push({ t }); return; }
      ishlatildi.add(e);
      sinfSoni.set(e._sinfK, (sinfSoni.get(e._sinfK) || 1) - 1);
      r.kochirish.push({ t, e });
    });

    emaktab.forEach((e) => { if (!ishlatildi.has(e)) r.chiqarish.push({ e }); });

    // ⚠️ TURON DUBLIKATI BO'LGAN ISM — CHIQARILMAYDI (26.09.2026: Turonda ikki
    //  qatori bor bolaning eMaktabda ham ikki yozuvi bo'lib qoldi — bittasi
    //  birinchi yurishda skript yaratgan nusxa. Dublikat filtri bir qatorni
    //  qoldirgach, u yangi nusxaga mos tushdi, ASL yozuv esa «Turonda yo'q»
    //  deb Arxivga chiqarildi — 4 bola). Endi bunday eMaktab yozuvi
    //  «shubhali»ga tushadi: maktab qaysi yozuv asl ekanini qo'lda hal
    //  qiladi (Turon dublikatini o'chiradi, eMaktabda ortiqchasini chiqaradi).
    if (r.turonDublikat.length) {
      const dublKalit = new Map();
      r.turonDublikat.forEach((x) => dublKalit.set(ismKalit(x.t.fio).qisqa, x.t));
      r.chiqarish = r.chiqarish.filter((x) => {
        const t = dublKalit.get(x.e._k.qisqa);
        if (!t) return true;
        r.shubhali.push({ t, e: x.e, izoh: "Turon dublikati — eMaktabda ham ikki yozuv bor, qaysi biri asl ekanini qo'lda aniqlang; Turondagi ortiqcha qatorni o'chiring" });
        return false;
      });
    }

    // Shubhali juftliklar: qo'shiladigan va chiqariladigan ism familiya+ism
    // bo'yicha bir xil bo'lsa — ehtimol bitta odam, yozilishi farq qiladi.
    const chiqQisqa = new Map();
    r.chiqarish.forEach((x) => {
      const q = x.e._k.qisqa;
      if (!chiqQisqa.has(q)) chiqQisqa.set(q, []);
      chiqQisqa.get(q).push(x);
    });
    // ⚠️ ANIQ BOSHQA ODAM BO'LSA — SHUBHALI EMAS (26.09.2026: 10 juftlikning
    //  8 tasi shunday edi, masalan «Vaxobjonov Kamronbek Bexzod o'g'li» 3-sinf
    //  Oltiariq ↔ eMaktab «Vahobjonov Kamronbek» 11-B; «Akramov Abdulloh
    //  BAHROM o'g'li» ↔ «Акрамов Абдуллох МУЗАФФАР ўғли»). Sinf farqi 1 dan
    //  katta yoki otasining ismi ikkalasida ham yozilib, har xil bo'lsa —
    //  ikki bola: Turondagisi qo'shiladi, eMaktabdagisi chiqariladi.
    //  Faqat sinfi yaqin va sharifi zid bo'lmagan juftlik «shubhali» qoladi.
    r.qoshish = r.qoshish.filter((x) => {
      const q = ismKalit(x.t.fio).qisqa;
      const juft = chiqQisqa.get(q);
      if (!juft || !juft.length) return true;
      const i = juft.findIndex((y) => !boshqaOdam(x.t, y.e));
      if (i < 0) { x.izoh = `ismi o'xshash «${juft[0].e.fio}» (${juft[0].e.sinf || "sinfsiz"}) bilan, lekin ${boshqaOdam(x.t, juft[0].e)} — boshqa bola`; return true; }
      const y = juft.splice(i, 1)[0];
      r.chiqarish = r.chiqarish.filter((z) => z !== y);
      r.shubhali.push({ t: x.t, e: y.e });
      return false;
    });

    r.emkSinflar = emkSinflar;
    return r;
  }


  // ===================================================================
  //  6C-QISM. EXCEL HISOBOT (.xlsx) — TASHQI KUTUBXONASIZ
  //  (maktab talabi, 26.09.2026: «hamma hisobot Excel bo'lsin, Turonda ikki
  //  marta bo'lib qolganlar, tug'ilgan sanasi o'zgarganlar, farq sababi —
  //  CSV kerak emas»).
  //  .xlsx = ZIP («stored», siqilmagan) ichida OOXML. Matnlar inlineStr —
  //  sharedStrings shart emas. Sarlavha qalin + fon, birinchi qator
  //  muzlatilgan, avtofiltr. Excel, LibreOffice, Google Sheets ochadi.
  // ===================================================================
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  // [{nom, matn}] → ZIP Blob (stored)
  function zipYasa(fayllar) {
    const enc8 = new TextEncoder();
    const qismlar = [], markaz = [];
    let ofset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const d = new Date();
    const vaqt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const sana = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    for (const f of fayllar) {
      const nom = enc8.encode(f.nom), data = enc8.encode(f.matn), crc = crc32(data);
      const bosh = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(vaqt), ...u16(sana), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nom.length), ...u16(0)]);
      qismlar.push(bosh, nom, data);
      markaz.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(vaqt), ...u16(sana), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nom.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(ofset)]), nom);
      ofset += bosh.length + nom.length + data.length;
    }
    const markazHajmi = markaz.reduce((a, x) => a + x.length, 0);
    const oxiri = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(fayllar.length), ...u16(fayllar.length), ...u32(markazHajmi), ...u32(ofset), ...u16(0)]);
    return new Blob([...qismlar, ...markaz, oxiri], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const xmlEsc = (s) => String(s == null ? "" : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function ustunHarfi(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // varaqlar: [{ nom, sarlavha: [...], qatorlar: [[...]], kenglik: [...] }] → Blob
  function xlsxYasa(varaqlar) {
    const varaqXml = (v) => {
      const hamma = [v.sarlavha, ...v.qatorlar];
      const cols = (v.kenglik || v.sarlavha.map(() => 18)).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
      const rows = hamma.map((q, r) => `<row r="${r + 1}">` + (q || []).map((c, i) => {
        const st = r === 0 ? ' s="1"' : "";
        if (typeof c === "number" && isFinite(c)) return `<c r="${ustunHarfi(i)}${r + 1}"${st}><v>${c}</v></c>`;
        const t = String(c == null ? "" : c);
        if (!t) return "";
        return `<c r="${ustunHarfi(i)}${r + 1}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`;
      }).join("") + "</row>").join("");
      const ox = `${ustunHarfi(Math.max(0, v.sarlavha.length - 1))}${hamma.length}`;
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData>${v.filtr === false ? "" : `<autoFilter ref="A1:${ox}"/>`}</worksheet>`;
    };
    const nomToza = (n) => String(n).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
    const fayllar = [
      { nom: "[Content_Types].xml", matn: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${varaqlar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { nom: "_rels/.rels", matn: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { nom: "xl/workbook.xml", matn: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${varaqlar.map((v, i) => `<sheet name="${xmlEsc(nomToza(v.nom))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { nom: "xl/_rels/workbook.xml.rels", matn: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${varaqlar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${varaqlar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { nom: "xl/styles.xml", matn: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf fontId="1" fillId="2" applyFont="1" applyFill="1" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      ...varaqlar.map((v, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, matn: varaqXml(v) })),
    ];
    return zipYasa(fayllar);
  }

  // To'liq Excel hisobot: Xulosa · Amallar · Turon dublikatlar · Tug'ilgan sana · Mos
  function excelHisobot(r) {
    const x = (r && r.xulosa) || {};
    const tuzat = tuzatOl();
    const noyob = (x.turonJami || 0) - (x.dublikat || 0);
    const varaqlar = [];
    varaqlar.push({
      nom: "Xulosa", filtr: false, kenglik: [52, 14, 90],
      sarlavha: ["Ko'rsatkich", "Soni", "Izoh / nima uchun"],
      qatorlar: [
        ["Turon faol o'quvchilar (ro'yxatda)", x.turonJami || 0, "Turon sahifasidan yig'ilgan qatorlar, faqat STATUS = «Faol»"],
        ["Turonda NOFAOL (olinmadi)", x.nofaol || 0, "STATUS ≠ «Faol» — «Nofaol (Turon)» varag'i; eMaktabda bo'lsa chiqariladi"],
        ["Turonda IKKI marta yozilgan (ortiqcha qator)", x.dublikat || 0, "To'liq ism + tug'ilgan sana bir xil — «Turon dublikatlar» varag'i; Turonda ortiqcha yozuvni o'chirish kerak"],
        ["Turon noyob o'quvchilar", noyob, "Turon − dublikat"],
        ["eMaktab o'quvchilar (solishtirish paytida)", x.emaktabJami || 0, "«Odamlarni izlash → O'quvchilar» (Arxiv kirmaydi)"],
        ["Farq: Turon noyob − eMaktab", noyob - (x.emaktabJami || 0), "Farq quyidagilardan yig'iladi: qo'shiladi − chiqariladi, shubhali va sinfi aniqlanmaganlar"],
        [],
        ["Mos (ikkalasida bor, sinfi to'g'ri)", x.mos || 0, "«Mos» varag'i"],
        ["Qo'shiladi (Turonda bor, eMaktabda yo'q)", x.qoshish || 0, "«Amallar» — QO'SHISH; eMaktabda «allaqachon mavjud» desa Arxivdan tiklanadi"],
        ["Ko'chiriladi (ikkalasida bor, sinfi boshqa)", x.kochirish || 0, "«Amallar» — KO'CHIRISH"],
        ["Chiqariladi (eMaktabda bor, Turonda yo'q)", x.chiqarish || 0, "«Amallar» — CHIQARISH"],
        ["Shubhali (qo'lda hal qilinadi)", x.shubhali || 0, "«Amallar» — SHUBHALI: ismi o'xshash boshqa bola yoki Turon dublikati (eMaktabda ikki yozuv)"],
        ["Sinfi ochilmagan / aniqlanmagan", x.sinfsiz || 0, "«Amallar» — SINF ANIQLANMADI"],
        [],
        ["Tug'ilgan sanasi tuzatib yozilgan (jami, hamma yurishlar)", tuzat.length, "«Tug'ilgan sana» varag'i — har qatorda sababi: yil xato terilgan / 1-sinfga yosh yetmaydi / eMaktabdagi sana boshqa"],
        ["Hozir bajarilmay qolgan: qo'shish / ko'chirish / chiqarish", r ? `${r.qoshish.length} / ${r.kochirish.length} / ${r.chiqarish.length}` : "—", "bajarilganlar ro'yxatdan chiqarilgan"],
        ["Solishtirish vaqti", x.vaqt || (r && r.vaqt) || "", ""],
        ["Hisobot vaqti", new Date().toISOString().slice(0, 16).replace("T", " "), `skript v${VERSIYA}`],
      ],
    });
    if (r) {
      const amallar = [];
      r.qoshish.forEach((q) => amallar.push(["QO'SHISH", q.t.fio, q.t.sinf, q.t.filial, q.t._emkSinf || q.t._sinfK, "", "", q.sabab || q.izoh || ""]));
      r.kochirish.forEach((q) => amallar.push(["KO'CHIRISH", q.t.fio, q.t.sinf, q.t.filial, q.t._emkSinf || q.t._sinfK, q.e.fio, q.e.sinf, q.sabab || ""]));
      r.chiqarish.forEach((q) => amallar.push(["CHIQARISH", "", "", "", "", q.e.fio, q.e.sinf, q.sabab || q.izoh || "Turon faol ro'yxatida yo'q"]));
      r.shubhali.forEach((q) => amallar.push(["SHUBHALI", q.t.fio, q.t.sinf, q.t.filial, q.t._emkSinf || q.t._sinfK, q.e.fio, q.e.sinf, q.izoh || "ismi o'xshash — qo'lda tekshiring"]));
      r.sinfsiz.forEach((q) => amallar.push(["SINF ANIQLANMADI", q.t.fio, q.t.sinf, q.t.filial, "", q.e ? q.e.fio : "", q.e ? q.e.sinf : "", q.sabab]));
      varaqlar.push({ nom: "Amallar", kenglik: [18, 40, 14, 12, 16, 40, 16, 70],
        sarlavha: ["Amal", "F.I.O (Turon)", "Turon sinf", "Filial", "eMaktab sinf (kerak)", "F.I.O (eMaktab)", "eMaktab sinf (hozir)", "Izoh / sabab"], qatorlar: amallar });
      varaqlar.push({ nom: "Turon dublikatlar", kenglik: [40, 14, 14, 14, 16, 16, 14, 16, 70],
        sarlavha: ["F.I.O", "Tashlangan qator: filial", "Sinf", "Tug'ilgan", "Kod", "Olingan qator: filial", "Sinf", "Kod", "Izoh"],
        qatorlar: (r.turonDublikat || []).map((q) => [q.t.fio, q.t.filial || "(filialsiz)", q.t.sinf, q.t.tugilgan, q.t.kod, q.asosiy.filial || "(filialsiz)", q.asosiy.sinf, q.asosiy.kod,
          (q.t.sinf !== q.asosiy.sinf || String(q.t.daraja || "") !== String(q.asosiy.daraja || "")) ? "Ikki qatorda SINF HAR XIL — qaysi sinf to'g'ri ekanini aniqlang; eMaktabda ham ikki yozuv bo'lishi mumkin" : "Bir xil qator ikki marta — Turonda ortiqchasini o'chiring"]) });
      varaqlar.push({ nom: "Nofaol (Turon)", kenglik: [40, 14, 14, 14, 16, 14, 30],
        sarlavha: ["F.I.O", "Filial", "Sinf", "Tug'ilgan", "Kod", "Turon status", "eMaktabda"],
        qatorlar: (r.turonNofaol || []).map((n) => [n.fio, n.filial, n.sinf, n.tugilgan, n.kod, n.status, n.emaktab || "yo'q / topilmadi"]) });
    }
    varaqlar.push({ nom: "Tug'ilgan sana", kenglik: [16, 40, 12, 14, 16, 14, 18, 70, 60],
      sarlavha: ["Vaqt", "F.I.O (Turon)", "Filial", "Turon sinf", "eMaktab sinf", "Turon sana", "eMaktabga yozilgan sana", "Nima uchun o'zgardi", "eMaktab havola"],
      qatorlar: tuzat.map((y) => [y.vaqt, y.fio, y.filial, y.sinf, y.emkSinf, y.asl, y.yangi, y.sabab, y.url || ""]) });
    if (r) {
      varaqlar.push({ nom: "Mos", kenglik: [40, 14, 12, 16, 40, 16],
        sarlavha: ["F.I.O (Turon)", "Turon sinf", "Filial", "eMaktab sinf", "F.I.O (eMaktab)", "eMaktab sinf"],
        qatorlar: r.mos.length ? r.mos.map((q) => [q.t.fio, q.t.sinf, q.t.filial, q.t._emkSinf, q.e.fio, q.e.sinf]) : [["(ro'yxat F5 dan keyin saqlanmaydi — «🔎» bilan yangidan solishtiring)", "", "", "", "", ""]] });
    }
    return xlsxYasa(varaqlar);
  }
  function excelYukla(r, izoh) {
    const nom = `turon-emaktab-hisobot_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.xlsx`;
    yuklab(nom, excelHisobot(r));
    log(`📊 Excel hisobot «${nom}» yuklandi${izoh ? " — " + izoh : ""}. Varaqlar: Xulosa · Amallar · Turon dublikatlar · Nofaol (Turon) · Tug'ilgan sana · Mos.`, "ok");
  }

  // ===================================================================
  //  6B-QISM. SINFLAR REJASI — Turon bo'yicha eMaktabda qaysi sinflar
  //  bo'lishi kerak, yetishmaganini yaratish (maktab talabi, 22.09.2026:
  //  «sinf bo'lmasa o'zi yaratsin, avval sinflarni solishtiraman, keyin
  //  o'quvchilarni»).
  //
  //  QOIDA:
  //   • Harfli Turon sinfi («4-A» + Qo'qon) → eMaktabda AYNAN «4 A Q»
  //     bo'lishi shart; yo'q bo'lsa shu nom bilan yaratiladi.
  //   • Yo'nalishli guruhlar («8-Ijtimoiy», «Aniq-1», «Tabiiy-2»…) sinf
  //     emas: filial + sinf raqami bo'yicha BOLALAR SANALADI va «sinf
  //     sig'imi» (panel, standart 35) ga bo'linadi — 100 bola ⇒ 3 sinf.
  //     Mavjud (va rejadagi harfli) sinflar ayiriladi, qolgani A, B, V, G,
  //     D, E, J… harflari bilan (bandlari tashlab) yaratiladi: «8 A Q»,
  //     «8 B Q», «8 V Q». Bolalarni sinflarga taqsimlashni keyin
  //     `taqqosla()` qiladi (eng kam o'quvchili sinfga).
  //   • Furqat — qo'shimchasiz («8 G»), boshqa filial — harf bilan.
  //  eMaktabdagi sinflar «Sinflar» sahifasidan (`emaktabSinflari`).
  // ===================================================================
  const HARF_TARTIBI = ["A", "B", "V", "G", "D", "E", "J", "Z", "I", "K", "L", "M", "N", "O", "P", "R", "S", "T", "U", "F", "X"];

  function sinfRejasi(turon, filiallar, qolda, sinflar, sigim) {
    const emk = new Map();
    sinflar.forEach((s) => { const k = classKey(s.nom); if (k && !emk.has(k)) emk.set(k, s.nom); });
    const boshqaHarflar = [...new Set([...filiallar.values()].filter(Boolean))].join("");
    const harfli = new Map();   // kalit → {kalit, nom, daraja, fHarf, harf, soni, filial}
    const guruh = new Map();    // `${daraja}|${fHarf}` → {daraja, fHarf, filial, soni, harfsiz, yonalish}
    const sabab = new Map();    // sabab → soni
    turon.forEach((t) => {
      const s = turonSinf(t, filiallar, qolda);
      if (s.sabab) { sabab.set(s.sabab, (sabab.get(s.sabab) || 0) + 1); return; }
      const fHarf = s.fHarf != null ? s.fHarf : (filiallar.get(normKey(t.filial)) || "");
      const daraja = s.daraja || Number((String(s.kalit || "").match(/^\d{1,2}/) || [0])[0]) || 0;
      if (!daraja) return;
      const gk = `${daraja}|${fHarf}`;
      if (!guruh.has(gk)) guruh.set(gk, { daraja, fHarf, filial: t.filial || "Furqat", soni: 0, harfsiz: 0, yonalish: new Set() });
      const g = guruh.get(gk); g.soni++;
      if (s.kalit) {
        if (!harfli.has(s.kalit)) {
          const m = String(s.kalit).match(/^(\d{1,2})([a-z]{1,2}?)([a-z])?$/);
          const harf = s.korinish ? s.korinish.split(" ")[1] : (m ? m[2].toUpperCase() : "");
          harfli.set(s.kalit, { kalit: s.kalit, nom: s.korinish || s.kalit.toUpperCase(), daraja, fHarf, harf, soni: 0, filial: t.filial || "Furqat" });
        }
        harfli.get(s.kalit).soni++;
      } else { g.harfsiz++; g.yonalish.add(t.sinf); }
    });

    const yaratish = [];   // {nom, daraja, harf, fHarf, izoh}
    harfli.forEach((h) => {
      if (emk.has(h.kalit) || !h.harf) return;
      yaratish.push({ nom: h.nom, daraja: h.daraja, harf: h.harf, fHarf: h.fHarf, izoh: `${h.filial} ${h.daraja}-${h.harf}: ${h.soni} o'quvchi — harfli sinf, eMaktabda yo'q` });
    });
    const guruhHisobi = [];
    guruh.forEach((g) => {
      const naqsh = g.fHarf ? new RegExp(`^${g.daraja}[a-z]{1,2}${g.fHarf}$`) : new RegExp(`^${g.daraja}[a-z]{1,2}$`);
      const istisno = (!g.fHarf && boshqaHarflar) ? new RegExp(`^${g.daraja}[a-z][${boshqaHarflar}]$`) : null;
      const mavjud = [...emk.keys()].filter((k) => naqsh.test(k) && !(istisno && istisno.test(k)));
      const rejada = yaratish.filter((y) => y.daraja === g.daraja && y.fHarf === g.fHarf).map((y) => classKey(y.nom));
      const bor = new Set([...mavjud, ...rejada]);
      const kerak = Math.max(1, Math.ceil(g.soni / sigim));
      // Faqat yo'nalishli (harfsiz) bolalar bo'lsa qo'shimcha sinf ochiladi;
      // hammasi harfli sinfda bo'lsa — harfli sinflar yetadi.
      let qoshimcha = g.harfsiz > 0 ? kerak - bor.size : 0;
      const band = new Set([...bor].map((k) => k.replace(/^\d+/, "").replace(new RegExp(`${g.fHarf}$`), "").toUpperCase()));
      const yangi = [];
      for (const H of HARF_TARTIBI) {
        if (qoshimcha <= 0) break;
        if (band.has(H)) continue;
        band.add(H);
        const nom = `${g.daraja} ${H}${g.fHarf ? " " + g.fHarf.toUpperCase() : ""}`;
        yangi.push(nom);
        yaratish.push({ nom, daraja: g.daraja, harf: H, fHarf: g.fHarf, izoh: `${g.filial} ${g.daraja}-sinf: ${g.soni} o'quvchi (${g.harfsiz} tasi yo'nalishli: ${[...g.yonalish].slice(0, 5).join(", ")}), sig'im ${sigim} ⇒ ${kerak} sinf kerak, bor ${bor.size}` });
        qoshimcha--;
      }
      guruhHisobi.push({ ...g, mavjud: mavjud.map((k) => emk.get(k)), kerak, yangi });
    });
    yaratish.sort((a, b) => a.daraja - b.daraja || (a.fHarf || "").localeCompare(b.fHarf || "") || a.harf.localeCompare(b.harf));
    guruhHisobi.sort((a, b) => a.daraja - b.daraja || a.fHarf.localeCompare(b.fHarf));
    return { yaratish, guruhHisobi, sabab };
  }

  // «Sinflar» boshqaruv sahifasi: /v2/admin/class/default?school=… — «+»
  //  tugmasi yaratish formasiga olib boradi. Manzil sahifadan olinadi,
  //  topilmasa /v2/admin/class/new taxmin qilinadi.
  async function sinfYaratishFormasi() {
    const { doc } = await sahifa(`/v2/admin/class/default?school=${enc(schoolId)}`);
    const a = [...doc.querySelectorAll("a[href]")].find((x) => {
      const h = x.getAttribute("href") || "";
      return /class\/(new|create|add|edit\?)/i.test(h) || (/class/i.test(h) && /yarat|qo.?sh|create|add|new|dobav|sozda/i.test((x.getAttribute("title") || "") + " " + txt(x) + " " + (x.className || "")));
    });
    const u = a ? new URL(a.getAttribute("href"), location.origin).href : `${location.origin}/v2/admin/class/new?school=${enc(schoolId)}`;
    const p = await sahifa(u);
    return { doc: p.doc, url: p.url, form: formaTanla(p.doc), havola: a ? a.getAttribute("href") : "(taxmin) /v2/admin/class/new" };
  }

  // ⚠️ «YANGI SINFNI YARATISH» FORMASI (22.09.2026 da SINOVda o'qildi):
  //  /v2/admin/class/new?school=…  — maydonlar:
  //   name:text            Sinf kodi («1-a», «10-b»; bizda «1 A O»)
  //   nameFull:text        Nomi (ixtiyoriy, «Fizika va matematika») — BO'SH
  //   studyform:select     Smena: -tanlang- / Birinchi / Ikkinchi / Uchinchi
  //   maxStudentCount:text Maksimal to'ldirish — bo'sh
  //   gkind:select         Sinf turi: Umumiy ta'lim / Korreksiyali / Boshqa
  //   educationLanguage    O'zbek tili (standart) — tegilmaydi
  //   parallel:select      0…12 — sinf raqami
  //   isfinal:checkbox     Bitiruvchi sinf — belgilanmaydi
  //   year:select          2026 (=2026/2027)
  //   period:select        Hisobot davri — MAJBURIY: «2026-2027 hisobot» /
  //                        «Standart choraklar (avtomatik yaratish)»
  //   table:select         Qo'ng'iroqlar jadvali: 2-smena / asosiy jadval
  //   firstLessonNumber    radio 0 (nol darsni qo'shish) / 1 (chiqarish)
  //   espSubjects:multi    «Sinf fanlarni tanlovga ko'ra o'rganmaydi»
  //   description, teacher, teachermembershipdatestart, psychologist — bo'sh
  //   save:submit, __RequestVerificationToken
  //  Nom bo'yicha to'ldiriladi; nom boshqacha bo'lsa (kundalik.com) yorliq
  //  bo'yicha zaxira taniladi. Muvaffaqiyat — «Sinflar» ro'yxatida paydo bo'lishi.
  async function sinfYarat(y, opt) {
    const { doc, url, form, havola } = await sinfYaratishFormasi();
    if (!form) return { ok: false, sabab: "sinf yaratish formasi topilmadi", izoh: [`havola: ${havola}`, sahifaTashxisi(doc, url)] };
    const q = new Map();
    const izoh = [`forma: ${url}`];
    const d = new Date(); const yil = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    const yetishmadi = [];
    const birinchiBosh = (sel) => variantTanla(sel, (tx, val) => !!val && !/^\s*-/.test(tx));
    const tanla = (sel, re, zaxira) => {
      const v = variantTanla(sel, (tx, val) => !!val && re.test(tx));
      return v != null ? v : (zaxira ? birinchiBosh(sel) : null);
    };
    const yoz = (el, v, nom) => { q.set(el, v); izoh.push(`${el.getAttribute("name")} [${nom}] → ${el.tagName === "SELECT" ? `${v} (${txt([...el.options].find((o) => o.value === v))})` : v}`); };
    let nomYozildi = false;

    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
      const n = el.getAttribute("name") || "";
      const k = maydonYorligi(el, form);
      const t = String(el.getAttribute("type") || (el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button") return;
      const nk = n.toLowerCase();

      if (t === "radio") {
        // Darslarni raqamlash: «1» — nol dars raqamlarini jadvaldan chiqarish
        if (nk === "firstlessonnumber" || /nol\s*dars|firstlesson/.test(k)) { if (el.value === "1") yoz(el, "1", "darslarni raqamlash"); }
        return;
      }
      if (t === "checkbox") return;   // isfinal — belgilanmaydi

      if (el.tagName === "SELECT") {
        if (nk === "parallel" || /(parallel|sinfraqami|daraja)/.test(k)) {
          const v = variantTanla(el, (tx, val) => val !== "" && tx.trim() === String(y.daraja));
          if (v != null) yoz(el, v, "parallel"); else yetishmadi.push(`${n}: «${y.daraja}» varianti yo'q (${[...el.options].map(txt).slice(0, 14).join("/")})`);
        } else if (nk === "year" || /(studyyear|oquvyil|schoolyear)/.test(k)) {
          const v = variantTanla(el, (tx) => tx.includes(`${yil}/${yil + 1}`) || tx.includes(`${yil}-${yil + 1}`));
          if (v != null) yoz(el, v, "o'quv yili"); else yetishmadi.push(`${n}: ${yil}/${yil + 1} yo'q`);
        } else if (nk === "studyform" || /smena|shift|смен/.test(k)) {
          const v = tanla(el, /birinchi|first|перв|^1/i, true); if (v != null) yoz(el, v, "smena");
        } else if (nk === "gkind" || /sinfturi|classtype|видкласс/.test(k)) {
          const v = tanla(el, /umumiy|general|общеобраз/i, true); if (v != null) yoz(el, v, "sinf turi");
        } else if (nk === "period" || /hisobotdavri|reportperiod|отчетн/.test(k)) {
          // MAJBURIY: mavjud «2026-2027 hisobot», bo'lmasa standart choraklar (avtomatik)
          const v = tanla(el, new RegExp(`${yil}\\s*[-/–]\\s*${yil + 1}`), false) ?? tanla(el, /standart|стандарт|avtomatik|автосозд/i, true);
          if (v != null) yoz(el, v, "hisobot davri"); else yetishmadi.push(`${n}: hisobot davri varianti yo'q — eMaktabda «Hisobot davrini yarating»`);
        } else if (nk === "table" || /qongiroq|bell|звонк/.test(k)) {
          const v = tanla(el, /asosiy|основн|main/i, true); if (v != null) yoz(el, v, "qo'ng'iroqlar jadvali");
        } else if (nk === "espsubjects" || /tanlov|elective|выбор/.test(k)) {
          // ⚠️ MAJBURIY (server: «Sinf uchun Tanlovga ko'ra fanlarni ko'rsating»).
          //  Variant matni «o‘rganmaydi» — apostrof bilan, shuning uchun
          //  normKey orqali solishtiriladi. Qiymati bo'sh bo'lsa ham
          //  aynan shu variant yuboriladi.
          const opt0 = [...el.options].find((o) => /organmaydi|neizucha|doesnot/.test(normKey(txt(o))));
          if (opt0) { q.set(el, opt0.value); izoh.push(`${n} [tanlov fanlari] → ${opt0.value || "(bo'sh qiymat)"} (${txt(opt0)})`); }
          else yetishmadi.push(`${n}: «tanlovga ko'ra o'rganmaydi» varianti yo'q (${[...el.options].map(txt).slice(0, 6).join(" / ")})`);
        } else if (nk === "educationlanguage" || /(til|language|язык)/.test(k)) {
          izoh.push(`${n} [ta'lim tili] → (sahifa bergani: ${txt(el.options[el.selectedIndex] || el.options[0])})`);
        }
        // teacher / psychologist — bo'sh qoladi
        return;
      }
      // matn maydonlari
      if (nk === "name" || (!nomYozildi && /(sinfkodi|classcode|litera|harf|letter|^kod)/.test(k))) { yoz(el, y.nom, "sinf kodi"); nomYozildi = true; }
      // nameFull, maxStudentCount, description, teachermembershipdatestart — bo'sh
    });
    if (!nomYozildi) yetishmadi.push("sinf kodi (name) maydoni topilmadi");
    if (yetishmadi.length) return { ok: false, sabab: yetishmadi.join("; "), izoh: [...izoh, formaMaydonlari(form)] };
    if (opt.sinov) { izoh.push("SINOV — yuborilmadi"); return { ok: true, sinov: true, izoh }; }

    // ⚠️ «Hisobot davri belgilanmagan.» — forma sahifasida DOIM turadigan
    //  qizil yozuv (select bo'sh bo'lganda ko'rinadi), server xatosi emas.
    //  Shuning uchun javob matniga emas, «Sinflar» ro'yxatiga qarab hukm
    //  qilinadi: sinf paydo bo'lgan — muvaffaqiyat.
    //  ⚠️ Saqlangach server boshqa manzilga yo'naltiradi va fetch «Failed to
    //  fetch» bilan yiqiladi (22.09.2026: sinf yaratilgan, xato chiqqan).
    //  Shuning uchun yuborish xatosi yutiladi, hukm — ro'yxatdan.
    let j = null;
    try { j = await formaYubor(form, url, formaYig(form, q)); }
    catch (err) { if (err.message === TOXTATILDI) throw err; izoh.push(`yuborish javobi o'qilmadi (${err.message}) — ro'yxatdan tekshiriladi`); }
    await sleep(400);
    const sinflar = await emaktabSinflari();
    const bor = sinflar.find((s) => classKey(s.nom) === classKey(y.nom));
    if (bor) { izoh.push(`✔ yaratildi: ${bor.nom} (ID ${bor.id})`); return { ok: true, izoh, id: bor.id }; }
    if (!j) return { ok: false, sabab: "yuborish javobi o'qilmadi va sinf ro'yxatda ko'rinmadi — sessiyani tekshiring (F5)", izoh };
    // Rad etildi — serverning javobi batafsil: manzil, sarlavha, forma
    //  qaytdimi, qaysi maydon qaysi qiymat bilan qaytdi, xato matnlari.
    const qaytganForma = formaTanla(j.doc);
    const qiymatlar = qaytganForma ? [...qaytganForma.querySelectorAll("input[name], select[name]")]
      .filter((el) => !/token/i.test(el.getAttribute("name")))
      .map((el) => `${el.getAttribute("name")}=${el.tagName === "SELECT" ? (el.value || "(bo'sh)") : (el.type === "radio" || el.type === "checkbox" ? (el.checked ? el.value : "-") : (el.value || "(bo'sh)"))}`).join(", ") : "forma qaytmadi";
    const xabar = xatoMatni(j.doc);
    return {
      ok: false,
      sabab: `Sinflar ro'yxatida paydo bo'lmadi (HTTP ${j.holat})` + (xabar ? ": " + cut(xabar, 250) : ""),
      izoh: [...izoh, `javob: ${j.url} · sarlavha: ${txt(j.doc.querySelector("title"))} | h1: ${txt(j.doc.querySelector("h1, h2"))}`, `qaytgan forma qiymatlari: ${cut(qiymatlar, 900)}`],
    };
  }

  // ===================================================================
  //  7-QISM. AMALLAR — eMaktab formalari orqali
  //
  //  eMaktab (dnevnik.ru dvigateli) — klassik ASP.NET MVC: har amal
  //  oddiy HTML forma bilan yuboriladi. Shuning uchun:
  //    1) forma sahifasi `fetch` bilan olinadi,
  //    2) maydonlar NOMI/YORLIG'I bo'yicha taniladi va to'ldiriladi,
  //    3) forma o'z `action` iga yuboriladi,
  //    4) javobdagi validation xatolari jurnalga chiqadi.
  //
  //  ⚠️ MAYDON NOMLARI TAXMIN. SINOV rejimi «maydon → qiymat» ro'yxatini
  //  ko'rsatadi — birinchi marta shuni tekshirmasdan haqiqiy yurishni
  //  boshlamang. Tanilmagan MAJBURIY maydon bo'lsa amal to'xtaydi.
  // ===================================================================
  function maydonYorligi(el, form) {
    const parts = [el.getAttribute("name") || "", el.id || "", el.getAttribute("placeholder") || ""];
    if (el.id) { const l = form.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(txt(l)); }
    const l2 = el.closest("label"); if (l2) parts.push(txt(l2));
    const tr = el.closest("tr, .field, .form-group, div");
    if (tr) { const th = tr.querySelector("th, label, .label"); if (th) parts.push(txt(th)); }
    return normKey(parts.join(" "));
  }

  // Maydon turini nomi/yorlig'i bo'yicha aniqlash
  // ⚠️ `k` normKey'dan o'tgan: kichik harf, bo'shliqsiz, KIRILL LOTINGA
  //  o'girilgan («Фамилия» → "familiya", «Имя» → "imya", «Класс» → "klass").
  // ⚠️ eMAKTAB «SHAXSNI YARATISH» 2-BOSQICH MAYDONLARI (21.09.2026 da o'qildi):
  //  who:radio×3 (xodim / o'quvchi / ota-ona), studyYear:select, group:select
  //  (BO'SH keladi — sahifada JS to'ldiradi, biz ID bilan yuboramiz),
  //  membershipdatestartclass0, membershipdatestartschool, eduOrderNumber,
  //  eduorderdatebox, eduOrderType:select, nlast, nfirst, nmiddle, birthday,
  //  sex:radio (male/female), pinfl, personalNumber, actaddr, email,
  //  wphone/mphone/hphone, save2:submit, setSkipCreatingByPinfl:submit,
  //  parentStudyYear/parentGroup/parentStudent (ota-ona bo'limi — TEGILMAYDI).
  function maydonTuri(k) {
    if (/token/.test(k)) return "token";
    if (/^parent/.test(k)) return "";                 // ota-ona bo'limi — bizniki emas
    // ⚠️ Buyruq raqami (`eduOrderNumber`) — server MAJBURIY deb rad etdi
    //  («Buyruqning raqamini ko‘rsating», 22.09.2026). Ilgari bu maydon
    //  tanilmay (tur "") tashlab ketilardi. Yorlig'ida «sanadan» so'zi ham
    //  bo'lgani uchun «sana» qoidasidan OLDIN turishi shart.
    if (/(ordernumber|buyruqraqam|buyruqningraqam|nomerprikaz)/.test(k)) return "raqam";
    if (/(lastname|surname|familiya|familya|famil)/.test(k)) return "familiya";
    if (/(middlename|patronymic|sharif|otasiningismi|otchestv)/.test(k)) return "sharif";
    if (/(firstname|ism|imya|name)/.test(k) && !/(class|group|school|user|login|last|middle|sur|nick)/.test(k)) return "ism";
    if (/(birth|tugilgan|rojd|rozhd)/.test(k)) return "tugilgan";
    // Qabul sanasi — «Maktabga qabul qilingan sana» / «Дата зачисления» /
    // «Enrollment date». Sinxronda BUGUNGI SANA yoziladi.
    if (/(qabul|admission|enrol|zachisl|kirgan|kelgan|entrydate|entry|startdate|datestart|membershipdate|datefrom|since)/.test(k)) return "qabul";
    if (/(sex|gender|jins)/.test(k) || k === "pol") return "jins";
    if (/(studyyear|oquvyil|uchebn|schoolyear)/.test(k)) return "yil";
    if (/(ordertype|buyruqtur|prikaz)/.test(k)) return "buyruq";
    if (/(class|group|sinf|klass)/.test(k) && !/(school|type)/.test(k)) return "sinf";
    if (/(^who|role|toifa|lavozim|persontype|usertype)/.test(k) || k === "rol") return "rol";
    if (/(phone|telefon|mobile)/.test(k)) return "telefon";
    // Boshqa sana maydoni (tug'ilgan emas) — bo'sh bo'lsa bugungi sana yoziladi
    if (/(date|sana|data)/.test(k)) return "sana";
    return "";
  }

  // ⚠️ QABUL SANASI = BUGUNGI SANA (maktab talabi, 08.10.2026; ilgari
  //  21.09.2026 dan oy boshi edi). Qo'shish/ko'chirish formalaridagi qabul
  //  sanasi, buyruq sanasi va bo'sh sana maydonlariga aynan shu yoziladi —
  //  o'quvchi qo'shilgan kunidan jurnalga tushsin. Chiqarish ham bugun.
  function qabulSanasi() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }

  // ⚠️ TUG'ILGAN SANA OLDINDAN TEKSHIRILADI (22.09.2026: 6 bola rad etildi).
  //  eMaktab qoidasi: «31 dekabr sanasida 2026 o'quvchi 7 yoshga to'lmagan
  //  hisoblanadi va 1-sinfga qabul qilinmaydi (O'RQ "Ta'lim to'g'risidagi"
  //  9-modda)» va «Tug'ilgan sanasi noto'g'ri» (kelajak sana). Turonda
  //  tug'ilgan sana 2026 (xato kiritilgan) yoki 2020-yil kuzi (1-sinf uchun
  //  yosh yetmaydi) bo'lgan bolalar serverga yuborilmaydi — sabab bilan
  //  o'tkazib yuboriladi, Excel hisobotda chiqadi; Turonda to'g'rilangach
  //  (yangi ro'yxat) yana urinadi. Qaytadi: sabab matni yoki "".
  //
  // ⚠️ 0.9.0 — SANA AVTOMATIK TUZATILADI (maktab talabi, 26.09.2026: «Turon
  //  bazasida bor bola eMaktabda bo'lsin, tug'ilgan sanasi mos bo'lmasa
  //  to'g'irlab, to'g'irlangan bolalar ro'yxati hisobot shaklida olinsin»).
  //  12 bola shu sabab qo'shilmay qolgan edi (20.10.2026, 16.11.2029,
  //  24.12.2025 — yil xato terilgan; 26.09.2020 — 1-sinfga yosh yetmaydi).
  //  Qoida: kun.oy Turondan qoladi, YIL sinfdan hisoblanadi —
  //  yil = o'quv yili − 6 − sinf (1-sinf → 7 yosh, 4-sinf → 10 yosh).
  //  Sana umuman bo'lmasa 01.01.<yil>. Tuzatilgan bola `TUZATILDI`
  //  hisobotiga tushadi (asl sana, yozilgan sana, sabab) — keyin Turonda va
  //  eMaktabda hujjat bo'yicha to'g'rilash uchun. Sinf raqami noma'lum bo'lsa
  //  tuzatib bo'lmaydi — eski usulda sabab bilan o'tkazib yuboriladi.
  //  Qaytadi: { ok } | { tuzat: { asl, yangi, sabab } } | { sabab }.
  function tugilganTekshir(t) {
    const asl = String(t._tugilganAsl != null ? t._tugilganAsl : (t.tugilgan || "")).trim();
    const s = sanaNorm(asl);
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    const d = new Date();
    const oquvYili = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    const daraja = Number((String(t._sinfK || "").match(/^\d{1,2}/) || [0])[0]) || 0;
    const hisobYil = daraja ? oquvYili - 6 - daraja : 0;
    if (!m) {
      if (!hisobYil) return asl ? { sabab: `tug'ilgan sana tushunarsiz «${asl}» va sinf raqami noma'lum — Turonda to'g'rilang` } : { ok: true };
      return { tuzat: { asl: asl || "(bo'sh)", yangi: `01.01.${hisobYil}`, sabab: asl ? `sana tushunarsiz «${asl}»` : "Turonda sana yo'q" } };
    }
    const yil = Number(m[3]);
    if (yil >= d.getFullYear() - 2) {
      if (!hisobYil) return { sabab: `tug'ilgan sana ${s} — bola ${d.getFullYear() - yil} yoshda bo'lolmaydi, sinf raqami noma'lum — Turonda to'g'rilang` };
      return { tuzat: { asl: s, yangi: `${m[1]}.${m[2]}.${hisobYil}`, sabab: `yil xato (${yil}) — bola ${d.getFullYear() - yil} yoshda bo'lolmaydi` } };
    }
    if (daraja === 1 && oquvYili - yil < 7) {
      return { tuzat: { asl: s, yangi: `${m[1]}.${m[2]}.${oquvYili - 7}`, sabab: `31.12.${oquvYili} da 7 yoshga to'lmaydi — eMaktab 1-sinfga qabul qilmaydi` } };
    }
    return { ok: true };
  }
  // Tuzatib bo'lmaydigan sabab (eski nom, chaqiruvchilar uchun) yoki ""
  function tugilganMuammosi(t) { const r = tugilganTekshir(t); return r.sabab || ""; }
  // Tuzatishni bolaga qo'llash: asl sana `_tugilganAsl` da qoladi (hisobot uchun)
  function tugilganniTuzat(t, tz) {
    if (t._tugilganAsl == null) t._tugilganAsl = t.tugilgan || "";
    t.tugilgan = tz.yangi; t._tuzatSabab = tz.sabab;
  }

  // TUZATILDI hisoboti — localStorage'da to'planadi, «📊 Excel hisobot»ning
  //  «Tug'ilgan sana» varag'iga tushadi; yurish oxirida Excel o'zi yuklanadi.
  const LS_TUZAT = "sj_oq_tuzatilgan_v1";
  function tuzatOl() { try { return JSON.parse(lsOl(LS_TUZAT, "[]")) || []; } catch { return []; } }
  function tuzatYoz(y) {
    const r = tuzatOl();
    r.push({ vaqt: new Date().toISOString().slice(0, 16).replace("T", " "), ...y });
    lsYoz(LS_TUZAT, JSON.stringify(r.slice(-3000)));
  }

  // Sana qiymatini maydon turiga moslash: `<input type="date">` faqat
  // yyyy-mm-dd qabul qiladi, matn maydoni esa dd.mm.yyyy.
  function sanaMaydonga(el, ddmmyyyy) {
    const s = sanaNorm(ddmmyyyy);
    if (String(el.getAttribute("type") || "").toLowerCase() === "date") {
      const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
    }
    return s;
  }

  // Sahifadagi «ish» formasi: ko'rinadigan maydoni (matn, ro'yxat, radio,
  // sana…) eng ko'pi. Faqat yashirin/submit maydonli formalar (qidiruv,
  // chiqish) hisobga olinmaydi.
  const KORINADIGAN = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), select, textarea";
  function formaTanla(doc) {
    const formalar = [...doc.querySelectorAll("form")].filter((f) => f.querySelector(KORINADIGAN));
    formalar.sort((a, b) => b.querySelectorAll(KORINADIGAN).length - a.querySelectorAll(KORINADIGAN).length);
    return formalar[0] || null;
  }

  // Sahifa tashxisi (forma topilmaganda): sarlavha, formalar, maydonlar,
  // havolalar — jurnalga; HTML'ning o'zi faylga.
  function sahifaTashxisi(doc, url) {
    const formalar = [...doc.querySelectorAll("form")].map((f, i) =>
      `#${i} action=${f.getAttribute("action") || "-"} method=${f.getAttribute("method") || "-"} [`
      + [...f.querySelectorAll("input, select, textarea, button")].map((e) => `${e.getAttribute("name") || e.id || "?"}:${e.type || e.tagName.toLowerCase()}`).join(",") + "]");
    const maydonlar = [...doc.querySelectorAll("input, select, textarea")].filter((e) => !e.closest("form"))
      .map((e) => `${e.getAttribute("name") || e.id || "?"}:${e.type || e.tagName.toLowerCase()}`);
    // Sayt menyusi (har sahifada bir xil) tashxisni to'ldirib yuboradi — chiqarib tashlanadi
    const menyuRe = /localization|emaktab\.uz\/(v2\/user|v2\/soc|communities|ad\/|methodological|school-payments|about|news|contacts|teachers)|help\.emaktab|login\.emaktab|facebook|\/v2\/(school|myclasses|reports|journals|schedules|homework)(\?|\/|$)|admin\/default|persons\/default/i;
    const havolalar = [...doc.querySelectorAll("a[href]")]
      .filter((a) => !menyuRe.test(a.getAttribute("href")))
      .map((a) => `${txt(a)} → ${a.getAttribute("href")}`).filter((x) => x.length > 4).slice(0, 40);
    // ⚠️ JS OYNALI AMALLAR: eMaktabda ko'p amal (sinfga o'tkazish, chiqarish)
    //  havola emas, `onclick` bilan ochiladigan AjaxPages oynasi. Shuning
    //  uchun onclick'li elementlar va sahifadagi «AjaxPages/…» manzillari
    //  ham chiqariladi — aynan shulardan endpoint topiladi.
    const onclicklar = [...doc.querySelectorAll("[onclick]")]
      .map((e) => `${txt(e) || e.getAttribute("title") || e.tagName.toLowerCase()} ⇒ ${cut(e.getAttribute("onclick"), 220)}`).slice(0, 25);
    const ajax = new Set();
    (doc.documentElement.innerHTML.match(/AjaxPages\/[A-Za-z0-9_]+(\?[^"'\s<)]*)?/g) || []).forEach((u) => { if (ajax.size < 30) ajax.add(u); });
    return [
      `sahifa: ${url}`,
      `sarlavha: ${txt(doc.querySelector("title"))} | h1: ${txt(doc.querySelector("h1, h2"))}`,
      `formalar (${formalar.length}): ${formalar.join(" ; ") || "yo'q"}`,
      `formadan tashqari maydonlar: ${maydonlar.join(", ") || "yo'q"}`,
      `onclick elementlari (${onclicklar.length}): ${onclicklar.join(" | ") || "yo'q"}`,
      `AjaxPages manzillari: ${[...ajax].join(" | ") || "yo'q"}`,
      `havolalar: ${havolalar.join(" | ")}`,
    ].join("\n   ");
  }

  // Formadagi hamma maydonni (yashirin token bilan) URLSearchParams ga yig'ish.
  // `qiymatlar` — {el → qiymat} almashtirish.
  // `tugmaNomi` — aynan shu submit tugmasi «bosilsin» (masalan
  //  `setSkipCreatingByPinfl`); berilmasa save/saqlash tanlanadi.
  function formaYig(form, qiymatlar, tugmaNomi) {
    const fd = new URLSearchParams();
    // Biz tanlagan radio guruhida sahifaning o'z «checked» belgisi yuborilmasin
    const radioNomlari = new Set();
    qiymatlar.forEach((_, el) => { if (String(el.getAttribute("type") || "").toLowerCase() === "radio") radioNomlari.add(el.getAttribute("name")); });
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const n = el.getAttribute("name");
      if (!n) return;
      const t = String(el.getAttribute("type") || "").toLowerCase();
      if (t === "submit" || t === "button" || t === "image" || t === "file") return;
      if (qiymatlar.has(el)) { fd.append(n, qiymatlar.get(el)); return; }
      if (t === "radio" && radioNomlari.has(n)) return;
      if (t === "checkbox" || t === "radio") {
        if (el.hasAttribute("checked")) fd.append(n, el.getAttribute("value") || "on");
        return;
      }
      fd.append(n, el.value || "");
    });
    // ⚠️ YUBORISH TUGMASI — ASOSIYSI. Formada bir nechta submit bo'ladi:
    //  `setSkipCreatingByPinfl` (PINFLsiz davom etish), `back`, `save2`
    //  (saqlash). Birinchisini olsak noto'g'ri tugma «bosiladi». Shuning
    //  uchun save/saqlash/yaratish nomlisi tanlanadi, skip/back/cancel
    //  chetlab o'tiladi.
    const tugmalar = [...form.querySelectorAll('input[type="submit"][name], button[type="submit"][name], button[name]:not([type])')];
    const yubor = (tugmaNomi && tugmalar.find((b) => b.getAttribute("name") === tugmaNomi))
      || tugmalar.find((b) => /^save\d*$|saqla|yarat|create|submit|^ok$/i.test(b.getAttribute("name")))
      || tugmalar.find((b) => !/skip|back|cancel|bekor|delete|ochir/i.test(b.getAttribute("name")))
      || tugmalar[0];
    if (yubor) fd.append(yubor.getAttribute("name"), yubor.getAttribute("value") || txt(yubor) || "");
    return fd;
  }

  async function formaYubor(form, sahifaUrl, fd) {
    toxtashniTekshir();
    const action = form.getAttribute("action");
    const post = (!action || action === "#") ? sahifaUrl : new URL(action, location.origin).href;
    const get = String(form.getAttribute("method") || "post").toLowerCase() === "get";
    const r = get
      ? await fetch(post + (post.includes("?") ? "&" : "?") + fd.toString(), { credentials: "same-origin", __sj: 1 })
      : await fetch(post, {
        method: "POST", credentials: "same-origin", __sj: 1,
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: fd.toString(),
      });
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const xato = [...doc.querySelectorAll(".validation-summary-errors, .field-validation-error, .error, .alert-danger, .errorMessage")]
      .map(txt).filter(Boolean).join("; ");
    return { ok: r.ok && !xato, holat: r.status, url: r.url, xato, doc };
  }

  // Ro'yxatdan (select) variant tanlash
  function variantTanla(sel, sinov) {
    const opts = [...sel.options].map((o) => ({ v: o.value, t: txt(o) }));
    const f = opts.find((o) => sinov(o.t, o.v));
    return f ? f.v : null;
  }

  // Buyruq turi ro'yxatidan AYNAN «Boshqa buyruq» — «Boshqa ta'lim shakliga
  //  o'tkazish» (310) ham «boshqa» bilan boshlanadi, shuning uchun to'liq
  //  nom bo'yicha. Topilmasa null — chaqiruvchi amalni to'xtatadi.
  function boshqaBuyruq(sel) {
    const aniq = variantTanla(sel, (tx, val) => val && /^(boshqabuyruq|otherorder|drugoyprikaz|prochee|prochiy)$/.test(normKey(tx)));
    if (aniq != null) return aniq;
    return variantTanla(sel, (tx, val) => val && /^boshqa\s*buyruq\s*$|^other\s*$|^прочее\s*$|^другой приказ\s*$/i.test(tx.trim()));
  }

  // Jins mosligi. ⚠️ «female» ichida «male» bor — qiz belgisi avval tekshiriladi.
  function jinsMos(turon, variant) {
    const qizmi = /qiz|ayol|female|jen/.test(normKey(turon));
    const v = normKey(variant);
    const qiz = /qiz|ayol|female|jen/.test(v);
    return qizmi ? qiz : (!qiz && /ogil|erkak|male|muj|man/.test(v));
  }

  // F.I.O → familiya / ism / sharif
  function fioBol(fio) {
    const w = String(fio).replace(/\s+/g, " ").trim().split(" ");
    return { familiya: w[0] || "", ism: w[1] || "", sharif: w.slice(2).join(" ") };
  }

  // Sanani eMaktab kutgan shaklga (dd.mm.yyyy) keltirish
  function sanaNorm(s) {
    const m1 = String(s).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m1) return `${m1[1].padStart(2, "0")}.${m1[2].padStart(2, "0")}.${m1[3]}`;
    const m2 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return `${m2[3]}.${m2[2]}.${m2[1]}`;
    return String(s || "");
  }

  // «Shaxsni yaratish» havolasi — sahifadan olinadi
  function yaratishUrl() {
    const a = [...document.querySelectorAll("a[href]")].find((x) => /shaxsni yaratish|создать|create|yaratish/i.test(txt(x)));
    return a ? a.href : `/v2/admin/persons/create?school=${enc(schoolId)}`;
  }

  // ——— Formani to'ldirish (yaratish va tahrirlash uchun umumiy) ———
  function formaToldir(form, t, sinfNomi, opt) {
    const qiymatlar = new Map();
    const izoh = [];
    const yetishmadi = [];
    const f = fioBol(t.fio);
    // ⚠️ JINS ISMGA ZID BO'LSA — ISM USTUN. Turonda «… qizi» bolaga «O'g'il»
    //  yozilgan holat uchradi (21.09.2026). «qizi»/«o'g'li» qo'shimchasi
    //  jinsni aniq aytadi; Turon bilan zid kelsa ism bo'yicha olinadi va
    //  jurnalga ogohlantirish yoziladi — Turonni to'g'rilash uchun.
    const nomJins = /qizi$/i.test(t.fio) ? "Qiz" : (/(o.?g.?li|ugli)$/i.test(t.fio) ? "O'g'il" : "");
    if (nomJins && t.jins && jinsMos(nomJins, "qiz") !== jinsMos(t.jins, "qiz")) {
      izoh.push(`⚠ Turonda jins «${t.jins}», ism esa «${nomJins}» deydi — ism bo'yicha olindi, Turonni tekshiring`);
      t = { ...t, jins: nomJins };
    } else if (nomJins && !t.jins) t = { ...t, jins: nomJins };
    const els = [...form.querySelectorAll("input, select, textarea")].filter((el) => el.getAttribute("name"));
    const bor = new Set();

    els.forEach((el) => {
      const tur = maydonTuri(maydonYorligi(el, form));
      if (!tur || tur === "token") return;
      const nomi = el.getAttribute("name");
      const type = String(el.getAttribute("type") || "").toLowerCase();
      let v = null;
      if (el.tagName === "SELECT") {
        if (tur === "sinf") {
          // ⚠️ `group` ro'yxati serverdan BO'SH keladi (sahifada o'quv yili
          //  tanlanganda JS to'ldiradi). Variant topilmasa sinfning ID'si
          //  («Sinflar» sahifasidagi group=<id>) to'g'ridan-to'g'ri yuboriladi.
          v = variantTanla(el, (tx) => classKey(tx) === classKey(sinfNomi));
          if (v == null && t._sinfId) v = String(t._sinfId);
        }
        else if (tur === "jins") v = t.jins ? variantTanla(el, (tx) => jinsMos(t.jins, tx)) : null;
        else if (tur === "rol") v = variantTanla(el, (tx) => /quvchi|ученик|student/i.test(tx));
        else if (tur === "yil") {
          // Joriy o'quv yili: sentabrdan — «2026/2027», avval — «2025/2026»
          const d = new Date(); const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
          v = variantTanla(el, (tx) => tx.includes(`${y}/${y + 1}`) || tx.includes(`${y}-${y + 1}`));
        }
        else if (tur === "buyruq") {
          // ⚠️ BUYRUQ TURI HAMMA JOYDA FAQAT «BOSHQA BUYRUQ» (maktab talabi,
          //  22.09.2026). Topilmasa amal yuborilmaydi.
          v = boshqaBuyruq(el);
          if (v == null) yetishmadi.push(`${nomi}: «Boshqa buyruq» turi ro'yxatda yo'q (${[...el.options].map(txt).filter(Boolean).slice(0, 8).join(" / ")})`);
        }
        if (v == null && (tur === "sinf")) yetishmadi.push(`${nomi}: «${sinfNomi}» ro'yxatda yo'q va ID ma'lum emas`);
      } else if (type === "radio") {
        const yorliq = maydonYorligi(el, form) + " " + normKey(el.value);
        if (tur === "jins" && t.jins && jinsMos(t.jins, yorliq)) v = el.value;
        // `who` — kim yaratilyapti: xodim / O'QUVCHI / ota-ona
        else if (tur === "rol" && /quvchi|student|uchenik|pupil/.test(yorliq)) v = el.value;
      } else {
        if (tur === "familiya") v = f.familiya;
        else if (tur === "ism") v = f.ism;
        else if (tur === "sharif") v = f.sharif;
        else if (tur === "tugilgan") v = t.tugilgan ? sanaMaydonga(el, t.tugilgan) : null;
        else if (tur === "qabul") v = sanaMaydonga(el, qabulSanasi());
        // ⚠️ Buyruq sanasi (`eduorderdatebox`) eMaktabda dd/mm/yyyy — ko'chirish
        //  ustasida shunday qabul qilindi (22.09.2026); qolgan sanalar nuqtali.
        else if (tur === "sana") v = /orderdate/i.test(nomi) ? sanaNorm(qabulSanasi()).replace(/\./g, "/") : (el.value ? null : sanaMaydonga(el, qabulSanasi()));
        else if (tur === "telefon") v = opt.telefon && t.telefon ? t.telefon : null;
        else if (tur === "sinf") v = sinfNomi;
        // Buyruq raqami — ko'chirish ustasidagi kabi «1» (bo'sh bo'lsa server rad etadi)
        else if (tur === "raqam") v = el.value || "1";
      }
      if (v == null) return;
      qiymatlar.set(el, v);
      bor.add(tur);
      const variant = el.tagName === "SELECT" ? [...el.options].find((o) => o.value === v) : null;
      const korin = el.tagName === "SELECT"
        ? `${v} (${variant ? txt(variant) : (tur === "sinf" ? sinfNomi + " — ro'yxat bo'sh, ID bilan" : "ro'yxatda yo'q")})`
        : v;
      izoh.push(`${nomi} [${tur}] → ${korin}`);
    });

    ["familiya", "ism"].forEach((k) => { if (!bor.has(k)) yetishmadi.push(`${k} maydoni topilmadi`); });
    // Tanilmagan holatda dasturchi formani ko'rsin: hamma maydon nomi + tanilgan turi
    if (yetishmadi.length) {
      izoh.push("formadagi maydonlar: " + els.map((el) => {
        const tur = maydonTuri(maydonYorligi(el, form));
        const v = el.tagName === "SELECT" ? `{${[...el.options].slice(0, 4).map(txt).join("/")}${el.options.length > 4 ? "…" : ""}}` : "";
        return `${el.getAttribute("name")}:${el.type || el.tagName.toLowerCase()}${v}→${tur || "?"}`;
      }).join(", "));
    }
    return { qiymatlar, izoh, yetishmadi };
  }

  // Formadagi tanilgan maydon turlari to'plami
  function maydonTurlari(form) {
    const s = new Set();
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((el) => {
      const t = maydonTuri(maydonYorligi(el, form)); if (t) s.add(t);
    });
    return s;
  }
  function formaMaydonlari(form) {
    return "formadagi maydonlar: " + [...form.querySelectorAll("input[name], select[name], textarea[name], button[name]")].map((el) => {
      const tur = maydonTuri(maydonYorligi(el, form));
      const v = el.tagName === "SELECT" ? `{${[...el.options].slice(0, 4).map(txt).join("/")}${el.options.length > 4 ? "…" : ""}}`
        : (el.type === "radio" ? `=${el.value}«${txt(el.closest("label")) || txt(form.querySelector(`label[for="${CSS.escape(el.id || "-")}"]`))}»` : "");
      return `${el.getAttribute("name")}:${el.type || el.tagName.toLowerCase()}${v}→${tur || "?"}`;
    }).join(", ");
  }

  // ⚠️ «SHAXSNI YARATISH» — BIR NECHA BOSQICHLI USTA (21.09.2026 da ko'rildi).
  //
  //  1-bosqich (`/v2/admin/persons/new`): faqat yashirin `tab`, `studyYear`,
  //  `who` va `source` RADIO tanlovi + `save1` tugmasi — ism-familiya YO'Q.
  //  Ism-familiya keyingi bosqichda so'raladi; undan keyin sinf/rol bosqichi
  //  bo'lishi mumkin. Shuning uchun usta bo'ylab 4 bosqichgacha yuriladi:
  //   • oraliq bosqich (radio/ro'yxat, ism yo'q) — «yangi shaxs» varianti
  //     tanlanib yuboriladi (bu navigatsiya, hech narsa yaratilmaydi);
  //   • asosiy bosqich (familiya/ism bor) — to'ldiriladi; SINOVda AYNAN SHU
  //     yerda to'xtaymiz, forma yuborilmaydi;
  //   • keyingi bosqichda sinf ro'yxati chiqsa — tanlab yuboriladi.
  //  SINOVda oraliq bosqich faqat BIR marta yuboriladi — 2-bosqich
  //  maydonlarini ko'rish uchun; asosiy forma hech qachon yuborilmaydi.
  // ⚠️ SINOVDA USTA FAQAT DASTLABKI 3 BOLA UCHUN OCHILADI. Har bola uchun
  //  1-bosqich serverga yuboriladi (navigatsiya, yaratmaydi) — 870 bola ×
  //  2 so'rov behuda va serverni bezovta qiladi. 3 tekshiruvdan keyin
  //  qolganlarga faqat yuboriladigan ma'lumot ko'rsatiladi.
  // Ko'rinadigan (yashirin bo'lmagan) familiya/ism maydoni bormi — asosiy forma
  function korinadiganNlast(doc) {
    return [...doc.querySelectorAll('input[name="nlast"], input[name="nfirst"]')]
      .some((el) => String(el.getAttribute("type") || "text").toLowerCase() !== "hidden");
  }
  // Yaratish ustasining tasdiqlash bosqichi: nlast YASHIRIN + save3/save4 tugmasi.
  //  Tasdiqlangan (22.09.2026): back3=«Orqaga», save3=«Yaratish»,
  //  save4=«yana yaratish va qo‘shish». save3 bosiladi; natija —
  //  …/persons/person?person=<id>&…&message=created, «Yangi shaxs yaratildi».
  function yaratishTasdiqi(doc) {
    for (const f of doc.querySelectorAll("form")) {
      const nl = f.querySelector('input[name="nlast"]');
      if (!nl || String(nl.getAttribute("type") || "text").toLowerCase() !== "hidden") continue;
      const tugmalar = [...f.querySelectorAll('input[type=submit][name], button[type=submit][name], button[name]:not([type])')];
      const btn = tugmalar.find((b) => b.getAttribute("name") === "save3")
        || tugmalar.find((b) => /^save\d*$/i.test(b.getAttribute("name")))
        || tugmalar.find((b) => !/back|cancel|bekor/i.test(b.getAttribute("name")));
      if (!btn) continue;
      return { form: f, tugma: btn.getAttribute("name"), tugmalar: tugmalar.map((b) => `${b.getAttribute("name")}=«${b.getAttribute("value") || txt(b)}»`).join(", ") };
    }
    return null;
  }

  let sinovUsta = 0;
  async function yaratOdam(t, sinfNomi, opt) {
    if (opt.sinov && sinovUsta >= 3) {
      return { ok: true, sinov: true, izoh: [
        `SINOV (forma 3 marta tekshirildi, qayta ochilmadi): ${t.fio} → ${sinfNomi} (ID ${t._sinfId || "?"}), `
        + `tug'ilgan ${t.tugilgan || "?"}, jins ${t.jins || "?"}, qabul ${qabulSanasi()}`,
      ] };
    }
    if (opt.sinov) sinovUsta++;
    let url = yaratishUrl();
    let { doc, url: u2 } = await sahifa(url);
    const izoh = [];
    let oraliqYuborildi = 0;
    let pinflOtkazildi = false;

    for (let qadam = 1; qadam <= 5; qadam++) {
      const form = formaTanla(doc);
      if (!form) return { ok: false, sabab: `${qadam}-bosqichda forma topilmadi`, izoh: [...izoh, sahifaTashxisi(doc, u2)] };
      const turlar = maydonTurlari(form);

      // ——— Asosiy bosqich: ism-familiya ———
      if (turlar.has("familiya") || turlar.has("ism")) {
        const r = formaToldir(form, t, sinfNomi, opt);
        izoh.push(`${qadam}-bosqich (asosiy forma):`, ...r.izoh);
        if (r.yetishmadi.length) return { ok: false, sabab: r.yetishmadi.join("; "), izoh };
        if (opt.sinov) { izoh.push("SINOV — asosiy forma yuborilmadi"); return { ok: true, sinov: true, izoh }; }
        const j = await formaYubor(form, u2, formaYig(form, r.qiymatlar));
        if (!j.ok) return { ok: false, sabab: j.xato || `HTTP ${j.holat}`, izoh };
        // ⚠️ 3-BOSQICH — TASDIQLASH (22.09.2026 da haqiqiy yurishda ko'rildi).
        //  save2 qabul qilinsa server hamma maydonni YASHIRIN holda qaytaradi
        //  (nlast:hidden, group:hidden, eduOrderNumber:hidden, …) va uchta
        //  tugma beradi: back3 / save3 / save4. Bu «forma qayta chiqdi» emas —
        //  odam hali yaratilmagan, tasdiq kutilyapti. save3 bilan yuboriladi.
        const tasdiq = yaratishTasdiqi(j.doc);
        if (tasdiq) {
          izoh.push(`${qadam + 1}-bosqich (tasdiqlash): tugmalar ${tasdiq.tugmalar} → «${tasdiq.tugma}» bosiladi`);
          const j3 = await formaYubor(tasdiq.form, j.url, formaYig(tasdiq.form, new Map(), tasdiq.tugma));
          if (!j3.ok) return { ok: false, sabab: `tasdiqlash: ${j3.xato || "HTTP " + j3.holat}`, izoh };
          const xabar3 = xatoMatni(j3.doc);
          if (yaratishTasdiqi(j3.doc) || korinadiganNlast(j3.doc)) {
            // Dublikat xabari TASDIQ bosqichida ham kelishi mumkin (26.09.2026:
            //  Mo'minov Murtazo — «tasdiq qabul qilinmadi … allaqachon mavjud»)
            if (DUBLIKAT_RE.test(xabar3)) {
              izoh.push(`server (tasdiqda): «${cut(xabar3, 120)}» — yangi nusxa yaratilmaydi, mavjud odam qidirilmoqda`);
              return mavjudOdam(t, sinfNomi, opt, izoh, j3.doc);
            }
            return { ok: false, sabab: "tasdiq qabul qilinmadi (forma yana chiqdi)" + (xabar3 ? ": " + cut(xabar3, 250) : ""), izoh: [...izoh, sahifaTashxisi(j3.doc, j3.url).split("\n   ").slice(0, 3).join(" · ")] };
          }
          izoh.push(`natija: ${j3.url} · ${txt(j3.doc.querySelector("h1, h2"))}${xabar3 ? " · " + cut(xabar3, 160) : ""}`);
          return { ok: true, izoh, url: j3.url };
        }
        // ⚠️ Server formani QAYTA ko'rsatsa (ko'rinadigan nlast bilan) —
        //  saqlanmagan: xato yoki «o'xshash odam bor» (showDoublePersonPopup).
        //  ⚠️ PINFL: formada `setSkipCreatingByPinfl` tugmasi bor — PINFLsiz
        //  yaratish uchun eMaktabda AVVAL shu tugma bosiladi (bayroq
        //  o'rnatiladi), keyin `save2`. Rad etilsa bir marta «PINFLsiz davom»
        //  yuborilib, qaytgan forma qayta to'ldiriladi.
        if (korinadiganNlast(j.doc)) {
          const ogoh = xatoMatni(j.doc);
          // ⚠️ «USHBU KISHI ALLAQACHON MAKTABDA MAVJUD.» — DUBLIKAT (26.09.2026:
          //  34 boladan 17 tasi shu). Bu PINFL xatosi EMAS: odam eMaktabda bor
          //  (Arxivda — ilgari chiqarilgan, yoki «O'quvchilar» ro'yxatida
          //  boshqacha yozilgan ism bilan), skript esa uni «yo'q» deb qo'shmoqchi.
          //  «PINFLsiz davom» bilan qayta yuborish behuda (yana shu xato).
          //  Endi mavjud odam qidirilib, ko'chirish ustasi bilan sinfga
          //  biriktiriladi (`mavjudOdam`). Yangi nusxa YARATILMAYDI.
          if (DUBLIKAT_RE.test(ogoh)) {
            izoh.push(`server: «${cut(ogoh, 120)}» — yangi nusxa yaratilmaydi, mavjud odam qidirilmoqda`);
            return mavjudOdam(t, sinfNomi, opt, izoh, j.doc);
          }
          const skip = form.querySelector('[name="setSkipCreatingByPinfl"]') || j.doc.querySelector('[name="setSkipCreatingByPinfl"]');
          if (skip && !pinflOtkazildi) {
            pinflOtkazildi = true;
            izoh.push(`server formani qayta ko'rsatdi${ogoh ? " (" + cut(ogoh, 160) + ")" : ""} — «PINFLsiz davom» (setSkipCreatingByPinfl) yuborilmoqda`);
            const j0 = await formaYubor(form, u2, formaYig(form, r.qiymatlar, "setSkipCreatingByPinfl"));
            if (!j0.ok) return { ok: false, sabab: `PINFLsiz davom: ${j0.xato || "HTTP " + j0.holat}`, izoh };
            doc = j0.doc; u2 = j0.url;
            continue;   // qaytgan forma yana asosiy — to'ldirib save2 bilan yuboriladi
          }
          return { ok: false, sabab: "server formani qayta ko'rsatdi (saqlanmadi)" + (ogoh ? ": " + cut(ogoh, 300) : ""), izoh: [...izoh, sahifaTashxisi(j.doc, j.url).split("\n   ").slice(1, 3).join(" · ")] };
        }
        doc = j.doc; u2 = j.url;
        // Keyingi bosqichda sinf so'ralsa — davom, aks holda tayyor
        const keyingi = formaTanla(doc);
        if (!keyingi || !maydonTurlari(keyingi).has("sinf")) return { ok: true, izoh, url: j.url };
        continue;
      }

      // ——— Oraliq bosqich: manba tanlovi (radio) va/yoki sinf ro'yxati ———
      const q = new Map();
      const radiolar = [...form.querySelectorAll("input[type=radio][name]")];
      if (radiolar.length) {
        const yorliq = (r) => normKey(txt(r.closest("label")) + " " + txt(form.querySelector(`label[for="${CSS.escape(r.id || "-")}"]`)) + " " + r.value);
        const tanlov = radiolar.find((r) => /yangi|new|creat|qolda|manual|vruchn|nov/.test(yorliq(r)))
          || radiolar.find((r) => r.hasAttribute("checked")) || radiolar[0];
        q.set(tanlov, tanlov.value);
        izoh.push(`${qadam}-bosqich: ${tanlov.name} → ${tanlov.value} (variantlar: ${radiolar.map((r) => `${r.value}«${txt(r.closest("label")) || txt(form.querySelector(`label[for="${CSS.escape(r.id || "-")}"]`))}»`).join(", ")})`);
      }
      const sel = [...form.querySelectorAll("select[name]")].find((s) => maydonTuri(maydonYorligi(s, form)) === "sinf");
      if (sel) {
        const v = variantTanla(sel, (tx) => classKey(tx) === classKey(sinfNomi));
        if (v == null) return { ok: false, sabab: `${qadam}-bosqich: sinf ro'yxatida «${sinfNomi}» yo'q`, izoh: [...izoh, formaMaydonlari(form)] };
        q.set(sel, v);
        izoh.push(`${qadam}-bosqich: ${sel.getAttribute("name")} [sinf] → ${v} (${sinfNomi})`);
      }
      if (!radiolar.length && !sel) {
        return { ok: false, sabab: `${qadam}-bosqich: tanilmagan forma (ism ham, tanlov ham yo'q)`, izoh: [...izoh, formaMaydonlari(form)] };
      }
      if (opt.sinov && oraliqYuborildi >= 1) {
        izoh.push(`SINOV — ${qadam}-bosqich yuborilmadi. ${formaMaydonlari(form)}`);
        return { ok: true, sinov: true, izoh };
      }
      const j = await formaYubor(form, u2, formaYig(form, q));
      oraliqYuborildi++;
      if (!j.ok) return { ok: false, sabab: `${qadam}-bosqich: ${j.xato || "HTTP " + j.holat}`, izoh };
      doc = j.doc; u2 = j.url;
      url = j.url;
    }
    return { ok: false, sabab: "usta 5 bosqichdan keyin ham tugamadi", izoh };
  }

  // ⚠️ SHAXS SAHIFASI BO'LIMLARI (21.09.2026 da o'qildi):
  //  /v2/admin/persons/person?person=<id>&school=<id>&view=<bo'lim>
  //  view = review · personal (tahrir: nlast/nfirst/…/save) · achievements ·
  //  migration (SINFGA O'TKAZISH va MAKTABDAN CHIQARISH shu yerda) ·
  //  orders (buyruqlar) · attendance · parents.
  //  «Shaxsiy ma'lumotlar» formasida sinf YO'Q — sinf migratsiyada.
  function shaxsUrl(e, view) {
    const u = new URL(e.tahrir, location.origin);
    u.searchParams.set("view", view);
    u.searchParams.delete("page");
    return u.href;
  }

  // Hujjatdagi SINF RO'YXATLI forma (qaysi forma bo'lishidan qat'i nazar)
  function sinfFormasi(doc) {
    for (const f of doc.querySelectorAll("form")) {
      const sel = [...f.querySelectorAll("select[name]")].find((s) => {
        const k = maydonTuri(maydonYorligi(s, f));
        return k === "sinf" || [...s.options].filter((o) => SINF_RE.test(txt(o))).length >= 3;
      });
      if (sel) return { form: f, sel };
    }
    return null;
  }

  // ⚠️ SINFGA O'TKAZISH — «O'QUVCHINI KO'CHIRISH MASTERI» (22.09.2026 da
  //  «⏺ O'rganish» yozuvidan topildi). Shaxs sahifasida ham, sinf
  //  sahifasida ham o'tkazish tugmasi YO'Q; u alohida usta:
  //    /v2/admin/persons/move?person=<id>&school=<id>   (retgroup=0 ixtiyoriy)
  //  1-bosqich «Sinfni tanlash»: O'quv yili (select, 2026/2027), Yangi sinf
  //  (select, sinf nomlari bilan TO'LDIRILGAN), «Ko'chirish turi» radio:
  //  Haqiqiy (A'zolikning boshlanish sanasi dd.mm.yyyy, №-buyruq raqami,
  //  sanadan dd/mm/yyyy, Buyruq turi select) / Xato tufayli. Tugma
  //  «Keyingi qadam». 2-bosqich «Tasdiqlash» — yana tasdiq tugmasi.
  //  Sahifa `ajax?a=ft&sy=2026` bilan o'quv yili chegarasini oladi
  //  (01/08/2026–31/07/2027) — a'zolik sanasi shu oraliqda bo'lishi kerak.
  //
  //  Yuboriladigan qiymatlar: yangi sinf = nishon sinf (nom bo'yicha, bo'lmasa
  //  ID), tur = Haqiqiy, hamma sana maydoni = shu oyning 1-i (maydonning
  //  o'z formati saqlanadi: nuqtali yoki qiyshiq chiziqli), buyruq raqami
  //  va turi — sahifa bergan holda. SINOVda hech narsa yuborilmaydi, faqat
  //  «maydon → qiymat» ko'rsatiladi. Haqiqiy yurishda 1-bosqich yuborilib,
  //  2-bosqich (tasdiq) formasi ham yuboriladi; tasdiq formasi topilmasa
  //  xato deb qaytariladi (o'tkazish tugallanmagan bo'lishi mumkin).
  function kochirishUrl(e) {
    const u = new URL(e.tahrir, location.origin);
    const m = new URL(location.origin + "/v2/admin/persons/move");
    m.searchParams.set("person", u.searchParams.get("person") || e.id || "");
    m.searchParams.set("school", u.searchParams.get("school") || schoolId);
    m.searchParams.set("retgroup", "0");
    return m.href;
  }

  // Sana maydoniga qiymat — maydondagi mavjud formatga moslab
  //  («01.03.2026» → nuqtali, «27/04/2026» → qiyshiq chiziqli, type=date → ISO)
  function sanaFormatida(el, ddmmyyyy) {
    const s = sanaNorm(ddmmyyyy);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(el.value || "").trim())) return s.replace(/\./g, "/");
    return sanaMaydonga(el, s);
  }

  // Tasdiq bosqichi formasi: logout emas, ko'rinadigan maydonsiz bo'lsa ham
  //  submit tugmasi bor forma
  function tasdiqFormasi(doc) {
    return [...doc.querySelectorAll("form")].find((f) =>
      !/logout/i.test(f.getAttribute("action") || "")
      && f.querySelector('input[type=submit], button[type=submit], button:not([type])')
      && !f.querySelector('input[name="nlast"]'));
  }

  // ⚠️ USTA MAYDONLARI (22.09.2026 da haqiqiy yurishda o'qildi):
  //  __RequestVerificationToken:hidden, step:hidden, studyYear:select
  //  (qiymat «2026» = 2026/2027), group:select (sinf ID, nomlar bilan),
  //  what:radio Valid«Haqiqiy» / Error«Xato tufayli», membershipdate:text
  //  (dd.mm.yyyy), eduOrderNumber:text, eduorderdatebox:text (dd/mm/yyyy —
  //  sahifada JS shunday to'ldiradi), eduOrderType:select (bo'sh /
  //  «Sinflar tashkil topishi» / «O'quv yili oxirida … o'tkazish» (303) /
  //  «Qayta o'qitish» / … / «Boshqa buyruq»), save1:submit.
  //
  //  ⚠️ A'ZOLIK SANASI HOZIRGI SINF A'ZOLIGIDAN OLDIN BO'LOLMAYDI. Tolipov
  //  Mustafo hozirgi sinfga 02.09.2026 da kirgan, biz 01.09.2026 yuborib
  //  «forma qayta chiqdi» oldik. Shuning uchun avval migratsiya sahifasidan
  //  hozirgi a'zolik boshlanishi o'qiladi (MembershipDateEdit havolasining
  //  matni: «chorshanba, 2-sentabr, 2026»), sana nomzodlari ketma-ket
  //  sinaladi: bugun → hozirgi maktab boshlanishi → eski sinf boshi +1 kun. Har
  //  nomzod uchun usta qayta ochiladi (yangi token), rad etilsa keyingisi.
  const UZ_OYLAR = { yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7, avgust: 8, sentabr: 9, sentyabr: 9, oktabr: 10, oktyabr: 10, noyabr: 11, dekabr: 12 };
  function uzSana(matn) {
    const m = String(matn || "").toLowerCase().match(/(\d{1,2})\s*-\s*([a-z]+)\s*,?\s*(\d{4})/);
    if (!m || !UZ_OYLAR[m[2]]) return "";
    return `${m[1].padStart(2, "0")}.${String(UZ_OYLAR[m[2]]).padStart(2, "0")}.${m[3]}`;
  }
  const sanaRaqam = (s) => { const m = sanaNorm(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? Number(m[3] + m[2] + m[1]) : 0; };
  function kunQosh(s, n) {
    const m = sanaNorm(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if (!m) return s;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + n);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  }
  const bugun = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

  // Hozirgi a'zolik sanalari — migratsiya sahifasidan:
  //  maktab — MembershipDateEdit havolasi `group=` SIZ (maktabga a'zolik),
  //  sinf   — `group=` BILAN, datetype=1 (eng oxirgi sinf a'zoligi boshi).
  // ⚠️ SERVER QOIDASI (22.09.2026 da xato matnidan o'qildi):
  //  «Sinfga a'zolikning boshlanish sanasi maktabga a'zolikning boshlanish
  //  sanasidan oldin bo'lmasligi kerak» (≥ maktab) va «Sinfga a'zolikning
  //  tugash sanasi shu sinfga a'zolikning boshlanish sanasidan oldin
  //  bo'lmasligi kerak» (eski sinf 1 kun oldin yopiladi ⇒ yangi > eski sinf
  //  boshi). Demak sana = max(bugun, maktab boshi, eski sinf boshi + 1).
  async function joriyAzolik(e) {
    const out = { maktab: "", sinf: "" };
    try {
      const { doc } = await sahifa(shaxsUrl(e, "migration"));
      doc.querySelectorAll('a[href*="MembershipDateEdit"][href*="datetype=1"]').forEach((a) => {
        const s = uzSana(txt(a)); if (!s) return;
        const h = a.getAttribute("href") || "";
        const k = /[?&]group=/.test(h) ? "sinf" : "maktab";
        if (sanaRaqam(s) > sanaRaqam(out[k] || "01.01.1900")) out[k] = s;
      });
    } catch (err) { if (err.message === TOXTATILDI) throw err; }
    return out;
  }

  // Sahifadagi xato/ogohlantirish matni (class nomi bo'yicha keng qidiruv)
  function xatoMatni(doc) {
    return [...doc.querySelectorAll('[class*="error"], [class*="valid"], [class*="warn"], [class*="alert"], [class*="message"], [class*="msg"]')]
      .map(txt).filter((s) => s && s.length < 300).filter((s, i, a) => a.indexOf(s) === i).join("; ");
  }

  // Sinovda ham faqat dastlabki 3 bola uchun sahifalar ochiladi (yaratish kabi)
  let sinovKoch = 0;
  //  `ustaUrl` — ixtiyoriy: ko'chirish ustasi o'rniga boshqa usta manzili
  //  (arxivdagi odamni tiklash havolasi, `mavjudOdam`); forma tuzilishi bir
  //  xil bo'lsa (sinf ro'yxati + sanalar + buyruq) o'sha to'ldiriladi.
  async function kochirOdam(e, sinfNomi, opt, sinfId, ustaUrl) {
    const izoh = [];
    if (!e.tahrir) return { ok: false, sabab: "shaxs havolasi yo'q" };
    if (opt.sinov && sinovKoch >= 3) {
      return { ok: true, sinov: true, izoh: [`SINOV (usta 3 marta tekshirildi, qayta ochilmadi): ${e.fio} ${e.sinf || "sinfsiz"} → ${sinfNomi} (ID ${sinfId || "?"}), a'zolik ${qabulSanasi()}`] };
    }
    if (opt.sinov) sinovKoch++;

    // Sana = max(bugun, maktab a'zoligi boshi, eski sinf boshi + 1);
    // rad etilsa zaxira: bugun. Takrorlar olib tashlanadi.
    const joriy = await joriyAzolik(e);
    let sana = qabulSanasi();
    if (joriy.maktab && sanaRaqam(joriy.maktab) > sanaRaqam(sana)) sana = joriy.maktab;
    if (joriy.sinf && sanaRaqam(kunQosh(joriy.sinf, 1)) > sanaRaqam(sana)) sana = kunQosh(joriy.sinf, 1);
    if (joriy.maktab || joriy.sinf) izoh.push(`hozirgi a'zolik: maktab ${joriy.maktab || "?"}, sinf ${joriy.sinf || "?"} ⇒ yangi a'zolik ${sana}`);
    const sanalar = [sana, bugun()].filter((s, i, a) => a.indexOf(s) === i);

    // Bir urinish: usta ochiladi, to'ldiriladi, (sinov bo'lmasa) yuboriladi
    const urin = async (azolikSanasi, sinov) => {
      const url0 = ustaUrl || kochirishUrl(e);
      const { doc, url } = await sahifa(url0);
      const topilma = sinfFormasi(doc);
      if (!topilma) return { ok: false, sabab: `${ustaUrl ? "tiklash sahifasida" : "ko'chirish ustasida"} sinf ro'yxatli forma topilmadi`, izoh: [sahifaTashxisi(doc, url)] };
      const { form, sel } = topilma;
      const iz = [`usta: ${url}`];

      // 1) Yangi sinf — nom bo'yicha, bo'lmasa ID.
      //  ⚠️ «Tiklash» formasida (/persons/restore, 26.09.2026) sinf ro'yxati
      //  BO'SH keladi — faqat «- Sinfni tanlang -», sahifada JS o'quv yili
      //  tanlangach to'ldiradi (yaratish formasidagi `group` kabi). Ro'yxat
      //  bo'sh bo'lsa sinf ID to'g'ridan-to'g'ri yuboriladi.
      let v = variantTanla(sel, (tx) => classKey(tx) === classKey(sinfNomi));
      //  ⚠️ «- Sinfni tanlang -» varianti bo'sh qiymatli EMAS (26.09.2026:
      //  0.9.3 da ro'yxat «to'la» deb tanilib ID yuborilmadi). Haqiqiy variant
      //  — qiymati 0/-1 emas va matni «-» bilan boshlanmaydigan.
      const haqiqiyVariant = (o) => o.value && !/^(0|-1)$/.test(o.value.trim()) && !/^\s*[-—–]/.test(txt(o)) && txt(o).trim();
      const boshRoyxat = ![...sel.options].some(haqiqiyVariant);
      if (v == null && sinfId && ([...sel.options].some((o) => o.value === String(sinfId)) || boshRoyxat)) v = String(sinfId);
      if (v == null) return { ok: false, sabab: `ustaning sinf ro'yxatida «${sinfNomi}» yo'q${boshRoyxat ? " va sinf ID ma'lum emas" : ""}`, izoh: [...iz, `ro'yxat: ${[...sel.options].map(txt).filter(Boolean).join(", ")}`] };
      const q = new Map([[sel, v]]);
      iz.push(`${sel.getAttribute("name")} [sinf] → ${v} (${sinfNomi}${boshRoyxat ? " — ro'yxat bo'sh, ID bilan" : ""})`);

      // 2) O'quv yili (joriy) va buyruq turi (faqat «Boshqa buyruq»)
      const d = new Date(); const yil = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
      let buyruqYoq = "";
      form.querySelectorAll("select[name]").forEach((s) => {
        if (s === sel) return;
        const k = maydonYorligi(s, form);
        if (/(studyyear|oquvyil|uchebn|schoolyear|year)/.test(k)) {
          const y = variantTanla(s, (tx) => tx.includes(`${yil}/${yil + 1}`) || tx.includes(`${yil}-${yil + 1}`));
          if (y != null) { q.set(s, y); iz.push(`${s.getAttribute("name")} [yil] → ${y}`); }
        } else if (/(ordertype|buyruq|prikaz|type)/.test(k)) {
          // ⚠️ Aynan «Boshqa buyruq» — «Boshqa ta'lim shakliga o'tkazish» (310) emas.
          //  Topilmasa amal yuborilmaydi (maktab talabi).
          const b = boshqaBuyruq(s);
          if (b != null) { q.set(s, b); iz.push(`${s.getAttribute("name")} [buyruq] → ${b} (${txt([...s.options].find((o) => o.value === b))})`); }
          else buyruqYoq = `${s.getAttribute("name")}: «Boshqa buyruq» turi ro'yxatda yo'q (${[...s.options].map(txt).filter(Boolean).slice(0, 8).join(" / ")})`;
        }
      });

      if (buyruqYoq) return { ok: false, sabab: buyruqYoq, izoh: iz };

      // 3) Ko'chirish turi — «Haqiqiy» (Valid)
      const radiolar = [...form.querySelectorAll("input[type=radio][name]")];
      const yorliq = (r) => normKey(txt(r.closest("label")) + " " + txt(form.querySelector(`label[for="${CSS.escape(r.id || "-")}"]`)) + " " + r.value);
      const haqiqiy = radiolar.find((r) => /haqiqiy|valid|real|nastoya/.test(yorliq(r)))
        || radiolar.find((r) => !/xato|error|mistake|oshib|wrong/.test(yorliq(r)));
      if (haqiqiy) { q.set(haqiqiy, haqiqiy.value); iz.push(`${haqiqiy.name} [tur] → ${haqiqiy.value} (Haqiqiy)`); }

      // 4) Sanalar: a'zolik → nomzod sana (dd.mm.yyyy); buyruq sanasi →
      //    shu sana, lekin dd/mm/yyyy (sahifa JS'i shu formatda to'ldiradi);
      //    buyruq raqami bo'sh bo'lsa «1»
      form.querySelectorAll("input[name]").forEach((el) => {
        const t = String(el.getAttribute("type") || "text").toLowerCase();
        if (t === "hidden" || t === "radio" || t === "checkbox" || t === "submit") return;
        const n = el.getAttribute("name") || "";
        const k = maydonYorligi(el, form);
        if (/orderdate|buyruqsana|eduorderdate/i.test(n + k)) {
          const s = sanaNorm(azolikSanasi).replace(/\./g, "/");
          q.set(el, s); iz.push(`${n} [buyruq sanasi] → ${s}`);
        } else if (/membershipdate|azolik|qabul|datestart|startdate/i.test(n + k) || maydonTuri(k) === "qabul" || maydonTuri(k) === "sana") {
          const s = sanaFormatida(el, azolikSanasi);
          q.set(el, s); iz.push(`${n} [a'zolik sanasi] → ${s}`);
        } else if (/(number|nomer|raqam|№)/i.test(n + k) && !el.value) {
          q.set(el, "1"); iz.push(`${n} [buyruq №] → 1`);
        }
      });

      if (sinov) { iz.push(`SINOV — yuborilmadi. ${formaMaydonlari(form)}`); return { ok: true, sinov: true, izoh: iz }; }

      // 5) 1-bosqich → 2-bosqich «Tasdiqlash»
      const j = await formaYubor(form, url, formaYig(form, q));
      if (!j.ok) return { ok: false, sabab: `1-bosqich: ${j.xato || "HTTP " + j.holat}`, izoh: iz, qayta: true };
      if (sinfFormasi(j.doc)) {
        const xabar = xatoMatni(j.doc);
        return { ok: false, sabab: `1-bosqich qabul qilinmadi (sana ${azolikSanasi})` + (xabar ? ": " + cut(xabar, 200) : ""), izoh: iz, qayta: true };
      }
      const tasdiq = tasdiqFormasi(j.doc);
      if (!tasdiq) return { ok: false, sabab: "2-bosqich (tasdiqlash) formasi topilmadi — o'tkazish tugallanmagan bo'lishi mumkin, eMaktabda tekshiring", izoh: [...iz, sahifaTashxisi(j.doc, j.url)] };
      iz.push(`2-bosqich: ${formaMaydonlari(tasdiq)}`);
      const j2 = await formaYubor(tasdiq, j.url, formaYig(tasdiq, new Map()));
      if (!j2.ok) return { ok: false, sabab: `2-bosqich: ${j2.xato || "HTTP " + j2.holat}`, izoh: iz };
      const xabar2 = xatoMatni(j2.doc);
      if (tasdiqFormasi(j2.doc) && j2.url === j.url && !sinfFormasi(j2.doc)) {
        return { ok: false, sabab: "tasdiq qabul qilinmadi (sahifa o'zgarmadi)" + (xabar2 ? ": " + cut(xabar2, 200) : ""), izoh: [...iz, sahifaTashxisi(j2.doc, j2.url)] };
      }
      iz.push(`natija sahifasi: ${j2.url}${xabar2 ? " · xabar: " + cut(xabar2, 160) : ""}`);
      return { ok: true, izoh: iz, sana: azolikSanasi };
    };

    if (opt.sinov) {
      const r = await urin(sanalar[0], true);
      r.izoh = [...izoh, ...(r.izoh || []), `sana nomzodlari (rad etilsa navbatdagisi): ${sanalar.join(" → ")}`];
      return r;
    }
    let oxirgi = null;
    for (const s of sanalar) {
      const r = await urin(s, false);
      if (r.ok) { r.izoh = [...izoh, ...r.izoh, `✔ a'zolik sanasi ${s} bilan o'tkazildi`]; return r; }
      oxirgi = r;
      izoh.push(`• ${r.sabab}`);
      if (!r.qayta) break;
    }
    return { ok: false, sabab: oxirgi ? oxirgi.sabab : "noma'lum", izoh: [...izoh, ...((oxirgi && oxirgi.izoh) || [])] };
  }

  // ===================================================================
  //  7B-QISM. MAVJUD ODAM — «Ushbu kishi allaqachon maktabda mavjud.»
  //
  //  (26.09.2026: 34 qo'shishdan 17 tasi shu xato bilan qaytdi.) Server
  //  yaratish formasida familiya+ism(+tug'ilgan sana) bo'yicha dublikat
  //  topsa formani shu xabar bilan qaytaradi (`showDoublePersonPopup`).
  //  Demak odam eMaktabda BOR, lekin «O'quvchilar» ro'yxatimizga tushmagan:
  //   • ARXIVDA — ilgari maktabdan chiqarilgan (ehtimol shu skript bilan,
  //     Turon ro'yxati to'liq bo'lmagan paytda), endi Turonda yana faol;
  //   • yoki ro'yxatda ismi boshqacha yozilgan (bizning kalit mos kelmagan).
  //  Yangi nusxa YARATILMAYDI (ikkita bir xil odam bo'lib qolardi) va
  //  «PINFLsiz davom» ham yuborilmaydi (bu PINFL xatosi emas).
  //  Qidiruv: «Odamlarni izlash» search=«Familiya Ism» — avval o'quvchilar,
  //  keyin sahifadagi «Arxiv» yorlig'i (havolasi sahifadan olinadi, manzili
  //  oldindan ma'lum emas; topilmasa /persons/archive taxmin qilinadi).
  //  Nomzodning tug'ilgan sanasi shaxs sahifasidan (view=personal,
  //  `birthday`) Turon bilan solishtiriladi — ism o'xshash boshqa bola
  //  olinmasin. Aynan bittasi mos kelsa — ko'chirish ustasi (`kochirOdam`)
  //  bilan nishon sinfga biriktiriladi; usta arxivdagi odamni olmasa —
  //  sabab + havola bilan qaytariladi, odam qo'lda tiklanadi (CSV da turadi).
  // ===================================================================
  const DUBLIKAT_RE = /allaqachon\s+(maktabda\s+)?mavjud|уже\s+(есть|существует)|already\s+exist/i;

  // Qidiruv natijasi qatorlari: shaxs havolasi (person=<id>) bor har qator
  function qidiruvQatorlari(doc) {
    const out = [];
    const korilgan = new Set();
    doc.querySelectorAll("table tr").forEach((tr) => {
      if (tr.querySelector("th")) return;
      const a = [...tr.querySelectorAll("a[href]")].find((x) => /[?&]person=\d+/i.test(x.getAttribute("href") || ""));
      if (!a) return;
      const fio = unesc(txt(a));
      const id = idHref(a.getAttribute("href"));
      if (!fio || !id || korilgan.has(id)) return;
      korilgan.add(id);
      const cells = [...tr.cells].map(txt);
      const sinf = cells.find((s) => s !== fio && SINF_RE.test(s)) || "";
      const href = a.getAttribute("href");
      out.push({ id, fio, sinf, havola: href, tahrir: href, holat: cells.filter((s) => s && s !== fio && s !== sinf).join(" · ") });
    });
    return out;
  }

  // Shaxs sahifasidan tug'ilgan sana (dd.mm.yyyy) — «Shaxsiy ma'lumotlar» formasi
  async function shaxsTugilgani(e) {
    try {
      const { doc } = await sahifa(shaxsUrl(e, "personal"));
      const el = doc.querySelector('input[name="birthday"]') || doc.querySelector('input[name*="birth" i]');
      return el && el.value ? sanaNorm(el.value.trim()) : "";
    } catch (err) { if (err.message === TOXTATILDI) throw err; return ""; }
  }

  // Sahifadagi «Arxiv» yorlig'i havolasi (qidiruv so'zi bilan)
  function arxivUrl(doc, soz) {
    const a = [...doc.querySelectorAll("a[href]")].find((x) => /^(arxiv|архив|archive)$/i.test(txt(x)))
      || [...doc.querySelectorAll("a[href]")].find((x) => /persons\/archive/i.test(x.getAttribute("href") || ""));
    const u = a ? new URL(a.getAttribute("href"), location.origin) : new URL(`${location.origin}/v2/admin/persons/archive?school=${enc(schoolId)}`);
    u.searchParams.set("search", soz);
    return { url: u.pathname + u.search, taxmin: !a };
  }

  // «Ko'rib chiqish» sahifasida arxivdagi odamni tiklash / qayta qabul
  //  havolasi (nomi oldindan ma'lum emas — matn bo'yicha; o'chirish emas)
  async function tiklashHavolasi(e, izoh) {
    try {
      const { doc, url } = await sahifa(shaxsUrl(e, "review"));
      const ochirRe = /o.?chirib\s*tashla|\bdelete\b|удал|persons\/delete|chiqar|dismiss/i;
      const a = [...doc.querySelectorAll("a[href]")].find((x) => {
        const m = txt(x) + " " + (x.getAttribute("href") || "");
        return /tikla|qayta\s*qabul|qabul\s*qil|maktabga\s*qabul|восстанов|зачисл|restore|enrol|reinstat|persons\/(restore|enroll|accept)/i.test(m) && !ochirRe.test(m);
      });
      if (a) return { matn: txt(a), url: new URL(a.getAttribute("href"), location.origin).href };
      // Topilmasa — sahifadagi amallar jurnalga (keyingi moslash uchun)
      izoh.push(`«Ko'rib chiqish» sahifasida tiklash havolasi yo'q (h1: ${txt(doc.querySelector("h1, h2"))}). ` + sahifaTashxisi(doc, url).split("\n   ").filter((l) => /^(formalar|havolalar|onclick|AjaxPages)/.test(l)).join("\n   "));
    } catch (err) { if (err.message === TOXTATILDI) throw err; izoh.push(`«Ko'rib chiqish» o'qilmadi: ${err.message}`); }
    return null;
  }

  // Qidiruv so'zi variantlari: asl, apostrof turlari (` ʻ ‘ ’ '), apostrofsiz,
  //  oxirida faqat ism (uzun bo'lsa). Takrorlar olib tashlanadi.
  function qidiruvVariantlari(familiya, ism) {
    const asl = `${familiya} ${ism}`.trim();
    const out = [asl];
    // ⚠️ APOS global (/g) regex — `.test` lastIndex saqlaydi; shuning uchun
    //  bu yerda global bo'lmagan nusxasi ishlatiladi
    if (/['‘’ʻʼ´`]/.test(asl)) {
      for (const a of ["`", "ʻ", "‘", "’", "'", ""]) out.push(asl.replace(APOS, a));
    }
    if (ism && ism.length >= 5) out.push(ism);
    return out.filter((s, i, arr) => s && arr.indexOf(s) === i);
  }

  // ⚠️ ARXIVDAGI ODAMNI QAYTA QABUL QILISH YO'LI HALI NOMA'LUM (26.09.2026:
  //  9 bola — eski ID, ko'chirish ustasi HTTP 404 berdi). Bu funksiya yaratish
  //  ustasining 1-bosqichida «Tizimda mavjud foydalanuvchi (bu yoki boshqa
  //  TMdan)» variantini tanlab yuboradi (NAVIGATSIYA — hech kim yaratilmaydi)
  //  va 2-bosqich formasining maydonlarini jurnalga chiqaradi — keyingi
  //  moslash uchun. Har yurishda 2 martagacha.
  let yolTashxisiSoni = 0;
  async function mavjudYolTashxisi(izoh) {
    if (yolTashxisiSoni >= 2) return;
    yolTashxisiSoni++;
    try {
      const { doc, url } = await sahifa(yaratishUrl());
      const form = formaTanla(doc);
      if (!form) return;
      const radio = [...form.querySelectorAll("input[type=radio][name]")]
        .find((r) => /another|mavjud|exist|sushestv|существ/i.test(r.value + " " + txt(r.closest("label")) + " " + txt(form.querySelector(`label[for="${CSS.escape(r.id || "-")}"]`))));
      if (!radio) { izoh.push("yaratish ustasida «mavjud foydalanuvchi» varianti topilmadi"); return; }
      const j = await formaYubor(form, url, formaYig(form, new Map([[radio, radio.value]])));
      const f2 = formaTanla(j.doc) || [...j.doc.querySelectorAll("form")].find((f) => !/logout/i.test(f.getAttribute("action") || ""));
      izoh.push(`«Tizimda mavjud foydalanuvchi» yo'li, 2-bosqich: ${j.url} · h1: ${txt(j.doc.querySelector("h1, h2"))} · ${f2 ? formaMaydonlari(f2) : "forma yo'q"}`);
      izoh.push("   " + sahifaTashxisi(j.doc, j.url).split("\n   ").filter((l) => /^(onclick|AjaxPages|havolalar)/.test(l)).join("\n   "));
    } catch (err) { if (err.message === TOXTATILDI) throw err; izoh.push(`«mavjud foydalanuvchi» yo'li o'qilmadi: ${err.message}`); }
  }

  async function mavjudniTop(t, izoh, dubDoc) {
    const f = fioBol(t.fio);
    const soz = `${f.familiya} ${f.ism}`.trim();
    const k = ismKalit(t.fio);
    const mos = (e) => { const ek = ismKalit(e.fio); return ek.toliq === k.toliq || ek.tartibsiz === k.tartibsiz || ek.qisqa === k.qisqa; };
    const nomzodlar = [];
    const qosh = (list, manba) => list.forEach((e) => { if (mos(e) && !nomzodlar.some((x) => x.id === e.id)) nomzodlar.push({ ...e, manba }); });

    // 0) Dublikat oynasi: server qaytargan sahifada topilgan odamning
    //    havolasi bo'lishi mumkin (showDoublePersonPopup) — eng ishonchli manba
    if (dubDoc) {
      let q0 = qidiruvQatorlari(dubDoc);
      if (!q0.length) {
        q0 = [...dubDoc.querySelectorAll('a[href*="person="]')]
          .map((a) => ({ id: idHref(a.getAttribute("href")), fio: unesc(txt(a)), sinf: "", havola: a.getAttribute("href"), tahrir: a.getAttribute("href"), holat: "" }))
          .filter((x) => x.id && x.fio);
      }
      qosh(q0, "dublikat oynasi");
      izoh.push(`dublikat oynasida shaxs havolasi: ${q0.length}${q0.length ? " — " + q0.map((x) => x.fio).join(", ") : ""}`);
    }
    // 1–2) O'quvchilar ro'yxati va Arxiv — QIDIRUV SO'ZI VARIANTLARI bilan.
    //  ⚠️ APOSTROF (26.09.2026): «In'omjonov», «Mo'minov» qidiruvda 0 qator
    //  chiqdi — eMaktab apostrofni boshqacha saqlaydi (` yoki ʻ yoki yo'q).
    //  Variantlar ketma-ket sinaladi, nomzod chiqishi bilan to'xtaydi;
    //  oxirgi chora — faqat ism (natija `mos` bilan filtrlanadi).
    for (const soz2 of qidiruvVariantlari(f.familiya, f.ism)) {
      if (nomzodlar.length) break;
      const p1 = await sahifa(royxatUrl(1, { search: soz2 }));
      const q1 = qidiruvQatorlari(p1.doc);
      qosh(q1, "o'quvchilar");
      const ar = arxivUrl(p1.doc, soz2);
      let q2n = "o'qilmadi";
      try {
        const p2 = await sahifa(ar.url);
        const q2 = qidiruvQatorlari(p2.doc);
        qosh(q2, "Arxiv");
        q2n = String(q2.length) + (ar.taxmin ? " (manzil taxmin)" : "");
      } catch (err) {
        if (err.message === TOXTATILDI) throw err;
        q2n = `o'qilmadi (${err.message})`;
      }
      izoh.push(`qidiruv «${soz2}»: o'quvchilarda ${q1.length}, Arxivda ${q2n} qator → mos ${nomzodlar.length}`);
    }
    // 3) Tug'ilgan sana bilan tasdiqlash. Aynan mos kelgani bo'lsa — o'sha.
    //    Bo'lmasa (26.09.2026, maktab talabi: «sana mos bo'lmasa to'g'rilab,
    //    hisobotga»): nomzod BITTA bo'lsa u qabul qilinadi — server ismi
    //    bo'yicha shu odamni «bor» dedi; sana farqi TUZATILDI hisobotiga
    //    tushadi (eMaktabdagi sana qoladi, ikkalasi ham hujjat bo'yicha
    //    tekshiriladi). Bir nechta nomzod bo'lsa — qo'lda.
    if (nomzodlar.length && t.tugilgan) {
      const tSana = sanaNorm(t._tugilganAsl != null ? t._tugilganAsl : t.tugilgan);
      for (const e of nomzodlar) e.tugilgan = await shaxsTugilgani(e);
      const aniq = nomzodlar.filter((e) => e.tugilgan && e.tugilgan === tSana);
      if (aniq.length) return { nomzodlar: aniq, soz };
      return { nomzodlar, soz, sanaFarq: true };
    }
    return { nomzodlar, soz };
  }

  async function mavjudOdam(t, sinfNomi, opt, izoh, dubDoc) {
    let top;
    try { top = await mavjudniTop(t, izoh, dubDoc); }
    catch (err) { if (err.message === TOXTATILDI) throw err; return { ok: false, sabab: `eMaktabda allaqachon bor (server), qidiruv o'qilmadi: ${err.message}`, izoh }; }
    const { nomzodlar, soz } = top;
    const havola = (e) => new URL(e.havola, location.origin).href;
    if (!nomzodlar.length) {
      return { ok: false, sabab: `eMaktabda allaqachon bor (server shunday dedi), lekin dublikat oynasi, «${soz}» qidiruvi (o'quvchilar, Arxiv) da mos odam chiqmadi. Qo'lda: Odamlarni izlash → «${soz}» (Arxiv yorlig'ini ham qarang)`, izoh };
    }
    if (nomzodlar.length > 1) {
      return { ok: false, sabab: `eMaktabda allaqachon bor — qidiruvda ${nomzodlar.length} ta mos odam: ${nomzodlar.map((e) => `${e.fio} [${e.manba}${e.sinf ? ", " + e.sinf : ""}${e.tugilgan ? ", " + e.tugilgan : ""}]`).join("; ")} (Turonda ${sanaNorm(t._tugilganAsl != null ? t._tugilganAsl : t.tugilgan) || "sana yo'q"}) — qaysi biri ekanini qo'lda aniqlang`, izoh };
    }
    const e = nomzodlar[0];
    const sanaFarqi = top.sanaFarq && e.tugilgan ? e.tugilgan : "";
    izoh.push(`topildi: «${e.fio}» [${e.manba}${e.sinf ? ", " + e.sinf : ", sinfsiz"}${e.tugilgan ? ", tug'ilgan " + e.tugilgan : ""}] → ${havola(e)}`);
    if (sanaFarqi) izoh.push(`⚠ tug'ilgan sana farq qiladi: Turon ${sanaNorm(t._tugilganAsl != null ? t._tugilganAsl : t.tugilgan)} ↔ eMaktab ${sanaFarqi} — eMaktabniki qoldi, TUZATILDI hisobotiga yozildi`);
    // ⚠️ MAQBUL SINFLARDAN BIRIDA TURSA — TEGILMAYDI (26.09.2026: yo'nalishli
    //  «Ijtimoiy 3» bolasi eMaktabda 9-B da turgan, skript «9-A» ni nishon
    //  qilib ko'chirib yuborgan). Harfsiz Turon sinfi uchun shu raqamdagi
    //  hamma sinf maqbul (`t._nomzodlar`), harfli uchun — aynan bittasi.
    const maqbul = new Set([classKey(sinfNomi), ...(t._nomzodlar || [])]);
    if (e.sinf && maqbul.has(classKey(e.sinf))) {
      izoh.push(`✔ allaqachon «${e.sinf}» da (maqbul sinf) — ism yozilishi farq qilgani uchun tanilmagan (Turon «${t.fio}» ↔ eMaktab «${e.fio}»)`);
      return { ok: true, izoh, url: havola(e), mavjud: true, sanaFarqi };
    }
    // Ko'chirish ustasi — boshqa sinfdagi odam nishon sinfga.
    //  ⚠️ Arxivdagi odam uchun usta HTTP 404 beradi (26.09.2026) — xato
    //  ushlanadi, zaxira yo'llarga o'tiladi (ilgari «kutilmagan xato» bo'lib
    //  hamma tashxis yo'qolardi).
    const xavfsizKochir = async (ustaUrl) => {
      try { return await kochirOdam(e, sinfNomi, opt, t._sinfId, ustaUrl); }
      catch (err) { if (err.message === TOXTATILDI) throw err; return { ok: false, sabab: err.message, izoh: [] }; }
    };
    let r = await xavfsizKochir();
    if (!r.ok) {
      // Arxivdagi odamni ko'chirish ustasi olmasa — «Ko'rib chiqish» dagi
      //  tiklash / qayta qabul havolasi bilan uriniladi (forma tuzilishi
      //  ustanikiga o'xshasa ishlaydi; bo'lmasa sahifa tashxisi jurnalda).
      izoh.push(`ko'chirish ustasi olmadi: ${r.sabab}${/404/.test(r.sabab) ? " (odam maktabning joriy a'zosi emas — Arxivda)" : ""}`);
      const tikla = await tiklashHavolasi(e, izoh);
      if (tikla) {
        izoh.push(`tiklash havolasi: «${tikla.matn}» → ${tikla.url}`);
        const r2 = await xavfsizKochir(tikla.url);
        r2.izoh = [...(r.izoh || []), ...(r2.izoh || [])];
        r = r2;
      } else {
        await mavjudYolTashxisi(izoh);
      }
    }
    if (r.ok) return { ok: true, izoh: [...izoh, `➜ mavjud odam «${e.fio}» [${e.manba}] → ${sinfNomi}`, ...(r.izoh || [])], url: havola(e), mavjud: true, sanaFarqi };
    return {
      ok: false,
      sabab: `eMaktabda allaqachon bor («${e.fio}», ${e.sinf || e.manba}), lekin sinfga biriktirib bo'lmadi: ${r.sabab}. Qo'lda tiklang: ${havola(e)}`,
      izoh: [...izoh, ...(r.izoh || [])],
    };
  }

  // ⚠️ MAKTABDAN CHIQARISH — HAVOLA «KO'RIB CHIQISH» SAHIFASIDA (22.09.2026
  //  da skrinshotdan topildi). Shaxs sahifasining o'ng menyusi: «Tahrirlash»,
  //  «Boshqa sinfga ko‘chirish», «maktabdan chiqarish», «Shaxsni o‘chirib
  //  tashlash». Migratsiya sahifasida bunday havola YO'Q — skript ilgari
  //  o'sha yerda qidirib «topilmadi» degan.
  //  ⚠️ «Shaxsni o‘chirib tashlash» (/v2/admin/persons/delete) — odamni
  //  baholari, davomati bilan BUTUNLAY o'chiradi. Biz uni ISHLATMAYMIZ,
  //  faqat «maktabdan chiqarish» (o'quvchi maktabdan ketgan, tarixi qoladi).
  //  Chiqarish formasi hali o'rganilmagan — maydonlar nomi/yorlig'i bo'yicha
  //  to'ldiriladi: sana = bugun, buyruq turi = faqat «Boshqa buyruq», buyruq
  //  № = 1, buyruq sanasi = bugun (dd/mm/yyyy), radio «Haqiqiy». SINOVda
  //  forma maydonlari jurnalga chiqadi (dastlabki 3 bola) — shundan keyin
  //  moslanadi. Tasdiq bosqichi bo'lsa (yashirin maydonli forma) u ham
  //  yuboriladi.
  let sinovChiq = 0;
  async function chiqarOdam(e, opt) {
    if (!e.tahrir) return { ok: false, sabab: "shaxs havolasi yo'q" };
    if (opt.sinov && sinovChiq >= 3) {
      return { ok: true, sinov: true, izoh: [`SINOV (forma 3 marta tekshirildi, qayta ochilmadi): ${e.fio} (${e.sinf || "sinfsiz"}) maktabdan chiqariladi, sana ${bugun()}`] };
    }
    if (opt.sinov) sinovChiq++;
    const izoh = [];
    const { doc, url } = await sahifa(shaxsUrl(e, "review"));
    const chiqarRe = /maktabdan\s*chiqar|otchisl|выбы|otchisl|\bleave\b|exclude|dismiss/i;
    const ochirRe = /o.?chirib\s*tashla|\bdelete\b|удал|persons\/delete/i;
    const a = [...doc.querySelectorAll("a[href]")].find((x) => chiqarRe.test(txt(x)) && !ochirRe.test(txt(x) + " " + (x.getAttribute("href") || "")));
    if (!a) return { ok: false, sabab: "«Ko'rib chiqish» sahifasida «maktabdan chiqarish» havolasi topilmadi", izoh: [sahifaTashxisi(doc, url)] };
    const havola = new URL(a.getAttribute("href"), location.origin).href;
    izoh.push(`havola: «${txt(a)}» → ${havola}`);
    if (ochirRe.test(havola)) return { ok: false, sabab: "havola «Shaxsni o'chirib tashlash» ga olib boradi — xavfsizlik uchun bajarilmadi", izoh };

    const p = await sahifa(havola);
    const form = formaTanla(p.doc) || [...p.doc.querySelectorAll("form")].find((f) => !/logout/i.test(f.getAttribute("action") || ""));
    if (!form) return { ok: false, sabab: "chiqarish sahifasida forma yo'q", izoh: [...izoh, sahifaTashxisi(p.doc, p.url)] };
    const u2 = p.url;
    const q = new Map();
    const sana = bugun();
    let buyruqYoq = "";

    // ⚠️ CHIQARISH FORMASI (22.09.2026 da haqiqiy yurishda o'qildi):
    //  /v2/admin/persons/dismiss?person=…&school=…&searchParams=…&retgroup=0
    //   what:radio          Valid «Haqiqiy» / Error «Xato tufayli»
    //   membershipdate      chiqish sanasi (dd/mm/yyyy — sahifa shunday beradi)
    //   dismReason, comment sabab / izoh — TEGILMAYDI (sahifa bergani)
    //   eduOrderNumber      buyruq № → 1
    //   eduorderdatebox     buyruq sanasi dd/mm/yyyy → bugun
    //   eduOrderType        FAQAT «Boshqa buyruq» (305 «bitirish» EMAS —
    //                       birinchi yurishda shu xato ketgan)
    //   docType (201 «O‘rta umumiy ta'lim attestati»), docSeries, docNumber,
    //   documentdatebox, docRegNumber, docLedgerEntryNumber — BITIRUVCHI
    //   hujjati; oddiy chiqarishda BO'SH qoladi (birinchi yurishda «1» va
    //   sana yozilib ketgan edi).
    //  2-bosqich: hamma maydon yashirin + back/confirmed → `confirmed`.
    //  Natija: …/persons/default?school=…&message=dismissed,
    //  «Shaxs maktabdan muvaffaqiyatli chiqarildi».
    const HUJJAT_RE = /^(doctype|documenttype|docseries|docnumber|documentdatebox|docissueddate|docregnumber|docledgerentrynumber|isdocchecked)$/i;
    const radiolar = [...form.querySelectorAll("input[type=radio][name]")];
    const yorliq = (r) => normKey(txt(r.closest("label")) + " " + txt(form.querySelector(`label[for="${CSS.escape(r.id || "-")}"]`)) + " " + r.value);
    const haqiqiy = radiolar.find((r) => /haqiqiy|valid|real|nastoya/.test(yorliq(r)));
    if (haqiqiy) { q.set(haqiqiy, haqiqiy.value); izoh.push(`${haqiqiy.name} [tur] → ${haqiqiy.value} (Haqiqiy)`); }

    form.querySelectorAll("select[name]").forEach((s) => {
      const n = s.getAttribute("name") || "";
      const nk = n.toLowerCase();
      if (HUJJAT_RE.test(nk)) { izoh.push(`${n} [hujjat] → (bo'sh qoldirildi)`); return; }
      if (nk === "eduordertype" || /^(ordertype|buyruqtur)/.test(normKey(n))) {
        // ⚠️ CHIQARISH FORMASIDA «BOSHQA BUYRUQ» YO'Q (22.09.2026: 500 bola shu
        //  sabab rad etildi). Ro'yxat faqat 3 variant: «Ta'lim muassasasini
        //  BITIRISH to‘g‘risidagi buyruq» (attestat — kerak emas), «Ta'lim
        //  muassasasidan CHIQARISH to‘g‘risidagi buyruq» va «Ko‘chirish
        //  tartibiga muvofiq maktabdan chiqarish» (boshqa maktabga o'tkazish).
        //  Avval «Boshqa buyruq» qidiriladi (bo'lsa — o'sha), bo'lmasa aynan
        //  «muassasasidan chiqarish» varianti; bitirish/ko'chirish HECH QACHON.
        let b = boshqaBuyruq(s);
        if (b == null) {
          b = variantTanla(s, (tx, val) => !!val && /muassasasidanchiqarish|otchislen|otchisl|vybyt/.test(normKey(tx)) && !/bitir|kochir|perevod|vypusk/.test(normKey(tx)));
        }
        if (b != null) { q.set(s, b); izoh.push(`${n} [buyruq] → ${b} (${txt([...s.options].find((o) => o.value === b))})`); }
        else buyruqYoq = `${n}: «Boshqa buyruq» ham, «muassasasidan chiqarish to‘g‘risidagi buyruq» ham ro'yxatda yo'q (${[...s.options].map(txt).filter(Boolean).slice(0, 10).join(" / ")})`;
        return;
      }
      // ⚠️ dismReason MAJBURIY (22.09.2026: 306 buyruq bilan server «A'zolikdan
      //  chiqish sababini ko‘rsating!» deb rad etdi — 22 bola). Ro'yxat:
      //  «Boshqa kunduzgi umumiy ta`lim muassasalariga» / «…nogiron bolalar
      //  uchun sinflarga» / «kechki (smenali) o`quv muassasalariga» /
      //  «o`rta maxsus kasb-hunar…» / … Turonda yo'q bola odatda boshqa
      //  maktabga ketgan — avval «boshqa sabab(lar)» varianti qidiriladi,
      //  bo'lmasa «Boshqa kunduzgi umumiy ta'lim muassasalariga», bo'lmasa
      //  birinchi bo'sh bo'lmagan variant. SINOVda to'liq ro'yxat chiqadi.
      if (nk === "dismreason" || /(dismreason|sabab|reason|prichin)/.test(normKey(n))) {
        const v = variantTanla(s, (tx, val) => !!val && /^boshqasabab|boshqasabablar|^other|prochee|drugie|drugoy/.test(normKey(tx)))
          ?? variantTanla(s, (tx, val) => !!val && /^boshqakunduzgiumumiy/.test(normKey(tx)))
          ?? variantTanla(s, (tx, val) => !!val && !/^\s*-/.test(tx));
        if (v != null) { q.set(s, v); izoh.push(`${n} [chiqish sababi] → ${v} (${txt([...s.options].find((o) => o.value === v))})`); }
        else izoh.push(`${n} [chiqish sababi] → tanlab bo'lmadi (ro'yxat: ${[...s.options].map(txt).filter(Boolean).join(" / ")})`);
        if (opt.sinov) izoh.push(`   ${n} ro'yxati: ${[...s.options].map((o) => `${o.value}=«${txt(o)}»`).filter((x) => !/=«»$/.test(x)).join(" / ")}`);
        return;
      }
      // comment va boshqalar — sahifa bergani
      izoh.push(`${n} [ro'yxat] → (sahifa bergani: ${txt(s.options[s.selectedIndex] || s.options[0]) || "bo'sh"})`);
    });
    if (buyruqYoq) return { ok: false, sabab: buyruqYoq, izoh: [...izoh, formaMaydonlari(form)] };

    form.querySelectorAll("input[name], textarea[name]").forEach((el) => {
      const t = String(el.getAttribute("type") || "text").toLowerCase();
      if (t === "hidden" || t === "radio" || t === "checkbox" || t === "submit" || t === "button") return;
      const n = el.getAttribute("name") || "";
      const nk = n.toLowerCase();
      if (HUJJAT_RE.test(nk)) return;                       // hujjat maydonlari bo'sh
      if (nk === "eduorderdatebox" || /orderdate/i.test(nk)) {
        const s = sanaNorm(sana).replace(/\./g, "/");
        q.set(el, s); izoh.push(`${n} [buyruq sanasi] → ${s}`);
      } else if (nk === "membershipdate" || /membership|azolik|chiqish/i.test(nk)) {
        const s = sanaFormatida(el, sana);
        q.set(el, s); izoh.push(`${n} [chiqish sanasi] → ${s}`);
      } else if (nk === "eduordernumber" || /ordernumber/i.test(nk)) {
        q.set(el, el.value || "1"); izoh.push(`${n} [buyruq №] → ${el.value || "1"}`);
      }
      // comment, dismReason va boshqalar — tegilmaydi
    });

    if (opt.sinov) { izoh.push(`SINOV — yuborilmadi. ${formaMaydonlari(form)}`); return { ok: true, sinov: true, izoh }; }

    const j = await formaYubor(form, u2, formaYig(form, q));
    if (!j.ok) return { ok: false, sabab: j.xato || `HTTP ${j.holat}`, izoh };
    // Forma qayta chiqdimi (birinchi ko'rinadigan maydon nomi bo'yicha)?
    const birinchi = [...form.querySelectorAll(KORINADIGAN)].map((x) => x.getAttribute("name")).find(Boolean);
    const qaytaChiqdi = (d) => !!(birinchi && [...d.querySelectorAll(`[name="${CSS.escape(birinchi)}"]`)].some((x) => String(x.getAttribute("type") || "text").toLowerCase() !== "hidden"));
    let oxirgi = j;
    if (qaytaChiqdi(j.doc)) {
      const xabar = xatoMatni(j.doc);
      return { ok: false, sabab: "chiqarish formasi qayta chiqdi (saqlanmadi)" + (xabar ? ": " + cut(xabar, 250) : ""), izoh: [...izoh, formaMaydonlari(formaTanla(j.doc) || form)] };
    }
    // Tasdiq bosqichi (yashirin maydonli forma, saqlash tugmasi bilan)
    const tasdiq = [...j.doc.querySelectorAll("form")].find((f) => !/logout/i.test(f.getAttribute("action") || "")
      && !f.querySelector(KORINADIGAN) && f.querySelector('input[type=submit][name], button[type=submit][name]'));
    if (tasdiq) {
      izoh.push(`tasdiqlash: ${formaMaydonlari(tasdiq)}`);
      oxirgi = await formaYubor(tasdiq, j.url, formaYig(tasdiq, new Map()));
      if (!oxirgi.ok) return { ok: false, sabab: `tasdiqlash: ${oxirgi.xato || "HTTP " + oxirgi.holat}`, izoh };
    }
    const xabar2 = xatoMatni(oxirgi.doc);
    izoh.push(`natija: ${oxirgi.url} · ${txt(oxirgi.doc.querySelector("h1, h2"))}${xabar2 ? " · " + cut(xabar2, 160) : ""}`);
    return { ok: true, izoh };
  }

  // ===================================================================
  //  8-QISM. O'RGANISH YOZUVI
  //
  //  Amal formalari ODDIY sahifa yuborishi bilan ketadi — fetch/XHR
  //  hook'lari uni ko'rmaydi. Shuning uchun `submit` hodisasi ushlanadi
  //  (forma manzili, usuli va HAMMA maydoni yoziladi), har sahifa
  //  ochilganda URL ham qayd etiladi. Yozuv localStorage'da, sahifa
  //  almashsa ham davom etadi.
  // ===================================================================
  const REC = {
    yoniq: lsOl(LS_REC_ON, "0") === "1",
    yozuv: (() => { try { return JSON.parse(lsOl(LS_REC, "[]")) || []; } catch { return []; } })(),
  };
  function recSaqla() { if (REC.yozuv.length > 80) REC.yozuv = REC.yozuv.slice(-80); lsYoz(LS_REC, JSON.stringify(REC.yozuv)); }

  document.addEventListener("submit", (ev) => {
    if (!REC.yoniq) return;
    const form = ev.target;
    if (!form || form.tagName !== "FORM" || form.closest("#sj-oq-host")) return;
    const maydonlar = [];
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      const item = { nomi: el.getAttribute("name") || "", id: el.id || "", turi: el.type || el.tagName, qiymat: cut(el.value, 200) };
      if (el.tagName === "SELECT") item.variantlar = [...el.options].slice(0, 300).map((o) => ({ v: o.value, t: txt(o) }));
      if (el.type === "checkbox" || el.type === "radio") item.belgilangan = el.checked;
      maydonlar.push(item);
    });
    REC.yozuv.push({ tur: "forma", sahifa: location.href, action: form.getAttribute("action") || "", metod: form.getAttribute("method") || "get", maydonlar, vaqt: new Date().toISOString() });
    recSaqla();
  }, true);

  // Sahifaning O'Z so'rovlari ushlanadi — shuning uchun `W` (unsafeWindow).
  (function hookNetwork() {
    const XHR = W.XMLHttpRequest;
    const _open = XHR.prototype.open, _send = XHR.prototype.send;
    XHR.prototype.open = function (m, u) { this.__sj = { metod: m, url: String(u) }; return _open.apply(this, arguments); };
    XHR.prototype.send = function (body) {
      if (REC.yoniq && this.__sj) {
        const rec = { tur: "xhr", ...this.__sj, sorov: cut(typeof body === "string" ? body : "", 2000) };
        REC.yozuv.push(rec); recSaqla();
        this.addEventListener("load", () => { rec.holat = this.status; try { rec.javob = cut(this.responseText, 2000); } catch { /* */ } recSaqla(); });
      }
      return _send.apply(this, arguments);
    };
    const _fetch = W.fetch;
    W.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      let rec = null;
      if (REC.yoniq && !(init && init.__sj)) {
        rec = { tur: "fetch", metod: (init && init.method) || "GET", url: String(url), sorov: cut((init && typeof init.body === "string") ? init.body : "", 2000) };
        REC.yozuv.push(rec); recSaqla();
      }
      return _fetch.apply(this, arguments).then((res) => {
        if (rec) { rec.holat = res.status; try { res.clone().text().then((t) => { rec.javob = cut(t, 2000); recSaqla(); }); } catch { /* */ } }
        return res;
      });
    };
  })();

  if (REC.yoniq) { REC.yozuv.push({ tur: "sahifa", url: location.href, sarlavha: document.title, vaqt: new Date().toISOString() }); recSaqla(); }

  // ===================================================================
  //  9A-QISM. TURON PANELI — ro'yxatni yig'ish va eMaktabga uzatish
  //
  //  Bu sahifada solishtirish YO'Q: eMaktab boshqa domen, uning ro'yxati
  //  bu yerdan o'qilmaydi. Vazifa bitta — Turon jadvalini to'liq yig'ib,
  //  GM xotirasiga (Tampermonkey) yozish; eMaktab paneli uni o'zi oladi.
  // ===================================================================
  const PANEL_CSS = `
      :host,*{box-sizing:border-box;}
      .wrap{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;}
      .fab{width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-weight:800;font-size:13px;
        box-shadow:0 8px 24px rgba(239,68,68,.4);}
      .panel{display:none;width:440px;max-height:86vh;overflow:auto;background:#0f172a;
        border:1px solid #1e293b;border-radius:16px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);}
      .panel.ochiq{display:block;}
      h3{margin:0 0 2px;font-size:15px;color:#fff;}
      .sub{color:#94a3b8;font-size:11.5px;margin-bottom:10px;}
      .qadam{border:1px solid #1e293b;border-radius:11px;padding:10px;margin-bottom:9px;background:#111a2e;}
      .qadam b{color:#fde68a;font-size:12px;display:block;margin-bottom:6px;}
      button.b{border:none;border-radius:9px;padding:8px 11px;font-weight:700;font-size:12px;
        cursor:pointer;margin:2px 3px 2px 0;font-family:inherit;}
      button.b:disabled{opacity:.5;cursor:default;}
      .b-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
      .b-alt{background:#1e293b;color:#cbd5e1;border:1px solid #334155;}
      .b-warn{background:#7c2d12;color:#fed7aa;}
      textarea{width:100%;height:70px;background:#020617;border:1px solid #1e293b;border-radius:9px;
        color:#cbd5e1;padding:7px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
      .log{background:#020617;border:1px solid #1e293b;border-radius:9px;padding:7px;height:190px;
        overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;}
      .ok{color:#86efac;} .xato{color:#fca5a5;} .ogoh{color:#fde68a;} .dim{color:#64748b;}
      .qator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px 0;}
      .holat{font-size:11px;color:#94a3b8;}
      label{font-size:11.5px;color:#cbd5e1;display:inline-flex;align-items:center;gap:4px;}
      input[type=number]{width:64px;background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:3px 5px;}
      .x{position:absolute;right:10px;top:8px;background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;}
      .stat{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:6px 0;}
      .stat div{background:#020617;border:1px solid #1e293b;border-radius:8px;padding:6px;text-align:center;}
      .stat span{display:block;font-size:18px;font-weight:800;color:#fff;}
      .stat small{font-size:10.5px;color:#94a3b8;}
      .pb{height:5px;background:#1e293b;border-radius:3px;overflow:hidden;margin:4px 0;}
      .pb i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f59e0b,#ef4444);transition:width .2s;}
  `;

  function panelYasa(id, html) {
    const h = document.createElement("div");
    h.id = id;
    h.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const s = h.attachShadow({ mode: "open" });
    document.body.appendChild(h);
    s.innerHTML = `<style>${PANEL_CSS}</style>${html}`;
    return s;
  }

  function turonPanel() {
    const s = panelYasa("sj-oq-turon-host", `
    <div class="wrap">
      <button class="fab" id="fab" title="Turon → eMaktab">T→E</button>
      <div class="panel" id="panel" style="position:relative;">
        <button class="x" id="yopish">✕</button>
        <h3>Turon → eMaktab: ro'yxat yig'ish</h3>
        <div class="sub">O'quvchilar jadvali yig'iladi va eMaktab sahifasidagi panelga uzatiladi.</div>

        <div class="stat">
          <div><span id="nSahifa">0</span><small>shu sahifada</small></div>
          <div><span id="nYigim">0</span><small>yig'ildi</small></div>
          <div><span id="nFaol">?</span><small>Turon «Faol»</small></div>
        </div>

        <div class="qadam">
          <b>1. Yig'ish</b>
          <div class="qator">
            <button class="b b-main" id="hamma">🔄 Hamma sahifani o'qish</button>
            <button class="b b-alt" id="shu">➕ Shu sahifani qo'shish</button>
            <button class="b b-warn" id="toza" title="Yig'imni tozalash">🗑</button>
            <button class="b b-alt" id="tashxis" title="Sahifa tuzilishini faylga yozadi — yig'ish ishlamasa dasturchiga">🧾 Tashxis</button>
          </div>
          <div class="holat" id="holat">Har ochilgan sahifa o'zi yig'iladi. Filtr «Faol» bo'lsin.</div>
          <div class="pb"><i id="pbar"></i></div>
        </div>

        <div class="qadam">
          <b>2. eMaktabga uzatish</b>
          <div class="qator">
            <button class="b b-main" id="uzat">📤 eMaktabga uzatish</button>
            <button class="b b-alt" id="json">💾 JSON fayl</button>
          </div>
          <div class="holat" id="uzatHolat"></div>
        </div>

        <div class="log" id="log"></div>
      </div>
    </div>`);
    const $ = (id) => s.getElementById(id);
    const panel = $("panel");
    const log = (msg, cls) => {
      const d = document.createElement("div");
      if (cls) d.className = cls;
      d.textContent = msg;
      $("log").appendChild(d);
      $("log").scrollTop = $("log").scrollHeight;
    };
    $("fab").onclick = () => lsYoz(LS_OCHIQ, panel.classList.toggle("ochiq") ? "1" : "0");
    $("yopish").onclick = () => { panel.classList.remove("ochiq"); lsYoz(LS_OCHIQ, "0"); };
    if (lsOl(LS_OCHIQ, "0") === "1") panel.classList.add("ochiq");

    const y = yigimOl();
    const faol = turonFaolSoni(document);
    if (faol) $("nFaol").textContent = String(faol);

    const holatYangila = () => {
      const n = Object.keys(y.qatorlar).length;
      $("nYigim").textContent = String(n);
      const f = Object.values(y.qatorlar).filter((o) => !o.status || /faol|active/i.test(o.status)).length;
      $("holat").textContent = n
        ? `Yig'ildi: ${n} qator (faol ${f})${faol ? `, Turon «Faol»: ${faol}` : ""}${faol && f < faol ? " — hali to'liq emas" : (faol && f >= faol ? " ✔ to'liq" : "")}`
        : "Har ochilgan sahifa o'zi yig'iladi. Filtr «Faol» bo'lsin.";
    };

    const matnYasa = () => JSON.stringify(Object.values(y.qatorlar));

    // Uzatish: GM xotirasi (domenlararo). Console rejimida GM yo'q — fayl.
    const uzat = (jim) => {
      const matn = matnYasa();
      if (!Object.keys(y.qatorlar).length) { if (!jim) log("✖ Yig'im bo'sh", "xato"); return; }
      // `faol` ham uzatiladi — eMaktab paneli ro'yxat to'liqligini shundan
      // tekshiradi va to'liq bo'lmasa CHIQARISHga yo'l qo'ymaydi.
      if (gmYoz({ vaqt: y.vaqt || new Date().toISOString(), matn, faol })) {
        $("uzatHolat").textContent = `✔ ${Object.keys(y.qatorlar).length} qator uzatildi — eMaktab sahifasida panel uni o'zi oladi`;
        if (!jim) log("📤 Uzatildi. Endi eMaktab → Odamlarni izlash sahifasini oching (yoki F5).", "ok");
      } else {
        $("uzatHolat").textContent = "Tampermonkey xotirasi yo'q (Console rejimi) — JSON faylni yuklab, eMaktab panelida «📂 Fayldan» bilan oching.";
        if (!jim) yuklab("turon-oquvchilar.json", matn, "application/json");
      }
    };

    // Shu sahifadagi jadvalni yig'imga qo'shish (qo'lda va avtomatik)
    const shuSahifa = (jim) => {
      const j = turonJadval(document);
      const n = j ? j.qatorlar.length : 0;
      $("nSahifa").textContent = String(n);
      if (!j) { if (!jim) log("✖ Bu sahifada o'quvchilar jadvali topilmadi", "xato"); return 0; }
      const yangi = yigimgaQosh(y, j.qatorlar);
      if (yangi) { yigimYoz(y); uzat(true); }
      holatYangila();
      if (!jim || yangi) log(`➕ ${n} qator o'qildi, ${yangi} yangi (jami ${Object.keys(y.qatorlar).length})`, yangi ? "ok" : "dim");
      return yangi;
    };

    $("shu").onclick = () => shuSahifa(false);
    $("uzat").onclick = () => uzat(false);
    $("json").onclick = () => { yuklab("turon-oquvchilar.json", matnYasa(), "application/json"); log("💾 turon-oquvchilar.json saqlandi", "ok"); };
    $("toza").onclick = () => {
      y.qatorlar = {}; y.vaqt = ""; yigimYoz(y); holatYangila();
      log("🗑 Yig'im tozalandi", "dim");
    };
    $("tashxis").onclick = () => {
      yuklab("turon-tashxis.json", turonTashxis(), "application/json");
      log("🧾 turon-tashxis.json saqlandi — uni dasturchiga bering.", "ok");
    };

    $("hamma").onclick = async () => {
      $("hamma").disabled = true;
      log("🔄 Sahifalar o'qilmoqda…", "ok");
      try {
        const r = await turonHammaSahifa(y, faol, (m) => { $("holat").textContent = m; }, log);
        if (!r.serverda) {
          log("⚠ Sahifalar fetch bilan o'qilmadi (jadval JS bilan chiziladi). Sahifalarni QO'LDA varaqlang — har sahifa o'zi yig'iladi.", "ogoh");
        } else {
          const n = Object.keys(y.qatorlar).length;
          log(`✔ ${r.sahifalar} so'rov, ${r.otishlar} o'tish, ${r.yangi} yangi qator (jami ${n}) — usul: ${r.usul}`, "ok");
          if (faol && n < faol) {
            log(`⚠ Turon «Faol» ${faol}, yig'ildi ${n}. «🔄» ni YANA bosing — har o'tish yangi bolalarni qo'shadi. `
              + "Bir necha marta bosib ham yetmasa «🧾 Tashxis» faylini dasturchiga bering. "
              + "To'liq bo'lmaguncha eMaktabda CHIQARISH ishlamaydi.", "ogoh");
          }
          uzat(false);
        }
      } catch (err) { log("✖ " + err.message, "xato"); }
      holatYangila();
      $("hamma").disabled = false;
    };

    // Avtomatik yig'ish: sahifa ochilganda va jadval o'zgarganda (varaqlash,
    // filtr). Tez-tez o'zgarishda 400 ms kutib bir marta o'qiladi.
    let t = null;
    const kech = () => { clearTimeout(t); t = setTimeout(() => shuSahifa(true), 400); };
    new MutationObserver(kech).observe(document.body, { childList: true, subtree: true });

    W.__SJ_OQUVCHI__ = { ochish: () => panel.classList.add("ochiq"), yigim: () => y, jadval: () => turonJadval(document) };

    holatYangila();
    shuSahifa(true);
    log(Object.keys(y.qatorlar).length
      ? "Tayyor. «🔄 Hamma sahifani o'qish» — to'liq yangilash; «📤 Uzatish» — eMaktabga."
      : "Tayyor. «🔄 Hamma sahifani o'qish» ni bosing.", "dim");
  }

  if (!EMAKTAB_REJIM) { turonPanel(); return; }

  // ===================================================================
  //  9-QISM. PANEL (eMaktab)
  // ===================================================================
  const sh = panelYasa("sj-oq-host", `
    <div class="wrap">
      <button class="fab" id="fab" title="Turon → eMaktab o'quvchilar">T→E</button>
      <div class="panel" id="panel" style="position:relative;">
        <button class="x" id="yopish">✕</button>
        <h3>Turon → eMaktab: o'quvchilar</h3>
        <div class="sub">Ro'yxatlarni solishtiradi. Amallar avval SINOV rejimida ko'rsatiladi.</div>

        <div class="qadam">
          <b>1. Turon ro'yxati</b>
          <textarea id="turon" placeholder="Turon → O'quvchilar → Excel'ga eksport → hammasini nusxalab shu yerga qo'ying (sarlavha qatori bilan). JSON ham bo'ladi."></textarea>
          <div class="qator">
            <button class="b b-alt" id="fayl">📂 Fayldan</button>
            <button class="b b-alt" id="oqish">✔ Tekshirish</button>
            <span class="holat" id="turonHolat"></span>
          </div>
          <input type="file" id="fileinp" accept=".csv,.tsv,.txt,.json" style="display:none">
        </div>

        <div class="qadam">
          <b>2. Filial harflari va sinf mosligi</b>
          <div class="qator" style="align-items:flex-start;">
            <div style="flex:1">
              <div class="holat">filial = eMaktab qo'shimcha harfi</div>
              <textarea id="filial" style="height:64px"></textarea>
            </div>
            <div style="flex:1.4">
              <div class="holat">Turon sinf | filial = eMaktab sinf</div>
              <textarea id="sinfMap" style="height:64px" placeholder="8-Ijtimoiy | Furqat = 8 I&#10;Aniq 1 | Qo'qon = 10 A Q"></textarea>
            </div>
          </div>
          <div class="qator">
            <button class="b b-alt" id="mapSaqla">💾 Saqlash</button>
            <span class="holat" id="mapHolat"></span>
          </div>
        </div>

        <div class="qadam">
          <b>3. Sinflar (avval shu, keyin o'quvchilar)</b>
          <div class="qator">
            <button class="b b-main" id="sinfTaqqos">🏫 Sinflarni solishtirish</button>
            <button class="b b-alt" id="sinfYarat" disabled>➕ Yetishmagan sinflarni yaratish</button>
          </div>
          <div class="qator">
            <label>sinf sig'imi <input type="number" id="sigim" value="35" min="10" max="60"> bola</label>
            <span class="holat">yo'nalishli guruhlar (8-Ijtimoiy, Aniq-1…) shu sig'imga bo'linadi</span>
          </div>
          <div class="holat" id="sinfHolat">Harfli sinf («4-A» Qo'qon → «4 A Q») yo'q bo'lsa yaratiladi. SINOV belgisi (5-bo'lim) bu yerga ham tegishli.</div>
        </div>

        <div class="qadam">
          <b>4. O'quvchilarni solishtirish</b>
          <!-- ⚠️ BIR TUGMA: solishtiradi va qo'shish + ko'chirishni sinf
               tartibida bajaradi. CHIQARISH bunga kirmaydi — u faqat
               4-bo'limdagi alohida belgi bilan. -->
          <div class="qator">
            <button class="b b-main" id="avto"
              style="width:100%;padding:11px;font-size:13px;background:linear-gradient(135deg,#6366f1,#8b5cf6);">
              🚀 HAMMASINI AVTOMATIK (solishtirish + chiqarish + qo'shish + ko'chirish)
            </button>
          </div>
          <div class="qator">
            <button class="b b-main" id="taqqos">🔎 eMaktabni o'qib solishtirish</button>
            <button class="b b-alt" id="csv" title="Bitta Excel fayl: Xulosa (farq sababi) · Amallar · Turon dublikatlar · Tug'ilgan sana (nima uchun o'zgargani) · Mos">📊 Excel hisobot</button>
            <span class="holat" id="taqqosHolat"></span>
          </div>
          <div class="stat" id="stat" style="display:none">
            <div><span id="nQosh">0</span><small>＋ qo'shish</small></div>
            <div><span id="nKoch">0</span><small>➜ ko'chirish</small></div>
            <div><span id="nChiq">0</span><small>－ chiqarish</small></div>
            <div><span id="nMos">0</span><small>＝ mos</small></div>
            <div><span id="nShub">0</span><small>⚠ shubhali</small></div>
            <div><span id="nSinfsiz">0</span><small>? sinf yo'q</small></div>
          </div>
        </div>

        <div class="qadam">
          <b>5. Bajarish</b>
          <div class="qator">
            <label><input type="checkbox" id="sinov" checked> SINOV — hech narsa yuborilmaydi</label>
          </div>
          <div class="qator">
            <label><input type="checkbox" id="aQosh" checked> qo'shish</label>
            <label><input type="checkbox" id="aKoch" checked> ko'chirish</label>
            <label><input type="checkbox" id="aChiq"> CHIQARISH (qaytarib bo'lmaydi!)</label>
            <label><input type="checkbox" id="telefon"> telefon ham</label>
          </div>
          <div class="qator">
            <button class="b b-main" id="yur" disabled>▶ Bajarish</button>
            <button class="b b-warn" id="toxta" style="display:none">■ To'xtatish</button>
            <span class="holat" id="yurHolat"></span>
          </div>
          <div class="pb"><i id="pbar"></i></div>
        </div>

        <div class="qadam">
          <b>🔍 O'rganish — forma to'ldirilmasa</b>
          <div class="holat" style="margin-bottom:5px;">«Boshlash» → eMaktabda bitta o'quvchini QO'LDA yarating / sinfini o'zgartiring / chiqaring → «To'xtatish» → faylni dasturchiga bering.</div>
          <div class="qator">
            <button class="b b-alt" id="recOn">⏺ Boshlash</button>
            <button class="b b-alt" id="recOff">⏹ To'xtatish va saqlash</button>
            <button class="b b-alt" id="formaKor" title="Yaratish formasining maydonlarini jurnalga chiqaradi">🧾 Yaratish formasi</button>
            <button class="b b-alt" id="adminKor" title="Boshqaruv bo'limlarining hamma havolasini jurnalga chiqaradi — o'tkazish/chiqarish bo'limini topish uchun">🗂 Admin bo'limlari</button>
          </div>
        </div>

        <div class="log" id="log"></div>
      </div>
    </div>`);

  const $ = (id) => sh.getElementById(id);
  const panel = $("panel");
  let turon = null;
  let turonFaol = 0;     // Turon sahifasidagi «Faol» soni — ro'yxat to'liqligi mezoni
  let natija = null;

  function log(msg, cls) {
    const el = $("log");
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  $("fab").onclick = () => lsYoz(LS_OCHIQ, panel.classList.toggle("ochiq") ? "1" : "0");
  $("yopish").onclick = () => { panel.classList.remove("ochiq"); lsYoz(LS_OCHIQ, "0"); };
  $("fayl").onclick = () => $("fileinp").click();
  $("fileinp").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $("turon").value = String(r.result || ""); turonOqi(); };
    r.readAsText(f);
  };

  function turonOqi() {
    try {
      turon = turonParse($("turon").value);
      lsYoz(LS_TURON, $("turon").value);
      const filiallar = new Map();
      turon.forEach((o) => filiallar.set(o.filial || "(bo'sh)", (filiallar.get(o.filial || "(bo'sh)") || 0) + 1));
      const nofaol = (turon.nofaol || []).length;
      $("turonHolat").textContent = `✔ ${turon.length} faol o'quvchi${nofaol ? ` (${nofaol} nofaol tashlandi)` : ""}`;
      log(`✔ Turon: ${turon.length} faol o'quvchi — ` + [...filiallar.entries()].map(([f, n]) => `${f}: ${n}`).join(", ")
        + (nofaol ? `. ${nofaol} qator STATUS ≠ «Faol» — olinmadi (eMaktabda bo'lsa chiqariladi, ro'yxati Excel «Nofaol (Turon)» varag'ida)` : ""), "ok");
      return true;
    } catch (err) {
      turon = null;
      $("turonHolat").textContent = "✖ " + err.message;
      return false;
    }
  }
  $("oqish").onclick = turonOqi;

  $("filial").value = lsOl(LS_FILIAL, FILIAL_DEF);
  $("sinfMap").value = lsOl(LS_SINF, "");
  $("mapSaqla").onclick = () => {
    lsYoz(LS_FILIAL, $("filial").value);
    lsYoz(LS_SINF, $("sinfMap").value);
    $("mapHolat").textContent = `✔ ${filialXarita($("filial").value).size} filial, ${sinfXarita($("sinfMap").value).size} qo'lda sinf`;
  };

  // ⚠️ NATIJA SAQLANADI — F5 DAN KEYIN DAVOM (maktab talabi, 22.09.2026:
  //  «sessiyani yangilasam qilgan amallar o'chib, boshidan solishtirishga
  //  to'g'ri kelyapti»). Solishtirish natijasi (qolgan qo'shish / ko'chirish
  //  / chiqarish ro'yxatlari) localStorage'da turadi; har bajarilgan amal
  //  ro'yxatdan olib tashlanib qayta saqlanadi. Sahifa ochilganda Turon
  //  ro'yxati o'zgarmagan bo'lsa natija tiklanadi — «🔎» shart emas, «🚀»
  //  qolgan joyidan ketadi. «🔎» qayta bosilsa yangisi yoziladi.
  //  «mos» ro'yxati saqlanmaydi (kerak emas), faqat soni.
  let saqlashTaymer = null;
  function natijaSaqla(darhol) {
    if (!natija) { try { localStorage.removeItem(LS_NATIJA); } catch { /* */ } return; }
    const yoz = () => {
      saqlashTaymer = null;
      if (!natija) return;
      const toza = (x) => ({ t: x.t, e: x.e, sabab: x.sabab, izoh: x.izoh });
      lsYoz(LS_NATIJA, JSON.stringify({
        vaqt: new Date().toISOString(), turonVaqt: lsOl(LS_TURON + "_vaqt", ""),
        qoshish: natija.qoshish.map(toza), kochirish: natija.kochirish.map(toza), chiqarish: natija.chiqarish.map(toza),
        shubhali: natija.shubhali.map(toza), sinfsiz: natija.sinfsiz.map(toza),
        mosSoni: natija.mosSoni != null ? natija.mosSoni : natija.mos.length,
        begona: [...(natija.begonaKalitlar || [])], emkSinflar: [...natija.emkSinflar], sinfIdlari: [...natija.sinfIdlari],
        turonDublikat: (natija.turonDublikat || []).map((x) => ({ t: x.t, asosiy: x.asosiy })), xulosa: natija.xulosa || null,
        turonNofaol: natija.turonNofaol || [],
      }));
    };
    if (darhol) { clearTimeout(saqlashTaymer); yoz(); return; }
    if (!saqlashTaymer) saqlashTaymer = setTimeout(yoz, 1500);
  }
  function natijaTikla() {
    let s; try { s = JSON.parse(lsOl(LS_NATIJA, "") || "null"); } catch { s = null; }
    if (!s || !s.qoshish) return null;
    if (s.turonVaqt !== lsOl(LS_TURON + "_vaqt", "")) return null;   // Turon ro'yxati yangilangan — eskirgan
    const r = {
      qoshish: s.qoshish || [], kochirish: s.kochirish || [], chiqarish: s.chiqarish || [],
      shubhali: s.shubhali || [], sinfsiz: s.sinfsiz || [], mos: [], mosSoni: s.mosSoni || 0,
      begonaKalitlar: new Set(s.begona || []), emkSinflar: new Map(s.emkSinflar || []), sinfIdlari: new Map(s.sinfIdlari || []),
      sinfXarita: new Map(), vaqt: s.vaqt,
      turonDublikat: s.turonDublikat || [], xulosa: s.xulosa || null, turonNofaol: s.turonNofaol || [],
    };
    // e._k (ism kaliti) tiklanmagan bo'lishi mumkin — chiqarish uchun kerak emas, lekin bo'lsin
    [...r.kochirish, ...r.chiqarish, ...r.shubhali].forEach((x) => { if (x.e && !x.e._k) x.e._k = ismKalit(x.e.fio); });
    // ⚠️ Skript xatosi tufayli qo'yilgan «rad» belgilari tozalanadi — bola
    //  qayta urinilsin (22.09.2026: «chiqish sababini ko‘rsating» — dismReason
    //  bo'sh yuborilgan, 0.8.8 da tuzatildi).
    r.chiqarish.forEach((x) => { if (x.sabab && /chiqish sababini/i.test(x.sabab)) delete x.sabab; });
    // 0.8.9: «allaqachon maktabda mavjud» — endi mavjud odam qidirilib
    //  sinfga biriktiriladi; eski «rad» belgisi olib tashlanadi, qayta urinilsin.
    r.qoshish.forEach((x) => { if (x.sabab && /qayta ko'rsatdi.*allaqachon/i.test(x.sabab)) delete x.sabab; });
    // 0.9.0: tug'ilgan sana endi tuzatiladi — eski «sana xato» belgisi tozalanadi
    r.qoshish.forEach((x) => { if (x.sabab && /tug'ilgan sana/i.test(x.sabab)) delete x.sabab; });
    return r;
  }

  function statKo(r) {
    $("stat").style.display = "";
    $("nQosh").textContent = r.qoshish.length;
    $("nKoch").textContent = r.kochirish.length;
    $("nChiq").textContent = r.chiqarish.length;
    $("nMos").textContent = r.mosSoni != null ? r.mosSoni : r.mos.length;
    $("nShub").textContent = r.shubhali.length;
    $("nSinfsiz").textContent = r.sinfsiz.length;
  }

  $("taqqos").onclick = async () => {
    if (!turon && !turonOqi()) { log("✖ Avval Turon ro'yxatini tekshiring", "xato"); return; }
    if (!schoolId) { log("✖ URL da `school` yo'q — «Odamlarni izlash» sahifasini oching", "xato"); return; }
    $("taqqos").disabled = true;
    natija = null; $("yur").disabled = true; $("csv").disabled = true;
    try {
      log("📥 eMaktab o'quvchilari o'qilmoqda…", "ok");
      const { royxat, jami } = await emaktabRoyxati((m) => { $("taqqosHolat").textContent = m; });
      log(`✔ eMaktab: ${royxat.length} o'quvchi o'qildi${jami ? ` (sahifada «topildi: ${jami}»)` : ""}`, royxat.length && jami && royxat.length < jami ? "ogoh" : "ok");
      if (!royxat.length) throw new Error("ro'yxat bo'sh chiqdi — jadval tuzilishi o'zgargan bo'lishi mumkin, «O'rganish» bilan sahifani yozib bering");
      if (jami && royxat.length < jami) {
        log(`⚠ Hammasi o'qilmadi (${jami - royxat.length} ta yetishmaydi). O'qilmagan qatorlar: havolasiz ${OQILMADI.havolasiz}, `
          + `o'quvchi emas ${OQILMADI.oquvchiEmas}, kam katakli ${OQILMADI.kamKatak}. Chiqarish ro'yxati NOTO'G'RI bo'lishi mumkin — uni yoqmang!`, "ogoh");
        if (OQILMADI.namuna) log("   o'qilmagan qator namunasi: " + OQILMADI.namuna, "dim");
      }
      const idsiz = royxat.filter((x) => !x.tahrir).length;
      if (idsiz) log(`⚠ ${idsiz} qatorda tahrir havolasi topilmadi — ular ko'chirilmaydi/chiqarilmaydi`, "ogoh");

      // Sinflar ro'yxati — «Sinflar» sahifasidan (bo'sh sinflar ham)
      let sinflar = [];
      try {
        sinflar = await emaktabSinflari();
        log(`✔ eMaktab «Sinflar» sahifasi: ${sinflar.length} sinf (bo'shlari ham)`, "ok");
      } catch (err) {
        log(`⚠ Sinflar sahifasi o'qilmadi (${err.message}) — faqat o'quvchisi bor sinflar hisobga olinadi, bo'sh sinf «ochilmagan» ko'rinadi`, "ogoh");
      }
      const filiallar = filialXarita($("filial").value);
      const qolda = sinfXarita($("sinfMap").value);
      natija = taqqosla(turon, royxat, filiallar, qolda, sinflar);
      // Turonda NOFAOL bo'lgan bolalar: eMaktabda topilsa — chiqarish sababi
      //  «Turonda nofaol» bo'ladi, hisobotda alohida varaq.
      natija.turonNofaol = (turon.nofaol || []).map((n) => ({ ...n, emaktab: "" }));
      if (natija.turonNofaol.length) {
        const nofaolK = new Map();
        natija.turonNofaol.forEach((n) => { const k = ismKalit(n.fio); nofaolK.set(k.toliq, n); if (!nofaolK.has(k.qisqa)) nofaolK.set(k.qisqa, n); });
        natija.chiqarish.forEach((x) => {
          const k = x.e._k || ismKalit(x.e.fio);
          const n = nofaolK.get(k.toliq) || nofaolK.get(k.qisqa);
          if (n) { x.izoh = `Turonda status «${n.status || "nofaol"}» (${n.filial || "filialsiz"} ${n.sinf}${n.kod ? ", " + n.kod : ""})`; n.emaktab = `${x.e.sinf || "sinfsiz"} — chiqariladi`; }
        });
        const nofaolChiq = natija.chiqarish.filter((x) => x.izoh).length;
        if (nofaolChiq) log(`ℹ Chiqariladiganlardan ${nofaolChiq} tasi Turonda NOFAOL qilingan bola — sababi Excel «Amallar» da.`, "dim");
      }
      // Excel «Xulosa» varag'i uchun sonlar — solishtirish paytidagi holat
      natija.xulosa = {
        vaqt: new Date().toISOString().slice(0, 16).replace("T", " "),
        turonJami: turon.length, nofaol: natija.turonNofaol.length, dublikat: natija.turonDublikat.length, emaktabJami: royxat.length,
        mos: natija.mos.length, qoshish: natija.qoshish.length, kochirish: natija.kochirish.length,
        chiqarish: natija.chiqarish.length, shubhali: natija.shubhali.length, sinfsiz: natija.sinfsiz.length,
      };
      statKo(natija);

      const ko = (list, f, n = 8) => list.slice(0, n).map(f).join("\n   ") + (list.length > n ? `\n   … jami ${list.length}` : "");
      if (natija.sinfsiz.length) {
        const sabab = new Map();
        natija.sinfsiz.forEach((x) => sabab.set(x.sabab, (sabab.get(x.sabab) || 0) + 1));
        log("? Kutayotgan Turon o'quvchilari (sinf ochilmagan / aniqlanmadi):\n   " + [...sabab.entries()].map(([s, n]) => `${n} ta — ${s}`).join("\n   "), "ogoh");
      }
      // Sinf mosligi jadvali — foydalanuvchi har Turon sinfi qaysi eMaktab
      // sinf(lar)iga tushishini bir qarashda ko'rsin. Bir nechta nomzod
      // («8 A / 8 B») — harfsiz sinf, yangi bola eng kam o'quvchilisiga tushadi.
      const xq = [...natija.sinfXarita.entries()].sort((a, b) => a[0].localeCompare(b[0], "uz", { numeric: true }));
      log("🏫 Sinf mosligi (Turon → eMaktab):\n   " + xq.map(([a, b]) => `${a} → ${b}`).join("\n   "), xq.some(([, b]) => b.startsWith("✖")) ? "ogoh" : "dim");
      if (xq.some(([, b]) => b.startsWith("✖"))) {
        log(`   eMaktab sinflari: ${[...natija.emkSinflar.values()].sort((a, b) => a.localeCompare(b, "uz", { numeric: true })).join(", ")}`, "dim");
      }
      // ⚠️ eMaktabda bor, lekin Turonning birorta sinfi tushmaydigan sinflar.
      //  Jonli maktabda «1 I», «1 G», «1 J», «1 D» shunday chiqdi — Turon
      //  Furqatida bunday sinf yo'q, Qo'qonda esa bor. Ehtimol boshqa
      //  filial sinfi eMaktabda FILIAL HARFISIZ ochilgan. Bu holda skript
      //  ularni Furqatniki deb biladi va ichidagi bolalarni «Turonda yo'q»
      //  deb chiqarishga qo'yadi. Foydalanuvchi eMaktabda sinf nomini
      //  «1 I Q» ga o'zgartirsa hammasi o'z joyiga tushadi.
      const nishonlar = new Set();
      [...natija.mos, ...natija.qoshish, ...natija.kochirish].forEach((x) => { if (x.t._sinfK) nishonlar.add(x.t._sinfK); });
      xq.forEach(([, b]) => { if (!b.startsWith("✖")) b.split(" / ").forEach((n) => nishonlar.add(classKey(n))); });
      const soni = new Map();
      royxat.forEach((e) => { const k = classKey(e.sinf); if (k) soni.set(k, (soni.get(k) || 0) + 1); });
      const begona = [...natija.emkSinflar.entries()].filter(([k]) => !nishonlar.has(k))
        .sort((a, b) => a[1].localeCompare(b[1], "uz", { numeric: true }));
      // Begona sinf bolalari chiqarilMAYDI (bajar() da tashlab ketiladi) —
      // ular ehtimol filial harfisiz ochilgan sinfning haqiqiy o'quvchilari.
      natija.begonaKalitlar = new Set(begona.map(([k]) => k));
      if (begona.length) {
        log("⚠ eMaktabda bor, Turonda (shu qoida bilan) mos sinfi YO'Q sinflar:\n   "
          + begona.map(([k, n]) => `${n} (${soni.get(k) || 0} o'quvchi)`).join(", ")
          + "\n   Bular boshqa filial sinfi bo'lsa, eMaktabda nomiga filial harfini qo'shing (masalan «1 I» → «1 I Q»). "
          + "Ichidagi bolalar Turonda ismi topilmasa boshqalar qatori CHIQARILADI (0.9.0) — noto'g'ri bo'lsa avval sinf nomini to'g'rilab yana solishtiring.", "ogoh");
      }
      if (natija.turonDublikat && natija.turonDublikat.length) {
        log(`⚠ Turon ro'yxatida ${natija.turonDublikat.length} bola IKKI marta uchraydi (ism + tug'ilgan sana bir xil) — faqat filialli qatori olindi, ikkinchisi tashlandi. Turonda ortiqcha yozuvni o'chiring (Excel «Turon dublikatlar» varag'i):\n   `
          + natija.turonDublikat.slice(0, 12).map((x) => `${x.t.fio} (${x.t.filial || "filialsiz"} ${x.t.sinf}) ↔ ${x.asosiy.filial || "filialsiz"} ${x.asosiy.sinf}`).join("\n   ")
          + (natija.turonDublikat.length > 12 ? `\n   … jami ${natija.turonDublikat.length}` : ""), "ogoh");
      }
      const sinfsizE = royxat.filter((e) => !e.sinf).length;
      if (sinfsizE) log(`ℹ eMaktabda sinfi biriktirilmagan ${sinfsizE} o'quvchi bor — Turonda topilsa sinfi biriktiriladi (ko'chirish).`, "dim");
      if (natija.qoshish.length) log("＋ Qo'shiladi:\n   " + ko(natija.qoshish, (x) => `${x.t.fio} → ${x.t._emkSinf || x.t._sinfK}`), "ok");
      if (natija.kochirish.length) log("➜ Ko'chiriladi:\n   " + ko(natija.kochirish, (x) => `${x.e.fio}: ${x.e.sinf} → ${x.t._emkSinf}`), "ok");
      if (natija.chiqarish.length) log("－ Chiqariladi (Turonda yo'q):\n   " + ko(natija.chiqarish, (x) => `${x.e.fio} (${x.e.sinf})`), "ogoh");
      if (natija.shubhali.length) log("⚠ Shubhali (ismi o'xshash, avtomatik bajarilmaydi):\n   " + ko(natija.shubhali, (x) => `Turon «${x.t.fio}» ↔ eMaktab «${x.e.fio}» (${x.e.sinf})`), "ogoh");
      log(`＝ ${natija.mos.length} o'quvchi joyida. To'liq ro'yxat — «📊 Excel hisobot».`, "dim");
      $("yur").disabled = false; $("csv").disabled = false;
      natijaSaqla(true);
    } catch (err) {
      log("✖ " + err.message, "xato");
      // ⚠️ Solishtirish boshidayoq uzilsa (sessiya tugagan) — saqlangan eski
      //  natija xotiraga qaytariladi, «🚀» qayta kirishdan keyin o'sha joyidan
      //  davom etadi (22.09.2026: 🔎 «Failed to fetch» bilan yiqilib, eski
      //  natija ham xotiradan yo'qolgan edi).
      if (!natija) {
        const eski = natijaTikla();
        if (eski) {
          natija = eski; statKo(natija);
          $("yur").disabled = false; $("csv").disabled = false;
          log(`♻ Oldingi solishtirish saqlanib qoldi: qoldi ${natija.qoshish.length} qo'shish, ${natija.kochirish.length} ko'chirish, ${natija.chiqarish.length} chiqarish. Qayta kirgach «🚀» shu joyidan davom etadi.`, "ok");
        }
      }
      if (/sessiya tugagan|so'rov ketmadi|Failed to fetch/i.test(err.message)) {
        log("ℹ Sessiya fonda ham tiklanmadi — demak SSO (login.emaktab.uz) ham tugagan. eMaktabga QAYTA KIRING (login/parol), so'ng shu sahifani oching va «🚀» ni bosing.", "ogoh");
      }
    }
    $("taqqos").disabled = false;
    $("taqqosHolat").textContent = "";
  };

  // ——— 3. SINFLAR: solishtirish va yaratish ———
  let sinfReja = null;
  $("sinfTaqqos").onclick = async () => {
    if (!turon && !turonOqi()) { log("✖ Avval Turon ro'yxatini tekshiring", "xato"); return; }
    if (!schoolId) { log("✖ URL da `school` yo'q — eMaktab Boshqaruv sahifasini oching", "xato"); return; }
    $("sinfTaqqos").disabled = true; $("sinfYarat").disabled = true;
    try {
      log("🏫 eMaktab sinflari o'qilmoqda…", "ok");
      const sinflar = await emaktabSinflari();
      const sigim = Number($("sigim").value) || 35;
      sinfReja = sinfRejasi(turon, filialXarita($("filial").value), sinfXarita($("sinfMap").value), sinflar, sigim);
      log(`✔ eMaktabda ${sinflar.length} sinf. Turon bo'yicha reja (sig'im ${sigim}):`, "ok");
      log("   " + sinfReja.guruhHisobi.map((g) => `${g.filial} ${g.daraja}-sinf: ${g.soni} bola (${g.harfsiz} yo'nalishli) → kerak ${g.kerak}, bor: ${g.mavjud.join(", ") || "yo'q"}${g.yangi.length ? " → YANGI: " + g.yangi.join(", ") : ""}`).join("\n   "), "dim");
      if (sinfReja.sabab.size) log("⚠ Sinfi aniqlanmagan Turon bolalari:\n   " + [...sinfReja.sabab.entries()].map(([s, n]) => `${n} ta — ${s}`).join("\n   "), "ogoh");
      if (!sinfReja.yaratish.length) { log("＝ Hamma kerakli sinf eMaktabda bor — endi «🔎 eMaktabni o'qib solishtirish».", "ok"); $("sinfHolat").textContent = "✔ sinflar to'liq"; return; }
      log(`➕ Yaratiladigan sinflar (${sinfReja.yaratish.length}):\n   ` + sinfReja.yaratish.map((y) => `${y.nom} — ${y.izoh}`).join("\n   "), "ogoh");
      $("sinfHolat").textContent = `${sinfReja.yaratish.length} sinf yetishmaydi — «➕» bilan yarating (avval SINOV bilan)`;
      $("sinfYarat").disabled = false;
    } catch (err) { log("✖ " + err.message, "xato"); }
    $("sinfTaqqos").disabled = false;
  };

  $("sinfYarat").onclick = async () => {
    if (!sinfReja || !sinfReja.yaratish.length) { log("✖ Avval «🏫 Sinflarni solishtirish»", "xato"); return; }
    const sinov = $("sinov").checked;
    let ish = sinov ? sinfReja.yaratish.slice(0, 2) : sinfReja.yaratish;
    if (!sinov) {
      // Reja eskirgan bo'lishi mumkin («1 F» avvalgi urinishda yaratilgan, lekin
      // «🏫» qayta bosilmagan) — ro'yxat yangidan o'qilib, borlari tashlanadi
      try {
        const hozir = await emaktabSinflari();
        const bor = ish.filter((y) => hozir.some((s) => classKey(s.nom) === classKey(y.nom)));
        if (bor.length) { log(`＝ Allaqachon bor, o'tkazib yuboriladi: ${bor.map((y) => y.nom).join(", ")}`, "dim"); ish = ish.filter((y) => !bor.includes(y)); sinfReja.yaratish = sinfReja.yaratish.filter((y) => !bor.includes(y)); }
        if (!ish.length) { log("＝ Hamma kerakli sinf eMaktabda bor — endi «🔎 eMaktabni o'qib solishtirish».", "ok"); $("sinfHolat").textContent = "✔ sinflar to'liq"; $("sinfYarat").disabled = true; return; }
      } catch (err) { log("✖ " + err.message, "xato"); return; }
    }
    if (!sinov && !window.confirm(`eMaktabda ${ish.length} ta sinf yaratiladi:\n${ish.map((y) => y.nom).join(", ")}\nDavom etilsinmi?`)) { log("■ Bekor qilindi", "ogoh"); return; }
    $("sinfYarat").disabled = true; $("sinfTaqqos").disabled = true;
    HOLAT.toxtat = false; $("toxta").style.display = "";
    log(`▶ ${ish.length} sinf${sinov ? " — SINOV, faqat forma ko'rsatiladi (2 tagacha)" : ""}`, "ok");
    let ok = 0, xato = 0;
    const yaratildi = [];
    try {
      for (const y of ish) {
        if (HOLAT.toxtat) { log(TOXTATILDI, "ogoh"); break; }
        let r;
        try { r = await sinfYarat(y, { sinov }); }
        catch (err) { if (err.message === TOXTATILDI) { log(TOXTATILDI, "ogoh"); break; } r = { ok: false, sabab: "kutilmagan xato: " + err.message }; }
        if (r.ok) { ok++; log(`＋ ${y.nom}${r.sinov ? " (sinov)" : " ✔"}`, "ok"); if (r.izoh) log("   " + r.izoh.join("\n   "), "dim"); if (!r.sinov) yaratildi.push(y); }
        else if (/sessiya tugagan|so'rov ketmadi|Failed to fetch/i.test(r.sabab)) {
          // Sessiya tugadi — qolganini urinish befoyda; F5 dan keyin «➕» davom etadi
          xato++; log(`✖ ${y.nom} — ${r.sabab}`, "xato");
          log("⏸ Sessiya tugagan ko'rinadi. F5 bosing (kerak bo'lsa qayta kiring), «🏫 Sinflarni solishtirish», so'ng yana «➕» — yaratilganlar qayta yaratilmaydi.", "ogoh");
          break;
        }
        else { xato++; log(`✖ ${y.nom} — ${r.sabab}`, "xato"); if (r.izoh) log("   " + r.izoh.join("\n   "), "dim"); if (ok === 0 && xato >= 2) { log("✖ Ketma-ket xato — to'xtatildi. Jurnaldagi «formadagi maydonlar» qatorini dasturchiga bering.", "xato"); break; } }
        await sleep(sinov ? 50 : 600);
      }
    } finally {
      sinfReja.yaratish = sinfReja.yaratish.filter((y) => !yaratildi.includes(y));
      $("toxta").style.display = "none"; $("sinfTaqqos").disabled = false; $("sinfYarat").disabled = !sinfReja.yaratish.length;
      log(`— Sinflar: ${ok} ${sinov ? "tekshirildi" : "yaratildi"}, ${xato} xato —`, xato ? "ogoh" : "ok");
      if (!sinov && ok) log("Endi «🔎 eMaktabni o'qib solishtirish» — yangi sinflar bilan o'quvchilar taqsimlanadi.", "dim");
    }
  };

  // 🚀 uchun: eMaktab sinflarini o'qib, Turon rejasiga ko'ra yetishmaganini
  //  yaratadi. Qaytadi: yaratilgan sinflar soni (SINOVda 0 — faqat ko'rsatadi).
  async function sinflarniTolat(sinov) {
    log("🏫 Sinflar tekshirilmoqda…", "dim");
    const sinflar = await emaktabSinflari();
    const sigim = Number($("sigim").value) || 35;
    sinfReja = sinfRejasi(turon, filialXarita($("filial").value), sinfXarita($("sinfMap").value), sinflar, sigim);
    if (!sinfReja.yaratish.length) { log(`＝ eMaktabda ${sinflar.length} sinf — Turon uchun kerakli sinflar to'liq.`, "dim"); $("sinfHolat").textContent = "✔ sinflar to'liq"; $("sinfYarat").disabled = true; return 0; }
    log(`➕ Yetishmagan sinflar (${sinfReja.yaratish.length}):\n   ` + sinfReja.yaratish.map((y) => `${y.nom} — ${y.izoh}`).join("\n   "), "ogoh");
    if (sinov) { log("   SINOV — sinflar yaratilmaydi (faqat ko'rsatildi).", "dim"); $("sinfYarat").disabled = false; return 0; }
    if (!window.confirm(`eMaktabda ${sinfReja.yaratish.length} ta sinf yaratiladi:\n${sinfReja.yaratish.map((y) => y.nom).join(", ")}\nDavom etilsinmi? («Отмена» — sinflarsiz davom etadi)`)) { log("■ Sinf yaratish o'tkazib yuborildi", "ogoh"); $("sinfYarat").disabled = false; return 0; }
    let ok = 0, xato = 0;
    const yaratildi = [];
    for (const y of sinfReja.yaratish) {
      if (HOLAT.toxtat) break;
      let r;
      try { r = await sinfYarat(y, { sinov: false }); }
      catch (err) { if (err.message === TOXTATILDI) throw err; r = { ok: false, sabab: "kutilmagan xato: " + err.message }; }
      if (r.ok) { ok++; yaratildi.push(y); log(`＋ sinf ${y.nom} ✔`, "ok"); }
      else {
        xato++; log(`✖ sinf ${y.nom} — ${r.sabab}`, "xato"); if (r.izoh) log("   " + r.izoh.join("\n   "), "dim");
        if (/sessiya tugagan|so'rov ketmadi|Failed to fetch/i.test(r.sabab)) throw new Error(r.sabab);
        if (ok === 0 && xato >= 2) { log("✖ Sinf yaratishda ketma-ket xato — qolgani o'tkazib yuborildi, o'quvchilar bilan davom etiladi.", "xato"); break; }
      }
      await sleep(400);
    }
    sinfReja.yaratish = sinfReja.yaratish.filter((y) => !yaratildi.includes(y));
    $("sinfYarat").disabled = !sinfReja.yaratish.length;
    log(`— Sinflar: ${ok} yaratildi, ${xato} xato —`, xato ? "ogoh" : "ok");
    return ok;
  }

  // 📊 Excel — solishtirish bo'lmasa ham ochiladi (tug'ilgan sana varag'i har doim bor)
  $("csv").onclick = () => {
    try { excelYukla(natija, natija ? "" : "solishtirish hali yo'q, faqat Xulosa va Tug'ilgan sana"); }
    catch (err) { log("✖ Excel yasalmadi: " + err.message, "xato"); }
  };

  // Sessiyani fonda tiklash: yashirin iframe «Odamlarni izlash» sahifasini
  //  yuklaydi (brauzer login.emaktab.uz ga o'tib, SSO bilan qaytadi — F5
  //  bilan bir xil), keyin fetch sinovi. Ikki marta 20 s gacha kutiladi.
  async function sessiyaniTikla() {
    for (let k = 0; k < 2; k++) {
      await new Promise((res) => {
        const f = document.createElement("iframe");
        f.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-9999px;";
        let tugadi = false;
        const fin = () => { if (tugadi) return; tugadi = true; setTimeout(() => f.remove(), 2000); setTimeout(res, 800); };
        f.onload = fin; f.onerror = fin;
        f.src = location.origin + royxatUrl(1);
        document.body.appendChild(f);
        setTimeout(fin, 20000);
      });
      try {
        const r = await fetch(royxatUrl(1), { credentials: "same-origin", __sj: 1 });
        if (r.ok && !/login|auth|signin/i.test(String(r.url || ""))) return true;
      } catch { /* hali uzilgan */ }
      await sleep(2000);
    }
    return false;
  }

  // ⚠️ SESSIYANI TIRIK SAQLASH (22.09.2026: panel ochiq turganda ham sessiya
  //  tugab, 🔎 boshidayoq «Failed to fetch» bergan). eMaktab sessiyasi
  //  ishlatilmasa tugaydi — har 3 daqiqada (oxirgi so'rovdan 3 daqiqa o'tgan
  //  bo'lsa) «Odamlarni izlash» sahifasi fonda bir marta so'raladi, sessiya
  //  muddati uzayadi. Yurish paytida o'zi so'rov ketyapti — qo'shimcha
  //  so'rov yuborilmaydi. Login sahifasiga yo'naltirilsa — jurnalga bir
  //  marta ogohlantirish (qayta kirish kerak).
  const KEEP_ALIVE_MS = 3 * 60 * 1000;
  let keepAliveOgoh = false;
  if (schoolId) {
    setInterval(async () => {
      if (Date.now() - (HOLAT.oxirgiSorov || 0) < KEEP_ALIVE_MS) return;
      HOLAT.oxirgiSorov = Date.now();
      try {
        const r = await fetch(royxatUrl(1), { credentials: "same-origin", __sj: 1 });
        if (/login|auth|signin/i.test(String(r.url || ""))) throw new Error("login");
        keepAliveOgoh = false;
      } catch {
        if (!keepAliveOgoh) { keepAliveOgoh = true; log("⚠ eMaktab sessiyasi tugagan ko'rinadi — «🚀» bosishdan oldin sahifani F5 qiling, kerak bo'lsa qayta kiring.", "ogoh"); }
      }
    }, 60 * 1000);
  }

  // ichki=true — «🚀» dan chaqirilgan: bayroq u yerda tozalangan, bu yerda
  //  qayta tozalanmaydi (solishtirish paytida bosilgan «■» hurmat qilinsin).
  async function bajar(ichki) {
    if (!natija) { log("✖ Avval solishtiring", "xato"); return; }
    if (ichki && HOLAT.toxtat) { log(TOXTATILDI, "ogoh"); return; }
    // ⚠️ TANAFFUS YO'Q, CHEGARA YO'Q (maktab talabi, 22.09.2026: «tanaffus
    //  kerak emas, bosganda hammasini qilsin»). So'rovlar ketma-ket ketadi,
    //  har bola 3–4 so'rov; server javobi o'zi tezlikni belgilaydi.
    const opt = {
      sinov: $("sinov").checked,
      telefon: $("telefon").checked,
      tanaffus: 0,
      limit: Infinity,
    };
    const ishlar = [];
    // Oldingi yurishda server rad etgan (x.sabab) bolalar qayta urinilmaydi —
    //  ular Excel hisobotda sabab bilan turadi; Turon ro'yxati yangilansa
    //  solishtirish qaytadan bo'ladi va yana urinadi.
    const otkazildi = [];
    const tuzatiladi = [];
    if ($("aQosh").checked) natija.qoshish.forEach((x) => {
      if (!x.sabab) {
        const r = tugilganTekshir(x.t);
        if (r.sabab) x.sabab = r.sabab;
        else if (r.tuzat) { tugilganniTuzat(x.t, r.tuzat); tuzatiladi.push(`${x.t.fio}: ${r.tuzat.asl} → ${r.tuzat.yangi} (${r.tuzat.sabab})`); }
      }
      if (x.sabab) otkazildi.push(`${x.t.fio}: ${x.sabab}`); else ishlar.push({ tur: "qoshish", x });
    });
    if (tuzatiladi.length) {
      log(`🩹 ${tuzatiladi.length} bolaning tug'ilgan sanasi TUZATIB yuboriladi (kun.oy Turondan, yil sinfdan; ro'yxati Excel «Tug'ilgan sana» varag'ida):\n   `
        + tuzatiladi.slice(0, 12).join("\n   ") + (tuzatiladi.length > 12 ? `\n   … jami ${tuzatiladi.length}` : ""), "ogoh");
    }
    if ($("aKoch").checked) natija.kochirish.forEach((x) => {
      if (!x.e.tahrir) return;
      if (x.sabab) otkazildi.push(`${x.e.fio}: ${x.sabab}`); else ishlar.push({ tur: "kochirish", x });
    });
    if ($("aChiq").checked) {
      if (turonFaol && turon && turon.length < turonFaol) {
        log(`✖ Chiqarish rad etildi: Turon ro'yxati to'liq emas (${turon.length}/${turonFaol}). `
          + "Avval Turon sahifasida ro'yxatni to'liq yig'ing.", "xato");
      } else {
        // ⚠️ 0.9.0: BEGONA SINF BOLALARI HAM CHIQARILADI (maktab talabi,
        //  26.09.2026: «shunaqa muammo chiqsa avtomatik hal qilsin» — 24 bola
        //  «1 J Q», «1 D», «2-B» da qolib ketgan edi). Ism bo'yicha moslik
        //  filialga qaramay hamma Turon bolasi bilan qilinadi — bola Turonda
        //  qaysi filialda bo'lsa ham topilardi. Topilmagan ekan, u boshqa
        //  chiqariladiganlar bilan teng: Turon ro'yxati to'liq bo'lsa chiqadi.
        //  Faqat jurnalga ogohlantirish qoladi.
        const begona = natija.begonaKalitlar || new Set();
        const begonalar = natija.chiqarish.filter((x) => x.e.tahrir && begona.has(x.e._sinfK) && !x.sabab);
        if (begonalar.length) log(`⚠ ${begonalar.length} bola Turonga mos kelmaydigan sinfda (${[...new Set(begonalar.map((x) => x.e.sinf))].join(", ")}) — Turonda ismi topilmagani uchun ular ham chiqariladi.`, "ogoh");
        natija.chiqarish.filter((x) => x.e.tahrir).forEach((x) => {
          if (x.sabab) otkazildi.push(`${x.e.fio}: ${x.sabab}`); else ishlar.push({ tur: "chiqarish", x });
        });
      }
    }
    if (otkazildi.length) {
      natijaSaqla(false);
      log(`⚠ ${otkazildi.length} bola o'tkazib yuboriladi (server rad etgan yoki ma'lumoti xato — Turonda to'g'rilang, Excel «Amallar» varag'ida):\n   `
        + otkazildi.slice(0, 12).join("\n   ") + (otkazildi.length > 12 ? `\n   … jami ${otkazildi.length}` : ""), "ogoh");
    }
    if (!ishlar.length) { log("ℹ Bajaradigan amal yo'q", "dim"); return; }

    const chiqSoni = ishlar.filter((i) => i.tur === "chiqarish").length;
    if (!opt.sinov && !ichki && chiqSoni) {
      const ok = window.confirm(`${chiqSoni} ta o'quvchi eMaktabdan CHIQARILADI. Bu qaytarib bo'lmaydi. Davom etilsinmi?`);
      if (!ok) { log("■ Chiqarish bekor qilindi", "ogoh"); return; }
    }

    // TARTIB: sinf (raqam, harf, filial), so'ng F.I.O — jurnalda ham,
    // eMaktabda ham sinfma-sinf ketsin. Chiqarish oxirida.
    const tartibKaliti = (i) => {
      const k = i.tur === "chiqarish" ? i.x.e._sinfK : i.x.t._sinfK;
      const m = String(k || "").match(/^(\d{1,2})(.*)$/);
      const nom = i.tur === "chiqarish" ? i.x.e.fio : i.x.t.fio;
      return `${i.tur === "chiqarish" ? "9" : "0"}|${m ? String(m[1]).padStart(2, "0") + m[2] : k}|${normKey(nom)}`;
    };
    ishlar.sort((a, b) => tartibKaliti(a).localeCompare(tartibKaliti(b)));
    const ish = ishlar.slice(0, opt.limit);
    if (!ichki) HOLAT.toxtat = false;
    sinovUsta = 0; sinovKoch = 0; sinovChiq = 0; yolTashxisiSoni = 0;   // har yurishda sahifalar yana 3 marta tekshiriladi
    $("yur").disabled = true; $("toxta").style.display = "";
    log(`▶ ${ish.length}/${ishlar.length} amal${opt.sinov ? " — SINOV, hech narsa yuborilmaydi" : ""}`, "ok");
    let ok = 0, xato = 0, tuzatildiSoni = 0;
    const bajarilgan = [];
    // ⚠️ PARALLEL YURISH (maktab talabi, 22.09.2026: «juda ko'p vaqt ketadi»).
    //  2700 amal × 3–4 so'rov birma-bir ≈ 1.5 soat edi. Har bolaning ustasi
    //  mustaqil (token va holat formaning o'z yashirin maydonlarida, server
    //  sessiyasida emas — tasdiq bosqichlari shuni ko'rsatdi), shuning
    //  uchun PARALLEL ta ishchi bir vaqtda yuradi. Ro'yxat sinf tartibida
    //  qoladi, faqat jurnal qatorlari aralash keladi. Sessiya tugasa yoki
    //  boshida ketma-ket xato bo'lsa hamma ishchi to'xtaydi. SINOVda 1 ta.
    const PARALLEL = opt.sinov ? 1 : 5;
    let navbat = 0, tugadi = 0, umumiyToxta = "";
    // Sessiya uzilganda yarmida qolgan bolalar — tiklangach avval shular
    const qaytaNavbat = [];
    const keyingi = () => (qaytaNavbat.length ? qaytaNavbat.shift() : (navbat < ish.length ? navbat++ : -1));
    const ishchi = async () => {
      for (;;) {
        if (HOLAT.toxtat || umumiyToxta) return;
        const i = keyingi();
        if (i < 0) return;
        const { tur, x } = ish[i];
        const nom = tur === "chiqarish" ? x.e.fio : x.t.fio;
        const belgi = { qoshish: "＋", kochirish: "➜", chiqarish: "－" }[tur];
        let r;
        try {
          if (tur === "qoshish") r = await yaratOdam(x.t, x.t._emkSinf, opt);
          else if (tur === "kochirish") r = await kochirOdam(x.e, x.t._emkSinf, opt, x.t._sinfId);
          else r = await chiqarOdam(x.e, opt);
        } catch (err) {
          if (err.message === TOXTATILDI) { log(`${TOXTATILDI} (${nom} yarmida uzildi — bajarilmadi)`, "ogoh"); return; }
          r = { ok: false, sabab: "kutilmagan xato: " + err.message };
        }
        if (!r.ok && /sessiya tugagan|so'rov ketmadi|Failed to fetch/i.test(r.sabab || "")) {
          // Sessiya tugadi — bola navbatga qaytariladi, hamma ishchi to'xtaydi;
          // pastda sessiya tiklanadi va ishchilar qayta ishga tushadi.
          qaytaNavbat.push(i);
          if (!umumiyToxta) { umumiyToxta = "sessiya"; log(`⏸ Sessiya uzildi (${nom}) — tiklanmoqda…`, "ogoh"); }
          return;
        }
        tugadi++;
        $("yurHolat").textContent = `${tugadi}/${ish.length}`;
        $("pbar").style.width = Math.round((tugadi / ish.length) * 100) + "%";
        if (r.ok) {
          ok++;
          log(`${belgi} ${nom}${r.sinov ? " (sinov)" : " ✔"}`, "ok");
          // Sinovda faqat dastlabki tekshiruvlar batafsil; keyingilar bir qator
          if (r.izoh && (opt.sinov || i < 2 || r.mavjud)) log("   " + r.izoh.join("\n   "), "dim");
          if (!r.sinov) {
            bajarilgan.push(ish[i]);
            // Tug'ilgan sanasi tuzatib yuborilgan yoki eMaktabdagi sanasi Turondan
            // farq qilgan bola — TUZATILDI hisobotiga
            if (tur === "qoshish" && (x.t._tuzatSabab || r.sanaFarqi)) {
              tuzatYoz({ fio: x.t.fio, filial: x.t.filial, sinf: x.t.sinf, emkSinf: x.t._emkSinf || x.t._sinfK,
                asl: x.t._tuzatSabab ? x.t._tugilganAsl : sanaNorm(x.t.tugilgan), yangi: x.t._tuzatSabab ? x.t.tugilgan : r.sanaFarqi,
                sabab: x.t._tuzatSabab || "eMaktabda mavjud yozuvning sanasi boshqa — eMaktabniki qoldi", url: r.url || "" });
              tuzatildiSoni++;
            }
            // Darhol ro'yxatdan chiqarib saqlanadi — F5 bo'lsa ham yo'qolmasin
            natija[tur] = natija[tur].filter((y) => y !== x);
            natijaSaqla(false);
          }
        } else {
          xato++;
          log(`✖ ${belgi} ${nom} — ${r.sabab}`, "xato");
          if (r.izoh && r.izoh.length) log("   " + r.izoh.join("\n   "), "dim");
          // ⚠️ Server RAD ETGAN bola (validatsiya: tug'ilgan sana, yosh, sana
          //  chegarasi…) belgilanadi — keyingi yurishda qayta urinilmaydi,
          //  CSV da sabab bilan chiqadi (22.09.2026: 6 bola har yurishda
          //  qayta yuborilib, «ketma-ket xato» bilan to'xtatib qo'yardi).
          if (!opt.sinov && /qayta ko'rsatdi|qayta chiqdi|qabul qilinmadi|allaqachon bor/i.test(r.sabab || "")) {
            x.sabab = r.sabab; natijaSaqla(false);
          }
          // Boshidayoq FORMA TANILMASA — davom etishning ma'nosi yo'q. Server
          //  bolaning ma'lumotini rad etgani tizimli xato emas — davom etadi.
          const tizimli = /topilmadi|tanilmagan|forma yo'q|tugamadi|kutilmagan xato/i.test(r.sabab || "") && !/allaqachon bor/i.test(r.sabab || "");
          if (ok === 0 && xato >= 2 && tizimli && !umumiyToxta) { umumiyToxta = "xato"; log("✖ Ketma-ket tizimli xato — to'xtatildi. «🧾 Yaratish formasi» yoki «🔍 O'rganish» bilan formani yozib bering.", "xato"); return; }
        }
        if (opt.sinov) await sleep(20);
      }
    };
    // ⚠️ SESSIYA O'ZI TIKLANADI (22.09.2026: 1265 boladan keyin «Failed to
    //  fetch» — foydalanuvchi F5 → 🔎 → 🚀 qilishi kerak edi). Endi uzilganda
    //  fonda yashirin iframe bilan sahifa qayta yuklanadi (F5 kabi — SSO
    //  cookie tirik bo'lsa login o'zi o'tadi), so'ng ishchilar davom etadi.
    //  5 marta urinib ham tiklanmasa — qo'lda kirish kerak, to'xtaydi.
    for (let urinish = 0; ; urinish++) {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, ish.length) }, ishchi));
      if (HOLAT.toxtat || umumiyToxta !== "sessiya" || urinish >= 5) break;
      const tiklandi = await sessiyaniTikla();
      if (!tiklandi) {
        xato += qaytaNavbat.length;
        log("✖ Sessiya tiklanmadi — eMaktabga qayta kiring (F5), «🔎 eMaktabni o'qib solishtirish», so'ng yana 🚀. Bajarilganlar takrorlanmaydi.", "xato");
        break;
      }
      log(`✔ Sessiya tiklandi — davom etilmoqda (${tugadi}/${ish.length})`, "ok");
      umumiyToxta = "";
    }
    if (HOLAT.toxtat) log(TOXTATILDI, "ogoh");
    // Bajarilganlar natijadan olib tashlanadi — qayta bosilganda takrorlanmasin
    bajarilgan.forEach(({ tur, x }) => { natija[tur] = natija[tur].filter((y) => y !== x); });
    if (!opt.sinov) natijaSaqla(true);
    statKo(natija);
    $("toxta").style.display = "none"; $("yur").disabled = false; $("yurHolat").textContent = "";
    log(`— Yakun: ${ok} ${opt.sinov ? "tekshirildi" : "bajarildi"}, ${xato} xato —`, xato ? "ogoh" : "ok");
    if (!opt.sinov && ok) log("🔄 Sahifani yangilab (F5) qayta solishtiring — natija tekshirilsin.", "dim");
    // Har haqiqiy yurish oxirida Excel hisobot o'zi yuklanadi
    if (!opt.sinov && (ok || xato || tuzatildiSoni)) {
      if (tuzatildiSoni) log(`🩹 ${tuzatildiSoni} bolaning tug'ilgan sanasi tuzatib yozildi — sababi Excel «Tug'ilgan sana» varag'ida (Turonda va eMaktabda hujjat bo'yicha to'g'rilang).`, "ogoh");
      try { excelYukla(natija, `${ok} bajarildi, ${xato} xato`); } catch (err) { log("✖ Excel yasalmadi: " + err.message, "xato"); }
    }
  }
  $("yur").onclick = () => bajar(false);

  // ——— 🚀 HAMMASINI AVTOMATIK ———
  //  Solishtiradi (kerak bo'lsa), keyin qo'shish + ko'chirish + CHIQARISHni
  //  kutishsiz, sinf tartibida bajaradi (maktab talabi, 22.09.2026: «bir
  //  bosishda o'chirib, qo'shib, ko'chirsin»). Bitta tasdiq oynasi uchala
  //  sonni ko'rsatadi. 0.9.0: avval yetishmagan sinflar yaratiladi, begona
  //  sinf bolalari ham chiqariladi, tug'ilgan sana tuzatib yuboriladi.
  //  SINOV belgisi hurmat qilinadi: yoqiq bo'lsa faqat ko'rsatiladi.
  async function hammasiAvto() {
    const btn = $("avto");
    btn.disabled = true;
    HOLAT.toxtat = false;
    $("toxta").style.display = "";   // solishtirish paytida ham to'xtatib bo'lsin
    try {
      if (!turon && !turonOqi()) { log("✖ Turon ro'yxati yo'q — avval Turon sahifasida «🔄 Hamma sahifani o'qish»", "xato"); return; }
      const sinov = $("sinov").checked;
      // 0) SINFLAR — yetishmagani o'zi yaratiladi (maktab talabi, 26.09.2026:
      //    «sinf yaratish kerak bo'lsa yaratib qo'shsin»). Sinf yaratilsa
      //    solishtirish yangidan qilinadi — kutayotgan bolalar sinfga tushsin.
      try {
        await sinflarniTolat(sinov);
      } catch (err) {
        if (err.message === TOXTATILDI) { log(TOXTATILDI, "ogoh"); return; }
        log(`⚠ Sinflar tekshirilmadi (${err.message}) — o'quvchilar bilan davom etiladi`, "ogoh");
      }
      if (HOLAT.toxtat) { log(TOXTATILDI, "ogoh"); return; }
      // ⚠️ 🚀 HAR DOIM YANGIDAN SOLISHTIRADI (26.09.2026: 06:05 dagi eski natija
      //  bilan yurilib, shu orada qo'lda qo'shilgan bolalar «yangi» deb
      //  hisoblandi va boshqa sinfga ko'chirildi). Solishtirish ~40 s —
      //  xato ko'chirishdan arzon. Saqlangan natija «▶ Bajarish» uchun qoladi.
      natija = null;
      if (!natija) {
        await $("taqqos").onclick();
        if (HOLAT.toxtat) { log(TOXTATILDI, "ogoh"); return; }
        if (!natija) return;
      }
      const turonToliq = !(turonFaol && turon && turon.length < turonFaol);
      // x.sabab — oldingi yurishda server rad etgan / tuzatib bo'lmaydigan bolalar, ular sanalmaydi
      const qosh = natija.qoshish.filter((x) => !x.sabab && !tugilganMuammosi(x.t)).length;
      const tuzat = natija.qoshish.filter((x) => !x.sabab && tugilganTekshir(x.t).tuzat).length;
      const koch = natija.kochirish.filter((x) => !x.sabab && x.e.tahrir).length;
      const chiq = turonToliq ? natija.chiqarish.filter((x) => !x.sabab && x.e.tahrir).length : 0;
      const n = qosh + koch + chiq;
      const rad = natija.qoshish.length + natija.kochirish.length - qosh - koch;
      if (!n) { log(`＝ Qo'shadigan / ko'chiradigan / chiqaradigan bola yo'q — hammasi joyida.${rad ? ` (${rad} bola rad etilgan — Excel «Amallar» dagi sababni Turonda to'g'rilang.)` : ""}`, "ok"); return; }
      if (!turonToliq) log(`⚠ Turon ro'yxati to'liq emas (${turon.length}/${turonFaol}) — chiqarish o'tkazib yuboriladi.`, "ogoh");
      if (!sinov && !window.confirm(`${qosh} ta qo'shiladi (${tuzat} tasining tug'ilgan sanasi tuzatib yoziladi), ${koch} ta ko'chiriladi, ${chiq} ta maktabdan CHIQARILADI (qaytarib bo'lmaydi).${rad ? `\n${rad} ta rad etilgan bola o'tkazib yuboriladi.` : ""}\nDavom etilsinmi?`)) {
        log("■ Bekor qilindi", "ogoh"); return;
      }
      $("aQosh").checked = true; $("aKoch").checked = true; $("aChiq").checked = turonToliq;
      log(`🚀 ${n} amal sinf tartibida, kutishsiz${sinov ? " (SINOV)" : ""}…`, "ok");
      await bajar(true);
    } finally { btn.disabled = false; $("toxta").style.display = "none"; }
  }
  $("avto").onclick = hammasiAvto;
  $("toxta").onclick = () => {
    HOLAT.toxtat = true;
    log("■ To'xtatish so'raldi — hozirgi so'rov uzilgach to'xtaydi…", "ogoh");
  };

  $("recOn").onclick = () => {
    REC.yoniq = true; REC.yozuv = [{ tur: "sahifa", url: location.href, vaqt: new Date().toISOString() }];
    lsYoz(LS_REC_ON, "1"); recSaqla();
    log("⏺ Yozuv yoqildi — endi amalni qo'lda bajaring (sahifa almashsa ham davom etadi).", "ok");
  };
  $("recOff").onclick = () => {
    REC.yoniq = false; lsYoz(LS_REC_ON, "0");
    const dump = JSON.stringify({ sj_oquvchi_orgatish: 1, sahifa: location.href, vaqt: new Date().toISOString(), yozuv: REC.yozuv }, null, 2);
    yuklab("oquvchi-dump.json", dump, "application/json");
    log(`⏹ Yozuv to'xtadi: ${REC.yozuv.length} yozuv — «oquvchi-dump.json» saqlandi. Uni dasturchiga bering.`, "ok");
  };
  $("formaKor").onclick = async () => {
    try {
      const url = yaratishUrl();
      const { doc, html } = await sahifa(url);
      // Sahifaning o'zi faylga — forma tanilmasa dasturchi aynan shuni ko'radi
      yuklab("yaratish-sahifa.html", html, "text/html");
      log("💾 yaratish-sahifa.html saqlandi — forma tanilmasa shu faylni dasturchiga bering.", "dim");
      const form = formaTanla(doc);
      if (!form) { log(`✖ ${url} da ko'rinadigan maydonli forma topilmadi.\n   ${sahifaTashxisi(doc, url)}`, "xato"); return; }
      const qat = [...form.querySelectorAll("input, select, textarea")].filter((el) => el.getAttribute("name")).map((el) => {
        const tur = maydonTuri(maydonYorligi(el, form));
        const v = el.tagName === "SELECT" ? ` {${[...el.options].slice(0, 6).map(txt).join(" / ")}${el.options.length > 6 ? " …" : ""}}` : "";
        return `${el.getAttribute("name")} (${el.type || el.tagName.toLowerCase()})${v} → ${tur || "?"}`;
      });
      log(`🧾 Yaratish formasi: ${url}\n   action=${form.getAttribute("action") || "(o'zi)"} method=${form.getAttribute("method") || "get"}\n   ` + qat.join("\n   "), "dim");
      log("«?» bo'lgan maydonlar tanilmagan. familiya/ism/sinf tanilmasa — bu ro'yxatni dasturchiga bering.", "ogoh");
    } catch (err) { log("✖ " + err.message, "xato"); }
  };

  // ⚠️ O'TKAZISH TUGMASI SHAXS SAHIFASIDA HAM, SINF SAHIFASIDA HAM YO'Q
  //  (22.09.2026). Demak u «Boshqaruv» ning alohida bo'limi. Bu tugma
  //  Boshqaruv bosh sahifasi + joriy sahifa + «Odamlarni izlash» dagi hamma
  //  /admin/ va /v2/ havolalarini (menyu shovqinisiz) ro'yxat qiladi.
  $("adminKor").onclick = async () => {
    const shovqin = /localization|logout|help\.emaktab|login\.emaktab|instagram|t\.me|youtube|terms|teachers\/|\/v2\/(user|soc)|communities|methodological|school-payments|news|contacts|about|persons\/person\?/i;
    const topilgan = new Map();
    const yig = (doc, manba) => {
      doc.querySelectorAll("a[href]").forEach((a) => {
        const h = a.getAttribute("href"); if (!h || h === "#" || shovqin.test(h)) return;
        const abs = new URL(h, location.origin).href;
        if (!/\/v2\//.test(abs) && !/admin/.test(abs)) return;
        if (!topilgan.has(abs)) topilgan.set(abs, { t: txt(a) || a.getAttribute("title") || "?", manba });
      });
    };
    try {
      yig(document, "joriy");
      for (const u of [`/v2/admin/default?school=${enc(schoolId)}`, `/v2/admin/persons/default?school=${enc(schoolId)}&group=students`, `/v2/school?school=${enc(schoolId)}`]) {
        try { const p = await sahifa(u); yig(p.doc, u); } catch (err) { log(`• ${u} ochilmadi: ${err.message}`, "dim"); }
      }
      const qatorlar = [...topilgan.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      log(`🗂 Admin/v2 havolalari (${qatorlar.length}):\n   ` + qatorlar.map(([u, x]) => `${x.t} → ${u}`).join("\n   "), "dim");
      const shubha = qatorlar.filter(([u, x]) => /o.?tkaz|transfer|перев|migra|move|chiqar|otchisl|выбы|graduat|bitir|arxiv|archive|import|export|excel|mass|ommaviy/i.test(x.t + " " + u));
      log(shubha.length ? "🔎 O'tkazish/chiqarishga o'xshaganlari:\n   " + shubha.map(([u, x]) => `${x.t} → ${u}`).join("\n   ") : "🔎 O'tkazish/chiqarishga o'xshagan havola topilmadi — ro'yxatni dasturchiga bering.", shubha.length ? "ok" : "ogoh");
    } catch (err) { log("✖ " + err.message, "xato"); }
  };

  W.__SJ_OQUVCHI__ = {
    ochish: () => panel.classList.add("ochiq"),
    turon: () => turon, natija: () => natija,
    royxat: emaktabRoyxati, taqqosla, turonParse, qatorlarniOqi, tugilganTekshir, filialXarita, sinfXarita, sinfRejasi,
    excelHisobot, xlsxYasa, tuzatOl,
  };

  // Ro'yxat manbai: avval Turon sahifasidan GM xotirasi orqali kelgani
  // (yangiroq bo'lsa), bo'lmasa oxirgi qo'lda qo'yilgani.
  const uzatma = gmOl();
  const saqlangan = lsOl(LS_TURON, "");
  if (uzatma && uzatma.matn && String(uzatma.vaqt || "") > lsOl(LS_TURON + "_vaqt", "")) {
    $("turon").value = uzatma.matn;
    lsYoz(LS_TURON + "_vaqt", String(uzatma.vaqt || ""));
    lsYoz(LS_TURON + "_faol", String(uzatma.faol || 0));
    if (turonOqi()) log(`📡 Ro'yxat Turon sahifasidan keldi (${String(uzatma.vaqt || "").slice(0, 16).replace("T", " ")}).`, "ok");
  } else if (saqlangan) { $("turon").value = saqlangan; turonOqi(); }
  // ⚠️ Turon ro'yxati TO'LIQ bo'lmasa chiqarish ro'yxati noto'g'ri bo'ladi:
  //  Turonda bor, lekin yig'ilmagan bola «Turonda yo'q» deb chiqariladi.
  //  Turon panelidagi «Faol» soni bilan solishtiriladi.
  turonFaol = Number(lsOl(LS_TURON + "_faol", "0")) || 0;
  // Oldingi solishtirish natijasi (F5 dan keyin davom etish uchun)
  if (turon) {
    const eski = natijaTikla();
    if (eski) {
      natija = eski;
      statKo(natija);
      $("yur").disabled = false; $("csv").disabled = false;
      const qoldi = natija.qoshish.length + natija.kochirish.length + natija.chiqarish.length;
      log(`♻ Oldingi solishtirish tiklandi (${String(natija.vaqt || "").slice(0, 16).replace("T", " ")}): qoldi ${natija.qoshish.length} qo'shish, ${natija.kochirish.length} ko'chirish, ${natija.chiqarish.length} chiqarish. `
        + (qoldi ? "«🚀» qolgan joyidan davom etadi; yangidan solishtirish uchun «🔎»." : "Hammasi bajarilgan — tekshirish uchun «🔎»."), qoldi ? "ok" : "dim");
    }
  }
  if (turon && turonFaol && turon.length < turonFaol) {
    log(`⚠ Turon «Faol» ${turonFaol}, ro'yxatda esa ${turon.length}. Ro'yxat TO'LIQ EMAS — `
      + "Turon sahifasida «🔄 Hamma sahifani o'qish» ni yana bosing. Chiqarish o'chirib qo'yildi.", "ogoh");
  }
  if (lsOl(LS_OCHIQ, "0") === "1") panel.classList.add("ochiq");
  if (REC.yoniq) { panel.classList.add("ochiq"); log(`⏺ Yozuv DAVOM etyapti (${REC.yozuv.length} yozuv). Amalni tugatgach «⏹ To'xtatish» ni bosing.`, "ogoh"); }

  const shuSahifa = qatorlarniOqi(document).length;
  log(shuSahifa
    ? `Tayyor (v${VERSIYA}). Bu sahifada ${shuSahifa} o'quvchi qatori ko'rinib turibdi.`
    : `Tayyor (v${VERSIYA}). «Odamlarni izlash → O'quvchilar» sahifasini oching.`, "dim");
})();
