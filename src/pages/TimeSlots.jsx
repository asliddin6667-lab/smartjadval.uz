import { Fragment, useMemo, useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { genId } from "../utils/helpers";

const SLOT_TYPES = [
  { value: "lesson", label: "Dars", icon: "📘", badge: "badge-info" },
  { value: "lunch", label: "Obed", icon: "🍽️", badge: "badge-warning" },
  { value: "break", label: "Tanaffus", icon: "☕", badge: "badge-default" },
];

const NO_SHIFT = "__none__";

function slotTypeInfo(type) {
  return SLOT_TYPES.find(t => t.value === type) || SLOT_TYPES[0];
}

export default function TimeslotsPage({ timeslots, setTimeslots, classes = [], shifts = [], setShifts, toast }) {
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ lessonNumber: 1, startTime: "08:00", endTime: "08:45", type: "lesson", title: "", classIds: [] });

  // ——— Smena bo'yicha ko'rish (filtr) ———
  const [shiftFilter, setShiftFilter] = useState("all");

  // ——— Ommaviy biriktirish (smena sozlash) ———
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSlotIds, setBulkSlotIds] = useState([]);
  const [bulkClassIds, setBulkClassIds] = useState([]);
  const [bulkMode, setBulkMode] = useState("replace"); // replace | add

  // ——— Smena (shift) boshqaruvi ———
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editShift, setEditShift] = useState(null);
  const [deleteShiftId, setDeleteShiftId] = useState(null);
  const [shiftForm, setShiftForm] = useState({ name: "", classIds: [], slots: [], gen: { count: 6, start: "08:00", dur: 45, brk: 5 } });

  const sortedClasses = useMemo(() => [...classes].sort((a, b) => (
    String(a.name).localeCompare(String(b.name), "uz", { numeric: true })
  )), [classes]);

  const classNameById = useMemo(() => new Map(classes.map(c => [c.id, c.name])), [classes]);

  const sorted = useMemo(() => (
    [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber))
  ), [timeslots]);

  // ——— SMENALARGA BO'LISH ———
  // Har smena o'z ichida 1 dan boshlab raqamlanadi: 1-dars, 2-dars …
  // (global lessonNumber ichkarida saqlanadi — generator shunga tayanadi)
  const groups = useMemo(() => {
    const map = new Map();
    const none = [];
    sorted.forEach(t => {
      if (t.shiftId) {
        if (!map.has(t.shiftId)) {
          const sh = (shifts || []).find(s => s.id === t.shiftId);
          map.set(t.shiftId, { id: t.shiftId, name: t.shiftName || sh?.name || "Smena", slots: [] });
        }
        map.get(t.shiftId).slots.push(t);
      } else {
        none.push(t);
      }
    });
    // smenalar tartibi — shifts ro'yxati bo'yicha
    const out = [];
    (shifts || []).forEach(sh => { if (map.has(sh.id)) { out.push(map.get(sh.id)); map.delete(sh.id); } });
    map.forEach(g => out.push(g));
    if (none.length) out.push({ id: NO_SHIFT, name: "Umumiy vaqtlar (smenasiz)", slots: none });
    return out;
  }, [sorted, shifts]);

  const visibleGroups = shiftFilter === "all" ? groups : groups.filter(g => g.id === shiftFilter);

  function timeToMin(t) { const [h, m] = String(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); }
  function minToTime(x) { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; }

  function groupRange(slots) {
    if (!slots.length) return "—";
    const first = [...slots].sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime))[0];
    const last = [...slots].sort((a, b) => timeToMin(b.endTime) - timeToMin(a.endTime))[0];
    return `${first.startTime}–${last.endTime}`;
  }

  // Smena ichidagi dars raqami (ro'yxatdagi o'rni bo'yicha)
  function innerNumber(group, idx) {
    return idx + 1;
  }

  function openAdd(type = "lesson") {
    const maxNum = timeslots.reduce((mx, t) => Math.max(mx, Number(t.lessonNumber) || 0), 0);
    setEditItem(null);
    setForm({
      lessonNumber: maxNum + 1,
      startTime: type === "lunch" ? "12:30" : "08:00",
      endTime: type === "lunch" ? "13:10" : "08:45",
      type,
      title: type === "lunch" ? "Obed vaqti" : type === "break" ? "Tanaffus" : "",
      classIds: []
    });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({
      lessonNumber: item.lessonNumber,
      startTime: item.startTime,
      endTime: item.endTime,
      type: item.type || "lesson",
      title: item.title || "",
      classIds: Array.isArray(item.classIds) ? item.classIds.filter(id => classNameById.has(id)) : []
    });
    setShowModal(true);
  }

  function toggleClass(classId) {
    setForm(f => ({
      ...f,
      classIds: f.classIds.includes(classId)
        ? f.classIds.filter(id => id !== classId)
        : [...f.classIds, classId]
    }));
  }

  function handleSave() {
    if (!form.startTime || !form.endTime) return;
    const payload = {
      ...form,
      type: form.type || "lesson",
      lessonNumber: Number(form.lessonNumber) || 1,
      title: form.title?.trim() || (form.type === "lunch" ? "Obed vaqti" : form.type === "break" ? "Tanaffus" : ""),
      classIds: Array.isArray(form.classIds) ? form.classIds : []
    };
    if (editItem) {
      setTimeslots(timeslots.map(t => t.id === editItem.id ? { ...t, ...payload } : t));
      toast("Vaqt yangilandi ✓", "success");
    } else {
      setTimeslots([...timeslots, { id: genId(), ...payload }]);
      toast("Vaqt qo'shildi ✓", "success");
    }
    setShowModal(false);
  }

  function handleDelete() {
    setTimeslots(timeslots.filter(t => t.id !== deleteId));
    setDeleteId(null);
    toast("Vaqt o'chirildi", "error");
  }

  // ——— Smena yordamchi funksiyalari ———
  function genShiftSlots(count, start, dur, brk) {
    const slots = [];
    let cur = timeToMin(start);
    for (let i = 0; i < count; i++) {
      slots.push({ lessonNumber: i + 1, startTime: minToTime(cur), endTime: minToTime(cur + dur), type: "lesson" });
      cur += dur + brk;
    }
    return slots;
  }

  function openShiftAdd() {
    setEditShift(null);
    const num = (shifts?.length || 0) + 1;
    setShiftForm({ name: `${num}-smena`, classIds: [], slots: genShiftSlots(6, "08:00", 45, 5), gen: { count: 6, start: "08:00", dur: 45, brk: 5 } });
    setShiftModalOpen(true);
  }

  function openShiftEdit(shift) {
    setEditShift(shift);
    const shiftSlots = timeslots
      .filter(t => t.shiftId === shift.id)
      .sort((a, b) => Number(a.shiftLessonNumber || a.lessonNumber) - Number(b.shiftLessonNumber || b.lessonNumber))
      .map(t => ({ lessonNumber: t.shiftLessonNumber || t.lessonNumber, startTime: t.startTime, endTime: t.endTime, type: t.type || "lesson" }));
    setShiftForm({
      name: shift.name || "",
      classIds: Array.isArray(shift.classIds) ? shift.classIds.filter(id => classNameById.has(id)) : [],
      slots: shiftSlots.length ? shiftSlots.map((s, i) => ({ ...s, lessonNumber: i + 1 })) : genShiftSlots(6, "08:00", 45, 5),
      gen: { count: shiftSlots.length || 6, start: shiftSlots[0]?.startTime || "08:00", dur: 45, brk: 5 },
    });
    setShiftModalOpen(true);
  }

  function applyGen() {
    const { count, start, dur, brk } = shiftForm.gen;
    const slots = genShiftSlots(Math.max(1, Number(count) || 1), start, Math.max(1, Number(dur) || 45), Math.max(0, Number(brk) || 0));
    setShiftForm(f => ({ ...f, slots }));
    toast(`${slots.length} ta dars vaqti tayyorlandi`, "success");
  }

  function removeShiftSlot(idx) {
    setShiftForm(f => ({ ...f, slots: f.slots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, lessonNumber: i + 1 })) }));
  }

  function updateShiftSlot(idx, patch) {
    setShiftForm(f => ({ ...f, slots: f.slots.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  }

  function addShiftSlot(type = "lesson") {
    setShiftForm(f => {
      const last = f.slots[f.slots.length - 1];
      const startMin = last ? timeToMin(last.endTime) + (Number(f.gen.brk) || 5) : timeToMin(f.gen.start || "08:00");
      const dur = type === "lunch" ? 40 : (Number(f.gen.dur) || 45);
      return { ...f, slots: [...f.slots, { lessonNumber: f.slots.length + 1, startTime: minToTime(startMin), endTime: minToTime(startMin + dur), type }] };
    });
  }

  function toggleShiftClass(cid) {
    setShiftForm(f => ({ ...f, classIds: f.classIds.includes(cid) ? f.classIds.filter(x => x !== cid) : [...f.classIds, cid] }));
  }

  function saveShift() {
    if (!shiftForm.name.trim()) { toast("Smena nomini kiriting", "warning"); return; }
    if (!shiftForm.slots.length) { toast("Kamida bitta dars vaqti kiriting", "warning"); return; }
    if (!shiftForm.classIds.length) { toast("Smenaga kamida bitta sinf biriktiring", "warning"); return; }
    const shiftId = editShift ? editShift.id : genId();
    const shiftObj = { id: shiftId, name: shiftForm.name.trim(), classIds: [...shiftForm.classIds] };

    const nextShifts = editShift
      ? (shifts || []).map(s => s.id === shiftId ? shiftObj : s)
      : [...(shifts || []), shiftObj];
    if (typeof setShifts === "function") setShifts(nextShifts);

    // Bu smenaning eski vaqtlarini olib tashlab, yangilarini qo'shamiz.
    // Global lessonNumber uzluksiz bo'ladi (generator to'g'ri tartiblashi uchun),
    // ekranda esa smena ichki raqami ko'rsatiladi: 1-dars, 2-dars …
    const withoutThisShift = timeslots.filter(t => t.shiftId !== shiftId);
    const maxLesson = withoutThisShift.reduce((mx, t) => Math.max(mx, Number(t.lessonNumber) || 0), 0);
    const newSlots = shiftForm.slots.map((s, i) => ({
      id: genId(),
      lessonNumber: maxLesson + i + 1,       // GLOBAL — generator uchun
      shiftLessonNumber: i + 1,              // smena ichki raqami (ko'rsatish uchun)
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type || "lesson",
      title: s.type === "lunch" ? "Obed vaqti" : s.type === "break" ? "Tanaffus" : "",
      classIds: [...shiftForm.classIds],     // smena sinflari — generator shu bo'yicha cheklaydi
      shiftId,
      shiftName: shiftForm.name.trim(),
    }));
    setTimeslots([...withoutThisShift, ...newSlots]);
    toast(editShift ? "Smena yangilandi ✓" : `Smena yaratildi: ${newSlots.length} vaqt, ${shiftForm.classIds.length} sinf ✓`, "success");
    setShiftModalOpen(false);
    setShiftFilter(shiftId);
  }

  function confirmDeleteShift() {
    const id = deleteShiftId;
    if (typeof setShifts === "function") setShifts((shifts || []).filter(s => s.id !== id));
    setTimeslots(timeslots.filter(t => t.shiftId !== id));
    setDeleteShiftId(null);
    if (shiftFilter === id) setShiftFilter("all");
    toast("Smena o'chirildi", "error");
  }

  // Smena kartasi uchun statistika
  function shiftInfo(shift) {
    const slots = timeslots.filter(t => t.shiftId === shift.id);
    return { count: slots.length, range: groupRange(slots), classCount: (shift.classIds || []).length };
  }

  function openBulk() {
    setBulkSlotIds([]);
    setBulkClassIds([]);
    setBulkMode("replace");
    setBulkOpen(true);
  }

  function toggleBulkSlot(id) {
    setBulkSlotIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleBulkClass(id) {
    setBulkClassIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function applyBulk() {
    if (!bulkSlotIds.length) { toast("Kamida bitta vaqt tanlang", "warning"); return; }
    if (!bulkClassIds.length) { toast("Kamida bitta sinf tanlang", "warning"); return; }
    setTimeslots(timeslots.map(t => {
      if (!bulkSlotIds.includes(t.id)) return t;
      const prev = Array.isArray(t.classIds) ? t.classIds : [];
      const nextIds = bulkMode === "add"
        ? [...new Set([...prev, ...bulkClassIds])]
        : [...bulkClassIds];
      return { ...t, classIds: nextIds };
    }));
    toast(`${bulkSlotIds.length} ta vaqtga ${bulkClassIds.length} ta sinf biriktirildi ✓`, "success");
    setBulkOpen(false);
  }

  function clearBulkAssignment() {
    if (!bulkSlotIds.length) { toast("Kamida bitta vaqt tanlang", "warning"); return; }
    setTimeslots(timeslots.map(t => bulkSlotIds.includes(t.id) ? { ...t, classIds: [] } : t));
    toast("Biriktiruv olib tashlandi — bu vaqtlar endi barcha sinflarga tegishli ✓", "success");
    setBulkOpen(false);
  }

  // Slotga biriktirilgan sinflar uchun chip ko'rinishi
  function renderClassChips(t) {
    const ids = Array.isArray(t.classIds) ? t.classIds.filter(id => classNameById.has(id)) : [];
    if (!ids.length) {
      return <span className="badge badge-default" title="Bu vaqt barcha sinflarga tegishli">🌐 Barcha sinflar</span>;
    }
    const names = ids
      .map(id => classNameById.get(id))
      .sort((a, b) => String(a).localeCompare(String(b), "uz", { numeric: true }));
    const shown = names.slice(0, 4);
    const rest = names.length - shown.length;
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }} title={names.join(", ")}>
        {shown.map(n => (
          <span key={n} style={{ background: "var(--accent-light)", color: "var(--accent)", borderRadius: 8, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            {n}
          </span>
        ))}
        {rest > 0 && (
          <span style={{ background: "var(--bg-secondary, #f1f5f9)", color: "var(--text-secondary)", borderRadius: 8, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
            +{rest}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dars Vaqtlari</div>
          <div className="page-subtitle">Dars, obed va tanaffus vaqtlarini belgilang. Obed/tanaffusga dars qo'yilmaydi.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={openShiftAdd}>🕐 Smena yaratish</button>
          <button className="btn btn-success" onClick={openBulk}>🏫 Smena / sinf biriktirish</button>
          <button className="btn btn-warning" onClick={() => openAdd("lunch")}>🍽️ Obed qo'shish</button>
          <button className="btn btn-secondary" onClick={() => openAdd("break")}>☕ Tanaffus qo'shish</button>
          <button className="btn btn-primary" onClick={() => openAdd("lesson")}>＋ Dars vaqti</button>
        </div>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              ℹ️ Avtomatik jadval obed va tanaffus qatorlarini tashlab o'tadi. Bu vaqtlarda sinf, ustoz va xona band qilinmaydi.
              Sinf biriktirilmagan vaqt <b>barcha sinflarga</b> tegishli bo'ladi; sinf biriktirilsa — faqat o'sha sinflar jadvalida ishlatiladi.
              Har smena o'z ichida <b>1-dars, 2-dars…</b> deb raqamlanadi.
            </div>
          </div>
        </div>

        {(shifts && shifts.length > 0) && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>🕐 Smenalar</div>
                <button className="btn btn-primary btn-sm" onClick={openShiftAdd}>＋ Yana smena</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {shifts.map(sh => {
                  const inf = shiftInfo(sh);
                  const names = (sh.classIds || []).map(id => classNameById.get(id)).filter(Boolean)
                    .sort((a, b) => String(a).localeCompare(String(b), "uz", { numeric: true }));
                  const activeCard = shiftFilter === sh.id;
                  return (
                    <div key={sh.id}
                      style={{
                        border: activeCard ? "2px solid var(--accent, #6366f1)" : "1px solid var(--card-border, #e2e8f0)",
                        borderRadius: 12, padding: 14, background: "var(--card-bg, #fff)", cursor: "pointer",
                      }}
                      onClick={() => setShiftFilter(activeCard ? "all" : sh.id)}
                      title="Bosing — faqat shu smena vaqtlari ko'rsatiladi">
                      <div style={{ fontWeight: 800, fontSize: 16 }}>{sh.name}</div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.6 }}>
                        🕐 {inf.count} dars vaqti · {inf.range}<br />
                        🏫 {inf.classCount} sinf
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6, maxHeight: 48, overflow: "auto" }}>
                        {names.length ? names.join(", ") : <span style={{ color: "#dc2626" }}>Sinf biriktirilmagan</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                        <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openShiftEdit(sh); }}>⚙️ Sozlash</button>
                        <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setDeleteShiftId(sh.id); }}>🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {groups.length > 1 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: "var(--text-secondary)" }}>Ko'rsatish:</span>
              <button type="button" onClick={() => setShiftFilter("all")}
                style={{
                  border: shiftFilter === "all" ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                  background: shiftFilter === "all" ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                  color: shiftFilter === "all" ? "#fff" : "var(--text-secondary, #475569)",
                  borderRadius: 9, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap"
                }}>
                Hammasi ({sorted.length})
              </button>
              {groups.map(g => {
                const active = shiftFilter === g.id;
                return (
                  <button key={g.id} type="button" onClick={() => setShiftFilter(g.id)}
                    style={{
                      border: active ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                      background: active ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                      color: active ? "#fff" : "var(--text-secondary, #475569)",
                      borderRadius: 9, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap"
                    }}>
                    🕐 {g.name} ({g.slots.length})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-body">
            {sorted.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">⏰</div>
                <div className="empty-state-title">Dars vaqtlari topilmadi</div>
                <div className="empty-state-desc">Yangi vaqt qo'shing</div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Turi</th>
                    <th>Nomi</th>
                    <th>Boshlanish</th>
                    <th>Tugash</th>
                    <th>Davomiyligi</th>
                    <th>Sinflar</th>
                    <th>Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGroups.map(g => (
                    <Fragment key={g.id}>
                      {groups.length > 1 && (
                        <tr>
                          <td colSpan={8} style={{ background: "var(--accent-light, #eef2ff)", fontWeight: 800, color: "var(--accent, #4338ca)", fontSize: 14 }}>
                            🕐 {g.name} · {g.slots.length} vaqt · {groupRange(g.slots)}
                          </td>
                        </tr>
                      )}
                      {g.slots.map((t, idx) => {
                        const [sh, sm] = t.startTime.split(":").map(Number);
                        const [eh, em] = t.endTime.split(":").map(Number);
                        const dur = (eh * 60 + em) - (sh * 60 + sm);
                        const info = slotTypeInfo(t.type || "lesson");
                        const num = innerNumber(g, idx);
                        return (
                          <tr key={t.id} style={(t.type === "lunch" || t.type === "break") ? { background: "var(--warning-light)" } : undefined}>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={`Umumiy tartib: ${t.lessonNumber}`}>
                                <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                                  {num}
                                </div>
                                <span style={{ fontWeight: 600 }}>{num}</span>
                              </div>
                            </td>
                            <td><span className={`badge ${info.badge}`}>{info.icon} {info.label}</span></td>
                            <td style={{ fontWeight: 600 }}>
                              {t.title || (t.type === "lesson" || !t.type ? `${num}-dars` : info.label)}
                              {t.shiftName && <span className="badge badge-default" style={{ marginLeft: 6, fontSize: 11 }}>🕐 {t.shiftName}</span>}
                            </td>
                            <td style={{ fontWeight: 600, fontSize: 15 }}>{t.startTime}</td>
                            <td style={{ fontWeight: 600, fontSize: 15 }}>{t.endTime}</td>
                            <td><span className="badge badge-info">{dur} daqiqa</span></td>
                            <td>{renderClassChips(t)}</td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="btn btn-icon" onClick={() => openEdit(t)}>✏️</button>
                                <button className="btn btn-icon" onClick={() => setDeleteId(t.id)}>🗑️</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
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
              <span className="modal-title">{editItem ? "Vaqt tahrirlash" : "Yangi vaqt"}</span>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tartib raqami <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>(umumiy)</span></label>
                  <input className="form-control" type="number" min="1" value={form.lessonNumber}
                    onChange={e => setForm({ ...form, lessonNumber: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Vaqt turi</label>
                  <select className="form-control" value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value, title: e.target.value === "lunch" ? "Obed vaqti" : e.target.value === "break" ? "Tanaffus" : "" })}>
                    {SLOT_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Nomi</label>
                <input className="form-control" placeholder="Masalan: Obed vaqti" value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Boshlanish vaqti</label>
                  <input className="form-control" type="time" value={form.startTime}
                    onChange={e => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Tugash vaqti</label>
                  <input className="form-control" type="time" value={form.endTime}
                    onChange={e => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Sinflar <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>(ixtiyoriy — tanlanmasa barcha sinflarga tegishli)</span>
                </label>
                {sortedClasses.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Hali sinflar qo'shilmagan.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <button type="button" className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: 13 }}
                        onClick={() => setForm(f => ({ ...f, classIds: sortedClasses.map(c => c.id) }))}>
                        ✓ Hammasini belgilash
                      </button>
                      <button type="button" className="btn btn-secondary" style={{ padding: "4px 12px", fontSize: 13 }}
                        onClick={() => setForm(f => ({ ...f, classIds: [] }))}>
                        ✕ Tozalash
                      </button>
                      <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                        {form.classIds.length ? `${form.classIds.length} ta tanlandi` : "Barcha sinflar"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 170, overflowY: "auto", padding: 8, border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, background: "var(--bg-secondary, #f8fafc)" }}>
                      {sortedClasses.map(c => {
                        const active = form.classIds.includes(c.id);
                        return (
                          <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                            style={{
                              border: active ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                              background: active ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                              color: active ? "#fff" : "var(--text-secondary, #475569)",
                              borderRadius: 9,
                              padding: "5px 12px",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                              transition: "all .15s",
                              whiteSpace: "nowrap"
                            }}>
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Bekor</button>
              <button className="btn btn-primary" onClick={handleSave}>{editItem ? "Saqlash" : "Qo'shish"}</button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="modal-overlay" onClick={() => setBulkOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <span className="modal-title">🏫 Smena / sinf biriktirish</span>
              <button className="modal-close" onClick={() => setBulkOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 13 }}>
                💡 Masalan: 1–5-darslarni tanlab <b>1-smena</b> sinflarini biriktiring, keyin 6–10-darslarni tanlab <b>2-smena</b> sinflarini biriktiring.
              </div>

              <div className="form-group">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label className="form-label" style={{ margin: 0 }}>1) Vaqtlarni tanlang</label>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                    {bulkSlotIds.length ? `${bulkSlotIds.length} ta tanlandi` : "—"}
                  </span>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setBulkSlotIds(sorted.map(t => t.id))}>Hammasi</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setBulkSlotIds([])}>Tozalash</button>
                </div>
                <div style={{ maxHeight: 190, overflowY: "auto", padding: 8, border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, background: "var(--bg-secondary, #f8fafc)" }}>
                  {groups.map(g => (
                    <div key={g.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--accent)" }}>🕐 {g.name}</span>
                        <button type="button" className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 11.5 }}
                          onClick={() => setBulkSlotIds(prev => [...new Set([...prev, ...g.slots.map(s => s.id)])])}>
                          Shu smenani tanlash
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {g.slots.map((t, idx) => {
                          const active = bulkSlotIds.includes(t.id);
                          const info = slotTypeInfo(t.type || "lesson");
                          return (
                            <button key={t.id} type="button" onClick={() => toggleBulkSlot(t.id)}
                              style={{
                                border: active ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                                background: active ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                                color: active ? "#fff" : "var(--text-secondary, #475569)",
                                borderRadius: 9, padding: "5px 11px", fontSize: 13, fontWeight: 700,
                                cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap"
                              }}>
                              {info.icon} {idx + 1}{(t.type === "lesson" || !t.type) ? "-dars" : ""} · {t.startTime}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label className="form-label" style={{ margin: 0 }}>2) Sinflarni tanlang</label>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                    {bulkClassIds.length ? `${bulkClassIds.length} ta tanlandi` : "—"}
                  </span>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setBulkClassIds(sortedClasses.map(c => c.id))}>Hammasi</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setBulkClassIds([])}>Tozalash</button>
                </div>
                {sortedClasses.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Hali sinflar qo'shilmagan.</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 150, overflowY: "auto", padding: 8, border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, background: "var(--bg-secondary, #f8fafc)" }}>
                    {sortedClasses.map(c => {
                      const active = bulkClassIds.includes(c.id);
                      return (
                        <button key={c.id} type="button" onClick={() => toggleBulkClass(c.id)}
                          style={{
                            border: active ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                            background: active ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                            color: active ? "#fff" : "var(--text-secondary, #475569)",
                            borderRadius: 9, padding: "5px 12px", fontSize: 13, fontWeight: 700,
                            cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap"
                          }}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">3) Rejim</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
                    <input type="radio" name="bulkMode" checked={bulkMode === "replace"} onChange={() => setBulkMode("replace")} style={{ marginTop: 2 }} />
                    <span><b>Almashtirish</b> — tanlangan vaqtlarga <u>faqat</u> shu sinflar biriktiriladi (smena sozlash uchun qulay)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13 }}>
                    <input type="radio" name="bulkMode" checked={bulkMode === "add"} onChange={() => setBulkMode("add")} style={{ marginTop: 2 }} />
                    <span><b>Qo'shish</b> — mavjud biriktirilgan sinflar ustiga shu sinflar qo'shiladi</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={() => setBulkOpen(false)}>Bekor</button>
              <button className="btn btn-warning" onClick={clearBulkAssignment} title="Tanlangan vaqtlardagi sinf biriktiruvini o'chiradi — vaqtlar yana barcha sinflarga tegishli bo'ladi">
                🌐 Biriktiruvni olib tashlash
              </button>
              <button className="btn btn-primary" onClick={applyBulk} style={{ marginLeft: "auto" }}>✓ Biriktirish</button>
            </div>
          </div>
        </div>
      )}

      {shiftModalOpen && (
        <div className="modal-overlay" onClick={() => setShiftModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <span className="modal-title">🕐 {editShift ? "Smenani sozlash" : "Yangi smena"}</span>
              <button className="modal-close" onClick={() => setShiftModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Smena nomi</label>
                <input className="form-control" placeholder="Masalan: 1-smena" value={shiftForm.name}
                  onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {/* 1) Dars vaqtlari — avtomatik tayyorlash */}
              <div className="form-group">
                <label className="form-label">1) Dars vaqtlari</label>
                <div style={{ background: "var(--bg-secondary, #f8fafc)", border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>⚡ Avtomatik tayyorlash</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                    <div>
                      <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Nechta dars</label>
                      <input className="form-control" type="number" min="1" max="14" value={shiftForm.gen.count}
                        onChange={e => setShiftForm(f => ({ ...f, gen: { ...f.gen, count: e.target.value } }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Boshlanish</label>
                      <input className="form-control" type="time" value={shiftForm.gen.start}
                        onChange={e => setShiftForm(f => ({ ...f, gen: { ...f.gen, start: e.target.value } }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Dars (daq)</label>
                      <input className="form-control" type="number" min="1" value={shiftForm.gen.dur}
                        onChange={e => setShiftForm(f => ({ ...f, gen: { ...f.gen, dur: e.target.value } }))} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Tanaffus (daq)</label>
                      <input className="form-control" type="number" min="0" value={shiftForm.gen.brk}
                        onChange={e => setShiftForm(f => ({ ...f, gen: { ...f.gen, brk: e.target.value } }))} />
                    </div>
                    <button type="button" className="btn btn-primary" onClick={applyGen} style={{ whiteSpace: "nowrap" }}>Tayyorlash</button>
                  </div>
                </div>

                {/* Vaqtlar ro'yxati — qo'lda tahrir */}
                <div style={{ border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, padding: 10, maxHeight: 240, overflowY: "auto" }}>
                  {shiftForm.slots.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", padding: 10 }}>Hali dars vaqti yo'q. Yuqoridan "Tayyorlash" bosing yoki "Vaqt qo'shish".</div>
                  ) : (
                    shiftForm.slots.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--accent-light)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                        <select className="form-control" value={s.type || "lesson"} style={{ maxWidth: 120 }}
                          onChange={e => updateShiftSlot(i, { type: e.target.value })}>
                          {SLOT_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                        </select>
                        <input className="form-control" type="time" value={s.startTime} style={{ maxWidth: 130 }}
                          onChange={e => updateShiftSlot(i, { startTime: e.target.value })} />
                        <span style={{ color: "var(--text-secondary)" }}>—</span>
                        <input className="form-control" type="time" value={s.endTime} style={{ maxWidth: 130 }}
                          onChange={e => updateShiftSlot(i, { endTime: e.target.value })} />
                        <button type="button" className="btn btn-icon" onClick={() => removeShiftSlot(i)} title="O'chirish" style={{ marginLeft: "auto" }}>🗑️</button>
                      </div>
                    ))
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addShiftSlot("lesson")}>＋ Dars vaqti</button>
                    <button type="button" className="btn btn-warning btn-sm" onClick={() => addShiftSlot("lunch")}>🍽️ Obed</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addShiftSlot("break")}>☕ Tanaffus</button>
                  </div>
                </div>
              </div>

              {/* 2) Sinflar */}
              <div className="form-group">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label className="form-label" style={{ margin: 0 }}>2) Bu smena sinflari</label>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                    {shiftForm.classIds.length ? `${shiftForm.classIds.length} ta` : "—"}
                  </span>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setShiftForm(f => ({ ...f, classIds: sortedClasses.map(c => c.id) }))}>Hammasi</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 12 }}
                    onClick={() => setShiftForm(f => ({ ...f, classIds: [] }))}>Tozalash</button>
                </div>
                {sortedClasses.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Hali sinflar qo'shilmagan.</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 150, overflowY: "auto", padding: 8, border: "1px solid var(--card-border, #e2e8f0)", borderRadius: 10, background: "var(--bg-secondary, #f8fafc)" }}>
                    {sortedClasses.map(c => {
                      const active = shiftForm.classIds.includes(c.id);
                      return (
                        <button key={c.id} type="button" onClick={() => toggleShiftClass(c.id)}
                          style={{
                            border: active ? "1.5px solid var(--accent, #6366f1)" : "1.5px solid var(--card-border, #e2e8f0)",
                            background: active ? "var(--accent, #6366f1)" : "var(--card-bg, #fff)",
                            color: active ? "#fff" : "var(--text-secondary, #475569)",
                            borderRadius: 9, padding: "5px 12px", fontSize: 13, fontWeight: 700,
                            cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap"
                          }}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                  Bu sinflar faqat shu smena vaqtlarida o'qiydi. Avtomatik jadval ularni boshqa smena vaqtiga qo'ymaydi.
                  Excelga chiqarganda har smena <b>alohida list</b> bo'lib chiqadi.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShiftModalOpen(false)}>Bekor</button>
              <button className="btn btn-primary" onClick={saveShift}>{editShift ? "Saqlash" : "Smena yaratish"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteShiftId && (
        <ConfirmModal
          message="Bu smenani o'chirmoqchimisiz? Smenaning dars vaqtlari ham o'chiriladi."
          onConfirm={confirmDeleteShift}
          onCancel={() => setDeleteShiftId(null)}
        />
      )}

      {deleteId && (
        <ConfirmModal
          message="Bu vaqtni o'chirmoqchimisiz?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
