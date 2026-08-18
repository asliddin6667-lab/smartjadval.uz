import { useRef, useState } from 'react';
import { DAYS } from '../utils/constants';
import { genId } from '../utils/helpers';
import { loadXLSX, splitNames, normalizeText, findByName, makeSubject, worksheetToRows, downloadWorkbook } from '../utils/excelUtils';
import { exportColoredSchedule } from '../utils/coloredScheduleExport';
import { exportAnalysisExcel } from '../utils/analysisExport';
import { exportHourGridExcel } from '../utils/hourGridExport';
import { isTeachingSlot, classHasLunchAt } from '../utils/scheduleGenerator';

function lessonClassIds(lesson) {
  return Array.isArray(lesson.classIds) ? lesson.classIds : [lesson.classId].filter(Boolean);
}

function teacherSubjectIds(teacher) {
  return Array.isArray(teacher.subjectIds) ? teacher.subjectIds : (teacher.subjectId ? [teacher.subjectId] : []);
}

function safeFileDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function ImportExportPage({
  classes, subjects, setSubjects,
  teachers, setTeachers,
  rooms, timeslots, lunchGroups, schedule,
  classSubjects = {},
  settings = {},
  schoolName = '',
  toast,
}) {
  const teacherFileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const sortedTimeslots = [...timeslots].sort((a, b) => Number(a.lessonNumber) - Number(b.lessonNumber));

  async function downloadTeacherTemplate() {
    try {
      const XLSX = await loadXLSX();
      downloadWorkbook(XLSX, [{
        name: "O'qituvchilar",
        rows: [
          {
            "Ism familiya": "Aliyev Ali",
            "Fanlar": "Matematika, Algebra",
            "Telefon": "+998 90 000 00 00",
            "Maksimal haftalik soat": 28,
            "Status": "Bo'sh",
          },
          {
            "Ism familiya": "Karimova Malika",
            "Fanlar": "Ingliz tili, Rus tili",
            "Telefon": "+998 91 000 00 00",
            "Maksimal haftalik soat": 24,
            "Status": "Bo'sh",
          },
        ],
      }], `oqituvchilar_shablon_${safeFileDate()}.xlsx`);
      toast("O'qituvchi shabloni yuklandi ✓", 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function importTeachers(file) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await loadXLSX();
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = worksheetToRows(XLSX, ws);
      if (!rows.length) {
        toast('Excel faylda ma\'lumot topilmadi', 'warning');
        return;
      }

      let nextSubjects = [...subjects];
      const nextTeachers = [...teachers];
      let addedTeachers = 0;
      let updatedTeachers = 0;
      let addedSubjects = 0;

      rows.forEach((row, rowIndex) => {
        const name = normalizeText(row["Ism familiya"] || row["F.I.Sh"] || row["O'qituvchi"] || row["Ustoz"] || row["Name"]);
        if (!name) return;

        const subjectNames = splitNames(row["Fanlar"] || row["Fan"] || row["Subjects"] || row["Subject"]);
        const subjectIds = [];
        subjectNames.forEach(subjectName => {
          let subject = findByName(nextSubjects, subjectName);
          if (!subject) {
            subject = makeSubject(subjectName, nextSubjects.length + rowIndex);
            nextSubjects.push(subject);
            addedSubjects += 1;
          }
          subjectIds.push(subject.id);
        });

        const maxWeeklyHours = Number(row["Maksimal haftalik soat"] || row["Max soat"] || row["MaxWeeklyHours"] || 28) || 28;
        const phone = normalizeText(row["Telefon"] || row["Phone"] || '');
        const status = normalizeText(row["Status"] || "Bo'sh") || "Bo'sh";
        const existing = findByName(nextTeachers, name);

        if (existing) {
          existing.subjectIds = [...new Set([ ...teacherSubjectIds(existing), ...subjectIds ])];
          existing.subjectId = existing.subjectIds[0] || existing.subjectId || '';
          existing.phone = phone || existing.phone || '';
          existing.maxWeeklyHours = maxWeeklyHours;
          existing.status = status;
          updatedTeachers += 1;
        } else {
          nextTeachers.push({
            id: genId(),
            name,
            subjectIds: [...new Set(subjectIds)],
            subjectId: subjectIds[0] || '',
            phone,
            maxWeeklyHours,
            status,
            createdAt: Date.now(),
          });
          addedTeachers += 1;
        }
      });

      setSubjects(nextSubjects);
      setTeachers(nextTeachers);
      toast(`${addedTeachers} ta o'qituvchi qo'shildi, ${updatedTeachers} ta yangilandi, ${addedSubjects} ta fan yaratildi ✓`, 'success');
    } catch (e) {
      toast(e.message || 'Excel importda xatolik', 'error');
    } finally {
      setImporting(false);
      if (teacherFileRef.current) teacherFileRef.current.value = '';
    }
  }

  async function exportTeachers() {
    try {
      const XLSX = await loadXLSX();
      const rows = teachers.map(t => ({
        "Ism familiya": t.name,
        "Fanlar": teacherSubjectIds(t).map(id => subjects.find(s => s.id === id)?.name).filter(Boolean).join(', '),
        "Telefon": t.phone || '',
        "Maksimal haftalik soat": t.maxWeeklyHours || 28,
        "Status": t.status || "Bo'sh",
      }));
      downloadWorkbook(XLSX, [{ name: "O'qituvchilar", rows: rows.length ? rows : [{ "Ism familiya": '', "Fanlar": '', "Telefon": '', "Maksimal haftalik soat": '', "Status": '' }] }], `oqituvchilar_${safeFileDate()}.xlsx`);
      toast("O'qituvchilar Excelga yuklandi ✓", 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function getSubject(id) { return subjects.find(s => s.id === id); }
  function getTeacher(id) { return teachers.find(t => t.id === id); }
  function getRoom(id) { return rooms.find(r => r.id === id); }
  function getClassName(id) { return classes.find(c => c.id === id)?.name || ''; }

  function scheduleRows() {
    const rows = [];
    DAYS.forEach(day => {
      sortedTimeslots.forEach(ts => {
        const blocked = !isTeachingSlot(ts);
        if (blocked) {
          rows.push({
            "Kun": day,
            "Dars": ts.title || (ts.type === 'lunch' ? 'Obed vaqti' : 'Tanaffus'),
            "Boshlanish": ts.startTime || '',
            "Tugash": ts.endTime || '',
            "Sinf / guruh": '',
            "Fan": "Dars qo'yilmaydi",
            "O'qituvchi": '',
            "Xona": '',
            "Guruh kaliti": '',
          });
          return;
        }
        const lessons = schedule?.[day]?.[ts.id] || [];
        lessons.forEach(lesson => {
          rows.push({
            "Kun": day,
            "Dars": `${ts.lessonNumber}-dars`,
            "Boshlanish": ts.startTime || '',
            "Tugash": ts.endTime || '',
            "Sinf / guruh": lessonClassIds(lesson).map(getClassName).filter(Boolean).join(', '),
            "Fan": getSubject(lesson.subjectId)?.name || '',
            "O'qituvchi": getTeacher(lesson.teacherId)?.name || '',
            "Xona": getRoom(lesson.roomId)?.name || 'Xonasiz',
            "Guruh kaliti": lesson.groupKey || '',
          });
        });
      });
    });
    return rows;
  }

  function classScheduleRows() {
    const rows = [];
    classes.forEach(cls => {
      DAYS.forEach(day => {
        sortedTimeslots.forEach(ts => {
          const blocked = !isTeachingSlot(ts);
          const classLunch = !blocked && classHasLunchAt(ts, cls.id, lunchGroups, day);
          const lesson = (blocked || classLunch) ? null : (schedule?.[day]?.[ts.id] || []).find(l => lessonClassIds(l).includes(cls.id));
          rows.push({
            "Sinf": cls.name,
            "Kun": day,
            "Dars": blocked ? (ts.title || (ts.type === 'lunch' ? 'Obed vaqti' : 'Tanaffus')) : `${ts.lessonNumber}-dars`,
            "Vaqt": `${ts.startTime || ''}-${ts.endTime || ''}`,
            "Fan": blocked ? "Dars qo'yilmaydi" : (classLunch ? "Obed" : (lesson ? (getSubject(lesson.subjectId)?.name || '') : '')),
            "O'qituvchi": lesson ? (getTeacher(lesson.teacherId)?.name || '') : '',
            "Xona": lesson ? (getRoom(lesson.roomId)?.name || 'Xonasiz') : '',
            "Guruh": lesson?.groupKey || '',
          });
        });
      });
    });
    return rows;
  }

  function teacherLoadRows() {
    return teachers.map(t => {
      let lessons = 0;
      DAYS.forEach(day => sortedTimeslots.forEach(ts => {
        lessons += (schedule?.[day]?.[ts.id] || []).filter(l => l.teacherId === t.id).length;
      }));
      return {
        "O'qituvchi": t.name,
        "Fanlar": teacherSubjectIds(t).map(id => subjects.find(s => s.id === id)?.name).filter(Boolean).join(', '),
        "Jadvaldagi darslar": lessons,
        "Maksimal soat": t.maxWeeklyHours || 28,
        "Holat": lessons > Number(t.maxWeeklyHours || 28) ? 'Oshib ketgan' : 'Normal',
      };
    });
  }

  // Rangli jadval eksporti — umumiy modulga o'tkazildi (coloredScheduleExport.js).
  // Yangi format: bo'sh soat qatorlari chiqmaydi, kunlar rangli qator bilan
  // ajratiladi, kun nomlari katta shriftda.
  async function exportColoredMatrix() {
    await exportColoredSchedule({
      classes, subjects, teachers, rooms, timeslots, lunchGroups, schedule, toast,
      schoolName: settings.schoolName || schoolName,
      academicYear: settings.academicYear,
    });
  }

  // Jadval tahlili eksporti — 2 varaq: sinflar bo'yicha (Fan/Joylashgan/Kerakli/Holat)
  // va o'qituvchilar bo'yicha (soat, yuklama %, holat).
  async function exportAnalysis() {
    await exportAnalysisExcel({
      classes, subjects, teachers, timeslots, schedule, classSubjects, toast,
    });
  }

  // Dars soat setkasi — fan × sinf matritsasi (tuman admin varag'i bilan bir xil).
  // Sarlavhadagi maktab nomi Sozlamalar sahifasidan (settings.schoolName) olinadi.
  async function exportHourGrid() {
    await exportHourGridExcel({
      classes, subjects, classSubjects, settings, schoolName, toast,
    });
  }

  async function exportSchedule() {
    try {
      const rows = scheduleRows();
      if (!rows.length) {
        toast('Avval dars jadvalini yarating', 'warning');
        return;
      }
      const XLSX = await loadXLSX();
      downloadWorkbook(XLSX, [
        { name: 'Umumiy jadval', rows },
        { name: 'Sinflar kesimida', rows: classScheduleRows() },
        { name: 'Ustoz yuklamasi', rows: teacherLoadRows() },
      ], `dars_jadvali_${safeFileDate()}.xlsx`);
      toast('Dars jadvali Excelga yuklandi ✓', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Excel import / export</div>
          <div className="page-subtitle">O'qituvchilarni Excel orqali kiritish va dars jadvalini Excelga yuklash</div>
        </div>
      </div>

      <div className="page-body">
        <div className="alert alert-info">
          ℹ️ Excel fayllarini o'qish/yozish uchun SheetJS ishlatiladi. Internet bo'lmasa terminalda: <b>npm install xlsx</b>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>👩‍🏫</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>O'qituvchilar importi</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Excel ustunlari: Ism familiya, Fanlar, Telefon, Maksimal haftalik soat, Status.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={downloadTeacherTemplate}>⬇️ Shablon</button>
              <button className="btn btn-primary" onClick={() => teacherFileRef.current?.click()} disabled={importing}>{importing ? '⏳ Yuklanmoqda...' : '📥 Import'}</button>
              <button className="btn btn-secondary" onClick={exportTeachers} disabled={!teachers.length}>📤 Ustozlar export</button>
              <input ref={teacherFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => importTeachers(e.target.files?.[0])} />
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Dars jadvalini Excelga yuklash</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Rangli jadval: ustunlarda sinflar, kunlar rangli qator bilan ajratilgan, bo'sh soatlar chiqmaydi, har bir fan o'z rangida. Pastdagi tugma — batafsil ro'yxat (sinf/ustoz kesimida).
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={exportColoredMatrix}>🎨 Rangli jadval (sinflar ustun)</button>
              <button className="btn btn-secondary" onClick={exportSchedule}>📊 Batafsil ro'yxat</button>
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>🕐</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Dars soat setkasi</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Fan × sinf matritsasi: har bir fanning har bir sinfdagi haftalik soati, qator va ustun jamilari bilan. Sarlavhada Sozlamalardagi maktab nomi chiqadi.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={exportHourGrid}>🕐 Soat setkasi (Excel)</button>
            </div>
          </div></div>

          <div className="card"><div className="card-body">
            <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Jadval tahlilini Excelga yuklash</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
              2 varaq: sinflar bo'yicha soatlar tahlili (fan, joylashgan, kerakli, holat) va o'qituvchilar yuklamasi (soat, yuklama %, holat). Umumiy statistika bilan.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={exportAnalysis}>📈 Tahlil (Excel)</button>
            </div>
          </div></div>
        </div>
      </div>
    </div>
  );
}
