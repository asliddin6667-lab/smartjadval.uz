import { useState, useEffect, useRef } from "react";
import "./styles/global.css";
import "./styles/responsive.css";

import Sidebar from "./components/Sidebar";
import PaywallModal from "./components/PaywallModal";
import AuthPage from "./pages/AuthPage";
import Landing from "./pages/Landing";
import SubscriptionPage from "./pages/Subscription";
import DashboardPage from "./pages/Dashboard";
import ClassesPage from "./pages/Classes";
import SubjectsPage from "./pages/Subjects";
import TeachersPage from "./pages/Teachers";
import ClassSubjectsPage from "./pages/ClassSubjects";
import RoomsPage from "./pages/Rooms";
import TimeslotsPage from "./pages/TimeSlots";
import LunchGroupsPage from "./pages/LunchGroups";
import SchedulePage from "./pages/Schedule";
import TeacherReplacePage from "./pages/TeacherReplace";
import AnalyticsPage from "./pages/Analytics";
import ImportExportPage from "./pages/ImportExport";
import UsersPage from "./pages/Users";
import SettingsPage from "./pages/Settings";
import DistrictApp from "./pages/DistrictApp";
import { useToast } from "./hooks/useToast";
import { loadData, saveData, loadUserData, saveUserData } from "./services/storageService";
import {
  getCurrentUser, logout, checkSubscription, refreshCurrentUser,
  isPasswordRecoveryUrl, completeForcedPasswordChange,
} from "./services/authService";
import { syncOnLogin, schedulePush, flushPush } from "./services/cloudSync";
import { buildDemoSchoolData } from "./utils/demoData";

const emptySettings = { schoolName: "", academicYear: "2024-2025" };

// =====================================================================
//  NAVIGATSIYA (URL hash bilan)
//
//  Har bir bo'lim URL'da `#/schedule` ko'rinishida saqlanadi. Shu tufayli:
//    • brauzerning "⬅ Orqaga" tugmasi oldingi BO'LIMga qaytaradi
//      (saytdan chiqib ketmaydi yoki Dashboard'ga tashlamaydi),
//    • F5 (yangilash) bosilganda o'sha bo'lim qayta ochiladi,
//    • havolani nusxalab yuborish mumkin.
//
//  Hash ishlatiladi (path emas), chunki GitHub Pages'da server tomonda
//  qayta yo'naltirish yo'q — `/smartjadval.uz/schedule` 404 berardi.
// =====================================================================
const PAGE_IDS = [
  "dashboard", "classes", "subjects", "teachers", "classSubjects",
  "rooms", "timeslots", "lunchGroups", "schedule", "teacherReplace",
  "analytics", "importExport", "users", "settings",
];

function pageFromHash() {
  if (typeof window === "undefined") return null;
  const raw = String(window.location.hash || "").replace(/^#\/?/, "").trim();
  return PAGE_IDS.includes(raw) ? raw : null;
}

function initialPage() {
  const fromHash = pageFromHash();
  if (fromHash) return fromHash;
  const saved = loadData("lastPage", "dashboard");
  return PAGE_IDS.includes(saved) ? saved : "dashboard";
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [activePage, setActivePage] = useState(() => initialPage());
  const [darkMode, setDarkMode] = useState(() => loadData("darkMode", false));
  const [settings, setSettings] = useState(emptySettings);

  // Birinchi marta hash yozilganda tarixga yangi yozuv qo'shilmasin
  const hashInitDone = useRef(false);

  // Parol tiklash havolasidan kelgan bo'lsa — hamma narsadan oldin
  // yangi parol o'rnatish ekrani ko'rsatiladi.
  const [recoveryMode, setRecoveryMode] = useState(() => isPasswordRecoveryUrl());

  // Landing → Auth o'tish holati: null = landing, "login"/"register" = AuthPage
  const [authView, setAuthView] = useState(null);

  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classSubjects, setClassSubjects] = useState({});
  const [rooms, setRooms] = useState([]);
  const [timeslots, setTimeslots] = useState([]);
  const [lunchGroups, setLunchGroups] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [dataReady, setDataReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ——— Mehmon rejimi holatlari ———
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [showPayPage, setShowPayPage] = useState(false);

  // ——— Mobil menyu ———
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { toasts, addToast } = useToast();
  const userId = currentUser?.id;
  // Tuman admini — maktab ma'lumotlari yuklanmaydi va sinxronlanmaydi
  const isDistrictAdmin = currentUser?.role === "district_admin";

  // ——— Faol bo'limni URL hash va localStorage'ga yozish ———
  useEffect(() => {
    if (!currentUser || isDistrictAdmin || recoveryMode) return;
    saveData("lastPage", activePage);
    const target = `#/${activePage}`;
    if (typeof window === "undefined") return;
    if (window.location.hash === target) { hashInitDone.current = true; return; }
    if (!hashInitDone.current) {
      // Ilova endi ochildi — tarixga qo'shimcha yozuv qo'shmaymiz
      window.history.replaceState({ page: activePage }, "", target);
      hashInitDone.current = true;
    } else {
      window.history.pushState({ page: activePage }, "", target);
    }
  }, [activePage, currentUser, isDistrictAdmin, recoveryMode]);

  // ——— Brauzerning "Orqaga / Oldinga" tugmalari ———
  useEffect(() => {
    function onPop() {
      const page = pageFromHash();
      setActivePage(page || "dashboard");
      setMobileNavOpen(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Mobil menyu ochiq bo'lganda orqa fon siljimasin
  useEffect(() => {
    if (mobileNavOpen) document.body.classList.add("nav-open");
    else document.body.classList.remove("nav-open");
    return () => document.body.classList.remove("nav-open");
  }, [mobileNavOpen]);

  // Ekran kattalashsa (telefon → kompyuter) menyu holati tozalanadi
  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 900) setMobileNavOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc tugmasi menyuni yopadi
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // ——— Doimiy saqlash (persistent storage) ———
  useEffect(() => {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((granted) => {
        console.log(
          granted
            ? "✅ Doimiy saqlash yoqildi"
            : "⚠️ Doimiy saqlash hozircha berilmadi"
        );
      }).catch(() => {});
    }
  }, []);

  // ——— Sahifa yopilishidan oldin bulutga yuborish ———
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") flushPush().catch(() => {});
    }
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  // Yuklanganda profil serverdan yangilanadi
  useEffect(() => {
    if (!currentUser) return;
    refreshCurrentUser().then((fresh) => {
      if (!fresh) {
        setCurrentUser(null);
      } else if (
        fresh.subscription?.status !== currentUser.subscription?.status ||
        fresh.subscription?.expiresAt !== currentUser.subscription?.expiresAt ||
        fresh.email !== currentUser.email ||
        fresh.role !== currentUser.role ||
        fresh.districtId !== currentUser.districtId ||
        fresh.mustChangePassword !== currentUser.mustChangePassword
      ) {
        setCurrentUser(fresh);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ——— MA'LUMOTLARNI YUKLASH (avval bulut bilan sinxronlanadi) ———
  useEffect(() => {
    if (!currentUser) return;

    // Tuman admini maktab ma'lumotlari bilan ishlamaydi —
    // sinxronizatsiya va localStorage yuklash unga kerak emas.
    if (currentUser.role === "district_admin") {
      setDataReady(false);
      setSyncing(false);
      return;
    }

    let cancelled = false;
    setDataReady(false);
    setSyncing(true);

    (async () => {
      // 1) Bulut bilan sinxronizatsiya
      let syncResult = { action: "skip" };
      try {
        syncResult = await syncOnLogin(currentUser);
      } catch {
        syncResult = { action: "offline" };
      }
      if (cancelled) return;

      // 2) localStorage'dan sinxron o'qish (avvalgidek)
      let loadedSettings = loadUserData(currentUser.id, "settings", { ...emptySettings, schoolName: currentUser.schoolName || "" });
      let loadedClasses = loadUserData(currentUser.id, "classes", []);
      let loadedSubjects = loadUserData(currentUser.id, "subjects", []);
      let loadedTeachers = loadUserData(currentUser.id, "teachers", []);
      let loadedClassSubjects = loadUserData(currentUser.id, "classSubjects", {});
      let loadedRooms = loadUserData(currentUser.id, "rooms", []);
      let loadedTimeslots = loadUserData(currentUser.id, "timeslots", []);
      let loadedLunchGroups = loadUserData(currentUser.id, "lunchGroups", []);
      let loadedShifts = loadUserData(currentUser.id, "shifts", []);
      let loadedSchedule = loadUserData(currentUser.id, "schedule", {});

      // Demo foydalanuvchida ma'lumot bo'lmasa, platforma to'ldirilgan holda ochiladi.
      if (currentUser.email === "demo@smartjadval.uz" && !loadedClasses.length) {
        const demo = buildDemoSchoolData();
        loadedSettings = demo.settings;
        loadedClasses = demo.classes;
        loadedSubjects = demo.subjects;
        loadedTeachers = demo.teachers;
        loadedClassSubjects = demo.classSubjects;
        loadedRooms = demo.rooms;
        loadedTimeslots = demo.timeslots;
        loadedLunchGroups = demo.lunchGroups;
        loadedShifts = demo.shifts || [];
        loadedSchedule = demo.schedule;
      }

      if (cancelled) return;

      setSettings(loadedSettings);
      setClasses(loadedClasses);
      setSubjects(loadedSubjects);
      setTeachers(loadedTeachers);
      setClassSubjects(loadedClassSubjects);
      setRooms(loadedRooms);
      setTimeslots(loadedTimeslots);
      setLunchGroups(loadedLunchGroups);
      setShifts(loadedShifts);
      setSchedule(loadedSchedule);
      setDataReady(true);
      setSyncing(false);

      // Oxirgi ochilgan bo'lim tiklanadi (URL hash ustunroq).
      // "users" faqat superadmin uchun — boshqasiga dashboard beriladi.
      const restored = initialPage();
      setActivePage(
        restored === "users" && currentUser.role !== "superadmin" ? "dashboard" : restored
      );

      setPaywallOpen(false);
      setShowPayPage(false);
      setMobileNavOpen(false);

      if (syncResult.action === "offline") {
        addToast("Internet yo'q — mahalliy nusxada ishlayapsiz", "warning");
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ——— localStorage'ga saqlash (avvalgidek, sinxron) ———
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "classes", classes); }, [userId, dataReady, classes]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "subjects", subjects); }, [userId, dataReady, subjects]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "teachers", teachers); }, [userId, dataReady, teachers]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "classSubjects", classSubjects); }, [userId, dataReady, classSubjects]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "rooms", rooms); }, [userId, dataReady, rooms]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "timeslots", timeslots); }, [userId, dataReady, timeslots]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "lunchGroups", lunchGroups); }, [userId, dataReady, lunchGroups]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "shifts", shifts); }, [userId, dataReady, shifts]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "schedule", schedule); }, [userId, dataReady, schedule]);
  useEffect(() => { if (userId && dataReady) saveUserData(userId, "settings", settings); }, [userId, dataReady, settings]);
  useEffect(() => { saveData("darkMode", darkMode); }, [darkMode]);

  // ——— BULUTGA YUBORISH (debounce bilan) ———
  useEffect(() => {
    if (!userId || !dataReady || isDistrictAdmin) return;
    if (currentUser?.email === "demo@smartjadval.uz") return; // demo bulutga yozilmaydi
    schedulePush(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userId, dataReady,
    classes, subjects, teachers, classSubjects, rooms,
    timeslots, lunchGroups, shifts, schedule, settings,
  ]);

  useEffect(() => {
    if (darkMode) document.body.classList.add("dark-mode");
    else document.body.classList.remove("dark-mode");
  }, [darkMode]);

  async function handleLogout() {
    // Chiqishdan oldin yuborilmagan o'zgarishlarni bulutga jo'natamiz
    try { await flushPush(); } catch { /* internet yo'q — mahalliy qoladi */ }
    logout();
    setCurrentUser(null);
    setDataReady(false);
    setPaywallOpen(false);
    setShowPayPage(false);
    setMobileNavOpen(false);
    // Navigatsiya holati tozalanadi — keyingi kirishda Dashboard ochiladi
    setActivePage("dashboard");
    saveData("lastPage", "dashboard");
    hashInitDone.current = false;
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  function handleNavigate(pageId) {
    setActivePage(pageId);
    setMobileNavOpen(false);
  }

  // ——— PAROL TIKLASH EKRANI (hamma narsadan ustun) ———
  if (recoveryMode) {
    return (
      <AuthPage
        initialMode="reset"
        onAuth={(u) => { setRecoveryMode(false); setCurrentUser(u); }}
      />
    );
  }

  if (!currentUser) {
    // Avval landing (marketing) sahifa ko'rsatiladi; "Kirish" yoki
    // "Ro'yxatdan o'tish" bosilganda AuthPage ochiladi.
    if (!authView) {
      return (
        <Landing
          onLogin={() => setAuthView("login")}
          onRegister={() => setAuthView("register")}
        />
      );
    }
    return (
      <AuthPage
        onAuth={setCurrentUser}
        initialMode={authView}
        onBack={() => setAuthView(null)}
      />
    );
  }

  // ——— MAJBURIY PAROL ALMASHTIRISH ———
  // Superadmin vaqtinchalik parol o'rnatgan bo'lsa, foydalanuvchi
  // yangi parol qo'ymaguncha platformaga kirolmaydi.
  if (currentUser.mustChangePassword) {
    return (
      <ForcePasswordChange
        user={currentUser}
        onDone={(fresh) => setCurrentUser(fresh)}
        onLogout={handleLogout}
      />
    );
  }

  // ——— TUMAN ADMINI PANELI ———
  if (isDistrictAdmin) {
    return (
      <DistrictApp
        currentUser={currentUser}
        onLogout={handleLogout}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        toasts={toasts}
        addToast={addToast}
      />
    );
  }

  // ——— Sinxronizatsiya davomida qisqa yuklanish ekrani ———
  if (syncing && !dataReady) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14,
        background: "linear-gradient(135deg,#0f172a,#1e1b4b)", color: "#fff",
      }}>
        <div style={{ fontSize: 40 }}>☁️</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Ma'lumotlar yuklanmoqda...</div>
        <div style={{ fontSize: 13, opacity: .7 }}>Bulut bilan sinxronlanmoqda</div>
      </div>
    );
  }

  // ——— Obuna nazorati (MEHMON REJIMI) ———
  const subState = checkSubscription(currentUser);
  const locked = subState.blocked;

  if (locked && showPayPage) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowPayPage(false)}
          style={{
            position: "fixed", top: 16, left: 16, zIndex: 3000,
            display: "inline-flex", alignItems: "center", gap: 6,
            height: 42, padding: "0 16px", border: "none", borderRadius: 12,
            background: "rgba(255,255,255,.92)", color: "#334155",
            fontSize: 14, fontWeight: 800, cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,.18)",
          }}
        >
          ← Platformaga qaytish
        </button>
        <SubscriptionPage
          user={currentUser}
          toast={addToast}
          onLogout={handleLogout}
          onUnlocked={() => {
            setShowPayPage(false);
            setCurrentUser(getCurrentUser());
          }}
        />
      </>
    );
  }

  function guardClick(e) {
    if (!locked) return;
    const el = e.target.closest?.(
      "button, a, input, select, textarea, label, [role='button'], .btn"
    );
    if (!el) return;
    if (el.closest("[data-pw-allow]")) return;
    e.preventDefault();
    e.stopPropagation();
    setPaywallOpen(true);
  }

  function guardFocus(e) {
    if (!locked) return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !t.closest("[data-pw-allow]")) {
      t.blur();
      e.stopPropagation();
      setPaywallOpen(true);
    }
  }

  const pageProps = { classes, subjects, teachers, rooms, timeslots, lunchGroups, schedule, classSubjects, toast: addToast, currentUser };

  function renderPage() {
    switch (activePage) {
      case "dashboard": return <DashboardPage {...pageProps} setActivePage={handleNavigate} />;
      case "classes": return <ClassesPage {...pageProps} setClasses={setClasses} />;
      case "subjects": return <SubjectsPage {...pageProps} setSubjects={setSubjects} />;
      case "teachers": return <TeachersPage {...pageProps} setTeachers={setTeachers} />;
      case "classSubjects": return <ClassSubjectsPage {...pageProps} setClassSubjects={setClassSubjects} />;
      case "rooms": return <RoomsPage {...pageProps} setRooms={setRooms} />;
      case "timeslots": return <TimeslotsPage {...pageProps} setTimeslots={setTimeslots} shifts={shifts} setShifts={setShifts} />;
      case "lunchGroups": return <LunchGroupsPage {...pageProps} setLunchGroups={setLunchGroups} />;
      case "schedule": return <SchedulePage {...pageProps} setSchedule={setSchedule} />;
      case "teacherReplace": return <TeacherReplacePage {...pageProps} setSchedule={setSchedule} setClassSubjects={setClassSubjects} />;
      case "analytics": return <AnalyticsPage {...pageProps} />;
      case "importExport": return <ImportExportPage {...pageProps} setSubjects={setSubjects} setTeachers={setTeachers} />;
      case "users": return currentUser.role === "superadmin" ? <UsersPage {...pageProps} /> : <DashboardPage {...pageProps} setActivePage={handleNavigate} />;
      case "settings": return (
        <SettingsPage
          settings={settings} setSettings={setSettings}
          darkMode={darkMode} setDarkMode={setDarkMode}
          setClasses={setClasses} setSubjects={setSubjects}
          setTeachers={setTeachers} setRooms={setRooms}
          setTimeslots={setTimeslots} setSchedule={setSchedule}
          setClassSubjects={setClassSubjects} setLunchGroups={setLunchGroups}
          shifts={shifts} setShifts={setShifts}
          {...pageProps}
        />
      );
      default: return <DashboardPage {...pageProps} setActivePage={handleNavigate} />;
    }
  }

  return (
    <>
      <div className="app-layout">
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Menyuni ochish"
          title="Menyu"
        >
          ☰
        </button>

        <div
          className={`sidebar-backdrop ${mobileNavOpen ? "show" : ""}`}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />

        <Sidebar
          activePage={activePage}
          setActivePage={handleNavigate}
          schoolName={settings.schoolName}
          currentUser={currentUser}
          onLogout={handleLogout}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        <main
          className="main-content"
          onClickCapture={guardClick}
          onFocusCapture={guardFocus}
        >
          {locked && (
            <div
              data-pw-allow
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, flexWrap: "wrap",
                background: "linear-gradient(135deg, rgba(245,158,11,.12), rgba(249,115,22,.12))",
                border: "1.5px solid rgba(245,158,11,.4)",
                borderRadius: 14, padding: "10px 16px", marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#b45309" }}>
                👀 Mehmon rejimi — platformani ko'rishingiz mumkin, foydalanish uchun obunani faollashtiring.
              </div>
              <button
                type="button"
                onClick={() => setShowPayPage(true)}
                style={{
                  border: "none", borderRadius: 11, height: 38, padding: "0 16px",
                  background: "linear-gradient(135deg,#16a34a,#059669)", color: "#fff",
                  fontSize: 13.5, fontWeight: 800, cursor: "pointer",
                  boxShadow: "0 5px 14px rgba(22,163,74,.32)", whiteSpace: "nowrap",
                }}
              >
                💳 To'lov qilish
              </button>
            </div>
          )}
          {renderPage()}
        </main>
      </div>

      {paywallOpen && (
        <PaywallModal
          user={currentUser}
          subState={subState}
          onClose={() => setPaywallOpen(false)}
          onGoPay={() => { setPaywallOpen(false); setShowPayPage(true); }}
        />
      )}

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </>
  );
}

// =====================================================================
//  MAJBURIY PAROL ALMASHTIRISH EKRANI
//  Superadmin vaqtinchalik parol o'rnatgan foydalanuvchi uchun.
// =====================================================================
function ForcePasswordChange({ user, onDone, onLogout }) {
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (busy) return;
    setError("");
    if (pass1.length < 6) return setError("Parol kamida 6 ta belgi bo'lsin");
    if (pass1 !== pass2) return setError("Ikkala parol bir xil emas");

    setBusy(true);
    try {
      const fresh = await completeForcedPasswordChange(pass1);
      onDone(fresh);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 20,
      background: "linear-gradient(135deg,#0f172a,#1e1b4b)",
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: "#fff",
        borderRadius: 22, padding: "30px 28px",
        boxShadow: "0 24px 60px rgba(0,0,0,.35)",
      }}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8 }}>🔐</div>
        <div style={{ fontSize: 19, fontWeight: 800, textAlign: "center", color: "#0f172a" }}>
          Yangi parol o'rnating
        </div>
        <div style={{
          fontSize: 13, color: "#64748b", textAlign: "center",
          marginTop: 8, marginBottom: 20, lineHeight: 1.6,
        }}>
          Siz vaqtinchalik parol bilan kirdingiz.<br />
          Xavfsizlik uchun davom etishdan oldin o'zingizga
          yangi parol o'rnatishingiz shart.
        </div>

        {error && (
          <div style={{
            marginBottom: 14, padding: "10px 13px", borderRadius: 11,
            background: "#fef2f2", border: "1px solid #fecaca",
            color: "#dc2626", fontSize: 13, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        <label style={{ fontSize: 11.5, fontWeight: 800, color: "#64748b", letterSpacing: .6 }}>
          YANGI PAROL
        </label>
        <div style={{ position: "relative", marginTop: 5, marginBottom: 14 }}>
          <input
            type={show ? "text" : "password"}
            value={pass1}
            onChange={(e) => { setPass1(e.target.value); setError(""); }}
            placeholder="Kamida 6 belgi"
            autoComplete="new-password"
            style={{
              width: "100%", height: 46, padding: "0 44px 0 14px",
              borderRadius: 12, border: "1.5px solid #e2e8f0",
              fontSize: 14.5, outline: "none", boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            style={{
              position: "absolute", right: 8, top: "50%",
              transform: "translateY(-50%)", border: "none",
              background: "transparent", cursor: "pointer", fontSize: 17,
            }}
          >
            {show ? "🙈" : "👁️"}
          </button>
        </div>

        <label style={{ fontSize: 11.5, fontWeight: 800, color: "#64748b", letterSpacing: .6 }}>
          PAROLNI TAKRORLANG
        </label>
        <input
          type={show ? "text" : "password"}
          value={pass2}
          onChange={(e) => { setPass2(e.target.value); setError(""); }}
          placeholder="Yuqoridagi parolni qayta yozing"
          autoComplete="new-password"
          style={{
            width: "100%", height: 46, padding: "0 14px",
            borderRadius: 12, border: "1.5px solid #e2e8f0",
            fontSize: 14.5, outline: "none", boxSizing: "border-box",
            marginTop: 5, marginBottom: 20,
          }}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          style={{
            width: "100%", height: 48, border: "none", borderRadius: 13,
            background: "linear-gradient(135deg,#2563eb,#3b82f6)", color: "#fff",
            fontSize: 15, fontWeight: 800, cursor: busy ? "wait" : "pointer",
            boxShadow: "0 8px 22px rgba(37,99,235,.35)",
          }}
        >
          {busy ? "Saqlanmoqda..." : "✓ Parolni saqlash va davom etish"}
        </button>

        <button
          type="button"
          onClick={onLogout}
          style={{
            width: "100%", marginTop: 12, height: 40, border: "none",
            borderRadius: 11, background: "transparent", color: "#64748b",
            fontSize: 13.5, fontWeight: 700, cursor: "pointer",
          }}
        >
          Chiqish ({user.email})
        </button>
      </div>
    </div>
  );
}
