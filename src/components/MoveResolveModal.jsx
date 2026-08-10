// ═══════════════════════════════════════════════════════════════════
// MOVE RESOLVE MODAL — ikki rejim:
//  1) "blocked"  — dars qo'yib bo'lmadi: sabablar + minimal yechimlar
//  2) "confirm"  — qulflangan dars tegiladi: nima o'zgarishi + tasdiq
// ═══════════════════════════════════════════════════════════════════
export default function MoveResolveModal({
  data,          // { mode, reasons, suggestions, warnings, actions, title }
  timeslots = [],
  classes = [],
  subjects = [],
  teachers = [],
  onApply,       // (actions) => void
  onClose,
}) {
  if (!data) return null;

  const tsById = new Map(timeslots.map((t) => [t.id, t]));
  const nameOf = (arr, id, fb = "—") => arr.find((x) => x.id === id)?.name || fb;

  function describeAction(a) {
    const from = tsById.get(a.fromSlotId);
    const to = tsById.get(a.toSlotId);
    const first = a.entries?.[0] || {};
    const subj = nameOf(subjects, first.subjectId, "Dars");
    const clsIds = Array.isArray(first.classIds) ? first.classIds : [first.classId].filter(Boolean);
    const clsName = clsIds.map((id) => nameOf(classes, id, "")).filter(Boolean).join(", ");
    const tch = first.teacherId ? nameOf(teachers, first.teacherId, "") : "";
    return {
      subj,
      clsName,
      tch,
      fromTxt: `${a.fromDay}, ${from?.lessonNumber ?? "?"}-dars`,
      toTxt: `${a.toDay}, ${to?.lessonNumber ?? "?"}-dars`,
      moved: !(a.fromDay === a.toDay && a.fromSlotId === a.toSlotId),
    };
  }

  const isConfirm = data.mode === "confirm";

  return (
    <div className="mvr-overlay" onClick={onClose}>
      <div className="mvr-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`mvr-head ${isConfirm ? "mvr-head-warn" : "mvr-head-stop"}`}>
          <span className="mvr-head-icon">{isConfirm ? "🔒" : "⛔"}</span>
          <div>
            <div className="mvr-title">
              {data.title || (isConfirm ? "Qulflangan dars o'zgaradi" : "Bu katakka qo'yib bo'lmadi")}
            </div>
            <div className="mvr-sub">
              {isConfirm
                ? "Quyidagi o'zgarishlar amalga oshadi. Tasdiqlaysizmi?"
                : "Sabablar quyida. Pastdagi yechimlardan birini tanlang."}
            </div>
          </div>
        </div>

        <div className="mvr-body">
          {Array.isArray(data.reasons) && data.reasons.length > 0 && (
            <div className="mvr-reasons">
              {data.reasons.map((r, i) => (
                <div className="mvr-reason" key={i}>• {r}</div>
              ))}
            </div>
          )}

          {Array.isArray(data.warnings) && data.warnings.length > 0 && (
            <div className="mvr-warns">
              {data.warnings.map((w, i) => (
                <div className="mvr-warn" key={i}>⚠️ {w}</div>
              ))}
            </div>
          )}

          {isConfirm && Array.isArray(data.actions) && (
            <div className="mvr-changes">
              <div className="mvr-changes-title">
                {data.actions.filter((a) => describeAction(a).moved).length} ta o'zgarish:
              </div>
              {data.actions.map((a, i) => {
                const d = describeAction(a);
                if (!d.moved) return null;
                return (
                  <div className="mvr-change" key={i}>
                    <b>{d.clsName}</b> · {d.subj}
                    {d.tch ? <span className="mvr-dim"> ({d.tch})</span> : null}
                    <div className="mvr-arrow">{d.fromTxt} <span>→</span> {d.toTxt}</div>
                  </div>
                );
              })}
            </div>
          )}

          {!isConfirm && (
            Array.isArray(data.suggestions) && data.suggestions.length > 0 ? (
              <div className="mvr-suggs">
                <div className="mvr-suggs-title">Yechimlar (eng kam o'zgarishi bilan tartiblangan):</div>
                {data.suggestions.map((s, i) => (
                  <div className="mvr-sugg" key={i}>
                    <div className="mvr-sugg-info">
                      <span className="mvr-badge">{i + 1}</span>
                      <div>
                        <div className="mvr-sugg-label">{s.label}</div>
                        <div className="mvr-sugg-meta">
                          {s.changes} ta o'zgarish
                          {s.lockedInvolved ? " · 🔒 qulflangan dars tegiladi" : ""}
                        </div>
                      </div>
                    </div>
                    <button type="button" className="mvr-btn mvr-btn-apply" onClick={() => onApply(s.actions, s)}>
                      Qo'llash
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mvr-none">
                Mos yechim topilmadi. Bu darsni boshqa kunga qo'ying yoki ustoz dam kunini / smena
                sozlamasini tekshiring. Kerak bo'lsa fanga qo'shimcha ustoz biriktiring.
              </div>
            )
          )}
        </div>

        <div className="mvr-foot">
          <button type="button" className="mvr-btn mvr-btn-ghost" onClick={onClose}>
            {isConfirm ? "Bekor qilish" : "Yopish"}
          </button>
          {isConfirm && (
            <button type="button" className="mvr-btn mvr-btn-primary" onClick={() => onApply(data.actions, data)}>
              Baribir ko'chirish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
