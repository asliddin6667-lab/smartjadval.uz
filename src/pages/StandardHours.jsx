// =====================================================================
//  SUPERADMIN — "Standart soatlar" (tayanch o'quv reja)
//
//  Bu yerda qaysi sinfda qaysi fan necha soat bo'lishi belgilanadi.
//  Saqlangach, foydalanuvchilar "Sinf fanlari" sahifasidagi
//  "⚡ Standart soatlar" tugmasini bosganda sinflar shu soatlar bilan
//  to'ldiriladi.  Ma'lumot Supabase'dagi `standard_hours` jadvalida.
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { CURRICULUM_LANGS, GRADES, DEFAULT_CURRICULUM } from "../utils/curriculum";
import { fetchStandardHours, saveStandardHours } from "../services/standardHoursService";

const EMPTY = { uz: [], ru: [] };

function cloneCurriculum(c) {
  return {
    uz: (c?.uz || []).map((r) => ({ name: r.name, aliases: [...(r.aliases || [])], h: { ...r.h } })),
    ru: (c?.ru || []).map((r) => ({ name: r.name, aliases: [...(r.aliases || [])], h: { ...r.h } })),
  };
}

export default function StandardHoursPage({ toast }) {
  const [lang, setLang] = useState("uz");
  const [curriculum, setCurriculum] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [info, setInfo] = useState({ source: "", updatedAt: null });

  useEffect(() => {
    let alive = true;
    fetchStandardHours().then((res) => {
      if (!alive) return;
      setCurriculum(cloneCurriculum(res.data));
      setInfo({ source: res.source, updatedAt: res.updatedAt });
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => curriculum[lang] || [], [curriculum, lang]);

  // Har sinf bo'yicha jami soat (pastdagi yakun qatori)
  const totals = useMemo(() => {
    const t = {};
    GRADES.forEach((g) => {
      t[g] = rows.reduce((sum, r) => sum + (Number(r.h?.[g]) || 0), 0);
    });
    return t;
  }, [rows]);

  function updateRows(next) {
    setCurriculum((prev) => ({ ...prev, [lang]: next }));
    setDirty(true);
  }

  function setHours(idx, grade, raw) {
    const next = rows.map((r, i) => {
      if (i !== idx) return r;
      const h = { ...r.h };
      const v = Number(String(raw).replace(",", "."));
      if (!raw || !v || v <= 0) delete h[grade];
      else h[grade] = Math.min(20, v);
      return { ...r, h };
    });
    updateRows(next);
  }

  function setName(idx, value) {
    updateRows(rows.map((r, i) => (i === idx ? { ...r, name: value } : r)));
  }

  function setAliases(idx, value) {
    const aliases = value.split(",").map((a) => a.trim()).filter(Boolean);
    updateRows(rows.map((r, i) => (i === idx ? { ...r, aliases } : r)));
  }

  function addRow() {
    updateRows([...rows, { name: "", aliases: [], h: {} }]);
  }

  function removeRow(idx) {
    updateRows(rows.filter((_, i) => i !== idx));
  }

  function moveRow(idx, dir) {
    const to = idx + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[idx], next[to]] = [next[to], next[idx]];
    updateRows(next);
  }

  function loadBuiltIn() {
    const built = cloneCurriculum(DEFAULT_CURRICULUM)[lang] || [];
    if (!built.length) return toast("Bu til uchun ichki reja yo'q — fanlarni qo'lda kiriting", "warning");
    updateRows(built);
    toast(`Ichki tayanch reja yuklandi: ${built.length} fan (hali saqlanmadi)`, "info");
  }

  async function handleSave() {
    const bad = (curriculum.uz || []).concat(curriculum.ru || []).some((r) => !String(r.name || "").trim());
    if (bad) return toast("Fan nomi bo'sh qatorlar bor — to'ldiring yoki o'chiring", "error");

    setSaving(true);
    try {
      await saveStandardHours(curriculum);
      setDirty(false);
      setInfo({ source: "cloud", updatedAt: new Date().toISOString() });
      toast("Standart soatlar saqlandi ✓ — endi barcha foydalanuvchilarga shu soatlar qo'llanadi", "success");
    } catch (e) {
      toast(e.message || "Saqlashda xatolik", "error");
    } finally {
      setSaving(false);
    }
  }

  const sourceLabel = {
    cloud: "☁️ Bulutdan yuklandi",
    cache: "💾 Keshdan (bulutga ulanmadi)",
    default: "📦 Ichki standart reja (bulutda hali saqlanmagan)",
  }[info.source] || "";

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Standart soatlar</div>
          <div className="page-subtitle">
            Qaysi sinfda qaysi fan necha soat — foydalanuvchilar "⚡ Standart soatlar" tugmasini bosganda shu jadval qo'llanadi
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={loadBuiltIn} disabled={loading || saving}>
            📦 Ichki rejani yuklash
          </button>
          <button className="btn btn-success" onClick={handleSave} disabled={loading || saving || !dirty}>
            {saving ? "Saqlanmoqda…" : dirty ? "💾 Saqlash" : "✓ Saqlangan"}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="alert alert-info">
          📋 Har bir katakka <b>haftalik soat</b> yoziladi. Bo'sh katak — bu fan o'sha sinfda o'qitilmaydi.
          Fan nomi maktabdagi fan nomi bilan solishtiriladi; nom har xil yozilishi mumkin bo'lsa,
          <b> "Boshqa nomlari"</b> ustuniga vergul bilan qo'shing (masalan: <i>ingliz tili, nemis tili</i>).
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "14px 0" }}>
          {CURRICULUM_LANGS.map((l) => {
            const on = lang === l.key;
            const count = (curriculum[l.key] || []).length;
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => setLang(l.key)}
                style={{
                  padding: "9px 16px", borderRadius: 999, cursor: "pointer", fontWeight: 800, fontSize: 13.5,
                  border: on ? "2px solid transparent" : "2px solid #cbd5e1",
                  background: on ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "transparent",
                  color: on ? "#fff" : "var(--text-secondary)", transition: "all .15s",
                }}
              >
                {l.label} · {count} fan
              </button>
            );
          })}
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 700 }}>{sourceLabel}</span>
          {dirty && (
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "#b45309", background: "#fef3c7", padding: "4px 11px", borderRadius: 999 }}>
              ⚠️ Saqlanmagan o'zgarish bor
            </span>
          )}
        </div>

        {loading ? (
          <div className="card"><div className="card-body">Yuklanmoqda…</div></div>
        ) : (
          <div className="card">
            <div className="card-body" style={{ overflowX: "auto" }}>
              {rows.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📋</div>
                  <div className="empty-state-title">Bu til uchun fan kiritilmagan</div>
                  <div className="empty-state-desc">"📦 Ichki rejani yuklash" bosing yoki pastdan fan qo'shing</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: "left", minWidth: 230, position: "sticky", left: 0, background: "var(--card-bg,#fff)", zIndex: 2 }}>Fan</th>
                      {GRADES.map((g) => (
                        <th key={g} style={{ ...thStyle, width: 54 }}>{g}-sinf</th>
                      ))}
                      <th style={{ ...thStyle, width: 90 }}>Jami</th>
                      <th style={{ ...thStyle, width: 96 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const rowTotal = GRADES.reduce((sum, g) => sum + (Number(r.h?.[g]) || 0), 0);
                      return (
                        <tr key={idx}>
                          <td style={{ ...tdStyle, position: "sticky", left: 0, background: "var(--card-bg,#fff)", zIndex: 1 }}>
                            <input
                              className="form-control"
                              value={r.name}
                              placeholder="Fan nomi"
                              onChange={(e) => setName(idx, e.target.value)}
                              style={{ fontWeight: 700, marginBottom: 5 }}
                            />
                            <input
                              className="form-control"
                              value={(r.aliases || []).join(", ")}
                              placeholder="Boshqa nomlari (vergul bilan)"
                              onChange={(e) => setAliases(idx, e.target.value)}
                              style={{ fontSize: 12, padding: "5px 9px" }}
                            />
                          </td>
                          {GRADES.map((g) => (
                            <td key={g} style={{ ...tdStyle, textAlign: "center" }}>
                              <input
                                value={r.h?.[g] ?? ""}
                                onChange={(e) => setHours(idx, g, e.target.value)}
                                inputMode="decimal"
                                placeholder="–"
                                style={{
                                  width: 46, textAlign: "center", padding: "6px 4px", borderRadius: 8,
                                  border: "1px solid var(--card-border,#e2e8f0)", fontWeight: 700,
                                  background: r.h?.[g] ? "#ecfdf5" : "transparent",
                                  color: r.h?.[g] ? "#047857" : "inherit",
                                }}
                              />
                            </td>
                          ))}
                          <td style={{ ...tdStyle, textAlign: "center", fontWeight: 800 }}>{rowTotal || "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                            <button className="btn btn-secondary btn-sm" title="Yuqoriga" onClick={() => moveRow(idx, -1)}>↑</button>{" "}
                            <button className="btn btn-secondary btn-sm" title="Pastga" onClick={() => moveRow(idx, 1)}>↓</button>{" "}
                            <button className="btn btn-danger btn-sm" title="O'chirish" onClick={() => removeRow(idx)}>🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ ...tdStyle, fontWeight: 800, position: "sticky", left: 0, background: "var(--card-bg,#fff)" }}>
                        Sinf bo'yicha jami
                      </td>
                      {GRADES.map((g) => (
                        <td key={g} style={{ ...tdStyle, textAlign: "center", fontWeight: 800, color: "var(--accent)" }}>
                          {totals[g] || "—"}
                        </td>
                      ))}
                      <td style={{ ...tdStyle }}></td>
                      <td style={{ ...tdStyle }}></td>
                    </tr>
                  </tbody>
                </table>
              )}

              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary" onClick={addRow}>＋ Fan qo'shish</button>
              </div>
            </div>
          </div>
        )}

        <div className="alert alert-warning" style={{ marginTop: 16 }}>
          ⚠️ Saqlash uchun Supabase'da <b>standard_hours</b> jadvali bo'lishi kerak.
          Bir marta <b>standard_hours_setup.sql</b> faylini Supabase SQL Editor'da ishga tushiring.
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "9px 6px", fontSize: 12, fontWeight: 800, color: "var(--text-secondary)",
  borderBottom: "2px solid var(--card-border,#e2e8f0)", textAlign: "center", whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "7px 6px", borderBottom: "1px solid var(--card-border,#eef2f7)", verticalAlign: "middle",
};
