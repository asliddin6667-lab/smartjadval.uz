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
//  Ko'prik skripti: public/emaktab-bridge.user.js
// =====================================================================
import { useMemo, useState, useEffect, useRef } from "react";
import { buildEmaktabPayload, payloadStats, payloadFileName, idCoverage } from "../utils/emaktabExport";
import { mergeEmaktabData, importSummary } from "../utils/emaktabImport";
import { DAYS } from "../utils/constants";

const CHORAKLAR = ["1 chorak", "2 chorak", "3 chorak", "4 chorak"];

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
  const importRef = useRef(null);

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
  useEffect(() => {
    let tirik = true;
    fetch(`${import.meta.env.BASE_URL}emaktab-bridge.user.js`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (tirik) { setSkript(t); setSkriptXato(""); } })
      .catch((e) => { if (tirik) setSkriptXato(e.message); });
    return () => { tirik = false; };
  }, []);

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

  return (
    <div className="emk-page">
      <style>{`
        .emk-page{max-width:1100px;}
        .emk-head h1{margin:0 0 4px;}
        .emk-head p{color:var(--text-secondary,#64748b);margin:0 0 18px;}
        .emk-card{background:var(--card-bg,#fff);border:1px solid var(--card-border,#e2e8f0);
          border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 6px 20px rgba(15,23,42,.05);}
        .emk-card h2{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px;}
        .emk-card .emk-sub{color:var(--text-secondary,#64748b);font-size:13px;margin:0 0 12px;}
        .emk-classes{display:flex;flex-wrap:wrap;gap:7px;}
        .emk-chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--card-border,#e2e8f0);
          background:var(--bg-secondary,#f8fafc);border-radius:10px;padding:6px 10px;font-size:13px;
          font-weight:700;cursor:pointer;user-select:none;}
        .emk-chip.on{border-color:#6366f1;background:rgba(99,102,241,.1);color:#4338ca;}
        .emk-chip.bosh{opacity:.5;}
        .emk-chip small{font-weight:600;opacity:.7;}
        .emk-row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}
        .emk-row label{font-size:13px;font-weight:600;color:var(--text-secondary,#475569);
          display:flex;align-items:center;gap:6px;}
        .emk-row select{border:1.5px solid var(--card-border,#e2e8f0);border-radius:9px;padding:6px 9px;
          font-size:13px;font-family:inherit;background:var(--card-bg,#fff);color:inherit;}
        .emk-btn{display:inline-flex;align-items:center;gap:7px;border-radius:11px;padding:9px 15px;
          font-size:13.5px;font-weight:750;font-family:inherit;cursor:pointer;border:1.5px solid transparent;
          margin:3px 6px 3px 0;}
        .emk-btn-main{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
        .emk-btn-soft{background:var(--card-bg,#fff);border-color:var(--card-border,#e2e8f0);
          color:var(--text-secondary,#475569);}
        .emk-btn:disabled{opacity:.55;cursor:not-allowed;}
        .emk-stat{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--text-secondary,#64748b);}
        .emk-stat b{color:var(--text-primary,#0f172a);font-size:16px;display:block;}
        .emk-warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.35);color:#92400e;
          border-radius:10px;padding:9px 12px;font-size:12.5px;margin-top:10px;}
        .emk-steps{counter-reset:q;padding:0;margin:0;list-style:none;}
        .emk-steps li{position:relative;padding:0 0 12px 34px;font-size:13.5px;line-height:1.55;}
        .emk-steps li::before{counter-increment:q;content:counter(q);position:absolute;left:0;top:0;
          width:24px;height:24px;border-radius:50%;background:#6366f1;color:#fff;font-size:12px;
          font-weight:800;display:flex;align-items:center;justify-content:center;}
        .emk-steps code{background:var(--bg-secondary,#f1f5f9);border-radius:5px;padding:1px 6px;font-size:12px;}
        .emk-prev{max-height:230px;overflow:auto;border:1px solid var(--card-border,#e2e8f0);border-radius:10px;}
        .emk-prev table{width:100%;border-collapse:collapse;font-size:12.5px;}
        .emk-prev th,.emk-prev td{padding:5px 9px;border-bottom:1px solid var(--card-border,#eef2f7);text-align:left;}
        .emk-prev th{background:var(--bg-secondary,#f8fafc);position:sticky;top:0;font-weight:700;}
        [data-theme="dark"] .emk-warn{color:#fcd34d;}
      `}</style>

      <div className="emk-head">
        <h1>eMaktab'ga ko'chirish</h1>
        <p>Tayyor dars jadvalini eMaktab (kundalik.com) «Darslar jadvali sxemasi» setkasiga o'tkazish.</p>
      </div>

      {/* ——— Qanday ishlaydi ——— */}
      <div className="emk-card">
        <h2>📖 Qanday ishlaydi</h2>
        <p className="emk-sub">
          eMaktab boshqa sayt va o'z parolingiz bilan ochiladi — Smartjadval u yerga
          to'g'ridan-to'g'ri yoza olmaydi. Shuning uchun ko'chirish sizning brauzeringizda,
          eMaktab sahifasining o'zida bajariladi.
        </p>
        <ol className="emk-steps">
          <li>Pastdan sinflarni belgilang va <b>«⚡ Hammasi birga»</b> tugmasini bosing — nusxa olinadi.</li>
          <li>eMaktab'da: <code>Dars jadvali → sinf → Darslarni ishlab chiqish → chorak sxemasi</code> ni oching.</li>
          <li>O'sha sahifada <code>F12</code> → <b>Console</b> ni oching, nusxani qo'ying va <code>Enter</code> bosing.</li>
          <li>Chiqqan panelda sinfni tanlab <b>«▶ Joylashtirish»</b> ni bosing.</li>
          <li>Setka to'lgach <b>«Nashr etish»</b> ni <u>o'zingiz</u> bosasiz — skript unga tegmaydi.</li>
        </ol>
        <div className="emk-warn">
          ⚠️ Birinchi maktabda ishlatishdan oldin panelning <b>«🔍 O'rganish»</b> bo'limini bajaring:
          bitta darsni qo'lda qo'shasiz, skript eMaktab qanday ishlashini yozib oladi. O'sha natija
          joylashtirishni aniq qiladi.
        </div>
      </div>

      {/* ——— eMaktabdan import ——— */}
      <div className="emk-card">
        <h2>📥 eMaktab'dan ma'lumot olish</h2>
        <p className="emk-sub">
          Fanlar, ustozlar, sinflar va xonalarni eMaktab'ning o'zidan olib kelish.
          Shundan keyin har bir yozuvda eMaktab id'si turadi va yuklashda
          nomlar <b>umuman taxmin qilinmaydi</b>.
        </p>
        <ol className="emk-steps">
          <li>eMaktab'da istalgan sinfning chorak sxemasini oching va ko'prikni ishga tushiring.</li>
          <li>Paneldagi <b>«📥 Yig'ish va saqlash»</b> — fayl Yuklamalar papkasiga tushadi.</li>
          <li>Pastdagi tugma bilan o'sha faylni shu yerga bering.</li>
        </ol>
        <div>
          <button type="button" className="emk-btn emk-btn-main"
            onClick={() => importRef.current?.click()}>
            📂 Ma'lumot faylini yuklash
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importQil(f); e.target.value = ""; }} />
        </div>
        <div className="emk-warn" style={{ background: "rgba(16,185,129,.1)", borderColor: "rgba(16,185,129,.35)", color: "#065f46" }}>
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
              <div className="emk-warn">
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
              <div className="emk-warn">
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
              <div className="emk-warn">
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

      {/* ——— Sinflar ——— */}
      <div className="emk-card">
        <h2>🏫 Sinflar</h2>
        <p className="emk-sub">Jadvalda darsi bor sinflar avtomatik belgilandi.</p>
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

      {/* ——— Sozlamalar ——— */}
      <div className="emk-card">
        <h2>⚙️ Sozlamalar</h2>
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
          <div className="emk-warn">
            {qamrov.fanlar.jami - qamrov.fanlar.bor} fan va {qamrov.ustozlar.jami - qamrov.ustozlar.bor} ustozda
            eMaktab id'si yo'q — ular nom bo'yicha taxmin qilinadi. Yuqoridagi
            «📥 eMaktab'dan ma'lumot olish» ni bajarsangiz bu yo'qoladi.
          </div>
        )}
        {bosh.length > 0 && (
          <div className="emk-warn">
            Darsi yo'q sinflar tanlangan: {bosh.join(", ")} — ular bo'sh ketadi.
          </div>
        )}
        {stat.ustozsiz > 0 && (
          <div className="emk-warn">
            {stat.ustozsiz} ta darsda ustoz ko'rsatilmagan — eMaktab ustozsiz dars qabul qilmasligi mumkin.
          </div>
        )}
      </div>

      {/* ——— Nusxa olish ——— */}
      <div className="emk-card">
        <h2>📤 Ko'chirish</h2>
        <p className="emk-sub">
          «Hammasi birga» — jadval va ko'prik skripti bitta matnda; Console'ga bir marta qo'yiladi.
        </p>
        <div>
          <button type="button" className="emk-btn emk-btn-main"
            disabled={!skript || !stat.darslar}
            onClick={() => nusxa(birgalikda, "Nusxa olindi — eMaktab sahifasida Console'ga qo'ying ✓")}>
            ⚡ Hammasi birga (skript + jadval)
          </button>
          <button type="button" className="emk-btn emk-btn-soft"
            onClick={() => nusxa(json, "Jadval JSON nusxalandi ✓")}>
            📋 Faqat jadval (JSON)
          </button>
          <button type="button" className="emk-btn emk-btn-soft"
            onClick={() => yuklab(json, payloadFileName(paket))}>
            💾 JSON yuklab olish
          </button>
          <button type="button" className="emk-btn emk-btn-soft" disabled={!skript}
            onClick={() => yuklab(skript, "emaktab-bridge.user.js", "text/javascript")}>
            🧩 Skriptni yuklab olish (Tampermonkey)
          </button>
        </div>
        {skriptXato && (
          <div className="emk-warn">
            Ko'prik skripti yuklanmadi ({skriptXato}). <code>public/emaktab-bridge.user.js</code> joyidami?
          </div>
        )}
      </div>

      {/* ——— Ko'rib chiqish ——— */}
      {stat.darslar > 0 && (
        <div className="emk-card">
          <h2>👁 Ko'rib chiqish</h2>
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
