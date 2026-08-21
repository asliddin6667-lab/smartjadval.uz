import { useMemo, useState } from "react";
import { MAX_SAVED, suggestName } from "../utils/savedSchedules";

// =====================================================================
//  «💾 Jadvalni saqlash» oynasi
//
//  Ikki rejim:
//    • yangi nusxa  — nom kiritiladi va ro'yxatga qo'shiladi,
//    • yangilash    — mavjud nusxa joriy jadval bilan almashtiriladi.
//
//  Oynani "Dars jadvali" sahifasi ham, "Saqlangan jadvallar" sahifasi
//  ham ishlatadi — saqlash qoidasi bitta joyda tursin.
// =====================================================================
export default function SaveScheduleModal({
  savedSchedules = [],
  lessonCount = 0,
  onSave,          // (name, overwriteId|null) => void
  onCancel,
}) {
  const full = savedSchedules.length >= MAX_SAVED;
  const [mode, setMode] = useState(full && savedSchedules.length ? "update" : "new");
  const [name, setName] = useState(() => suggestName(savedSchedules));
  const [targetId, setTargetId] = useState(savedSchedules[0]?.id || "");

  const sorted = useMemo(() => (
    [...savedSchedules].sort((a, b) => (
      new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    ))
  ), [savedSchedules]);

  const clean = name.trim();
  const duplicateName = mode === "new"
    && sorted.some((s) => String(s.name || "").trim().toLowerCase() === clean.toLowerCase());
  const canSave = lessonCount > 0
    && (mode === "new" ? !!clean && !full : !!targetId);

  function handleSave() {
    if (!canSave) return;
    onSave?.(mode === "new" ? clean : (sorted.find((s) => s.id === targetId)?.name || clean),
      mode === "new" ? null : targetId);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">💾 Jadvalni saqlash</span>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>

        <div className="modal-body">
          <style>{`
            .ssm-opt{display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:12px;border:1.5px solid var(--card-border,#e2e8f0);cursor:pointer;font-size:13.5px;font-weight:700;color:var(--text-secondary,#475569);transition:all .16s;}
            .ssm-opt.active{border-color:#10b981;background:rgba(16,185,129,.08);color:#047857;}
            .ssm-opt input{accent-color:#10b981;width:16px;height:16px;cursor:pointer;}
            .ssm-opt.disabled{opacity:.5;cursor:not-allowed;}
            .ssm-hint{font-size:12.5px;color:var(--text-muted,#94a3b8);margin-top:7px;line-height:1.5;}
          `}</style>

          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.55 }}>
            Joriy jadvaldagi <b>{lessonCount}</b> ta dars nom bilan saqlanadi va
            «Saqlangan jadvallar» bo'limida turadi.
          </div>

          {lessonCount === 0 && (
            <div style={{
              marginBottom: 14, padding: "10px 13px", borderRadius: 11,
              background: "#fef3c7", border: "1px solid #fcd34d",
              color: "#b45309", fontSize: 13, fontWeight: 700,
            }}>
              ⚠️ Jadval bo'sh — avval darslarni joylashtiring.
            </div>
          )}

          <div style={{ display: "grid", gap: 9 }}>
            <label className={`ssm-opt ${mode === "new" ? "active" : ""} ${full ? "disabled" : ""}`}>
              <input
                type="radio"
                checked={mode === "new"}
                disabled={full}
                onChange={() => setMode("new")}
              />
              Yangi nusxa sifatida saqlash
            </label>

            {mode === "new" && (
              <div style={{ paddingLeft: 4 }}>
                <input
                  className="form-control"
                  value={name}
                  autoFocus
                  maxLength={60}
                  disabled={full}
                  placeholder="Masalan: 1-chorak jadvali"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                />
                {full ? (
                  <div className="ssm-hint" style={{ color: "#b45309" }}>
                    Saqlangan nusxalar to'lgan ({MAX_SAVED} ta) — avval bittasini o'chiring
                    yoki mavjudini yangilang.
                  </div>
                ) : duplicateName ? (
                  <div className="ssm-hint" style={{ color: "#b45309" }}>
                    Bu nom allaqachon bor — ikkita bir xil nomli nusxa hosil bo'ladi.
                  </div>
                ) : (
                  <div className="ssm-hint">
                    Saqlangan: {savedSchedules.length} / {MAX_SAVED}
                  </div>
                )}
              </div>
            )}

            {sorted.length > 0 && (
              <label className={`ssm-opt ${mode === "update" ? "active" : ""}`}>
                <input
                  type="radio"
                  checked={mode === "update"}
                  onChange={() => setMode("update")}
                />
                Mavjud nusxani yangilash
              </label>
            )}

            {mode === "update" && sorted.length > 0 && (
              <div style={{ paddingLeft: 4 }}>
                <select
                  className="form-control"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  {sorted.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <div className="ssm-hint" style={{ color: "#b45309" }}>
                  Tanlangan nusxadagi eski jadval o'chadi va joriy jadval yoziladi.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Bekor qilish</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
            💾 Saqlash
          </button>
        </div>
      </div>
    </div>
  );
}
