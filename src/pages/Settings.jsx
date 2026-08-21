import { useRef, useState } from "react";
import ConfirmModal from "../components/ConfirmModal";
import { downloadBackup, parseBackup, KEY_LABELS } from "../services/backupService";
import { flushPush } from "../services/cloudSync";

export default function SettingsPage({ settings, setSettings, classes, subjects, teachers, rooms, timeslots, lunchGroups, classSubjects, schedule, shifts, savedSchedules = [], setSavedSchedules, setClasses, setSubjects, setTeachers, setRooms, setTimeslots, setLunchGroups, setShifts, setSchedule, setClassSubjects, toast, darkMode, setDarkMode, currentUser }) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const fileRef = useRef(null);
  // Yuklangan JSON tekshiruvdan o'tgach shu yerda kutadi — foydalanuvchi
  // tasdiqlamaguncha hech narsa almashtirilmaydi.
  const [pending, setPending] = useState(null); // { data, counts, keys, meta, fileName }

  const isSuperadmin = currentUser?.role === "superadmin";

  function handleClearAll() {
    setClasses([]);
    setSubjects([]);
    setTeachers([]);
    setRooms([]);
    setTimeslots([]);
    setLunchGroups([]);
    if (setShifts) setShifts([]);
    setClassSubjects({});
    setSchedule({});
    if (setSavedSchedules) setSavedSchedules([]);
    setShowClearConfirm(false);
    toast("Barcha ma'lumotlar o'chirildi", "error");
  }

  // ——— Zaxira nusxani JSON faylga yozib olish ———
  function handleExportBackup() {
    try {
      const backup = downloadBackup(
        { settings, classes, subjects, teachers, classSubjects, rooms, timeslots, lunchGroups, shifts, schedule, savedSchedules },
        { schoolName: settings?.schoolName }
      );
      const total = Object.values(backup.counts).reduce((a, b) => a + b, 0);
      toast(`Zaxira nusxa yuklab olindi — ${total} ta yozuv ✓`, "success");
    } catch (e) {
      toast(e.message || "Zaxira nusxa yaratishda xatolik", "error");
    }
  }

  // ——— JSON faylni o'qish (hali qo'llanmaydi — avval tasdiq so'raladi) ———
  async function handlePickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // bir xil faylni qayta tanlash uchun
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBackup(text);
      setPending({ ...parsed, fileName: file.name });
    } catch (err) {
      toast(err.message || "Faylni o'qib bo'lmadi", "error");
    }
  }

  // ——— Tasdiqdan keyin ma'lumotni qo'llash ———
  // Faqat faylda BOR kalitlar almashtiriladi, qolganlariga tegilmaydi.
  // Setterlar App.jsx dagi effektlarni uyg'otadi: localStorage'ga yoziladi
  // va bulutga push qilinadi (flushPush — darhol, kutmasdan).
  function applyRestore() {
    if (!pending) return;
    const { data, keys } = pending;
    const setterOf = {
      settings: setSettings,
      classes: setClasses,
      subjects: setSubjects,
      teachers: setTeachers,
      classSubjects: setClassSubjects,
      rooms: setRooms,
      timeslots: setTimeslots,
      lunchGroups: setLunchGroups,
      shifts: setShifts,
      schedule: setSchedule,
      savedSchedules: setSavedSchedules,
    };
    keys.forEach((k) => setterOf[k]?.(data[k]));
    setPending(null);
    toast(`Ma'lumot tiklandi — ${keys.length} ta bo'lim ✓`, "success");
    // Bulutga darhol yuborish (debounce kutilmasin)
    setTimeout(() => { flushPush().catch(() => {}); }, 1200);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sozlamalar</div>
          <div className="page-subtitle">Tizim va umumiy sozlamalar</div>
        </div>
      </div>
      <div className="page-body">
        <div className="card" style={{ maxWidth: 640 }}>
          <div className="card-body">
            {/* General */}
            <div className="settings-section">
              <div className="settings-section-title">Umumiy sozlamalar</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">Maktab nomi</div>
                  <div className="settings-row-desc">Jadval sarlavhasida ko'rinadi</div>
                </div>
                <input className="form-control" style={{ width: 240 }} value={settings.schoolName || ""}
                  placeholder="Maktab nomi" onChange={e => setSettings({ ...settings, schoolName: e.target.value })} />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">O'quv yili</div>
                  <div className="settings-row-desc">Masalan: 2024-2025</div>
                </div>
                <input className="form-control" style={{ width: 160 }} value={settings.academicYear || ""}
                  placeholder="2024-2025" onChange={e => setSettings({ ...settings, academicYear: e.target.value })} />
              </div>
            </div>

            {/* Appearance */}
            <div className="settings-section">
              <div className="settings-section-title">Ko'rinish</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">Qorong'i rejim</div>
                  <div className="settings-row-desc">Dark mode ni yoqish/o'chirish</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={darkMode} onChange={e => setDarkMode(e.target.checked)} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            {/* Zaxira nusxa — FAQAT SUPERADMIN uchun */}
            {isSuperadmin && (
              <div className="settings-section">
                <div className="settings-section-title">Zaxira nusxa (JSON) · superadmin</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Zaxira nusxani yuklab olish</div>
                    <div className="settings-row-desc">
                      Barcha ma'lumot (sinf, fan, o'qituvchi, xona, vaqt, smena, yuklama va
                      dars jadvali) bitta JSON faylga yoziladi
                    </div>
                  </div>
                  <button className="btn btn-secondary" onClick={handleExportBackup}>⬇️ JSON</button>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">JSON fayldan tiklash</div>
                    <div className="settings-row-desc">
                      Faylda bor bo'limlar joriy ma'lumot ustiga yoziladi. Tiklashdan oldin
                      hozirgi holatni yuklab olib qo'ying
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>⬆️ Fayl tanlash</button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={handlePickFile}
                />
              </div>
            )}

            {/* Data */}
            <div className="settings-section">
              <div className="settings-section-title">Ma'lumotlar</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label" style={{ color: "var(--danger)" }}>Barcha ma'lumotlarni o'chirish</div>
                  <div className="settings-row-desc">Bu amalni qaytarib bo'lmaydi!</div>
                </div>
                <button className="btn btn-danger" onClick={() => setShowClearConfirm(true)}>🗑️ O'chirish</button>
              </div>
            </div>

            {/* Stats */}
            <div className="settings-section">
              <div className="settings-section-title">Tizim ma'lumotlari</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["🏫 Sinflar", classes.length],
                  ["📚 Fanlar", subjects.length],
                  ["👩‍🏫 O'qituvchilar", teachers.length],
                  ["🚪 Xonalar", rooms.length],
                  ["⏰ Dars vaqtlari", timeslots.length],
                  ["🍽️ Obed guruhlari", lunchGroups?.length || 0],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: "var(--content-bg)", borderRadius: 8, padding: "12px 14px", border: "1px solid var(--card-border)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div>
                    <div style={{ fontWeight: 700, fontSize: 20, color: "var(--text-primary)", marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tiklash oldidan ko'rib chiqish — nima almashishi aniq ko'rsatiladi */}
      {pending && (
        <div className="modal-overlay" onClick={() => setPending(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">♻️ Ma'lumotni tiklash</span>
              <button className="modal-close" onClick={() => setPending(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10, wordBreak: "break-all" }}>
                📄 {pending.fileName}
                {pending.meta?.exportedAt && (
                  <> · {new Date(pending.meta.exportedAt).toLocaleString("uz-UZ")}</>
                )}
                {pending.meta?.schoolName && <> · {pending.meta.schoolName}</>}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {pending.keys.map((k) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, padding: "6px 10px", background: "var(--content-bg)", borderRadius: 8, border: "1px solid var(--card-border)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{KEY_LABELS[k] || k}</span>
                    <b style={{ color: "var(--text-primary)" }}>{pending.counts[k]}</b>
                  </div>
                ))}
              </div>
              {pending.bad?.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>
                  ⚠️ Turi noto'g'ri, o'tkazib yuborildi: {pending.bad.join(", ")}
                </div>
              )}
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Yuqoridagi bo'limlar joriy ma'lumot o'rniga yoziladi va bulutga yuboriladi.
                Boshqa bo'limlarga tegilmaydi.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPending(null)}>Bekor qilish</button>
              <button className="btn btn-primary" onClick={applyRestore}>♻️ Tiklash</button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <ConfirmModal
          message="BARCHA ma'lumotlarni o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi!"
          onConfirm={handleClearAll}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
