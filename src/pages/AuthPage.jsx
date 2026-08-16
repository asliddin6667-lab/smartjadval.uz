import { useState, useEffect, useRef, useCallback } from "react";
import { login, registerUser } from "../services/authService";
import { UZ_REGIONS, districtsOf } from "../utils/uzRegions";
import "../styles/auth.css";

// =====================================================================
//  KIRISH / RO'YXATDAN O'TISH
//
//  - Qurilma cheklovi YO'Q: istalgan kompyuter/telefondan kiriladi
//  - Email tasdiqlash YO'Q: ro'yxatdan o'tgan zahoti tizimga kiradi
//  - Parolni unutgan foydalanuvchini ADMIN tiklab beradi
//  - Ro'yxatdan o'tishda VILOYAT va TUMAN tanlanadi —
//    maktab avtomatik o'z tumaniga bog'lanadi (tuman admini ko'radi)
//  - YANGI: Cloudflare Turnstile CAPTCHA — bot hujumlaridan himoya.
//    Widget login va ro'yxatdan o'tish formasida ko'rinadi; olingan
//    token authService orqali Supabase'ga uzatiladi. Agar Turnstile
//    skripti yuklanmasa (masalan, internet muammosi), forma baribir
//    ishlashda davom etadi — token bo'sh ketadi (Supabase'da CAPTCHA
//    yoqilgan bo'lsa, server o'zi rad etadi).
// =====================================================================

// Admin aloqa ma'lumotlari
const ADMIN_TELEGRAM = "https://t.me/+998941366667";
const ADMIN_PHONE = "+998 94 136 66 67";
const ADMIN_NAME = "Asliddin_Muhiddinovich";

// Cloudflare Turnstile — ochiq (public) Site Key.
// Secret Key BU YERGA YOZILMAYDI — u faqat Supabase Dashboard'da turadi.
const TURNSTILE_SITE_KEY = "0x4AAAAAAERW7IJFAHCeOSD9";
const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Turnstile skriptini bir marta yuklaydi (bir nechta render'da ham)
let turnstilePromise = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => {
      turnstilePromise = null;
      reject(new Error("Turnstile yuklanmadi"));
    };
    document.head.appendChild(s);
  });
  return turnstilePromise;
}

// Telefon raqamni yozayotganda chiroyli ajratadi: 90 123 45 67
function formatLocalPhone(value) {
  const d = String(value || "").replace(/\D/g, "").slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
    .filter(Boolean)
    .join(" ");
}

export default function AuthPage({ onAuth, initialMode = "login", onBack }) {
  const savedEmail = localStorage.getItem("edu_remember_email") || "";
  // Faqat login/register rejimlari mavjud; boshqasi kelsa login'ga tushadi
  const [mode, setMode] = useState(initialMode === "register" ? "register" : "login");
  const [form, setForm] = useState({
    email: savedEmail, password: "", schoolName: "", phone: "",
    region: "", district: "",
  });
  const [remember, setRemember] = useState(!!savedEmail);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // ---------------- Turnstile CAPTCHA holati ----------------
  const captchaRef = useRef(null);        // widget joylashadigan div
  const widgetIdRef = useRef(null);       // render qilingan widget ID
  const tokenRef = useRef("");            // oxirgi olingan token

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !captchaRef.current) return;
        // Qayta render'dan saqlanish (StrictMode/HMR)
        if (widgetIdRef.current !== null) return;
        widgetIdRef.current = ts.render(captchaRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          language: "ru", // Turnstile'da o'zbekcha yo'q; eng yaqini
          callback: (token) => { tokenRef.current = token; },
          "expired-callback": () => { tokenRef.current = ""; },
          "error-callback": () => { tokenRef.current = ""; },
        });
      })
      .catch(() => {
        // Skript yuklanmadi — forma token'siz davom etadi
      });
    return () => { cancelled = true; };
  }, []);

  // Har bir urinishdan keyin token bir martalik — yangilash kerak
  const resetCaptcha = useCallback(() => {
    tokenRef.current = "";
    if (window.turnstile && widgetIdRef.current !== null) {
      try { window.turnstile.reset(widgetIdRef.current); } catch { /* jim */ }
    }
  }, []);

  function clearMsgs() {
    setError("");
    setSuccess("");
    setInfo("");
  }

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    clearMsgs();
  }

  // Viloyat o'zgarsa, eski tuman tanlovi tozalanadi
  function updateRegion(value) {
    setForm(prev => ({ ...prev, region: value, district: "" }));
    clearMsgs();
  }

  function switchMode(next) {
    setMode(next);
    setShowHelp(false);
    clearMsgs();
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const user = await login(form.email, form.password, tokenRef.current);
      if (remember) localStorage.setItem("edu_remember_email", form.email);
      else localStorage.removeItem("edu_remember_email");
      onAuth(user);
    } catch (err) {
      setError(err.message);
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await registerUser(form, tokenRef.current);
      setMode("login");
      setSuccess("Ro'yxatdan o'tdingiz. Endi login qiling.");
      setForm(prev => ({ ...prev, password: "" }));
      resetCaptcha();
    } catch (err) {
      setError(err.message);
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";
  const regionDistricts = districtsOf(form.region);

  return (
    <div className="edu-auth">
      {/* Fon bezaklari */}
      <div className="edu-bg-circle edu-bg-circle--1" />
      <div className="edu-bg-circle edu-bg-circle--2" />
      <div className="edu-bg-ring edu-bg-ring--1" />
      <div className="edu-bg-ring edu-bg-ring--2" />

      {/* Chap tomondagi 3D elementlar */}
      <div className="edu-deco edu-deco--left" aria-hidden="true">
        <div className="edu-clock">
          <span className="edu-clock__hand edu-clock__hand--h" />
          <span className="edu-clock__hand edu-clock__hand--m" />
        </div>
        <div className="edu-board">
          <div className="edu-board__top"><i /><i /><i /></div>
          <div className="edu-board__grid">
            <span className="c1" /><span /><span className="c2" /><span /><span />
            <span /><span className="c3" /><span /><span /><span className="c4" />
            <span className="c2" /><span /><span /><span className="c1" /><span />
          </div>
          <div className="edu-board__check">✓</div>
        </div>
        <div className="edu-cup">
          <span className="edu-pencil edu-pencil--1" />
          <span className="edu-pencil edu-pencil--2" />
          <span className="edu-pencil edu-pencil--3" />
          <div className="edu-cup__body" />
        </div>
        <div className="edu-books">
          <div className="edu-book edu-book--top" />
          <div className="edu-book edu-book--bottom" />
        </div>
      </div>

      {/* O'ng tomondagi 3D elementlar */}
      <div className="edu-deco edu-deco--right" aria-hidden="true">
        <div className="edu-chart">
          <span className="edu-chart__bar edu-chart__bar--g" />
          <span className="edu-chart__bar edu-chart__bar--o" />
          <span className="edu-chart__bar edu-chart__bar--p" />
        </div>
        <div className="edu-calicon">
          <div className="edu-calicon__page">
            <span className="edu-calicon__ring" />
            <span className="edu-calicon__ring" />
          </div>
        </div>
      </div>

      <div className="edu-center">
        <div className="edu-card">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                position: "absolute", top: 14, left: 16, border: "none",
                background: "transparent", cursor: "pointer", color: "#6d68a0",
                fontSize: 13.5, fontWeight: 700, padding: "6px 8px",
                borderRadius: 9, fontFamily: "inherit",
              }}
              title="Bosh sahifaga qaytish"
            >
              ← Bosh sahifa
            </button>
          )}
          <div className="edu-card__brand">
            <img
              className="edu-card__logoimg"
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Smartjadval.uz"
            />
          </div>

          <div className="edu-tabs">
            <button
              type="button"
              className={`edu-tabs__btn ${isLogin ? "edu-tabs__btn--active" : ""}`}
              onClick={() => switchMode("login")}
            >
              Kirish
            </button>
            <button
              type="button"
              className={`edu-tabs__btn ${!isLogin ? "edu-tabs__btn--active" : ""}`}
              onClick={() => switchMode("register")}
            >
              Ro'yxatdan o'tish
            </button>
          </div>

          {error && <div className="edu-alert edu-alert--warn">⚠️ {error}</div>}
          {success && <div className="edu-alert edu-alert--ok">✅ {success}</div>}
          {info && <div className="edu-alert edu-alert--info">ℹ️ {info}</div>}

          <form onSubmit={isLogin ? handleLogin : handleRegister} className="edu-form">
            {!isLogin && (
              <>
                <div className="edu-field">
                  <label className="edu-field__label">MAKTAB NOMI</label>
                  <div className="edu-field__wrap">
                    <span className="edu-field__icon">🏫</span>
                    <input
                      className="edu-field__input"
                      value={form.schoolName}
                      onChange={e => update("schoolName", e.target.value)}
                      placeholder="Masalan: 25-son umumta'lim maktabi"
                    />
                  </div>
                </div>

                {/* ---------- VILOYAT / TUMAN (yonma-yon) ---------- */}
                <div className="edu-form-row">
                <div className="edu-field">
                  <label className="edu-field__label">VILOYAT / SHAHAR</label>
                  <div className="edu-field__wrap">
                    <span className="edu-field__icon">📍</span>
                    <select
                      className="edu-field__input"
                      style={{ cursor: "pointer", appearance: "auto" }}
                      value={form.region}
                      onChange={e => updateRegion(e.target.value)}
                    >
                      <option value="">— Tanlang —</option>
                      {UZ_REGIONS.map(r => (
                        <option key={r.name} value={r.name}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="edu-field">
                  <label className="edu-field__label">TUMAN</label>
                  <div className="edu-field__wrap">
                    <span className="edu-field__icon">🏛</span>
                    <select
                      className="edu-field__input"
                      style={{
                        cursor: form.region ? "pointer" : "not-allowed",
                        appearance: "auto",
                        opacity: form.region ? 1 : .6,
                      }}
                      value={form.district}
                      onChange={e => update("district", e.target.value)}
                      disabled={!form.region}
                    >
                      <option value="">
                        {form.region ? "— Tumanni tanlang —" : "Avval viloyatni tanlang"}
                      </option>
                      {regionDistricts.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
                </div>

                <div className="edu-field">
                  <label className="edu-field__label">TELEFON RAQAM</label>
                  <div
                    className="edu-field__wrap"
                    style={{ display: "flex", alignItems: "center", flexWrap: "nowrap" }}
                  >
                    <span style={{
                      flexShrink: 0,
                      fontSize: 14.5,
                      fontWeight: 700,
                      color: "#64748b",
                      paddingLeft: 14,
                      paddingRight: 8,
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}>+998</span>
                    <input
                      className="edu-field__input"
                      style={{ paddingLeft: 0, minWidth: 0, flex: 1 }}
                      type="tel"
                      inputMode="numeric"
                      value={form.phone}
                      onChange={e => update("phone", formatLocalPhone(e.target.value))}
                      placeholder="90 123 45 67"
                      autoComplete="tel-national"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="edu-field">
              <label className="edu-field__label">EMAIL</label>
              <div className="edu-field__wrap">
                <span className="edu-field__icon">✉️</span>
                <input
                  className="edu-field__input"
                  type="email"
                  value={form.email}
                  onChange={e => update("email", e.target.value)}
                  placeholder="email@example.com"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="edu-field">
              <label className="edu-field__label">PAROL</label>
              <div className="edu-field__wrap">
                <span className="edu-field__icon">🔒</span>
                <input
                  className="edu-field__input edu-field__input--pass"
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={e => update("password", e.target.value)}
                  placeholder="Kamida 6 belgi"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  className="edu-field__eye"
                  onClick={() => setShowPass(v => !v)}
                  title={showPass ? "Parolni yashirish" : "Parolni ko'rsatish"}
                >
                  {showPass ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {isLogin && (
              <div className="edu-row">
                <label className="edu-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                  />
                  <span>Meni eslab qolish</span>
                </label>
                <button
                  type="button"
                  className="edu-forgot"
                  onClick={() => setShowHelp(v => !v)}
                >
                  Parolni unutdingizmi?
                </button>
              </div>
            )}

            {/* ---------- CAPTCHA (Cloudflare Turnstile) ---------- */}
            <div
              ref={captchaRef}
              style={{
                display: "flex",
                justifyContent: "center",
                minHeight: 66,
                margin: "4px 0 2px",
              }}
            />

            <button className="edu-submit" type="submit" disabled={loading}>
              {isLogin
                ? (loading ? "Tekshirilmoqda..." : "Kirish")
                : (loading ? "Yaratilmoqda..." : "Ro'yxatdan o'tish")}
            </button>
          </form>

          {/* Parolni tiklash yordami — administrator orqali */}
          {isLogin && showHelp && (
            <div style={{
              marginTop: 14, padding: "13px 15px", borderRadius: 12,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              fontSize: 13, color: "#475569", lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 5 }}>
                🔑 Parolni administrator tiklab beradi
              </div>
              Quyidagi manzilga murojaat qiling — ismingiz va email
              manzilingizni yozing, yangi parol beriladi.
              <div style={{ marginTop: 9 }}>
                <a
                  href={ADMIN_TELEGRAM}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#4f46e5", fontWeight: 700, textDecoration: "none" }}
                >
                  ✈️ Telegram: {ADMIN_NAME}
                </a>
              </div>
              <div style={{ marginTop: 4 }}>
                <a
                  href="tel:+998941366667"
                  style={{ color: "#4f46e5", fontWeight: 700, textDecoration: "none" }}
                >
                  📞 {ADMIN_PHONE}
                </a>
              </div>
            </div>
          )}

        </div>

        <div className="edu-footer">
          © 2026 Smartjadval.uz. Barcha huquqlar himoyalangan. · Admin: {ADMIN_NAME}
        </div>
      </div>
    </div>
  );
}
