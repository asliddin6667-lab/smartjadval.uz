import { Component } from "react";
import { purgeOtherUsers, storageStats } from "../services/storageService";

// =====================================================================
//  XATO TO'SIG'I (Error Boundary)
//
//  MUAMMO: React'da render yoki `useEffect` ichida ushlanmagan xato
//  chiqsa, React BUTUN DARAXTNI yechib tashlaydi — foydalanuvchi
//  OPPOQ EKRAN ko'radi va nima bo'lganini bilmaydi. Ilovada bitta
//  ham to'siq yo'q edi, shuning uchun har qanday kichik xato
//  saytni "o'ldirardi".
//
//  ENDI: xato ushlanadi, ekranda tushunarli xabar va ikkita chora
//  turadi — oddiy qayta yuklash va mahalliy keshni tozalab qayta
//  yuklash. Ma'lumot bulutda, shuning uchun kesh tozalash xavfsiz.
// =====================================================================
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Konsolda to'liq iz qolsin — muammoni aniqlash uchun kerak
    console.error("💥 Ilovada xato:", error, info?.componentStack);
    this.setState({ info: String(info?.componentStack || "").slice(0, 1500) });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearCache = () => {
    try {
      // Faqat BOSHQA profillarning keshi tozalanadi — joriy foydalanuvchi
      // ma'lumoti bulutdan qayta yuklanadi, lekin yuborilmagan o'zgarishi
      // bo'lsa yo'qolmasin.
      const r = purgeOtherUsers(null, { force: false });
      console.log(`🧹 ${r.users} ta profil keshi tozalandi (${r.freedKb} KB)`);
    } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    let stats = null;
    try { stats = storageStats(); } catch { /* ignore */ }

    const msg = String(this.state.error?.message || this.state.error || "");
    const quota = /quota|exceeded|storage/i.test(msg);

    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 20,
        background: "linear-gradient(135deg,#0f172a,#1e1b4b)",
      }}>
        <div style={{
          width: "min(560px, 100%)", background: "#fff", borderRadius: 18,
          padding: "28px 26px", boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
          <h1 style={{ margin: "0 0 8px", fontSize: 20, color: "#0f172a" }}>
            Ilovada kutilmagan xato
          </h1>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
            {quota
              ? "Brauzer xotirasi to'lgan ko'rinadi. Bu odatda shu brauzerda bir nechta profil ishlatilganda bo'ladi. Keshni tozalang — ma'lumotlaringiz bulutda saqlanib turibdi."
              : "Sahifani qayta yuklang. Ma'lumotlaringiz bulutda saqlanadi, shuning uchun yo'qolmaydi."}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                height: 42, padding: "0 18px", border: "none", borderRadius: 12,
                background: "linear-gradient(135deg,#6d28d9,#4f46e5)", color: "#fff",
                fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              🔄 Qayta yuklash
            </button>
            <button
              type="button"
              onClick={this.handleClearCache}
              style={{
                height: 42, padding: "0 18px", border: "1px solid #cbd5e1",
                borderRadius: 12, background: "#f8fafc", color: "#334155",
                fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              🧹 Keshni tozalab qayta yuklash
            </button>
          </div>

          {stats && (
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Brauzer xotirasi: <b>{stats.totalKb} KB</b> · {stats.users} ta profil
            </div>
          )}

          <details>
            <summary style={{ fontSize: 12.5, color: "#64748b", cursor: "pointer" }}>
              Texnik tafsilot
            </summary>
            <pre style={{
              marginTop: 8, maxHeight: 220, overflow: "auto", fontSize: 11,
              background: "#0f172a", color: "#e2e8f0", padding: 12,
              borderRadius: 10, whiteSpace: "pre-wrap",
            }}>
              {msg}
              {this.state.info ? `\n${this.state.info}` : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
