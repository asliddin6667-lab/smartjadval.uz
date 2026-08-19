import { useMemo, useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";
import { DAYS, TIME_TYPES, typeOfGroup } from "../utils/constants";
import { isTeachingSlot } from "../utils/scheduleGenerator";

const DEFAULT_NAMES = {
  obed: "Obed vaqti",
  tanaffus: "Tanaffus",
  uyqu: "Uyqu vaqti",
  sanat: "San'at vaqti",
  boshqa: "",
};

const DAY_SHORT = { Dushanba: "Du", Seshanba: "Se", Chorshanba: "Chor", Payshanba: "Pay", Juma: "Ju", Shanba: "Sha" };

const NO_SHIFT = "__no_shift__";

export default function LunchGroupsPage({ classes, timeslots = [], shifts = [], lunchGroups, setLunchGroups, toast }) {
  const teachingSlots = [...timeslots].filter(isTeachingSlot).sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));

  // ——— DARS SOATLARINI SMENALARGA BO'LISH ———
  // Ekranda har smena o'z ichida 1-dars, 2-dars … deb ko'rsatiladi
  // (ichkarida global lessonNumber saqlanadi — generator shunga tayanadi)
  const slotGroups = useMemo(() => {
    const map = new Map();
    const none = [];
    teachingSlots.forEach((t) => {
      if (t.shiftId) {
        if (!map.has(t.shiftId)) {
          const sh = (shifts || []).find((x) => x.id === t.shiftId);
          map.set(t.shiftId, { id: t.shiftId, name: t.shiftName || sh?.name || "Smena", slots: [] });
        }
        map.get(t.shiftId).slots.push(t);
      } else {
        none.push(t);
      }
    });
    const out = [];
    (shifts || []).forEach((sh) => { if (map.has(sh.id)) { out.push(map.get(sh.id)); map.delete(sh.id); } });
    map.forEach((g) => out.push(g));
    if (none.length) out.push({ id: NO_SHIFT, name: out.length ? "Smenasiz vaqtlar" : "Dars soatlari", slots: none });
    out.forEach((g) => { g.range = g.slots.length ? `${g.slots[0].startTime}–${g.slots[g.slots.length - 1].endTime}` : "—"; });
    return out;
  }, [teachingSlots, shifts]);

  // Dars soatining smena ichidagi raqami: 1, 2, 3 …
  const slotNumById = useMemo(() => {
    const m = new Map();
    slotGroups.forEach((g) => g.slots.forEach((ts, i) => m.set(ts.id, Number(ts.shiftLessonNumber) || i + 1)));
    return m;
  }, [slotGroups]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ type: "obed", name: "Obed vaqti", days: [...DAYS], timeslotIds: [], classIds: [] });

  function openAdd() {
    setEditItem(null);
    setForm({ type: "obed", name: "Obed vaqti", days: [...DAYS], timeslotIds: [], classIds: [] });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    let days = Array.isArray(item.days) && item.days.length ? item.days : [...DAYS];
    let timeslotIds = Array.isArray(item.timeslotIds) ? item.timeslotIds : [];
    // Eski (vaqt oralig'i) guruh: mos keluvchi dars soatlarini avtomatik belgilaymiz
    if (!timeslotIds.length && item.startTime && item.endTime) {
      timeslotIds = teachingSlots
        .filter((ts) => String(ts.startTime) < String(item.endTime) && String(ts.endTime) > String(item.startTime))
        .map((ts) => ts.id);
    }
    setForm({
      type: typeOfGroup(item).key,
      name: item.name || "Obed vaqti",
      days,
      timeslotIds,
      classIds: Array.isArray(item.classIds) ? item.classIds : [],
    });
    setShowModal(true);
  }

  function toggleDay(day) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  }

  function toggleSlot(tsId) {
    setForm((prev) => ({
      ...prev,
      timeslotIds: prev.timeslotIds.includes(tsId)
        ? prev.timeslotIds.filter((id) => id !== tsId)
        : [...prev.timeslotIds, tsId],
    }));
  }

  // Butun smenani belgilash yoki tozalash
  function toggleSlotGroup(ids, on) {
    setForm((prev) => ({
      ...prev,
      timeslotIds: on
        ? [...new Set([...prev.timeslotIds, ...ids])]
        : prev.timeslotIds.filter((id) => !ids.includes(id)),
    }));
  }

  function pickType(key) {
    setForm((prev) => {
      // Nomi bo'sh yoki avvalgi standart nom bo'lsa — yangi standart nom qo'yamiz
      const isDefaultName = !prev.name.trim() || Object.values(DEFAULT_NAMES).includes(prev.name.trim());
      return { ...prev, type: key, name: isDefaultName ? DEFAULT_NAMES[key] : prev.name };
    });
  }

  function toggleClass(classId) {
    setForm(prev => ({
      ...prev,
      classIds: prev.classIds.includes(classId)
        ? prev.classIds.filter(id => id !== classId)
        : [...prev.classIds, classId]
    }));
  }

  function selectByGrade(min, max) {
    const ids = classes
      .filter(c => {
        const grade = Number(String(c.name || "").match(/^(\d+)/)?.[1] || 0);
        return grade >= min && grade <= max;
      })
      .map(c => c.id);
    setForm(prev => ({ ...prev, classIds: Array.from(new Set([...prev.classIds, ...ids])) }));
  }

  function handleSave() {
    if (!form.name.trim()) return toast("Vaqt nomini kiriting", "error");
    if (!form.days.length) return toast("Kamida bitta kun tanlang", "error");
    if (!form.timeslotIds.length) return toast("Kamida bitta dars soatini tanlang", "error");
    const payload = { ...form, name: form.name.trim(), startTime: undefined, endTime: undefined };
    if (editItem) {
      setLunchGroups(lunchGroups.map(g => g.id === editItem.id ? { ...g, ...payload } : g));
      toast("Vaqt guruhi yangilandi ✓", "success");
    } else {
      setLunchGroups([...lunchGroups, { id: genId(), ...payload, createdAt: Date.now() }]);
      toast("Vaqt guruhi qo'shildi ✓", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    setLunchGroups(lunchGroups.filter(g => g.id !== deleteId));
    setDeleteId(null);
    toast("Vaqt guruhi o'chirildi", "warning");
  }

  function groupBadge(g) {
    if (Array.isArray(g.timeslotIds) && g.timeslotIds.length) {
      const days = Array.isArray(g.days) && g.days.length ? g.days : DAYS;
      const dayTxt = days.length === DAYS.length ? "Har kuni" : days.map((d) => DAY_SHORT[d] || d).join(", ");
      const parts = slotGroups.map((grp) => {
        const nums = grp.slots.filter((ts) => g.timeslotIds.includes(ts.id)).map((ts) => slotNumById.get(ts.id));
        if (!nums.length) return null;
        const txt = `${nums.join(",")}-dars${nums.length > 1 ? "lar" : ""}`;
        return slotGroups.length > 1 ? `${grp.name}: ${txt}` : txt;
      }).filter(Boolean);
      return `${dayTxt} · ${parts.join(" | ")}`;
    }
    return `${g.startTime}–${g.endTime}`; // eski format
  }

  function classNames(ids) {
    return (ids || []).map(id => classes.find(c => c.id === id)?.name).filter(Boolean).join(", ");
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Obed va dam vaqtlari</div>
          <div className="page-subtitle">Obed, tanaffus, uyqu, san'at vaqtlarini kiriting — bu vaqtlarga jadvalda dars qo'yilmaydi</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>＋ Vaqt qo'shish</button>
      </div>

      <div className="page-body">
        <div className="alert alert-info">
          ⏰ Avtomatik jadval tuzilganda tanlangan sinflarga belgilangan vaqtda dars qo'yilmaydi (obed, uyqu, san'at va h.k.). Bu vaqtdan keyin darslar davom etadi.
        </div>

        {lunchGroups.length === 0 ? (
          <div className="card"><div className="empty-state"><div className="empty-state-icon">🍽️</div><div className="empty-state-title">Vaqt guruhi yo'q</div><div className="empty-state-desc">Masalan: 1-7 sinflar uchun obed 12:30–13:10, boshlang'ich sinflar uchun uyqu 14:00–15:00 qilib yarating</div></div></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {lunchGroups.map(g => {
              const tt = typeOfGroup(g);
              return (
                <div key={g.id} className="card" style={{ borderLeft: `5px solid ${tt.color}`, overflow: "hidden" }}>
                  <div className="card-body">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{
                          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 21, background: tt.grad, boxShadow: `0 4px 12px ${tt.color}55`,
                        }}>{tt.icon}</div>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 16 }}>{g.name}</div>
                          <div style={{ marginTop: 5 }}>
                            <span style={{
                              fontSize: 12.5, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
                              background: tt.bg, color: tt.color,
                            }}>{groupBadge(g)}</span>
                          </div>
                        </div>
                      </div>
                      <span className="badge badge-info">{(g.classIds || []).length} sinf</span>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, maxHeight: 70, overflow: "auto" }}>
                      {classNames(g.classIds) || "Sinf tanlanmagan"}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(g)}>✏️ Tahrir</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(g.id)}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">{editItem ? "Vaqt guruhini tahrirlash" : "Yangi vaqt guruhi"}</span><button className="modal-close" onClick={() => setShowModal(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Vaqt turi</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {TIME_TYPES.map(t => {
                    const active = form.type === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => pickType(t.key)}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "9px 15px", borderRadius: 999, cursor: "pointer",
                          fontWeight: 800, fontSize: 13.5,
                          border: active ? "2px solid transparent" : `2px solid ${t.color}44`,
                          background: active ? t.grad : "transparent",
                          color: active ? "#fff" : t.color,
                          boxShadow: active ? `0 5px 14px ${t.color}66` : "none",
                          transform: active ? "scale(1.05)" : "scale(1)",
                          transition: "all .18s",
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{t.icon}</span> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="form-group"><label className="form-label">Nomi</label><input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Masalan: 1-7 sinflar obedi" /></div>
              <div className="form-group">
                <label className="form-label">Qaysi kunlarda</label>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, days: form.days.length === DAYS.length ? [] : [...DAYS] })}>
                    {form.days.length === DAYS.length ? "Hech biri" : "Har kuni"}
                  </button>
                  {DAYS.map((d) => {
                    const on = form.days.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => toggleDay(d)} style={{
                        padding: "8px 13px", borderRadius: 999, cursor: "pointer", fontWeight: 800, fontSize: 13,
                        border: on ? "2px solid transparent" : "2px solid #cbd5e1",
                        background: on ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "transparent",
                        color: on ? "#fff" : "var(--text-secondary)", transition: "all .15s",
                      }}>{DAY_SHORT[d] || d}</button>
                    );
                  })}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Qaysi dars soatlarida (bu soatlarga dars qo'yilmaydi)</label>
                {teachingSlots.length === 0 ? (
                  <div className="alert alert-warning">Avval "Dars vaqtlari" bo'limida dars soatlarini kiriting</div>
                ) : (
                  <div style={{ display: "grid", gap: 11 }}>
                    {slotGroups.length > 1 && (
                      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                        Har smena o'z ichida <b>1-dars, 2-dars…</b> deb raqamlanadi — kerakli smenadan tanlang.
                      </div>
                    )}
                    {slotGroups.map((grp) => {
                      const ids = grp.slots.map((ts) => ts.id);
                      const allOn = ids.every((id) => form.timeslotIds.includes(id));
                      return (
                        <div key={grp.id} style={{ border: "1px solid var(--card-border)", borderRadius: 12, padding: "10px 12px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 9 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                              <span style={{
                                fontSize: 13, fontWeight: 800, padding: "4px 12px", borderRadius: 999,
                                background: "var(--accent-light)", color: "var(--accent)",
                              }}>{grp.name}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                                🕐 {grp.slots.length} dars · {grp.range}
                              </span>
                            </div>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleSlotGroup(ids, !allOn)}>
                              {allOn ? "Tozalash" : "Hammasi"}
                            </button>
                          </div>
                          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                            {grp.slots.map((ts) => {
                              const on = form.timeslotIds.includes(ts.id);
                              return (
                                <button key={ts.id} type="button" onClick={() => toggleSlot(ts.id)} style={{
                                  padding: "8px 12px", borderRadius: 11, cursor: "pointer", fontWeight: 800, fontSize: 12.5,
                                  border: on ? "2px solid transparent" : "2px solid #cbd5e1", lineHeight: 1.35, textAlign: "center",
                                  background: on ? "linear-gradient(135deg,#f59e0b,#d97706)" : "transparent",
                                  color: on ? "#fff" : "var(--text-secondary)", transition: "all .15s",
                                }}>
                                  {slotNumById.get(ts.id)}-dars
                                  <div style={{ fontSize: 10.5, fontWeight: 700, opacity: .85 }}>{ts.startTime}–{ts.endTime}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Sinflarni tanlash</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => selectByGrade(1, 7)}>1–7 sinflar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => selectByGrade(8, 11)}>8–11 sinflar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, classIds: classes.map(c => c.id) })}>Hammasi</button>
                  <button className="btn btn-warning btn-sm" onClick={() => setForm({ ...form, classIds: [] })}>Tozalash</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(95px, 1fr))", gap: 8, maxHeight: 250, overflow: "auto", border: "1px solid var(--card-border)", borderRadius: 10, padding: 10 }}>
                  {classes.map(c => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={form.classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Bekor</button><button className="btn btn-primary" onClick={handleSave}>Saqlash</button></div>
          </div>
        </div>
      )}

      {deleteId && <ConfirmModal message="Bu vaqt guruhini o'chirmoqchimisiz?" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}
