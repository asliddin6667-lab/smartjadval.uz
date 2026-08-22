import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import * as XS from "xlsx-js-style";
import {
  fetchExcelStore, upsertExcelData, deleteExcelData,
} from "../services/districtExcelService";
import "./districtExcel.css";

// =====================================================================
//  TUMAN ADMIN — EXCEL MA'LUMOTLAR va HISOBOTLAR
//
//  Har bir maktab uchun 3 xil Excel yuklanadi:
//    1. Ustozlar ro'yxati        (teachers)
//    2. Dars soat setkasi        (setka)  — fan × sinf matritsa
//    3. Dars jadvali             (jadval) — uzun format
//
//  Ma'lumotlar Supabase'da saqlanadi (district_excel_data jadvali) —
//  istalgan qurilmadan ko'rinadi. RLS: tuman admini faqat o'z tumanini
//  ko'radi. Eski localStorage ma'lumotlari bir marta serverga
//  ko'chirilishi mumkin ("📦 Serverga ko'chirish" tugmasi).
//
//  SetkaMatrix, JadvalViewer va TeacherHoursTable eksport qilinadi —
//  DistrictApp.jsx dagi SchoolDetail (maktab oynasi) ham ishlatadi.
//
//  EXCEL EKSPORT: barcha eksportlar xlsx-js-style bilan RANGLI
//  formatda chiqadi (sarlavha banner, zebra qatorlar, ramkalar).
//  O'qish (yuklangan faylni parse qilish) esa oddiy xlsx bilan.
// =====================================================================

const LS_KEY = "edu-tuman-excel-data"; // eski (legacy) brauzer xotirasi

const DAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const DAY_SHORT = { Dushanba: "Du", Seshanba: "Se", Chorshanba: "Cho", Payshanba: "Pa", Juma: "Ju", Shanba: "Sha" };

const TYPES = {
  teachers: {
    icon: "👨‍🏫",
    title: "Ustozlar ro'yxati",
    desc: "F.I.Sh., fani va haftalik dars soati",
    file: "ustozlar_shablon.xlsx",
  },
  setka: {
    icon: "🕐",
    title: "Dars soat setkasi",
    desc: "Fanlar bo'yicha sinflarga ajratilgan haftalik soatlar",
    file: "dars_soat_setkasi_shablon.xlsx",
  },
  jadval: {
    icon: "📅",
    title: "Dars jadvali",
    desc: "Sinf, kun, dars raqami, fan, o'qituvchi va xona (ixtiyoriy)",
    file: "dars_jadvali_shablon.xlsx",
  },
};

// ---------------------------------------------------------------------
//  Eski localStorage ma'lumotlari (bir martalik migratsiya uchun)
// ---------------------------------------------------------------------
function loadLegacyStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function legacyCount(legacy) {
  let n = 0;
  for (const sid of Object.keys(legacy)) {
    for (const type of Object.keys(TYPES)) {
      if (legacy[sid]?.[type]?.rows?.length) n++;
    }
  }
  return n;
}

// =====================================================================
//  CHIROYLI EXCEL EKSPORT — umumiy stil yordamchilari (xlsx-js-style)
// =====================================================================
const XL_THEME = {
  indigo:  { accent: "4F46E5", dark: "3730A3", zebra: "EEF2FF" },
  teal:    { accent: "0D9488", dark: "0F766E", zebra: "E6FBF5" },
  violet:  { accent: "7C3AED", dark: "5B21B6", zebra: "F3EFFF" },
  amber:   { accent: "D97706", dark: "92400E", zebra: "FEF6E7" },
};
const XL_BORDER = "C3C9D5";
const XL_TEXT = "1F2937";

const xlFill = (rgb) => ({ patternType: "solid", fgColor: { rgb } });
const xlBorder = (rgb = XL_BORDER) => ({
  top: { style: "thin", color: { rgb } },
  bottom: { style: "thin", color: { rgb } },
  left: { style: "thin", color: { rgb } },
  right: { style: "thin", color: { rgb } },
});

/**
 * Bitta stilli varaq (sheet) yasaydi:
 *
 *   0-qator: TITLE  (katta oq matn, rangli banner, merge)
 *   1-qator: subtitle (kichik matn, o'sha banner, merge)
 *   2-qator: bo'sh ajratuvchi
 *   3-qator: ustun sarlavhalari (oq qalin, to'q fon)
 *   4+     : ma'lumot (zebra qatorlar, ramkalar)
 *   oxiri  : ixtiyoriy JAMI qatori (to'q fon, oq qalin)
 *
 * Parametrlar:
 *   title, subtitle — banner matnlari
 *   header  — ustun nomlari massivi
 *   body    — ma'lumot qatorlari (massivlar massivi)
 *   widths  — ustun kengliklari (wch sonlar)
 *   align   — har ustun uchun "left" | "center" | "right"
 *   theme   — XL_THEME kaliti ("indigo" | "teal" | "violet" | "amber")
 *   boldCols  — qalin ko'rsatiladigan ustun indekslari
 *   wrapCols  — matni o'ralib chiqadigan ustunlar
 *   totalLast — true bo'lsa, body'ning oxirgi qatori JAMI sifatida bezaladi
 *   diffCol   — "Farq" ustuni indeksi (0 → yashil, boshqasi → sariq)
 */
function makeStyledSheet({
  title, subtitle, header, body,
  widths = [], align = [], theme = "indigo",
  boldCols = [], wrapCols = [],
  totalLast = false, diffCol = -1,
}) {
  const th = XL_THEME[theme] || XL_THEME.indigo;
  const nCols = header.length;
  const aoa = [[title], [subtitle], [], header, ...body];
  const ws = XS.utils.aoa_to_sheet(aoa);

  ws["!cols"] = header.map((_, i) => ({ wch: widths[i] || 12 }));
  if (nCols > 1) {
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
    ];
  }
  ws["!rows"] = [
    { hpt: 32 }, { hpt: 17 }, { hpt: 6 }, { hpt: 26 },
    ...body.map(() => ({ hpt: 20 })),
  ];

  const lastRow = 3 + body.length;
  const totalRowIdx = totalLast ? lastRow : -1;

  for (let R = 0; R <= lastRow; R++) {
    for (let C = 0; C < nCols; C++) {
      const addr = XS.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      const cell = ws[addr];

      if (R === 0) {
        cell.s = {
          font: { name: "Calibri", sz: 15, bold: true, color: { rgb: "FFFFFF" } },
          fill: xlFill(th.accent),
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else if (R === 1) {
        cell.s = {
          font: { name: "Calibri", sz: 10, color: { rgb: "EDEBFF" } },
          fill: xlFill(th.accent),
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else if (R === 2) {
        // bo'sh ajratuvchi qator — stilsiz
      } else if (R === 3) {
        cell.s = {
          font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
          fill: xlFill(th.dark),
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: xlBorder(th.dark),
        };
      } else if (R === totalRowIdx) {
        cell.s = {
          font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
          fill: xlFill(th.dark),
          alignment: {
            horizontal: align[C] === "left" ? "left" : "center",
            vertical: "center",
          },
          border: xlBorder(th.dark),
        };
      } else {
        const s = {
          font: { name: "Calibri", sz: 10.5, color: { rgb: XL_TEXT } },
          alignment: {
            horizontal: align[C] || "center",
            vertical: "center",
            wrapText: wrapCols.includes(C) || undefined,
          },
          border: xlBorder(),
        };
        if ((R - 4) % 2 === 1) s.fill = xlFill(th.zebra);
        if (boldCols.includes(C)) s.font.bold = true;
        if (C === diffCol && typeof cell.v === "number") {
          s.font.bold = true;
          s.font.color = { rgb: cell.v === 0 ? "047857" : "B45309" };
        }
        cell.s = s;
      }
    }
  }

  return ws;
}

/** Shablon varag'iga oddiy stil: rangli sarlavha + ramkali qatorlar. */
function styleTemplateSheet(ws, nCols, nRows) {
  for (let R = 0; R < nRows; R++) {
    for (let C = 0; C < nCols; C++) {
      const addr = XS.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      if (R === 0) {
        ws[addr].s = {
          font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
          fill: xlFill(XL_THEME.indigo.accent),
          alignment: { horizontal: "center", vertical: "center" },
          border: xlBorder(XL_THEME.indigo.dark),
        };
      } else {
        ws[addr].s = {
          font: { name: "Calibri", sz: 10.5, color: { rgb: XL_TEXT } },
          alignment: { vertical: "center" },
          border: xlBorder(),
        };
        if (R % 2 === 0) ws[addr].s.fill = xlFill(XL_THEME.indigo.zebra);
      }
    }
  }
  ws["!rows"] = [{ hpt: 24 }];
}

function todayStr() {
  return new Date().toLocaleDateString("uz-UZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ---------------------------------------------------------------------
//  SHABLON YUKLAB OLISH (rangli sarlavha bilan)
// ---------------------------------------------------------------------
function downloadTemplate(type) {
  const wb = XS.utils.book_new();
  let aoa, cols;

  if (type === "teachers") {
    aoa = [
      ["№", "F.I.Sh.", "Fani", "Haftalik dars soati"],
      [1, "Aliyev Vali G'aniyevich", "Matematika", 24],
      [2, "Karimova Nodira Salimovna", "Ona tili", 20],
      [3, "Rahimov Sardor Bekovich", "Fizika", 18],
    ];
    cols = [{ wch: 5 }, { wch: 32 }, { wch: 20 }, { wch: 18 }];
  } else if (type === "setka") {
    aoa = [
      ["Fan", "1-A", "1-B", "5-A", "5-B", "9-A"],
      ["Matematika", 4, 4, 5, 5, 5],
      ["Ona tili", 6, 6, 4, 4, 3],
      ["Ingliz tili", 2, 2, 3, 3, 3],
      ["Fizika", "", "", "", "", 3],
    ];
    cols = [{ wch: 22 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 7 }];
  } else {
    aoa = [
      ["Sinf", "Kun", "Dars №", "Fan", "O'qituvchi", "Xona"],
      ["5-A", "Dushanba", 1, "Matematika", "Aliyev Vali G'aniyevich", "12-xona"],
      ["5-A", "Dushanba", 2, "Ona tili", "Karimova Nodira Salimovna", "8-xona"],
      ["5-A", "Seshanba", 1, "Fizika", "Rahimov Sardor Bekovich", "Fizika labi"],
    ];
    cols = [{ wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 32 }, { wch: 14 }];
  }

  const ws = XS.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols;
  styleTemplateSheet(ws, aoa[0].length, aoa.length);
  XS.utils.book_append_sheet(wb, ws, "Shablon");
  XS.writeFile(wb, TYPES[type].file);
}

// ---------------------------------------------------------------------
//  PARSERLAR — har biri { rows, classes?, errors } qaytaradi
// ---------------------------------------------------------------------
function cellStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}
function cellNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseTeachers(aoa) {
  const rows = [];
  const errors = [];
  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const name = cellStr(r[1]);
    if (!name) continue;
    // Sarlavha qatorini tashlab ketamiz
    if (/f\.?\s*i\.?\s*sh/i.test(name)) continue;
    rows.push({ name, subject: cellStr(r[2]), hours: cellNum(r[3]) });
  }
  if (rows.length === 0) errors.push("Ustozlar topilmadi — 2-ustunda F.I.Sh. bo'lishi kerak");
  return { rows, errors };
}

function parseSetka(aoa) {
  const errors = [];
  if (!aoa.length) return { rows: [], classes: [], errors: ["Fayl bo'sh"] };

  // Sarlavha qatori: birinchi katak — "Fan", qolganlari — sinf nomlari
  const header = aoa[0] || [];
  const classes = [];
  const classCols = []; // ustun indekslari
  for (let c = 1; c < header.length; c++) {
    const cls = cellStr(header[c]);
    if (cls) {
      classes.push(cls);
      classCols.push(c);
    }
  }
  if (classes.length === 0) {
    errors.push("Sinf ustunlari topilmadi — 1-qatorda \"Fan\" dan keyin sinf nomlari bo'lishi kerak (1-A, 1-B, ...)");
    return { rows: [], classes: [], errors };
  }

  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const subject = cellStr(r[0]);
    if (!subject) continue;
    const hours = {};
    let any = false;
    for (let k = 0; k < classCols.length; k++) {
      const h = cellNum(r[classCols[k]]);
      if (h > 0) {
        hours[classes[k]] = h;
        any = true;
      }
    }
    if (any) rows.push({ subject, hours });
  }
  if (rows.length === 0) errors.push("Fan qatorlari topilmadi yoki barcha soatlar bo'sh");
  return { rows, classes, errors };
}

function normDay(v) {
  const s = cellStr(v).toLowerCase();
  for (const d of DAYS) {
    if (s.startsWith(d.slice(0, 4).toLowerCase())) return d;
  }
  return cellStr(v);
}

function parseJadval(aoa) {
  const rows = [];
  const errors = [];
  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const klass = cellStr(r[0]);
    const subject = cellStr(r[3]);
    if (!klass || !subject) continue;
    if (/^sinf$/i.test(klass)) continue; // sarlavha
    rows.push({
      klass,
      day: normDay(r[1]),
      no: cellNum(r[2]),
      subject,
      teacher: cellStr(r[4]),
      room: cellStr(r[5]), // ixtiyoriy — eski fayllarda bo'lmasa bo'sh qoladi
    });
  }
  if (rows.length === 0) errors.push("Dars qatorlari topilmadi — Sinf va Fan ustunlari to'ldirilishi kerak");
  return { rows, errors };
}

const PARSERS = { teachers: parseTeachers, setka: parseSetka, jadval: parseJadval };

function readWorkbookFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }));
      } catch (e) {
        reject(new Error("Excel faylni o'qib bo'lmadi — .xlsx formatda ekanini tekshiring"));
      }
    };
    reader.onerror = () => reject(new Error("Faylni o'qishda xatolik"));
    reader.readAsArrayBuffer(file);
  });
}

function fmtShort(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" })
    + " " + d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

// =====================================================================
//  EXCEL MA'LUMOTLAR SAHIFASI
// =====================================================================
export function ExcelDataPage({ schools, addToast, districtId }) {
  const [schoolId, setSchoolId] = useState("");
  const [store, setStore] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // "teachers" | "setka" | "jadval"
  const [legacy, setLegacy] = useState(loadLegacyStore);

  useEffect(() => {
    (async () => {
      try {
        setStore(await fetchExcelStore());
      } catch (e) {
        addToast(e.message, "warning");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const school = schools.find((s) => s.id === schoolId) || null;
  const data = (schoolId && store[schoolId]) || {};
  const legacyN = useMemo(() => legacyCount(legacy), [legacy]);

  async function handleUpload(type, file) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const aoa = await readWorkbookFile(file);
      const parsed = PARSERS[type](aoa);
      if (parsed.errors.length && parsed.rows.length === 0) {
        addToast(parsed.errors[0], "warning");
        return;
      }
      await upsertExcelData({
        schoolId,
        districtId,
        type,
        fileName: file.name,
        rows: parsed.rows,
        classes: parsed.classes,
      });
      const next = { ...store };
      next[schoolId] = { ...(next[schoolId] || {}) };
      next[schoolId][type] = {
        fileName: file.name,
        uploadedAt: Date.now(),
        rows: parsed.rows,
        ...(parsed.classes ? { classes: parsed.classes } : {}),
      };
      setStore(next);
      addToast(`${TYPES[type].title}: ${parsed.rows.length} ta qator serverga saqlandi ✓`);
      if (parsed.errors.length) addToast(parsed.errors[0], "warning");
    } catch (e) {
      addToast(e.message, "warning");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(type) {
    if (busy) return;
    if (!window.confirm(`${TYPES[type].title} ma'lumotini serverdan o'chirasizmi?`)) return;
    setBusy(true);
    try {
      await deleteExcelData(schoolId, type);
      const next = { ...store };
      if (next[schoolId]) {
        next[schoolId] = { ...next[schoolId] };
        delete next[schoolId][type];
      }
      setStore(next);
      if (preview === type) setPreview(null);
      addToast("O'chirildi");
    } catch (e) {
      addToast(e.message, "warning");
    } finally {
      setBusy(false);
    }
  }

  // Eski brauzer (localStorage) ma'lumotlarini serverga bir marta ko'chirish
  async function migrateLegacy() {
    if (busy || legacyN === 0) return;
    if (!window.confirm(`Brauzerda saqlangan ${legacyN} ta eski yuklama serverga ko'chiriladi. Davom etasizmi?`)) return;
    setBusy(true);
    let ok = 0;
    try {
      const validIds = new Set(schools.map((s) => s.id));
      for (const sid of Object.keys(legacy)) {
        if (!validIds.has(sid)) continue; // ro'yxatda yo'q maktab — tashlab ketamiz
        for (const type of Object.keys(TYPES)) {
          const d = legacy[sid]?.[type];
          if (!d?.rows?.length) continue;
          await upsertExcelData({
            schoolId: sid,
            districtId,
            type,
            fileName: d.fileName || "localStorage",
            rows: d.rows,
            classes: d.classes,
          });
          ok++;
        }
      }
      localStorage.removeItem(LS_KEY);
      setLegacy({});
      setStore(await fetchExcelStore());
      addToast(`${ok} ta yuklama serverga ko'chirildi ✓`);
    } catch (e) {
      addToast(`${ok} ta ko'chirildi, so'ng xatolik: ${e.message}`, "warning");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="da-skel" style={{ height: 380 }} />;

  return (
    <>
      {legacyN > 0 && (
        <div className="da-card" style={{ border: "1.5px solid rgba(245,158,11,.4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220, fontSize: 13, lineHeight: 1.55 }}>
              📦 Shu brauzerda avvalgi versiyadan qolgan <b>{legacyN} ta</b> Excel yuklama topildi.
              Ularni serverga ko'chirsangiz, boshqa qurilmalardan ham ko'rinadi.
            </div>
            <button type="button" className="da-btn da-btn--primary" disabled={busy} onClick={migrateLegacy}>
              {busy ? "Ko'chirilmoqda..." : "📦 Serverga ko'chirish"}
            </button>
          </div>
        </div>
      )}

      <div className="da-card">
        <div className="da-card__title">📥 Excel ma'lumotlar yuklash</div>
        <div style={{ fontSize: 13, color: "var(--da-text-2)", marginBottom: 12, lineHeight: 1.6 }}>
          Avval shablonni yuklab oling, to'ldiring, so'ng shu yerga yuklang.
          Ma'lumotlar serverda saqlanadi va <b>Hisobotlar</b> bo'limida tuman kesimida jamlanadi.
        </div>
        <label className="da-label">Maktabni tanlang</label>
        <select
          className="da-select"
          style={{ maxWidth: 440 }}
          value={schoolId}
          onChange={(e) => { setSchoolId(e.target.value); setPreview(null); }}
        >
          <option value="">— Maktab —</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{s.schoolName}</option>
          ))}
        </select>
      </div>

      {!school ? (
        <div className="da-card">
          <div className="da-empty">
            <div className="da-empty__icon">🏫</div>
            <div className="da-empty__title">Maktab tanlanmagan</div>
            <div className="da-empty__text">Excel yuklash uchun yuqoridan maktabni tanlang.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="dax-grid">
            {Object.keys(TYPES).map((type) => {
              const t = TYPES[type];
              const d = data[type];
              return (
                <div key={type} className="da-card dax-card">
                  <div className="dax-card__head">
                    <span className="dax-card__icon">{t.icon}</span>
                    <div>
                      <div className="dax-card__title">{t.title}</div>
                      <div className="dax-card__desc">{t.desc}</div>
                    </div>
                  </div>

                  {d ? (
                    <div className="dax-status dax-status--ok">
                      ✓ {d.rows.length} ta qator · {fmtShort(d.uploadedAt)}
                      <div className="dax-status__file" title={d.fileName}>📄 {d.fileName}</div>
                    </div>
                  ) : (
                    <div className="dax-status">⏳ Hali yuklanmagan</div>
                  )}

                  <div className="dax-actions">
                    <button type="button" className="da-btn da-btn--ghost da-btn--sm" onClick={() => downloadTemplate(type)}>
                      📥 Shablon
                    </button>
                    <label className="da-btn da-btn--primary da-btn--sm dax-filelabel">
                      📤 {d ? "Qayta yuklash" : "Excel yuklash"}
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        style={{ display: "none" }}
                        onChange={(e) => { handleUpload(type, e.target.files[0]); e.target.value = ""; }}
                      />
                    </label>
                    {d && (
                      <>
                        <button
                          type="button"
                          className="da-btn da-btn--ghost da-btn--sm"
                          onClick={() => setPreview(preview === type ? null : type)}
                        >
                          👁 {preview === type ? "Yopish" : "Ko'rish"}
                        </button>
                        <button type="button" className="da-btn da-btn--warning da-btn--sm" onClick={() => handleDelete(type)}>
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {preview === "teachers" && data.teachers && <TeachersPreview d={data.teachers} />}
          {preview === "setka" && data.setka && <SetkaMatrix title="🕐 Dars soat setkasi" rows={data.setka.rows} classes={data.setka.classes} />}
          {preview === "jadval" && data.jadval && <JadvalViewer d={data.jadval} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
//  KO'RISH KOMPONENTLARI
// ---------------------------------------------------------------------
function TeachersPreview({ d }) {
  const total = d.rows.reduce((a, r) => a + r.hours, 0);
  return (
    <div className="da-card">
      <div className="da-card__title">👨‍🏫 Ustozlar ({d.rows.length} ta · jami {total} soat)</div>
      <div className="da-tablewrap">
        <table className="da-table">
          <thead>
            <tr><th>#</th><th>F.I.Sh.</th><th>Fani</th><th>Haftalik soati</th></tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><b>{r.name}</b></td>
                <td>{r.subject || "—"}</td>
                <td>{r.hours || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SetkaMatrix({ title, rows, classes, showTotals = true }) {
  const colTotal = {};
  let grand = 0;
  for (const r of rows) {
    for (const c of classes) {
      const h = r.hours[c] || 0;
      colTotal[c] = (colTotal[c] || 0) + h;
      grand += h;
    }
  }
  return (
    <div className="da-card">
      <div className="da-card__title">{title} · jami {grand} soat/hafta</div>
      <div className="da-tablewrap">
        <table className="da-table dax-matrix">
          <thead>
            <tr>
              <th className="dax-sticky">Fan</th>
              {classes.map((c) => <th key={c}>{c}</th>)}
              {showTotals && <th>Jami</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowSum = classes.reduce((a, c) => a + (r.hours[c] || 0), 0);
              return (
                <tr key={i}>
                  <td className="dax-sticky"><b>{r.subject}</b></td>
                  {classes.map((c) => (
                    <td key={c} style={{ textAlign: "center" }}>{r.hours[c] || ""}</td>
                  ))}
                  {showTotals && <td style={{ textAlign: "center" }}><b>{rowSum}</b></td>}
                </tr>
              );
            })}
            {showTotals && (
              <tr className="dax-total-row">
                <td className="dax-sticky"><b>Jami</b></td>
                {classes.map((c) => (
                  <td key={c} style={{ textAlign: "center" }}><b>{colTotal[c] || ""}</b></td>
                ))}
                <td style={{ textAlign: "center" }}><b>{grand}</b></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

//  Jadvalni uch kesimda ko'rsatadi: sinf / o'qituvchi / xona.
//  Xona kesimi faqat Excel'da "Xona" ustuni to'ldirilgan bo'lsa chiqadi.
//  Bitta katakda bir nechta dars bo'lishi mumkin (parallel/guruh) —
//  hammasi ketma-ket ko'rsatiladi.
const JADVAL_MODES = [
  { id: "klass",   field: "klass",   label: "🎓 Sinf",       select: "Sinfni tanlang" },
  { id: "teacher", field: "teacher", label: "👨‍🏫 O'qituvchi", select: "O'qituvchini tanlang" },
  { id: "room",    field: "room",    label: "🚪 Xona",       select: "Xonani tanlang" },
];

export function JadvalViewer({ d }) {
  const [mode, setMode] = useState("klass");
  const [entity, setEntity] = useState("");

  const hasRooms = useMemo(() => d.rows.some((r) => r.room), [d]);
  const modes = hasRooms ? JADVAL_MODES : JADVAL_MODES.filter((m) => m.id !== "room");
  const modeDef = modes.find((m) => m.id === mode) || modes[0];
  const field = modeDef.field;

  const entities = useMemo(() => {
    const set = new Set();
    for (const r of d.rows) {
      const v = r[field];
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => String(a).localeCompare(String(b), "uz", { numeric: true }));
  }, [d, field]);

  // Kesim yoki ma'lumot o'zgarganda birinchi elementga qaytamiz
  useEffect(() => {
    setEntity((prev) => (entities.includes(prev) ? prev : entities[0] || ""));
  }, [entities]);

  const grid = useMemo(() => {
    const rows = d.rows.filter((r) => r[field] === entity);
    const days = DAYS.filter((day) => rows.some((r) => r.day === day));
    const extraDays = [...new Set(rows.map((r) => r.day).filter((day) => !DAYS.includes(day)))];
    const allDays = [...days, ...extraDays];
    const maxNo = Math.max(1, ...rows.map((r) => r.no || 0));
    const cell = {};
    for (const r of rows) {
      const key = `${r.day}|${r.no}`;
      if (!cell[key]) cell[key] = [];
      cell[key].push(r);
    }
    return { allDays, maxNo, cell, count: rows.length };
  }, [d, field, entity]);

  function cellLines(r) {
    // Tanlangan kesimga qarab qo'shimcha satrlar
    if (field === "klass") {
      return [r.teacher, r.room && `🚪 ${r.room}`].filter(Boolean);
    }
    if (field === "teacher") {
      return [r.klass && `🎓 ${r.klass}`, r.room && `🚪 ${r.room}`].filter(Boolean);
    }
    return [r.klass && `🎓 ${r.klass}`, r.teacher].filter(Boolean);
  }

  return (
    <div className="da-card">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div className="da-card__title" style={{ margin: 0 }}>📅 Dars jadvali</div>
        <div className="da-tabs" style={{ marginBottom: 0 }}>
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`da-tab ${modeDef.id === m.id ? "da-tab--active" : ""}`}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <select
          className="da-select"
          style={{ maxWidth: 240 }}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          {entities.length === 0 && <option value="">— {modeDef.select} —</option>}
          {entities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: "var(--da-text-2)" }}>
          {grid.count} ta dars · jami {d.rows.length} ta
        </span>
      </div>
      {!hasRooms && (
        <div style={{ fontSize: 12, color: "var(--da-text-2)", marginBottom: 10 }}>
          ℹ️ Xonalar kesimi uchun Excel faylda "Xona" ustunini (6-ustun) to'ldirib, qayta yuklang.
        </div>
      )}
      {entities.length === 0 ? (
        <div className="da-empty">
          <div className="da-empty__icon">📅</div>
          <div className="da-empty__title">Bu kesimda ma'lumot yo'q</div>
          <div className="da-empty__text">Excel faylda tegishli ustun to'ldirilmagan.</div>
        </div>
      ) : (
        <div className="da-tablewrap">
          <table className="da-table dax-matrix">
            <thead>
              <tr>
                <th className="dax-sticky">№</th>
                {grid.allDays.map((day) => <th key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: grid.maxNo }, (_, i) => i + 1).map((no) => (
                <tr key={no}>
                  <td className="dax-sticky"><b>{no}</b></td>
                  {grid.allDays.map((day) => {
                    const list = grid.cell[`${day}|${no}`] || [];
                    return (
                      <td key={day}>
                        {list.map((r, i) => (
                          <div key={i} style={i > 0 ? { marginTop: 5, paddingTop: 5, borderTop: "1px dashed var(--da-border, #e2e8f0)" } : undefined}>
                            <b>{r.subject}</b>
                            {cellLines(r).map((line, j) => (
                              <div key={j} className="dax-teacher">{line}</div>
                            ))}
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =====================================================================
//  MAKTABNING AVTOMATIK SINXRONLANGAN MA'LUMOTINI O'GIRISH
//
//  Maktab o'z tizimida jadval tuzsa, cloudSync uni `schools.data`
//  blob'iga yozadi (schedule, timeslots, classes, subjects, teachers,
//  rooms, classSubjects). Bu funksiya o'sha xom blob'ni Excel yuklama
//  bilan BIR XIL shaklga keltiradi — shunda JadvalViewer, SetkaMatrix,
//  TeacherHoursTable va exportSchoolExcel hech o'zgarishsiz ishlaydi.
//
//  Qaytaradi: { jadval, setka, teachers } — bo'sh bo'limlar null.
// =====================================================================
export function buildAutoExcelData(d) {
  if (!d || typeof d !== "object") return null;

  const classes = Array.isArray(d.classes) ? d.classes : [];
  const subjects = Array.isArray(d.subjects) ? d.subjects : [];
  const teachers = Array.isArray(d.teachers) ? d.teachers : [];
  const rooms = Array.isArray(d.rooms) ? d.rooms : [];
  const timeslots = Array.isArray(d.timeslots) ? d.timeslots : [];
  const schedule = d.schedule && typeof d.schedule === "object" ? d.schedule : {};
  const classSubjects = d.classSubjects && typeof d.classSubjects === "object" ? d.classSubjects : {};

  const clsName = new Map(classes.map((c) => [c.id, c.name]));
  const subjName = new Map(subjects.map((s) => [s.id, s.name]));
  const tchName = new Map(teachers.map((t) => [t.id, t.name]));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const tsById = new Map(timeslots.map((ts) => [ts.id, ts]));

  // ---------- 1) Dars jadvali (uzun format) ----------
  const jadvalRows = [];
  for (const day of Object.keys(schedule)) {
    const slots = schedule[day];
    if (!slots || typeof slots !== "object") continue;
    for (const tsId of Object.keys(slots)) {
      const cell = slots[tsId];
      if (!Array.isArray(cell)) continue;
      const ts = tsById.get(tsId);
      const no = Number(ts?.lessonNumber || 0);
      for (const l of cell) {
        if (!l || !l.subjectId) continue;
        const base = subjName.get(l.subjectId) || "Fan";
        const alt = l.alternating && l.altSubjectId ? subjName.get(l.altSubjectId) : "";
        let label = alt ? `${base} / ${alt}` : base;
        if (l.groupPart || l.groupName) label += ` (${l.groupPart || l.groupName})`;
        const teacher = tchName.get(l.teacherId) || "";
        const room = roomName.get(l.roomId) || "";
        const ids = Array.isArray(l.classIds) && l.classIds.length
          ? l.classIds
          : [l.classId].filter(Boolean);
        for (const cid of ids) {
          const klass = clsName.get(cid);
          if (!klass) continue;
          jadvalRows.push({ klass, day, no, subject: label, teacher, room });
        }
      }
    }
  }
  const dayIdx = (day) => { const i = DAYS.indexOf(day); return i === -1 ? 99 : i; };
  jadvalRows.sort((a, b) =>
    String(a.klass).localeCompare(String(b.klass), "uz", { numeric: true })
    || (dayIdx(a.day) - dayIdx(b.day))
    || (a.no - b.no)
  );

  // ---------- 2) Sinf-fan soatlari (classSubjects'dan setka) ----------
  const setkaClasses = classes
    .map((c) => c.name)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), "uz", { numeric: true }));
  const bySubject = new Map(); // fan nomi -> { subject, hours: { sinf: soat } }
  for (const c of classes) {
    const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
    for (const a of list) {
      const add = (sid, h) => {
        const nm = subjName.get(sid);
        if (!nm || !h) return;
        if (!bySubject.has(nm)) bySubject.set(nm, { subject: nm, hours: {} });
        const row = bySubject.get(nm);
        row.hours[c.name] = (row.hours[c.name] || 0) + h;
      };
      const h = Number(a.weeklyHours || 0);
      add(a.subjectId, h);
      if (a.swapEnabled && a.swapSubjectId) add(a.swapSubjectId, h);
      if (a.pairEnabled && a.pairSubjectId) add(a.pairSubjectId, h);
    }
  }
  const setkaRows = [...bySubject.values()]
    .sort((a, b) => a.subject.localeCompare(b.subject, "uz"));

  // ---------- 3) O'qituvchilar (biriktirilgan haftalik soat bilan) ----------
  // Biriktirilgan soat = Sinf fanlari bo'limida shu ustozga berilgan
  // haftalik soatlar yig'indisi (oddiy + bo'lingan guruh + daraja guruhi).
  const declared = new Map(); // teacherId -> soat
  const addDecl = (tid, h) => {
    if (!tid || !h) return;
    declared.set(tid, (declared.get(tid) || 0) + h);
  };
  for (const c of classes) {
    const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
    for (const a of list) {
      const h = Number(a.weeklyHours || 0);
      if (a.levelGroupEnabled && Array.isArray(a.levelGroups) && a.levelGroups.length) {
        for (const g of a.levelGroups) addDecl(g.teacherId, h);
      } else {
        addDecl(a.teacherId, h);
        addDecl(a.teacherId2, h);
      }
    }
  }
  const teachersRows = teachers
    .filter((t) => t?.name)
    .map((t) => {
      const sids = Array.isArray(t.subjectIds) ? t.subjectIds : (t.subjectId ? [t.subjectId] : []);
      const subj = sids.map((sid) => subjName.get(sid)).filter(Boolean).join(", ");
      return { name: t.name, subject: subj, hours: declared.get(t.id) || 0 };
    });

  return {
    jadval: jadvalRows.length ? { rows: jadvalRows } : null,
    setka: setkaRows.length ? { rows: setkaRows, classes: setkaClasses } : null,
    teachers: teachersRows.length ? { rows: teachersRows } : null,
  };
}

// =====================================================================
//  O'QITUVCHI HAFTALIK SOATLARI
//
//  Ikki manbani birlashtiradi:
//    - teachers (Excel'da e'lon qilingan haftalik soat)
//    - jadval   (jadvaldan hisoblangan haqiqiy soat, kunlar kesimida)
//  Ism bo'yicha moslashtiradi (katta-kichik harf va ortiqcha
//  bo'shliqlarga sezgir emas). Ikkalasi ham bo'lsa — farqni ko'rsatadi.
// =====================================================================
export function computeTeacherHours(teachers, jadval) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const map = new Map();
  const daySet = new Set();

  if (teachers?.rows) {
    for (const t of teachers.rows) {
      const k = norm(t.name);
      if (!k) continue;
      map.set(k, {
        name: t.name,
        subject: t.subject || "",
        declared: t.hours || 0,
        actual: 0,
        classes: new Set(),
        days: {},
        inExcel: true,
      });
    }
  }

  if (jadval?.rows) {
    for (const r of jadval.rows) {
      const k = norm(r.teacher);
      if (!k) continue;
      if (!map.has(k)) {
        map.set(k, {
          name: r.teacher, subject: "", declared: 0, actual: 0,
          classes: new Set(), days: {}, inExcel: false,
        });
      }
      const t = map.get(k);
      t.actual++;
      if (r.klass) t.classes.add(r.klass);
      if (!t.subject && r.subject) t.subject = r.subject;
      if (r.day) {
        t.days[r.day] = (t.days[r.day] || 0) + 1;
        daySet.add(r.day);
      }
    }
  }

  const list = [...map.values()]
    .map((t) => ({ ...t, classes: [...t.classes] }))
    .sort((a, b) => (b.actual - a.actual) || (b.declared - a.declared) || a.name.localeCompare(b.name));

  const usedDays = [
    ...DAYS.filter((d) => daySet.has(d)),
    ...[...daySet].filter((d) => !DAYS.includes(d)),
  ];

  return { list, usedDays };
}

export function TeacherHoursTable({ teachers, jadval, title = "👨‍🏫 O'qituvchi haftalik soatlari", declaredLabel = "Excel soati" }) {
  const hasDeclared = !!teachers?.rows?.length;
  const hasJadval = !!jadval?.rows?.length;

  const { list, usedDays } = useMemo(
    () => computeTeacherHours(teachers, jadval),
    [teachers, jadval]
  );

  if (list.length === 0) return null;

  const totalDeclared = list.reduce((a, r) => a + r.declared, 0);
  const totalActual = list.reduce((a, r) => a + r.actual, 0);
  const showDiff = hasDeclared && hasJadval;

  return (
    <div className="da-card">
      <div className="da-card__title">
        {title} · {list.length} ta o'qituvchi
        {hasDeclared && <> · {declaredLabel}: {totalDeclared}</>}
        {hasJadval && <> · Jadvalda: {totalActual} soat</>}
      </div>
      {showDiff && (
        <div style={{ fontSize: 12.5, color: "var(--da-text-2)", marginBottom: 10, lineHeight: 1.55 }}>
          "Farq" ustuni: jadvaldagi haqiqiy soat − {declaredLabel.toLowerCase()}.
          <b style={{ color: "#059669" }}> ✓</b> — mos,
          <b style={{ color: "#b45309" }}> ±</b> — mos emas (tekshirish tavsiya etiladi).
        </div>
      )}
      <div className="da-tablewrap">
        <table className="da-table dax-matrix">
          <thead>
            <tr>
              <th className="dax-sticky">#</th>
              <th>F.I.Sh.</th>
              <th>Fani</th>
              {hasDeclared && <th>{declaredLabel}</th>}
              {hasJadval && <th>Jadvalda</th>}
              {showDiff && <th>Farq</th>}
              {hasJadval && usedDays.map((d) => <th key={d}>{DAY_SHORT[d] || d}</th>)}
              {hasJadval && <th>Sinflar</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((t, i) => {
              const diff = t.actual - t.declared;
              return (
                <tr key={i}>
                  <td className="dax-sticky">{i + 1}</td>
                  <td>
                    <b>{t.name}</b>
                    {showDiff && !t.inExcel && (
                      <div style={{ fontSize: 11, color: "#b45309" }}>⚠️ Ro'yxatda yo'q</div>
                    )}
                  </td>
                  <td>{t.subject || "—"}</td>
                  {hasDeclared && <td style={{ textAlign: "center" }}>{t.declared || "—"}</td>}
                  {hasJadval && <td style={{ textAlign: "center" }}><b>{t.actual || "—"}</b></td>}
                  {showDiff && (
                    <td style={{ textAlign: "center", fontWeight: 800, color: diff === 0 ? "#059669" : "#b45309" }}>
                      {diff === 0 ? "✓" : (diff > 0 ? `+${diff}` : diff)}
                    </td>
                  )}
                  {hasJadval && usedDays.map((d) => (
                    <td key={d} style={{ textAlign: "center" }}>{t.days[d] || ""}</td>
                  ))}
                  {hasJadval && (
                    <td style={{ fontSize: 12, maxWidth: 220, whiteSpace: "normal" }}>
                      {t.classes.length ? t.classes.join(", ") : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
//  MAKTAB HISOBOTINI EXCEL'GA EKSPORT (RANGLI, STILLI)
//
//  Bitta maktabning barcha ma'lumotlarini bitta .xlsx faylga yig'adi:
//    1-varaq: Dars jadvali (uzun format)          — indigo
//    2-varaq: Sinf-fan soatlari (setka, jamilar)  — teal
//    3-varaq: O'qituvchi haftalik soatlari        — binafsha
//
//  Har varaqda: maktab nomi banner, sana, rangli sarlavhalar,
//  zebra qatorlar, ramkalar va JAMI qatori.
// =====================================================================
export function exportSchoolExcel(schoolName, data, opts = {}) {
  const declaredLabel = opts.declaredLabel || "Excel soati";
  const wb = XS.utils.book_new();
  const name = String(schoolName || "Maktab");
  const stamp = `smartjadval · Tuman hisoboti · ${todayStr()}`;
  let sheets = 0;

  // ---------- 1-varaq: Dars jadvali ----------
  if (data?.jadval?.rows?.length) {
    const ws = makeStyledSheet({
      title: `📅 ${name} — DARS JADVALI`,
      subtitle: stamp,
      header: ["Sinf", "Kun", "Dars №", "Fan", "O'qituvchi", "Xona"],
      body: data.jadval.rows.map((r) => [
        r.klass, r.day, r.no, r.subject, r.teacher || "", r.room || "",
      ]),
      widths: [9, 13, 8, 24, 32, 15],
      align: ["center", "left", "center", "left", "left", "left"],
      boldCols: [0, 3],
      theme: "indigo",
    });
    XS.utils.book_append_sheet(wb, ws, "Jadval");
    sheets++;
  }

  // ---------- 2-varaq: Sinf-fan soatlari (setka) ----------
  if (data?.setka?.rows?.length) {
    const classes = data.setka.classes || [];
    const colTotal = {};
    let grand = 0;
    const body = data.setka.rows.map((r) => {
      let rowSum = 0;
      const cells = classes.map((c) => {
        const h = r.hours[c] || 0;
        rowSum += h;
        colTotal[c] = (colTotal[c] || 0) + h;
        grand += h;
        return h || "";
      });
      return [r.subject, ...cells, rowSum];
    });
    body.push(["JAMI", ...classes.map((c) => colTotal[c] || ""), grand]);

    const ws = makeStyledSheet({
      title: `🕐 ${name} — SINF-FAN SOATLARI`,
      subtitle: stamp,
      header: ["Fan", ...classes, "Jami"],
      body,
      widths: [24, ...classes.map(() => 7), 8],
      align: ["left", ...classes.map(() => "center"), "center"],
      boldCols: [0, classes.length + 1],
      theme: "teal",
      totalLast: true,
    });
    XS.utils.book_append_sheet(wb, ws, "Soat setkasi");
    sheets++;
  }

  // ---------- 3-varaq: O'qituvchi soatlari ----------
  const { list, usedDays } = computeTeacherHours(data?.teachers, data?.jadval);
  if (list.length) {
    const totDecl = list.reduce((a, t) => a + t.declared, 0);
    const totAct = list.reduce((a, t) => a + t.actual, 0);
    const dayTotals = usedDays.map((d) =>
      list.reduce((a, t) => a + (t.days[d] || 0), 0) || ""
    );

    const body = list.map((t, i) => [
      i + 1, t.name, t.subject || "", t.declared || "", t.actual || "",
      t.actual - t.declared,
      ...usedDays.map((d) => t.days[d] || ""),
      t.classes.join(", "),
    ]);
    body.push(["", "JAMI", "", totDecl, totAct, totAct - totDecl, ...dayTotals, ""]);

    const ws = makeStyledSheet({
      title: `👨‍🏫 ${name} — O'QITUVCHI HAFTALIK SOATLARI`,
      subtitle: stamp,
      header: ["№", "F.I.Sh.", "Fani", declaredLabel, "Jadvalda", "Farq",
        ...usedDays.map((d) => DAY_SHORT[d] || d), "Sinflar"],
      body,
      widths: [5, 32, 18, 13, 11, 7, ...usedDays.map(() => 6), 30],
      align: ["center", "left", "left", "center", "center", "center",
        ...usedDays.map(() => "center"), "left"],
      boldCols: [1],
      wrapCols: [6 + usedDays.length],
      theme: "violet",
      totalLast: true,
      diffCol: 5,
    });
    XS.utils.book_append_sheet(wb, ws, "O'qituvchi soatlari");
    sheets++;
  }

  if (!sheets) return false;

  const safe = String(schoolName || "maktab")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 60) || "maktab";
  XS.writeFile(wb, `${safe}_hisobot.xlsx`);
  return true;
}

// =====================================================================
//  HISOBOTLAR SAHIFASI
// =====================================================================
export function ReportsPage({ schools }) {
  const [store, setStore] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [schoolId, setSchoolId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setStore(await fetchExcelStore());
      } catch (e) {
        setLoadError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const agg = useMemo(() => {
    let uploadedSchools = 0;
    let totalHours = 0;
    let totalTeachers = 0;
    const classSet = new Set();
    const bySubject = {}; // fan -> jami soat
    const perSchool = [];

    for (const s of schools) {
      const d = store[s.id];
      if (!d || (!d.teachers && !d.setka && !d.jadval)) continue;
      uploadedSchools++;

      let schoolHours = 0;
      let schoolClasses = 0;
      if (d.setka) {
        schoolClasses = d.setka.classes.length;
        for (const c of d.setka.classes) classSet.add(`${s.id}|${c}`);
        for (const r of d.setka.rows) {
          for (const c of d.setka.classes) {
            const h = r.hours[c] || 0;
            schoolHours += h;
            if (h > 0) bySubject[r.subject] = (bySubject[r.subject] || 0) + h;
          }
        }
      }
      totalHours += schoolHours;
      const tCount = d.teachers ? d.teachers.rows.length : 0;
      totalTeachers += tCount;

      perSchool.push({
        id: s.id,
        name: s.schoolName,
        teachers: tCount,
        classes: schoolClasses,
        hours: schoolHours,
        jadvalRows: d.jadval ? d.jadval.rows.length : 0,
        updatedAt: Math.max(
          d.teachers?.uploadedAt || 0,
          d.setka?.uploadedAt || 0,
          d.jadval?.uploadedAt || 0
        ),
      });
    }

    perSchool.sort((a, b) => b.hours - a.hours);
    const subjectList = Object.entries(bySubject)
      .map(([subject, hours]) => ({ subject, hours }))
      .sort((a, b) => b.hours - a.hours);

    return {
      uploadedSchools,
      totalHours,
      totalTeachers,
      totalClasses: classSet.size,
      perSchool,
      subjectList,
    };
  }, [schools, store]);

  const selSchool = schools.find((s) => s.id === schoolId);
  const selData = (schoolId && store[schoolId]) || null;
  const selSetka = selData?.setka;

  // Tuman kesimidagi jamlanma hisobot — rangli, stilli Excel
  function exportReport() {
    const wb = XS.utils.book_new();
    const stamp = `smartjadval · Tuman jamlanma hisoboti · ${todayStr()}`;

    const body1 = agg.perSchool.map((r) => [
      r.name, r.teachers, r.classes, r.hours, r.jadvalRows,
    ]);
    body1.push(["JAMI", agg.totalTeachers, agg.totalClasses, agg.totalHours, ""]);
    const ws1 = makeStyledSheet({
      title: "🏫 TUMAN MAKTABLARI HISOBOTI",
      subtitle: stamp,
      header: ["Maktab", "Ustozlar", "Sinflar", "Haftalik jami soat", "Jadval darslari"],
      body: body1,
      widths: [36, 10, 9, 18, 15],
      align: ["left", "center", "center", "center", "center"],
      boldCols: [0, 3],
      theme: "indigo",
      totalLast: true,
    });
    XS.utils.book_append_sheet(wb, ws1, "Maktablar");

    const totalSubjHours = agg.subjectList.reduce((a, r) => a + r.hours, 0);
    const body2 = agg.subjectList.map((r) => [r.subject, r.hours]);
    body2.push(["JAMI", totalSubjHours]);
    const ws2 = makeStyledSheet({
      title: "📚 FANLAR BO'YICHA TUMAN SOATLARI",
      subtitle: stamp,
      header: ["Fan", "Tuman bo'yicha jami haftalik soat"],
      body: body2,
      widths: [28, 32],
      align: ["left", "center"],
      boldCols: [0],
      theme: "teal",
      totalLast: true,
    });
    XS.utils.book_append_sheet(wb, ws2, "Fanlar");

    XS.writeFile(wb, "tuman_hisobot.xlsx");
  }

  if (loading) {
    return (
      <>
        <div className="da-kpis">
          {[0, 1, 2, 3].map((i) => <div key={i} className="da-skel" style={{ height: 82 }} />)}
        </div>
        <div className="da-skel" style={{ height: 300 }} />
      </>
    );
  }

  if (loadError) {
    return (
      <div className="da-card">
        <div className="da-empty">
          <div className="da-empty__icon">⚠️</div>
          <div className="da-empty__title">Ma'lumotlarni yuklab bo'lmadi</div>
          <div className="da-empty__text">{loadError}</div>
        </div>
      </div>
    );
  }

  if (agg.uploadedSchools === 0) {
    return (
      <div className="da-card">
        <div className="da-empty">
          <div className="da-empty__icon">📈</div>
          <div className="da-empty__title">Hisobot uchun ma'lumot yo'q</div>
          <div className="da-empty__text">
            Avval "📥 Excel ma'lumotlar" bo'limida maktablar uchun dars soat setkasi va
            ustozlar ro'yxatini yuklang — hisobotlar shu yerda avtomatik jamlanadi.
          </div>
        </div>
      </div>
    );
  }

  const KPIS = [
    { icon: "🏫", label: "Ma'lumot yuklangan maktablar", value: agg.uploadedSchools, bg: "rgba(37,99,235,.13)" },
    { icon: "📚", label: "Tuman jami haftalik soat", value: agg.totalHours, bg: "rgba(168,85,247,.13)" },
    { icon: "👨‍🏫", label: "Jami ustozlar (Excel)", value: agg.totalTeachers, bg: "rgba(99,102,241,.13)" },
    { icon: "🎓", label: "Jami sinflar (setka)", value: agg.totalClasses, bg: "rgba(14,165,233,.13)" },
  ];

  const maxSubj = Math.max(1, ...agg.subjectList.map((r) => r.hours));

  return (
    <>
      <div className="da-kpis">
        {KPIS.map((k, i) => (
          <div key={i} className="da-kpi" style={{ animationDelay: `${i * 45}ms` }}>
            <div className="da-kpi__icon" style={{ background: k.bg }}>{k.icon}</div>
            <div>
              <div className="da-kpi__value">{k.value}</div>
              <div className="da-kpi__label">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="da-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div className="da-card__title" style={{ margin: 0 }}>🏫 Maktablar kesimida</div>
          <button type="button" className="da-btn da-btn--primary da-btn--sm" style={{ marginLeft: "auto" }} onClick={exportReport}>
            📤 Excel eksport
          </button>
        </div>
        <div className="da-tablewrap">
          <table className="da-table">
            <thead>
              <tr>
                <th>Maktab</th>
                <th>Ustozlar</th>
                <th>Sinflar</th>
                <th>Haftalik jami soat</th>
                <th>Jadval darslari</th>
                <th>Oxirgi yuklash</th>
              </tr>
            </thead>
            <tbody>
              {agg.perSchool.map((r) => (
                <tr key={r.id} className="da-row-click" onClick={() => setSchoolId(r.id)}>
                  <td><b>{r.name}</b></td>
                  <td>{r.teachers || "—"}</td>
                  <td>{r.classes || "—"}</td>
                  <td><b>{r.hours || "—"}</b></td>
                  <td>{r.jadvalRows || "—"}</td>
                  <td>{fmtShort(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="da-card">
        <div className="da-card__title">📚 Fanlar bo'yicha tuman jami soatlari</div>
        {agg.subjectList.map((r) => (
          <div key={r.subject} className="da-bar-row">
            <div className="da-bar-name" title={r.subject}>{r.subject}</div>
            <div className="da-bar-track">
              <div className="da-bar-fill" style={{ width: `${(r.hours / maxSubj) * 100}%` }} />
            </div>
            <div className="da-bar-val">{r.hours}</div>
          </div>
        ))}
      </div>

      <div className="da-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div className="da-card__title" style={{ margin: 0 }}>🎓 Maktab kesimida batafsil</div>
          <select className="da-select" style={{ maxWidth: 340 }} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">— Maktabni tanlang —</option>
            {agg.perSchool.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        {!selData ? (
          <div className="da-empty">
            <div className="da-empty__icon">🕐</div>
            <div className="da-empty__title">Maktab tanlanmagan</div>
            <div className="da-empty__text">Maktabni tanlang — sinf-fan soatlari, o'qituvchi haftalik soatlari va dars jadvali shu yerda ko'rinadi.</div>
          </div>
        ) : (
          <>
            {selSetka && (
              <SetkaMatrix
                title={`🕐 ${selSchool?.schoolName || ""} — sinf-fan soatlari`}
                rows={selSetka.rows}
                classes={selSetka.classes}
              />
            )}
            <TeacherHoursTable
              teachers={selData.teachers}
              jadval={selData.jadval}
              title={`👨‍🏫 ${selSchool?.schoolName || ""} — o'qituvchi soatlari`}
            />
            {selData.jadval?.rows?.length ? <JadvalViewer d={selData.jadval} /> : null}
          </>
        )}
      </div>
    </>
  );
}
