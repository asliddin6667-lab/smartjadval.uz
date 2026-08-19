import { useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";
import { CLASS_LETTERS, DAYS, EDU_LANGS } from "../utils/constants";

export default function ClassesPage({ classes, setClasses, toast }) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [form, setForm] = useState({ name: "", studentCount: "", headTeacher: "", offDays: [], eduLang: "uz" });
  const [autoForm, setAutoForm] = useState({ grade: 1, count: 4, studentCount: "", headTeacher: "", eduLang: "uz" });
  const [allCounts, setAllCounts] = useState(() => Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, ""])));

  // 1..11 uchun kiritilgan parallel sonlaridan jami nechta sinf chiqishini hisoblaymiz
  const allTotal = Array.from({ length: 11 }, (_, i) => i + 1)
    .reduce((sum, grade) => sum + Math.min(CLASS_LETTERS.length, Math.max(0, Number(allCounts[grade]) || 0)), 0);

  const filtered = classes.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.headTeacher?.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "uz", { numeric: true, sensitivity: "base" }));

  function openAdd() {
    setEditItem(null);
    setForm({ name: "", studentCount: "", headTeacher: "", offDays: [], eduLang: "uz" });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ name: item.name, studentCount: item.studentCount, headTeacher: item.headTeacher || "", offDays: Array.isArray(item.offDays) ? item.offDays : [], eduLang: item.eduLang || "uz" });
    setShowModal(true);
  }

  function toggleFormOffDay(day) {
    setForm(f => {
      const set = new Set(f.offDays || []);
      if (set.has(day)) set.delete(day); else set.add(day);
      return { ...f, offDays: DAYS.filter(d => set.has(d)) };
    });
  }

  function setSaturdayOffForAll() {
    const sat = DAYS[DAYS.length - 1];
    setClasses(classes.map(c => {
      const set = new Set(Array.isArray(c.offDays) ? c.offDays : []);
      set.add(sat);
      return { ...c, offDays: DAYS.filter(d => set.has(d)) };
    }));
    toast(`Barcha sinflarga ${sat} dam kuni qilindi ✓`, "success");
  }

  function clearOffDaysForAll() {
    setClasses(classes.map(c => ({ ...c, offDays: [] })));
    toast("Barcha sinflardan dam kunlari olib tashlandi", "success");
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editItem) {
      const updated = classes.map(c => c.id === editItem.id ? { ...c, ...form } : c);
      setClasses(updated);
      toast("Sinf yangilandi ✓", "success");
    } else {
      setClasses([...classes, { id: genId(), ...form, createdAt: Date.now() }]);
      toast("Sinf qo'shildi ✓", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    setClasses(classes.filter(c => c.id !== deleteId));
    setDeleteId(null);
    toast("Sinf o'chirildi", "error");
  }

  function handleClearAll() {
    const count = classes.length;
    setClasses([]);
    setConfirmClearAll(false);
    setSearch("");
    toast(`${count} ta sinf o'chirildi`, "error");
  }
  function addClassesBulk(newClasses) {
    const existingNames = new Set(classes.map(c => c.name.trim().toLowerCase()));
    const prepared = newClasses
      .filter(c => c.name && !existingNames.has(c.name.trim().toLowerCase()))
      .map(c => ({ id: genId(), ...c, createdAt: Date.now() + Math.random() }));

    if (!prepared.length) {
      toast("Yangi sinf qo'shilmadi: bunday sinflar allaqachon bor", "warning");
      return;
    }
    setClasses([...classes, ...prepared]);
    toast(`${prepared.length} ta sinf avtomatik qo'shildi ✓`, "success");
  }

  function generateOneGrade() {
    const grade = Math.min(11, Math.max(1, Number(autoForm.grade) || 1));
    const count = Math.min(CLASS_LETTERS.length, Math.max(1, Number(autoForm.count) || 1));
    const list = CLASS_LETTERS.slice(0, count).map(letter => ({
      name: `${grade}-${letter}`,
      studentCount: autoForm.studentCount,
      headTeacher: autoForm.headTeacher,
      eduLang: autoForm.eduLang || "uz"
    }));
    addClassesBulk(list);
  }

  function generateAllGrades() {
    const list = [];
    for (let grade = 1; grade <= 11; grade++) {
      const count = Math.min(CLASS_LETTERS.length, Math.max(0, Number(allCounts[grade]) || 0));
      CLASS_LETTERS.slice(0, count).forEach(letter => {
        list.push({ name: `${grade}-${letter}`, studentCount: autoForm.studentCount, headTeacher: "", eduLang: autoForm.eduLang || "uz" });
      });
    }
    addClassesBulk(list);
  }

  function langBadge(lang) {
    return (lang || "uz") === "ru" ? "🇷🇺 Rus" : "🇺🇿 O'zbek";
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sinflar</div>
          <div className="page-subtitle">Maktabdagi barcha sinflarni boshqaring</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={generateOneGrade}>⚡ {autoForm.grade}-sinfni yaratish</button>
          <button className="btn btn-primary" onClick={openAdd}>＋ Qo'lda sinf qo'shish</button>
        </div>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="toolbar">
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>⚡ Avtomatik sinf yaratish</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>1-A, 1-B, 1-C kabi sinflarni bir bosishda qo'shing</div>
              </div>
            </div>

            <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
              <div className="form-group">
                <label className="form-label">Sinf raqami</label>
                <select className="form-control" value={autoForm.grade} onChange={e => setAutoForm({ ...autoForm, grade: Number(e.target.value) })}>
                  {Array.from({ length: 11 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}-sinf</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Parallel soni</label>
                <input className="form-control" type="number" min="1" max={CLASS_LETTERS.length} value={autoForm.count}
                  onChange={e => setAutoForm({ ...autoForm, count: e.target.value })}
                  onBlur={e => {
                    const v = e.target.value;
                    if (v === "") return; // bo'sh qolsa yaratishda 1 bo'ladi
                    setAutoForm(f => ({ ...f, count: Math.min(CLASS_LETTERS.length, Math.max(1, Number(v) || 1)) }));
                  }} />
              </div>
              <div className="form-group">
                <label className="form-label">O'quvchilar soni</label>
                <input className="form-control" type="number" placeholder="30" value={autoForm.studentCount}
                  onChange={e => setAutoForm({ ...autoForm, studentCount: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Ta'lim tili</label>
                <select className="form-control" value={autoForm.eduLang} onChange={e => setAutoForm({ ...autoForm, eduLang: e.target.value })}>
                  {EDU_LANGS.map(l => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Natija: {CLASS_LETTERS.slice(0, Number(autoForm.count) || 0).map(l => `${autoForm.grade}-${l}`).join(", ") || "—"} ({langBadge(autoForm.eduLang)})
              </div>
              <button className="btn btn-primary" onClick={generateOneGrade}>Shu sinfni yaratish</button>
            </div>

            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--card-border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div>
                  <div className="form-label" style={{ marginBottom: 2 }}>1 dan 11 gacha yaratish uchun parallel sonlari</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {allTotal > 0
                      ? `Jami ${allTotal} ta sinf yaratiladi`
                      : "Kerakli sinflar uchun parallel sonini kiriting — bo'sh qolgani yaratilmaydi"}
                  </div>
                </div>
                <button className="btn btn-success" onClick={generateAllGrades} disabled={allTotal === 0}
                  style={{ whiteSpace: "nowrap", opacity: allTotal === 0 ? 0.55 : 1, cursor: allTotal === 0 ? "not-allowed" : "pointer" }}>
                  1 dan 11 gacha yaratish
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                {Array.from({ length: 11 }, (_, i) => i + 1).map(grade => (
                  <div key={grade}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>{grade}-sinf</label>
                    <input className="form-control" type="number" min="0" max={CLASS_LETTERS.length} placeholder="—" value={allCounts[grade]}
                      onChange={e => setAllCounts({ ...allCounts, [grade]: e.target.value })}
                      onBlur={e => {
                        const v = e.target.value;
                        if (v === "") return; // bo'sh = yaratilmaydi
                        setAllCounts(prev => ({ ...prev, [grade]: Math.min(CLASS_LETTERS.length, Math.max(0, Number(v) || 0)) }));
                      }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="toolbar">
              <div className="search-bar">
                <span style={{ color: "var(--text-muted)" }}>🔍</span>
                <input placeholder="Sinf qidirish..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{filtered.length} ta sinf</span>
                {classes.length > 0 && (
                  <>
                    <button className="btn btn-secondary" onClick={setSaturdayOffForAll} title="Barcha sinflarda Shanbani dam kuni qilish (5 kunlik hafta)">
                      📅 Barchaga Shanba dam
                    </button>
                    <button className="btn btn-secondary" onClick={clearOffDaysForAll} title="Barcha sinflardan dam kunlarini olib tashlash">
                      Dam kunlarini tozalash
                    </button>
                    <button className="btn btn-danger" onClick={() => setConfirmClearAll(true)} title="Barcha sinflarni o'chirish">
                      🗑️ Barchasini o'chirish
                    </button>
                  </>
                )}
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🏫</div>
                <div className="empty-state-title">Sinflar topilmadi</div>
                <div className="empty-state-desc">Yangi sinf qo'shing</div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Sinf nomi</th>
                    <th>Ta'lim tili</th>
                    <th>O'quvchilar soni</th>
                    <th>Sinf rahbari</th>
                    <th>Dam kunlari</th>
                    <th>Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.id}>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      </td>
                      <td>
                        <span className={`badge ${(c.eduLang || "uz") === "ru" ? "badge-warning" : "badge-default"}`}>
                          {langBadge(c.eduLang)}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-info">{c.studentCount || "—"} ta</span>
                      </td>
                      <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{c.headTeacher || "—"}</td>
                      <td>
                        {Array.isArray(c.offDays) && c.offDays.length > 0
                          ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{c.offDays.map(d => <span key={d} className="badge badge-warning">{d}</span>)}</div>
                          : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>6 kunlik</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-icon" onClick={() => openEdit(c)} title="Tahrirlash">✏️</button>
                          <button className="btn btn-icon" onClick={() => setDeleteId(c.id)} title="O'chirish">🗑️</button>
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

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? "Sinf tahrirlash" : "Yangi sinf"}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Sinf nomi *</label>
                <input className="form-control" placeholder="Masalan: 4-A, 9-B" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Ta'lim tili</label>
                <select className="form-control" value={form.eduLang}
                  onChange={e => setForm({ ...form, eduLang: e.target.value })}>
                  {EDU_LANGS.map(l => <option key={l.key} value={l.key}>{l.icon} {l.label}</option>)}
                </select>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  Rus tili tanlansa, bu sinfga fan biriktirishda faqat ruscha fanlar ko'rsatiladi.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">O'quvchilar soni</label>
                <input className="form-control" type="number" placeholder="30" value={form.studentCount}
                  onChange={e => setForm({ ...form, studentCount: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Sinf rahbari</label>
                <input className="form-control" placeholder="F.I.Sh" value={form.headTeacher}
                  onChange={e => setForm({ ...form, headTeacher: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Dam olish kunlari (bu kunlarga dars qo'yilmaydi)</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {DAYS.map(d => {
                    const on = (form.offDays || []).includes(d);
                    return (
                      <button type="button" key={d} onClick={() => toggleFormOffDay(d)}
                        className={`btn btn-sm ${on ? "btn-danger" : "btn-secondary"}`}>
                        {on ? "✓ " : ""}{d}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {(form.offDays || []).length === 0
                    ? "Hozir: 6 kunlik hafta (hamma kun o'qiladi)"
                    : `Dam: ${form.offDays.join(", ")} → ${DAYS.length - form.offDays.length} kunlik hafta`}
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
          message="Bu sinfni o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {confirmClearAll && (
        <ConfirmModal
          message={`Barcha ${classes.length} ta sinf o'chiriladi. Bu amalni qaytarib bo'lmaydi. Davom etasizmi?`}
          onConfirm={handleClearAll}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
    </div>
  );
}
