import { useMemo, useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import SaveScheduleModal from "../components/SaveScheduleModal";
import { DAYS } from "../utils/constants";
import { genId } from "../utils/helpers";
import { exportColoredSchedule } from "../utils/coloredScheduleExport";
import { countLessons, describeSaved, upsertSaved, MAX_SAVED } from "../utils/savedSchedules";

// =====================================================================
//  SAQLANGAN DARS JADVALLARI
//
//  "Dars jadvali" sahifasidagi «💾 Saqlash» tugmasi jadvalning nusxasini
//  nom bilan shu ro'yxatga qo'shadi. Bu yerdan har qanday nusxani qayta
//  YUKLASH (joriy jadval o'rniga qo'yish), nomini o'zgartirish, Excel'ga
//  chiqarish yoki o'chirish mumkin.
//
//  Nusxa `savedSchedules` kalitida yotadi — u ham boshqa ma'lumotlar
//  kabi localStorage va bulut bilan sinxronlanadi (cloudSync SYNC_KEYS).
// =====================================================================

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SavedSchedulesPage({
  savedSchedules = [],
  setSavedSchedules,
  schedule = {},
  setSchedule,
  classes = [],
  subjects = [],
  teachers = [],
  rooms = [],
  timeslots = [],
  lunchGroups = [],
  settings = {},
  setActivePage,
  toast,
}) {
  const [renameItem, setRenameItem] = useState(null);   // { id, name }
  const [renameText, setRenameText] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [loadItem, setLoadItem] = useState(null);       // yuklash tasdig'i
  const [preview, setPreview] = useState(null);         // ko'rish oynasi
  const [saveOpen, setSaveOpen] = useState(false);      // saqlash oynasi

  const list = useMemo(() => (
    [...savedSchedules].sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    ))
  ), [savedSchedules]);

  const currentLessons = countLessons(schedule);

  // ——— Joriy jadvalni saqlash (yangi nusxa yoki mavjudini yangilash) ———
  function handleSave(name, overwriteId) {
    if (!setSavedSchedules) return;
    setSavedSchedules(upsertSaved(savedSchedules, { name, overwriteId, schedule, classes }));
    setSaveOpen(false);
    toast?.(overwriteId ? `«${name}» yangilandi ✓` : `«${name}» saqlandi ✓`, "success");
  }

  // ——— Saqlangan nusxani joriy jadval o'rniga qo'yish ———
  function applyLoad() {
    if (!loadItem || !setSchedule) return;
    setSchedule(JSON.parse(JSON.stringify(loadItem.schedule || {})));
    setLoadItem(null);
    toast?.(`«${loadItem.name}» yuklandi ✓`, "success");
    setActivePage?.("schedule");
  }

  // ——— Joriy jadvalni shu nusxa ustiga yozish ———
  function overwrite(item) {
    if (!setSavedSchedules) return;
    if (!currentLessons) {
      toast?.("Joriy jadval bo'sh — saqlashga narsa yo'q", "warning");
      return;
    }
    if (!confirm(`«${item.name}» joriy jadval bilan almashtirilsinmi? Eski nusxa yo'qoladi.`)) return;
    setSavedSchedules(upsertSaved(savedSchedules, {
      name: item.name, overwriteId: item.id, schedule, classes,
    }));
    toast?.(`«${item.name}» yangilandi ✓`, "success");
  }

  function duplicate(item) {
    if (!setSavedSchedules) return;
    if (savedSchedules.length >= MAX_SAVED) {
      toast?.(`Ko'pi bilan ${MAX_SAVED} ta jadval saqlanadi`, "warning");
      return;
    }
    const now = new Date().toISOString();
    setSavedSchedules([...savedSchedules, {
      ...item,
      id: genId(),
      name: `${item.name} (nusxa)`,
      createdAt: now,
      updatedAt: now,
      schedule: JSON.parse(JSON.stringify(item.schedule || {})),
    }]);
    toast?.("Nusxa yaratildi ✓", "success");
  }

  function openRename(item) {
    setRenameItem(item);
    setRenameText(item.name);
  }

  function applyRename() {
    const clean = renameText.trim();
    if (!clean || !renameItem) return;
    // `updatedAt` ga tegilmaydi — u jadval MAZMUNI qachon yangilanganini
    // bildiradi, nom o'zgarishi ro'yxat tartibini buzmasin.
    setSavedSchedules(savedSchedules.map((s) => (
      s.id === renameItem.id ? { ...s, name: clean } : s
    )));
    setRenameItem(null);
    toast?.("Nom o'zgartirildi ✓", "success");
  }

  function applyDelete() {
    const item = savedSchedules.find((s) => s.id === deleteId);
    setSavedSchedules(savedSchedules.filter((s) => s.id !== deleteId));
    setDeleteId(null);
    toast?.(`«${item?.name || "Jadval"}» o'chirildi`, "error");
  }

  async function exportExcel(item) {
    await exportColoredSchedule({
      classes,
      subjects,
      teachers,
      rooms,
      timeslots,
      lunchGroups,
      schedule: item.schedule || {},
      schoolName: settings?.schoolName,
      academicYear: settings?.academicYear,
      toast,
    });
  }

  return (
    <div>
      <style>{`
        .sv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;}
        .sv-card{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:18px;background:var(--card-bg,#fff);border:1.5px solid var(--card-border,#e2e8f0);box-shadow:0 6px 20px rgba(15,23,42,.06);transition:transform .18s ease, box-shadow .18s ease;}
        .sv-card:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,23,42,.12);}
        .sv-name{font-size:16.5px;font-weight:800;color:var(--text-primary,#1e293b);word-break:break-word;}
        .sv-date{font-size:12px;font-weight:600;color:var(--text-muted,#94a3b8);}
        .sv-stats{display:flex;gap:8px;flex-wrap:wrap;}
        .sv-chip{font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;background:var(--bg-secondary,#f1f5f9);color:var(--text-secondary,#475569);}
        .sv-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:auto;padding-top:4px;}
        .sv-btn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 13px;border-radius:11px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card-bg,#fff);color:var(--text-secondary,#475569);font-size:12.5px;font-weight:750;font-family:inherit;cursor:pointer;transition:all .16s;}
        .sv-btn:hover{background:var(--bg-secondary,#f1f5f9);}
        .sv-btn-load{background:linear-gradient(135deg,#10b981,#059669);border-color:transparent;color:#fff;box-shadow:0 5px 14px rgba(5,150,105,.28);}
        .sv-btn-load:hover{background:linear-gradient(135deg,#059669,#047857);}
        .sv-btn-red{border-color:rgba(220,38,38,.3);color:#dc2626;}
        .sv-btn-red:hover{background:rgba(220,38,38,.08);}
        .sv-prev-table{width:100%;border-collapse:collapse;font-size:12px;}
        .sv-prev-table th,.sv-prev-table td{border:1px solid var(--card-border,#e2e8f0);padding:6px 8px;text-align:left;vertical-align:top;}
        .sv-prev-table th{background:var(--bg-secondary,#f1f5f9);font-weight:800;}
      `}</style>

      <div className="page-header">
        <div>
          <div className="page-title">Saqlangan jadvallar</div>
          <div className="page-subtitle">
            Tuzilgan dars jadvallarining nomlangan nusxalari — istalganini qayta yuklash mumkin
          </div>
        </div>
        {setSavedSchedules && (
          <button className="btn btn-primary" onClick={() => setSaveOpen(true)}>
            💾 Joriy jadvalni saqlash
          </button>
        )}
      </div>

      <div className="page-body">
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          marginBottom: 16, padding: "10px 14px", borderRadius: 12,
          background: "rgba(37,99,235,.08)", border: "1px solid rgba(37,99,235,.22)",
          fontSize: 13, fontWeight: 600, color: "#1d4ed8",
        }}>
          <span>
            📌 Joriy jadvalda <b>{currentLessons}</b> ta dars bor.
            Saqlangan nusxa: <b>{savedSchedules.length}</b> / {MAX_SAVED}.
          </span>
        </div>

        {!list.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">🗂</div>
            <div className="empty-state-title">Hali saqlangan jadval yo'q</div>
            <div className="empty-state-desc">
              «Dars jadvali» bo'limida jadval tuzing va «💾 Saqlash» tugmasini bosing —
              nusxa shu yerda paydo bo'ladi.
            </div>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 14 }}
              onClick={() => setActivePage?.("schedule")}
            >
              📅 Dars jadvaliga o'tish
            </button>
          </div>
        ) : (
          <div className="sv-grid">
            {list.map((item) => {
              const meta = item.meta || describeSaved(item.schedule, classes);
              return (
                <div key={item.id} className="sv-card">
                  <div>
                    <div className="sv-name">🗂 {item.name}</div>
                    <div className="sv-date" style={{ marginTop: 4 }}>
                      Saqlangan: {fmtDate(item.createdAt)}
                      {item.updatedAt && item.updatedAt !== item.createdAt && (
                        <> · yangilangan: {fmtDate(item.updatedAt)}</>
                      )}
                    </div>
                  </div>

                  <div className="sv-stats">
                    <span className="sv-chip">📖 {meta.lessons} dars</span>
                    <span className="sv-chip">🏫 {meta.classes} sinf</span>
                    <span className="sv-chip">📅 {meta.days} kun</span>
                  </div>

                  <div className="sv-actions">
                    {setSchedule && (
                      <button className="sv-btn sv-btn-load" onClick={() => setLoadItem(item)} type="button">
                        📂 Yuklash
                      </button>
                    )}
                    <button className="sv-btn" onClick={() => setPreview(item)} type="button">
                      👁 Ko'rish
                    </button>
                    <button className="sv-btn" onClick={() => exportExcel(item)} type="button">
                      📥 Excel
                    </button>
                    <button className="sv-btn" onClick={() => openRename(item)} type="button">
                      ✏️ Nom
                    </button>
                    <button className="sv-btn" onClick={() => overwrite(item)} type="button" title="Joriy jadvalni shu nusxa ustiga yozish">
                      🔄 Yangilash
                    </button>
                    <button className="sv-btn" onClick={() => duplicate(item)} type="button">
                      📋 Nusxa
                    </button>
                    <button className="sv-btn sv-btn-red" onClick={() => setDeleteId(item.id)} type="button">
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ——— Nomni o'zgartirish ——— */}
      {renameItem && (
        <div className="modal-overlay" onClick={() => setRenameItem(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">✏️ Jadval nomi</span>
              <button className="modal-close" onClick={() => setRenameItem(null)}>×</button>
            </div>
            <div className="modal-body">
              <input
                className="form-control"
                value={renameText}
                autoFocus
                maxLength={60}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyRename(); }}
                placeholder="Masalan: 1-chorak yakuniy"
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenameItem(null)}>Bekor qilish</button>
              <button className="btn btn-primary" onClick={applyRename} disabled={!renameText.trim()}>Saqlash</button>
            </div>
          </div>
        </div>
      )}

      {/* ——— Yuklash tasdig'i ——— */}
      {loadItem && (
        <div className="modal-overlay" onClick={() => setLoadItem(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📂 Jadvalni yuklash</span>
              <button className="modal-close" onClick={() => setLoadItem(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                «<b>{loadItem.name}</b>» joriy dars jadvali o'rniga qo'yiladi.
                {currentLessons > 0 && (
                  <> Hozirgi jadvaldagi <b>{currentLessons}</b> ta dars almashadi —
                  kerak bo'lsa avval uni ham saqlab qo'ying.</>
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setLoadItem(null)}>Bekor qilish</button>
              <button className="btn btn-primary" onClick={applyLoad}>📂 Yuklash</button>
            </div>
          </div>
        </div>
      )}

      {/* ——— Ko'rish (qisqacha kunlar bo'yicha) ——— */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">👁 {preview.name}</span>
              <button className="modal-close" onClick={() => setPreview(null)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: "60vh", overflow: "auto" }}>
              <table className="sv-prev-table">
                <thead>
                  <tr><th style={{ width: 120 }}>Kun</th><th>Darslar</th></tr>
                </thead>
                <tbody>
                  {DAYS.map((day) => {
                    const bySlot = preview.schedule?.[day] || {};
                    const n = Object.values(bySlot).reduce(
                      (sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0
                    );
                    const slotCount = Object.keys(bySlot).filter(
                      (id) => Array.isArray(bySlot[id]) && bySlot[id].length
                    ).length;
                    return (
                      <tr key={day}>
                        <td style={{ fontWeight: 700 }}>{day}</td>
                        <td>
                          {n
                            ? `${n} ta dars · ${slotCount} ta soat band`
                            : <span style={{ color: "var(--text-muted,#94a3b8)" }}>bo'sh</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-secondary)" }}>
                To'liq ko'rinish uchun jadvalni yuklang yoki Excel'ga chiqaring.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Yopish</button>
              {setSchedule && (
                <button
                  className="btn btn-primary"
                  onClick={() => { const it = preview; setPreview(null); setLoadItem(it); }}
                >
                  📂 Yuklash
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {saveOpen && (
        <SaveScheduleModal
          savedSchedules={savedSchedules}
          lessonCount={currentLessons}
          onSave={handleSave}
          onCancel={() => setSaveOpen(false)}
        />
      )}

      {deleteId && (
        <ConfirmModal
          message="Bu saqlangan jadval o'chiriladi. Amalni qaytarib bo'lmaydi."
          onConfirm={applyDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
