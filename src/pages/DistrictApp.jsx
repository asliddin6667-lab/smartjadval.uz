import { useState, useEffect, useMemo } from "react";
import {
  fetchMyDistrictInfo, fetchDistrictSchools,
  logAction, adminResetPassword,
} from "../services/districtService";
import { fetchExcelStore } from "../services/districtExcelService";
import { userMatchesQuery, eduIdExact, rankUsersByQuery } from "../utils/userSearch";
import {
  ExcelDataPage, SetkaMatrix, JadvalViewer,
  TeacherHoursTable, exportSchoolExcel, buildAutoExcelData,
} from "./districtExcel";
import {
  computeVacancy, VacancyReport, VacancyBadge, vacancySummaryText,
} from "./VacancyAnalysis";
import "./district.css";

// =====================================================================
//  DISTRICT ADMIN (TUMAN ADMINI) PANELI
//
//  Tuman admini FAQAT o'z tumanidagi maktablarni ko'radi (RLS).
//  Ma'lumotlarni o'zgartira olmaydi — faqat ko'rish, Excel eksport
//  va zarur bo'lganda maktab paroliga vaqtinchalik parol o'rnatish.
// =====================================================================

// Menyu — bo'limlarga ajratilgan holda, chiroyli tartibda
const NAV_SECTIONS = [
  {
    title: "ASOSIY",
    items: [
      { id: "dashboard", icon: "📊", label: "Dashboard" },
    ],
  },
  {
    title: "MAKTABLAR",
    items: [
      { id: "schools", icon: "🏫", label: "Maktablar" },
      { id: "vacancy", icon: "💼", label: "Vakansiyalar" },
      { id: "excel",   icon: "📥", label: "Excel ma'lumotlar" },
    ],
  },
  {
    title: "TIZIM",
    items: [
      { id: "profile", icon: "👤", label: "Profil" },
    ],
  },
];

const NAV_FLAT = NAV_SECTIONS.flatMap((s) => s.items);

function fmtDate(ts) {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" })
    + " " + d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - (typeof ts === "number" ? ts : new Date(ts).getTime());
  if (diff < 0) return "hozir";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "hozirgina";
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} soat oldin`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} kun oldin`;
  return fmtDate(ts);
}

// Vaqtinchalik parol generatori — adashtiruvchi belgilar (0/O, 1/l/I)
// ishlatilmaydi, telefonda aytib berish oson bo'lishi uchun.
function genTempPassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < len; i++) out += chars[rnd[i] % chars.length];
  return out;
}

function SubBadge({ school }) {
  if (school.subStatus === "active") {
    const days = school.subExpiresAt
      ? Math.max(0, Math.ceil((school.subExpiresAt - Date.now()) / 86400000))
      : null;
    return (
      <span className="da-badge" style={{ background: "#10b9811c", color: "#059669" }}>
        {days === null ? "Faol" : `Faol · ${days} kun`}
      </span>
    );
  }
  if (school.subStatus === "expired") {
    return <span className="da-badge" style={{ background: "#f59e0b1c", color: "#b45309" }}>Muddati tugagan</span>;
  }
  return <span className="da-badge" style={{ background: "#ef44441c", color: "#dc2626" }}>To'lov qilmagan</span>;
}

function Empty({ icon, title, text }) {
  return (
    <div className="da-empty">
      <div className="da-empty__icon">{icon}</div>
      <div className="da-empty__title">{title}</div>
      <div className="da-empty__text">{text}</div>
    </div>
  );
}

// =====================================================================
//  PAROL TIKLASH MODALI
// =====================================================================
function ResetPasswordModal({ school, currentUser, addToast, onClose }) {
  const [password, setPassword] = useState(() => genTempPassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleReset() {
    if (busy || done) return;
    const pwd = password.trim();
    if (pwd.length < 8) {
      addToast("Parol kamida 8 belgidan iborat bo'lishi kerak", "warning");
      return;
    }
    setBusy(true);
    try {
      const res = await adminResetPassword(school.id, pwd);
      setDone(true);
      if (res?.warning) addToast(res.warning, "warning");
      try {
        await logAction({
          user: currentUser,
          action: "password_reset",
          targetType: "user",
          targetId: school.id,
          details: { school: school.schoolName, email: school.email },
        });
      } catch {
        /* audit yozilmasa ham asosiy amal bajarilgan */
      }
    } catch (e) {
      addToast(e.message || "Parol tiklashda xatolik", "warning");
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      addToast("Nusxalab bo'lmadi — parolni qo'lda belgilab oling", "warning");
    }
  }

  return (
    <div className="da-modal-backdrop" onClick={done ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,23,42,.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div className="da-card" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, margin: 0 }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
          🔑 Parolni tiklash
        </div>
        <div style={{ fontSize: 13, color: "var(--da-text-2)", marginBottom: 14 }}>
          <b>{school.schoolName}</b> · {school.email}
        </div>

        {!done ? (
          <>
            <div style={{
              padding: "9px 13px", borderRadius: 11, fontSize: 12.5, marginBottom: 14,
              background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)",
              color: "#b45309", lineHeight: 1.55,
            }}>
              ⚠️ Maktabning hozirgi paroli bekor bo'ladi. Yangi vaqtinchalik parolni
              maktabga yetkazing — u kirgach parolni majburiy almashtiradi.
            </div>

            <label className="da-label">Vaqtinchalik parol</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                className="da-input"
                style={{ flex: 1, fontFamily: "monospace", fontSize: 15, letterSpacing: 1 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button type="button" className="da-btn da-btn--ghost" disabled={busy}
                title="Yangi parol yaratish"
                onClick={() => setPassword(genTempPassword())}>
                🎲
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="da-btn da-btn--primary" disabled={busy} onClick={handleReset}>
                {busy ? "O'rnatilmoqda..." : "🔑 Parolni o'rnatish"}
              </button>
              <button type="button" className="da-btn da-btn--ghost" disabled={busy} onClick={onClose}>
                Bekor
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{
              padding: "12px 14px", borderRadius: 12, marginBottom: 14,
              background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.35)",
              color: "#059669", fontWeight: 700, fontSize: 13.5,
            }}>
              ✅ Vaqtinchalik parol o'rnatildi
            </div>

            <label className="da-label">Yangi parol — maktabga yetkazing</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                className="da-input" readOnly
                style={{ flex: 1, fontFamily: "monospace", fontSize: 16, letterSpacing: 1.5, fontWeight: 700 }}
                value={password.trim()}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="da-btn da-btn--primary" onClick={copyPassword}>
                {copied ? "✓ Nusxalandi" : "📋 Nusxalash"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--da-text-2)", marginBottom: 16, lineHeight: 1.55 }}>
              ℹ️ Bu parol qayta ko'rsatilmaydi — oynani yopishdan oldin nusxalab oling.
              Maktab shu parol bilan kirgach, tizim yangi parol o'rnatishni talab qiladi.
            </div>

            <button type="button" className="da-btn da-btn--ghost" onClick={onClose}>
              Yopish
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// =====================================================================
//  ASOSIY KOMPONENT
// =====================================================================
export default function DistrictApp({ currentUser, onLogout, darkMode, setDarkMode, toasts, addToast }) {
  const [page, setPage] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  const [district, setDistrict] = useState(null);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [detailTab, setDetailTab] = useState("teachers");

  const hasDistrict = !!currentUser.districtId;

  async function loadAll() {
    if (!hasDistrict) { setLoading(false); return; }
    setLoading(true);
    try {
      const [d, sc] = await Promise.all([
        fetchMyDistrictInfo(currentUser.districtId),
        fetchDistrictSchools(),
      ]);
      setDistrict(d);
      setSchools(sc);
    } catch (e) {
      addToast(e.message, "warning");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goto(id) {
    setPage(id);
    setSelectedSchool(null);
    setNavOpen(false);
  }

  // Maktab oynasini ochish — kerak bo'lsa aniq tab bilan (masalan "vacancy")
  function openSchool(s, tab = "teachers") {
    setDetailTab(tab);
    setSelectedSchool(s);
  }

  const initials = (currentUser.name || currentUser.email || "TA").trim().charAt(0).toUpperCase();

  return (
    <div className={`da-root ${navOpen ? "da-root--nav-open" : ""}`}>
      <button type="button" className="da-burger" onClick={() => setNavOpen(true)} aria-label="Menyu">☰</button>
      <div className="da-backdrop" onClick={() => setNavOpen(false)} />

      {/* ------------------------------ SIDEBAR ------------------------------ */}
      <aside className="da-sidebar">
        <div className="da-sidebar__logocard">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Smartjadval.uz"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>
        <div className="da-sidebar__rolebar">🏛 TUMAN ADMINI</div>

        <nav className="da-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="da-nav__section">{section.title}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`da-nav__item ${page === item.id ? "da-nav__item--active" : ""}`}
                  onClick={() => goto(item.id)}
                >
                  <span className="da-nav__icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="da-sidebar__footer">
          <div className="da-sidebar__user">
            <div className="da-sidebar__avatar">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div className="da-sidebar__username">{currentUser.name || currentUser.email}</div>
              <div className="da-sidebar__role">{district?.name || "Tuman admini"}</div>
            </div>
          </div>
          <button type="button" className="da-nav__item" onClick={onLogout}>
            <span className="da-nav__icon">🚪</span> Chiqish
          </button>
        </div>
      </aside>

      {/* ------------------------------- MAIN -------------------------------- */}
      <main className="da-main">
        <div className="da-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div className="da-topbar__title">
              {NAV_FLAT.find((n) => n.id === page)?.label || "Dashboard"}
            </div>
            {district && (
              <span className="da-topbar__district">
                📍 {district.name}{district.region ? ` · ${district.region}` : ""}
              </span>
            )}
          </div>
          <div className="da-topbar__actions">
            <button type="button" className="da-iconbtn" title="Yangilash" onClick={loadAll} disabled={loading}>⟳</button>
            <button
              type="button"
              className="da-iconbtn"
              title={darkMode ? "Yorug' rejim" : "Tungi rejim"}
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
          </div>
        </div>

        {!hasDistrict ? (
          <div className="da-card">
            <Empty
              icon="🏛"
              title="Sizga hali tuman biriktirilmagan"
              text="Super Admin sizni tumanga biriktirishi kerak. Iltimos, administrator bilan bog'laning, so'ng tizimga qaytadan kiring."
            />
          </div>
        ) : selectedSchool ? (
          <SchoolDetail
            key={`${selectedSchool.id}:${detailTab}`}
            school={selectedSchool}
            initialTab={detailTab}
            onBack={() => setSelectedSchool(null)}
            addToast={addToast}
          />
        ) : (
          <>
            {page === "dashboard" && (
              <DashboardPage loading={loading} schools={schools} onOpenSchool={(s) => openSchool(s)} />
            )}
            {page === "schools" && (
              <SchoolsPage
                loading={loading}
                schools={schools}
                onOpenSchool={(s, tab) => openSchool(s, tab)}
                currentUser={currentUser}
                addToast={addToast}
              />
            )}
            {page === "vacancy" && (
              <VacancyPage
                loading={loading}
                schools={schools}
                onOpenSchool={(s) => openSchool(s, "vacancy")}
              />
            )}
            {page === "excel" && <ExcelDataPage schools={schools} addToast={addToast} districtId={currentUser.districtId} />}
            {page === "profile" && <ProfilePage currentUser={currentUser} district={district} schools={schools} />}
          </>
        )}
      </main>

      <div className="toast-container">
        {(toasts || []).map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
//  DASHBOARD
// =====================================================================
function DashboardPage({ loading, schools, onOpenSchool }) {
  const stats = useMemo(() => {
    const total = schools.length;
    const withSched = schools.filter((s) => s.hasSchedule).length;
    const teachers = schools.reduce((a, s) => a + s.teachersCount, 0);
    const classes = schools.reduce((a, s) => a + s.classesCount, 0);
    const lessons = schools.reduce((a, s) => a + s.lessonsCount, 0);

    // Vakansiya statistikasi — tuman kesimida
    let vacantHours = 0;
    let needySchools = 0;
    for (const s of schools) {
      const v = computeVacancy(s.data);
      if (!v.hasData) continue;
      vacantHours += v.vacantTotal;
      if (v.needy) needySchools++;
    }

    return { total, withSched, without: total - withSched, teachers, classes, lessons, vacantHours, needySchools };
  }, [schools]);

  const KPIS = [
    { icon: "🏫", label: "Jami maktablar",       value: stats.total,     bg: "rgba(37,99,235,.13)" },
    { icon: "📅", label: "Jadval yaratgan",       value: stats.withSched, bg: "rgba(16,185,129,.13)" },
    { icon: "⏳", label: "Jadval yaratmagan",     value: stats.without,   bg: "rgba(245,158,11,.14)" },
    { icon: "👨‍🏫", label: "Jami o'qituvchilar",   value: stats.teachers,  bg: "rgba(99,102,241,.13)" },
    { icon: "🎓", label: "Jami sinflar",          value: stats.classes,   bg: "rgba(14,165,233,.13)" },
    { icon: "📚", label: "Haftalik jami darslar", value: stats.lessons,   bg: "rgba(168,85,247,.13)" },
    { icon: "💼", label: "Vakant soatlar (tuman)", value: stats.vacantHours, bg: "rgba(239,68,68,.11)" },
    { icon: "🆘", label: "Muhtoj maktablar",       value: stats.needySchools, bg: "rgba(239,68,68,.11)" },
  ];

  if (loading) {
    return (
      <>
        <div className="da-kpis">
          {KPIS.map((k, i) => <div key={i} className="da-skel" style={{ height: 82 }} />)}
        </div>
        <div className="da-grid-2">
          <div className="da-skel" style={{ height: 260 }} />
          <div className="da-skel" style={{ height: 260 }} />
        </div>
      </>
    );
  }

  const topSchools = [...schools].sort((a, b) => b.lessonsCount - a.lessonsCount).slice(0, 8);
  const maxLessons = Math.max(1, ...topSchools.map((s) => s.lessonsCount));
  const recent = [...schools]
    .filter((s) => s.updatedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);
  const pct = stats.total ? Math.round((stats.withSched / stats.total) * 100) : 0;

  return (
    <>
      <div className="da-kpis">
        {KPIS.map((k, i) => (
          <div key={i} className="da-kpi" style={{ animationDelay: `${i * 45}ms` }}>
            <div className="da-kpi__icon" style={{ background: k.bg }}>{k.icon}</div>
            <div>
              <div className="da-kpi__value">{k.value}</div>
              <div className="da-kpi__label">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="da-grid-2">
        <div className="da-card">
          <div className="da-card__title">📚 Eng ko'p dars yuklamasi bo'lgan maktablar</div>
          {topSchools.length === 0 ? (
            <Empty icon="🏫" title="Maktablar yo'q" text="Tumaningizga hali maktab biriktirilmagan." />
          ) : (
            topSchools.map((s) => (
              <div key={s.id} className="da-bar-row">
                <div className="da-bar-name" title={s.schoolName}>{s.schoolName}</div>
                <div className="da-bar-track">
                  <div className="da-bar-fill" style={{ width: `${(s.lessonsCount / maxLessons) * 100}%` }} />
                </div>
                <div className="da-bar-val">{s.lessonsCount}</div>
              </div>
            ))
          )}
        </div>

        <div className="da-card">
          <div className="da-card__title">📅 Tuman bo'yicha jadval holati</div>
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <div className="da-ring" style={{ "--p": pct }}>
              <div className="da-ring__value">{pct}%</div>
              <div className="da-ring__label">jadval tayyor</div>
            </div>
            <div style={{ flex: 1, minWidth: 190 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <b style={{ color: "#10b981" }}>●</b> Jadval yaratgan: <b>{stats.withSched}</b> ta maktab
              </div>
              <div style={{ fontSize: 13 }}>
                <b style={{ color: "#f59e0b" }}>●</b> Jadval yaratmagan: <b>{stats.without}</b> ta maktab
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="da-card">
        <div className="da-card__title">🕐 Oxirgi faol maktablar</div>
        {recent.length === 0 ? (
          <Empty icon="💤" title="Faollik yo'q" text="Maktablar hali ma'lumot kiritmagan." />
        ) : (
          <div className="da-tablewrap">
            <table className="da-table">
              <thead>
                <tr>
                  <th>Maktab</th>
                  <th>O'qituvchilar</th>
                  <th>Sinflar</th>
                  <th>Darslar</th>
                  <th>Oxirgi faollik</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} className="da-row-click" onClick={() => onOpenSchool(s)}>
                    <td><b>{s.schoolName}</b></td>
                    <td>{s.teachersCount}</td>
                    <td>{s.classesCount}</td>
                    <td>{s.lessonsCount}</td>
                    <td>{timeAgo(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  MAKTABLAR RO'YXATI
// =====================================================================
function SchoolsPage({ loading, schools, onOpenSchool, currentUser, addToast }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | with | without
  const [resetFor, setResetFor] = useState(null); // parol tiklanayotgan maktab

  // Har maktab uchun vakansiya natijasi (bir marta hisoblanadi)
  const vacMap = useMemo(() => {
    const m = {};
    for (const s of schools) m[s.id] = computeVacancy(s.data);
    return m;
  }, [schools]);

  const q = query.trim().toLowerCase();
  // EDU-ID aniq mos kelsa — "jadvali bor/yo'q" filtri uni yashirmaydi
  const exactIdHit = q ? schools.some((s) => eduIdExact(s.uid, q)) : false;
  const shown = rankUsersByQuery(
    schools.filter((s) => {
      if (q && exactIdHit) return eduIdExact(s.uid, q);
      if (filter === "with" && !s.hasSchedule) return false;
      if (filter === "without" && s.hasSchedule) return false;
      if (!q) return true;
      // EDU-ID (tire/bo'sh joy/registr farqsiz), maktab, direktor, email, telefon
      return userMatchesQuery(s, q);
    }),
    q,
  );

  if (loading) return <div className="da-skel" style={{ height: 380 }} />;

  return (
    <div className="da-card">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div className="da-search">
          <span className="da-search__icon">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Maktab, direktor, email yoki EDU-ID..."
          />
        </div>
        <div className="da-tabs" style={{ marginBottom: 0 }}>
          <button type="button" className={`da-tab ${filter === "all" ? "da-tab--active" : ""}`} onClick={() => setFilter("all")}>
            Hammasi ({schools.length})
          </button>
          <button type="button" className={`da-tab ${filter === "with" ? "da-tab--active" : ""}`} onClick={() => setFilter("with")}>
            Jadvali bor ({schools.filter((s) => s.hasSchedule).length})
          </button>
          <button type="button" className={`da-tab ${filter === "without" ? "da-tab--active" : ""}`} onClick={() => setFilter("without")}>
            Jadvali yo'q ({schools.filter((s) => !s.hasSchedule).length})
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty
          icon="🏫"
          title={q ? "Hech narsa topilmadi" : "Maktablar yo'q"}
          text={q ? `"${query}" bo'yicha maktab topilmadi.` : "Tumaningizga hali maktab biriktirilmagan. Super Admin maktablarni tumanga biriktirishi kerak."}
        />
      ) : (
        <div className="da-tablewrap">
          <table className="da-table">
            <thead>
              <tr>
                <th>Maktab nomi</th>
                <th>Direktor</th>
                <th>Obuna</th>
                <th>Jadval holati</th>
                <th>Vakansiya</th>
                <th>O'qituvchilar</th>
                <th>Sinflar</th>
                <th>Oxirgi faollik</th>
                <th>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const v = vacMap[s.id];
                return (
                  <tr key={s.id}>
                    <td>
                      <b>{s.schoolName}</b>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: "#6366f1" }}>{s.uid || "—"}</div>
                    </td>
                    <td>
                      {s.name || "—"}
                      <div style={{ fontSize: 12, color: "var(--da-text-2)" }}>{s.email}</div>
                      {s.phone && <div style={{ fontSize: 12, color: "var(--da-text-2)" }}>📞 {s.phone}</div>}
                    </td>
                    <td><SubBadge school={s} /></td>
                    <td>
                      {s.hasSchedule
                        ? <span className="da-badge" style={{ background: "#10b9811c", color: "#059669" }}>✓ Yaratilgan</span>
                        : <span className="da-badge" style={{ background: "#f59e0b1c", color: "#b45309" }}>⏳ Yaratilmagan</span>}
                    </td>
                    <td>
                      {v?.hasData ? (
                        v.vacantTotal > 0 ? (
                          <span
                            className="da-badge"
                            style={{ background: "#ef44441c", color: "#dc2626", cursor: "pointer" }}
                            title={`Vakant fanlar: ${vacancySummaryText(v, 5)}`}
                            onClick={() => onOpenSchool(s, "vacancy")}
                          >
                            💼 {v.vacantTotal} soat
                          </span>
                        ) : v.overloadTotal > 0 ? (
                          <span
                            className="da-badge"
                            style={{ background: "#f59e0b1c", color: "#b45309", cursor: "pointer" }}
                            title={`Ortiqcha yuklama: ${v.overloadTotal} soat`}
                            onClick={() => onOpenSchool(s, "vacancy")}
                          >
                            ⚠️ +{v.overloadTotal}
                          </span>
                        ) : (
                          <span className="da-badge" style={{ background: "#10b9811c", color: "#059669" }}>✓</span>
                        )
                      ) : (
                        <span style={{ color: "var(--da-text-2)" }}>—</span>
                      )}
                    </td>
                    <td>{s.teachersCount}</td>
                    <td>{s.classesCount}</td>
                    <td>{timeAgo(s.updatedAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="da-btn da-btn--primary da-btn--sm" onClick={() => onOpenSchool(s)}>
                          👁 Ko'rish
                        </button>
                        <button
                          type="button"
                          className="da-btn da-btn--warning da-btn--sm"
                          title="Vaqtinchalik parol o'rnatish"
                          onClick={() => setResetFor(s)}
                        >
                          🔑 Parol
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resetFor && (
        <ResetPasswordModal
          school={resetFor}
          currentUser={currentUser}
          addToast={addToast}
          onClose={() => setResetFor(null)}
        />
      )}
    </div>
  );
}

// =====================================================================
//  💼 VAKANSIYALAR SAHIFASI — tuman kesimida
//
//  Har bir maktabning avtomatik sinxronlangan ma'lumotidan (classSubjects)
//  vakant soatlar va ortiqcha yuklama hisoblanadi. Muhtoj maktablar
//  alohida ajratib ko'rsatiladi va fanlar bo'yicha jamlanadi.
// =====================================================================
function VacancyPage({ loading, schools, onOpenSchool }) {
  const [filter, setFilter] = useState("needy"); // needy | ok | nodata | all

  const agg = useMemo(() => {
    const rows = schools.map((s) => ({ s, vac: computeVacancy(s.data) }));
    const withData = rows.filter((r) => r.vac.hasData);
    const needy = withData.filter((r) => r.vac.needy);
    const ok = withData.filter((r) => !r.vac.needy);
    const nodata = rows.filter((r) => !r.vac.hasData);

    const vacantHours = withData.reduce((a, r) => a + r.vac.vacantTotal, 0);
    const overloadHours = withData.reduce((a, r) => a + r.vac.overloadTotal, 0);
    const overloadTeachers = withData.reduce((a, r) => a + r.vac.overloaded.length, 0);

    // Fanlar bo'yicha tuman jamlanmasi
    const bySubject = new Map();
    for (const r of withData) {
      for (const sr of r.vac.vacantSubjects) {
        if (!bySubject.has(sr.name)) bySubject.set(sr.name, { name: sr.name, hours: 0, schools: 0 });
        const x = bySubject.get(sr.name);
        x.hours += sr.vacant;
        x.schools++;
      }
    }
    const subjectList = [...bySubject.values()].sort((a, b) => b.hours - a.hours);

    const sortNeedy = (arr) => [...arr].sort((a, b) =>
      (b.vac.vacantTotal - a.vac.vacantTotal)
      || (b.vac.overloadTotal - a.vac.overloadTotal)
      || String(a.s.schoolName).localeCompare(String(b.s.schoolName), "uz")
    );

    return {
      rows: sortNeedy(rows),
      needy: sortNeedy(needy),
      ok: sortNeedy(ok),
      nodata,
      withDataCount: withData.length,
      vacantHours,
      overloadHours,
      overloadTeachers,
      subjectList,
    };
  }, [schools]);

  if (loading) {
    return (
      <>
        <div className="da-kpis">
          {[0, 1, 2, 3].map((i) => <div key={i} className="da-skel" style={{ height: 82 }} />)}
        </div>
        <div className="da-skel" style={{ height: 320 }} />
      </>
    );
  }

  const KPIS = [
    { icon: "🆘", label: "Muhtoj maktablar",            value: agg.needy.length,      bg: "rgba(239,68,68,.11)" },
    { icon: "💼", label: "Jami vakant soat (tuman)",     value: agg.vacantHours,       bg: "rgba(239,68,68,.11)" },
    { icon: "⚠️", label: "Ortiqcha yuklama (soat)",      value: agg.overloadHours,     bg: "rgba(245,158,11,.14)" },
    { icon: "✅", label: "Ta'minlangan maktablar",       value: agg.ok.length,         bg: "rgba(16,185,129,.13)" },
  ];

  const FILTERS = [
    { id: "needy",  label: `🆘 Muhtoj (${agg.needy.length})` },
    { id: "ok",     label: `✅ Ta'minlangan (${agg.ok.length})` },
    { id: "nodata", label: `⏳ Ma'lumot yo'q (${agg.nodata.length})` },
    { id: "all",    label: `Hammasi (${schools.length})` },
  ];

  const shown = filter === "needy" ? agg.needy
    : filter === "ok" ? agg.ok
    : filter === "nodata" ? agg.nodata
    : agg.rows;

  const maxSubjHours = Math.max(1, ...agg.subjectList.map((r) => r.hours));

  return (
    <>
      <div className="da-kpis">
        {KPIS.map((k, i) => (
          <div key={i} className="da-kpi" style={{ animationDelay: `${i * 45}ms` }}>
            <div className="da-kpi__icon" style={{ background: k.bg }}>{k.icon}</div>
            <div>
              <div className="da-kpi__value">{k.value}</div>
              <div className="da-kpi__label">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {agg.subjectList.length > 0 && (
        <div className="da-card">
          <div className="da-card__title">
            📚 Fanlar bo'yicha vakant soatlar (tuman kesimida)
          </div>
          {agg.subjectList.map((r) => (
            <div key={r.name} className="da-bar-row">
              <div className="da-bar-name" title={r.name}>{r.name}</div>
              <div className="da-bar-track">
                <div
                  className="da-bar-fill"
                  style={{ width: `${(r.hours / maxSubjHours) * 100}%`, background: "linear-gradient(90deg,#ef4444,#f97316)" }}
                />
              </div>
              <div className="da-bar-val">{r.hours} soat · {r.schools} maktab</div>
            </div>
          ))}
        </div>
      )}

      <div className="da-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div className="da-card__title" style={{ margin: 0 }}>🏫 Maktablar kesimida</div>
          <div className="da-tabs" style={{ marginBottom: 0 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`da-tab ${filter === f.id ? "da-tab--active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {agg.withDataCount === 0 ? (
          <Empty
            icon="💼"
            title="Vakansiya tahlili uchun ma'lumot yo'q"
            text={`Maktablar o'z tizimida "Sinf fanlari" bo'limini to'ldirsa (fanlarga soat va o'qituvchi biriktirsa), vakansiyalar bu yerda avtomatik ko'rinadi.`}
          />
        ) : shown.length === 0 ? (
          <Empty icon="✅" title="Bu bo'limda maktab yo'q" text="Boshqa filtrlarni tekshirib ko'ring." />
        ) : (
          <div className="da-tablewrap">
            <table className="da-table">
              <thead>
                <tr>
                  <th>Maktab</th>
                  <th>Holat</th>
                  <th>Vakant soat</th>
                  <th>Vakant fanlar</th>
                  <th>Ortiqcha yuklama</th>
                  <th>Oxirgi faollik</th>
                  <th>Amallar</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ s, vac }) => (
                  <tr key={s.id} className="da-row-click" onClick={() => onOpenSchool(s)}>
                    <td>
                      <b>{s.schoolName}</b>
                      <div style={{ fontSize: 12, color: "var(--da-text-2)" }}>{s.email}</div>
                    </td>
                    <td><VacancyBadge vac={vac} /></td>
                    <td style={{ textAlign: "center" }}>
                      {vac.vacantTotal > 0
                        ? <b style={{ color: "#dc2626" }}>{vac.vacantTotal}</b>
                        : <span style={{ color: "var(--da-text-2)" }}>—</span>}
                    </td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal", fontSize: 12.5 }}>
                      {vacancySummaryText(vac) || <span style={{ color: "var(--da-text-2)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {vac.overloadTotal > 0
                        ? <span style={{ color: "#b45309", fontWeight: 800 }}>+{vac.overloadTotal} soat · {vac.overloaded.length} ustoz</span>
                        : <span style={{ color: "var(--da-text-2)" }}>—</span>}
                    </td>
                    <td>{timeAgo(s.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="da-btn da-btn--primary da-btn--sm"
                        onClick={(e) => { e.stopPropagation(); onOpenSchool(s); }}
                      >
                        👁 Batafsil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  MAKTAB OYNASI (faqat ko'rish)
//
//  Ikki xil manba ko'rsatiladi:
//    1. Maktab o'zi kiritgan ma'lumotlar (school.data — o'qituvchilar,
//       sinflar, fanlar, xonalar)
//    2. Tuman admini Excel orqali yuklagan ma'lumotlar (Supabase'dagi
//       district_excel_data): dars jadvali, sinf-fan soatlari (setka)
//       va o'qituvchi haftalik soatlari
// =====================================================================
function SchoolDetail({ school, onBack, addToast, initialTab = "teachers" }) {
  const [tab, setTab] = useState(initialTab);
  const [excel, setExcel] = useState(null);       // { teachers, setka, jadval }
  const [excelLoading, setExcelLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const store = await fetchExcelStore();
        if (alive) setExcel(store[school.id] || {});
      } catch {
        if (alive) setExcel({});
      } finally {
        if (alive) setExcelLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [school.id]);

  const d = school.data || {};
  const teachers = Array.isArray(d.teachers) ? d.teachers : [];
  const classes = Array.isArray(d.classes) ? d.classes : [];
  const subjects = Array.isArray(d.subjects) ? d.subjects : [];
  const rooms = Array.isArray(d.rooms) ? d.rooms : [];

  // Maktabning avtomatik sinxronlangan ma'lumoti (cloudSync orqali kelgan
  // haqiqiy jadval) — ustuvor manba. Excel yuklama zaxira sifatida qoladi.
  const auto = useMemo(() => buildAutoExcelData(d), [d]);

  // 💼 Vakansiya tahlili — sinf fanlari (classSubjects) asosida
  const vac = useMemo(() => computeVacancy(d), [d]);

  const jadvalData = auto?.jadval || excel?.jadval || null;
  const setkaData = auto?.setka || excel?.setka || null;
  const teachersData = auto?.teachers || excel?.teachers || null;
  const isAutoJadval = !!auto?.jadval;
  const isAutoSetka = !!auto?.setka;
  const isAutoTeachers = !!auto?.teachers;

  const jadvalRows = jadvalData?.rows?.length || 0;
  const setkaRows = setkaData?.rows?.length || 0;
  const teacherRowsN = teachersData?.rows?.length || 0;
  const hasAnyData = jadvalRows > 0 || setkaRows > 0 || teacherRowsN > 0;

  // Maktab statistikasi — jadval va setkadan hisoblanadi
  const stats = useMemo(() => {
    const jRows = jadvalData?.rows || [];
    const jClasses = new Set();
    const jTeachers = new Set();
    const jRooms = new Set();
    for (const r of jRows) {
      if (r.klass) jClasses.add(r.klass);
      if (r.teacher) jTeachers.add(String(r.teacher).trim().toLowerCase());
      if (r.room) jRooms.add(r.room);
    }
    let setkaHours = 0;
    if (setkaData?.rows) {
      for (const r of setkaData.rows) {
        for (const c of setkaData.classes || []) setkaHours += r.hours[c] || 0;
      }
    }
    return {
      lessons: jRows.length,
      classes: jClasses.size || (setkaData?.classes?.length || 0),
      teachers: jTeachers.size || teacherRowsN,
      rooms: jRooms.size,
      setkaHours,
    };
  }, [jadvalData, setkaData, teacherRowsN]);

  function handleExport() {
    const ok = exportSchoolExcel(
      school.schoolName,
      { jadval: jadvalData, setka: setkaData, teachers: teachersData },
      { declaredLabel: isAutoTeachers ? "Biriktirilgan soat" : "Excel soati" }
    );
    if (addToast) {
      addToast(ok
        ? "Maktab hisoboti Excel'ga yuklandi ✓"
        : "Eksport uchun ma'lumot yo'q", ok ? "success" : "warning");
    }
  }

  function SourceNote({ isAuto }) {
    return (
      <div style={{
        fontSize: 12, fontWeight: 700, marginBottom: 8,
        color: isAuto ? "#059669" : "var(--da-text-2)",
      }}>
        {isAuto
          ? "🔄 Manba: maktab tizimidan avtomatik sinxronlangan"
          : "📥 Manba: Excel yuklama"}
      </div>
    );
  }

  const TABS = [
    { id: "teachers", label: `👨‍🏫 O'qituvchilar (${teachers.length})` },
    { id: "classes",  label: `🎓 Sinflar (${classes.length})` },
    { id: "subjects", label: `📚 Fanlar (${subjects.length})` },
    { id: "rooms",    label: `🚪 Xonalar (${rooms.length})` },
    { id: "jadval",   label: "📅 Dars jadvali" },
    { id: "setka",    label: "🕐 Sinf-fan soatlari" },
    { id: "hours",    label: "⏱ O'qituvchi soatlari" },
    { id: "vacancy",  label: vac?.vacantTotal > 0 ? `💼 Vakansiya (${vac.vacantTotal})` : "💼 Vakansiya" },
  ];

  function nameOf(x) {
    if (!x) return "—";
    if (typeof x === "string") return x;
    return x.name || x.fullName || x.title || "—";
  }

  return (
    <>
      <div className="da-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="da-btn da-btn--ghost" onClick={onBack}>← Orqaga</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{school.schoolName}</div>
            <div style={{ fontSize: 12.5, color: "var(--da-text-2)" }}>
              {school.name && `Direktor: ${school.name} · `}{school.email}
              {school.phone && ` · 📞 ${school.phone}`}
            </div>
            {(school.regionName || school.districtName) && (
              <div style={{ fontSize: 12.5, color: "var(--da-text-2)", marginTop: 2 }}>
                📍 {[school.regionName, school.districtName].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <SubBadge school={school} />
            {vac?.hasData && vac.needy && (
              <span
                className="da-badge"
                style={{ background: "#ef44441c", color: "#dc2626", cursor: "pointer" }}
                title="Vakansiya tahlilini ochish"
                onClick={() => setTab("vacancy")}
              >
                🆘 Muhtoj{vac.vacantTotal > 0 ? ` · ${vac.vacantTotal} soat vakant` : ""}
              </span>
            )}
            {jadvalRows > 0 && (
              <span className="da-badge" style={{ background: "#10b9811c", color: "#059669" }}>
                {isAutoJadval ? "🔄 Jadval sinxronlangan" : "📥 Jadval (Excel)"}
              </span>
            )}
            <button
              type="button"
              className="da-btn da-btn--primary da-btn--sm"
              title="Jadval, setka va o'qituvchi soatlarini bitta Excel faylga yuklab olish"
              disabled={!hasAnyData}
              onClick={handleExport}
            >
              📤 Excel hisobot
            </button>
          </div>
        </div>
        <div style={{
          marginTop: 12, padding: "9px 13px", borderRadius: 11, fontSize: 12.5,
          background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)",
          color: "#b45309", fontWeight: 600,
        }}>
          🔒 Faqat ko'rish rejimi — maktab ma'lumotlarini o'zgartirib bo'lmaydi.
        </div>
      </div>

      {/* 📊 Maktab statistikasi */}
      {hasAnyData ? (
        <div className="da-kpis">
          {[
            { icon: "📚", label: "Haftalik darslar (jadval)", value: stats.lessons || "—", bg: "rgba(168,85,247,.13)" },
            { icon: "🎓", label: "Sinflar",                    value: stats.classes || "—", bg: "rgba(14,165,233,.13)" },
            { icon: "👨‍🏫", label: "O'qituvchilar",             value: stats.teachers || "—", bg: "rgba(99,102,241,.13)" },
            { icon: "🚪", label: "Xonalar (jadvalda)",         value: stats.rooms || "—", bg: "rgba(37,99,235,.13)" },
            { icon: "🕐", label: "Setka jami soat/hafta",      value: stats.setkaHours || "—", bg: "rgba(16,185,129,.13)" },
            { icon: "💼", label: "Vakant soatlar",             value: vac?.hasData ? (vac.vacantTotal || "0") : "—", bg: "rgba(239,68,68,.11)" },
          ].map((k, i) => (
            <div key={i} className="da-kpi" style={{ animationDelay: `${i * 45}ms` }}>
              <div className="da-kpi__icon" style={{ background: k.bg }}>{k.icon}</div>
              <div>
                <div className="da-kpi__value">{k.value}</div>
                <div className="da-kpi__label">{k.label}</div>
              </div>
            </div>
          ))}
        </div>
      ) : excelLoading ? (
        <div className="da-kpis">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="da-skel" style={{ height: 82 }} />)}
        </div>
      ) : null}

      <div className="da-card">
        <div className="da-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`da-tab ${tab === t.id ? "da-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "teachers" && (
          teachers.length === 0
            ? <Empty icon="👨‍🏫" title="O'qituvchilar kiritilmagan" text="Maktab hali o'qituvchilar ro'yxatini kiritmagan." />
            : (
              <div className="da-tablewrap">
                <table className="da-table">
                  <thead><tr><th>#</th><th>F.I.Sh.</th></tr></thead>
                  <tbody>
                    {teachers.map((t, i) => (
                      <tr key={t?.id || i}><td>{i + 1}</td><td><b>{nameOf(t)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === "classes" && (
          classes.length === 0
            ? <Empty icon="🎓" title="Sinflar kiritilmagan" text="Maktab hali sinflar ro'yxatini kiritmagan." />
            : (
              <div className="da-tablewrap">
                <table className="da-table">
                  <thead><tr><th>#</th><th>Sinf</th></tr></thead>
                  <tbody>
                    {classes.map((c, i) => (
                      <tr key={c?.id || i}><td>{i + 1}</td><td><b>{nameOf(c)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === "subjects" && (
          subjects.length === 0
            ? <Empty icon="📚" title="Fanlar kiritilmagan" text="Maktab hali fanlar ro'yxatini kiritmagan." />
            : (
              <div className="da-tablewrap">
                <table className="da-table">
                  <thead><tr><th>#</th><th>Fan</th></tr></thead>
                  <tbody>
                    {subjects.map((s, i) => (
                      <tr key={s?.id || i}><td>{i + 1}</td><td><b>{nameOf(s)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === "rooms" && (
          rooms.length === 0
            ? <Empty icon="🚪" title="Xonalar kiritilmagan" text="Maktab hali xonalar ro'yxatini kiritmagan." />
            : (
              <div className="da-tablewrap">
                <table className="da-table">
                  <thead><tr><th>#</th><th>Xona</th></tr></thead>
                  <tbody>
                    {rooms.map((r, i) => (
                      <tr key={r?.id || i}><td>{i + 1}</td><td><b>{nameOf(r)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === "jadval" && (
          jadvalRows > 0 ? (
            <>
              <SourceNote isAuto={isAutoJadval} />
              <JadvalViewer d={jadvalData} />
            </>
          ) : excelLoading ? (
            <div className="da-skel" style={{ height: 240 }} />
          ) : (
            <Empty
              icon="📅"
              title="Maktab hali jadval tuzmagan"
              text={`Maktab o'z tizimida jadval yaratsa, bu yerda avtomatik ko'rinadi. Zarur bo'lsa "📥 Excel ma'lumotlar" bo'limida qo'lda ham yuklash mumkin.`}
            />
          )
        )}

        {tab === "setka" && (
          setkaRows > 0 ? (
            <>
              <SourceNote isAuto={isAutoSetka} />
              <SetkaMatrix
                title="🕐 Sinf-fan haftalik soatlari"
                rows={setkaData.rows}
                classes={setkaData.classes}
              />
            </>
          ) : excelLoading ? (
            <div className="da-skel" style={{ height: 240 }} />
          ) : (
            <Empty
              icon="🕐"
              title="Soat setkasi hali yo'q"
              text={`Maktab "Sinf fanlari" bo'limini to'ldirsa avtomatik ko'rinadi. Zarur bo'lsa "📥 Excel ma'lumotlar" bo'limida qo'lda yuklash mumkin.`}
            />
          )
        )}

        {tab === "hours" && (
          (teacherRowsN > 0 || jadvalRows > 0) ? (
            <>
              <SourceNote isAuto={isAutoTeachers || isAutoJadval} />
              <TeacherHoursTable
                teachers={teachersData}
                jadval={jadvalData}
                declaredLabel={isAutoTeachers ? "Biriktirilgan soat" : "Excel soati"}
              />
            </>
          ) : excelLoading ? (
            <div className="da-skel" style={{ height: 240 }} />
          ) : (
            <Empty
              icon="⏱"
              title="O'qituvchi soatlari uchun ma'lumot yo'q"
              text={`Maktab o'qituvchilar va jadvalini kiritsa avtomatik ko'rinadi.`}
            />
          )
        )}

        {tab === "vacancy" && (
          vac?.hasData ? (
            <>
              <SourceNote isAuto={true} />
              <VacancyReport data={vac} />
            </>
          ) : (
            <Empty
              icon="💼"
              title="Vakansiya tahlili uchun ma'lumot yo'q"
              text={`Maktab o'z tizimida "Sinf fanlari" bo'limini to'ldirsa (fanlarga haftalik soat va o'qituvchi biriktirsa), vakant soatlar va ortiqcha yuklama shu yerda avtomatik ko'rinadi.`}
            />
          )
        )}
      </div>
    </>
  );
}

// =====================================================================
//  PROFIL
// =====================================================================
function ProfilePage({ currentUser, district, schools }) {
  return (
    <div className="da-card" style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <div className="da-sidebar__avatar" style={{ width: 60, height: 60, fontSize: 23 }}>
          {(currentUser.name || currentUser.email || "T").trim().charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{currentUser.name || "Tuman admini"}</div>
          <div style={{ fontSize: 13, color: "var(--da-text-2)" }}>{currentUser.email}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 11, fontSize: 13.5 }}>
        <div><b>Rol:</b> 🏛 Tuman admini (District Admin)</div>
        <div><b>Tuman:</b> {district ? `${district.name}${district.region ? ` · ${district.region}` : ""}` : "—"}</div>
        <div><b>Nazoratdagi maktablar:</b> {schools.length} ta</div>
        {currentUser.phone && <div><b>Telefon:</b> {currentUser.phone}</div>}
        {currentUser.uid && <div><b>ID:</b> {currentUser.uid}</div>}
      </div>
      <div style={{
        marginTop: 16, padding: "10px 13px", borderRadius: 11, fontSize: 12.5,
        background: "rgba(37,99,235,.07)", border: "1px solid rgba(37,99,235,.2)",
        color: "var(--da-text-2)", lineHeight: 1.6,
      }}>
        ℹ️ Parolni o'zgartirish kerak bo'lsa Super Admin bilan bog'laning.
      </div>
    </div>
  );
}
