import { useState, useMemo, useEffect } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";
import { SUBJECT_COLORS, STANDARD_SUBJECTS, STANDARD_SUBJECTS_RU, EDU_LANGS } from "../utils/constants";

// ——— Standart fan nomlari to'plami (uz + ru) — eski ma'lumotni aniqlash uchun ———
const STANDARD_NAME_SET = new Set(
  [...STANDARD_SUBJECTS, ...STANDARD_SUBJECTS_RU].map(s => s.name.trim().toLowerCase())
);

function isStandardName(name) {
  return STANDARD_NAME_SET.has(String(name || "").trim().toLowerCase());
}

// ——— Eski fanlarga source/ownerId maydonlarini qo'shish (bir martalik migratsiya) ———
//  - Nomi standart ro'yxatda bo'lsa  -> source: "standard" (hammada ko'rinadi)
//  - Aks holda                       -> source: "custom" + joriy foydalanuvchi egaligi
function migrateSubject(s, currentUserId) {
  if (s.source === "standard" || s.source === "custom") return s;
  if (isStandardName(s.name)) return { ...s, source: "standard" };
  return { ...s, source: "custom", ownerId: s.ownerId || currentUserId || null };
}

// ——— Fan shu foydalanuvchiga ko'rinadimi? ———
//  Standart fanlar — hammaga. Qo'lda qo'shilgan fan — faqat egasiga.
//  ownerId yoki currentUserId noma'lum bo'lsa, eski holat saqlanadi (ko'rinaveradi).
export function subjectVisibleTo(s, currentUserId) {
  if (!s) return false;
  if (s.source !== "custom") return true;
  if (!s.ownerId || !currentUserId) return true;
  return s.ownerId === currentUserId;
}

export default function SubjectsPage({ subjects, setSubjects, classSubjects = {}, setClassSubjects = null, toast, currentUser = null, currentUserId = null }) {
  // Foydalanuvchi ID si: App.jsx `currentUser` ni pageProps orqali uzatadi
  const uid = currentUserId || currentUser?.id || null;

  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("all"); // all | uz | ru
  const [sourceFilter, setSourceFilter] = useState("all"); // all | standard | custom
  const [previewLang, setPreviewLang] = useState("uz"); // standart fanlar kartasi uchun
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: "", weeklyHours: 2, color: SUBJECT_COLORS[0], type: "Oddiy", allowDouble: false, lang: "uz" });

  // ——— Migratsiya: eski fanlarga source yozib qo'yamiz (faqat kerak bo'lsa) ———
  useEffect(() => {
    const needs = subjects.some(s => s.source !== "standard" && s.source !== "custom");
    if (!needs) return;
    setSubjects(subjects.map(s => migrateSubject(s, uid)));
  }, [subjects, uid, setSubjects]);

  // ——— Ko'rinadigan fanlar: boshqa foydalanuvchining qo'lda qo'shgan fani chiqmaydi ———
  const visible = useMemo(
    () => subjects.map(s => migrateSubject(s, uid)).filter(s => subjectVisibleTo(s, uid)),
    [subjects, uid]
  );

  const customCount = visible.filter(s => s.source === "custom").length;
  const standardCount = visible.length - customCount;

  const filtered = visible
    .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    .filter(s => langFilter === "all" || (s.lang || "uz") === langFilter)
    .filter(s => sourceFilter === "all" || (s.source === "custom" ? "custom" : "standard") === sourceFilter)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "uz", { numeric: true, sensitivity: "base" }));

  function openAdd() {
    setEditItem(null);
    setForm({ name: "", weeklyHours: 2, color: SUBJECT_COLORS[0], type: "Oddiy", allowDouble: false, lang: "uz" });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ name: item.name, weeklyHours: item.weeklyHours, color: item.color, type: item.type || "Oddiy", allowDouble: Boolean(item.allowDouble), lang: item.lang || "uz" });
    setShowModal(true);
  }

  function handleSave() {
    if (!form.name.trim()) return;

    // Bir xil nomdagi fan takrorlanmasin (faqat ko'rinadigan fanlar orasida)
    const dup = visible.some(s =>
      s.id !== editItem?.id &&
      s.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
      (s.lang || "uz") === form.lang
    );
    if (dup) {
      toast("Bu nomdagi fan allaqachon mavjud", "warning");
      return;
    }

    if (editItem) {
      setSubjects(subjects.map(s => s.id === editItem.id ? { ...migrateSubject(s, uid), ...form } : s));
      toast("Fan yangilandi ✓", "success");
    } else {
      // Qo'lda qo'shilgan fan — faqat shu foydalanuvchiga tegishli
      setSubjects([...subjects, {
        id: genId(),
        ...form,
        source: "custom",
        ownerId: uid || null,
        createdAt: Date.now()
      }]);
      toast("Fan qo'shildi ✓ (faqat sizning maktabingizda)", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    // Fan o'chirilganda "Sinf fanlari" dagi biriktirmalar ham tozalanadi.
    // Aks holda ular ko'rinmas "yetim" yozuv bo'lib qoladi va tahlilda
    // "Noma'lum fan" nomi bilan soxta vakant soat bo'lib chiqaveradi.
    let orphans = 0;
    if (setClassSubjects) {
      const next = {};
      for (const [clsId, list] of Object.entries(classSubjects || {})) {
        if (!Array.isArray(list)) continue;
        const kept = [];
        for (const a of list) {
          if (!a) continue;
          if (a.subjectId === deleteId) { orphans += 1; continue; }
          // O'chirilgan fanga qo'shimcha havolalar: almashinuv / juft-hafta / 2-fan
          const patch = {};
          if (a.swapSubjectId === deleteId) { patch.swapEnabled = false; patch.swapSubjectId = ""; patch.swapTeacherId = ""; patch.swapRoomId = ""; }
          if (a.weekAltSubjectId === deleteId) { patch.weekAltEnabled = false; patch.weekAltSubjectId = ""; patch.weekAltTeacherId = ""; patch.weekAltRoomId = ""; }
          if (a.pairSubjectId === deleteId) { patch.pairEnabled = false; patch.pairGroupKey = ""; patch.pairSubjectId = ""; patch.pairTeacherId = ""; patch.pairRoomId = ""; }
          kept.push(Object.keys(patch).length ? { ...a, ...patch } : a);
        }
        next[clsId] = kept;
      }
      setClassSubjects(next);
    }
    setSubjects(subjects.filter(s => s.id !== deleteId));
    setDeleteId(null);
    toast(orphans ? `Fan o'chirildi (${orphans} ta sinf biriktirmasi ham tozalandi)` : "Fan o'chirildi", "error");
  }

  function addStandardSubjects(lang = "uz") {
    const source = lang === "ru" ? STANDARD_SUBJECTS_RU : STANDARD_SUBJECTS;
    const existingNames = new Set(subjects.map(s => s.name.trim().toLowerCase()));
    const prepared = source
      .filter(s => !existingNames.has(s.name.trim().toLowerCase()))
      .map((s, index) => ({
        id: genId(),
        ...s,
        lang,
        source: "standard",
        color: SUBJECT_COLORS[(subjects.length + index) % SUBJECT_COLORS.length],
        allowDouble: Boolean(s.allowDouble),
        createdAt: Date.now() + index
      }));

    if (!prepared.length) {
      toast(lang === "ru" ? "Ruscha standart fanlar allaqachon qo'shilgan" : "Standart fanlar allaqachon qo'shilgan", "warning");
      return;
    }
    setSubjects([...subjects, ...prepared]);
    toast(`${prepared.length} ta standart fan qo'shildi ✓ (${lang === "ru" ? "Rus tili" : "O'zbek tili"})`, "success");
  }

  const previewList = previewLang === "ru" ? STANDARD_SUBJECTS_RU : STANDARD_SUBJECTS;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Fanlar</div>
          <div className="page-subtitle">O'quv fanlari va haftalik soatlar</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-success" onClick={() => addStandardSubjects("uz")}>⚡ Standart fanlar (🇺🇿 O'zbek)</button>
          <button className="btn btn-success" onClick={() => addStandardSubjects("ru")}>⚡ Standart fanlar (🇷🇺 Rus)</button>
          <button className="btn btn-primary" onClick={openAdd}>＋ Qo'lda fan qo'shish</button>
        </div>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="toolbar">
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>📚 Standart fanlar</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Standart fanlar barcha maktablarda bir xil bo'ladi. Qo'lda qo'shgan faningiz esa faqat sizning maktabingizda ko'rinadi.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {EDU_LANGS.map(l => (
                  <button key={l.key}
                    className={`btn ${previewLang === l.key ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setPreviewLang(l.key)}>
                    {l.icon} {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {previewList.map(s => (
                <span key={s.name} className="badge badge-default">{s.name}</span>
              ))}
            </div>
            <button className="btn btn-success" onClick={() => addStandardSubjects(previewLang)}>
              {previewLang === "ru" ? "🇷🇺 Ruscha standart fanlarni qo'shish" : "🇺🇿 O'zbekcha standart fanlarni qo'shish"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="toolbar">
              <div className="search-bar">
                <span style={{ color: "var(--text-muted)" }}>🔍</span>
                <input placeholder="Fan qidirish..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <select className="form-control" style={{ width: "auto" }} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                  <option value="all">Barcha fanlar</option>
                  <option value="standard">📚 Standart ({standardCount})</option>
                  <option value="custom">✍️ Qo'lda qo'shilgan ({customCount})</option>
                </select>
                <select className="form-control" style={{ width: "auto" }} value={langFilter} onChange={e => setLangFilter(e.target.value)}>
                  <option value="all">Barcha tillar</option>
                  <option value="uz">🇺🇿 O'zbek tili</option>
                  <option value="ru">🇷🇺 Rus tili</option>
                </select>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{filtered.length} ta fan</span>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📚</div>
                <div className="empty-state-title">Fanlar topilmadi</div>
                <div className="empty-state-desc">Yangi fan qo'shing</div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fan nomi</th>
                    <th>Manba</th>
                    <th>Ta'lim tili</th>
                    <th>Haftalik soat</th>
                    <th>Turi</th>
                    <th>Rang</th>
                    <th>Ketma-ket</th>
                    <th>Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr key={s.id}>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{i + 1}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="color-dot" style={{ background: s.color }} />
                          <strong>{s.name}</strong>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${s.source === "custom" ? "badge-warning" : "badge-default"}`}
                          title={s.source === "custom"
                            ? "Siz qo'lda qo'shgansiz — faqat sizning maktabingizda ko'rinadi"
                            : "Standart fan — barcha maktablarda mavjud"}
                        >
                          {s.source === "custom" ? "✍️ Qo'lda" : "📚 Standart"}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-default">
                          {(s.lang || "uz") === "ru" ? "🇷🇺 Rus" : "🇺🇿 O'zbek"}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-info">{s.weeklyHours} soat</span>
                      </td>
                      <td>
                        <span className={`badge ${s.type === "Guruhli" ? "badge-warning" : "badge-default"}`}>
                          {s.type || "Oddiy"}
                        </span>
                      </td>
                      <td>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: s.color }} />
                      </td>
                      <td>
                        <span className={`badge ${s.allowDouble ? "badge-success" : "badge-default"}`}>
                          {s.allowDouble ? "Ruxsat" : "Yo'q"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-icon" onClick={() => openEdit(s)}>✏️</button>
                          <button className="btn btn-icon" onClick={() => setDeleteId(s.id)}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? "Fan tahrirlash" : "Yangi fan"}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {!editItem && (
                <div style={{
                  background: "var(--bg-secondary, #f1f5f9)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 14,
                  fontSize: 12,
                  color: "var(--text-secondary)"
                }}>
                  🔒 Bu fan <b>faqat sizning maktabingizda</b> ko'rinadi — boshqa foydalanuvchilarga o'tmaydi.
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Fan nomi *</label>
                <input className="form-control" placeholder="Masalan: Matematika" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Haftalik soat</label>
                  <input className="form-control" type="number" min="1" max="20" value={form.weeklyHours}
                    onChange={e => setForm({ ...form, weeklyHours: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Turi</label>
                  <select className="form-control" value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value })}>
                    <option>Oddiy</option>
                    <option>Guruhli</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Ta'lim tili</label>
                <select className="form-control" value={form.lang}
                  onChange={e => setForm({ ...form, lang: e.target.value })}>
                  <option value="uz">🇺🇿 O'zbek tili</option>
                  <option value="ru">🇷🇺 Rus tili</option>
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.allowDouble} onChange={e => setForm({ ...form, allowDouble: e.target.checked })} style={{ marginTop: 3 }} />
                  <span>
                    <b>Ketma-ket 2 soatga ruxsat</b>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Masalan: Informatika, laboratoriya yoki jismoniy tarbiya uchun kerak bo'lsa yoqing.</div>
                  </span>
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">Fan rangi</label>
                <div className="color-picker-row">
                  {SUBJECT_COLORS.map(c => (
                    <div key={c} className={`color-option ${form.color === c ? "selected" : ""}`}
                      style={{ background: c }} onClick={() => setForm({ ...form, color: c })} />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Bekor</button>
              <button className="btn btn-primary" onClick={handleSave}>
                {editItem ? "Saqlash" : "Qo'shish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmModal
          message="Bu fanni o'chirmoqchimisiz?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
