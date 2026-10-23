// ==UserScript==
// @name         eMaktab → ERP maktab sinflari
// @namespace    https://smartjadval.uz/
// @version      0.3.1
// @description  eMaktabdagi sinflar ro'yxatini ERP «Maktab sinflari» bilan solishtiradi va yetishmagan sinflarni ERPda yaratadi (filial tanlanadi, holati Aktiv)
// @author       smartjadval.uz
// @match        https://schools.emaktab.uz/*
// @match        https://*.kundalik.com/*
// @match        https://erp.maktab.uz/*
// @match        https://*.maktab.uz/*
// @grant        GM_setValue
// @grant        GM_getValue
// @noframes
// @run-at       document-idle
// @updateURL    https://smartjadval.uz/emaktab-erp-sinflar.user.js
// @downloadURL  https://smartjadval.uz/emaktab-erp-sinflar.user.js
// ==/UserScript==

// ⚠️ SKRIPTGA TEGSANGIZ `@version` NI OSHIRING — Tampermonkey yangilanishni
//    faqat raqam bo'yicha biladi.
//
// ⚠️ ERP MANZILI TAXMIN: `@match https://*.maktab.uz/*`. ERP boshqa domenda
//    bo'lsa yuqoridagi `@match` qatoriga o'sha manzilni yozing (masalan
//    `// @match https://erp.misol.uz/*`), aks holda u yerda tugma chiqmaydi.

// =====================================================================
//  eMAKTAB → ERP MAKTAB SINFLARI
//
//  IKKI SAYTDA ishlaydi, har birida «E→ERP» tugmasi chiqadi:
//    • eMaktab (Boshqaruv → Sinflar) — sinflar ro'yxatini O'QIYDI va
//      Tampermonkey xotirasiga yozadi.
//    • ERP («Maktab sinflari» ro'yxati) — SOLISHTIRADI va yetishmagan
//      sinflarni «Yaratish» formasi orqali ochadi. Ro'yxat hamma filialni
//      aralash beradi va filial filtri yo'q — shuning uchun kerakli sinfga
//      mos har qatorning ✎ formasi ochilib «Maktab filiali» o'qiladi
//      (natija keshlanadi, 5B-QISM).
//
//  SINF NOMI QOIDASI (emaktab-oquvchilar.user.js dagi bilan bir xil):
//    eMaktab «1 A Q» = Qo'qon filialining «1-A» sinfi. Filial harfi (Q)
//    panelda o'zgartiriladi: O — Oltiariq, Y — Yaypan, bo'sh — Furqat
//    (bitta harfli sinflar).
//
//  ERP FORMASI (02.10.2026 dagi skrinshotlardan):
//    Tartib raqami   — matn; ERPdagi eng katta raqamdan davom etadi
//    Sinf            — ro'yxat: «1-sinf» … «11-sinf»
//    Sinf harfi      — ro'yxat: A, B, D, E, F, G, …
//    Maktab filiali  — ro'yxat: «"TURON ODOB ILM" Qo'qon shahar filiali»
//    Holati          — ro'yxat: Актив / Пассив
//    Qisqa / To'liq nomlanishi — ERP o'zi to'ldiradi (tegilmaydi; qisqa
//      nomi saqlashdan oldin TEKSHIRUV sifatida o'qiladi).
//
//  ⚠️ ERP SAHIFASI JONLI O'RGANILMAGAN — maydonlar YORLIQ MATNI bo'yicha
//    topiladi, ro'yxatlar esa bosish hodisalari bilan ochiladi (vue-select
//    taxmin qilingan, boshqa vidjetlar uchun zaxira yo'llar bor). Shuning
//    uchun avval «🧪 Sinov» ni bosing: bitta sinf formasi to'ldiriladi,
//    lekin SAQLANMAYDI. To'g'ri chiqsa — «▶ Yaratish». Noto'g'ri bo'lsa
//    «🧾 Tashxis» faylini dasturchiga bering.
//
//  ⚠️ SKRIPT HECH NARSANI O'CHIRMAYDI VA TAHRIRLAMAYDI. ERPda bor, lekin
//    eMaktabda yo'q sinflar faqat jurnalda ko'rsatiladi.
// =====================================================================

(function () {
  "use strict";

  const HOST_ID = "sj-erp-sinf-host";
  if (document.getElementById(HOST_ID)) return;

  const VERSIYA = (typeof GM_info !== "undefined" && GM_info && GM_info.script && GM_info.script.version) || "0.3.0";
  const QOLDA = typeof GM_info === "undefined";   // Tampermonkeysiz — Console
  const EMAKTAB_REJIM = /emaktab\.uz$|kundalik\.com$/i.test(location.hostname);

  // Tampermonkey xotirasi (domenlararo). Yo'q bo'lsa — null.
  const GM_KEY = "sj_erp_sinflar_uzatma_v1";
  const gmOl = () => { try { return typeof GM_getValue === "function" ? (GM_getValue(GM_KEY, null) || null) : null; } catch { return null; } };
  const gmYoz = (v) => { try { if (typeof GM_setValue === "function") { GM_setValue(GM_KEY, v); return true; } } catch { /* */ } return false; };

  const LS_OCHIQ = "sj_erp_sinf_panel_ochiq";
  const LS_ROYXAT = "sj_erp_sinf_royxat_v1";   // ERP panelidagi eMaktab ro'yxati (matn)
  const LS_HARF = "sj_erp_sinf_filial_harf";   // filial harfi (Q)
  const LS_FILIAL = "sj_erp_sinf_filial_nom";  // filial nomidagi kalit so'z (Qo'qon)

  const HOLAT = { toxtat: false, ishlayapti: false };
  const TOXTATILDI = "■ To'xtatildi";
  function toxta() { if (HOLAT.toxtat) throw new Error(TOXTATILDI); }

  // ===================================================================
  //  1-QISM. NOM KALITLARI (emaktab-oquvchilar.user.js dagi bilan bir xil)
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

  // «1 A Q» → { daraja: 1, harflar: "AQ" };  «7A O» → 7 + "AO";  «10-V» → 10 + "V";
  // «1-A класс» → 1 + "A";  «1-sinf» → 1 + "" (uzun so'zda to'xtaydi).
  function sinfAjrat(raw) {
    const s = String(raw == null ? "" : raw).replace(APOS, "").trim();
    const m = s.match(/^(\d{1,2})\s*[-–—_. ]?\s*([\s\S]*)$/);
    if (!m) return null;
    const daraja = Number(m[1]);
    if (!daraja || daraja > 12) return null;
    let harflar = "";
    for (const soz of m[2].split(/[\s\-–—_.]+/)) {
      if (!soz) continue;
      if (!/^[A-Za-zЀ-ӿ]{1,3}$/.test(soz)) break;
      harflar += normKey(soz).toUpperCase();
    }
    return { daraja, harflar };
  }

  // Sinf shu filialnikimi? «1 A Q» + «Q» → { daraja: 1, harf: "A" }.
  // Filial harfi bo'sh bo'lsa — faqat bitta harfli sinflar (Furqat).
  function filialSinfi(p, fHarf) {
    if (!p || !p.harflar) return null;
    if (!fHarf) return p.harflar.length === 1 ? { daraja: p.daraja, harf: p.harflar } : null;
    if (p.harflar.length <= fHarf.length || !p.harflar.endsWith(fHarf)) return null;
    return { daraja: p.daraja, harf: p.harflar.slice(0, -fHarf.length) };
  }

  const darajaOf = (t) => { const m = String(t || "").match(/^\s*(\d{1,2})(?!\d)/); return m ? Number(m[1]) : 0; };
  const sinfKalit = (s) => `${s.daraja}|${s.harf}`;
  const sinfNomi = (s) => `${s.daraja}-${s.harf}`;
  const sinfTartibi = (a, b) => a.daraja - b.daraja || a.harf.localeCompare(b.harf);

  // ===================================================================
  //  2-QISM. KICHIK YORDAMCHILAR
  // ===================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  const enc = encodeURIComponent;
  const cut = (s, n = 4000) => { const x = String(s == null ? "" : s); return x.length > n ? x.slice(0, n) + "…[qisqartirildi]" : x; };

  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }

  // Shart bajarilguncha kutish — faqat DOM tekshiradi, so'rov yubormaydi
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

  function lsOl(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } }
  function lsYoz(k, v) { try { localStorage.setItem(k, v); } catch { /* kvota */ } }

  function yuklab(nom, matn, tur) {
    const url = URL.createObjectURL(new Blob([matn], { type: tur || "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Sichqoncha hodisalari. Vidjetlar har xil hodisani tinglaydi (vue-select
  // ro'yxatni `mousedown` da ochadi, variantni `click` da tanlaydi), shuning
  // uchun chaqiruvchi ularni BOSQICHMA-BOSQICH yuboradi va har bosqichdan
  // keyin natijani tekshiradi — hammasini birdan yuborsa ro'yxat ochilib,
  // shu zahoti yopilib qolishi mumkin.
  function hodisa(el, turlar) {
    const r = el.getBoundingClientRect();
    turlar.forEach((t) => {
      const opts = {
        bubbles: t !== "mouseenter" && t !== "mouseleave", cancelable: true, composed: true, button: 0,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      };
      try {
        const E = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
        el.dispatchEvent(new E(t, opts));
      } catch { /* eski brauzer */ }
    });
  }

  function tugmaBos(el, kod, nom) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: nom, keyCode: kod, which: kod, bubbles: true, cancelable: true }));
  }

  // ===================================================================
  //  3-QISM. eMAKTAB — SINFLAR RO'YXATINI O'QISH
  //
  //  Ikki manba birlashtiriladi:
  //   1) ochiq turgan sahifa (Boshqaruv → Sinflar): matni sinf nomiga
  //      o'xshagan havolalar («1 A Q», «7A O», «10-V»);
  //   2) Dars jadvali → Sinflar (`/v2/schedules/?school=`) — hamma sinfni
  //      `group=<id>` havolalari bilan beradi (o'quvchilar skripti ham shu
  //      sahifadan oladi).
  // ===================================================================
  const SINF_NOM_RE = /^\d{1,2}\s*[-–—]?\s*[A-Za-zЀ-ӿ](\s*[A-Za-zЀ-ӿ]){0,2}$/;

  function hujjatdanSinflar(doc, faqatGuruh) {
    const out = [];
    doc.querySelectorAll(faqatGuruh ? 'a[href*="group="]' : "a").forEach((a) => {
      if (a.closest && a.closest("#" + HOST_ID)) return;
      const nom = txt(a);
      if (SINF_NOM_RE.test(nom)) out.push(nom);
    });
    return out;
  }

  function emaktabMaktabId() {
    const q = new URLSearchParams(location.search).get("school");
    if (q) return q;
    for (const a of document.querySelectorAll('a[href*="school="]')) {
      const m = String(a.getAttribute("href") || "").match(/[?&]school=(\d+)/);
      if (m) return m[1];
    }
    return "";
  }

  async function emaktabSinflari() {
    const nomlar = hujjatdanSinflar(document, false);
    const manba = [`shu sahifadan ${nomlar.length} ta`];
    const maktab = emaktabMaktabId();
    if (maktab) {
      try {
        const r = await fetch(`/v2/schedules/?school=${enc(maktab)}`, { credentials: "same-origin" });
        if (r.ok && !/login|auth|signin/i.test(String(r.url || ""))) {
          const doc = new DOMParser().parseFromString(await r.text(), "text/html");
          const j = hujjatdanSinflar(doc, true);
          manba.push(`dars jadvali sahifasidan ${j.length} ta`);
          nomlar.push(...j);
        } else manba.push(`dars jadvali sahifasi ochilmadi (HTTP ${r.status})`);
      } catch (err) { manba.push(`dars jadvali sahifasi o'qilmadi (${err.message})`); }
    }
    // «2A» va «2 A» — bitta sinf: kalit bo'yicha takror tashlanadi
    const bir = new Map();
    nomlar.forEach((n) => {
      const p = sinfAjrat(n);
      if (p && p.harflar && !bir.has(`${p.daraja}|${p.harflar}`)) bir.set(`${p.daraja}|${p.harflar}`, n);
    });
    const sinflar = [...bir.values()].sort((a, b) => {
      const x = sinfAjrat(a), y = sinfAjrat(b);
      return x.daraja - y.daraja || x.harflar.localeCompare(y.harflar);
    });
    return { sinflar, manba: manba.join(", "), maktab };
  }

  // ===================================================================
  //  4-QISM. ERP — «MAKTAB SINFLARI» RO'YXATI
  //
  //  Jadval SARLAVHASI bo'yicha topiladi (klass nomlariga tayanilmaydi):
  //  Actions · ID · Tartib raqami · Qisqa nomlanishi · To'liq nomlanishi ·
  //  sinf · Sinf harfi · Holati. Sarlavha kirill yoki ruscha bo'lsa ham
  //  `normKey` orqali taniladi.
  // ===================================================================
  const USTUN = {
    id: /^id$/,
    tartib: /^(tartibraqami|poryadkoviynomer|nomerpoporyadku|ordernumber)$/,
    qisqa: /^(qisqanomlanishi|qisqanomi|kratkoenaimenovanie|kratkoenazvanie|shortname)$/,
    sinf: /^(sinf|klass|class)$/,
    harf: /^(sinfharfi|bukvaklassa|bukva|classletter)$/,
    holat: /^(holati|holat|status|sostoyanie|state)$/,
  };

  function erpJadval() {
    for (const tb of document.querySelectorAll("table")) {
      if (!visible(tb)) continue;
      const bosh = tb.querySelector("thead tr") || tb.rows[0];
      if (!bosh) continue;
      const sar = [...bosh.cells].map((c) => normKey(txt(c)));
      const ix = {};
      Object.entries(USTUN).forEach(([nom, re]) => { ix[nom] = sar.findIndex((k) => re.test(k)); });
      if (ix.harf < 0 || (ix.sinf < 0 && ix.qisqa < 0)) continue;

      let trlar = tb.tBodies.length ? [...tb.tBodies].flatMap((b) => [...b.rows]) : [...tb.rows].slice(1);
      // Sarlavha va tana ALOHIDA jadval bo'lgan vidjetlar (el-table kabi)
      if (!trlar.length) {
        const keyingi = [...document.querySelectorAll("table")].find((t) => t !== tb && visible(t) && t.rows.length
          && t.rows[0].cells.length >= sar.length - 1 && !t.querySelector("th"));
        if (keyingi) trlar = [...keyingi.rows];
      }
      const qatorlar = [];
      trlar.forEach((tr) => {
        const c = [...tr.cells];
        if (c.length < sar.length - 1) return;       // «Ma'lumot yo'q» qatori
        const kat = (i) => (i >= 0 && c[i] ? txt(c[i]) : "");
        const q = sinfAjrat(kat(ix.qisqa));
        const daraja = darajaOf(kat(ix.sinf)) || (q ? q.daraja : 0);
        const harf = normKey(kat(ix.harf)).toUpperCase() || (q ? q.harflar : "");
        if (!daraja || !harf) return;
        qatorlar.push({
          id: kat(ix.id), tartib: Number(kat(ix.tartib)) || 0, qisqa: kat(ix.qisqa),
          daraja, harf, holat: kat(ix.holat), tr,
        });
      });
      return { jadval: tb, sarlavha: sar, qatorlar };
    }
    return null;
  }

  // Sahifalash: hozirgi sahifa raqami va kerakli raqamli tugma
  function sahifalash() {
    for (const ul of document.querySelectorAll("ul.pagination, .pagination, .el-pager")) {
      if (!visible(ul) || ul.closest("#" + HOST_ID)) continue;
      const faol = ul.querySelector(".active, .is-active, [aria-current=page]");
      const hozir = faol ? Number(txt(faol)) : 0;
      if (!hozir) continue;
      const tugma = (n) => [...ul.querySelectorAll("a, button, li")].find((el) => visible(el) && !el.children.length && Number(txt(el)) === n) || null;
      return { hozir, tugma };
    }
    return null;
  }

  // Keyingi sahifa tugmasi (faol sahifadan keyingi raqam)
  function keyingiSahifa() {
    const s = sahifalash();
    return s ? s.tugma(s.hozir + 1) : null;
  }

  // ⚠️ O'QISH HAR DOIM 1-SAHIFADAN. Oldingi o'qish jadvalni OXIRGI sahifada
  //  qoldiradi; keyingi bosishda shu sahifadan boshlansa faqat o'sha 1-2
  //  qator o'qilib, «ERPda 1 sinf, yetishmaydi 38» chiqqan (02.10.2026).
  async function birinchiSahifa() {
    const s = sahifalash();
    if (!s || s.hozir === 1) return;
    const b = s.tugma(1);
    if (!b) return;
    b.click();
    await waitFor(() => { const x = sahifalash(); return x && x.hozir === 1; }, 5000, 150);
    await sleep(400);
  }

  // ⚠️ ERP RO'YXATI HAMMA FILIALNI ARALASH BERADI (02.10.2026: 101 sinf,
  //  «1-V» ikki marta) — jadvalda filial ustuni yo'q, shuning uchun Qo'qon
  //  sinflari boshqa filialnikidan ajralmaydi va «hammasi bor» bo'lib
  //  chiqardi. Jadval USTIDAGI ro'yxat (filtr) dan filial tanlanadi: jadvaldan
  //  tashqaridagi select vidjetlar birma-bir ochib ko'riladi, qaysi birida
  //  filial nomi bo'lsa — o'sha. Qaytadi: tanlangan matn, topilmasa "".
  async function filialFiltri(fKalit, say, ayt) {
    const mos = (t) => !!fKalit && normKey(t).includes(fKalit);
    const j = erpJadval();
    if (!j || !fKalit) return "";
    const nomzodlar = royxatVidjetlari(j);
    const qoyilgan = nomzodlar.find((v) => mos(tanlangan(v)));
    if (qoyilgan) return tanlangan(qoyilgan);          // qo'lda allaqachon tanlangan
    if (ayt) ayt(`• Jadval ustida ${nomzodlar.length} ta ro'yxat vidjeti topildi` + (nomzodlar.length ? "" : " — filtr vidjet deb tanilmadi («🧾 Tashxis» yuboring)"), "dim");
    for (const v of nomzodlar.slice(0, 4)) {
      const oldin = j.qatorlar.map((q) => q.id || sinfKalit(q)).join(",");
      try {
        if (say) say("filial filtri qidirilmoqda…");
        const t = await tanla(v, mos, "Filial filtri");
        // Jadval serverdan qayta yuklanadi — qatorlar o'zgarguncha (yoki 4 s) kutamiz
        await waitFor(() => { const x = erpJadval(); return x && x.qatorlar.map((q) => q.id || sinfKalit(q)).join(",") !== oldin; }, 4000, 150);
        await sleep(600);
        return t;
      } catch (err) {
        if (!err.xos) throw err;                     // bu ro'yxatda filial yo'q — keyingisi
        if (ayt) ayt(`  ${cut(err.message, 300)}`, "dim");   // qaysi variantlar bor edi — sabab ko'rinsin
      }
    }
    return "";
  }

  // Jadvaldan tashqaridagi ro'yxat vidjetlari (filtrlar, sahifa hajmi; qidiruv <input> emas)
  function royxatVidjetlari(j) {
    return vidjetlar(document).filter((v) => !j.jadval.contains(v)
      && (v.tagName === "SELECT" || v.closest(ILDIZ) || v.matches("[role=combobox], [class*=select], [class*=dropdown]")));
  }

  // ⚠️ 03.10.2026: ERPda FILIAL FILTRI YO'Q — jadval ustida faqat sinf
  //  (1-sinf…11-sinf) va sahifa hajmi (5…100) ro'yxatlari bor. Shuning uchun
  //  qator filiali TAHRIRLASH FORMASIDAN o'qiladi (pastda `qatorFiliali`).
  //  Sahifa hajmi eng kattasiga (100) qo'yiladi — 101 qator 2 sahifaga sig'adi.
  const HAJM = { max: 0 };
  async function engKattaSahifa(ayt) {
    const j = erpJadval();
    if (!j) return 0;
    const nomzodlar = royxatVidjetlari(j);
    // Avval qo'yilganmi? (tahrirlashdan qaytganda ERP hajmni tiklab qo'yishi mumkin)
    if (HAJM.max && nomzodlar.some((v) => Number(tanlangan(v)) === HAJM.max)) return HAJM.max;
    for (const v of nomzodlar.slice(0, 4)) {
      let matnlar;
      if (v.tagName === "SELECT") matnlar = [...v.options].map(txt).filter((t) => t.trim());
      else { matnlar = (await royxatOch(v)).map(txt); await royxatYop(v); }
      const sonlar = matnlar.map((t) => Number(t.trim()));
      if (!sonlar.length || sonlar.some((n) => !Number.isFinite(n) || n <= 0)) continue;
      const max = Math.max(...sonlar);
      HAJM.max = max;
      if (Number(tanlangan(v)) === max) return max;
      const oldin = (erpJadval() || j).qatorlar.length;
      await tanla(v, (t) => Number(t.trim()) === max, "Sahifa hajmi");
      await waitFor(() => { const x = erpJadval(); return x && x.qatorlar.length !== oldin; }, 4000, 150);
      await sleep(400);
      if (ayt) ayt(`• Sahifa hajmi ${max} qilindi`, "dim");
      return max;
    }
    return 0;
  }

  // Hamma sahifadagi sinflar. Sahifalash yo'q bo'lsa — DOMdagi qatorlar.
  async function erpSinflari(say) {
    const hamma = new Map();
    const qosh = () => {
      const j = erpJadval();
      let yangi = 0;
      if (j) j.qatorlar.forEach((q) => { const k = q.id || sinfKalit(q); if (!hamma.has(k)) { hamma.set(k, q); yangi++; } });
      return yangi;
    };
    if (!erpJadval()) return null;
    await birinchiSahifa();
    qosh();
    for (let i = 0; i < 80; i++) {
      toxta();
      const k = keyingiSahifa();
      if (!k) break;
      if (say) say(`ERP ro'yxati: ${i + 2}-sahifa…`);
      const oldin = hamma.size;
      k.click();
      await waitFor(() => qosh() > 0, 6000, 150);
      if (hamma.size === oldin) break;
    }
    await birinchiSahifa();   // jadval 1-sahifada qolsin
    return [...hamma.values()];
  }

  // ===================================================================
  //  5-QISM. ERP — «YARATISH» FORMASI
  //
  //  Maydon YORLIQ MATNI bo'yicha topiladi («Sinf harfi» → uning ostidagi
  //  vidjet). Avval yorliqning ota elementlari ichidan YAGONA vidjet
  //  qidiriladi; topilmasa — ekrandagi joylashuv bo'yicha (yorliqdan pastda,
  //  chap cheti bir xil bo'lgan eng yaqin vidjet).
  // ===================================================================
  const MAYDON = {
    tartib: { re: USTUN.tartib, nom: "Tartib raqami" },
    sinf: { re: USTUN.sinf, nom: "Sinf" },
    harf: { re: USTUN.harf, nom: "Sinf harfi" },
    filial: { re: /^(maktabfiliali|filial|filialshkoli|shkolniyfilial|schoolbranch)$/, nom: "Maktab filiali" },
    qisqa: { re: USTUN.qisqa, nom: "Qisqa nomlanishi" },
    holat: { re: USTUN.holat, nom: "Holati" },
  };
  const RE_SAQLASH = /^(saqlash|sohranit|save)$/;
  const RE_YARATISH = /^(yaratish|sozdat|create|qoshish|dobavit)$/;
  const RE_ORQAGA = /^(orqaga|nazad|back)$/;

  const VIDJET = ".v-select, .multiselect, .el-select, [role=combobox], select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio])";

  // Eng tashqi vidjetlar (vue-select ichidagi qidiruv <input> alohida sanalmaydi)
  function vidjetlar(root) {
    const all = [...root.querySelectorAll(VIDJET)].filter((el) => visible(el) && !el.closest("#" + HOST_ID));
    return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  }

  function yorliq(re) {
    const mos = (el) => visible(el) && !el.closest("table") && !el.closest("#" + HOST_ID) && re.test(normKey(txt(el)));
    const asosiy = [...document.querySelectorAll("label, legend, .col-form-label, .form-label")].find(mos);
    if (asosiy) return asosiy;
    return [...document.querySelectorAll("span, div, p, b, strong, h5, h6")].find((el) => !el.children.length && mos(el)) || null;
  }

  function maydon(nomi) {
    const y = yorliq(MAYDON[nomi].re);
    if (!y) return null;
    let quti = y.parentElement;
    for (let i = 0; i < 4 && quti; i++, quti = quti.parentElement) {
      const v = vidjetlar(quti);
      if (v.length === 1) return v[0];
      if (v.length > 1) break;
    }
    const r = y.getBoundingClientRect();
    let eng = null, engM = Infinity;
    vidjetlar(document).forEach((v) => {
      const b = v.getBoundingClientRect();
      if (b.bottom <= r.top) return;                       // yorliqdan yuqorida
      const m = Math.max(0, b.top - r.bottom) + Math.abs(b.left - r.left) * 0.5;
      if (m < engM) { engM = m; eng = v; }
    });
    return engM < 200 ? eng : null;
  }

  function tugma(re) {
    return [...document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")]
      .find((el) => visible(el) && !el.disabled && !el.closest("#" + HOST_ID) && re.test(normKey(txt(el) || el.value))) || null;
  }

  // Forma ochiqmi? «Saqlash» tugmasi + «Sinf harfi» yorlig'i (jadval ichida emas)
  const formadami = () => !!(tugma(RE_SAQLASH) && yorliq(MAYDON.harf.re));

  function matnYoz(v, qiymat) {
    const inp = v.matches("input, textarea") ? v : v.querySelector("input, textarea");
    if (!inp) throw new Error("kiritish maydoni topilmadi");
    inp.focus();
    const d = Object.getOwnPropertyDescriptor(inp.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value");
    if (d && d.set) d.set.call(inp, qiymat); else inp.value = qiymat;
    ["input", "change"].forEach((t) => inp.dispatchEvent(new Event(t, { bubbles: true })));
    inp.dispatchEvent(new FocusEvent("blur"));
    inp.blur();
  }

  // ——— Ro'yxat (select) vidjeti ———
  //  (`.multiselect__element` — haqiqiy variant; «List is empty» yozuvi unga kirmaydi)
  const VARIANT = ".vs__dropdown-option, .multiselect__element .multiselect__option, .el-select-dropdown__item, [role=option]";

  const ILDIZ = ".v-select, .multiselect, .el-select";

  function variantlar(v) {
    // Yopilayotgan (Vue `*-leave-active`) ro'yxat — ochiq emas: unga bosilsa tanlanmaydi
    const yaroqli = (el) => visible(el) && !el.closest("#" + HOST_ID) && !el.closest("[class*=leave-active], [class*=leave-to]") && txt(el);
    let els = [...v.querySelectorAll(VARIANT)].filter(yaroqli);
    // Ro'yxat <body> ga ko'chirilgan bo'lishi mumkin (appendToBody).
    // ⚠️ BOSHQA vidjet ichidagi variantlar olinmaydi: vue-select ro'yxati
    //  yopilganda ~150 ms so'nib turadi (transition) va shu payt keyingi
    //  maydon ochilsa, oldingi maydonning variantlari «topilib» qolardi
    //  (sinovda «Sinf harfi» o'rniga «1-sinf…11-sinf» chiqqan).
    const ildiz = v.closest(ILDIZ);
    const begona = (el) => { const r = el.closest(ILDIZ); return !!r && r !== ildiz; };
    if (!els.length) els = [...document.querySelectorAll(VARIANT)].filter((el) => yaroqli(el) && !begona(el));
    // Notanish vidjet: yaqin atrofdagi ochilgan ro'yxat (<ul><li>)
    for (let k = v, i = 0; !ildiz && !els.length && k && i < 3; i++, k = k.parentElement) {
      els = [...k.querySelectorAll("ul li, .dropdown-item")].filter((el) => yaroqli(el) && !begona(el));
    }
    // Ichma-ich mos kelganlardan eng ichkisi (bosish hodisasi o'shanda tinglanadi)
    return els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  }

  // Faqat EKRANDA KO'RINADIGAN matn (yashirin variantlar ro'yxati kirmaydi)
  function korinadiganMatn(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = String(n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t && visible(n.parentElement)) out.push(t);
    }
    return out.join(" ");
  }

  // Hozir tanlangan qiymat matni
  function tanlangan(v) {
    if (v.tagName === "SELECT") return v.selectedIndex >= 0 ? txt(v.options[v.selectedIndex]) : "";
    const el = v.querySelector(".vs__selected, .multiselect__single, .el-select__selected-item");
    if (el && visible(el) && txt(el)) return txt(el);
    const inp = v.matches("input") ? v : v.querySelector("input");
    if (inp && inp.value) return inp.value.trim();
    // ⚠️ Tanish vidjetda (vue-select, vue-multiselect) boshqa matnga ISHONILMAYDI:
    //  vue-multiselect variantlarni yashirin holda DOMda saqlaydi va vidjet matni
    //  «Qo'qon filiali» ni o'z ichiga olgani uchun maydon «allaqachon tanlangan»
    //  bo'lib ko'ringan (sinovda filial bo'sh qolgan).
    if (v.closest(ILDIZ)) return "";
    return variantlar(v).length ? "" : korinadiganMatn(v);   // notanish vidjet: yopiq holatdagi matni = tanlov
  }

  async function royxatOch(v) {
    const bor = () => { const x = variantlar(v); return x.length ? x : null; };
    if (bor()) return bor();
    const tutqich = v.querySelector(".vs__dropdown-toggle, .multiselect__tags, .el-select__wrapper, .el-input, .dropdown-toggle") || v;
    const inp = v.matches("input") ? v : v.querySelector("input");
    const qadamlar = [
      () => hodisa(tutqich, ["pointerdown", "mousedown"]),
      () => hodisa(tutqich, ["pointerup", "mouseup", "click"]),
      () => { if (inp) { inp.focus(); inp.dispatchEvent(new FocusEvent("focus")); inp.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); } },
      () => { if (inp) tugmaBos(inp, 40, "ArrowDown"); },
    ];
    for (const q of qadamlar) {
      q();
      const r = await waitFor(bor, 500);
      if (r) return r;
    }
    return (await waitFor(bor, 3000, 150)) || [];   // variantlar serverdan kechikib kelishi mumkin
  }

  async function royxatYop(v) {
    if (v.tagName === "SELECT" || !variantlar(v).length) return;
    const inp = v.matches("input") ? v : v.querySelector("input");
    if (inp) { tugmaBos(inp, 27, "Escape"); inp.dispatchEvent(new FocusEvent("blur")); inp.blur(); }
    await waitFor(() => !variantlar(v).length, 600);        // so'nish animatsiyasi tugasin
    if (variantlar(v).length) hodisa(document.body, ["mousedown", "mouseup", "click"]);
    await waitFor(() => !variantlar(v).length, 600);
  }

  let ishlaganBosqich = 0;

  // Variantni tanlash. `mos(matn)` — kerakli variantmi. Qaytadi: tanlangan matn.
  //  `yagona` — mos variant topilmasa-yu ro'yxatda bittagina variant bo'lsa, o'sha olinadi.
  async function tanla(v, mos, nom, yagona) {
    // `xos` — xato shu SINFGA xos (masalan harf ro'yxatda yo'q), tizimli emas
    const variantYoq = (borlar) => Object.assign(new Error(`«${nom}» ro'yxatida mos variant yo'q (bor: ${borlar.slice(0, 40).join(", ")})`), { xos: true });
    if (v.tagName === "SELECT") {
      const variantlari = () => [...v.options].filter((o) => o.value !== "" && !o.disabled);
      await waitFor(() => variantlari().length, 4000, 150);   // variantlar serverdan kechikib kelishi mumkin
      const ops = variantlari();
      const o = ops.find((x) => mos(txt(x))) || (yagona && ops.length === 1 ? ops[0] : null);
      if (!o) throw variantYoq(ops.map(txt));
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (d && d.set) d.set.call(v, o.value); else v.value = o.value;
      ["input", "change"].forEach((t) => v.dispatchEvent(new Event(t, { bubbles: true })));
      return txt(o);
    }
    if (mos(tanlangan(v))) return tanlangan(v);          // allaqachon tanlangan

    const els = await royxatOch(v);
    if (!els.length) throw new Error(`«${nom}» ro'yxati ochilmadi yoki bo'sh`);
    const el = els.find((x) => mos(txt(x))) || (yagona && els.length === 1 ? els[0] : null);
    if (!el) {
      const borlar = els.map(txt);
      await royxatYop(v);
      throw variantYoq(borlar);
    }
    const kerak = txt(el);
    const tanlandi = () => normKey(tanlangan(v)) === normKey(kerak);
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    hodisa(el, ["pointerover", "mouseover", "mouseenter", "mousemove"]);
    const bosqichlar = [
      () => hodisa(el, ["pointerdown", "mousedown"]),
      () => hodisa(el, ["pointerup", "mouseup", "click"]),
      () => { const ich = el.firstElementChild || el.parentElement; if (ich) hodisa(ich, ["mousedown", "mouseup", "click"]); },
    ];
    // Qaysi bosqich ishlagani eslab qolinadi — keyingi maydonlar shundan
    // boshlaydi (aks holda har tanlovda 450 ms bekor kutiladi).
    let ok = false;
    for (let i = 0; i < bosqichlar.length && !ok; i++) {
      const k = (ishlaganBosqich + i) % bosqichlar.length;
      bosqichlar[k]();
      if (await waitFor(tanlandi, 450)) { ok = true; ishlaganBosqich = k; }
    }
    // Tanlangach ro'yxat o'zi yopiladi (so'nib) — kutamiz, yopilmasa yopamiz
    await waitFor(() => !variantlar(v).length, 500);
    await royxatYop(v);
    if (!ok && !tanlandi()) throw new Error(`«${nom}»: «${kerak}» tanlanmadi (vidjet bosishga javob bermadi)`);
    return kerak;
  }

  // ——— Saqlashdan keyingi xabarlar ———
  const XABAR = ".toast, .b-toast, .swal2-popup, .el-message, .el-notification, .el-message-box, .alert, .notification, .toasted, "
    + ".vue-notification, .Vue-Toastification__toast, .iziToast, .noty_bar, .snotifyToast, .modal.show .modal-content, .invalid-feedback, [role=alert]";
  const XATO_RE = /xato|error|ошибк|mavjud|уже|already|takror|duplicate|to.?ldiring|majburiy|обязат|невозможно|не удалось|bo.?lmadi|rad etildi|muvaffaqiyatsiz|saqlanmadi|unsuccess|fail/i;
  const OK_RE = /muvaffaqiyatli|saqlandi|yaratildi|qo.?shildi|успешно|сохранен|success/i;
  const TASDIQ_RE = /^(ha|da|yes|ok|tasdiqlash|podtverdit|confirm|davometish)$/;

  const xabarlar = () => [...document.querySelectorAll(XABAR)].filter((el) => visible(el) && !el.closest("#" + HOST_ID) && txt(el));

  async function saqlashNatijasi(oldingi) {
    let muddat = Date.now() + 15000;
    let tasdiqlandi = false, tushunarsiz = "";
    for (;;) {
      toxta();
      if (!formadami()) return { ok: true };
      const yangi = xabarlar().find((el) => !oldingi.has(el));
      if (yangi) {
        oldingi.add(yangi);
        const matn = cut(txt(yangi), 200);
        const xatoKlass = /danger|error|invalid|warning/i.test(String(yangi.className || "")) || !!yangi.querySelector(".swal2-error, .swal2-icon-error, .text-danger");
        const okTugma = [...yangi.querySelectorAll("button, a")].find((b) => visible(b) && TASDIQ_RE.test(normKey(txt(b))));
        if (xatoKlass || XATO_RE.test(matn)) {
          if (okTugma) okTugma.click();
          return { ok: false, sabab: matn };
        }
        if (OK_RE.test(matn)) {
          if (okTugma) okTugma.click();
          return { ok: true, xabar: matn };
        }
        // Tasdiq so'rovi («Saqlansinmi?») — bir marta «Ha»
        if (okTugma && !tasdiqlandi) { tasdiqlandi = true; okTugma.click(); await sleep(300); continue; }
        // Tushunarsiz xabar: forma yopilsa — saqlangan, yopilmasa — to'xtaymiz
        tushunarsiz = matn;
        muddat = Math.min(muddat, Date.now() + 5000);
      }
      if (Date.now() > muddat) break;
      await sleep(150);
    }
    return { ok: false, nomalum: true, sabab: tushunarsiz ? `forma yopilmadi, xabar: «${tushunarsiz}»` : "15 soniyada forma yopilmadi va xabar chiqmadi" };
  }

  // Forma ochiq bo'lsa ro'yxatga qaytish (forma saqlagach o'zi yopilishi ham mumkin)
  async function royxatgaQayt() {
    if (formadami()) {
      await waitFor(() => !formadami(), 2500);
      // ⚠️ RO'YXAT SAHIFASIDA HAM «Orqaga» BOR — u bo'limdan chiqarib yuboradi.
      //  Shuning uchun faqat forma hali ochiq turganda bosiladi.
      if (formadami()) { const b = tugma(RE_ORQAGA); if (b) b.click(); }
    }
    const ok = await waitFor(() => !formadami() && erpJadval(), 12000, 120);
    if (!ok) throw new Error("ro'yxat sahifasiga qaytib bo'lmadi");
    await sleep(350);
  }

  async function formaOch() {
    if (formadami()) throw new Error("forma allaqachon ochiq — avval «Orqaga» bilan ro'yxatga qayting");
    const b = tugma(RE_YARATISH);
    if (!b) throw new Error("«Yaratish» tugmasi topilmadi");
    b.click();
    if (!(await waitFor(formadami, 10000, 100))) throw new Error("«Yaratish» formasi ochilmadi");
    await waitFor(() => maydon("sinf") && maydon("harf"), 4000, 100);
    await sleep(250);
  }

  // Formani to'ldirish. Qaytadi: [«maydon → qiymat»] (jurnal uchun)
  async function formaTolat(s, tartib, sozlama) {
    const kerak = (nomi) => {
      const v = maydon(nomi);
      if (!v) throw new Error(`«${MAYDON[nomi].nom}» maydoni topilmadi`);
      return v;
    };
    const izoh = [];
    matnYoz(kerak("tartib"), String(tartib));
    izoh.push(`Tartib raqami → ${tartib}`);
    izoh.push("Sinf → " + await tanla(kerak("sinf"), (t) => darajaOf(t) === s.daraja, "Sinf"));
    toxta();
    izoh.push("Sinf harfi → " + await tanla(kerak("harf"), (t) => t.trim().length <= 2 && normKey(t) === normKey(s.harf), "Sinf harfi"));
    toxta();
    const fKalit = normKey(sozlama.filial);
    izoh.push("Maktab filiali → " + await tanla(kerak("filial"), (t) => !!fKalit && normKey(t).includes(fKalit), "Maktab filiali", true));
    toxta();
    izoh.push("Holati → " + await tanla(kerak("holat"), (t) => /^(aktiv|active|faol)/.test(normKey(t)), "Holati"));

    // TEKSHIRUV: ERP «Qisqa nomlanishi» ni o'zi to'ldiradi («1-A»). U boshqa
    // sinfni ko'rsatsa — ro'yxatlardan biri noto'g'ri tanlangan, saqlanmaydi.
    await sleep(300);
    const q = maydon("qisqa");
    const qInp = q && (q.matches("input") ? q : q.querySelector("input"));
    const qVal = qInp ? String(qInp.value || "").trim() : "";
    if (qVal) {
      const p = sinfAjrat(qVal);
      if (!p || p.daraja !== s.daraja || p.harflar !== s.harf) throw new Error(`forma boshqa sinfni ko'rsatyapti: «${qVal}» (kutilgan ${sinfNomi(s)})`);
      izoh.push(`Qisqa nomlanishi = ${qVal} ✔`);
    }
    return izoh;
  }

  // ===================================================================
  //  5B-QISM. QATOR FILIALI — TAHRIRLASH FORMASIDAN
  //
  //  Ro'yxatda filial ustuni ham, filtri ham yo'q. Qatorning ✎ tugmasi
  //  bosiladi, ochilgan formada «Maktab filiali» o'qiladi, «Orqaga» bilan
  //  qaytiladi. Natija id bo'yicha localStorage'da keshlanadi — keyingi
  //  bosishlarda qayta ochilmaydi. Faqat KERAKLI sinflarga mos qatorlar
  //  tekshiriladi (101 emas, ~40–70 ta).
  //
  //  ⚠️ 🗑 O'CHIRISH TUGMASI YONIDA TURADI. Tahrirlash tugmasi klass/title/
  //  href bo'yicha tanlanadi, o'chirishga o'xshagani hech qachon bosilmaydi;
  //  bosilgandan keyin «o'chirilsinmi?» oynasi chiqsa — bekor qilinadi.
  // ===================================================================
  const LS_FILIAL_KESH = "sj_erp_sinf_filial_kesh_v1";   // id → filial matni
  function keshOl() { try { return JSON.parse(lsOl(LS_FILIAL_KESH, "{}")) || {}; } catch { return {}; } }
  function keshYoz(k) { lsYoz(LS_FILIAL_KESH, JSON.stringify(k)); }

  const RE_EDIT = /edit|pencil|tahrir|izmen|redakt|update|modify/i;
  const RE_DEL = /delete|trash|remove|ochir|udal|bin\b|danger/i;

  function tahrirTugmasi(tr) {
    const belgi = (el) => normKey([
      el.className && el.className.baseVal != null ? el.className.baseVal : el.className,
      el.title, el.getAttribute("aria-label"), el.getAttribute("href"), el.getAttribute("data-icon"), el.getAttribute("data-original-title"),
      String(el.innerHTML || "").slice(0, 400),
    ].join(" "));
    for (const c of tr.cells) {
      const nomzodlar = [...c.querySelectorAll("a, button, [role=button], i, svg, span")].filter(visible);
      if (!nomzodlar.length) continue;
      const edit = nomzodlar.find((el) => RE_EDIT.test(belgi(el)) && !RE_DEL.test(belgi(el)));
      if (edit) return edit;
      const xavfsiz = nomzodlar.filter((el) => !RE_DEL.test(belgi(el)));
      return xavfsiz[0] || null;      // belgisi yo'q — birinchisi (skrinshotda ✎ birinchi)
    }
    return null;
  }

  // Jadval sahifalarini varaqlab, id li qatorni topish (DOM <tr>)
  async function qatorgaBor(id) {
    await engKattaSahifa();
    await birinchiSahifa();
    for (let i = 0; i < 80; i++) {
      toxta();
      const j = erpJadval();
      const q = j && j.qatorlar.find((x) => x.id === id);
      if (q) return q.tr;
      const k = keyingiSahifa();
      if (!k) return null;
      const oldin = j ? j.qatorlar.map((x) => x.id).join(",") : "";
      k.click();
      await waitFor(() => { const x = erpJadval(); return x && x.qatorlar.length && x.qatorlar.map((y) => y.id).join(",") !== oldin; }, 6000, 150);
    }
    return null;
  }

  const RE_OCHIRISH_SAVOLI = /o.?chir|удал|delete|remove/i;
  const RE_BEKOR = /^(yo.?q|bekor|bekorqilish|otmena|cancel|net|no|yopish|zakrit|close)$/;

  async function qatorFiliali(q) {
    const tr = await qatorgaBor(q.id);
    if (!tr) throw new Error("qator ro'yxat sahifalarida topilmadi");
    const b = tahrirTugmasi(tr);
    if (!b) throw new Error("qatorda ✎ tahrirlash tugmasi topilmadi");
    b.click();
    if (!(await waitFor(formadami, 2500, 100))) hodisa(b, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
    if (!(await waitFor(formadami, 6000, 100))) {
      // O'chirish oynasi ochilib qolmadimi?
      const oyna = xabarlar().find((el) => RE_OCHIRISH_SAVOLI.test(txt(el)));
      if (oyna) {
        const bekor = [...oyna.querySelectorAll("button, a")].find((x) => visible(x) && RE_BEKOR.test(normKey(txt(x))));
        if (bekor) bekor.click(); else tugmaBos(document.body, 27, "Escape");
        throw new Error("✎ o'rniga o'chirish oynasi ochildi — bekor qilindi, tahrirlash tugmasi tanilmadi («🧾 Tashxis» yuboring)");
      }
      throw new Error("tahrirlash formasi ochilmadi");
    }
    // Forma ma'lumoti serverdan keladi — qisqa nomi to'lguncha kutamiz
    const qisqaQiymat = () => { const v = maydon("qisqa"); const inp = v && (v.matches("input") ? v : v.querySelector("input")); return inp ? String(inp.value || "").trim() : ""; };
    await waitFor(qisqaQiymat, 6000, 150);
    if (!maydon("filial")) { await royxatgaQayt(); throw new Error("formada «Maktab filiali» maydoni topilmadi"); }
    // ⚠️ VIDJET HAR SAFAR QAYTADAN TOPILADI (03.10.2026: 70 qator «bo'sh» o'qilgan).
    //  Ma'lumot kelganda Vue vidjetni qayta chizadi — oldin ushlab olingan
    //  element DOMdan ajralib qoladi va undan hech qachon qiymat chiqmaydi.
    const filialQiymat = () => { const v = maydon("filial"); return v ? tanlangan(v) : ""; };
    await waitFor(filialQiymat, 6000, 150);
    await sleep(300);
    let filial = filialQiymat();
    let tashxis = "";
    if (!filial) {
      // Nega bo'sh — vidjetning ko'rinadigan matni va HTML boshi jurnalga
      const v = maydon("filial");
      tashxis = v ? `matn: «${cut(korinadiganMatn(v), 80)}», html: ${cut(v.outerHTML.replace(/\s+/g, " "), 260)}` : "vidjet yo'q";
    }
    const p = sinfAjrat(qisqaQiymat());
    const mosmi = !p || (p.daraja === q.daraja && p.harflar === q.harf);
    await royxatgaQayt();
    if (!mosmi) throw new Error(`forma boshqa sinfni ochdi («${qisqaQiymat() || "?"}»)`);
    if (!filial && tashxis) throw Object.assign(new Error(`filial bo'sh o'qildi — ${tashxis}`), { bosh: true });
    return filial;
  }

  // Sahifa tuzilishi — dasturchi uchun (forma to'ldirilmasa shu fayl yuboriladi)
  function erpTashxis() {
    const j = erpJadval();
    const saqlash = tugma(RE_SAQLASH);
    const quti = saqlash ? (saqlash.closest("form, .card, .modal-content") || document.body) : null;
    const maydonlar = {};
    Object.keys(MAYDON).forEach((k) => {
      const y = yorliq(MAYDON[k].re);
      const v = y ? maydon(k) : null;
      maydonlar[k] = {
        yorliq: y ? cut(y.outerHTML, 300) : null,
        vidjet: v ? cut(v.outerHTML, 2500) : null,
        tanlangan: v ? tanlangan(v) : null,
        variantlar: v ? variantlar(v).slice(0, 40).map(txt) : null,
      };
    });
    return JSON.stringify({
      sj_erp_sinf_tashxis: 1, versiya: VERSIYA, sahifa: location.href, sarlavha: document.title, vaqt: new Date().toISOString(),
      formadami: formadami(),
      jadval: j ? { sarlavha: j.sarlavha, qatorlar: j.qatorlar.length, namuna: j.qatorlar.slice(0, 3),
        html: cut(j.jadval.querySelector("tbody tr") ? j.jadval.querySelector("tbody tr").outerHTML : "", 3000) } : null,
      jadvallar: [...document.querySelectorAll("table")].slice(0, 6).map((t) => cut(t.querySelector("tr") ? t.querySelector("tr").outerHTML : "", 1500)),
      sahifalash: [...document.querySelectorAll(".pagination, .el-pager")].slice(0, 2).map((p) => cut(p.outerHTML, 1500)),
      tugmalar: [...document.querySelectorAll("button, a.btn, [role=button]")].filter(visible).map((b) => txt(b)).filter(Boolean).slice(0, 60),
      maydonlar,
      forma: quti ? cut(quti.outerHTML, 30000) : null,
    }, null, 2);
  }

  // ===================================================================
  //  6-QISM. PANEL
  // ===================================================================
  const PANEL_CSS = `
      :host,*{box-sizing:border-box;}
      .wrap{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;}
      .fab{width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(135deg,#6366f1,#0ea5e9);color:#fff;font-weight:800;font-size:11.5px;
        box-shadow:0 8px 24px rgba(14,165,233,.4);}
      .panel{display:none;width:430px;max-height:86vh;overflow:auto;background:#0f172a;position:relative;
        border:1px solid #1e293b;border-radius:16px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);}
      .panel.ochiq{display:block;}
      h3{margin:0 0 2px;font-size:15px;color:#fff;}
      .sub{color:#94a3b8;font-size:11.5px;margin-bottom:10px;}
      .qadam{border:1px solid #1e293b;border-radius:11px;padding:10px;margin-bottom:9px;background:#111a2e;}
      .qadam b{color:#bae6fd;font-size:12px;display:block;margin-bottom:6px;}
      button.b{border:none;border-radius:9px;padding:8px 11px;font-weight:700;font-size:12px;
        cursor:pointer;margin:2px 3px 2px 0;font-family:inherit;}
      button.b:disabled{opacity:.5;cursor:default;}
      .b-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
      .b-alt{background:#1e293b;color:#cbd5e1;border:1px solid #334155;}
      .b-warn{background:#7c2d12;color:#fed7aa;}
      textarea{width:100%;height:74px;background:#020617;border:1px solid #1e293b;border-radius:9px;
        color:#cbd5e1;padding:7px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
      .log{background:#020617;border:1px solid #1e293b;border-radius:9px;padding:7px;height:200px;
        overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;}
      .ok{color:#86efac;} .xato{color:#fca5a5;} .ogoh{color:#fde68a;} .dim{color:#64748b;}
      .qator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px 0;}
      .holat{font-size:11px;color:#94a3b8;}
      label{font-size:11.5px;color:#cbd5e1;display:inline-flex;align-items:center;gap:4px;}
      input[type=text]{background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:3px 6px;font:inherit;}
      .x{position:absolute;right:10px;top:8px;background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;}
      .stat{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:6px 0;}
      .stat div{background:#020617;border:1px solid #1e293b;border-radius:8px;padding:6px;text-align:center;}
      .stat span{display:block;font-size:18px;font-weight:800;color:#fff;}
      .stat small{font-size:10.5px;color:#94a3b8;}
  `;

  // eMaktabda o'ng pastda boshqa skriptlar tugmasi (SJ, T→E) turadi — chapga qo'yiladi
  function panelYasa(html, chapda) {
    const h = document.createElement("div");
    h.id = HOST_ID;
    h.style.cssText = `position:fixed;${chapda ? "left" : "right"}:16px;bottom:16px;z-index:2147483647;`;
    const s = h.attachShadow({ mode: "open" });
    document.body.appendChild(h);
    s.innerHTML = `<style>${PANEL_CSS}</style>${html}`;
    return { host: h, s };
  }

  function panelAsosi(s) {
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
    return { $, panel, log };
  }

  // ——— eMaktab paneli ———
  function emaktabPanel() {
    const { s } = panelYasa(`
    <div class="wrap">
      <button class="fab" id="fab" title="eMaktab → ERP: sinflar">E→ERP</button>
      <div class="panel" id="panel">
        <button class="x" id="yopish">✕</button>
        <h3>eMaktab → ERP: sinflar ro'yxati</h3>
        <div class="sub">Sinflar o'qiladi va ERP sahifasidagi panelga uzatiladi. v${VERSIYA}</div>
        <div class="stat">
          <div><span id="nJami">0</span><small>jami sinf</small></div>
          <div><span id="nFilial">0</span><small id="nFilialNom">«Q» harfli</small></div>
          <div><span id="nUzat">—</span><small>ERPga uzatildi</small></div>
        </div>
        <div class="qadam">
          <b>Sinflarni o'qish</b>
          <div class="qator">
            <button class="b b-main" id="oqi">📥 Sinflarni o'qib uzatish</button>
            <button class="b b-alt" id="nusxa">📋 Nusxa olish</button>
          </div>
          <textarea id="royxat" readonly placeholder="Sinflar shu yerda chiqadi"></textarea>
          <div class="holat" id="holat">«Boshqaruv → Sinflar» sahifasida bosing. Keyin ERP «Maktab sinflari» sahifasini oching.</div>
        </div>
        <div class="log" id="log"></div>
      </div>
    </div>`, true);
    const { $, panel, log } = panelAsosi(s);
    const fHarf = normKey(lsOl(LS_HARF, "Q")).toUpperCase();
    $("nFilialNom").textContent = fHarf ? `«${fHarf}» harfli` : "bitta harfli";

    async function oqi() {
      $("oqi").disabled = true;
      try {
        const r = await emaktabSinflari();
        if (!r.sinflar.length) { log("✖ Sinf topilmadi — «Boshqaruv → Sinflar» sahifasini ochib qayta bosing", "xato"); return; }
        $("royxat").value = r.sinflar.join("\n");
        $("nJami").textContent = String(r.sinflar.length);
        $("nFilial").textContent = String(r.sinflar.filter((n) => filialSinfi(sinfAjrat(n), fHarf)).length);
        const uzatildi = gmYoz({ vaqt: new Date().toISOString(), maktab: r.maktab, sinflar: r.sinflar });
        $("nUzat").textContent = uzatildi ? "✔" : "✖";
        log(`✔ ${r.sinflar.length} sinf o'qildi (${r.manba})`, "ok");
        log(uzatildi ? "📤 ERPga uzatildi — endi ERP «Maktab sinflari» sahifasida «E→ERP» ni oching"
          : "⚠ Tampermonkey xotirasi yo'q — «📋 Nusxa olish» ni bosib, ERP panelidagi qutiga qo'ying", uzatildi ? "ok" : "ogoh");
      } catch (err) { log(`✖ ${err.message}`, "xato"); } finally { $("oqi").disabled = false; }
    }
    $("oqi").onclick = oqi;
    $("nusxa").onclick = async () => {
      try { await navigator.clipboard.writeText($("royxat").value); log("📋 Nusxa olindi", "ok"); }
      catch { $("royxat").select(); log("⚠ Nusxa olinmadi — qutidagi matnni Ctrl+C bilan oling", "ogoh"); }
    };
    if (panel.classList.contains("ochiq")) oqi();
  }

  // ——— ERP paneli ———
  function erpPanel() {
    const { host, s } = panelYasa(`
    <div class="wrap">
      <button class="fab" id="fab" title="eMaktab → ERP: sinflar">E→ERP</button>
      <div class="panel" id="panel">
        <button class="x" id="yopish">✕</button>
        <h3>eMaktab → ERP: maktab sinflari</h3>
        <div class="sub">eMaktabda bor, ERPda yo'q sinflar yaratiladi. Hech narsa o'chirilmaydi. v${VERSIYA}</div>
        <div class="stat">
          <div><span id="nKerak">—</span><small>eMaktabda (filial)</small></div>
          <div><span id="nBor">—</span><small>ERPda bor</small></div>
          <div><span id="nYoq">—</span><small>yetishmaydi</small></div>
        </div>
        <div class="qadam">
          <b>1. eMaktab sinflari</b>
          <textarea id="royxat" placeholder="eMaktab sinflari (har qatorda bittadan): 1 A Q"></textarea>
          <div class="qator">
            <button class="b b-alt" id="olish">♻ eMaktabdan olish</button>
            <span class="holat" id="manba"></span>
          </div>
          <div class="qator">
            <label>Filial harfi <input type="text" id="fHarf" style="width:38px;text-align:center;" maxlength="2"></label>
            <label>ERPdagi filial <input type="text" id="fNom" style="width:120px;"></label>
          </div>
        </div>
        <div class="qadam">
          <b>2. Solishtirish va yaratish</b>
          <div class="qator">
            <button class="b b-alt" id="solishtir">🔎 Solishtirish</button>
            <button class="b b-alt" id="sinov" title="Bitta sinf formasi to'ldiriladi, lekin SAQLANMAYDI">🧪 Sinov (1 ta, saqlamaydi)</button>
          </div>
          <div class="qator">
            <button class="b b-main" id="yarat">▶ Yetishmaganlarini yaratish</button>
            <button class="b b-warn" id="toxtat" disabled>■ To'xtatish</button>
            <button class="b b-alt" id="tashxis" title="Sahifa tuzilishini faylga yozadi — forma to'ldirilmasa dasturchiga">🧾 Tashxis</button>
          </div>
          <div class="holat" id="holat">ERP «Maktab sinflari» RO'YXATI ochiq tursin. Ish paytida sahifaga tegmang.</div>
        </div>
        <div class="log" id="log"></div>
      </div>
    </div>`, false);
    const { $, panel, log } = panelAsosi(s);

    $("fHarf").value = lsOl(LS_HARF, "Q");
    $("fNom").value = lsOl(LS_FILIAL, "Qo'qon");
    $("royxat").value = lsOl(LS_ROYXAT, "");
    $("fHarf").onchange = () => lsYoz(LS_HARF, $("fHarf").value.trim());
    $("fNom").onchange = () => lsYoz(LS_FILIAL, $("fNom").value.trim());
    $("royxat").onchange = () => lsYoz(LS_ROYXAT, $("royxat").value);

    function gmdanOl(jim) {
      const g = gmOl();
      if (!g || !Array.isArray(g.sinflar) || !g.sinflar.length) {
        if (!jim) log("⚠ eMaktabdan ro'yxat kelmagan — eMaktab «Boshqaruv → Sinflar» sahifasida «E→ERP» → «📥» ni bosing (yoki ro'yxatni qutiga qo'lda qo'ying)", "ogoh");
        return false;
      }
      $("royxat").value = g.sinflar.join("\n");
      lsYoz(LS_ROYXAT, $("royxat").value);
      const d = new Date(g.vaqt);
      $("manba").textContent = `${g.sinflar.length} sinf · ${isNaN(d) ? "" : d.toLocaleString("uz")}`;
      if (!jim) log(`📡 eMaktabdan ${g.sinflar.length} sinf olindi`, "ok");
      return true;
    }
    $("olish").onclick = () => gmdanOl(false);
    gmdanOl(true);

    const sozlama = () => ({ harf: normKey($("fHarf").value).toUpperCase(), filial: $("fNom").value.trim() });

    // Qutidagi ro'yxatdan shu filial sinflari: [{ daraja, harf, asl }]
    function kerakliSinflar() {
      const { harf } = sozlama();
      const bir = new Map();
      String($("royxat").value || "").split(/[\r\n,;]+/).forEach((q) => {
        const f = filialSinfi(sinfAjrat(q), harf);
        if (f && !bir.has(sinfKalit(f))) bir.set(sinfKalit(f), { ...f, asl: q.trim() });
      });
      return [...bir.values()].sort(sinfTartibi);
    }

    async function solishtir() {
      const kerak = kerakliSinflar();
      const { harf } = sozlama();
      if (!kerak.length) throw new Error(`qutida ${harf ? `«${harf}» harfli` : "bitta harfli"} sinf yo'q — eMaktab ro'yxatini va filial harfini tekshiring`);
      if (formadami() && !erpJadval()) throw new Error("forma ochiq — «Orqaga» bilan «Maktab sinflari» ro'yxatiga qayting");
      if (!erpJadval()) throw new Error("ERP «Maktab sinflari» jadvali topilmadi — ro'yxat sahifasini oching (topilmasa «🧾 Tashxis»)");
      const say = (m) => { $("holat").textContent = m; };
      const { filial } = sozlama();
      const fKalit = normKey(filial);
      const filtr = await filialFiltri(fKalit, say, log);
      if (filtr) log(`🏢 ERP ro'yxati filial bo'yicha filtrlandi: ${filtr}`, "dim");
      await engKattaSahifa(log);
      const hamma = await erpSinflari(say);
      if (!hamma) throw new Error("ERP jadvali o'qilmadi");
      const kerakK = new Set(kerak.map(sinfKalit));
      // Tartib raqami HAMMA qator bo'yicha davom etadi — boshqa filial raqami
      // bilan to'qnashmasin (raqam filial ichida yoki umumiy yagona — noma'lum)
      const maxTartib = hamma.reduce((m, q) => Math.max(m, q.tartib || 0), 0);

      let bor = hamma;          // shu filialning sinflari
      let ortiqcha = [];
      if (filtr) {
        ortiqcha = hamma.filter((q) => !kerakK.has(sinfKalit(q))).sort(sinfTartibi);
      } else {
        // Filtr yo'q — kerakli sinflarga mos qatorlarning filiali formadan o'qiladi
        const kesh = keshOl();
        const tekshir = hamma.filter((q) => kerakK.has(sinfKalit(q)) && q.id);
        const idsiz = hamma.filter((q) => kerakK.has(sinfKalit(q)) && !q.id).length;
        if (idsiz) throw new Error(`${idsiz} ta qatorda ID ustuni bo'sh — filialni aniqlab bo'lmaydi («🧾 Tashxis» yuboring)`);
        const yangi = tekshir.filter((q) => !kesh[q.id]);
        if (yangi.length) {
          log(`🔍 Filial filtri yo'q — ${yangi.length} ta qatorning filiali ✎ formasidan o'qiladi (≈${Math.max(1, Math.ceil(yangi.length * 4 / 60))} daqiqa). Sahifaga tegmang.`, "ogoh");
          let ketmaXato = 0;
          for (let i = 0; i < yangi.length; i++) {
            toxta();
            const q = yangi[i];
            say(`filial o'qilmoqda ${i + 1}/${yangi.length}: ${sinfNomi(q)} #${q.id}`);
            try {
              const f = await qatorFiliali(q);
              if (f) { kesh[q.id] = f; keshYoz(kesh); ketmaXato = 0; }
              log(`  ${sinfNomi(q)} #${q.id} → ${f || "(bo'sh — qayta o'qiladi)"}`, f ? "dim" : "ogoh");
            } catch (err) {
              if (err.message === TOXTATILDI) throw err;
              log(`  ✖ ${sinfNomi(q)} #${q.id}: ${err.message}`, "xato");
              if (!err.bosh) { try { await royxatgaQayt(); } catch { /* ro'yxatga qaytilmadi — keyingi urinish o'zi topadi */ } }
              // Bo'sh o'qish ham xato: 2 marta ketma-ket bo'lsa qolgan 68 tasini ochib o'tirmaymiz
              if (++ketmaXato >= 2) throw new Error("filial o'qishda ketma-ket xato — to'xtatildi. Jurnaldagi «html: …» qatorini dasturchiga yuboring, "
                + "yoki bitta qatorning ✎ formasini QO'LDA ochib, forma ochiq turganda «🧾 Tashxis» ni bosing.");
            }
          }
        }
        const nomalum = tekshir.filter((q) => !kesh[q.id]);
        // ⚠️ Filiali o'qilmagan qator EHTIYOT UCHUN «shu filialniki» deb olinadi —
        //  takror sinf yaratishdan ko'ra, yaratmay qo'yish arzon.
        if (nomalum.length) log(`⚠ ${nomalum.length} ta qatorning filiali o'qilmadi, ular «${filial}»niki deb hisoblandi: ${nomalum.map((q) => sinfNomi(q) + " #" + q.id).join(", ")}`, "ogoh");
        bor = tekshir.filter((q) => !kesh[q.id] || normKey(kesh[q.id]).includes(fKalit));
        const boshqa = tekshir.length - bor.length;
        log(`🏢 ${tekshir.length} mos qatordan ${bor.length} tasi «${filial}»niki, ${boshqa} tasi boshqa filialniki`, "dim");
      }

      const borK = new Map(bor.map((q) => [sinfKalit(q), q]));
      const yoq = kerak.filter((x) => !borK.has(sinfKalit(x)));
      const passiv = kerak.filter((x) => borK.has(sinfKalit(x)) && borK.get(sinfKalit(x)).holat && !/^(aktiv|active|faol)/.test(normKey(borK.get(sinfKalit(x)).holat)));
      $("nKerak").textContent = String(kerak.length);
      $("nBor").textContent = String(kerak.length - yoq.length);
      $("nYoq").textContent = String(yoq.length);
      log(`🔎 eMaktabda ${kerak.length} sinf${harf ? ` («${harf}»)` : ""}, ERPda (${filial}) ${bor.length} sinf. Yetishmaydi: ${yoq.length}`, yoq.length ? "ogoh" : "ok");
      if (yoq.length) log("＋ " + yoq.map(sinfNomi).join(", "));
      if (passiv.length) log(`⚠ ERPda bor, lekin holati Aktiv emas (qo'lda tahrirlang): ${passiv.map(sinfNomi).join(", ")}`, "ogoh");
      if (ortiqcha.length) log(`• ERPda bor, eMaktabda yo'q (tegilmaydi): ${ortiqcha.map(sinfNomi).join(", ")}`, "dim");
      return { yoq, maxTartib };
    }

    async function yarat(sinov) {
      const n = await solishtir();
      if (!n.yoq.length) { log("✔ Hamma sinf ERPda bor — yaratadigan narsa yo'q", "ok"); return; }
      if (formadami()) throw new Error("forma ochiq — avval «Orqaga» bilan ro'yxatga qayting");
      const soz = sozlama();
      if (!sinov && !confirm(`ERPda ${n.yoq.length} ta sinf yaratiladi:\n${n.yoq.map(sinfNomi).join(", ")}\n\n`
        + `Filial: «${soz.filial}», holati: Aktiv, tartib raqami ${n.maxTartib + 1} dan.\nDavom etilsinmi?`)) { log("Bekor qilindi", "dim"); return; }

      let tartib = n.maxTartib, yaratildi = 0, ketmaXato = 0, ketmaXos = 0;
      for (let i = 0; i < n.yoq.length; i++) {
        toxta();
        const sinf = n.yoq[i];
        $("holat").textContent = `${i + 1}/${n.yoq.length}: ${sinfNomi(sinf)}…`;
        try {
          await formaOch();
          const izoh = await formaTolat(sinf, tartib + 1, soz);
          if (sinov) {
            log(`🧪 SINOV — ${sinfNomi(sinf)} (eMaktab «${sinf.asl}») formasi to'ldirildi, SAQLANMADI:`, "ogoh");
            izoh.forEach((x) => log("   " + x, "dim"));
            log("Formani ko'zdan kechiring. To'g'ri bo'lsa «Orqaga» ni bosib ro'yxatga qayting va «▶ Yetishmaganlarini yaratish» ni bosing.", "ogoh");
            return;
          }
          const oldingi = new Set(xabarlar());
          const saqlash = tugma(RE_SAQLASH);
          if (!saqlash) throw new Error("«Saqlash» tugmasi topilmadi");
          saqlash.click();
          const r = await saqlashNatijasi(oldingi);
          if (!r.ok) { const e = new Error(r.sabab); e.nomalum = r.nomalum; throw e; }
          tartib++; yaratildi++; ketmaXato = 0; ketmaXos = 0;
          log(`✔ ${sinfNomi(sinf)} yaratildi (tartib ${tartib})${r.xabar ? " — " + r.xabar : ""}`, "ok");
          await royxatgaQayt();
        } catch (err) {
          if (err.message === TOXTATILDI) throw err;
          log(`✖ ${sinfNomi(sinf)}: ${err.message}`, "xato");
          // Sinfga xos xato (harf ro'yxatda yo'q) — keyingi sinfga o'tiladi, lekin
          // ketma-ket 4 tasi allaqachon tizimli nosozlik. Noma'lum natija yoki
          // ketma-ket ikki tizimli xato — to'xtaymiz: sabab bitta bo'lsa qolgan
          // sinflar ham shu yerda yiqiladi.
          if (err.xos) ketmaXos++; else ketmaXato++;
          if (sinov || err.nomalum || ketmaXato >= 2 || ketmaXos >= 4) {
            log("■ To'xtatildi. Forma ochiq qolgan bo'lsa ko'zdan kechiring; sabab tushunarsiz bo'lsa «🧾 Tashxis» faylini dasturchiga bering.", "ogoh");
            return;
          }
          await royxatgaQayt();
        }
      }
      log(`🏁 Tugadi: ${yaratildi} ta sinf yaratildi. Qayta tekshirilmoqda…`, "ok");
      await sleep(600);
      await solishtir();
    }

    async function ishga(fn) {
      if (HOLAT.ishlayapti) return;
      HOLAT.ishlayapti = true; HOLAT.toxtat = false;
      ["solishtir", "sinov", "yarat"].forEach((id) => { $(id).disabled = true; });
      $("toxtat").disabled = false;
      try { await fn(); }
      catch (err) { log(err.message === TOXTATILDI ? TOXTATILDI : `✖ ${err.message}`, err.message === TOXTATILDI ? "ogoh" : "xato"); }
      finally {
        HOLAT.ishlayapti = false;
        ["solishtir", "sinov", "yarat"].forEach((id) => { $(id).disabled = false; });
        $("toxtat").disabled = true;
        $("holat").textContent = "ERP «Maktab sinflari» RO'YXATI ochiq tursin. Ish paytida sahifaga tegmang.";
      }
    }
    $("solishtir").onclick = () => ishga(solishtir);
    $("sinov").onclick = () => ishga(() => yarat(true));
    $("yarat").onclick = () => ishga(() => yarat(false));
    $("toxtat").onclick = () => { HOLAT.toxtat = true; };
    $("tashxis").onclick = () => { yuklab("erp-sinf-tashxis.json", erpTashxis(), "application/json"); log("🧾 Tashxis fayli yuklandi", "ok"); };

    // ⚠️ ERP — SPA: skript bir marta yuklanadi, sahifalar esa ichkarida
    //  almashadi. Tugma faqat «Maktab sinflari» bo'limida ko'rinadi.
    const sinflarSahifasimi = () => !!erpJadval() || formadami()
      || [...document.querySelectorAll("h1, h2, h3, h4, h5, .card-title, .card-header")]
        .some((el) => visible(el) && /^(maktabsinflari|shkolnieklassi|klassishkoli)$/.test(normKey(txt(el))));
    const korsat = () => {
      const kerak = QOLDA || HOLAT.ishlayapti || panel.classList.contains("ochiq") || sinflarSahifasimi();
      host.style.display = kerak ? "" : "none";
    };
    korsat();
    setInterval(korsat, 1500);
  }

  if (EMAKTAB_REJIM) {
    // Tugma faqat boshqaruv bo'limida (sinflar ro'yxati shu yerda); Console'da — har doim
    if (QOLDA || /\/v2\/admin\b/i.test(location.pathname)) emaktabPanel();
  } else {
    erpPanel();
  }
})();
