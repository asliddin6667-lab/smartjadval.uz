import { IconEdit, IconTrash } from "../components/ActionIcons";
import { useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";
import { ROOM_TYPES } from "../utils/constants";

export default function RoomsPage({ rooms, setRooms, toast }) {
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: "", capacity: 30, type: "Oddiy" });

  function openAdd() {
    setEditItem(null);
    setForm({ name: "", capacity: 30, type: "Oddiy" });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ name: item.name, capacity: item.capacity, type: item.type });
    setShowModal(true);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editItem) {
      setRooms(rooms.map(r => r.id === editItem.id ? { ...r, ...form } : r));
      toast("Xona yangilandi ✓", "success");
    } else {
      setRooms([...rooms, { id: genId(), ...form, createdAt: Date.now() }]);
      toast("Xona qo'shildi ✓", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    setRooms(rooms.filter(r => r.id !== deleteId));
    setDeleteId(null);
    toast("Xona o'chirildi", "error");
  }

  const typeIcon = { "Oddiy": "🏫", "IT xona": "💻", "Laboratoriya": "🔬", "Sport zal": "⚽" };
  const typeBadge = { "Oddiy": "badge-default", "IT xona": "badge-info", "Laboratoriya": "badge-warning", "Sport zal": "badge-success" };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Xonalar</div>
          <div className="page-subtitle">Sinf xonalari va maxsus kabinetlar</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>＋ Xona qo'shish</button>
      </div>
      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
          {rooms.map(r => (
            <div key={r.id} className="card" style={{ cursor: "pointer" }}>
              <div className="card-body">
                <div style={{ fontSize: 28, marginBottom: 10 }}>{typeIcon[r.type] || "🏫"}</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{r.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span className={`badge ${typeBadge[r.type]}`}>{r.type}</span>
                  <span className="badge badge-default">👥 {r.capacity}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}><IconEdit /> Tahrir</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(r.id)}><IconTrash /></button>
                </div>
              </div>
            </div>
          ))}
          {rooms.length === 0 && (
            <div className="card" style={{ gridColumn: "1/-1" }}>
              <div className="empty-state">
                <div className="empty-state-icon">🚪</div>
                <div className="empty-state-title">Xonalar topilmadi</div>
                <div className="empty-state-desc">Yangi xona qo'shing</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? "Xona tahrirlash" : "Yangi xona"}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Xona nomi *</label>
                <input className="form-control" placeholder="Masalan: 101, Aktovy zal" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Sig'imi</label>
                  <input className="form-control" type="number" min="1" value={form.capacity}
                    onChange={e => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Xona turi</label>
                  <select className="form-control" value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value })}>
                    {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
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
          message="Bu xonani o'chirmoqchimisiz?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// TIMESLOTS PAGE
// ============================================================
