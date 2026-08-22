import { Fragment, useMemo, useState } from "react";
import { DAYS } from "../utils/constants";
import { groupSlotsByShift, shiftSlotNumbers } from "../utils/shiftSlots";
import "./vacancy.css";

// =====================================================================
//  VAKANSIYA VA YUKLAMA TAHLILI — umumiy modul
//
//  Maktab ma'lumotlaridan (classes, subjects, teachers, classSubjects)
//  uchta kesimda tahlil quradi:
//    1. FANLAR   — kerakli / biriktirilgan / vakant soat
//    2. SINFLAR  — sinf setkasi, fanlari, ustozlari, vakant o'rinlari
//    3. USTOZLAR — yuklama, qaysi sinflarga qaysi fandan necha soat
//
//  Ishlatiladi:
//    1. Maktab foydalanuvchisi — Tahlil (Analytics) sahifasida
//    2. Tuman admin — "💼 Vakansiyalar" bo'limi va maktab oynasida
//
//  Hisoblash mantig'i:
//    - Har bir sinf-fan biriktiruvi (classSubjects) "o'rin"larga
//      ajratiladi: oddiy dars = 1 o'rin (teacherId), bo'lingan guruh =
//      2 o'rin (teacherId + teacherId2), daraja guruhi (hovuz) = har
//      guruh alohida o'rin.
//    - HOVUZ (birlashgan sinflar): 2-A va 2-B bitta hovuzga birikkan
//      bo'lsa, ustoz ikkala sinfga BIR VAQTDA, bitta slotda dars
//      beradi. Shu sababli soat FAQAT 1 MARTA hisoblanadi —
//      sinflar soniga ko'paytirilmaydi. Sinflar ro'yxatda alohida
//      ko'rinaveradi, lekin soat bir marta sanaladi.
//    - O'rin bo'sh (o'qituvchi tanlanmagan) bo'lsa — shu fanning
//      haftalik soati VAKANT hisoblanadi.
//    - O'qituvchining biriktirilgan jami soati maksimal soatidan
//      (t.maxWeeklyHours, bo'lmasa 25) oshsa — ORTIQCHA YUKLAMA.
//    - Vakant soat > 0 yoki ortiqcha yuklama > 0 → maktab MUHTOJ.
//
//  SINF KESIMIDA ikki xil soat ko'rsatiladi:
//    darsSoati  (lessonHours) — sinf setkasidagi real dars soati.
//                               Hovuz darsi sinf setkasida bor, shuning
//                               uchun har ikkala sinfda ham sanaladi.
//    ustozSoati (staffHours)  — o'qituvchi-soat: har o'rin alohida
//                               (bo'lingan guruh 2 barobar).
// =====================================================================

export const DEFAULT_MAX_HOURS = 25;

// ---------------------------------------------------------------------
//  HOVUZ ANIQLASH
//  classSubjects yozuvida hovuz turli nomlar bilan saqlangan bo'lishi
//  mumkin. Quyidagi tartibda qidiriladi:
//    1) To'g'ridan-to'g'ri hovuz ID maydoni (poolId, hovuzId, ...)
//    2) Nomi pool/hovuz/level/daraja/guruh/parallel bilan boshlanib,
//       id/key/code bilan tugaydigan har qanday maydon
//    3) Hovuzga kiruvchi sinflar ro'yxati (classIds, poolClassIds, ...)
//  Topilmasa null qaytadi — oddiy dars kabi hisoblanadi.
// ---------------------------------------------------------------------
const POOL_ID_FIELDS = [
  "poolId",
  "hovuzId",
  "poolKey",
  "levelPoolId",
  "levelGroupId",
  "levelGroupKey",
  "darajaGuruhId",
  "guruhId",
  "groupId",
  "sharedId",
  "sharedGroupId",
  "linkId",
  "linkedId",
  "pairId",
  "parallelId",
];

const POOL_CLASS_FIELDS = [
  "poolClassIds",
  "hovuzClassIds",
  "sharedClassIds",
  "linkedClassIds",
  "groupClassIds",
  "classIds",
];

export function poolSignature(a) {
  if (!a || typeof a !== "object") return null;

  // 0) "Bir vaqtda 2 fan" + parallel sinflar (`pairGroupKey`).
  //    1-guruh fanini guruhdagi BARCHA sinf bitta ustozdan, AYNI SOATDA
  //    o'qiydi — demak ustozga ham, kerakli soatga ham BIR MARTA yoziladi.
  //    Kalit faqat `pairEnabled` yoqilganda ishlaydi: rejim o'chirilganda
  //    qolib ketgan eski kalit sinflarni noto'g'ri birlashtirmasin.
  if (a.pairEnabled) {
    const pairKey = String(a.pairGroupKey || "").trim();
    if (pairKey) return `id:${pairKey}`;
  }

  // 1) Aniq nomlangan hovuz ID
  for (const f of POOL_ID_FIELDS) {
    const v = a[f];
    if (v && typeof v !== "object") return `id:${String(v)}`;
  }

  // 2) Umumiy qidiruv — pool*/hovuz*/level*/daraja*/guruh*/parallel* + Id/Key/Code
  for (const k of Object.keys(a)) {
    if (
      /^(pool|hovuz|level|daraja|group|guruh|parallel|shared|link)/i.test(k) &&
      /(id|key|code)$/i.test(k)
    ) {
      const v = a[k];
      if (v && typeof v !== "object") return `id:${String(v)}`;
    }
  }

  // 3) Hovuzga kiruvchi sinflar ro'yxati (kamida 2 ta sinf)
  for (const f of POOL_CLASS_FIELDS) {
    const ids = a[f];
    if (Array.isArray(ids) && ids.length > 1) {
      return `cls:${[...ids].map(String).sort().join(",")}`;
    }
  }

  return null;
}

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
    poolMergedTotal: 0,
    lessonHoursTotal: 0,
    classCount: 0,
    teacherCount: 0,
    activeTeacherCount: 0,
    idleTeacherCount: 0,
    avgLoadPct: 0,
    needy: false,
  };
}

const uzCmp = (x, y) => String(x).localeCompare(String(y), "uz", { numeric: true });

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

  // --- sinf va ustoz kesimlari ---
  const classAgg = new Map();     // classId -> sinf yig'masi
  const tDetail = new Map();      // teacherId -> Map(detailKey -> {classNames:Set, subjectName, hours, pooled})
  const tClasses = new Map();     // teacherId -> Set(classId)

  const bump = (m, k, h) => m.set(k, (m.get(k) || 0) + h);

  // ---- 1-bosqich: barcha biriktiruvlarni yig'ish + hovuz sinflarini aniqlash
  const entries = [];
  const poolClassNames = new Map(); // sig -> Set(sinf nomlari)

  for (const c of classes) {
    classAgg.set(c.id, {
      id: c.id,
      name: c.name || "?",
      lessonHours: 0,
      staffHours: 0,
      assigned: 0,
      vacant: 0,
      subjectCount: 0,
      teacherCount: 0,
      pooledHours: 0,
      details: [],
      _subjSet: new Set(),
      _teachSet: new Set(),
    });

    const list = Array.isArray(classSubjects[c.id]) ? classSubjects[c.id] : [];
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
        if (a.splitEnabled && a.teacherId2) slots.push(a.teacherId2);
      }

      const sig = poolSignature(a);
      if (sig) {
        if (!poolClassNames.has(sig)) poolClassNames.set(sig, new Set());
        poolClassNames.get(sig).add(c.name || "?");
      }

      entries.push({ clsId: c.id, clsName: c.name || "?", h, sid, slots, sig });

      // ——— "Bir vaqtda 2 fan": 2-GURUH ———
      // Sinf ikkiga bo'linadi va 2-guruh AYNI SOATDA boshqa fanni boshqa
      // ustozdan o'qiydi. Bu mustaqil o'rin: o'z fani, o'z ustozi, o'z
      // vakansiyasi — shuning uchun alohida yozuv sifatida kiritiladi.
      // `sig` YO'Q: parallel guruhda ham 2-guruh fani har sinfda BOSHQA,
      // demak sinflar bo'yicha birlashtirilmaydi.
      // `pairPart` — soat 1-guruh bilan bir xil soatda o'tadi, shuning uchun
      // sinfning setka soatiga (`lessonHours`) IKKINCHI marta qo'shilmaydi.
      if (a.pairEnabled && a.pairSubjectId) {
        entries.push({
          clsId: c.id, clsName: c.name || "?", h,
          sid: a.pairSubjectId,
          slots: [a.pairTeacherId || ""],
          sig: null,
          pairPart: true,
        });
      }
    }
  }

  const poolLabel = (sig, fallback) =>
    sig
      ? `${[...(poolClassNames.get(sig) || [fallback])].sort(uzCmp).join(" + ")} (hovuz)`
      : fallback;

  // ---- 2-bosqich: hisoblash (hovuz — bir marta)
  const seenSlot = new Set();    // hovuz o'rni (fan + guruh) — kerakli/vakant uchun
  const seenTeach = new Set();   // hovuz o'rni + ustoz — yuklama uchun
  let poolMergedTotal = 0;       // hovuz tufayli qo'shilmagan (takroriy) soatlar
  let entryNo = 0;

  for (const e of entries) {
    entryNo += 1;
    const agg = classAgg.get(e.clsId);
    const sName = subjName.get(e.sid) || "Noma'lum fan";

    // --- sinf kesimi: dars soati har bir sinfda o'z setkasi bo'yicha
    if (agg) {
      // 2-guruh 1-guruh bilan AYNI soatda o'tadi — setka soati oshmaydi
      if (!e.pairPart) agg.lessonHours += e.h;
      agg._subjSet.add(e.sid);
      if (e.sig) agg.pooledHours += e.h;
    }
    const slotNames = [];
    let vacantSlots = 0;

    e.slots.forEach((tid, idx) => {
      const slotKey = e.sig ? `${e.sig}|${e.sid}|${idx}` : null;
      const teachKey = e.sig ? `${slotKey}|${tid || "-"}` : null;

      const dupSlot = slotKey ? seenSlot.has(slotKey) : false;
      const dupTeach = teachKey ? seenTeach.has(teachKey) : false;
      if (slotKey) seenSlot.add(slotKey);
      if (teachKey) seenTeach.add(teachKey);

      if (dupSlot) poolMergedTotal += e.h;

      // --- Fan bo'yicha kerakli / biriktirilgan / vakant
      if (!dupSlot) {
        bump(req, e.sid, e.h);
        if (tid) {
          bump(ass, e.sid, e.h);
        } else {
          bump(vac, e.sid, e.h);
          if (!vacByClass.has(e.sid)) vacByClass.set(e.sid, new Map());
          bump(vacByClass.get(e.sid), poolLabel(e.sig, e.clsName), e.h);
        }
      }

      // --- Sinf kesimi: o'rinlar
      if (agg) {
        agg.staffHours += e.h;
        if (tid) {
          agg.assigned += e.h;
          agg._teachSet.add(tid);
          slotNames.push(teacherName.get(tid) || "Noma'lum ustoz");
        } else {
          agg.vacant += e.h;
          vacantSlots += 1;
          slotNames.push(null);
        }
      }

      // --- O'qituvchi yuklamasi (hovuzda ayni ustoz 1 marta)
      if (tid) {
        if (!tClasses.has(tid)) tClasses.set(tid, new Set());
        tClasses.get(tid).add(e.clsId);
        if (!tDetail.has(tid)) tDetail.set(tid, new Map());

        const dKey = e.sig ? `p|${e.sig}|${e.sid}|${idx}` : `s|${entryNo}|${idx}`;
        const dMap = tDetail.get(tid);

        if (!dupTeach) {
          bump(declared, tid, e.h);
          if (!declaredSubj.has(tid)) declaredSubj.set(tid, new Map());
          bump(declaredSubj.get(tid), e.sid, e.h);
        }

        if (dMap.has(dKey)) {
          // hovuzning ikkinchi sinfi — soat qo'shilmaydi, sinf nomi qo'shiladi
          dMap.get(dKey).classNames.add(e.clsName);
        } else {
          dMap.set(dKey, {
            classNames: new Set([e.clsName]),
            subjectName: sName,
            hours: e.h,
            pooled: !!e.sig,
          });
        }
      }
    });

    if (agg) {
      agg.details.push({
        subjectName: sName,
        hours: e.h,
        slots: slotNames,
        vacantSlots,
        pooled: !!e.sig,
        poolLabel: e.sig ? poolLabel(e.sig, e.clsName) : "",
        pairPart: !!e.pairPart,
      });
    }
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
        .sort((x, y) => uzCmp(x.cls, y.cls)),
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
      const details = [...(tDetail.get(t.id) || new Map()).values()]
        .map((v) => ({
          className: [...v.classNames].sort(uzCmp).join(" + ") + (v.pooled && v.classNames.size > 1 ? " (hovuz)" : ""),
          subjectName: v.subjectName,
          hours: v.hours,
          pooled: v.pooled && v.classNames.size > 1,
        }))
        .sort(
          (x, y) =>
            uzCmp(x.className, y.className) || x.subjectName.localeCompare(y.subjectName, "uz")
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

  const classRows = [...classAgg.values()]
    .map((c) => {
      c.subjectCount = c._subjSet.size;
      c.teacherCount = c._teachSet.size;
      delete c._subjSet;
      delete c._teachSet;
      c.details.sort((x, y) => (y.hours - x.hours) || x.subjectName.localeCompare(y.subjectName, "uz"));
      return c;
    })
    .sort((x, y) => uzCmp(x.name, y.name));

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
    poolMergedTotal,
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

function SortTh({ label, sortKey, sort, onSort, center }) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`vak-th ${center ? "vak-c" : ""} ${active ? "vak-th--active" : ""}`}
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
    return uzCmp(x ?? "", y ?? "") * m;
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
  const filtered = rows.length !== data.subjects.length;

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
              <td><b>Jami{filtered ? " (filtr)" : ""}</b></td>
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
    if (s) {
      r = r.filter(
        (x) =>
          String(x.name).toLowerCase().includes(s) ||
          x.details.some(
            (dt) =>
              dt.subjectName.toLowerCase().includes(s) ||
              dt.slots.some((nm) => nm && nm.toLowerCase().includes(s))
          )
      );
    }
    return applySort(r, sort);
  }, [data.classes, q, only, sort]);

  const shownLesson = rows.reduce((a, r) => a + r.lessonHours, 0);
  const shownStaff = rows.reduce((a, r) => a + r.staffHours, 0);
  const shownVac = rows.reduce((a, r) => a + r.vacant, 0);
  const avgLesson = data.classCount ? Math.round(data.lessonHoursTotal / data.classCount) : 0;
  const filtered = rows.length !== data.classes.length;

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
        placeholder="Sinf, fan yoki ustoz bo'yicha qidirish..."
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
                    <td>
                      <b>{c.name}</b>
                      {c.pooledHours > 0 && <span className="vak-tagmini">🔗 hovuz</span>}
                    </td>
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
                            {c.name} — fanlar va ustozlar ({c.details.length} ta biriktiruv ·{" "}
                            {c.lessonHours} soat)
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
                                    <td>
                                      {dt.subjectName}
                                      {dt.pooled && (
                                        <span className="vak-tagmini" title={dt.poolLabel}>🔗 hovuz</span>
                                      )}
                                      {dt.pairPart && (
                                        <span
                                          className="vak-tagmini"
                                          title="Bir vaqtda 2 fan — 2-guruh: 1-guruh bilan ayni soatda o'tadi"
                                        >
                                          👥 2-guruh
                                        </span>
                                      )}
                                    </td>
                                    <td className="vak-c"><b>{dt.hours}</b></td>
                                    <td>
                                      {dt.slots.map((nm, j) =>
                                        nm ? (
                                          <span key={j} className="vak-chip">{nm}</span>
                                        ) : (
                                          <span key={j} className="vak-chip vak-chip--bad">🆘 Vakant</span>
                                        )
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr>
                                  <td><b>Jami</b></td>
                                  <td className="vak-c"><b>{c.lessonHours}</b></td>
                                  <td className="vak-dim">{c.teacherCount} ta ustoz</td>
                                </tr>
                              </tfoot>
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
              <td><b>Jami{filtered ? " (filtr)" : ""}</b></td>
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
        <b>O'qituvchi-soat</b> — har bir o'rin alohida (bo'lingan guruh / daraja guruhi ikki
        barobar). 🔗 hovuz darsi har ikkala sinf setkasida bor, lekin ustoz yuklamasiga va umumiy
        "Kerakli soat"ga bir marta qo'shiladi — shu sababli sinflar yig'indisi yuqoridagi KPI dan
        ko'proq chiqishi mumkin.
      </div>
    </>
  );
}

// =====================================================================
//  TAB 3 — USTOZLAR
// =====================================================================
function TeachersTab({ data }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | over | low | idle
  const [sort, onSort] = useSorter("declared");
  const [open, setOpen] = useState(() => new Set());

  const toggle = (id) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const idle = useMemo(() => data.teachers.filter((t) => t.declared === 0), [data.teachers]);
  const low = useMemo(
    () => data.teachers.filter((t) => t.declared > 0 && t.loadPct < 60),
    [data.teachers]
  );

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
          x.details.some((dt) => String(dt.className).toLowerCase().includes(s))
      );
    }
    return applySort(r, sort);
  }, [data.teachers, data.overloaded, idle, low, q, filter, sort]);

  const shownDeclared = rows.reduce((a, r) => a + r.declared, 0);
  const hasDefaultMax = data.teachers.some((t) => !t.hasOwnMax);
  const filtered = rows.length !== data.teachers.length;

  return (
    <>
      <MiniStats
        items={[
          { value: data.teacherCount, label: "Jami ustoz" },
          { value: data.activeTeacherCount, label: "Yuklamali ustoz" },
          {
            value: `${data.avgLoadPct}%`,
            label: "O'rtacha yuklama",
            tone: data.avgLoadPct > 100 ? "bad" : data.avgLoadPct >= 85 ? "warn" : "ok",
          },
          {
            value: data.overloaded.length,
            label: "Ortiqcha yuklamali",
            tone: data.overloaded.length ? "warn" : "ok",
          },
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
                            {t.name} — sinflar va soatlar ({t.details.length} ta biriktiruv ·{" "}
                            {t.declared} soat)
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
                                      <td>
                                        <b>{dt.className}</b>
                                        {dt.pooled && <span className="vak-tagmini">🔗</span>}
                                      </td>
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
              <td><b>Jami{filtered ? " (filtr)" : ""}</b></td>
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
      {data.poolMergedTotal > 0 && (
        <div className="vak-note">
          🔗 Hovuz (birlashgan sinflar) darslari bir marta hisoblandi — {data.poolMergedTotal} soat
          takroriy sanalmadi.
        </div>
      )}
    </>
  );
}

// =====================================================================
//  TAB 4 — XONALAR (hafta setkasi)
//
//  Xona tanlanadi → o'sha xonada HAFTA davomida qaysi kunda, qaysi
//  soatda qaysi sinf o'tirishi setkada ko'rinadi.
//
//  Ma'lumot manbai — tayyor `schedule` (dars jadvali). Jadval hali
//  tuzilmagan bo'lsa, setka bo'sh chiqadi va ogohlantirish beriladi.
//
//  BANDLIK: xona bir kun-soatda band bo'lsa 1 soat sanaladi (guruhli
//  dars ikki yozuv bo'lsa ham — bitta karta, bitta soat).
//  TO'QNASHUV: bitta xonada vaqti KESISHADIGAN slotlarda ikki HAR XIL
//  dars turgan bo'lsa — qizil bilan belgilanadi (generator qoidasi
//  bilan bir xil: bandlik slot id emas, VAQT bo'yicha).
// =====================================================================

const ROOM_ICONS = {
  "Oddiy": "🏫",
  "IT xona": "💻",
  "Laboratoriya": "🔬",
  "Sport zal": "⚽",
};

const roomIcon = (type) => ROOM_ICONS[type] || "🚪";

const ROOM_PALETTE = [
  "#4f46e5", "#0891b2", "#16a34a", "#d97706", "#db2777",
  "#7c3aed", "#0284c7", "#059669", "#ea580c", "#be123c",
  "#0d9488", "#9333ea", "#65a30d", "#c2410c", "#2563eb",
];

function hashText(text = "") {
  return String(text).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function subjectTone(subject, fallbackName = "") {
  if (subject?.color) return subject.color;
  return ROOM_PALETTE[hashText(subject?.name || fallbackName) % ROOM_PALETTE.length];
}

function toRgba(hex = "#4f46e5", alpha = 1) {
  const raw = String(hex).replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const v = parseInt(full, 16);
  if (Number.isNaN(v)) return `rgba(79, 70, 229, ${alpha})`;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

// Dars soatimi? (obed/tanaffus — dars emas)
function isLessonSlot(ts) {
  const type = ts?.type || "lesson";
  return type !== "lunch" && type !== "break";
}

function lessonClassIds(l) {
  const ids = Array.isArray(l?.classIds) ? l.classIds.filter(Boolean) : [];
  if (ids.length) return ids;
  return l?.classId ? [l.classId] : [];
}

// Bitta katakdagi yozuvlarni BITTA kartaga birlashtiruvchi kalit
// (Schedule.jsx dagi groupLessons bilan bir xil mantiq).
function cardKeyOf(l) {
  if (l?.pairKey) return `p:${l.pairKey}:${l.blockIndex ?? ""}`;
  if (l?.groupKey) return `g:${l.groupKey}:${l.subjectId}:${l.blockIndex ?? ""}`;
  return `s:${l?.subjectId}:${lessonClassIds(l).slice().sort().join("-")}:${l?.blockIndex ?? ""}`;
}

const minutesOf = (t) => {
  const [h, m] = String(t || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Vaqti kesishadigan slotlarni bitta "band"ga birlashtiradi.
// Ikki smena bir xil soatda o'tishi mumkin — id boshqa, vaqt bir xil.
function slotBucketMap(slots = []) {
  const n = slots.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  const hasClock = (s) => Boolean(s?.startTime && s?.endTime);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!hasClock(slots[i]) || !hasClock(slots[j])) continue;
      const a1 = minutesOf(slots[i].startTime), a2 = minutesOf(slots[i].endTime);
      const b1 = minutesOf(slots[j].startTime), b2 = minutesOf(slots[j].endTime);
      if (!(a1 < b2 && b1 < a2)) continue;
      const ra = find(i), rb = find(j);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  const out = new Map();
  slots.forEach((s, i) => out.set(s.id, `b${find(i)}`));
  return out;
}

// ---------------------------------------------------------------------
//  XONALAR BANDLIGINI HISOBLASH
//  Natija: { rooms: [...], weekCapacity, noRoomCards, usedCount, ... }
// ---------------------------------------------------------------------
function computeRoomUsage({ rooms = [], schedule = {}, timeslots = [], classes = [], subjects = [], teachers = [] }) {
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const teacherMap = new Map(teachers.map((t) => [t.id, t]));

  const slots = [...timeslots].sort(
    (a, b) => Number(a.lessonNumber || 0) - Number(b.lessonNumber || 0)
  );
  const lessonSlots = slots.filter(isLessonSlot);
  const bucketOf = slotBucketMap(slots);

  const state = new Map();
  const accOf = (rid) => {
    let a = state.get(rid);
    if (!a) {
      a = {
        cells: new Map(),          // `${day}__${slotId}` -> { cards: [] }
        busyKeys: new Set(),       // band kun-soatlar
        cardCount: 0,
        classHours: new Map(),     // classId -> soat
        teacherHours: new Map(),   // teacherId -> soat
        subjectHours: new Map(),   // subjectId -> soat
        dayHours: new Map(),       // day -> soat
        bucketCards: new Map(),    // `${day}__${bucket}` -> Map(cardKey -> Set(cellKey))
      };
      state.set(rid, a);
    }
    return a;
  };

  let noRoomCards = 0;

  DAYS.forEach((day) => {
    slots.forEach((ts) => {
      const cell = schedule?.[day]?.[ts.id];
      if (!Array.isArray(cell) || !cell.length) return;

      // (xona × karta) bo'yicha guruhlash — bitta karta ikki xonada
      // bo'lishi mumkin (masalan "bir vaqtda 2 fan" turli xonalarda).
      const byRoom = new Map();
      const emptyRoomCards = new Set();
      cell.forEach((l) => {
        const key = cardKeyOf(l);
        const rid = l?.roomId || "";
        if (!rid) { emptyRoomCards.add(key); return; }
        let m = byRoom.get(rid);
        if (!m) byRoom.set(rid, (m = new Map()));
        let parts = m.get(key);
        if (!parts) m.set(key, (parts = []));
        parts.push(l);
      });
      noRoomCards += emptyRoomCards.size;

      byRoom.forEach((cards, rid) => {
        const a = accOf(rid);
        const cellKey = `${day}__${ts.id}`;
        const bKey = `${day}__${bucketOf.get(ts.id) || `s:${ts.id}`}`;

        let bc = a.bucketCards.get(bKey);
        if (!bc) a.bucketCards.set(bKey, (bc = new Map()));

        const list = [];
        const classSeen = new Set();
        const teacherSeen = new Set();

        cards.forEach((parts, key) => {
          let bs = bc.get(key);
          if (!bs) bc.set(key, (bs = new Set()));
          bs.add(cellKey);

          const classIds = [];
          const subjectIds = [];
          const teacherIds = [];
          const groupNames = [];
          parts.forEach((p) => {
            lessonClassIds(p).forEach((cid) => { if (!classIds.includes(cid)) classIds.push(cid); });
            if (p.subjectId && !subjectIds.includes(p.subjectId)) subjectIds.push(p.subjectId);
            [p.teacherId, p.alternating ? p.altTeacherId : null].forEach((tid) => {
              if (tid && !teacherIds.includes(tid)) teacherIds.push(tid);
            });
            if (p.groupPart && !groupNames.includes(p.groupPart)) groupNames.push(p.groupPart);
          });

          const students = classIds.reduce(
            (mx, cid) => Math.max(mx, Number(classMap.get(cid)?.studentCount || 0)),
            0
          );

          list.push({
            key,
            locked: parts.some((p) => p.locked),
            classNames: classIds.map((cid) => classMap.get(cid)?.name || "?"),
            subjectNames: subjectIds.map((sid) => subjectMap.get(sid)?.name || "Fan"),
            teacherNames: teacherIds.map((tid) => teacherMap.get(tid)?.name || "—"),
            groupNames,
            students,
            color: subjectTone(subjectMap.get(subjectIds[0]), subjectIds[0] || key),
          });

          classIds.forEach((cid) => classSeen.add(cid));
          teacherIds.forEach((tid) => teacherSeen.add(tid));
          subjectIds.forEach((sid) => a.subjectHours.set(sid, (a.subjectHours.get(sid) || 0) + 1));
          a.cardCount += 1;
        });

        if (!list.length) return;
        a.cells.set(cellKey, { cards: list });
        if (isLessonSlot(ts)) {
          a.busyKeys.add(cellKey);
          a.dayHours.set(day, (a.dayHours.get(day) || 0) + 1);
        }
        classSeen.forEach((cid) => a.classHours.set(cid, (a.classHours.get(cid) || 0) + 1));
        teacherSeen.forEach((tid) => a.teacherHours.set(tid, (a.teacherHours.get(tid) || 0) + 1));
      });
    });
  });

  const weekCapacity = lessonSlots.length * DAYS.length;

  const list = rooms.map((r) => {
    const a = state.get(r.id);
    const cells = a?.cells || new Map();
    const conflictCells = new Set();
    if (a) {
      a.bucketCards.forEach((cardMap) => {
        if (cardMap.size < 2) return;
        cardMap.forEach((cellKeys) => cellKeys.forEach((ck) => conflictCells.add(ck)));
      });
    }
    const capacity = Number(r.capacity || 0);
    let overCapacity = 0;
    cells.forEach((c) => {
      if (capacity && c.cards.some((x) => x.students > capacity)) overCapacity += 1;
    });

    const busy = a ? a.busyKeys.size : 0;
    const rows = (map, nameOf) =>
      (map ? [...map.entries()] : [])
        .map(([id, hours]) => ({ id, name: nameOf(id), hours }))
        .sort((x, y) => y.hours - x.hours || uzCmp(x.name, y.name));

    return {
      id: r.id,
      name: r.name || "Xona",
      type: r.type || "Oddiy",
      icon: roomIcon(r.type),
      capacity,
      cells,
      conflictCells,
      busy,
      free: Math.max(0, weekCapacity - busy),
      pct: weekCapacity ? Math.round((busy / weekCapacity) * 100) : 0,
      cardCount: a?.cardCount || 0,
      dayHours: a?.dayHours || new Map(),
      classRows: rows(a?.classHours, (id) => classMap.get(id)?.name || "?"),
      subjectRows: rows(a?.subjectHours, (id) => subjectMap.get(id)?.name || "Fan"),
      teacherRows: rows(a?.teacherHours, (id) => teacherMap.get(id)?.name || "—"),
      conflicts: conflictCells.size,
      overCapacity,
    };
  });

  list.sort((x, y) => y.busy - x.busy || uzCmp(x.name, y.name));

  return {
    rooms: list,
    weekCapacity,
    lessonSlotCount: lessonSlots.length,
    noRoomCards,
    usedCount: list.filter((r) => r.busy > 0).length,
    idleCount: list.filter((r) => r.busy === 0).length,
    conflictCount: list.filter((r) => r.conflicts > 0).length,
    totalBusy: list.reduce((n, r) => n + r.busy, 0),
    avgPct: list.length ? Math.round(list.reduce((n, r) => n + r.pct, 0) / list.length) : 0,
  };
}

function RoomsTab({ rooms = [], schedule = {}, timeslots = [], shifts = [], classes = [], subjects = [], teachers = [] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");   // all | busy | free | conflict
  const [selId, setSelId] = useState("");

  const usage = useMemo(
    () => computeRoomUsage({ rooms, schedule, timeslots, classes, subjects, teachers }),
    [rooms, schedule, timeslots, classes, subjects, teachers]
  );

  const slotGroups = useMemo(() => groupSlotsByShift(timeslots, shifts), [timeslots, shifts]);
  const slotNumById = useMemo(() => shiftSlotNumbers(slotGroups), [slotGroups]);

  const shown = useMemo(() => {
    let r = usage.rooms;
    if (filter === "busy") r = r.filter((x) => x.busy > 0);
    else if (filter === "free") r = r.filter((x) => x.busy === 0);
    else if (filter === "conflict") r = r.filter((x) => x.conflicts > 0);
    const s = q.trim().toLowerCase();
    if (s) {
      r = r.filter(
        (x) =>
          x.name.toLowerCase().includes(s) ||
          x.type.toLowerCase().includes(s) ||
          x.classRows.some((c) => c.name.toLowerCase().includes(s))
      );
    }
    return r;
  }, [usage.rooms, filter, q]);

  const active =
    shown.find((r) => r.id === selId) ||
    shown[0] ||
    usage.rooms.find((r) => r.id === selId) ||
    usage.rooms[0] ||
    null;

  if (!rooms.length) {
    return (
      <div className="vak-empty">
        <div className="vak-empty__icon">🚪</div>
        <div className="vak-empty__title">Xonalar kiritilmagan</div>
        <div className="vak-empty__text">
          «Xonalar» bo'limida sinf xonalari va kabinetlarni qo'shing — shundan keyin
          har bir xonaning haftalik bandligi shu yerda ko'rinadi.
        </div>
      </div>
    );
  }

  return (
    <>
      <MiniStats
        items={[
          { value: usage.rooms.length, label: "Jami xona" },
          { value: usage.usedCount, label: "Jadvalda band xona", tone: usage.usedCount ? "ok" : undefined },
          { value: usage.idleCount, label: "Ishlatilmagan xona", tone: usage.idleCount ? "warn" : "ok" },
          {
            value: `${usage.avgPct}%`,
            label: "O'rtacha bandlik",
            tone: usage.avgPct >= 80 ? "warn" : usage.avgPct > 0 ? "ok" : undefined,
          },
          {
            value: usage.noRoomCards,
            label: "Xonasiz dars",
            tone: usage.noRoomCards ? "warn" : "ok",
          },
        ]}
      />

      {usage.totalBusy === 0 && (
        <div className="vak-infobox">
          📭 Dars jadvali hali tuzilmagan yoki darslarga xona biriktirilmagan — setka bo'sh
          ko'rinadi. «Dars jadvali» bo'limida jadvalni tuzing, «Sinf fanlari»da esa fanga
          xona tanlang.
        </div>
      )}

      <Toolbar
        value={q}
        onChange={setQ}
        placeholder="Xona, turi yoki sinf bo'yicha qidirish..."
        chips={
          <>
            <button
              type="button"
              className={`vak-tab ${filter === "all" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              Hammasi ({usage.rooms.length})
            </button>
            <button
              type="button"
              className={`vak-tab ${filter === "busy" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("busy")}
            >
              Band ({usage.usedCount})
            </button>
            <button
              type="button"
              className={`vak-tab ${filter === "free" ? "vak-tab--active" : ""}`}
              onClick={() => setFilter("free")}
            >
              Bo'sh ({usage.idleCount})
            </button>
            {usage.conflictCount > 0 && (
              <button
                type="button"
                className={`vak-tab ${filter === "conflict" ? "vak-tab--active" : ""}`}
                onClick={() => setFilter("conflict")}
              >
                ⚠️ To'qnashuv ({usage.conflictCount})
              </button>
            )}
          </>
        }
      />

      {/* ——— Xona tanlash tugmalari ——— */}
      {shown.length === 0 ? (
        <div className="vak-dim vak-c" style={{ padding: "18px 0" }}>Mos xona topilmadi</div>
      ) : (
        <div className="vak-rpicker">
          {shown.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`vak-rbtn ${active?.id === r.id ? "vak-rbtn--active" : ""}`}
              onClick={() => setSelId(r.id)}
              title={`${r.name} — haftasiga ${r.busy} soat band`}
            >
              <span className="vak-rbtn__icon">{r.icon}</span>
              <span className="vak-rbtn__body">
                <span className="vak-rbtn__name">
                  {r.name}
                  {r.conflicts > 0 && <span className="vak-rbtn__flag">⚠️</span>}
                </span>
                <span className="vak-rbtn__meta">
                  {r.type}{r.capacity ? ` · 👥 ${r.capacity}` : ""}
                </span>
                <span className="vak-rbtn__bar">
                  <span
                    className={`vak-rbtn__fill vak-rbtn__fill--${r.pct >= 80 ? "hot" : "ok"}`}
                    style={{ width: `${Math.min(100, r.pct)}%` }}
                  />
                </span>
              </span>
              <span className="vak-rbtn__hours">
                <b>{r.busy}</b>
                <small>soat</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ——— Tanlangan xona: hafta setkasi ——— */}
      {active && (
        <div className="vak-rpanel">
          <div className="vak-rpanel__head">
            <div className="vak-rpanel__id">
              <span className="vak-rpanel__icon">{active.icon}</span>
              <div>
                <div className="vak-rpanel__name">{active.name}</div>
                <div className="vak-rpanel__sub">
                  {active.type}
                  {active.capacity ? ` · 👥 ${active.capacity} o'rin` : ""}
                  {active.classRows.length ? ` · ${active.classRows.length} ta sinf foydalanadi` : ""}
                </div>
              </div>
            </div>
            <div className="vak-rpanel__stats">
              <div className="vak-rstat">
                <span className="vak-rstat__val">{active.busy}</span>
                <span className="vak-rstat__lab">Band soat</span>
              </div>
              <div className="vak-rstat">
                <span className="vak-rstat__val">{active.free}</span>
                <span className="vak-rstat__lab">Bo'sh soat</span>
              </div>
              <div className={`vak-rstat ${active.pct >= 80 ? "vak-rstat--warn" : "vak-rstat--ok"}`}>
                <span className="vak-rstat__val">{active.pct}%</span>
                <span className="vak-rstat__lab">Bandlik</span>
              </div>
              {active.conflicts > 0 && (
                <div className="vak-rstat vak-rstat--bad">
                  <span className="vak-rstat__val">{active.conflicts}</span>
                  <span className="vak-rstat__lab">To'qnashuv</span>
                </div>
              )}
              {active.overCapacity > 0 && (
                <div className="vak-rstat vak-rstat--warn">
                  <span className="vak-rstat__val">{active.overCapacity}</span>
                  <span className="vak-rstat__lab">Sig'imdan ortiq</span>
                </div>
              )}
            </div>
          </div>

          <div className="vak-rgridwrap">
            <table className="vak-rgrid">
              <thead>
                <tr>
                  <th className="vak-rgrid__timehead">Vaqt / Dars</th>
                  {DAYS.map((day) => (
                    <th key={day}>
                      <span className="vak-rgrid__dayname">{day}</span>
                      <span className="vak-rgrid__dayhours">{active.dayHours.get(day) || 0} soat</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slotGroups.map((g) => (
                  <Fragment key={g.id}>
                    {slotGroups.length > 1 && (
                      <tr className="vak-rgrid__shift">
                        <td colSpan={DAYS.length + 1}>🕐 {g.name} · {g.range}</td>
                      </tr>
                    )}
                    {g.slots.map((slot) => {
                      const teaching = isLessonSlot(slot);
                      const num = slotNumById.get(slot.id) || slot.lessonNumber;
                      return (
                        <tr key={slot.id} className={teaching ? "" : "vak-rgrid__ntrow"}>
                          <td className="vak-rgrid__time">
                            <strong>
                              {teaching
                                ? `${num || ""}-dars`
                                : (slot.title || (slot.type === "lunch" ? "🍽️ Obed" : "Tanaffus"))}
                            </strong>
                            <span>{slot.startTime || ""} – {slot.endTime || ""}</span>
                          </td>
                          {DAYS.map((day) => {
                            const cellKey = `${day}__${slot.id}`;
                            const cell = active.cells.get(cellKey);
                            const bad = active.conflictCells.has(cellKey);
                            if (!cell) {
                              return (
                                <td key={day} className={`vak-rcell ${teaching ? "vak-rcell--free" : "vak-rcell--nt"}`}>
                                  {teaching
                                    ? <span className="vak-rcell__freetxt">bo'sh</span>
                                    : <span className="vak-rcell__freetxt">—</span>}
                                </td>
                              );
                            }
                            return (
                              <td key={day} className={`vak-rcell ${bad ? "vak-rcell--bad" : ""}`}>
                                {bad && <div className="vak-rcell__warn">⚠️ To'qnashuv</div>}
                                {cell.cards.map((card, i) => (
                                  <div
                                    key={i}
                                    className="vak-rcard"
                                    style={{
                                      background: toRgba(card.color, 0.12),
                                      borderColor: toRgba(card.color, 0.34),
                                    }}
                                  >
                                    <div className="vak-rcard__cls" style={{ color: card.color }}>
                                      {card.classNames.join(", ") || "—"}
                                      {card.locked && <span className="vak-rcard__lock">🔒</span>}
                                    </div>
                                    <div className="vak-rcard__sub">{card.subjectNames.join(" / ")}</div>
                                    {card.teacherNames.length > 0 && (
                                      <div className="vak-rcard__t">👤 {card.teacherNames.join(", ")}</div>
                                    )}
                                    {card.groupNames.length > 0 && (
                                      <div className="vak-rcard__g">👥 {card.groupNames.join(" · ")}</div>
                                    )}
                                    {active.capacity > 0 && card.students > active.capacity && (
                                      <div className="vak-rcard__cap">
                                        ⚠️ {card.students} o'quvchi · sig'im {active.capacity}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {(active.classRows.length > 0 || active.subjectRows.length > 0) && (
            <div className="vak-rlists">
              {active.classRows.length > 0 && (
                <div className="vak-rlist">
                  <div className="vak-rlist__title">🏫 Shu xonadan foydalanadigan sinflar</div>
                  <div className="vak-rlist__chips">
                    {active.classRows.map((c) => (
                      <span key={c.id} className="vak-chip">{c.name} · {c.hours} soat</span>
                    ))}
                  </div>
                </div>
              )}
              {active.subjectRows.length > 0 && (
                <div className="vak-rlist">
                  <div className="vak-rlist__title">📚 Xonada o'tiladigan fanlar</div>
                  <div className="vak-rlist__chips">
                    {active.subjectRows.map((s) => (
                      <span key={s.id} className="vak-chip">{s.name} · {s.hours} soat</span>
                    ))}
                  </div>
                </div>
              )}
              {active.teacherRows.length > 0 && (
                <div className="vak-rlist">
                  <div className="vak-rlist__title">👨‍🏫 Xonada dars beradigan ustozlar</div>
                  <div className="vak-rlist__chips">
                    {active.teacherRows.map((t) => (
                      <span key={t.id} className="vak-chip">{t.name} · {t.hours} soat</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {usage.noRoomCards > 0 && (
        <div className="vak-note">
          ℹ️ Jadvalda <b>{usage.noRoomCards}</b> ta darsga xona biriktirilmagan — ular hech bir
          setkada ko'rinmaydi. Xonani «Sinf fanlari» bo'limida fanga biriktirasiz.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
//  TO'LIQ HISOBOT — bitta maktab uchun
//  props:
//    data         — computeVacancy() natijasi
//    showTeachers — Sinflar/Ustozlar kesimlarini ko'rsatish (default: true)
//    roomCtx      — { rooms, schedule, timeslots, shifts, classes, subjects,
//                     teachers }. Berilsa "🚪 Xonalar" kesimi qo'shiladi
//                     (maktab paneli). Tuman panelida berilmaydi — u yerda
//                     boshqa maktabning jadvali yo'q.
// ---------------------------------------------------------------------
export function VacancyReport({ data, showTeachers = true, roomCtx = null }) {
  const [tab, setTab] = useState("subjects"); // subjects | classes | teachers | rooms

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
    ...(roomCtx
      ? [{ id: "rooms", icon: "🚪", label: "Xonalar", count: (roomCtx.rooms || []).length }]
      : []),
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
        {active === "rooms" && roomCtx && <RoomsTab {...roomCtx} />}
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
export default function VacancyAnalysis({
  classes = [],
  subjects = [],
  teachers = [],
  classSubjects = {},
  rooms = [],
  timeslots = [],
  shifts = [],
  schedule = {},
}) {
  const data = useMemo(
    () => computeVacancy({ classes, subjects, teachers, classSubjects }),
    [classes, subjects, teachers, classSubjects]
  );
  // "🚪 Xonalar" kesimi uchun kerakli xom ma'lumot (dars jadvali ham).
  const roomCtx = useMemo(
    () => ({ rooms, schedule, timeslots, shifts, classes, subjects, teachers }),
    [rooms, schedule, timeslots, shifts, classes, subjects, teachers]
  );
  return (
    <div className="vak-card">
      <div className="vak-card__title">💼 Vakansiya, yuklama va xonalar tahlili</div>
      <VacancyReport data={data} roomCtx={roomCtx} />
    </div>
  );
}
