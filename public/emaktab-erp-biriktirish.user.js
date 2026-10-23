// ==UserScript==
// @name         eMaktab ↔ ERP.MAKTAB.UZ o'quvchilarni biriktirish
// @namespace    https://smartjadval.uz/
// @version      0.4.0
// @description  eMaktab «Maktab shaxslarini ERP.MAKTAB.UZ bilan biriktirish» sahifasida o'quvchilarni avtomatik bog'laydi: sinf raqami bir xil ERP sinflaridan ism-familiya + tug'ilgan sana bo'yicha topadi, tasdiqlaydi; ikkala tomonda bog'lanmaganlarni Excel qiladi
// @author       smartjadval.uz
// @match        https://emaktab.uz/manual-erp-persons-mapping*
// @match        https://*.emaktab.uz/manual-erp-persons-mapping*
// @match        https://*.kundalik.com/manual-erp-persons-mapping*
// @grant        unsafeWindow
// @noframes
// @run-at       document-idle
// @updateURL    https://smartjadval.uz/emaktab-erp-biriktirish.user.js
// @downloadURL  https://smartjadval.uz/emaktab-erp-biriktirish.user.js
// ==/UserScript==

// ⚠️ SKRIPTGA TEGSANGIZ `@version` NI OSHIRING — Tampermonkey yangilanishni
//    faqat raqam bo'yicha biladi.

// =====================================================================
//  eMAKTAB ↔ ERP.MAKTAB.UZ O'QUVCHILARNI BIRIKTIRISH
//
//  Sahifa: https://emaktab.uz/manual-erp-persons-mapping?schoolId=…
//  (eMaktab → «Maktab shaxslarini ERP.MAKTAB.UZ bilan biriktirish»).
//
//  SAHIFA TUZILISHI (08.10.2026 dagi skrinshotlardan):
//    • Yorliqlar: Barcha / Biriktirilmagan / Biriktirilgan
//    • «eMaktab dagi sinf» — ro'yxat: «1 A», «1 A O», «1 A Q», «1 A Y», …
//    • «ERP.MAKTAB.UZ dagi sinf» — ro'yxat: «1-A», «1-D», «1-D ("TURON ODOB
//      ILM" Qo'qon shahar filiali)», «1-H ("TURON ODOB ILM" Qo'qon s…)», …
//    • «Bog'lanmagan shaxslar soni: 22»
//    • Har qator: CHAPDA eMaktab o'quvchisi (F.I.O, Sinf, tug'ilgan sana,
//      jins, JSHSHIR, Foydalanuvchi, Login); O'NGDA «Biriltirish uchun mos
//      talabani tanlang» ro'yxati (TANLANGAN ERP sinfidagi talabalar, F.I.O
//      KATTA HARFDA). Talaba tanlangach o'ngda uning Sinf / tug'ilgan sana /
//      jins / JSHSHIR chiqadi va «Birikmani tasdiqlash» / «Asliga qaytarish»
//      tugmalari paydo bo'ladi.
//
//  NIMA QILADI:
//    1) Ikkala sinf ro'yxatini o'qiydi.
//    2) Har eMaktab sinfi (masalan «1 A Q», 1-sinf, Qo'qon) uchun ERP ning
//       SHU RAQAMLI sinflarini (avval shu filial, keyin — belgi qo'yilsa —
//       boshqa filiallar) birma-bir tanlaydi.
//    3) Har bog'lanmagan eMaktab o'quvchisi uchun o'ng ro'yxatdagi ERP
//       talabalaridan ISM-FAMILIYASI mos keladiganini topadi (apostrof,
//       x↔h, kirill/lotin, so'z tartibi, «o'g'li/qizi» farq qilmaydi).
//    4) Topilganini tanlab, o'ngda chiqqan TUG'ILGAN SANAni solishtiradi:
//       mos — «Birikmani tasdiqlash»; mos emas — «Asliga qaytarish», bola
//       «shubhali» ro'yxatiga tushadi (qo'lda hal qilinadi).
//    5) Oxirida Excel: Xulosa · Biriktirildi · eMaktab bog'lanmagan (sabab
//       bilan) · ERP bog'lanmagan · Shubhali · Sinflar.
//
//  ⚠️ SAHIFA JONLI O'RGANILMAGAN — ro'yxatlar (react-select ko'rinishida)
//    sichqoncha hodisalari bilan ochiladi, kartalar MATN bo'yicha o'qiladi.
//    Avval SINOV rejimida yuring: hamma narsa topiladi, tanlanadi, lekin
//    «Birikmani tasdiqlash» BOSILMAYDI («Asliga qaytarish» bosiladi).
//    Noto'g'ri ishlasa «🧾 Tashxis» va «⏺ Yozuv» fayllarini dasturchiga bering.
//
//  ⚠️ SKRIPT HECH QACHON BIRIKMANI BEKOR QILMAYDI, faqat yangi birikma
//    tasdiqlaydi. «Biriktirilgan» yorlig'i faqat hisobot uchun o'qiladi.
// =====================================================================

(function () {
  "use strict";

  const HOST_ID = "sj-erp-birik-host";
  if (document.getElementById(HOST_ID)) return;
  const W = (typeof unsafeWindow !== "undefined" && unsafeWindow) || window;
  const VERSIYA = (typeof GM_info !== "undefined" && GM_info && GM_info.script && GM_info.script.version) || "0.4.0";

  const LS = {
    ochiq: "sj_erpb_panel_ochiq",
    filial: "sj_erpb_filial_v1",
    natija: "sj_erpb_natija_v1",
    recOn: "sj_erpb_rec_on",
    rec: "sj_erpb_rec_data",
    sozlama: "sj_erpb_sozlama_v1",
  };
  const HOLAT = { toxtat: false, ishlayapti: false };
  const TOXTATILDI = "■ To'xtatildi";
  function toxta() { if (HOLAT.toxtat) throw new Error(TOXTATILDI); }

  // ===================================================================
  //  1-QISM. KICHIK YORDAMCHILAR
  // ===================================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ⚠️ textContent EMAS (0.2.0 da «…o`g`lio‘quvchiSinf: 1 A27.10.2019…» bo'lib
  //  ism butun karta bo'lib chiqqan, «soni: 8» + karta raqami «1» = «81»).
  //  Matn tugunlari BO'SH JOY bilan birlashtiriladi; ko'rinmas U+2066–2069
  //  yo'nalish belgilari tashlanadi.
  const tozaMatn = (s) => String(s == null ? "" : s).replace(/[\u2066-\u2069\u200e\u200f\u200b]/g, "").replace(/\s+/g, " ").trim();
  const txt = (el) => {
    if (!el) return "";
    if (el.nodeType === 3) return tozaMatn(el.nodeValue);
    if (!el.childNodes || !el.childNodes.length) return tozaMatn(el.textContent);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const pe = n.parentElement;
      if (pe && (pe.tagName === "SCRIPT" || pe.tagName === "STYLE")) continue;
      const t = tozaMatn(n.nodeValue); if (t) parts.push(t);
    }
    return parts.join(" ");
  };
  const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  const cut = (s, n = 3000) => { const x = String(s == null ? "" : s); return x.length > n ? x.slice(0, n) + "…" : x; };
  const begona = (el) => !!(el && el.closest && el.closest("#" + HOST_ID));
  function lsOl(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } }
  function lsYoz(k, v) { try { localStorage.setItem(k, v); } catch { /* kvota */ } }
  async function waitFor(fn, ms = 5000, step = 100) {
    const t0 = Date.now();
    for (;;) {
      toxta();
      let r = null;
      try { r = fn(); } catch { /* */ }
      if (r) return r;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }
  // DOM tinchiguncha kutish (SPA ro'yxat qayta chizilgach)
  async function barqaror(tinch = 250, max = 8000) {
    let oxirgi = Date.now();
    const mo = new MutationObserver(() => { oxirgi = Date.now(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    const t0 = Date.now();
    try {
      for (;;) {
        toxta();
        await sleep(120);
        if (Date.now() - oxirgi >= tinch) return true;
        if (Date.now() - t0 > max) return false;
      }
    } finally { mo.disconnect(); }
  }
  function yuklab(nom, matn, tur) {
    const url = URL.createObjectURL(matn instanceof Blob ? matn : new Blob([matn], { type: tur || "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const bugun = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

  // Sichqoncha hodisalari (react-select mousedown'ni, boshqalar click'ni tinglaydi)
  function sichqon(el, turlar = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    if (!el) return;
    for (const t of turlar) {
      const E = /pointer/.test(t) ? (W.PointerEvent || MouseEvent) : MouseEvent;
      try { el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, view: W, button: 0, buttons: 1 })); } catch { /* */ }
    }
  }
  function tugma(el, key, code) {
    for (const t of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
  }
  // React boshqaradigan <input> ga qiymat yozish (native setter + input hodisasi)
  function qiymatYoz(inp, v) {
    const set = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (set && set.set) set.set.call(inp, v); else inp.value = v;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ===================================================================
  //  2-QISM. NOM KALITLARI (emaktab-oquvchilar.user.js dagi bilan bir xil)
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
  // Ism kalitlari: toliq (hamma so'z), qisqa (familiya+ism), tartibsiz (so'zlar
  //  alifbo tartibida). «o'g'li/qizi» tashlanadi, x→h, -ovich/-ovna kesiladi.
  function ismKalit(raw) {
    const s = String(raw == null ? "" : raw).replace(APOS, "").replace(/\s+/g, " ").trim();
    const w = s.split(" ").map((x) => normKey(x).replace(/x/g, "h").replace(/ovich$|ovna$|evich$|evna$/, ""))
      .filter((x) => x && !/^(ogli|ugli|qizi|kizi|уғли|қизи)$/.test(x));
    return { toliq: w.join(""), qisqa: w.slice(0, 2).join(""), tartibsiz: [...w].sort().join(""), sozlar: w };
  }
  // ⚠️ YUMSHOQ (TAXMINIY) KALIT (0.2.3, 08.10.2026 jurnalidan): eMaktab va
  //  ERPda bir bola har xil yozilgan — «Bekmurodjon» ↔ «BEKMUROD»,
  //  «Musirmonjon» ↔ «MUSURMONJON», «Oishaxon Muhamadali» ↔ «OYSHA
  //  MUXAMMADALI», «Bekmurod» ↔ «BEGMURODJON», «Hushnoza» ↔ «HUSHNOZAXON»,
  //  «xiddinova» ↔ «XIDINOVA». So'z: x→h, q/g→k, -jon/-xon/-bek/-boy/-bonu
  //  qo'shimchalari kesiladi, takror harf bitta, birinchi harfdan keyingi
  //  UNLILAR tashlanadi (undosh skeleti). Bu juda yumshoq — shuning uchun
  //  taxminiy moslikda TUG'ILGAN SANA MAJBURIY mos kelishi kerak va nomzod
  //  bittadan ko'p bo'lsa (Hasanjon/Husanjon egizaklar) avtomatik bajarilmaydi.
  function yumshoq(w) {
    let x = String(w || "").replace(/x/g, "h").replace(/[qg]/g, "k");
    for (;;) { const t = x.replace(/(jon|hon|bek|boy|bonu|bibi)$/, ""); if (t === x || t.length < 3) break; x = t; }
    x = x.replace(/(.)\1+/g, "$1");
    return x.length > 1 ? x[0] + x.slice(1).replace(/[aeiouy]/g, "") : x;
  }
  // Otasining ismi ikkalasida yozilib, har xil bo'lsa — boshqa odam
  function sharifZid(a, b) {
    const sa = ismKalit(a).sozlar[2] || "", sb = ismKalit(b).sozlar[2] || "";
    return !!(sa && sb && sa !== sb && !sa.startsWith(sb) && !sb.startsWith(sa));
  }
  const sanaNorm = (s) => {
    const m1 = String(s || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (m1) return `${m1[1].padStart(2, "0")}.${m1[2].padStart(2, "0")}.${m1[3]}`;
    const m2 = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return m2 ? `${m2[3]}.${m2[2]}.${m2[1]}` : "";
  };

  // ===================================================================
  //  3-QISM. SINF NOMLARI VA FILIAL
  //
  //  eMaktab «1 A Q» → raqam 1, harf A, filial harfi Q (oxirgi harf filial
  //  jadvalida bo'lsa). «1 A» → filial harfi bo'sh (Furqat).
  //  ERP «1-D ("TURON ODOB ILM" Qo'qon shahar filiali)» → raqam 1, harf D,
  //  filial — qavs ichidagi matnda jadvaldagi kalit so'z («qoqon») bo'lsa
  //  o'sha harf; qavs yo'q yoki so'z topilmasa — bo'sh (Furqat).
  //  Jadval panelda:  Q = Qo'qon  /  O = Oltiariq  /  Y = Yaypan  /  = Furqat
  // ===================================================================
  const FILIAL_DEF = "Q = Qo'qon\nO = Oltiariq\nY = Yaypan\n = Furqat";
  function filialXarita(matn) {
    const out = [];   // {harf, soz}
    String(matn || "").split("\n").forEach((q) => {
      const i = q.indexOf("=");
      if (i < 0) return;
      out.push({ harf: normKey(q.slice(0, i)), soz: normKey(q.slice(i + 1)) });
    });
    return out;
  }
  function emkSinf(nom, filiallar) {
    const s = String(nom || "").replace(APOS, "").trim();
    const m = s.match(/^(\d{1,2})\s*[-–—_. ]?\s*([\s\S]*)$/);
    if (!m) return null;
    const harflar = [];
    for (const soz of m[2].split(/[\s\-–—_.]+/)) { if (!soz) continue; if (!/^[A-Za-zЀ-ӿ]{1,3}$/.test(soz)) break; harflar.push(normKey(soz)); }
    let filial = "";
    if (harflar.length >= 2 && filiallar.some((f) => f.harf && f.harf === harflar[harflar.length - 1])) filial = harflar.pop();
    return { nom, daraja: Number(m[1]), harf: harflar.join(""), filial };
  }
  function erpSinf(nom, filiallar) {
    const s = String(nom || "").replace(APOS, "").trim();
    const m = s.match(/^(\d{1,2})\s*[-–—_. ]?\s*([A-Za-zЀ-ӿ]{1,3})?/);
    if (!m) return null;
    const qavs = (s.match(/\((.*)\)/) || [])[1] || "";
    const qk = normKey(qavs);
    let filial = "";
    if (qk) { const f = filiallar.find((x) => x.soz && qk.includes(x.soz)); if (f) filial = f.harf; }
    return { nom, daraja: Number(m[1]), harf: normKey(m[2] || ""), filial, qavs };
  }

  // ===================================================================
  //  4-QISM. SAHIFA VIDJETLARI — ro'yxat (select), yorliqlar, kartalar
  //
  //  ⚠️ 08.10.2026 TASHXISDAN O'QILDI (0.1.0 «ro'yxat topilmadi» bergan):
  //   • Ro'yxatlar <input>/<select> EMAS — maxsus div:
  //       <div class="Alu0D" data-test-id="erp-unlinked-card-select-<id>">
  //         <span class="FmGrs">-</span><span><svg …chevron…></span></div>
  //     Bosilganda ichida qidiruv inputi («Sinfni kiriting» / «FISHni
  //     kiriting») va variantlar ro'yxati paydo bo'ladi. Klass nomlari
  //     tasodifiy (build hash) — ularga tayanilmaydi; vidjet CHEVRON SVG
  //     (path d="M16 10.5L12 14.5L8 10.5") bo'yicha, ochilgan ro'yxat esa
  //     MutationObserver bilan «yangi qo'shilgan tugunlar» ichidan topiladi.
  //   • Qator:  div > [data-test-id="emaktab-card-<id>"] (chap: ism bloki +
  //     Sinf/sana/JSHSHIR/Login bloki) + strelka + [data-test-id="erp-
  //     unlinked-card-<id>"] (o'ng). <id> — eMaktab shaxs ID si (kalit).
  //   • Sahifalash tugmalari: «<», «1», «2», …, «>».
  //   • Matnda ko'rinmas U+2066–2069 belgilar bor («⁨erkak⁩») — txt() tozalaydi.
  // ===================================================================
  const CHEVRON = 'path[d^="M16 10.5L12 14.5L8 10.5"]';
  const PANELLAR = '#' + HOST_ID + ', [id^="sj-"], [id^="emb-"]';
  const begonaYoki = (el) => !!(el && el.closest && el.closest(PANELLAR));

  // Sahifadagi hamma ro'yxat vidjeti (chevronli div). Fallback: data-test-id *select*
  function selectVidjetlar() {
    const out = [];
    document.querySelectorAll(CHEVRON).forEach((p) => {
      const svg = p.closest("svg"); if (!svg) return;
      let w = svg.parentElement;
      if (w && w.tagName === "SPAN") w = w.parentElement;
      if (w && visible(w) && !begonaYoki(w) && !out.includes(w)) out.push(w);
    });
    if (!out.length) document.querySelectorAll('[data-test-id*="select"]').forEach((w) => { if (visible(w) && !out.includes(w)) out.push(w); });
    return out;
  }
  const kartaIchida = (el) => !!el.closest('[data-test-id^="erp-"], [data-test-id^="emaktab-card"]');
  // Yorliq matni bo'yicha vidjet: yorliqdan KEYIN keladigan birinchi vidjet (kartadan tashqari)
  function yorliqVidjet(re, tartib) {
    const tashqari = selectVidjetlar().filter((w) => !kartaIchida(w));
    const yorliq = [...document.querySelectorAll("label, span, div, p, b, strong")]
      .find((el) => visible(el) && !begonaYoki(el) && re.test(txt(el)) && txt(el).length < 40 && !el.querySelector("svg"));
    if (yorliq) {
      const w = tashqari.find((x) => yorliq.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (w) return w;
    }
    return tashqari[tartib] || null;
  }
  const emkSinfVidjet = () => yorliqVidjet(/^e\s*maktab\s*dagi\s*sinf/i, 0);
  const erpSinfVidjet = () => yorliqVidjet(/^ERP.*dagi\s*sinf/i, 1);

  // Vidjetda ko'rinib turgan qiymat (placeholder emas)
  function vidjetQiymati(w) {
    const inp = w.querySelector("input");
    let t = txt(w);
    if (inp && inp.value) t = t.replace(inp.value, " ");
    return t.replace(/sinfni kiriting|fishni kiriting|tanlang/ig, "").replace(/^-$/, "").trim();
  }

  // Ochiq menyu: { konteyner, variantlar() } — modul darajasida saqlanadi
  let OCHIQ = null;
  const ochiqVariantlar = () => (OCHIQ && OCHIQ.konteyner.isConnected && visible(OCHIQ.konteyner)) ? OCHIQ.variantlar() : [];
  // Qo'shilgan tugunlar ichidan variantlar ro'yxatini topish: bolalari matnli
  //  elementlar bo'lgan, eng ko'p bolali konteyner
  function royxatTop(qoshilgan, w) {
    let eng = null, engN = 0;
    const kor = (el) => {
      if (!el || el.nodeType !== 1 || !el.isConnected || begonaYoki(el) || !visible(el)) return;
      const bolalar = [...el.children].filter((ch) => visible(ch) && txt(ch) && txt(ch).length < 220 && !ch.querySelector("input"));
      if (bolalar.length > engN && bolalar.length >= 1 && !(bolalar.length === 1 && el.contains(w))) { eng = el; engN = bolalar.length; }
      [...el.children].forEach(kor);
    };
    qoshilgan.forEach(kor);
    if (!eng) return null;
    const konteyner = eng;
    return { konteyner, w, variantlar: () => [...konteyner.children].filter((ch) => visible(ch) && txt(ch) && !ch.querySelector("input")) };
  }
  async function menyuYop(w) {
    const inp = (w && w.querySelector("input")) || document.activeElement;
    try { if (inp && inp.tagName === "INPUT") { tugma(inp, "Escape", 27); inp.blur(); } } catch { /* */ }
    sichqon(document.body, ["mousedown", "click"]);
    await waitFor(() => !ochiqVariantlar().length, 1500, 60);
    OCHIQ = null;
  }
  // Menyuni ochish: bosish usullari ketma-ket, yangi chiqqan ro'yxat kutiladi
  async function menyuOch(w) {
    if (OCHIQ && OCHIQ.w === w && ochiqVariantlar().length) return OCHIQ;
    if (OCHIQ) await menyuYop(OCHIQ.w);
    const qoshilgan = new Set();
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) qoshilgan.add(n); })));
    mo.observe(document.body, { childList: true, subtree: true });
    try {
      const nishon = w.querySelector("span") || w;
      const usullar = [
        () => sichqon(w, ["click"]),
        () => sichqon(nishon, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]),
        () => sichqon(w, ["pointerdown", "mousedown"]),
        () => { if (w.focus) w.focus(); tugma(w, "ArrowDown", 40); },
      ];
      for (const u of usullar) {
        u();
        const r = await waitFor(() => royxatTop(qoshilgan, w), 1000, 80);
        if (r) { OCHIQ = r; await sleep(60); return r; }
      }
    } finally { mo.disconnect(); }
    return null;
  }
  // Menyudagi HAMMA variant matni (virtual/aylanma ro'yxat bo'lsa aylantirib yig'iladi)
  async function variantlarniOqi(w) {
    const m = await menyuOch(w);
    if (!m) return null;
    const yig = new Set();
    for (let k = 0; k < 80; k++) {
      let yangi = 0;
      m.variantlar().forEach((el) => { const t = txt(el); if (!yig.has(t)) { yig.add(t); yangi++; } });
      const sc = [m.konteyner, m.konteyner.parentElement, m.konteyner.parentElement && m.konteyner.parentElement.parentElement]
        .find((x) => x && x.scrollHeight > x.clientHeight + 4);
      if (!sc) break;
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 && !yangi) break;
      sc.scrollTop += sc.clientHeight * 0.8;
      await sleep(50);
    }
    await menyuYop(w);
    return [...yig].filter((t) => !/^(no options|variant yo.?q|hech narsa topilmadi|ro.?yxat bo.?sh|list is empty|-)$/i.test(t));
  }
  // Variantni tanlash: ro'yxatda ko'rinmasa qidiruv inputiga terib filtrlanadi
  async function variantTanla(w, matn) {
    const kalit = normKey(matn);
    const top = () => ochiqVariantlar().find((el) => normKey(txt(el)) === kalit)
      || ochiqVariantlar().find((el) => normKey(txt(el)).startsWith(kalit) || (kalit.length > 6 && kalit.startsWith(normKey(txt(el)))));
    if (normKey(vidjetQiymati(w)) === kalit) return true;
    const m = await menyuOch(w);
    if (!m) return false;
    let el = top();
    if (!el) {
      const inp = w.querySelector("input") || document.activeElement;
      if (inp && inp.tagName === "INPUT") {
        qiymatYoz(inp, String(matn).split("(")[0].trim());
        await sleep(300);
        el = await waitFor(top, 2500, 80);
        if (!el) { qiymatYoz(inp, ""); await sleep(200); el = top(); }
      }
    }
    if (!el) { await menyuYop(w); return false; }
    el.scrollIntoView({ block: "nearest" });
    // ⚠️ Bosish ENG ICHKI matnli elementga (0.2.3: talaba ro'yxatida tanlov
    //  ko'rinsa ham sahifa holatiga tushmagan — handler ichki elementda
    //  bo'lishi mumkin; hodisa yuqoriga ko'tariladi, pastga emas)
    let ichki = el;
    for (;;) { const b = [...ichki.children].find((ch) => txt(ch) === txt(el)); if (!b) break; ichki = b; }
    sichqon(ichki);
    const ok = await waitFor(() => normKey(vidjetQiymati(w)) === kalit || (!ochiqVariantlar().length && normKey(vidjetQiymati(w)).includes(kalit.slice(0, 6))), 3000, 80);
    if (ochiqVariantlar().length) await menyuYop(w); else OCHIQ = null;
    await sleep(60);
    return !!ok;
  }
  // Klaviatura bilan tanlash: menyu ochiladi, qidiruv inputiga teriladi,
  //  ArrowDown + Enter. Sichqoncha hodisalari sahifa holatini o'zgartirmasa.
  async function variantTanlaKlaviatura(w, matn) {
    const kalit = normKey(matn);
    const m = await menyuOch(w);
    if (!m) return false;
    const inp = w.querySelector("input") || (document.activeElement && document.activeElement.tagName === "INPUT" ? document.activeElement : null);
    if (!inp) { await menyuYop(w); return false; }
    qiymatYoz(inp, String(matn).split("(")[0].trim());
    await sleep(350);
    const bitta = await waitFor(() => { const v = ochiqVariantlar(); return v.length === 1 || v.find((el) => normKey(txt(el)) === kalit) ? v : null; }, 2500, 80);
    if (!bitta) { await menyuYop(w); return false; }
    tugma(inp, "ArrowDown", 40);
    await sleep(80);
    tugma(inp, "Enter", 13);
    const ok = await waitFor(() => normKey(vidjetQiymati(w)) === kalit, 3000, 80);
    if (ochiqVariantlar().length) await menyuYop(w); else OCHIQ = null;
    await sleep(150);
    return !!ok;
  }

  // Yorliqlar: Barcha / Biriktirilmagan / Biriktirilgan; sahifalash tugmalari
  function tugmaMatnli(re) {
    return [...document.querySelectorAll("button, a, [role=tab], [role=button]")]
      .filter((el) => visible(el) && !begonaYoki(el) && re.test(txt(el)) && txt(el).length < 25)
      .sort((a, b) => txt(a).length - txt(b).length)[0] || null;
  }
  async function yorliqniTanla(re) {
    const b = tugmaMatnli(re);
    if (!b) return false;
    sichqon(b);
    await sleep(150);
    await barqaror(250, 8000);
    return true;
  }
  const tugmaOchiqmi = (b) => !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true" && !/disabled/i.test(b.className || "");
  // Birinchi sahifaga qaytish (sinf almashganda sahifa raqami qolib ketmasin)
  async function birinchiSahifa() {
    const b = tugmaMatnli(/^1$/);
    if (b && tugmaOchiqmi(b)) { sichqon(b); await sleep(120); await barqaror(250, 6000); }
  }
  // Keyingi sahifa: «>» bosiladi; qatorlar o'zgarmasa — oxirgi sahifa
  async function keyingiSahifa() {
    const b = tugmaMatnli(/^(>|›|»|keyingi|next)$/i);
    if (!tugmaOchiqmi(b)) return false;
    const oldin = chapKartalar().map(kartaId).join(",");
    sichqon(b);
    await sleep(150);
    await barqaror(250, 8000);
    return chapKartalar().map(kartaId).join(",") !== oldin;
  }
  // «Bog'lanmagan shaxslar soni: 22»
  function boglanmaganSoni() {
    const m = txt(document.body).match(/Bog.?lanmagan\s+shaxslar\s+soni:?\s*(\d+)/i);
    return m ? Number(m[1]) : -1;
  }

  // ——— Kartalar ———
  const CHAP_RE = [/Sinf:/i, /JSHSHIR/i, /Login:/i];
  const kartaId = (el) => (String(el.getAttribute("data-test-id") || "").match(/(\d+)$/) || [])[1] || "";
  function chapKartalar() {
    const a = [...document.querySelectorAll('[data-test-id^="emaktab-card-"]')].filter((el) => visible(el) && !begonaYoki(el));
    if (a.length) return a;
    // Zaxira: «Sinf:/JSHSHIR/Login:» bloki → uning otasi (ism bloki bilan birga)
    const hamma = [...document.querySelectorAll("div, li")].filter((el) => {
      if (begonaYoki(el) || !visible(el)) return false;
      const t = txt(el); return t.length < 600 && CHAP_RE.every((re) => re.test(t));
    }).filter((el) => ![...el.children].some((ch) => CHAP_RE.every((re) => re.test(txt(ch)))));
    return hamma.map((el) => (el.parentElement && !CHAP_RE.every((re) => re.test(txt(el.parentElement.parentElement || el))) ? el.parentElement : el));
  }
  const SANA_RE = /(\d{2}\.\d{2}\.\d{4})/;
  function chapOqi(el) {
    const t = txt(el).replace(/^\d+\s+/, "");
    const fio = t.split(/\s+(?:o[‘'`ʻ]?quvchi|xodim|ota-ona|Sinf:)/i)[0].trim();
    const sinf = (t.match(/Sinf:\s*(.+?)\s+(?=\d{2}\.\d{2}\.\d{4}|JSHSHIR)/i) || [])[1] || "";
    const sana = (t.match(SANA_RE) || [])[1] || "";
    const jins = /ayol/i.test(t) ? "ayol" : (/erkak/i.test(t) ? "erkak" : "");
    const pinfl = (t.match(/JSHSHIR:?\s*(\d{14})/i) || [])[1] || "";
    const login = (t.match(/Login:?\s*(\S+)/i) || [])[1] || "";
    const foyd = (t.match(/Foydalanuvchi:?\s*(.+?)\s+Login:/i) || [])[1] || "";
    return { id: kartaId(el), fio, sinf, sana, jins, pinfl, login, foyd, el };
  }
  // Qator = chap kartaning otasi (chap + strelka + o'ng): o'ng karta yoki boshqa
  //  chap karta paydo bo'lguncha yuqoriga chiqiladi
  function qatorKonteyner(chap) {
    const hamma = chapKartalar();
    let el = chap;
    while (el.parentElement && el.parentElement !== document.body) {
      const p = el.parentElement;
      if (hamma.filter((x) => p.contains(x)).length > 1) return el;
      if (p.querySelector('[data-test-id^="erp-"]')) return p;
      el = p;
    }
    return el;
  }
  // ⚠️ «Birikmani tasdiqlash» / «Asliga qaytarish» — <button> EMAS, oddiy div
  //  (0.3.0 jurnali): <div class="CLOT8 ddWz0" data-test-id="erp-unlinked-card-
  //  confirmButton-<id>">Birikmani tasdiqlash</div>. Avval data-test-id
  //  bo'yicha, bo'lmasa matni mos keladigan ENG ICHKI element.
  function tugmaTop(root, re, testId) {
    if (testId) {
      const b = [...root.querySelectorAll(`[data-test-id*="${testId}"]`)].find((x) => visible(x));
      if (b) return b;
    }
    return [...root.querySelectorAll("button, a, [role=button], div, span")]
      .find((b) => visible(b) && re.test(txt(b)) && txt(b).length < 40 && ![...b.children].some((ch) => re.test(txt(ch)))) || null;
  }
  // O'ng karta holati va ma'lumoti
  function ongOqi(qator, chap) {
    const ong = qator.querySelector('[data-test-id^="erp-"]') || qator;
    const sel = selectVidjetlar().find((w) => ong.contains(w) && !chap.contains(w)) || null;
    const tasdiq = tugmaTop(ong, /tasdiqla/i, "confirmButton") || tugmaTop(qator, /tasdiqla/i, "confirmButton");
    const qaytar = tugmaTop(ong, /asliga|qaytar/i, "resetButton") || tugmaTop(qator, /asliga|qaytar/i, "resetButton");
    const t = (ong === qator || tasdiq && !ong.contains(tasdiq) ? txt(qator).replace(txt(chap), " ") : txt(ong)).replace(/\s+/g, " ").trim();
    const sana = (t.match(SANA_RE) || [])[1] || "";
    const pinfl = (t.match(/JSHSHIR:?\s*(\d{14})/i) || [])[1] || "";
    const sinf = (t.match(/Sinf:\s*(.+?)\s+(?=\d{2}\.\d{2}\.\d{4}|JSHSHIR)/i) || [])[1] || "";
    const jins = /ayol/i.test(t) ? "ayol" : (/erkak/i.test(t) ? "erkak" : "");
    // ERP F.I.O — vidjet qiymati; bog'langan kartada katta harfli sarlavha
    const erpFio = sel ? vidjetQiymati(sel) : ((t.match(/([A-ZА-Я`'‘’ʻ\s]{8,}?)\s+(?:o[‘'`ʻ]?quvchi|Sinf:)/) || [])[1] || "").trim();
    const bogli = /erp-linked|erp-mapped/i.test((ong.getAttribute && ong.getAttribute("data-test-id")) || "");
    let holat = "biriktirilgan";
    if (tasdiq) holat = "tanlangan";
    else if (sel && !bogli) holat = "bosh";
    return { sel, tasdiq, qaytar, holat, erpFio, sana, pinfl, sinf, jins, matn: t };
  }
  function qatorlarniOqi() {
    return chapKartalar().map((chap) => {
      const qator = qatorKonteyner(chap);
      return { chap: chapOqi(chap), ong: ongOqi(qator, chap), qator, chapEl: chap };
    });
  }
  // Sahifadagi ro'yxat tinchishini kutish; «yana» tugmasi bo'lsa bosiladi
  async function royxatniToldir() {
    await barqaror(250, 6000);
    for (let k = 0; k < 20; k++) {
      const n = chapKartalar().length;
      const yana = [...document.querySelectorAll("button, a")].find((b) => visible(b) && !begonaYoki(b) && /ko.?proq|yana|load more|show more/i.test(txt(b)) && tugmaOchiqmi(b));
      if (!yana) return n;
      sichqon(yana); await sleep(350); await barqaror(350, 5000);
      if (chapKartalar().length === n) return n;
    }
    return chapKartalar().length;
  }

  // ===================================================================
  //  5-QISM. TAQQOSLASH VA BIRIKTIRISH YURISHI
  //
  //  Natija (N) localStorage'da saqlanadi — F5 dan keyin ham Excel olinadi,
  //  bajarilgan bolalar qayta tekshirilmaydi.
  // ===================================================================
  let log = () => {};
  let holatYoz = () => {};
  const N = natijaTikla() || yangiNatija();
  function yangiNatija() {
    return { versiya: VERSIYA, vaqt: "", emkSinflar: [], erpSinflar: [], biriktirildi: [], shubhali: [], boglanmagan: [],
      erpTalabalar: {}, erpBiriktirilgan: [], bajarilgan: {}, sinfJurnali: [] };
  }
  function natijaTikla() { try { const s = JSON.parse(lsOl(LS.natija, "") || "null"); return s && s.biriktirildi ? s : null; } catch { return null; } }
  function natijaSaqla() { N.vaqt = N.vaqt || new Date().toISOString(); lsYoz(LS.natija, JSON.stringify(N)); }
  function natijaTozala() { Object.assign(N, yangiNatija()); try { localStorage.removeItem(LS.natija); } catch { /* */ } }

  const qatorKaliti = (c) => c.id ? "id:" + c.id : (c.login ? "l:" + c.login : "f:" + normKey(c.fio) + "|" + c.sana);
  function qatorTop(kalit) { return qatorlarniOqi().find((r) => qatorKaliti(r.chap) === kalit) || null; }

  // Levenshtein masofasi — ism o'xshashligi uchun
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length; if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // Ikki ismning o'xshashligi 0…1: qattiq kalit (x→h, apostrofsiz, -ovich
  //  kesilgan, o'g'li/qizi tashlangan) va yumshoq kalit (undosh skeleti,
  //  -jon/-xon qo'shimchasiz) bo'yicha — kattasi olinadi. Sharif bir tomonda
  //  yo'q bo'lsa faqat familiya+ism solishtiriladi.
  function oxshashlik(a, b) {
    const ka = ismKalit(a).sozlar, kb = ismKalit(b).sozlar;
    const n = Math.min(ka.length, kb.length, 3) || 1;
    const sa = ka.slice(0, n), sb = kb.slice(0, n);
    const ball = (x, y) => { const L = Math.max(x.length, y.length) || 1; return 1 - levenshtein(x, y) / L; };
    const qattiq = ball(sa.join(""), sb.join(""));
    const yumshoqB = ball(sa.map(yumshoq).join(""), sb.map(yumshoq).join(""));
    // Familiya umuman boshqa bo'lsa (birinchi 3 harf farq) — o'xshash emas
    if (sa[0] && sb[0] && yumshoq(sa[0]).slice(0, 3) !== yumshoq(sb[0]).slice(0, 3)) return { ball: Math.min(qattiq, 0.5), qattiq };
    return { ball: Math.max(qattiq, yumshoqB), qattiq };
  }
  // ERP ro'yxatidan nomzodlar: avval to'liq moslik; bo'lmasa o'xshashligi
  //  `chegara` (standart 0.8) dan kam bo'lmaganlar, eng o'xshashi birinchi.
  //  Qaytadi: { ro: [{nom, ball}], daraja }
  function nomzodlar(fio, erpNomlar, chegara) {
    const k = ismKalit(fio);
    const aniq = erpNomlar.filter((n) => { const e = ismKalit(n); return e.toliq === k.toliq || e.tartibsiz === k.tartibsiz; });
    if (aniq.length) return { ro: aniq.map((nom) => ({ nom, ball: 1 })), daraja: "to'liq" };
    const ch = Number(chegara) > 0 ? Number(chegara) : 0.8;
    // ⚠️ EGIZAKLAR: «Hasanjon» ↔ «HUSANJON» yumshoq kalitda 100% (undosh skeleti
    //  bir xil), tug'ilgan sanasi ham bir xil. Shuning uchun teng ballda
    //  QATTIQ (harfma-harf) o'xshashligi yuqorisi birinchi; ikkalasi deyarli
    //  teng bo'lsa — qo'lda (kop).
    const ro = erpNomlar.map((nom) => ({ nom, ...oxshashlik(fio, nom) }))
      .filter((x) => (x.ball >= ch && !sharifZid(fio, x.nom)) || x.ball >= 0.95)
      .sort((x, y) => y.ball - x.ball || y.qattiq - x.qattiq);
    if (ro.length >= 2 && ro[0].ball === ro[1].ball && Math.abs(ro[0].qattiq - ro[1].qattiq) < 0.02) return { ro, daraja: "to'liq" };
    return { ro, daraja: ro.length ? "o'xshash" : "" };
  }

  // Sahifadagi xabar (toast / alert) — tasdiqdan keyin xato chiqsa jurnalga
  function xabarMatni() {
    return [...document.querySelectorAll('[class*="toast"], [class*="Toast"], [class*="alert"], [class*="notif"], [class*="snack"], [role="alert"], [class*="error"], [class*="Error"]')]
      .filter((el) => visible(el) && !begona(el)).map(txt).filter((s) => s && s.length < 300).filter((s, i, a) => a.indexOf(s) === i).join("; ");
  }

  async function sinflarniOqi(filiallar) {
    const ei = emkSinfVidjet(), ri = erpSinfVidjet();
    if (!ei || !ri) throw new Error(`«eMaktab dagi sinf» / «ERP.MAKTAB.UZ dagi sinf» ro'yxatlari topilmadi (chevronli vidjetlar: ${selectVidjetlar().length}) — sahifa o'zgargan bo'lishi mumkin («🧾 Tashxis»)`);
    const emk = (await variantlarniOqi(ei)) || [];
    const erp = (await variantlarniOqi(ri)) || [];
    if (!emk.length) throw new Error("eMaktab sinf ro'yxati bo'sh chiqdi (menyu ochilmadi?) — «🧾 Tashxis»");
    if (!erp.length) throw new Error("ERP sinf ro'yxati bo'sh chiqdi (menyu ochilmadi?) — «🧾 Tashxis»");
    N.emkSinflar = emk.map((n) => emkSinf(n, filiallar)).filter(Boolean);
    N.erpSinflar = erp.map((n) => erpSinf(n, filiallar)).filter(Boolean);
    natijaSaqla();
    return { emk: N.emkSinflar, erp: N.erpSinflar };
  }

  let TASHXIS_SONI = 0;
  // Qatorda nomzodni tanlab, o'ng kartada uning ma'lumoti va «tasdiqlash»
  //  tugmasi chiqishini kutish. Qaytadi: { r2, tanlandi, izoh }.
  async function tanlabKut(kalit, erpNom) {
    const r = qatorTop(kalit);
    if (!r || !r.ong.sel) return { r2: null, tanlandi: false, izoh: ["o'ng kartada ro'yxat (select) yo'q"] };
    const tanlandi = await variantTanla(r.ong.sel, erpNom);
    // ⚠️ O'NG KARTA ESKIRGAN MA'LUMOT KO'RSATISHI MUMKIN (08.10.2026 skrinshot:
    //  ERP sinfi almashtirilgach ro'yxatda «-», pastda esa oldingi talabaning
    //  sanasi va «tasdiqlash» tugmasi qolgan). Shuning uchun tanlangan ism
    //  kartada IKKI marta (ro'yxat qiymati + sarlavha) chiqishi kutiladi;
    //  chiqmasa — hech bo'lmaganda bir marta va tugma bor bo'lsin.
    const k0 = normKey(String(erpNom).split(/\s+/)[0]).replace(/x/g, "h");
    const necha = (x) => { const m = normKey(x.ong.matn).replace(/x/g, "h"); let c = 0, i = -1; while ((i = m.indexOf(k0, i + 1)) >= 0) c++; return c; };
    let r2 = await waitFor(() => { const x = qatorTop(kalit); return x && x.ong.tasdiq && necha(x) >= 2 ? x : null; }, 5000, 150);
    if (!r2) r2 = await waitFor(() => { const x = qatorTop(kalit); return x && x.ong.tasdiq && necha(x) >= 1 ? x : null; }, 3000, 150);
    if (!r2) {
      // Sichqoncha bilan tanlov sahifa holatiga tushmadi — klaviatura bilan
      const r1 = qatorTop(kalit);
      const kl = r1 && r1.ong.sel ? await variantTanlaKlaviatura(r1.ong.sel, erpNom) : false;
      if (kl) r2 = await waitFor(() => { const x = qatorTop(kalit); return x && x.ong.tasdiq && necha(x) >= 1 ? x : null; }, 5000, 150);
    }
    if (r2) { await barqaror(200, 2000); r2 = qatorTop(kalit) || r2; return { r2, tanlandi: true, izoh: [] }; }
    const izoh = [];
    const x = qatorTop(kalit);
    if (x && TASHXIS_SONI < 2) {
      TASHXIS_SONI++;
      izoh.push(`vidjet qiymati: «${x.ong.sel ? vidjetQiymati(x.ong.sel) : "(vidjet yo'q)"}», holat: ${x.ong.holat}, qator tugmalari: ${[...x.qator.querySelectorAll("button, a, [role=button], [data-test-id*=Button]")].map(txt).filter(Boolean).join(" | ") || "yo'q"}`);
      izoh.push("qator HTML: " + cut(x.qator.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>"), 2500));
    }
    return { r2: null, tanlandi, izoh };
  }
  async function asligaQaytar(r2) {
    if (r2 && r2.ong.qaytar) { sichqon(r2.ong.qaytar); await sleep(120); await barqaror(200, 2500); }
  }

  // Bitta eMaktab o'quvchisini ERP ro'yxatidan tanlab tekshirish/tasdiqlash.
  //  ⚠️ QOIDA (maktab talabi, 08.10.2026): «tug'ilgan sanasi bir xil va ismi
  //  kamida 80% o'xshash bo'lsa avtomatik biriktirilsin». Nomzodlar
  //  o'xshashlik bo'yicha tartiblanadi, eng o'xshashidan boshlab 3 tagacha
  //  tanlab ko'riladi: sana (va jins) mos kelgani tasdiqlanadi, qolganlari
  //  «Asliga qaytarish» bilan qaytariladi.
  //  Qaytadi: "tasdiq" | "sinov" | "sana" | "yoq" | "kop" | "xato:…"
  async function bolaniBirik(r, erpNomlar, E, opt) {
    const c = r.chap;
    const nz = nomzodlar(c.fio, erpNomlar, opt.chegara);
    if (!nz.ro.length) return { kod: "yoq" };
    if (nz.daraja === "to'liq" && nz.ro.length > 1) {
      return { kod: "kop", izoh: `ERP «${E.nom}» da ${nz.ro.length} ta bir xil darajada o'xshash ism (egizak?): ${nz.ro.slice(0, 4).map((x) => x.nom).join("; ")} — qo'lda biriktiring` };
    }
    const kalit = qatorKaliti(c);
    if (!r.ong.sel) return { kod: "xato: o'ng kartada ro'yxat (select) yo'q" };
    const sinalgan = [];
    let oxirgi = null;
    for (const nomzod of nz.ro.slice(0, 3)) {
      toxta();
      const erpNom = nomzod.nom;
      const t = await tanlabKut(kalit, erpNom);
      if (!t.r2) {
        if (!t.tanlandi) return { kod: "xato: ro'yxatdan «" + erpNom + "» tanlanmadi" };
        return { kod: "xato: tanlangach o'ng kartada talaba/«tasdiqlash» chiqmadi", izoh: t.izoh };
      }
      const r2 = t.r2;
      const erpSana = r2.ong.sana;
      const sanaMos = !!(c.sana && erpSana && sanaNorm(c.sana) === sanaNorm(erpSana));
      const jinsMos = !(c.jins && r2.ong.jins && c.jins !== r2.ong.jins);
      const moslik = nz.daraja === "to'liq" ? "to'liq" : `o'xshash ${Math.round(nomzod.ball * 100)}%`;
      const yoz = { emkFio: c.fio, emkSinf: c.sinf, emkSana: c.sana, emkJins: c.jins, emkLogin: c.login, emkPinfl: c.pinfl,
        erpFio: erpNom, erpSinf: r2.ong.sinf || E.nom, erpSana, erpPinfl: r2.ong.pinfl, erpJins: r2.ong.jins, moslik, vaqt: bugun() };
      // To'liq ism mos + «sana shart emas» rejimi — sanasiz ham qabul
      const qabul = jinsMos && (sanaMos || (nz.daraja === "to'liq" && !opt.sanaShart));
      if (qabul) {
        const sabab = sanaMos ? "" : "sana shart emas rejimi — faqat to'liq ism bo'yicha";
        if (opt.sinov) { await asligaQaytar(r2); return { kod: "sinov", yoz: { ...yoz, sabab } }; }
        const oldinSoni = boglanmaganSoni();
        sichqon(r2.ong.tasdiq);
        await sleep(150);
        const ketdi = await waitFor(() => { const x = qatorTop(kalit); return !x || x.ong.holat === "biriktirilgan" || (oldinSoni > 0 && boglanmaganSoni() === oldinSoni - 1); }, 10000, 150);
        await barqaror(250, 3000);
        const xabar = xabarMatni();
        if (!ketdi) return { kod: "xato: «tasdiqlash» bosildi, lekin qator o'zgarmadi" + (xabar ? " — " + cut(xabar, 200) : ""), yoz };
        return { kod: "tasdiq", yoz: { ...yoz, sabab, xabar } };
      }
      sinalgan.push(`${erpNom} [${moslik}] — ERP sana ${erpSana || "?"}${jinsMos ? "" : ", jinsi " + (r2.ong.jins || "?")}`);
      oxirgi = yoz;
      await asligaQaytar(r2);
    }
    return { kod: "sana", yoz: { ...oxirgi, sabab: `ismi o'xshash, lekin tug'ilgan sana/jins mos emas: eMaktab ${c.sana || "?"} ${c.jins || ""} ↔ ${sinalgan.join("; ")}` } };
  }

  // Asosiy yurish
  //  ⚠️ 0.4.0 — TEZLASHTIRILGAN TARTIB (0.3.1 juda sekin edi: har eMaktab sinfi
  //  uchun shu raqamdagi HAMMA ERP sinfi — 8–14 ta — birma-bir tanlanib,
  //  har safar sahifa qayta yuklanardi; 117 sinf × ~10 = ~1200 almashtirish).
  //  Endi:
  //   1) eMaktab sinfining bog'lanmagan qatorlari sahifama-sahifa BIR MARTA
  //      o'qiladi (ular ERP sinfiga bog'liq emas);
  //   2) shu raqamdagi ERP sinflarining talabalar ro'yxati har raqam uchun
  //      BIR MARTA o'qiladi (keshda qoladi, keyingi sinflar qayta o'qimaydi);
  //   3) har qator uchun nomzodlar XOTIRADA hisoblanadi — qaysi ERP sinfida
  //      ≥ chegara o'xshash ism bor;
  //   4) ERP sinfi faqat unda nomzodi bor qatorlar uchun tanlanadi; o'sha
  //      sahifada kerakli qatorlar topilib tasdiqlanadi.
  async function yur(opt) {
    HOLAT.toxtat = false; HOLAT.ishlayapti = true;
    N.boglanmagan = []; N.shubhali = []; N.sinfJurnali = []; N.erpBiriktirilgan = []; TASHXIS_SONI = 0;
    if (!opt.keshSaqla) N.erpTalabalar = {};
    N.biriktirildi = N.biriktirildi.filter((b) => !b.sinov);
    const filiallar = filialXarita(opt.filialMatni);
    const { emk, erp } = await sinflarniOqi(filiallar);
    log(`✔ Sinflar: eMaktabda ${emk.length}, ERPda ${erp.length}`, "ok");
    const darajalar = new Set(String(opt.darajalar || "").split(/[,\s]+/).map(Number).filter(Boolean));
    let emkRo = emk.filter((c) => !darajalar.size || darajalar.has(c.daraja));
    emkRo.sort((a, b) => a.daraja - b.daraja || a.filial.localeCompare(b.filial) || a.harf.localeCompare(b.harf));
    if (opt.sinov) emkRo = emkRo.slice(0, opt.sinovSinf || 2);
    log(`▶ ${emkRo.length} eMaktab sinfi ${opt.sinov ? "SINOV (faqat dastlabki " + emkRo.length + " sinf, hech narsa tasdiqlanmaydi)" : "haqiqiy yurish"}`, "ok");
    const erpQisqa = (E) => E.nom.split("(")[0].trim() + (E.filial ? "[" + E.filial.toUpperCase() + "]" : "");
    const t0 = Date.now();
    let jamiTasdiq = 0;

    for (const C of emkRo) {
      toxta();
      const erpNomz = erp.filter((e) => e.daraja === C.daraja);
      const birinchi = erpNomz.filter((e) => e.filial === C.filial);
      const qolgan = erpNomz.filter((e) => e.filial !== C.filial);
      const tartib = opt.boshqaFilial ? [...birinchi, ...qolgan] : birinchi;
      if (!tartib.length) {
        log(`• ${C.nom}: ERPda ${C.daraja}-sinf (${C.filial ? "filial " + C.filial.toUpperCase() : "bosh filial"}) yo'q — o'tkazib yuborildi`, "ogoh");
        N.sinfJurnali.push({ emk: C.nom, erp: "", izoh: "ERPda shu raqamli sinf yo'q" });
        continue;
      }
      holatYoz(`${C.nom}: bog'lanmaganlar o'qilmoqda…`);
      await yorliqniTanla(/^Biriktirilmagan$/i);
      if (!(await variantTanla(emkSinfVidjet(), C.nom))) { log(`✖ ${C.nom}: eMaktab sinf ro'yxatidan tanlanmadi`, "xato"); continue; }
      await barqaror(250, 8000);
      await birinchiSahifa();

      // 1) Bog'lanmagan qatorlar — sahifama-sahifa, bir marta
      const qatorlarC = new Map();   // kalit → chap
      for (let tur = 0; tur < 300; tur++) {
        toxta();
        await royxatniToldir();
        qatorlarniOqi().filter((r) => r.ong.holat !== "biriktirilgan").forEach((r) => { const k = qatorKaliti(r.chap); if (!N.bajarilgan[k]) qatorlarC.set(k, r.chap); });
        if (!(await keyingiSahifa())) break;
      }
      const kutilgan = boglanmaganSoni();
      if (!qatorlarC.size) { log(`＝ ${C.nom}: bog'lanmagan o'quvchi yo'q`, "dim"); N.sinfJurnali.push({ emk: C.nom, erp: "", izoh: "bog'lanmagan yo'q" }); continue; }
      log(`🏫 ${C.nom}: bog'lanmagan ${kutilgan >= 0 ? kutilgan : "?"} (o'qildi ${qatorlarC.size})`, "dim");

      // 2) ERP ro'yxatlari — shu raqam uchun bir marta (keshda bo'lsa o'qilmaydi)
      for (const E of tartib) {
        if (N.erpTalabalar[E.nom] && N.erpTalabalar[E.nom].length) continue;
        toxta();
        holatYoz(`ERP «${erpQisqa(E)}» ro'yxati o'qilmoqda…`);
        if (!(await variantTanla(erpSinfVidjet(), E.nom))) { log(`✖ ERP «${E.nom}» ro'yxatdan tanlanmadi`, "xato"); continue; }
        await barqaror(250, 8000);
        const birRo = await waitFor(() => qatorlarniOqi().find((r) => r.ong.sel), 4000, 150);
        const nomlar = birRo ? (await variantlarniOqi(birRo.ong.sel)) || [] : [];
        N.erpTalabalar[E.nom] = nomlar.filter((nm) => !/kiriting/i.test(nm));
        log(`   ERP «${erpQisqa(E)}»: ${N.erpTalabalar[E.nom].length} talaba${N.erpTalabalar[E.nom].length ? "" : " (ro'yxat o'qilmadi)"}`, N.erpTalabalar[E.nom].length ? "dim" : "ogoh");
      }
      natijaSaqla();

      // 3) Har qator uchun nomzodlar — qaysi ERP sinfida (xotirada, tez)
      const reja = new Map();        // E.nom → [kalit]
      qatorlarC.forEach((chap, kalit) => {
        tartib.forEach((E) => {
          const ro = N.erpTalabalar[E.nom] || [];
          if (ro.length && nomzodlar(chap.fio, ro, opt.chegara).ro.length) { if (!reja.has(E.nom)) reja.set(E.nom, []); reja.get(E.nom).push(kalit); }
        });
      });
      const nomzodli = new Set([...reja.values()].flat());
      log(`   nomzodi bor: ${nomzodli.size}/${qatorlarC.size} qator, ERP sinflari: ${[...reja.keys()].map((n) => n.split("(")[0].trim()).join(", ") || "yo'q"}`, "dim");

      // 4) Kerakli ERP sinflari bo'yicha bajarish
      const topildi = new Set();
      const qoldi = new Map(qatorlarC);
      for (const E of tartib) {
        const kalitlar = (reja.get(E.nom) || []).filter((k) => !topildi.has(k));
        if (!kalitlar.length) continue;
        toxta();
        holatYoz(`${C.nom} ← ERP ${erpQisqa(E)}: ${kalitlar.length} nomzod…`);
        if (!(await variantTanla(erpSinfVidjet(), E.nom))) { log(`✖ ${C.nom}: ERP «${E.nom}» ro'yxatdan tanlanmadi`, "xato"); continue; }
        await barqaror(250, 8000);
        await birinchiSahifa();
        const ro = N.erpTalabalar[E.nom] || [];
        const kerak = new Set(kalitlar);
        for (let tur = 0; tur < 300 && kerak.size; tur++) {
          toxta();
          await royxatniToldir();
          let tasdiqlandi = 0;
          for (const r0 of qatorlarniOqi()) {
            const kalit = qatorKaliti(r0.chap);
            if (!kerak.has(kalit) || topildi.has(kalit)) continue;
            toxta();
            const r = qatorTop(kalit); if (!r) continue;
            let res;
            try { res = await bolaniBirik(r, ro, E, opt); }
            catch (err) { if (err.message === TOXTATILDI) throw err; res = { kod: "xato: " + err.message }; }
            kerak.delete(kalit);
            const belgi = `${r.chap.fio} (${r.chap.sana || "sana yo'q"})`;
            if (res.kod === "yoq") continue;
            if (res.kod === "kop") { N.shubhali.push({ emkFio: r.chap.fio, emkSinf: r.chap.sinf, emkSana: r.chap.sana, emkLogin: r.chap.login, erpSinf: E.nom, sabab: res.izoh }); topildi.add(kalit); qoldi.delete(kalit); log(`⚠ ${belgi} — ${res.izoh}`, "ogoh"); continue; }
            if (res.kod === "sana") { N.shubhali.push({ ...res.yoz }); topildi.add(kalit); qoldi.delete(kalit); log(`⚠ ${belgi} ↔ ${res.yoz.erpFio} — ${res.yoz.sabab}`, "ogoh"); continue; }
            if (res.kod === "sinov") { N.biriktirildi.push({ ...res.yoz, sinov: true }); topildi.add(kalit); qoldi.delete(kalit); log(`✔ (sinov) ${belgi} ↔ ${res.yoz.erpFio} [${res.yoz.erpSinf}] ${res.yoz.erpSana}${res.yoz.moslik === "to'liq" ? "" : " (" + res.yoz.moslik + ")"}`, "ok"); continue; }
            if (res.kod === "tasdiq") { N.biriktirildi.push(res.yoz); N.bajarilgan[kalit] = 1; topildi.add(kalit); qoldi.delete(kalit); tasdiqlandi++; jamiTasdiq++; log(`＋ ${belgi} ↔ ${res.yoz.erpFio} [${res.yoz.erpSinf}] ✔${res.yoz.moslik === "to'liq" ? "" : " (" + res.yoz.moslik + ")"}${res.yoz.xabar ? " · " + cut(res.yoz.xabar, 120) : ""}`, "ok"); natijaSaqla(); continue; }
            log(`✖ ${belgi} — ${res.kod}`, "xato");
            if (res.izoh && res.izoh.length) log("   " + res.izoh.join("\n   "), "dim");
            N.shubhali.push({ emkFio: r.chap.fio, emkSinf: r.chap.sinf, emkSana: r.chap.sana, emkLogin: r.chap.login, erpSinf: E.nom, erpFio: res.yoz ? res.yoz.erpFio : "", sabab: res.kod });
            topildi.add(kalit); qoldi.delete(kalit);
          }
          if (!kerak.size) break;
          if (tasdiqlandi) continue;              // qatorlar chiqib ketdi — shu sahifa qayta o'qiladi
          if (!(await keyingiSahifa())) break;    // oxirgi sahifa
        }
      }

      // 5) Hech qaysi ERP sinfida topilmaganlar — o'xshash ERP ismlari bilan
      const korilganErp = tartib.map((E) => `${erpQisqa(E)} (${(N.erpTalabalar[E.nom] || []).length})`);
      qoldi.forEach((c) => {
        if (N.boglanmagan.some((b) => qatorKaliti(b) === qatorKaliti(c))) return;
        const k = ismKalit(c.fio);
        const oxshash = [];
        tartib.forEach((E) => (N.erpTalabalar[E.nom] || []).forEach((nm) => {
          const e = ismKalit(nm);
          if ((k.sozlar[0] && e.sozlar[0] === k.sozlar[0]) || (k.sozlar[1] && e.sozlar[1] === k.sozlar[1] && k.sozlar[0] && e.sozlar[0] && e.sozlar[0].slice(0, 4) === k.sozlar[0].slice(0, 4))) oxshash.push(`${nm} [${erpQisqa(E)}]`);
        }));
        N.boglanmagan.push({ id: c.id, fio: c.fio, sinf: c.sinf, sana: c.sana, jins: c.jins, login: c.login, pinfl: c.pinfl,
          sabab: `ERP ${C.daraja}-sinflarida (${korilganErp.join(", ")}) ismi ${opt.chegara * 100}% dan kam o'xshash / yo'q`, oxshash: oxshash.slice(0, 6).join("; ") });
      });
      N.sinfJurnali.push({ emk: C.nom, erp: korilganErp.join(", "), izoh: `bog'lanmagan ${qatorlarC.size} → topilmadi ${qoldi.size}` });
      const daq = Math.round((Date.now() - t0) / 6000) / 10;
      log(`— ${C.nom}: ${qatorlarC.size - qoldi.size} bajarildi/shubhali, topilmadi ${qoldi.size}${qoldi.size ? ": " + [...qoldi.values()].slice(0, 5).map((c) => c.fio).join("; ") + (qoldi.size > 5 ? " …" : "") : ""} — (${daq} daq, jami tasdiq ${jamiTasdiq}) —`, qoldi.size ? "ogoh" : "ok");
      natijaSaqla();
    }

    // Hisobot uchun: «Biriktirilgan» yorlig'idan ERP tomonidagi bog'langan ismlar (sekin — ixtiyoriy)
    if (opt.biriktirilganOqi) {
      log("📖 «Biriktirilgan» ro'yxati o'qilmoqda (ERP bog'lanmaganlar hisoboti uchun)…", "dim");
      for (const C of emkRo) {
        toxta();
        holatYoz(`${C.nom}: biriktirilganlar…`);
        await yorliqniTanla(/^Biriktirilgan$/i);
        if (!(await variantTanla(emkSinfVidjet(), C.nom))) continue;
        await barqaror(250, 8000);
        await birinchiSahifa();
        for (let tur = 0; tur < 300; tur++) {
          toxta();
          await royxatniToldir();
          qatorlarniOqi().forEach((r) => {
            const erpFio = r.ong.erpFio || "";
            if (!erpFio) return;
            if (!N.erpBiriktirilgan.some((x) => x.erpFio === erpFio && x.emkFio === r.chap.fio)) N.erpBiriktirilgan.push({ emkFio: r.chap.fio, emkSinf: r.chap.sinf, erpFio, erpSinf: r.ong.sinf });
          });
          if (!(await keyingiSahifa())) break;
        }
      }
    }
    natijaSaqla();
    HOLAT.ishlayapti = false;
  }

  // ===================================================================
  //  6-QISM. EXCEL (.xlsx) — TASHQI KUTUBXONASIZ
  //  (emaktab-oquvchilar.user.js dagi bilan bir xil: ZIP stored + OOXML)
  // ===================================================================
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
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

  // Excel hisobot: Xulosa · Biriktirildi · eMaktab bog'lanmagan · ERP bog'lanmagan · Shubhali · Sinflar
  function excelHisobot() {
    // ERP bog'lanmagan = ko'rilgan ERP talabalari − shu yurishda biriktirilganlar − «Biriktirilgan» yorlig'idagilar
    const bogli = new Set();
    N.biriktirildi.filter((b) => !b.sinov).forEach((b) => bogli.add(normKey(b.erpFio)));
    N.erpBiriktirilgan.forEach((b) => bogli.add(normKey(b.erpFio)));
    const erpBog = [];
    Object.entries(N.erpTalabalar).forEach(([sinf, ro]) => ro.forEach((nm) => { if (!bogli.has(normKey(nm))) erpBog.push([nm, sinf]); }));
    const haqiqiy = N.biriktirildi.filter((b) => !b.sinov).length, sinov = N.biriktirildi.length - haqiqiy;
    const erpJami = Object.values(N.erpTalabalar).reduce((a, r) => a + r.length, 0);
    const varaqlar = [
      { nom: "Xulosa", filtr: false, kenglik: [50, 12, 90], sarlavha: ["Ko'rsatkich", "Soni", "Izoh"], qatorlar: [
        ["eMaktab sinflari (ro'yxatda)", N.emkSinflar.length, N.emkSinflar.map((c) => c.nom).join(", ")],
        ["ERP sinflari (ro'yxatda)", N.erpSinflar.length, ""],
        ["ERP talabalari ko'rildi (bog'lanmagan qatorlar orqali)", erpJami, "faqat skript ochgan ERP sinflari; «ERP bog'lanmagan» varag'i shulardan"],
        ["Biriktirildi (shu skript bilan, tasdiqlangan)", haqiqiy, "«Biriktirildi» varag'i"],
        ["SINOVda topildi (tasdiqlanmagan)", sinov, "SINOV rejimida «Asliga qaytarish» bosilgan"],
        ["eMaktab bog'lanmagan (ERPda topilmadi)", N.boglanmagan.length, "«eMaktab bog'lanmagan» varag'i — sabab bilan"],
        ["Shubhali (sana/jins farq, bir nechta nomzod, xato)", N.shubhali.length, "«Shubhali» varag'i — qo'lda hal qilinadi"],
        ["ERP bog'lanmagan (ko'rilganlardan)", erpBog.length, "«ERP bog'lanmagan» varag'i"],
        ["Avvaldan biriktirilgan (yorliqdan o'qildi)", N.erpBiriktirilgan.length, "«Biriktirilgan» yorlig'i o'qilgan bo'lsa"],
        ["Hisobot vaqti", new Date().toISOString().slice(0, 16).replace("T", " "), `skript v${VERSIYA}`],
      ] },
      { nom: "Biriktirildi", kenglik: [40, 12, 14, 10, 24, 40, 28, 14, 18, 14, 12, 40], sarlavha: ["eMaktab F.I.O", "eMaktab sinf", "Tug'ilgan", "Jins", "Login", "ERP F.I.O", "ERP sinf", "ERP tug'ilgan", "ERP JSHSHIR", "Moslik", "Sana", "Izoh"],
        qatorlar: N.biriktirildi.map((b) => [b.emkFio, b.emkSinf, b.emkSana, b.emkJins, b.emkLogin, b.erpFio, b.erpSinf, b.erpSana, b.erpPinfl, b.moslik, b.vaqt, (b.sinov ? "SINOV — tasdiqlanmagan. " : "") + (b.sabab || "")]) },
      { nom: "eMaktab bog'lanmagan", kenglik: [40, 12, 14, 10, 24, 18, 70, 80], sarlavha: ["F.I.O", "Sinf", "Tug'ilgan", "Jins", "Login", "JSHSHIR", "Sabab", "ERPdagi o'xshash ismlar (qo'lda tekshiring)"],
        qatorlar: N.boglanmagan.map((b) => [b.fio, b.sinf, b.sana, b.jins, b.login, b.pinfl, b.sabab, b.oxshash || ""]) },
      { nom: "ERP bog'lanmagan", kenglik: [44, 40], sarlavha: ["ERP F.I.O", "ERP sinf"], qatorlar: erpBog },
      { nom: "Shubhali", kenglik: [40, 12, 14, 24, 40, 28, 14, 80], sarlavha: ["eMaktab F.I.O", "eMaktab sinf", "Tug'ilgan", "Login", "ERP F.I.O", "ERP sinf", "ERP tug'ilgan", "Sabab"],
        qatorlar: N.shubhali.map((s) => [s.emkFio, s.emkSinf, s.emkSana, s.emkLogin, s.erpFio || "", s.erpSinf || "", s.erpSana || "", s.sabab || ""]) },
      { nom: "Biriktirilgan (yorliq)", kenglik: [40, 12, 40, 28], sarlavha: ["eMaktab F.I.O", "eMaktab sinf", "ERP F.I.O", "ERP sinf"],
        qatorlar: N.erpBiriktirilgan.map((b) => [b.emkFio, b.emkSinf, b.erpFio, b.erpSinf]) },
      { nom: "Sinflar", kenglik: [16, 60, 40], sarlavha: ["eMaktab sinf", "Ko'rilgan ERP sinflari (talaba soni)", "Izoh"],
        qatorlar: N.sinfJurnali.map((s) => [s.emk, s.erp, s.izoh]) },
    ];
    return xlsxYasa(varaqlar);
  }
  function excelYukla() {
    const nom = `emaktab-erp-biriktirish_${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.xlsx`;
    yuklab(nom, excelHisobot());
    log(`📊 Excel «${nom}» yuklandi. Varaqlar: Xulosa · Biriktirildi · eMaktab bog'lanmagan · ERP bog'lanmagan · Shubhali · Biriktirilgan (yorliq) · Sinflar`, "ok");
  }

  // ===================================================================
  //  7-QISM. TASHXIS VA YOZUV (dasturchi uchun)
  //  Tashxis — sahifa tuzilishi: inputlar, tugmalar, kartalar, namuna HTML.
  //  Yozuv — sahifaning fetch/XHR so'rovlari (API manzillari, javoblar):
  //  bitta birikmani QO'LDA tasdiqlang — API topilsa keyingi versiya UI
  //  bosmasdan to'g'ridan-to'g'ri API bilan ishlaydi.
  // ===================================================================
  function tashxis() {
    const kart = chapKartalar();
    const q = kart[0] ? qatorKonteyner(kart[0]) : null;
    return JSON.stringify({
      sj_erp_birik_tashxis: 1, versiya: VERSIYA, sahifa: location.href, vaqt: new Date().toISOString(),
      boglanmaganSoni: boglanmaganSoni(),
      emkVidjet: !!emkSinfVidjet(), erpVidjet: !!erpSinfVidjet(),
      vidjetlar: selectVidjetlar().slice(0, 4).map((w) => ({ testId: w.getAttribute("data-test-id") || "", qiymat: vidjetQiymati(w), kartada: kartaIchida(w), html: cut((w.parentElement || w).outerHTML, 1500) })),
      inputlar: [...document.querySelectorAll("input")].filter((i) => !begonaYoki(i)).slice(0, 40).map((i) => ({ type: i.type, id: i.id, name: i.name, cls: cut(i.className, 150), placeholder: i.placeholder, ota: cut(i.parentElement && i.parentElement.className, 150) })),
      tugmalar: [...document.querySelectorAll("button, a, [role=button]")].filter((b) => visible(b) && !begonaYoki(b)).map(txt).filter(Boolean).slice(0, 80),
      kartalar: kart.length, namunaChap: kart[0] ? cut(kart[0].outerHTML, 4000) : "", namunaQator: q ? cut(q.outerHTML, 8000) : "",
      ochiqVariantlar: ochiqVariantlar().slice(0, 20).map(txt),
      natija: { biriktirildi: N.biriktirildi.length, boglanmagan: N.boglanmagan.length, shubhali: N.shubhali.length },
    }, null, 2);
  }
  const REC = { yoniq: lsOl(LS.recOn, "0") === "1", yozuv: (() => { try { return JSON.parse(lsOl(LS.rec, "[]")) || []; } catch { return []; } })() };
  function recSaqla() { if (REC.yozuv.length > 150) REC.yozuv = REC.yozuv.slice(-150); lsYoz(LS.rec, JSON.stringify(REC.yozuv)); }
  (function hookNetwork() {
    try {
      const XHR = W.XMLHttpRequest;
      const _open = XHR.prototype.open, _send = XHR.prototype.send;
      XHR.prototype.open = function (m, u) { this.__sj = { metod: m, url: String(u) }; return _open.apply(this, arguments); };
      XHR.prototype.send = function (body) {
        if (REC.yoniq && this.__sj) {
          const rec = { tur: "xhr", ...this.__sj, sorov: cut(typeof body === "string" ? body : "", 2000), vaqt: new Date().toISOString() };
          REC.yozuv.push(rec); recSaqla();
          this.addEventListener("load", () => { rec.holat = this.status; try { rec.javob = cut(this.responseText, 3000); } catch { /* */ } recSaqla(); });
        }
        return _send.apply(this, arguments);
      };
      const _fetch = W.fetch;
      W.fetch = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        let rec = null;
        if (REC.yoniq) {
          rec = { tur: "fetch", metod: (init && init.method) || "GET", url: String(url), sorov: cut((init && typeof init.body === "string") ? init.body : "", 2000), vaqt: new Date().toISOString() };
          REC.yozuv.push(rec); recSaqla();
        }
        return _fetch.apply(this, arguments).then((res) => {
          if (rec) { rec.holat = res.status; try { res.clone().text().then((t) => { rec.javob = cut(t, 3000); recSaqla(); }); } catch { /* */ } }
          return res;
        });
      };
    } catch { /* sahifa ruxsat bermadi */ }
  })();

  // ===================================================================
  //  8-QISM. PANEL
  // ===================================================================
  const CSS = `
    :host,*{box-sizing:border-box;}
    .wrap{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;}
    .fab{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:800;font-size:12px;box-shadow:0 8px 24px rgba(37,99,235,.45);}
    .panel{display:none;width:470px;max-height:88vh;overflow:auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.5);}
    .panel.ochiq{display:block;}
    h3{margin:0 0 2px;font-size:15px;color:#fff;}
    .sub{color:#94a3b8;font-size:11.5px;margin-bottom:10px;}
    .qadam{border:1px solid #1e293b;border-radius:11px;padding:10px;margin-bottom:9px;background:#111a2e;}
    .qadam b{color:#fde68a;font-size:12px;display:block;margin-bottom:6px;}
    button.b{border:none;border-radius:9px;padding:8px 11px;font-weight:700;font-size:12px;cursor:pointer;margin:2px 3px 2px 0;font-family:inherit;}
    button.b:disabled{opacity:.5;cursor:default;}
    .b-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
    .b-alt{background:#1e293b;color:#cbd5e1;border:1px solid #334155;}
    .b-warn{background:#7c2d12;color:#fed7aa;}
    textarea{width:100%;height:64px;background:#020617;border:1px solid #1e293b;border-radius:9px;color:#cbd5e1;padding:7px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
    input[type=text]{background:#020617;border:1px solid #1e293b;border-radius:6px;color:#cbd5e1;padding:3px 6px;width:90px;}
    .log{background:#020617;border:1px solid #1e293b;border-radius:9px;padding:7px;height:220px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;}
    .ok{color:#86efac;} .xato{color:#fca5a5;} .ogoh{color:#fde68a;} .dim{color:#64748b;}
    .qator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:5px 0;}
    .holat{font-size:11px;color:#94a3b8;}
    label{font-size:11.5px;color:#cbd5e1;display:inline-flex;align-items:center;gap:4px;}
    .x{position:absolute;right:10px;top:8px;background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;}
    .stat{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:6px 0;}
    .stat div{background:#020617;border:1px solid #1e293b;border-radius:8px;padding:6px;text-align:center;}
    .stat span{display:block;font-size:18px;font-weight:800;color:#fff;}
    .stat small{font-size:10.5px;color:#94a3b8;}
  `;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const sh = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);
  sh.innerHTML = `<style>${CSS}</style>
  <div class="wrap">
    <button class="fab" id="fab" title="eMaktab ↔ ERP: o'quvchilarni biriktirish">E↔ERP</button>
    <div class="panel" id="panel" style="position:relative;">
      <button class="x" id="yopish">✕</button>
      <h3>eMaktab ↔ ERP: o'quvchilarni biriktirish</h3>
      <div class="sub">Sinf raqami bir xil ERP sinflaridan ism + tug'ilgan sana bo'yicha topib tasdiqlaydi. v${VERSIYA}</div>

      <div class="qadam">
        <b>1. Filial harflari (eMaktab sinf oxiridagi harf = ERP sinf nomidagi so'z)</b>
        <textarea id="filial"></textarea>
        <div class="qator">
          <label><input type="checkbox" id="boshqaFilial" checked> shu filialda topilmasa boshqa filiallarning shu raqamli sinflaridan ham izlash</label>
        </div>
      </div>

      <div class="qadam">
        <b>2. Sozlamalar</b>
        <div class="qator">
          <label><input type="checkbox" id="sinov" checked> SINOV — topadi, tanlaydi, lekin TASDIQLAMAYDI</label>
        </div>
        <div class="qator">
          <label><input type="checkbox" id="sanaShart" checked> tug'ilgan sana mos bo'lishi SHART</label>
          <label><input type="checkbox" id="birikOqi"> oxirida «Biriktirilgan» yorlig'ini o'qish (sekin, faqat ERP hisoboti uchun)</label>
          <label><input type="checkbox" id="keshSaqla" checked> ERP ro'yxatlari keshini saqlash (qayta yurish tez)</label>
        </div>
        <div class="qator">
          <label>faqat sinflar: <input type="text" id="darajalar" placeholder="masalan 1,2,3"></label>
          <span class="holat">bo'sh — hamma sinf</span>
        </div>
        <div class="qator">
          <label>ism o'xshashligi kamida <input type="text" id="chegara" value="80" style="width:48px"> %</label>
          <span class="holat">sana bir xil + ism shunchalik o'xshash → avtomatik</span>
        </div>
      </div>

      <div class="qadam">
        <b>3. Yurish</b>
        <div class="qator">
          <button class="b b-main" id="yur">🚀 Boshlash</button>
          <button class="b b-warn" id="toxta" style="display:none">■ To'xtatish</button>
          <button class="b b-alt" id="excel">📊 Excel</button>
          <button class="b b-warn" id="toza" title="Saqlangan natijani tozalash">🗑</button>
        </div>
        <div class="holat" id="holat">«Maktab shaxslarini ERP.MAKTAB.UZ bilan biriktirish» sahifasida, «O'quvchilar» yorlig'i ochiq bo'lsin. Ish paytida sahifaga tegmang.</div>
        <div class="stat">
          <div><span id="nBir">0</span><small>biriktirildi</small></div>
          <div><span id="nBog">0</span><small>topilmadi</small></div>
          <div><span id="nShub">0</span><small>shubhali</small></div>
          <div><span id="nErp">0</span><small>ERP ko'rildi</small></div>
        </div>
      </div>

      <div class="qadam">
        <b>🔍 Dasturchi uchun</b>
        <div class="qator">
          <button class="b b-alt" id="tashxis">🧾 Tashxis</button>
          <button class="b b-alt" id="recOn">⏺ Yozuvni boshlash</button>
          <button class="b b-alt" id="recOff">⏹ Yozuvni saqlash</button>
        </div>
        <div class="holat">Skript noto'g'ri ishlasa: «⏺» → bitta bolani QO'LDA biriktiring → «⏹» → faylni va «🧾 Tashxis» ni dasturchiga bering.</div>
      </div>

      <div class="log" id="log"></div>
    </div>
  </div>`;
  const $ = (id) => sh.getElementById(id);
  const panel = $("panel");
  log = (msg, cls) => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = msg;
    $("log").appendChild(d);
    $("log").scrollTop = $("log").scrollHeight;
  };
  holatYoz = (m) => { $("holat").textContent = m; };
  function statKo() {
    $("nBir").textContent = N.biriktirildi.length;
    $("nBog").textContent = N.boglanmagan.length;
    $("nShub").textContent = N.shubhali.length;
    $("nErp").textContent = Object.values(N.erpTalabalar).reduce((a, r) => a + r.length, 0);
  }
  $("fab").onclick = () => lsYoz(LS.ochiq, panel.classList.toggle("ochiq") ? "1" : "0");
  $("yopish").onclick = () => { panel.classList.remove("ochiq"); lsYoz(LS.ochiq, "0"); };
  if (lsOl(LS.ochiq, "0") === "1") panel.classList.add("ochiq");

  // Sozlamalar saqlanadi
  $("filial").value = lsOl(LS.filial, FILIAL_DEF);
  try {
    const s = JSON.parse(lsOl(LS.sozlama, "{}")) || {};
    if (s.boshqaFilial != null) $("boshqaFilial").checked = !!s.boshqaFilial;
    if (s.sanaShart != null) $("sanaShart").checked = !!s.sanaShart;
    if (s.birikOqi != null) $("birikOqi").checked = !!s.birikOqi;
    if (s.darajalar != null) $("darajalar").value = s.darajalar;
    if (s.chegara != null) $("chegara").value = s.chegara;
    if (s.keshSaqla != null) $("keshSaqla").checked = !!s.keshSaqla;
  } catch { /* */ }
  const sozlamaSaqla = () => {
    lsYoz(LS.filial, $("filial").value);
    lsYoz(LS.sozlama, JSON.stringify({ boshqaFilial: $("boshqaFilial").checked, sanaShart: $("sanaShart").checked, birikOqi: $("birikOqi").checked, darajalar: $("darajalar").value, chegara: $("chegara").value, keshSaqla: $("keshSaqla").checked }));
  };
  ["filial", "boshqaFilial", "sanaShart", "birikOqi", "darajalar", "chegara", "keshSaqla"].forEach((id) => { $(id).onchange = sozlamaSaqla; });

  $("yur").onclick = async () => {
    if (HOLAT.ishlayapti) return;
    sozlamaSaqla();
    const opt = { sinov: $("sinov").checked, sanaShart: $("sanaShart").checked, boshqaFilial: $("boshqaFilial").checked,
      biriktirilganOqi: $("birikOqi").checked, keshSaqla: $("keshSaqla").checked, darajalar: $("darajalar").value, filialMatni: $("filial").value, sinovSinf: 2,
      chegara: Math.min(1, Math.max(0.5, (Number(String($("chegara").value).replace(",", ".")) || 80) / 100)) };
    if (!opt.sinov && !window.confirm("HAQIQIY yurish: topilgan va tug'ilgan sanasi mos o'quvchilar uchun «Birikmani tasdiqlash» bosiladi.\nDavom etilsinmi?")) { log("■ Bekor qilindi", "ogoh"); return; }
    $("yur").disabled = true; $("toxta").style.display = "";
    log(`▶ ${opt.sinov ? "SINOV" : "HAQIQIY"} yurish boshlandi (v${VERSIYA})${opt.sanaShart ? "" : " — sana shart emas (faqat to'liq ism mos bo'lsa)"}`, "ok");
    try {
      await yur(opt);
      log("— Yakun —", "ok");
      if (!opt.sinov) excelYukla();
      else log("SINOV tugadi. Jurnalni tekshiring; to'g'ri bo'lsa SINOV belgisini olib «🚀» ni bosing. Excel — «📊».", "ogoh");
    } catch (err) {
      log((err.message === TOXTATILDI ? "" : "✖ ") + err.message, err.message === TOXTATILDI ? "ogoh" : "xato");
      if (err.message !== TOXTATILDI) log("   Sahifa tuzilishi kutilgandan boshqacha bo'lishi mumkin — «🧾 Tashxis» faylini dasturchiga bering.", "dim");
    } finally {
      HOLAT.ishlayapti = false;
      natijaSaqla(); statKo();
      $("yur").disabled = false; $("toxta").style.display = "none";
      $("holat").textContent = "Tayyor.";
    }
  };
  $("toxta").onclick = () => { HOLAT.toxtat = true; log("■ To'xtatish so'raldi — hozirgi qadam tugagach to'xtaydi…", "ogoh"); };
  $("excel").onclick = () => { try { excelYukla(); } catch (err) { log("✖ Excel yasalmadi: " + err.message, "xato"); } };
  $("toza").onclick = () => { if (!window.confirm("Saqlangan natija (biriktirildi / topilmadi / shubhali ro'yxatlari) tozalansinmi?")) return; natijaTozala(); statKo(); log("🗑 Natija tozalandi", "dim"); };
  $("tashxis").onclick = async () => {
    let menyu = "";
    try {
      const w = emkSinfVidjet();
      if (w) { const m = await menyuOch(w); if (m) { menyu = cut(m.konteyner.outerHTML, 6000); await menyuYop(w); } else menyu = "(menyu ochilmadi)"; }
    } catch (err) { menyu = "xato: " + err.message; }
    const j = JSON.parse(tashxis()); j.sinfMenyusiHtml = menyu;
    yuklab("erp-birik-tashxis.json", JSON.stringify(j, null, 2), "application/json");
    log("🧾 erp-birik-tashxis.json saqlandi — dasturchiga bering.", "ok");
  };
  $("recOn").onclick = () => {
    REC.yoniq = true; REC.yozuv = [{ tur: "sahifa", url: location.href, vaqt: new Date().toISOString() }];
    lsYoz(LS.recOn, "1"); recSaqla();
    log("⏺ Yozuv yoqildi — endi bitta bolani QO'LDA biriktiring (sinf tanlang, talaba tanlang, tasdiqlang).", "ok");
  };
  $("recOff").onclick = () => {
    REC.yoniq = false; lsYoz(LS.recOn, "0");
    yuklab("erp-birik-yozuv.json", JSON.stringify({ sj_erp_birik_yozuv: 1, versiya: VERSIYA, sahifa: location.href, vaqt: new Date().toISOString(), yozuv: REC.yozuv }, null, 2), "application/json");
    log(`⏹ Yozuv to'xtadi: ${REC.yozuv.length} yozuv — «erp-birik-yozuv.json» saqlandi.`, "ok");
  };

  W.__SJ_ERP_BIRIK__ = { natija: N, qatorlarniOqi, chapKartalar, variantlarniOqi, variantTanla, selectVidjetlar, emkSinfVidjet, erpSinfVidjet, menyuOch, ismKalit, excelHisobot, yur };

  statKo();
  if (N.biriktirildi.length || N.boglanmagan.length || N.shubhali.length) {
    log(`♻ Oldingi natija tiklandi: ${N.biriktirildi.length} biriktirildi, ${N.boglanmagan.length} topilmadi, ${N.shubhali.length} shubhali. Excel — «📊»; yangidan boshlash uchun «🗑».`, "dim");
  }
  if (REC.yoniq) { panel.classList.add("ochiq"); log(`⏺ Yozuv DAVOM etyapti (${REC.yozuv.length}). Tugatgach «⏹» ni bosing.`, "ogoh"); }
  const kart = chapKartalar().length;
  log(`Tayyor (v${VERSIYA}). ${kart ? `Sahifada ${kart} qator ko'rinib turibdi. ` : ""}Avval SINOV bilan «🚀» ni bosing.`, "dim");
})();
