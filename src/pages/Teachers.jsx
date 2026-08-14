import { useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";
import { DAYS } from "../utils/constants";
import { sortByName, cmpName } from "../utils/sortHelpers";

export default function TeachersPage({ teachers, setTeachers, subjects, toast }) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: "", subjectIds: [], phone: "", maxWeeklyHours: 18, status: "Bo'sh", offDays: [] });

  function teacherSubjectIds(t) {
    return Array.isArray(t.subjectIds) ? t.subjectIds : (t.subjectId ? [t.subjectId] : []);
  }

  // Fanlar ta'lim tili bo'yicha (eski fanlar lang'siz — o'zbekcha hisoblanadi)
  // Har ikkala ro'yxat alifbo tartibida ko'rsatiladi.
  const uzSubjects = sortByName(subjects.filter(s => (s.lang || "uz") === "uz"));
  const ruSubjects = sortByName(subjects.filter(s => (s.lang || "uz") === "ru"));

  // O'qituvchilar ro'yxati — F.I.Sh bo'yicha alifbo tartibida
  const filtered = teachers.filter(t => {
    const names = teacherSubjectIds(t).map(id => subjects.find(s => s.id === id)?.name || "").join(" ");
    return t.name.toLowerCase().includes(search.toLowerCase()) || names.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => cmpName(a.name, b.name));

  function openAdd() {
    setEditItem(null);
    setForm({ name: "", subjectIds: subjects[0]?.id ? [subjects[0].id] : [], phone: "", maxWeeklyHours: 18, status: "Bo'sh", offDays: [] });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({
      name: item.name,
      subjectIds: teacherSubjectIds(item),
      phone: item.phone || "",
      maxWeeklyHours: item.maxWeeklyHours || 18,
      status: item.status || "Bo'sh",
      offDays: Array.isArray(item.offDays) ? item.offDays : []
    });
    setShowModal(true);
  }

  function toggleOffDay(day) {
    setForm(prev => {
      const set = new Set(prev.offDays || []);
      if (set.has(day)) set.delete(day); else set.add(day);
      return { ...prev, offDays: DAYS.filter(d => set.has(d)) };
    });
  }

  function toggleSubject(subjectId) {
    setForm(prev => ({
      ...prev,
      subjectIds: prev.subjectIds.includes(subjectId)
        ? prev.subjectIds.filter(id => id !== subjectId)
        : [...prev.subjectIds, subjectId]
    }));
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (!form.subjectIds.length) {
      toast("Kamida 1 ta fan tanlang", "warning");
      return;
    }
    // Saqlashda soatni songa aylantiramiz (yozish paytida bo'sh qolishi mumkin)
    const maxWeeklyHours = Math.max(1, Math.min(40, parseInt(form.maxWeeklyHours, 10) || 18));
    const data = { ...form, maxWeeklyHours, subjectId: form.subjectIds[0] || "" }; // eski ma'lumotlar bilan moslik uchun
    if (editItem) {
      setTeachers(teachers.map(t => t.id === editItem.id ? { ...t, ...data } : t));
      toast("O'qituvchi yangilandi ✓", "success");
    } else {
      setTeachers([...teachers, { id: genId(), ...data, createdAt: Date.now() }]);
      toast("O'qituvchi qo'shildi ✓", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    setTeachers(teachers.filter(t => t.id !== deleteId));
    setDeleteId(null);
    toast("O'qituvchi o'chirildi", "error");
  }

  function renderSubjectGrid(list) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
        {list.map(s => (
          <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, border: "1px solid var(--card-border)", borderRadius: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.subjectIds.includes(s.id)} onChange={() => toggleSubject(s.id)} />
            <span className="color-dot" style={{ background: s.color }} />
            <span style={{ fontSize: 13 }}>{s.name}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">O'qituvchilar</div>
          <div className="page-subtitle">Bitta o'qituvchiga bir nechta fan biriktirish mumkin</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>＋ O'qituvchi qo'shish</button>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="card-body">
            <div className="toolbar">
              <div className="search-bar">
                <span style={{ color: "var(--text-muted)" }}>🔍</span>
                <input placeholder="O'qituvchi yoki fan qidirish..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{filtered.length} ta o'qituvchi</span>
            </div>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">👩‍🏫</div>
                <div className="empty-state-title">O'qituvchilar topilmadi</div>
                <div className="empty-state-desc">Yangi o'qituvchi qo'shing</div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>F.I.Sh</th>
                    <th>Fanlar</th>
                    <th>Telefon</th>
                    <th>Maks. soat</th>
                    <th>Dam kunlari</th>
                    <th>Status</th>
                    <th>Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => {
                    const teacherSubs = sortByName(
                      teacherSubjectIds(t).map(id => subjects.find(s => s.id === id)).filter(Boolean)
                    );
                    return (
                      <tr key={t.id}>
                        <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{i + 1}</td>
                        <td><div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div></td>
                        <td>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {teacherSubs.length ? teacherSubs.map(s => (
                              <span key={s.id} className="badge badge-info">{(s.lang || "uz") === "ru" ? "🇷🇺 " : ""}{s.name}</span>
                            )) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                          </div>
                        </td>
                        <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>{t.phone || "—"}</td>
                        <td><span className="badge badge-default">{t.maxWeeklyHours} soat</span></td>
                        <td>
                          {Array.isArray(t.offDays) && t.offDays.length > 0
                            ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{t.offDays.map(d => <span key={d} className="badge badge-warning">{d}</span>)}</div>
                            : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
                        </td>
                        <td><span className={`badge ${t.status === "Bo'sh" ? "badge-success" : "badge-warning"}`}>{t.status}</span></td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-icon" onClick={() => openEdit(t)}>✏️</button>
                            <button className="btn btn-icon" onClick={() => setDeleteId(t.id)}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? "O'qituvchi tahrirlash" : "Yangi o'qituvchi"}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">F.I.Sh *</label>
                <input className="form-control" placeholder="Ism Familiya Sharif" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Fanlar *</label>
                {ruSubjects.length > 0 ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", margin: "4px 0 6px" }}>🇺🇿 O'zbekcha fanlar</div>
                    {renderSubjectGrid(uzSubjects)}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", margin: "12px 0 6px" }}>🇷🇺 Ruscha fanlar</div>
                    {renderSubjectGrid(ruSubjects)}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      Ikkala tilda ham dars beradigan ustozga ikkala tildagi fanni belgilash mumkin.
                    </div>
                  </>
                ) : renderSubjectGrid(uzSubjects)}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Telefon</label>
                  <input className="form-control" placeholder="+998 90 000 00 00" value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Maks. haftalik soat</label>
                  <input className="form-control" type="number" min="1" max="40" value={form.maxWeeklyHours}
                    onChange={e => setForm({ ...form, maxWeeklyHours: e.target.value })}
                    onBlur={e => {
                      const v = e.target.value;
                      if (v === "") return; // bo'sh qolsa saqlashda 18 bo'ladi
                      setForm(f => ({ ...f, maxWeeklyHours: Math.max(1, Math.min(40, parseInt(v, 10) || 18)) }));
                    }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-control" value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}>
                  <option>Bo'sh</option>
                  <option>Band</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Dam olish kunlari (bu kunlarga dars qo'yilmaydi)</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  {DAYS.map(d => {
                    const on = (form.offDays || []).includes(d);
                    return (
                      <button type="button" key={d} onClick={() => toggleOffDay(d)}
                        className={`btn btn-sm ${on ? "btn-danger" : "btn-secondary"}`}>
                        {on ? "✓ " : ""}{d}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {(form.offDays || []).length === 0
                    ? "Hozir: dam kuni yo'q (hamma kun dars berishi mumkin)"
                    : `Dam: ${form.offDays.join(", ")}`}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Bekor</button>
              <button className="btn btn-primary" onClick={handleSave}>{editItem ? "Saqlash" : "Qo'shish"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmModal message="Bu o'qituvchini o'chirmoqchimisiz?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
      )}
    </div>
  );
}
