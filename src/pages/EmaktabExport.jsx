// =====================================================================
//  eMAKTAB (kundalik.com) GA KO'CHIRISH
//
//  Smartjadval'da tuzilgan jadvalni eMaktab «Darslar jadvali sxemasi»
//  setkasiga o'tkazish sahifasi.
//
//  NEGA BIR BOSISHDA EMAS: eMaktab boshqa domen va sessiyasi cookie
//  bilan qulflangan — smartjadval.uz dan to'g'ridan-to'g'ri so'rov
//  yuborib bo'lmaydi (CORS). Shuning uchun bu yerda faqat JSON va
//  ko'prik skripti tayyorlanadi, ko'chirishni esa foydalanuvchi
//  eMaktab sahifasining o'zida ishga tushiradi.
//
//  IKKI USUL (foydalanuvchi tanlaydi, tanlov brauzerda eslab qolinadi):
//    • Tampermonkey — ko'prik bir marta o'rnatiladi, eMaktab'da doim
//      «SJ» tugmasi turadi, yangilanish avtomatik (@updateURL).
//      Jadval JSON fayl sifatida yuklab olinib, panelda «📂 Fayldan»
//      bilan ochiladi.
//    • Console — hech narsa o'rnatilmaydi, «⚡ Hammasi birga» matni
//      har safar F12 → Console ga qo'yiladi.
//
//  Ko'prik skripti: public/emaktab-bridge.user.js
// =====================================================================
import { useMemo, useState, useEffect, useRef } from "react";
import { buildEmaktabPayload, payloadStats, payloadFileName, idCoverage } from "../utils/emaktabExport";
import { mergeEmaktabData, importSummary } from "../utils/emaktabImport";
import { DAYS } from "../utils/constants";

const CHORAKLAR = ["1 chorak", "2 chorak", "3 chorak", "4 chorak"];

// Tanlangan usul brauzerda qoladi — har kirganda qayta tanlanmasin
const LS_USUL = "sj_emk_usul";
const USULLAR = ["tampermonkey", "console"];

// Tampermonkey kengaytmasining rasmiy do'kon sahifalari
const TM_DOKONLAR = [
  { nom: "Chrome", belgi: "🟡", url: "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo" },
  { nom: "Edge", belgi: "🔵", url: "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd" },
  { nom: "Firefox", belgi: "🟠", url: "https://addons.mozilla.org/firefox/addon/tampermonkey/" },
  { nom: "Yandex / Opera", belgi: "🔴", url: "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo" },
];

function usulniOqi() {
  try {
    const v = localStorage.getItem(LS_USUL);
    return USULLAR.includes(v) ? v : "tampermonkey";
  } catch {
    return "tampermonkey";
  }
}

export default function EmaktabExport({
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  schedule = {},
  settings = {},
  setClasses,
  setSubjects,
  setTeachers,
  setRooms,
  toast,
}) {
  const [tanlangan, setTanlangan] = useState(() => new Set());
  const [chorak, setChorak] = useState(CHORAKLAR[0]);
  const [raqamlash, setRaqamlash] = useState("smena");
  const [xonaBilan, setXonaBilan] = useState(false);
  const [skript, setSkript] = useState("");       // ko'prik skripti matni
  const [skriptXato, setSkriptXato] = useState("");
  const [importHisobot, setImportHisobot] = useState(null);
  const [usul, setUsul] = useState(usulniOqi);     // "tampermonkey" | "console"
  const [muammoOchiq, setMuammoOchiq] = useState(false);
  const importRef = useRef(null);

  const tm = usul === "tampermonkey";

  function usulTanla(v) {
    setUsul(v);
    try { localStorage.setItem(LS_USUL, v); } catch { /* e'tiborsiz */ }
  }

  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => String(a.name).localeCompare(String(b.name), "uz", { numeric: true })),
    [classes]
  );

  // Har bir sinfda nechta dars bor — ro'yxatda darrov ko'rinsin
  const darsSoni = useMemo(() => {
    const map = new Map();
    const idsOf = (l) => (Array.isArray(l.classIds) ? l.classIds : [l.classId].filter(Boolean));
    DAYS.forEach((day) => {
      Object.values(schedule?.[day] || {}).forEach((arr) => {
        (arr || []).forEach((l) => idsOf(l).forEach((id) => map.set(id, (map.get(id) || 0) + 1)));
      });
    });
    return map;
  }, [schedule]);

  // Boshlanishida — darsi bor sinflar belgilanadi
  useEffect(() => {
    setTanlangan(new Set(sortedClasses.filter((c) => darsSoni.get(c.id)).map((c) => c.id)));
  }, [sortedClasses, darsSoni]);

  const paket = useMemo(() => buildEmaktabPayload({
    classes, subjects, teachers, rooms, timeslots, schedule, settings,
    classIds: [...tanlangan],
    numbering: raqamlash,
    includeRooms: xonaBilan,
    quarter: chorak,
  }), [classes, subjects, teachers, rooms, timeslots, schedule, settings, tanlangan, raqamlash, xonaBilan, chorak]);

  const stat = useMemo(() => payloadStats(paket), [paket]);
  const qamrov = useMemo(() => idCoverage(paket), [paket]);
  const json = useMemo(() => JSON.stringify(paket), [paket]);

  // ——— eMaktab ma'lumotini import qilish ———
  // Fayl ko'prikning «📥 Yig'ish» tugmasidan keladi. Birlashtirish
  // HECH NARSANI o'chirmaydi (emaktabImport.js ga qarang).
  function importQil(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result || ""));
        const natija = mergeEmaktabData({ data, classes, subjects, teachers, rooms });
        setClasses?.(natija.classes);
        setSubjects?.(natija.subjects);
        setTeachers?.(natija.teachers);
        setRooms?.(natija.rooms);
        setImportHisobot(natija.hisobot);
        toast?.(importSummary(natija.hisobot), "success");
      } catch (e) {
        setImportHisobot(null);
        toast?.("Import bajarilmadi: " + e.message, "error");
      }
    };
    r.readAsText(file);
  }

  // Ko'prik skripti public/ dan olinadi — bitta manba, ikki joyda
  // nusxa yurmasin uchun sahifa uni o'zi yuklab oladi.
  const skriptUrl = `${import.meta.env.BASE_URL}emaktab-bridge.user.js`;
  useEffect(() => {
    let tirik = true;
    fetch(skriptUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (tirik) { setSkript(t); setSkriptXato(""); } })
      .catch((e) => { if (tirik) setSkriptXato(e.message); });
    return () => { tirik = false; };
  }, [skriptUrl]);

  // Skript sarlavhasidagi versiya — foydalanuvchi o'rnatilgani bilan
  // solishtira olsin (Tampermonkey → skript nomi yonida ko'rinadi)
  const versiya = useMemo(() => /@version\s+([\d.]+)/.exec(skript)?.[1] || "", [skript]);

  // Tampermonkey `.user.js` bilan tugagan URL ochilganda o'rnatish
  // oynasini o'zi ko'rsatadi — shu havola yetarli. Kengaytma bo'lmasa
  // brauzer shunchaki matnni ochadi, shuning uchun zaxira «yuklab olish» ham bor.
  const ornatishUrl = typeof window !== "undefined" ? `${window.location.origin}${skriptUrl}` : skriptUrl;

  function toggle(id) {
    setTanlangan((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function nusxa(matn, xabar) {
    try {
      await navigator.clipboard.writeText(matn);
      toast?.(xabar, "success");
    } catch {
      // Clipboard API HTTPS siz yoki ruxsatsiz ishlamaydi — zaxira yo'l
      const ta = document.createElement("textarea");
      ta.value = matn;
      ta.style.cssText = "position:fixed;left:-9999px;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      toast?.(ok ? xabar : "Nusxa olinmadi — matnni qo'lda belgilang", ok ? "success" : "error");
    }
  }

  function yuklab(matn, nom, turi = "application/json") {
    const url = URL.createObjectURL(new Blob([matn], { type: turi }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nom;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Bitta qo'yishda ishlaydigan to'plam: avval ma'lumot, keyin skript
  const birgalikda = `window.__SJ_JADVAL__ = ${json};\n${skript}`;

  const bosh = stat.boshSinflar;
  const faylNomi = payloadFileName(paket);

  return (
    <div className="emk-page">
      <style>{`
        .emk-page{--emk-soft:#f8fafc;width:100%;max-width:none;padding:22px 28px 56px;box-sizing:border-box;
          display:flex;flex-direction:column;gap:18px;}
        body.dark-mode .emk-page{--emk-soft:rgba(255,255,255,.04);}
        @media(max-width:900px){.emk-page{padding:14px 14px 40px;gap:14px;}}

        /* ——— ikki ustunli setka (keng ekranda) ——— */
        .emk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:stretch;}
        .emk-grid2>.emk-card{margin:0;}
        @media(max-width:1100px){.emk-grid2{grid-template-columns:1fr;}}

        /* ——— sarlavha ——— */
        .emk-hero{position:relative;overflow:hidden;border-radius:22px;padding:30px 34px 28px;
          background:linear-gradient(120deg,#1e1b4b 0%,#3730a3 30%,#4f46e5 58%,#0ea5e9 100%);color:#fff;
          box-shadow:0 18px 48px rgba(79,70,229,.30);}
        .emk-hero::before{content:"";position:absolute;inset:0;
          background:radial-gradient(circle at 85% 20%,rgba(255,255,255,.16),transparent 38%),
                     radial-gradient(circle at 15% 110%,rgba(56,189,248,.28),transparent 40%);pointer-events:none;}
        .emk-hero::after{content:"";position:absolute;right:-90px;top:-120px;width:340px;height:340px;border-radius:50%;
          background:rgba(255,255,255,.07);pointer-events:none;}
        .emk-hero h1{margin:0 0 8px;font-size:28px;letter-spacing:-.5px;line-height:1.15;}
        .emk-hero p{margin:0;color:rgba(255,255,255,.86);font-size:14.5px;max-width:820px;line-height:1.55;}
        .emk-hero-row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start;position:relative;}
        .emk-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.16);
          border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;white-space:nowrap;}

        /* ——— oqim: 3 ta plitka ——— */
        .emk-flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:12px;align-items:stretch;margin-top:22px;position:relative;}
        .emk-flow-box{background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.24);border-radius:16px;padding:14px 16px;
          backdrop-filter:blur(6px);transition:background .15s;}
        .emk-flow-box:hover{background:rgba(255,255,255,.2);}
        .emk-flow-box b{display:block;font-size:14px;margin-bottom:4px;}
        .emk-flow-box span{font-size:12.5px;color:rgba(255,255,255,.82);line-height:1.5;display:block;}
        .emk-flow-arrow{display:flex;align-items:center;font-size:22px;color:rgba(255,255,255,.75);}
        @media(max-width:760px){.emk-flow{grid-template-columns:1fr;}.emk-flow-arrow{justify-content:center;transform:rotate(90deg);}}

        /* ——— kartalar ——— */
        .emk-card{position:relative;background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);
          border-radius:20px;padding:22px 24px;margin:0;box-shadow:var(--card-shadow,0 6px 20px rgba(15,23,42,.05));
          transition:box-shadow .2s,border-color .2s;}
        .emk-card:hover{box-shadow:var(--card-shadow-hover,0 10px 30px rgba(15,23,42,.09));border-color:rgba(99,102,241,.3);}
        .emk-card::before{content:"";position:absolute;left:24px;right:24px;top:0;height:3px;border-radius:0 0 4px 4px;
          background:linear-gradient(90deg,#6366f1,#0ea5e9);opacity:.85;}
        .emk-card-head{display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;}
        .emk-card-head h2{margin:0;font-size:17.5px;display:flex;align-items:center;gap:8px;color:var(--text-primary,#0f172a);letter-spacing:-.2px;}
        .emk-num{width:32px;height:32px;border-radius:11px;flex:none;display:flex;align-items:center;justify-content:center;
          font-size:14.5px;font-weight:800;color:#fff;background:linear-gradient(135deg,#6366f1,#0ea5e9);
          box-shadow:0 5px 12px rgba(99,102,241,.32);}
        .emk-tag{font-size:11px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;border-radius:999px;padding:3px 9px;}
        .emk-tag-bir{background:rgba(14,165,233,.14);color:#0369a1;}
        .emk-tag-tavsiya{background:rgba(16,185,129,.14);color:#047857;}
        .emk-tag-ixtiyoriy{background:rgba(148,163,184,.18);color:#475569;}
        .emk-sub{color:var(--text-secondary,#64748b);font-size:13.5px;margin:0 0 14px;line-height:1.55;}

        /* ——— usul tanlash ——— */
        .emk-usul{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;}
        @media(max-width:640px){.emk-usul{grid-template-columns:1fr;}}
        .emk-usul-btn{text-align:left;border:2px solid var(--card-border,#e2e8f0);background:var(--emk-soft);
          border-radius:14px;padding:14px 16px;cursor:pointer;font-family:inherit;color:inherit;transition:all .15s;position:relative;}
        .emk-usul-btn:hover{border-color:#a5b4fc;}
        .emk-usul-btn.on{border-color:#6366f1;background:rgba(99,102,241,.08);box-shadow:0 0 0 4px rgba(99,102,241,.12);}
        .emk-usul-btn .t{font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:8px;margin-bottom:4px;}
        .emk-usul-btn .d{font-size:12.5px;color:var(--text-secondary,#64748b);line-height:1.5;}
        .emk-usul-btn .chk{position:absolute;right:12px;top:12px;width:20px;height:20px;border-radius:50%;border:2px solid var(--card-border,#cbd5e1);
          display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;}
        .emk-usul-btn.on .chk{background:#6366f1;border-color:#6366f1;}

        /* ——— qadamlar ——— */
        .emk-steps{counter-reset:q;padding:0;margin:0;list-style:none;}
        .emk-steps li{position:relative;padding:0 0 14px 40px;font-size:13.5px;line-height:1.6;color:var(--text-primary,#0f172a);}
        .emk-steps li:last-child{padding-bottom:0;}
        .emk-steps li::before{counter-increment:q;content:counter(q);position:absolute;left:0;top:1px;
          width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;font-size:12.5px;
          font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(99,102,241,.3);}
        .emk-steps li:not(:last-child)::after{content:"";position:absolute;left:12px;top:29px;bottom:2px;width:2px;
          background:var(--card-border,#e2e8f0);border-radius:2px;}
        .emk-steps code,.emk-kbd{background:var(--emk-soft);border:1px solid var(--card-border,#e2e8f0);
          border-radius:6px;padding:1px 7px;font-size:12px;font-family:ui-monospace,Consolas,monospace;}
        .emk-kbd{font-weight:700;box-shadow:0 1px 0 var(--card-border,#cbd5e1);}
        .emk-path{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;}
        .emk-path span{background:var(--emk-soft);border:1px solid var(--card-border,#e2e8f0);
          border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600;}
        .emk-path i{font-style:normal;color:var(--text-muted,#94a3b8);font-size:12px;}
        .emk-pill{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:2px 9px;font-size:12px;font-weight:800;
          border:1px solid transparent;vertical-align:middle;}
        .emk-pill-sj{background:#0f172a;color:#fff;font-family:ui-monospace,Consolas,monospace;letter-spacing:.5px;}
        .emk-pill-yashil{background:rgba(16,185,129,.14);color:#047857;border-color:rgba(16,185,129,.35);}
        .emk-pill-binafsha{background:rgba(99,102,241,.12);color:#4338ca;border-color:rgba(99,102,241,.35);}
        .emk-pill-kul{background:var(--emk-soft);color:var(--text-secondary,#475569);border-color:var(--card-border,#e2e8f0);}

        /* ——— qadam plitkalari (tayyorgarlik) ——— */
        .emk-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
        @media(max-width:860px){.emk-grid3{grid-template-columns:1fr;}}
        .emk-tile{border:1px solid var(--card-border,#e2e8f0);border-radius:14px;padding:14px 16px;background:var(--emk-soft);
          display:flex;flex-direction:column;gap:8px;}
        .emk-tile-h{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:800;}
        .emk-tile-h .emk-num{width:26px;height:26px;font-size:12.5px;border-radius:8px;}
        .emk-tile p{margin:0;font-size:12.8px;color:var(--text-secondary,#64748b);line-height:1.5;}
        .emk-tile .emk-btns{margin-top:auto;padding-top:4px;}
        .emk-links{display:flex;flex-wrap:wrap;gap:6px;}
        .emk-link{display:inline-flex;align-items:center;gap:5px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card-bg,#fff);
          border-radius:9px;padding:5px 10px;font-size:12.5px;font-weight:700;color:var(--text-primary,#0f172a);text-decoration:none;}
        .emk-link:hover{border-color:#6366f1;color:#4338ca;}

        /* ——— chiplar / qatorlar / tugmalar ——— */
        .emk-classes{display:flex;flex-wrap:wrap;gap:7px;}
        .emk-chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--card-border,#e2e8f0);
          background:var(--emk-soft);border-radius:10px;padding:6px 10px;font-size:13px;
          font-weight:700;cursor:pointer;user-select:none;transition:all .12s;}
        .emk-chip:hover{border-color:#a5b4fc;}
        .emk-chip.on{border-color:#6366f1;background:rgba(99,102,241,.1);color:#4338ca;}
        .emk-chip.bosh{opacity:.5;}
        .emk-chip small{font-weight:600;opacity:.7;}
        .emk-row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}
        .emk-row label{font-size:13px;font-weight:600;color:var(--text-secondary,#475569);
          display:flex;align-items:center;gap:6px;}
        .emk-row select{border:1.5px solid var(--card-border,#e2e8f0);border-radius:9px;padding:6px 9px;
          font-size:13px;font-family:inherit;background:var(--card-bg,#fff);color:inherit;}
        .emk-btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
        .emk-btn{display:inline-flex;align-items:center;gap:7px;border-radius:11px;padding:10px 16px;
          font-size:13.5px;font-weight:750;font-family:inherit;cursor:pointer;border:1.5px solid transparent;
          text-decoration:none;transition:transform .1s,box-shadow .15s;}
        .emk-btn:hover{transform:translateY(-1px);}
        .emk-btn-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 6px 16px rgba(16,185,129,.3);}
        .emk-btn-accent{background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;box-shadow:0 6px 16px rgba(99,102,241,.3);}
        .emk-btn-soft{background:var(--card-bg,#fff);border-color:var(--card-border,#e2e8f0);
          color:var(--text-secondary,#475569);}
        .emk-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;}
        .emk-btn-big{padding:13px 22px;font-size:15px;border-radius:13px;}
        .emk-stat{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--text-secondary,#64748b);}
        .emk-stat b{color:var(--text-primary,#0f172a);font-size:17px;display:block;}
        .emk-note{border-radius:12px;padding:10px 13px;font-size:12.8px;margin-top:12px;line-height:1.5;
          background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);color:#92400e;}
        .emk-note-ok{background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.35);color:#065f46;}
        .emk-note-info{background:rgba(14,165,233,.1);border-color:rgba(14,165,233,.35);color:#075985;}
        .emk-fayl{display:inline-flex;align-items:center;gap:6px;background:var(--emk-soft);border:1px dashed var(--card-border,#cbd5e1);
          border-radius:9px;padding:5px 10px;font-size:12.5px;font-family:ui-monospace,Consolas,monospace;}

        /* ——— muammo (accordion) ——— */
        .emk-acc{margin-top:14px;border:1px solid var(--card-border,#e2e8f0);border-radius:12px;overflow:hidden;}
        .emk-acc-h{width:100%;text-align:left;background:var(--emk-soft);border:none;padding:11px 14px;
          font-family:inherit;font-size:13.5px;font-weight:750;cursor:pointer;color:var(--text-primary,#0f172a);
          display:flex;justify-content:space-between;align-items:center;}
        .emk-acc-b{padding:12px 14px;font-size:13px;line-height:1.6;}
        .emk-acc-b ul{margin:0;padding-left:18px;}
        .emk-acc-b li{margin-bottom:6px;}

        /* ——— 5-karta: qadamlar chapda, eslatmalar o'ngda ——— */
        .emk-split{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:22px;align-items:start;}
        @media(max-width:1100px){.emk-split{grid-template-columns:1fr;}}
        .emk-split-side .emk-note:first-child{margin-top:0;}
        .emk-split-side .emk-acc{margin-top:12px;}

        .emk-prev{max-height:380px;overflow:auto;border:1px solid var(--card-border,#e2e8f0);border-radius:12px;}
        .emk-prev table{width:100%;border-collapse:collapse;font-size:12.5px;}
        .emk-prev th,.emk-prev td{padding:6px 10px;border-bottom:1px solid var(--card-border,#eef2f7);text-align:left;}
        .emk-prev th{background:var(--emk-soft);position:sticky;top:0;font-weight:700;}

        /* ——— qorong'i rejim ——— */
        body.dark-mode .emk-note{color:#fcd34d;}
        body.dark-mode .emk-note-ok{color:#6ee7b7;}
        body.dark-mode .emk-note-info{color:#7dd3fc;}
        body.dark-mode .emk-chip.on{color:#c7d2fe;}
        body.dark-mode .emk-tag-bir{color:#7dd3fc;}
        body.dark-mode .emk-tag-tavsiya{color:#6ee7b7;}
        body.dark-mode .emk-tag-ixtiyoriy{color:#cbd5e1;}
        body.dark-mode .emk-pill-yashil{color:#6ee7b7;}
        body.dark-mode .emk-pill-binafsha{color:#c7d2fe;}
        body.dark-mode .emk-link:hover{color:#c7d2fe;}
      `}</style>

      {/* ——— Sarlavha + oqim ——— */}
      <div className="emk-hero">
        <div className="emk-hero-row">
          <div>
            <h1>🔗 eMaktab'ga ko'chirish</h1>
            <p>
              Tayyor dars jadvalini eMaktab (kundalik.com) «Darslar jadvali sxemasi» setkasiga
              o'tkazish. Ko'chirish sizning brauzeringizda, eMaktab sahifasining o'zida bajariladi —
              parolingiz Smartjadval'ga o'tmaydi.
            </p>
          </div>
          {versiya && <span className="emk-badge">🧩 Ko'prik v{versiya}</span>}
        </div>
        <div className="emk-flow">
          <div className="emk-flow-box">
            <b>1 · Smartjadval</b>
            <span>Sinflarni tanlaysiz, jadval faylini yuklab olasiz (yoki nusxa olasiz).</span>
          </div>
          <div className="emk-flow-arrow">➜</div>
          <div className="emk-flow-box">
            <b>2 · Ko'prik skripti</b>
            <span>eMaktab sahifasida ishlaydigan kichik yordamchi — jadvalni setkaga yozadi.</span>
          </div>
          <div className="emk-flow-arrow">➜</div>
          <div className="emk-flow-box">
            <b>3 · eMaktab</b>
            <span>Setka to'ladi. «Nashr etish» ni o'zingiz bosasiz — skript unga tegmaydi.</span>
          </div>
        </div>
      </div>

      {/* ——— Usul tanlash ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <h2>🧭 Qaysi usulda ishlaysiz?</h2>
        </div>
        <p className="emk-sub">
          Ikkalasi ham bir xil natija beradi. Tampermonkey bir marta o'rnatiladi va keyin
          har safar Console ochish shart bo'lmaydi.
        </p>
        <div className="emk-usul">
          <button type="button" className={`emk-usul-btn ${tm ? "on" : ""}`} onClick={() => usulTanla("tampermonkey")}>
            <span className="chk">{tm ? "✓" : ""}</span>
            <div className="t">🧩 Tampermonkey orqali <span className="emk-tag emk-tag-tavsiya">tavsiya</span></div>
            <div className="d">
              Brauzerga kengaytma va ko'prik bir marta o'rnatiladi. eMaktab'da doim
              <b> SJ</b> tugmasi turadi, yangilanishlar avtomatik keladi.
            </div>
          </button>
          <button type="button" className={`emk-usul-btn ${!tm ? "on" : ""}`} onClick={() => usulTanla("console")}>
            <span className="chk">{!tm ? "✓" : ""}</span>
            <div className="t">⌨️ Console orqali <span className="emk-tag emk-tag-ixtiyoriy">o'rnatishsiz</span></div>
            <div className="d">
              Hech narsa o'rnatilmaydi. Har safar «Hammasi birga» matni nusxalanib,
              eMaktab'da <b>F12 → Console</b> ga qo'yiladi.
            </div>
          </button>
        </div>
      </div>

      {/* ——— Tayyorgarlik (faqat Tampermonkey) ——— */}
      {tm && (
        <div className="emk-card">
          <div className="emk-card-head">
            <h2>🛠 Tayyorgarlik</h2>
            <span className="emk-tag emk-tag-bir">bir marta</span>
          </div>
          <p className="emk-sub">
            Bu ikki qadam faqat birinchi marta bajariladi. Keyin eMaktab'ga kirganingizda
            ko'prik o'zi ishga tushadi.
          </p>
          <div className="emk-grid3">
            <div className="emk-tile">
              <div className="emk-tile-h"><span className="emk-num">1</span> Tampermonkey'ni o'rnating</div>
              <p>
                Brauzeringizni tanlang — do'kon sahifasi ochiladi, <b>«O'rnatish» / «Add»</b> ni bosing.
                Bepul, ro'yxatdan o'tish shart emas.
              </p>
              <div className="emk-btns emk-links">
                {TM_DOKONLAR.map((d) => (
                  <a key={d.nom} className="emk-link" href={d.url} target="_blank" rel="noopener noreferrer">
                    {d.belgi} {d.nom}
                  </a>
                ))}
              </div>
              <p>
                ⚠️ Chrome, Edge, Yandex'da qo'shimcha: <span className="emk-path">
                  <span>chrome://extensions</span><i>→</i><span>Dasturchi rejimi (Developer mode)</span>
                </span> tugmasini <b>yoqing</b>. Aks holda Tampermonkey skriptlarni ishga tushirmaydi.
              </p>
            </div>

            <div className="emk-tile">
              <div className="emk-tile-h"><span className="emk-num">2</span> Ko'prik skriptini o'rnating</div>
              <p>
                Tugmani bosing — Tampermonkey o'rnatish oynasini ochadi, u yerda
                <b> «Install» / «O'rnatish»</b> ni bosing. Tamom.
              </p>
              <div className="emk-btns">
                <a className="emk-btn emk-btn-accent" href={ornatishUrl} target="_blank" rel="noopener noreferrer">
                  🧩 Skriptni o'rnatish
                </a>
                <button type="button" className="emk-btn emk-btn-soft" disabled={!skript}
                  title="Faylni saqlab, Tampermonkey → Utilities → Import from file orqali o'rnatish"
                  onClick={() => yuklab(skript, "emaktab-bridge.user.js", "text/javascript")}>
                  💾 Faylini yuklab olish
                </button>
              </div>
              <p>
                Oyna ochilmasa (faqat matn ko'rinsa) — 1-qadam bajarilmagan. Yoki faylni yuklab olib
                Tampermonkey <span className="emk-path"><span>Boshqaruv paneli</span><i>→</i><span>Utilities</span><i>→</i><span>Import from file</span></span> orqali bering.
              </p>
            </div>

            <div className="emk-tile">
              <div className="emk-tile-h"><span className="emk-num">3</span> Tekshiring</div>
              <p>
                eMaktab'da istalgan sinfning <b>chorak sxemasi</b>ni oching. Ekranning o'ng past
                burchagida <span className="emk-pill emk-pill-sj">SJ</span> tugmasi chiqsa — hammasi tayyor.
              </p>
              <p>
                Tampermonkey belgisini bosganda <b>«Smartjadval → eMaktab ko'prigi»</b> yoqilgan
                (yashil) turishi kerak{versiya ? <>, versiyasi <b>{versiya}</b></> : null}.
              </p>
              <p>
                Skript yangilansa Tampermonkey uni o'zi yangilab qo'yadi — qayta o'rnatish shart emas.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="emk-grid2">
      {/* ——— 1. eMaktabdan import ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <span className="emk-num">1</span>
          <h2>📥 eMaktab'dan ma'lumot olish</h2>
          <span className="emk-tag emk-tag-tavsiya">tavsiya</span>
          <span className="emk-tag emk-tag-ixtiyoriy">ixtiyoriy</span>
        </div>
        <p className="emk-sub">
          Fanlar, ustozlar, sinflar va xonalarni eMaktab'ning o'zidan olib kelish.
          Shundan keyin har bir yozuvda eMaktab id'si turadi va yuklashda
          nomlar <b>umuman taxmin qilinmaydi</b>. Bir marta qilinsa yetadi.
        </p>
        <ol className="emk-steps">
          <li>eMaktab'da istalgan sinfning chorak sxemasini oching va ko'prik panelini oching
            ({tm ? <><span className="emk-pill emk-pill-sj">SJ</span> tugmasi</> : "Console orqali"}).</li>
          <li>Paneldagi <span className="emk-pill emk-pill-kul">📥 Yig'ish va saqlash</span> ni bosing — fayl Yuklamalar papkasiga tushadi.</li>
          <li>Pastdagi tugma bilan o'sha faylni shu yerga bering.</li>
        </ol>
        <div className="emk-btns" style={{ marginTop: 14 }}>
          <button type="button" className="emk-btn emk-btn-main"
            onClick={() => importRef.current?.click()}>
            📂 Ma'lumot faylini yuklash
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importQil(f); e.target.value = ""; }} />
        </div>
        <div className="emk-note emk-note-ok">
          ✅ Import hech narsani o'chirmaydi — mavjud sozlamalaringiz (soatlar, guruhlar,
          smenalar) joyida qoladi. Ustozning fanlari ham birlashtiriladi.
        </div>
        {importHisobot && (
          <>
            <div className="emk-stat" style={{ marginTop: 12 }}>
              <span><b>{importHisobot.fan.yangi}</b> yangi fan</span>
              <span><b>{importHisobot.ustoz.yangi}</b> yangi ustoz</span>
              <span><b>{importHisobot.sinf.yangi}</b> yangi sinf</span>
              <span><b>{importHisobot.xona.yangi}</b> yangi xona</span>
            </div>
            {importHisobot.ogohlar.length > 0 && (
              <div className="emk-note">
                <b>Diqqat qiling:</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {importHisobot.ogohlar.slice(0, 12).map((o, i) => <li key={i}>{o}</li>)}
                </ul>
                {importHisobot.ogohlar.length > 12 && (
                  <div style={{ marginTop: 4 }}>…yana {importHisobot.ogohlar.length - 12} ta</div>
                )}
              </div>
            )}
            {/* Eng amaliy ro'yxat: yuklashda nima tushmay qolishini
                OLDINDAN ko'rsatadi — jurnaldan keyin emas. */}
            {importHisobot.bogliqmas?.ustozlar?.length > 0 && (
              <div className="emk-note">
                <b>eMaktab'da topilmagan {importHisobot.bogliqmas.ustozlar.length} ustoz</b> —
                ularning darslari <u>ustozsiz</u> yuklanadi. Ism har ikki tizimda
                bir xil yozilganini tekshiring:
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {importHisobot.bogliqmas.ustozlar.slice(0, 25).join(" · ")}
                  {importHisobot.bogliqmas.ustozlar.length > 25
                    && ` …yana ${importHisobot.bogliqmas.ustozlar.length - 25} ta`}
                </div>
              </div>
            )}
            {importHisobot.bogliqmas?.fanlar?.length > 0 && (
              <div className="emk-note">
                <b>eMaktab'da topilmagan {importHisobot.bogliqmas.fanlar.length} fan</b> —
                bu darslar <u>umuman</u> tushmaydi:
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {importHisobot.bogliqmas.fanlar.slice(0, 25).join(" · ")}
                  {importHisobot.bogliqmas.fanlar.length > 25
                    && ` …yana ${importHisobot.bogliqmas.fanlar.length - 25} ta`}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ——— 2. Sinflar ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <span className="emk-num">2</span>
          <h2>🏫 Sinflarni tanlang</h2>
        </div>
        <p className="emk-sub">Jadvalda darsi bor sinflar avtomatik belgilandi. Yonidagi raqam — darslar soni.</p>
        <div className="emk-row">
          <button type="button" className="emk-btn emk-btn-soft"
            onClick={() => setTanlangan(new Set(sortedClasses.map((c) => c.id)))}>Hammasi</button>
          <button type="button" className="emk-btn emk-btn-soft"
            onClick={() => setTanlangan(new Set())}>Hech biri</button>
          <button type="button" className="emk-btn emk-btn-soft"
            onClick={() => setTanlangan(new Set(sortedClasses.filter((c) => darsSoni.get(c.id)).map((c) => c.id)))}>
            Faqat darsi borlari
          </button>
        </div>
        <div className="emk-classes">
          {sortedClasses.map((c) => {
            const n = darsSoni.get(c.id) || 0;
            return (
              <span key={c.id}
                className={`emk-chip ${tanlangan.has(c.id) ? "on" : ""} ${n ? "" : "bosh"}`}
                onClick={() => toggle(c.id)}>
                {tanlangan.has(c.id) ? "☑" : "☐"} {c.name} <small>{n}</small>
              </span>
            );
          })}
          {!sortedClasses.length && <span className="emk-sub">Sinflar yo'q.</span>}
        </div>
      </div>

      </div>

      <div className="emk-grid2">
      {/* ——— 3. Sozlamalar ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <span className="emk-num">3</span>
          <h2>⚙️ Sozlamalar</h2>
        </div>
        <div className="emk-row">
          <label>
            Chorak
            <select value={chorak} onChange={(e) => setChorak(e.target.value)}>
              {CHORAKLAR.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
          <label title="eMaktab setkasidagi qator raqami qanday hisoblansin">
            Soat raqami
            <select value={raqamlash} onChange={(e) => setRaqamlash(e.target.value)}>
              <option value="smena">Smena ichida (1, 2, 3…)</option>
              <option value="umumiy">Maktab bo'ylab uzluksiz</option>
              <option value="tartib">Sinf vaqtlari tartibi bo'yicha</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={xonaBilan} onChange={(e) => setXonaBilan(e.target.checked)} />
            Xona ham yuborilsin
          </label>
        </div>
        <div className="emk-stat">
          <span><b>{stat.sinflar}</b> sinf</span>
          <span><b>{stat.darslar}</b> dars</span>
          <span><b>{stat.fanlar}</b> fan</span>
          <span><b>{stat.ustozlar}</b> ustoz</span>
          <span title="Nechta nom eMaktab id'si bilan ta'minlangan — 100% bo'lsa yuklashda taxmin ishlatilmaydi">
            <b>{qamrov.fanlar.foiz}% / {qamrov.ustozlar.foiz}%</b> id (fan / ustoz)
          </span>
        </div>
        {(qamrov.fanlar.foiz < 100 || qamrov.ustozlar.foiz < 100) && (
          <div className="emk-note">
            {qamrov.fanlar.jami - qamrov.fanlar.bor} fan va {qamrov.ustozlar.jami - qamrov.ustozlar.bor} ustozda
            eMaktab id'si yo'q — ular nom bo'yicha taxmin qilinadi. 1-qadamdagi
            «📥 eMaktab'dan ma'lumot olish» ni bajarsangiz bu yo'qoladi.
          </div>
        )}
        {bosh.length > 0 && (
          <div className="emk-note">
            Darsi yo'q sinflar tanlangan: {bosh.join(", ")} — ular bo'sh ketadi.
          </div>
        )}
        {stat.ustozsiz > 0 && (
          <div className="emk-note">
            {stat.ustozsiz} ta darsda ustoz ko'rsatilmagan — eMaktab ustozsiz dars qabul qilmasligi mumkin.
          </div>
        )}
      </div>

      {/* ——— 4. Yuklab olish / nusxa ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <span className="emk-num">4</span>
          <h2>{tm ? "💾 Jadval faylini yuklab oling" : "📤 Nusxa oling"}</h2>
        </div>
        {tm ? (
          <>
            <p className="emk-sub">
              Fayl Yuklamalar papkasiga tushadi — uni eMaktab'dagi panelda
              <span className="emk-pill emk-pill-kul" style={{ margin: "0 4px" }}>📂 Fayldan</span> tugmasi bilan ochasiz.
              Fayl brauzerda eslab qolinadi: 40 ta sinfni o'tkazsangiz ham bir marta tanlash yetadi.
            </p>
            <div className="emk-btns">
              <button type="button" className="emk-btn emk-btn-main emk-btn-big"
                disabled={!stat.darslar}
                onClick={() => { yuklab(json, faylNomi); toast?.("Jadval fayli yuklab olindi ✓", "success"); }}>
                💾 Jadvalni yuklab olish
              </button>
              <button type="button" className="emk-btn emk-btn-soft"
                disabled={!stat.darslar}
                title="Faylsiz — matnni paneldagi maydonga qo'yib «✔ Tekshirish» bosiladi"
                onClick={() => nusxa(json, "Jadval JSON nusxalandi — panel maydoniga qo'ying ✓")}>
                📋 Nusxa olish (faylsiz)
              </button>
              {stat.darslar > 0 && <span className="emk-fayl">📄 {faylNomi}</span>}
            </div>
          </>
        ) : (
          <>
            <p className="emk-sub">
              «Hammasi birga» — jadval va ko'prik skripti bitta matnda; eMaktab'da Console'ga
              bir marta qo'yiladi. Jadval o'zgarsa qaytadan nusxa olib qo'yasiz.
            </p>
            <div className="emk-btns">
              <button type="button" className="emk-btn emk-btn-main emk-btn-big"
                disabled={!skript || !stat.darslar}
                onClick={() => nusxa(birgalikda, "Nusxa olindi — eMaktab sahifasida Console'ga qo'ying ✓")}>
                ⚡ Hammasi birga (skript + jadval)
              </button>
              <button type="button" className="emk-btn emk-btn-soft" disabled={!stat.darslar}
                onClick={() => nusxa(json, "Jadval JSON nusxalandi ✓")}>
                📋 Faqat jadval (JSON)
              </button>
              <button type="button" className="emk-btn emk-btn-soft" disabled={!stat.darslar}
                onClick={() => yuklab(json, faylNomi)}>
                💾 JSON yuklab olish
              </button>
            </div>
          </>
        )}
        {!stat.darslar && (
          <div className="emk-note">Tanlangan sinflarda dars yo'q — avval jadval tuzing yoki 2-qadamda sinf belgilang.</div>
        )}
        {skriptXato && (
          <div className="emk-note">
            Ko'prik skripti yuklanmadi ({skriptXato}). <code>public/emaktab-bridge.user.js</code> joyidami?
          </div>
        )}
      </div>

      </div>

      {/* ——— 5. eMaktab'da joylashtirish ——— */}
      <div className="emk-card">
        <div className="emk-card-head">
          <span className="emk-num">5</span>
          <h2>🚀 eMaktab'da joylashtirish</h2>
        </div>
        <p className="emk-sub">Endi eMaktab saytiga o'ting. Quyidagi qadamlar o'sha yerda bajariladi.</p>
        <div className="emk-split">
        <div>
        {tm ? (
          <ol className="emk-steps">
            <li>
              eMaktab'da <span className="emk-path">
                <span>Dars jadvali</span><i>→</i><span>sinf</span><i>→</i><span>Darslarni ishlab chiqish</span><i>→</i><span>chorak sxemasi</span>
              </span> ni oching. Sxema hali yo'q bo'lsa — skript uni o'zi yaratadi.
            </li>
            <li>O'ng past burchakdagi <span className="emk-pill emk-pill-sj">SJ</span> tugmasini bosing — panel ochiladi.</li>
            <li>
              <span className="emk-pill emk-pill-kul">📂 Fayldan</span> ni bosib yuklab olgan
              {stat.darslar > 0 ? <> <b>{faylNomi}</b></> : " jadval"} faylini tanlang.
              Panelda «✓ N sinf, N dars» yozuvi chiqadi.
            </li>
            <li>«2. Sinf» ro'yxatidan sinfni tanlang — «Setka topildi: 7 kun, N soat» degan yashil yozuvni kuting.</li>
            <li>
              <span className="emk-pill emk-pill-yashil">▶ Shu sinfga</span> — faqat ochiq turgan sinfni to'ldiradi.
              <span className="emk-pill emk-pill-binafsha" style={{ marginLeft: 6 }}>🚀 Hamma sinfga joylashtirish</span> — barcha
              tanlangan sinflar uchun sxema yaratib, darslarni ketma-ket o'zi yozadi — sahifa almashtirish shart emas. Ichida allaqachon dars bor sxemaga tegmaydi.
            </li>
            <li>Setka to'lgach eMaktab'dagi <b>«Nashr etish»</b> ni <u>o'zingiz</u> bosasiz — skript unga tegmaydi.</li>
          </ol>
        ) : (
          <ol className="emk-steps">
            <li>
              eMaktab'da <span className="emk-path">
                <span>Dars jadvali</span><i>→</i><span>sinf</span><i>→</i><span>Darslarni ishlab chiqish</span><i>→</i><span>chorak sxemasi</span>
              </span> ni oching.
            </li>
            <li>
              O'sha sahifada <span className="emk-kbd">F12</span> bosing (yoki sichqoncha o'ng tugmasi → «Inspect») va
              <b> Console</b> bo'limini oching.
            </li>
            <li>
              Nusxani qo'ying (<span className="emk-kbd">Ctrl</span>+<span className="emk-kbd">V</span>) va
              <span className="emk-kbd">Enter</span> bosing. Brauzer «allow pasting» deb so'rasa —
              <code>allow pasting</code> deb yozib Enter bosing, keyin qayta qo'ying.
            </li>
            <li>Panel ochiladi, jadval unda tayyor turadi. «2. Sinf» dan sinfni tanlang.</li>
            <li>
              <span className="emk-pill emk-pill-yashil">▶ Shu sinfga</span> yoki
              <span className="emk-pill emk-pill-binafsha" style={{ marginLeft: 6 }}>🚀 Hamma sinfga joylashtirish</span> ni bosing.
            </li>
            <li>Setka to'lgach <b>«Nashr etish»</b> ni <u>o'zingiz</u> bosasiz — skript unga tegmaydi.</li>
          </ol>
        )}

        </div>
        <div className="emk-split-side">
        <div className="emk-note">
          ⚠️ Birinchi maktabda ishlatishdan oldin panelning <b>«🔍 O'rganish»</b> bo'limini bajaring:
          bitta darsni qo'lda qo'shasiz, skript eMaktab qanday ishlashini yozib oladi. O'sha natija
          joylashtirishni aniq qiladi.
        </div>
        <div className="emk-note emk-note-info">
          💡 <b>«Sinov (1 dars, saqlamaydi)»</b> tugmasi — hech narsa yozmasdan bitta dars bilan tekshirib ko'radi.
          Katta maktabda avval shuni bosib ko'ring.
        </div>

        <div className="emk-acc">
          <button type="button" className="emk-acc-h" onClick={() => setMuammoOchiq((v) => !v)}>
            <span>🩹 Ishlamayaptimi? Tez-tez uchraydigan sabablar</span>
            <span>{muammoOchiq ? "▲" : "▼"}</span>
          </button>
          {muammoOchiq && (
            <div className="emk-acc-b">
              <ul>
                {tm && (
                  <>
                    <li><b>SJ tugmasi chiqmayapti.</b> Tampermonkey belgisini bosing — kengaytma va «Smartjadval → eMaktab ko'prigi» ikkalasi ham yoqiq (yashil) bo'lsin.</li>
                    <li><b>Chrome / Edge / Yandex'da skript umuman ishlamayapti.</b> <code>chrome://extensions</code> sahifasida «Dasturchi rejimi» yoqilmagan. Yoqib, sahifani yangilang.</li>
                    <li><b>SJ faqat ba'zi sahifalarda bor.</b> Bu to'g'ri: tugma faqat «Dars jadvali» bo'limida (<code>/v2/schedules…</code>) chiqadi, jurnal va hisobotlarda xalaqit bermaydi.</li>
                    <li><b>Eski versiya turibdi.</b> Tampermonkey → Boshqaruv paneli → skript qatorida «Yangilanishlarni tekshirish». Yoki yuqoridagi «🧩 Skriptni o'rnatish» ni qayta bosing — ustidan yangilanadi.</li>
                  </>
                )}
                {!tm && (
                  <>
                    <li><b>Console «allow pasting» deb turibdi.</b> Aynan shu ikki so'zni yozib Enter bosing — bu brauzerning himoyasi, keyin qo'yish ishlaydi.</li>
                    <li><b>Sahifa yangilangach panel yo'qoldi.</b> Console usulida bu tabiiy — matnni qayta qo'ying. Doim turishi uchun Tampermonkey usulini tanlang.</li>
                  </>
                )}
                <li><b>«Setka topilmadi».</b> Siz chorak sxemasi sahifasida emassiz. Sinf → «Darslarni ishlab chiqish» → sxema ichiga kiring.</li>
                <li><b>Ustoz yoki fan «topilmadi».</b> Nomlar ikki tizimda har xil yozilgan. 1-qadamdagi «eMaktab'dan ma'lumot olish» ni bajaring — id bilan bog'lanadi va taxmin qolmaydi.</li>
                <li><b>Dars band katakka tushmadi.</b> Panelda «band katakni o'tkazib yuborish» belgilangan — mavjud darslar saqlanadi. Ustidan yozish kerak bo'lsa belgini olib tashlang.</li>
              </ul>
            </div>
          )}
        </div>
        </div>
        </div>
      </div>

      {/* ——— Ko'rib chiqish ——— */}
      {stat.darslar > 0 && (
        <div className="emk-card">
          <div className="emk-card-head">
            <h2>👁 Ko'rib chiqish</h2>
          </div>
          <p className="emk-sub">Birinchi 40 ta dars — eMaktab'ga aynan shu ko'rinishda ketadi.</p>
          <div className="emk-prev">
            <table>
              <thead>
                <tr><th>Sinf</th><th>Kun</th><th>Soat</th><th>Fan</th><th>Ustoz</th>
                  {xonaBilan && <th>Xona</th>}<th>Guruh</th></tr>
              </thead>
              <tbody>
                {paket.sinflar.flatMap((s) => s.darslar.map((d) => ({ ...d, sinf: s.nom })))
                  .slice(0, 40)
                  .map((d, i) => (
                    <tr key={i}>
                      <td>{d.sinf}</td>
                      <td>{DAYS[d.kun - 1]}</td>
                      <td>{d.soat}</td>
                      <td>{d.fan}</td>
                      <td>{d.ustoz || <span style={{ color: "#ef4444" }}>— yo'q —</span>}</td>
                      {xonaBilan && <td>{d.xona}</td>}
                      <td>{d.guruh}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
