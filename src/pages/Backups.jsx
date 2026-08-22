import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listVersions, fetchVersion, deleteVersion,
} from "../services/versionService";
import {
  getConflictBackup, clearConflictBackup, restoreBlob, archiveCurrent,
} from "../services/cloudSync";
import { blobCounts, countRoomAssignments, fillBlob } from "../services/schoolBlob";
import { isLocalOnly } from "../services/devMode";

// =====================================================================
//  ZAXIRA NUSXALAR (VERSIYA TARIXI)
//
//  Bulutdagi `school_backups` jadvalida har bir o'zgarishdan keyingi
//  to'liq nusxa yotadi (oxirgi 40 tasi). Bu sahifa ularni ko'rsatadi
//  va istalganini QAYTARADI.
//
//  Bundan tashqari shu qurilmada konflikt zaxirasi qolgan bo'lsa
//  (`conflict_<userId>`) — u ham eng tepada ko'rsatiladi. Aynan shu
//  nusxa "boshqa qurilma ustidan yozib yubordi" holatida yo'qolgan
//  ma'lumotni qaytaradi.
//
//  Tiklash amali xavfsiz: tiklashdan OLDINGI holat ham avtomatik
//  arxivlanadi (cloudSync.restoreBlob), ya'ni orqaga qaytish mumkin.
// =====================================================================

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function agoText(value) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "hozirgina";
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} soat oldin`;
  const d = Math.round(h / 24);
  return `${d} kun oldin`;
}

function Chips({ counts }) {
  const c = counts || {};
  return (
    <div className="bk-stats">
      <span className="bk-chip">🏫 {c.classes || 0} sinf</span>
      <span className="bk-chip">👩‍🏫 {c.teachers || 0} ustoz</span>
      <span className="bk-chip">📚 {c.subjects || 0} fan</span>
      <span className="bk-chip">📖 {c.schedule || 0} dars</span>
      <span className="bk-chip">🚪 {c.roomAssignments || 0} xona biriktirilgan</span>
    </div>
  );
}

export default function BackupsPage({ currentUser, toast, onRestore }) {
  const userId = currentUser?.id;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [noTable, setNoTable] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmItem, setConfirmItem] = useState(null); // { kind, id, title }
  const [conflictGone, setConflictGone] = useState(false);

  // Ro'yxatni qayta o'qish — hisoblagich o'zgarsa effekt qayta ishlaydi
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    (async () => {
      const res = await listVersions(userId);
      if (!alive) return;
      setLoading(false);
      if (!res.ok) {
        setNoTable(res.reason === "no-table");
        setError(res.reason === "no-table" ? "" : (res.message || "Ro'yxatni o'qib bo'lmadi"));
        setItems([]);
        return;
      }
      setNoTable(false);
      setError("");
      setItems(res.items);
    })();
    return () => { alive = false; };
  }, [userId, reloadKey]);

  // Shu qurilmada qolgan konflikt zaxirasi (localStorage'dan).
  // `reloadKey` ataylab bog'liqlikda: ro'yxat yangilanganda zaxira ham
  // qayta o'qilsin.
  const conflict = useMemo(
    () => (conflictGone ? null : getConflictBackup(userId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, conflictGone, reloadKey]
  );

  // ——— Hozirgi holatni qo'lda zaxiraga olish ———
  async function saveNow() {
    if (!userId) return;
    setBusyId("now");
    const res = await archiveCurrent(userId);
    setBusyId(null);
    if (!res.ok) toast?.("Zaxira olinmadi", "error");
    else { toast?.("Hozirgi holat zaxiraga olindi ✓", "success"); reload(); }
  }

  // ——— Bulutdagi versiyani tiklash ———
  async function restoreVersion(id) {
    if (!userId) return;
    setBusyId(id);
    const got = await fetchVersion(userId, id);
    if (!got.ok) {
      setBusyId(null);
      toast?.("Versiyani o'qib bo'lmadi", "error");
      return;
    }
    const res = await restoreBlob(userId, got.blob, { label: fmtDate(got.meta.created_at) });
    setBusyId(null);
    if (!res.ok) { toast?.(res.message || "Tiklab bo'lmadi", "error"); return; }
    onRestore?.(res.blob);
    toast?.("Ma'lumotlar tiklandi ✓", "success");
    reload();
  }

  // ——— Shu qurilmadagi konflikt zaxirasini tiklash ———
  async function restoreConflict() {
    if (!userId || !conflict?.blob) return;
    setBusyId("conflict");
    const res = await restoreBlob(userId, conflict.blob, { label: "konflikt zaxirasi" });
    setBusyId(null);
    if (!res.ok) { toast?.(res.message || "Tiklab bo'lmadi", "error"); return; }
    onRestore?.(res.blob);
    toast?.("Konflikt zaxirasi tiklandi ✓", "success");
    reload();
  }

  async function removeVersion(id) {
    if (!userId) return;
    setBusyId(id);
    const res = await deleteVersion(userId, id);
    setBusyId(null);
    if (!res.ok) { toast?.("O'chirib bo'lmadi", "error"); return; }
    toast?.("Versiya o'chirildi", "error");
    reload();
  }

  function askRestore(item) {
    setConfirmItem({
      kind: "version",
      id: item.id,
      title: `${fmtDate(item.created_at)} — ${item.device || "qurilma"}`,
    });
  }

  function confirmYes() {
    const it = confirmItem;
    setConfirmItem(null);
    if (!it) return;
    if (it.kind === "version") restoreVersion(it.id);
    else if (it.kind === "conflict") restoreConflict();
    else if (it.kind === "delete") removeVersion(it.id);
  }

  const conflictCounts = conflict?.blob
    ? (() => {
        const full = fillBlob(conflict.blob);
        const c = blobCounts(full);
        c.roomAssignments = countRoomAssignments(full.schedule);
        return c;
      })()
    : null;

  return (
    <div>
      <style>{`
        .bk-card{padding:16px 18px;border-radius:16px;background:var(--card-bg,#fff);border:1.5px solid var(--card-border,#e2e8f0);box-shadow:0 4px 16px rgba(15,23,42,.05);margin-bottom:12px;}
        .bk-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;}
        .bk-when{font-size:15px;font-weight:800;color:var(--text-primary,#1e293b);}
        .bk-sub{font-size:12.5px;font-weight:600;color:var(--text-muted,#94a3b8);margin-top:3px;}
        .bk-note{margin-top:8px;font-size:12.5px;font-weight:700;color:#b45309;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:6px 10px;display:inline-block;}
        .bk-stats{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;}
        .bk-chip{font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;background:var(--bg-secondary,#f1f5f9);color:var(--text-secondary,#475569);}
        .bk-actions{display:flex;gap:7px;flex-wrap:wrap;}
        .bk-btn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:11px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card-bg,#fff);color:var(--text-secondary,#475569);font-size:12.5px;font-weight:750;font-family:inherit;cursor:pointer;transition:all .16s;}
        .bk-btn:hover{background:var(--bg-secondary,#f1f5f9);}
        .bk-btn-main{background:linear-gradient(135deg,#10b981,#059669);border-color:transparent;color:#fff;box-shadow:0 5px 14px rgba(5,150,105,.28);}
        .bk-btn-red{border-color:rgba(220,38,38,.3);color:#dc2626;}
        .bk-btn-red:hover{background:rgba(220,38,38,.08);}
        .bk-alert{padding:14px 16px;border-radius:14px;font-size:13.5px;font-weight:650;line-height:1.65;margin-bottom:16px;}
        .bk-alert-warn{background:rgba(245,158,11,.1);border:1.5px solid rgba(245,158,11,.35);color:#b45309;}
        .bk-alert-info{background:rgba(37,99,235,.08);border:1.5px solid rgba(37,99,235,.22);color:#1d4ed8;}
        .bk-alert code{background:rgba(15,23,42,.08);padding:1px 6px;border-radius:6px;font-size:12.5px;}
      `}</style>

      <div className="page-header">
        <div>
          <div className="page-title">Zaxira nusxalar</div>
          <div className="page-subtitle">
            Har bir o'zgarishdan keyingi to'liq nusxa — istalgan holatga qaytish mumkin
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => saveNow()}
          disabled={busyId === "now" || !userId}
        >
          {busyId === "now" ? "Saqlanmoqda..." : "💾 Hozirgi holatni zaxiraga olish"}
        </button>
      </div>

      <div className="page-body">
        {isLocalOnly() && (
          <div className="bk-alert bk-alert-warn">
            🔌 <b>Lokal rejim</b> — bulut uzilgan, versiya tarixi yozilmaydi.
            Bu ekran faqat saytda (production) to'liq ishlaydi.
          </div>
        )}

        {noTable && (
          <div className="bk-alert bk-alert-warn">
            ⚠️ <b>Versiya tarixi hali yoqilmagan.</b> Supabase Dashboard →
            SQL Editor'da loyiha ildizidagi <code>school_backups_setup.sql</code>{" "}
            faylini bir marta ishga tushiring. Shundan keyin har bir o'zgarish
            avtomatik zaxiraga tusha boshlaydi.
          </div>
        )}

        {error && (
          <div className="bk-alert bk-alert-warn">⚠️ {error}</div>
        )}

        {!noTable && !isLocalOnly() && (
          <div className="bk-alert bk-alert-info">
            ☁️ Ma'lumotlaringiz har bir o'zgarishdan keyin bulutga yoziladi va
            shu yerda nusxasi qoladi (oxirgi 40 ta). Qaysi qurilmadan kirsangiz
            ham — doim oxirgi holat ochiladi.
          </div>
        )}

        {/* ——— Shu qurilmada qolgan konflikt zaxirasi ——— */}
        {conflict?.blob && (
          <div
            className="bk-card"
            style={{ borderColor: "rgba(220,38,38,.45)", background: "rgba(254,242,242,.6)" }}
          >
            <div className="bk-row">
              <div>
                <div className="bk-when">🛟 Shu qurilmada saqlanib qolgan nusxa</div>
                <div className="bk-sub">
                  {fmtDate(conflict.at)} · {agoText(conflict.at)} · yutqazgan tomon: {conflict.label}
                </div>
                <div className="bk-note">
                  Bu nusxa boshqa qurilma bilan to'qnashuv paytida chetga olingan.
                  Kechagi ishingiz yo'qolgan bo'lsa — katta ehtimol shu yerda.
                </div>
                <Chips counts={conflictCounts} />
              </div>
              <div className="bk-actions">
                <button
                  className="bk-btn bk-btn-main"
                  disabled={busyId === "conflict"}
                  onClick={() => setConfirmItem({
                    kind: "conflict",
                    title: `${fmtDate(conflict.at)} (shu qurilma)`,
                  })}
                >
                  {busyId === "conflict" ? "Tiklanmoqda..." : "↩️ Shu nusxani tiklash"}
                </button>
                <button
                  className="bk-btn bk-btn-red"
                  onClick={() => {
                    clearConflictBackup(userId);
                    setConflictGone(true);
                    toast?.("Konflikt zaxirasi o'chirildi", "error");
                  }}
                >
                  🗑 O'chirish
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">☁️</div>
            <div className="empty-state-title">Yuklanmoqda...</div>
          </div>
        ) : !items.length && !conflict ? (
          <div className="empty-state">
            <div className="empty-state-icon">🗄</div>
            <div className="empty-state-title">Hali zaxira nusxa yo'q</div>
            <div className="empty-state-desc">
              Ma'lumotlarni o'zgartirsangiz (yoki yuqoridagi tugmani bossangiz)
              birinchi nusxa shu yerda paydo bo'ladi.
            </div>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="bk-card">
              <div className="bk-row">
                <div>
                  <div className="bk-when">🕒 {fmtDate(item.created_at)}</div>
                  <div className="bk-sub">
                    {agoText(item.created_at)} · {item.device || "qurilma"} · versiya #{item.rev}
                  </div>
                  {item.note && <div className="bk-note">{item.note}</div>}
                  <Chips counts={item.counts} />
                </div>
                <div className="bk-actions">
                  <button
                    className="bk-btn bk-btn-main"
                    disabled={busyId === item.id}
                    onClick={() => askRestore(item)}
                  >
                    {busyId === item.id ? "Tiklanmoqda..." : "↩️ Tiklash"}
                  </button>
                  <button
                    className="bk-btn bk-btn-red"
                    disabled={busyId === item.id}
                    onClick={() => setConfirmItem({
                      kind: "delete",
                      id: item.id,
                      title: fmtDate(item.created_at),
                    })}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ——— Tasdiqlash oynasi ——— */}
      {confirmItem && (
        <div className="modal-overlay" onClick={() => setConfirmItem(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {confirmItem.kind === "delete" ? "🗑 Versiyani o'chirish" : "↩️ Ma'lumotlarni tiklash"}
              </span>
              <button className="modal-close" onClick={() => setConfirmItem(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                {confirmItem.kind === "delete" ? (
                  <>«{confirmItem.title}» nusxasi butunlay o'chiriladi. Davom etilsinmi?</>
                ) : (
                  <>
                    <b>{confirmItem.title}</b> holatiga qaytiladi. Hozirgi ma'lumotlar
                    o'rniga o'sha nusxa qo'yiladi va barcha qurilmalarga tarqaladi.
                    <br /><br />
                    Xavotir olmang: <b>hozirgi holat ham avtomatik zaxiraga olinadi</b>,
                    ya'ni keyin orqaga qaytish mumkin.
                  </>
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmItem(null)}>
                Bekor qilish
              </button>
              <button
                className={confirmItem.kind === "delete" ? "btn btn-danger" : "btn btn-primary"}
                onClick={confirmYes}
              >
                {confirmItem.kind === "delete" ? "O'chirish" : "Ha, tiklansin"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
