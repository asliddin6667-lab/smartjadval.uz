import { useEffect, useState } from "react";

// =====================================================================
//  SINXRONIZATSIYA NISHONI
//
//  Ekranning o'ng pastida turadi va foydalanuvchiga bitta savolga
//  javob beradi: "ishim saqlandimi?".
//
//  Holatlar (cloudSync.onSyncState):
//    pending / saving  -> "Saqlanmoqda..."   (ko'k)
//    saved             -> "Saqlandi ✓"       (yashil, keyin so'nadi)
//    offline / error   -> "Saqlanmadi"       (qizil, "Qayta urinish" tugmasi)
//
//  Qizil holatda ilova FAQAT O'QISH rejimiga o'tadi (App.jsx) — shuning
//  uchun nishon yo'qolmaydi va tugmasi doim ko'rinib turadi.
// =====================================================================

const STYLES = {
  pending: { bg: "linear-gradient(135deg,#2563eb,#3b82f6)", icon: "☁️", text: "Saqlanmoqda..." },
  saving: { bg: "linear-gradient(135deg,#2563eb,#3b82f6)", icon: "☁️", text: "Saqlanmoqda..." },
  saved: { bg: "linear-gradient(135deg,#16a34a,#059669)", icon: "✓", text: "Saqlandi" },
  offline: { bg: "linear-gradient(135deg,#dc2626,#b91c1c)", icon: "📴", text: "Bulutga ulanib bo'lmadi" },
  error: { bg: "linear-gradient(135deg,#dc2626,#b91c1c)", icon: "⚠️", text: "Saqlanmadi" },
  idle: { bg: "linear-gradient(135deg,#64748b,#475569)", icon: "☁️", text: "Bulut bilan sinxron" },
};

export default function SyncBadge({ state, onRetry, retrying = false }) {
  const kind = state?.state || "idle";
  const stamp = state?.at || 0;

  // "Saqlandi ✓" 3 soniyadan keyin so'nadi — ekranni band qilmasin.
  // Yangi holat kelganda `stamp` o'zgaradi va nishon qayta ko'rinadi.
  const [hiddenStamp, setHiddenStamp] = useState(0);
  useEffect(() => {
    if (kind !== "saved") return;
    const t = setTimeout(() => setHiddenStamp(stamp), 3000);
    return () => clearTimeout(t);
  }, [kind, stamp]);

  const hideSaved = hiddenStamp === stamp;

  if (kind === "idle") return null;
  if (kind === "saved" && hideSaved) return null;

  const s = STYLES[kind] || STYLES.idle;
  const bad = kind === "offline" || kind === "error";

  return (
    <div
      data-pw-allow
      data-sync-allow
      title={state?.message || s.text}
      style={{
        position: "fixed", right: 16, bottom: 16, zIndex: 2700,
        display: "inline-flex", alignItems: "center", gap: 9,
        minHeight: 34, padding: bad ? "7px 10px 7px 13px" : "0 14px",
        borderRadius: 999, background: s.bg, color: "#fff",
        fontSize: 12.5, fontWeight: 800, maxWidth: "min(92vw, 420px)",
        boxShadow: "0 6px 18px rgba(15,23,42,.28)",
      }}
    >
      <span aria-hidden="true">{s.icon}</span>
      <span>{bad ? "Saqlanmadi — internetni tekshiring" : s.text}</span>
      {bad && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            marginLeft: 4, border: "none", borderRadius: 999,
            height: 26, padding: "0 11px", background: "rgba(255,255,255,.94)",
            color: "#b91c1c", fontSize: 12, fontWeight: 800,
            fontFamily: "inherit", cursor: retrying ? "wait" : "pointer",
          }}
        >
          {retrying ? "..." : "🔄 Qayta urinish"}
        </button>
      )}
    </div>
  );
}
