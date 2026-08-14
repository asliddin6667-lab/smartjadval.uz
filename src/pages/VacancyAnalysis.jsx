import { useMemo, useState } from "react";
import "./vacancy.css";

// =====================================================================
//  VAKANSIYA VA YUKLAMA TAHLILI — umumiy modul
//
//  Maktab ma'lumotlaridan (classes, subjects, teachers, classSubjects)
//  uchta kesimda tahlil quradi:
//    1. FANLAR   — har bir fan bo'yicha kerakli / biriktirilgan / vakant
//    2. SINFLAR  — har bir sinfning haftalik setkasi, fanlari, ustozlari
//    3. USTOZLAR — har bir ustozning yuklamasi, sinflari, fanlari
//
//  Ishlatiladi:
//    1. Maktab foydalanuvchisi — Tahlil (Analytics) sahifasida
//    2. Tuman admin — "💼 Vakansiyalar" bo'limi va maktab oynasida
//
//  Hisoblash mantig'i (o'zgarmagan):
//    - Har bir sinf-fan biriktiruvi (classSubjects) "o'rin"larga
//      ajratiladi: oddiy dars = 1 o'rin (teacherId), bo'lingan guruh =
//      2 o'rin (teacherId + teacherId2), daraja guruhi (hovuz) = har
//      guruh alohida o'rin.
//    - O'rin bo'sh (o'qituvchi tanlanmagan) bo'lsa — shu fanning
//      haftalik soati VAKANT hisoblanadi.
//    - O'qituvchining biriktirilgan jami soati maksimal soatidan
//      (t.maxWeeklyHours, bo'lmasa 25) oshsa — ORTIQCHA YUKLAMA.
//    - Vakant soat > 0 yoki ortiqcha yuklama > 0 → maktab MUHTOJ.
//
//  MUHIM farq:
//    darsSoati (lessonHours)  — sinf setkasidagi real dars soati
//                               (bo'lingan guruh 1 marta sanaladi)
//    ustozSoati (staffHours)  — o'qituvchi-soat, ya'ni har o'rin alohida
//                               (bo'lingan guruh 2 marta sanaladi)
// =====================================================================

export const DEFAULT_MAX_HOURS = 25;

function emptyResult() {
  return {
    hasData: false,
    subjects: [],
    vacantSubjects: [],
    teachers: [],
    overloaded: [],
    classes: [],
    requiredTotal: 0,
    assignedTotal: 0,
    vacantTotal: 0,
    overloadTotal: 0,
    lessonHoursTotal: 0,
    classCount: 0,
    teacherCount: 0,
    activeTeacherCount: 0,
    idleTeacherCount: 0,
    avgLoadPct: 0,
    needy: false,
  };
}

export function computeVacancy(d) {
  if (!d || typeof d !== "object") return emptyResult();

  const classes = Array.isArray(d.classes) ? d.classes : [];
  const subjects = Array.isArray(d.subjects) ? d.subjects : [];
  const teachers = Array.isArray(d.teachers) ? d.teachers : [];
  const classSubjects =
    d.classSubjects && typeof d.classSubjects === "object" ? d.classSubjects : {};

  if (!classes.length) return emptyResult();

  const subjName = new Map(subjects.map((s) => [s.id, s.name]));
  const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

  const req = new Map();          // subjectId -> kerakli jami soat
  const ass = new Map();          // subjectId -> biriktirilgan soat
  const vac = new Map();          // subjectId -> vakant soat
  const vacByClass = new Map();   // subjectId -> Map(sinf -> soat)
  const declared = new Map();     // teacherId -> jami biriktirilgan soat
  const declaredSubj = new Map(); // teacherId -> Map(subjectId -> soat)

  // --- yangi yig'malar ---
  const classAgg = new Map();     // classId -> sinf kesimi
  const tClasses = new Map();     // teacherId -> Set(classId)
  const tDetails = new Map();     // teacherId -> [{className, subjectName, hours}]

  const bump = (m, k, h) => m.set(k, (m.get(k) || 0) + h);

  for (const c of classes) {
    const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];

    const agg = {
      id: c.id,
      name: c.name || "?",
      lessonHours: 0,   // sinf setkasidagi real dars soati
      staffHours: 0,    // o'qituvchi-soat (kerakli)
      assigned: 0,      // biriktirilgan o'qituvchi-soat
      vacant: 0,        // vakant o'qituvchi-soat
      subjectCount: 0,
      teacherCount: 0,
      details: [],      // [{subjectName, hours, slots:[name|null], vacantSlots}]
      _subjSet: new Set(),
      _teachSet: new Set(),
    };

    for (const a of list) {
      if (!a) continue;
      const h = Number(a.weeklyHours || 0);
      const sid = a.subjectId;
      if (!h || !sid) continue;

      // O'rinlar ro'yxati: har o'rin bitta o'qituvchi talab qiladi
      let slots;
      if (a.levelGroupEnabled && Array.isArray(a.levelGroups) && a.levelGroups.length) {
        slots = a.levelGroups.map((g) => (g && g.teacherId) || "");
      } else {
        slots = [a.teacherId || ""];
        if (a.teacherId2) slots.push(a.teacherId2);
      }

      // --- sinf kesimi ---
      agg.lessonHours += h;
      agg._subjSet.add(sid);
      const slotNames = [];
      let vacantSlots = 0;

      for (const tid of slots) {
        bump(req, sid, h);
        agg.staffHours += h;

        if (tid) {
          bump(ass, sid, h);
          bump(declared, tid, h);
          if (!declaredSubj.has(tid)) declaredSubj.set(tid, new Map());
          bump(declaredSubj.get(tid), sid, h);

          agg.assigned += h;
          agg._teachSet.add(tid);
          slotNames.push(teacherName.get(tid) || "Noma'lum ustoz");

          // --- ustoz kesimi ---
          if (!tClasses.has(tid)) tClasses.set(tid, new Set());
          tClasses.get(tid).add(c.id);
          if (!tDetails.has(tid)) tDetails.set(tid, []);
          tDetails.get(tid).push({
            className: c.name || "?",
            subjectName: subjName.get(sid) || "Noma'lum fan",
            hours: h,
          });
        } else {
          bump(vac, sid, h);
          if (!vacByClass.has(sid)) vacByClass.set(sid, new Map());
          bump(vacByClass.get(sid), c.name || "?", h);

          agg.vacant += h;
          vacantSlots += 1;
          slotNames.push(null);
        }
      }

      agg.details.push({
        subjectName: subjName.get(sid) || "Noma'lum fan",
        hours: h,
        slots: slotNames,
        vacantSlots,
      });
    }

    agg.subjectCount = agg._subjSet.size;
    agg.teacherCount = agg._teachSet.size;
    delete agg._subjSet;
    delete agg._teachSet;
    agg.details.sort((x, y) =>
      (y.hours - x.hours) || x.subjectName.localeCompare(y.subjectName, "uz")
    );
    classAgg.set(c.id, agg);
  }

  const subjectRows = [...req.keys()]
    .map((sid) => ({
      id: sid,
      name: subjName.get(sid) || "Noma'lum fan",
      required: req.get(sid) || 0,
      assigned: ass.get(sid) || 0,
      vacant: vac.get(sid) || 0,
      vacantClasses: [...(vacByClass.get(sid) || new Map()).entries()]
        .map(([cls, hours]) => ({ cls, hours }))
        .sort((x, y) => String(x.cls).localeCompare(String(y.cls), "uz", { numeric: true })),
    }))
    .sort((x, y) => (y.vacant - x.vacant) || x.name.localeCompare(y.name, "uz"));

  const teacherRows = teachers
    .filter((t) => t && t.name)
    .map((t) => {
      const dec = declared.get(t.id) || 0;
      const ownMax = Number(t.maxWeeklyHours || t.maxHours || 0);
      const max = ownMax > 0 ? ownMax : DEFAULT_MAX_HOURS;
      const sMap = declaredSubj.get(t.id);
      const subjectList = sMap
        ? [...sMap.entries()]
            .map(([sid, hours]) => ({ name: subjName.get(sid) || "Noma'lum fan", hours }))
            .sort((x, y) => (y.hours - x.hours) || x.name.localeCompare(y.name, "uz"))
        : [];
      const subjectNames = subjectList.map((s) => s.name).join(", ");
      const details = (tDetails.get(t.id) || []).slice().sort(
        (x, y) =>
          String(x.className).localeCompare(String(y.className), "uz", { numeric: true }) ||
          x.subjectName.localeCompare(y.subjectName, "uz")
      );
      return {
        id: t.id,
        name: t.name,
        subjectNames,
        subjectList,
        subjectCount: subjectList.length,
        classCount: (tClasses.get(t.id) || new Set()).size,
        details,
        declared: dec,
        max,
        hasOwnMax: ownMax > 0,
        excess: Math.max(0, dec - max),
        free: Math.max(0, max - dec),
        loadPct: max > 0 ? Math.round((dec / max) * 100) : 0,
      };
    })
    .sort((x, y) =>
      (y.excess - x.excess) || (y.declared - x.declared) || x.name.localeCompare(y.name, "uz")
    );

  const classRows = [...classAgg.values()].sort((x, y) =>
    String(x.name).localeCompare(String(y.name), "uz", { numeric: true })
  );

  const overloaded = teacherRows.filter((t) => t.excess > 0);
  const requiredTotal = subjectRows.reduce((a, r) => a + r.required, 0);
  const assignedTotal = subjectRows.reduce((a, r) => a + r.assigned, 0);
  const vacantTotal = subjectRows.reduce((a, r) => a + r.vacant, 0);
  const overloadTotal = overloaded.reduce((a, t) => a + t.excess, 0);
  const lessonHoursTotal = classRows.reduce((a, c) => a + c.lessonHours, 0);
  const activeTeachers = teacherRows.filter((t) => t.declared > 0);
  const avgLoadPct = activeTeachers.length
    ? Math.round(activeTeachers.reduce((a, t) => a + t.loadPct, 0) / activeTeachers.length)
    : 0;

  return {
    hasData: requiredTotal > 0,
    subjects: subjectRows,
    vacantSubjects: subjectRows.filter((r) => r.vacant > 0),
    teachers: teacherRows,
    overloaded,
    classes: classRows,
    requiredTotal,
    assignedTotal,
    vacantTotal,
    overloadTotal,
    lessonHoursTotal,
    classCount: classRows.length,
    teacherCount: teacherRows.length,
    activeTeacherCount: activeTeachers.length,
    idleTeacherCount: teacherRows.length - activeTeachers.length,
    avgLoadPct,
    needy: vacantTotal > 0 || overloadTotal > 0,
  };
}

// Qisqa matn: "Fizika (12), Kimyo (4)" — jadval/ro'yxatlarda ishlatiladi
export function vacancySummaryText(vacResult, limit = 3) {
  if (!vacResult || !vacResult.vacantSubjects.length) return "";
  const parts = vacResult.vacantSubjects
    .slice(0, limit)
    .map((r) => `${r.name} (${r.vacant})`);
  const rest = vacResult.vacantSubjects.length - limit;
  return parts.join(", ") + (rest > 0 ? ` +${rest} fan` : "");
}

// ---------------------------------------------------------------------
//  Holat belgisi (badge)
// ---------------------------------------------------------------------
export function VacancyBadge({ vac }) {
  if (!vac || !vac.hasData) {
    return <span className="vak-badge vak-badge--muted">Ma'lumot yo'q</span>;
  }
  if (vac.vacantTotal > 0) {
    return <span className="vak-badge vak-badge--bad">🆘 Muhtoj · {vac.vacantTotal} soat vakant</span>;
  }
  if (vac.overloadTotal > 0) {
    return <span className="vak-badge vak-badge--warn">⚠️ Ortiqcha yuklama · {vac.overloadTotal} soat</span>;
  }
  return <span className="vak-badge vak-badge--ok">✓ Ta'minlangan</span>;
}

// ---------------------------------------------------------------------
//  Kichik yordamchi komponentlar
// ---------------------------------------------------------------------

function SortTh({ label, sortKey, sort, onSort, center, width }) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`vak-th ${center ? "vak-c" : ""} ${active ? "vak-th--active" : ""}`}
      style={width ? { width } : undefined}
      onClick={() => onSort(sortKey)}
      title="Saralash uchun bosing"
    >
      <span className="vak-th__in">
        {label}
        <span className="vak-th__arrow">{active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </span>
    </th>
  );
}

function LoadBar({ pct }) {
  const w = Math.min(100, Math.max(0, pct));
  const tone = pct > 100 ? "bad" : pct >= 85 ? "warn" : pct > 0 ? "ok" : "muted";
  return (
    <div className="vak-bar" title={`${pct}%`}>
      <div className={`vak-bar__fill vak-bar__fill--${tone}`} style={{ width: `${w}%` }} />
      <span className={`vak-bar__txt vak-bar__txt--${tone}`}>{pct}%</span>
    </div>
  );
}

function Toolbar({ value, onChange, placeholder, chips, right }) {
  return (
    <div className="vak-toolbar">
      <div className="vak-search">
        <span className="vak-search__icon">🔍</span>
        <input
          className="vak-search__input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button type="button" className="vak-search__clear" onClick={() => onChange("")}>
            ✕
          </button>
        )}
      </div>
      {chips && <div className="vak-tabs">{chips}</div>}
      {right && <div className="vak-toolbar__right">{right}</div>}
    </div>
  );
}

function useSorter(defaultKey, defaultDir = "desc") {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const onSort = (key) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }
    );
  return [sort, onSort];
}

function applySort(rows, sort) {
  const { key, dir } = sort;
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return (x - y) * m;
    return String(x ?? "").localeCompare(String(y ?? ""), "uz", { numeric: true }) * m;
  });
}

function MiniStats({ items }) {
  return (
    <div className="vak-mini">
      {items.map((it, i) => (
        <div key={i} className={`vak-mini__item ${it.tone ? `vak-mini__item--${it.tone}` : ""}`}>
          <span className="vak-mini__val">{it.value}</span>
          <span className="vak-mini__lab">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
//  TAB 1 — FANLAR
// =====================================================================
function SubjectsTab({ data }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | vacant
  const [sort, onSort] = useSorter("vacant");

  const rows = useMemo(() => {
    let r = data.subjects;
    if (only === "vacant") r = r.filter((x) => x.vacant > 0);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => x.name.toLowerCase().includes(s));
    return applySort(r, sort);
  }, [data.subjects, q, only, sort]);

  const shownReq = rows.reduce((a, r) => a + r.required, 0);
  const shownAss = rows.reduce((a, r) => a + r.assigned, 0);
  const shownVac = rows.reduce((a, r) => a + r.vacant, 0);

  return (
    <>
      <MiniStats
        items={[
          { value: data.subjects.length, label: "Jami fan" },
          { value: data.vacantSubjects.length, label: "Vakansiyali fan", tone: data.vacantSubjects.length ? "bad" : "ok" },
          { value: data.requiredTotal, label: "Kerakli o'qituvchi-soat" },
          { value: data.vacantTotal, label: "Vakant soat", tone: data.vacantTotal ? "bad" : "ok" },
        ]}
      />

      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="Fan nomi bo'yicha qidirish..."
        chips={
          <>
            <button
              type="button"
              className={`vak-tab ${only === "all" ? "vak-tab--active" : ""}`}
              onClick={() => setOnly("all")}
            >
              Hammasi ({data.subjects.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${only === "vacant" ? "vak-tab--active" : ""}`}
              onClick={() => setOnly("vacant")}
            >
              Vakansiyali ({data.vacantSubjects.length})
            </button>
          </>
        }
      />

      <div className="vak-tablewrap">
        <table className="vak-table">
          <thead>
            <tr>
              <SortTh label="Fan" sortKey="name" sort={sort} onSort={onSort} />
              <SortTh label="Kerakli" sortKey="required" sort={sort} onSort={onSort} center />
              <SortTh label="Biriktirilgan" sortKey="assigned" sort={sort} onSort={onSort} center />
              <SortTh label="Vakant" sortKey="vacant" sort={sort} onSort={onSort} center />
              <th>Vakant sinflar</th>
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="vak-dim vak-c">Mos fan topilmadi</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className={r.vacant > 0 ? "vak-row--bad" : ""}>
                  <td><b>{r.name}</b></td>
                  <td className="vak-c">{r.required}</td>
                  <td className="vak-c">{r.assigned}</td>
                  <td className="vak-c">
                    {r.vacant > 0 ? <b className="vak-red">{r.vacant}</b> : <span className="vak-dim">—</span>}
                  </td>
                  <td className="vak-classes">
                    {r.vacantClasses.length ? (
                      r.vacantClasses.map((v, i) => (
                        <span key={i} className="vak-chip vak-chip--bad">
                          {v.cls} · {v.hours}
                        </span>
                      ))
                    ) : (
                      <span className="vak-dim">—</span>
                    )}
                  </td>
                  <td>
                    {r.vacant > 0 ? (
                      <span className="vak-badge vak-badge--bad">🆘 {r.vacant} soat vakant</span>
                    ) : (
                      <span className="vak-badge vak-badge--ok">✓ To'liq</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="vak-total">
              <td><b>Jami{rows.length !== data.subjects.length ? " (filtr)" : ""}</b></td>
              <td className="vak-c"><b>{shownReq}</b></td>
              <td className="vak-c"><b>{shownAss}</b></td>
              <td className="vak-c"><b className={shownVac ? "vak-red" : ""}>{shownVac || "—"}</b></td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// =====================================================================
//  TAB 2 — SINFLAR
// =====================================================================
function ClassesTab({ data }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | vacant
  const [sort, onSort] = useSorter("name", "asc");
  const [open, setOpen] = useState(() => new Set());

  const toggle = (id) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const vacantClasses = data.classes.filter((c) => c.vacant > 0);

  const rows = useMemo(() => {
    let r = data.classes;
    if (only === "vacant") r = r.filter((x) => x.vacant > 0);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => String(x.name).toLowerCase().includes(s));
    return applySort(r, sort);
  }, [data.classes, q, only, sort]);

  const shownLesson = rows.reduce((a, r) => a + r.lessonHours, 0);
  const shownStaff = rows.reduce((a, r) => a + r.staffHours, 0);
  const shownVac = rows.reduce((a, r) => a + r.vacant, 0);
  const avgLesson = data.classCount ? Math.round(data.lessonHoursTotal / data.classCount) : 0;

  return (
    <>
      <MiniStats
        items={[
          { value: data.classCount, label: "Jami sinf" },
          { value: data.lessonHoursTotal, label: "Haftalik dars soati" },
          { value: avgLesson, label: "O'rtacha sinf setkasi" },
          { value: vacantClasses.length, label: "Vakansiyali sinf", tone: vacantClasses.length ? "bad" : "ok" },
        ]}
      />

      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="Sinf nomi bo'yicha qidirish..."
        chips={
          <>
            <button
              type="button"
              className={`vak-tab ${only === "all" ? "vak-tab--active" : ""}`}
              onClick={() => setOnly("all")}
            >
              Hammasi ({data.classes.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${only === "vacant" ? "vak-tab--active" : ""}`}
              onClick={() => setOnly("vacant")}
            >
              Vakansiyali ({vacantClasses.length})
            </button>
          </>
        }
        right={
          <button
            type="button"
            className="vak-linkbtn"
            onClick={() =>
              setOpen((prev) => (prev.size ? new Set() : new Set(rows.map((r) => r.id))))
            }
          >
            {open.size ? "Hammasini yopish" : "Hammasini ochish"}
          </button>
        }
      />

      <div className="vak-tablewrap">
        <table className="vak-table vak-table--exp">
          <thead>
            <tr>
              <th className="vak-expcol"></th>
              <SortTh label="Sinf" sortKey="name" sort={sort} onSort={onSort} />
              <SortTh label="Dars soati" sortKey="lessonHours" sort={sort} onSort={onSort} center />
              <SortTh label="O'qituvchi-soat" sortKey="staffHours" sort={sort} onSort={onSort} center />
              <SortTh label="Fanlar" sortKey="subjectCount" sort={sort} onSort={onSort} center />
              <SortTh label="Ustozlar" sortKey="teacherCount" sort={sort} onSort={onSort} center />
              <SortTh label="Vakant" sortKey="vacant" sort={sort} onSort={onSort} center />
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="vak-dim vak-c">Mos sinf topilmadi</td>
              </tr>
            ) : (
              rows.map((c) => {
                const isOpen = open.has(c.id);
                return [
                  <tr
                    key={c.id}
                    className={`vak-clickrow ${c.vacant > 0 ? "vak-row--bad" : ""}`}
                    onClick={() => toggle(c.id)}
                  >
                    <td className="vak-expcol">
                      <span className={`vak-caret ${isOpen ? "vak-caret--open" : ""}`}>▸</span>
                    </td>
                    <td><b>{c.name}</b></td>
                    <td className="vak-c"><b>{c.lessonHours}</b></td>
                    <td className="vak-c">{c.staffHours}</td>
                    <td className="vak-c">{c.subjectCount}</td>
                    <td className="vak-c">{c.teacherCount}</td>
                    <td className="vak-c">
                      {c.vacant > 0 ? <b className="vak-red">{c.vacant}</b> : <span className="vak-dim">—</span>}
                    </td>
                    <td>
                      {c.vacant > 0 ? (
                        <span className="vak-badge vak-badge--bad">🆘 {c.vacant} soat vakant</span>
                      ) : (
                        <span className="vak-badge vak-badge--ok">✓ To'liq</span>
                      )}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${c.id}-d`} className="vak-detailrow">
                      <td colSpan={8}>
                        <div className="vak-detail">
                          <div className="vak-detail__title">
                            {c.name} — fanlar va ustozlar ({c.details.length} ta biriktiruv)
                          </div>
                          {c.details.length === 0 ? (
                            <div className="vak-dim">Bu sinfga hali fan biriktirilmagan</div>
                          ) : (
                            <table className="vak-subtable">
                              <thead>
                                <tr>
                                  <th>Fan</th>
                                  <th className="vak-c">Soat</th>
                                  <th>Ustoz(lar)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.details.map((dt, i) => (
                                  <tr key={i} className={dt.vacantSlots > 0 ? "vak-row--bad" : ""}>
                                    <td>{dt.subjectName}</td>
                                    <td className="vak-c"><b>{dt.hours}</b></td>
                                    <td>
                                      {dt.slots.map((nm, j) =>
                                        nm ? (
                                          <span key={j} className="vak-chip">{nm}</span>
                                        ) : (
                                          <span key={j} className="vak-chip vak-chip--bad">
                                            🆘 Vakant
                                          </span>
                                        )
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })
            )}
          </tbody>
          <tfoot>
            <tr className="vak-total">
              <td></td>
              <td><b>Jami{rows.length !== data.classes.length ? " (filtr)" : ""}</b></td>
              <td className="vak-c"><b>{shownLesson}</b></td>
              <td className="vak-c"><b>{shownStaff}</b></td>
              <td></td>
              <td></td>
              <td className="vak-c"><b className={shownVac ? "vak-red" : ""}>{shownVac || "—"}</b></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="vak-note">
        <b>Dars soati</b> — sinf setkasidagi real haftalik dars soni.{" "}
        <b>O'qituvchi-soat</b> — har bir o'rin alohida sanaladi (bo'lingan guruh / daraja guruhi
        ikki barobar hisoblanadi).
      </div>
    </>
  );
}

// =====================================================================
//  TAB 3 — USTOZLAR
// =====================================================================
function TeachersTab({ data }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | over | idle | low
  const [sort, onSort] = useSorter("declared");
  const [open, setOpen] = useState(() => new Set());

  const toggle = (id) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const idle = data.teachers.filter((t) => t.declared === 0);
  const low = data.teachers.filter((t) => t.declared > 0 && t.loadPct < 60);

  const rows = useMemo(() => {
    let r = data.teachers;
    if (filter === "over") r = data.overloaded;
    else if (filter === "idle") r = idle;
    else if (filter === "low") r = low;
    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter(
        (x) =>
          x.name.toLowerCase().includes(s) ||
          (x.subjectNames || "").toLowerCase().includes(s) ||
          x.details.some((d) => String(d.className).toLowerCase().includes(s))
      );
    }
    return applySort(r, sort);
  }, [data.teachers, data.overloaded, idle, low, q, filter, sort]);

  const shownDeclared = rows.reduce((a, r) => a + r.declared, 0);
  const hasDefaultMax = data.teachers.some((t) => !t.hasOwnMax);

  return (
    <>
      <MiniStats
        items={[
          { value: data.teacherCount, label: "Jami ustoz" },
          { value: data.activeTeacherCount, label: "Yuklamali ustoz" },
          { value: `${data.avgLoadPct}%`, label: "O'rtacha yuklama", tone: data.avgLoadPct > 100 ? "bad" : data.avgLoadPct >= 85 ? "warn" : "ok" },
          { value: data.overloaded.length, label: "Ortiqcha yuklamali", tone: data.overloaded.length ? "warn" : "ok" },
        ]}
      />

      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="Ustoz, fan yoki sinf bo'yicha qidirish..."
        chips={
          <>
            <button
              type="button"
              className={`vak-tab ${filter === "all" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              Hammasi ({data.teachers.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${filter === "over" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("over")}
            >
              Ortiqcha ({data.overloaded.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${filter === "low" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("low")}
            >
              Kam yuklama ({low.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${filter === "idle" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("idle")}
            >
              Soatsiz ({idle.length})
            </button>
          </>
        }
        right={
          <button
            type="button"
            className="vak-linkbtn"
            onClick={() =>
              setOpen((prev) => (prev.size ? new Set() : new Set(rows.map((r) => r.id))))
            }
          >
            {open.size ? "Hammasini yopish" : "Hammasini ochish"}
          </button>
        }
      />

      <div className="vak-tablewrap">
        <table className="vak-table vak-table--exp">
          <thead>
            <tr>
              <th className="vak-expcol"></th>
              <SortTh label="F.I.Sh." sortKey="name" sort={sort} onSort={onSort} />
              <SortTh label="Fanlar" sortKey="subjectCount" sort={sort} onSort={onSort} center />
              <SortTh label="Sinflar" sortKey="classCount" sort={sort} onSort={onSort} center />
              <SortTh label="Biriktirilgan" sortKey="declared" sort={sort} onSort={onSort} center />
              <SortTh label="Maksimal" sortKey="max" sort={sort} onSort={onSort} center />
              <SortTh label="Yuklama" sortKey="loadPct" sort={sort} onSort={onSort} />
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="vak-dim vak-c">Mos ustoz topilmadi</td>
              </tr>
            ) : (
              rows.map((t) => {
                const isOpen = open.has(t.id);
                return [
                  <tr
                    key={t.id}
                    className={`vak-clickrow ${t.excess > 0 ? "vak-row--warn" : ""}`}
                    onClick={() => toggle(t.id)}
                  >
                    <td className="vak-expcol">
                      <span className={`vak-caret ${isOpen ? "vak-caret--open" : ""}`}>▸</span>
                    </td>
                    <td>
                      <b>{t.name}</b>
                      {t.subjectNames && <div className="vak-sub">{t.subjectNames}</div>}
                    </td>
                    <td className="vak-c">{t.subjectCount || <span className="vak-dim">—</span>}</td>
                    <td className="vak-c">{t.classCount || <span className="vak-dim">—</span>}</td>
                    <td className="vak-c"><b>{t.declared || "—"}</b></td>
                    <td className="vak-c">
                      {t.max}
                      {!t.hasOwnMax && <span className="vak-dim">*</span>}
                    </td>
                    <td><LoadBar pct={t.loadPct} /></td>
                    <td>
                      {t.excess > 0 ? (
                        <span className="vak-badge vak-badge--warn">+{t.excess} soat ortiqcha</span>
                      ) : t.declared === 0 ? (
                        <span className="vak-badge vak-badge--muted">Soat biriktirilmagan</span>
                      ) : t.free > 0 ? (
                        <span className="vak-badge vak-badge--ok">✓ Normal · {t.free} soat bo'sh</span>
                      ) : (
                        <span className="vak-badge vak-badge--ok">✓ To'liq band</span>
                      )}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${t.id}-d`} className="vak-detailrow">
                      <td colSpan={8}>
                        <div className="vak-detail">
                          <div className="vak-detail__title">
                            {t.name} — sinflar va soatlar ({t.details.length} ta biriktiruv)
                          </div>
                          {t.details.length === 0 ? (
                            <div className="vak-dim">Bu ustozga hali soat biriktirilmagan</div>
                          ) : (
                            <>
                              <table className="vak-subtable">
                                <thead>
                                  <tr>
                                    <th>Sinf</th>
                                    <th>Fan</th>
                                    <th className="vak-c">Soat</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.details.map((dt, i) => (
                                    <tr key={i}>
                                      <td><b>{dt.className}</b></td>
                                      <td>{dt.subjectName}</td>
                                      <td className="vak-c"><b>{dt.hours}</b></td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr>
                                    <td colSpan={2}><b>Jami</b></td>
                                    <td className="vak-c"><b>{t.declared}</b></td>
                                  </tr>
                                </tfoot>
                              </table>
                              {t.subjectList.length > 1 && (
                                <div className="vak-detail__chips">
                                  {t.subjectList.map((s, i) => (
                                    <span key={i} className="vak-chip">
                                      {s.name} · {s.hours} soat
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })
            )}
          </tbody>
          <tfoot>
            <tr className="vak-total">
              <td></td>
              <td><b>Jami{rows.length !== data.teachers.length ? " (filtr)" : ""}</b></td>
              <td></td>
              <td></td>
              <td className="vak-c"><b>{shownDeclared}</b></td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {hasDefaultMax && (
        <div className="vak-note">
          * — o'qituvchiga maksimal soat kiritilmagan, standart {DEFAULT_MAX_HOURS} soat olindi.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
//  TO'LIQ HISOBOT — bitta maktab uchun
//  props:
//    data         — computeVacancy() natijasi
//    showTeachers — ustozlar/sinflar tablarini ko'rsatish (default: true)
// ---------------------------------------------------------------------
export function VacancyReport({ data, showTeachers = true }) {
  const [tab, setTab] = useState("subjects"); // subjects | classes | teachers

  if (!data || !data.hasData) {
    return (
      <div className="vak-empty">
        <div className="vak-empty__icon">💼</div>
        <div className="vak-empty__title">Vakansiya tahlili uchun ma'lumot yo'q</div>
        <div className="vak-empty__text">
          "Sinf fanlari" bo'limida fanlarga haftalik soat va o'qituvchi biriktirilsa,
          tahlil shu yerda avtomatik hisoblanadi.
        </div>
      </div>
    );
  }

  const pct = data.requiredTotal
    ? Math.round((data.assignedTotal / data.requiredTotal) * 100)
    : 0;

  const KPIS = [
    { icon: "🕐", label: "Kerakli jami soat", value: data.requiredTotal, cls: "" },
    { icon: "✅", label: "Biriktirilgan soat", value: `${data.assignedTotal} (${pct}%)`, cls: "vak-kpi--ok" },
    { icon: "💼", label: "Vakant soat", value: data.vacantTotal, cls: data.vacantTotal > 0 ? "vak-kpi--bad" : "vak-kpi--ok" },
    { icon: "⚠️", label: "Ortiqcha yuklama", value: data.overloadTotal, cls: data.overloadTotal > 0 ? "vak-kpi--warn" : "vak-kpi--ok" },
  ];

  const TABS = [
    { id: "subjects", icon: "📚", label: "Fanlar", count: data.subjects.length },
    { id: "classes", icon: "🏫", label: "Sinflar", count: data.classes.length },
    { id: "teachers", icon: "👨‍🏫", label: "Ustozlar", count: data.teachers.length },
  ].filter((t) => (showTeachers ? true : t.id === "subjects"));

  const active = TABS.some((t) => t.id === tab) ? tab : "subjects";

  return (
    <div className="vak-root">
      {/* Umumiy holat */}
      <div className="vak-statusrow">
        <VacancyBadge vac={data} />
        {data.vacantTotal > 0 && (
          <span className="vak-statusrow__note">
            Vakant fanlar: <b>{vacancySummaryText(data, 5)}</b> — yangi o'qituvchi kerak
          </span>
        )}
      </div>

      <div className="vak-kpis">
        {KPIS.map((k, i) => (
          <div key={i} className={`vak-kpi ${k.cls}`}>
            <div className="vak-kpi__icon">{k.icon}</div>
            <div>
              <div className="vak-kpi__value">{k.value}</div>
              <div className="vak-kpi__label">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Kesimlar */}
      <div className="vak-section">
        <div className="vak-segwrap">
          <div className="vak-seg">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`vak-seg__btn ${active === t.id ? "vak-seg__btn--active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span className="vak-seg__icon">{t.icon}</span>
                <span>{t.label}</span>
                <span className="vak-seg__count">{t.count}</span>
              </button>
            ))}
          </div>
        </div>

        {active === "subjects" && <SubjectsTab data={data} />}
        {active === "classes" && <ClassesTab data={data} />}
        {active === "teachers" && <TeachersTab data={data} />}
      </div>

      {data.needy && (
        <div className="vak-alert">
          🆘 Xulosa: bu maktabga
          {data.vacantTotal > 0 && <> <b>{data.vacantTotal} soat</b> uchun yangi o'qituvchi kerak</>}
          {data.vacantTotal > 0 && data.overloadTotal > 0 && " va"}
          {data.overloadTotal > 0 && <> <b>{data.overloadTotal} soat</b> ortiqcha yuklamani qayta taqsimlash lozim</>}.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
//  Maktab foydalanuvchisi uchun tayyor sahifa bo'lagi — Tahlil
//  (Analytics) sahifasiga qo'yiladi. Xom state'lardan o'zi hisoblaydi.
// ---------------------------------------------------------------------
export default function VacancyAnalysis({ classes, subjects, teachers, classSubjects }) {
  const data = useMemo(
    () => computeVacancy({ classes, subjects, teachers, classSubjects }),
    [classes, subjects, teachers, classSubjects]
  );
  return (
    <div className="vak-card">
      <div className="vak-card__title">💼 Vakansiya va yuklama tahlili</div>
      <VacancyReport data={data} />
    </div>
  );
}
