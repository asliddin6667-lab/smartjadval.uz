import { STANDARD_SUBJECTS, SUBJECT_COLORS } from "./constants";
// Demo jadval OLDINDAN tuzilgan va faylga yozilgan. Sabab: jadval tuzish
// dvigateli endi bundle'da emas — u obuna tekshiruvidan keyin serverdan
// yuklanadi (engineLoader.js), demo hisobining esa obunasi yo'q.
// Qayta yaratish: node scripts/buildDemoSchedule.mjs
import demoSchedule from "./demoSchedule.js";

const EXTRA_SUBJECTS = [
  { name: "Tabiatshunoslik", weeklyHours: 1, type: "Oddiy" },
  { name: "Iqtisod", weeklyHours: 1, type: "Oddiy" },
  { name: "Robototexnika", weeklyHours: 2, type: "Guruhli", allowDouble: true },
  { name: "SAT Matematika", weeklyHours: 2, type: "Oddiy", allowDouble: true },
  { name: "IELTS Speaking", weeklyHours: 2, type: "Guruhli", allowDouble: true },
];

const SUBJECT_TEACHER_NAMES = {
  "Ona tili": ["Mahmudova Dilnoza", "Tojiboyeva Nargiza", "Akbarova Shahnoza", "Yusupova Munisa"],
  "Adabiyot": ["Qodirova Zulfiya", "Soliyeva Feruza", "Raximova Saodat"],
  "Matematika": ["Aliyev Akmal", "Karimov Javohir", "Abdullayev Sanjar", "Tursunov Diyor"],
  "Algebra": ["Rustamov Bahodir", "Nazarov Ulug'bek", "Saidov Sardor", "Ismoilov Doston"],
  "Geometriya": ["Ergashev Bekzod", "Xolmatov Aziz", "Murodov Anvar"],
  "Ingliz tili": ["Karimova Malika", "Rasulova Dilnoza", "Ahmedova Madina", "Sattorova Mohira", "Nabijonova Sevara", "Brown John", "Smith Anna", "Yo'ldosheva Maftuna"],
  "Rus tili": ["Ivanova Elena", "Petrova Marina", "Sidorova Olga", "Azimova Ra'no"],
  "Tarix": ["Jo'rayev Sardor", "Qurbanov Alisher", "Hoshimov Azamat"],
  "Geografiya": ["Mamatqulov Shavkat", "Rahmonov Laziz", "Kenjayev Mirjalol"],
  "Biologiya": ["Saidova Gulnora", "Toshmatova Mohira", "Mirzayeva Nilufar"],
  "Kimyo": ["Xudoyberdiyeva Feruza", "Usmonova Nigora", "G'aniyeva Dilorom"],
  "Fizika": ["Hamidov Farrux", "Norboyev Sherzod", "Ortiqov Bobur"],
  "Informatika": ["Jo'rayev Sobir", "Qodirov Aziz", "Mirzayev Sardor", "Munavvarov Asliddin"],
  "Jismoniy tarbiya": ["Aliyev Komil", "Raximov Shuhrat", "Toshpo'latov Elyor"],
  "Tasviriy san'at": ["Yuldasheva Go'zal", "Qosimova Malohat"],
  "Musiqa": ["Nishonova Laylo", "Xudoyqulova Durdona"],
  "Texnologiya": ["Sobirov Ravshan", "Abdug'aniyev Otabek"],
  "Tarbiya": ["Olimova Shaxnoza", "Qodirova Madina", "Abdullayeva Nargiza"],
  "Huquq": ["Sultonov Jamshid", "Yoqubov Daler"],
  "Chaqiruvga qadar boshlang'ich tayyorgarlik": ["Eshmatov Qahramon", "Akramov Rustam"],
  "Tabiatshunoslik": ["Halimova Gulchehra", "Isaqova Maftuna"],
  "Iqtisod": ["Turg'unov Dilshod", "Ahmedov Oybek"],
  "Robototexnika": ["Salimov Behruz", "Nematov Jalol", "Karimov Abror"],
  "SAT Matematika": ["Azizov Shoxrux", "Mansurov Timur"],
  "IELTS Speaking": ["Williams Kate", "Johnson Mark", "Ergasheva Kamola"],
};

function idFrom(prefix, text) {
  return `${prefix}_${String(text).toLowerCase().replace(/[^a-z0-9а-яёғқўҳ]+/gi, "_").replace(/^_+|_+$/g, "")}`;
}

function gradeOf(className = "") {
  const m = String(className).match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function pickTeacher(teachersBySubject, subjectName, index = 0) {
  const list = teachersBySubject[subjectName] || [];
  return list[index % Math.max(1, list.length)]?.id || "";
}

function roomByName(rooms, name) {
  return rooms.find(r => r.name === name)?.id || "";
}

function baseAssignment(subject, teacherId, weeklyHours, opts = {}) {
  return {
    subjectId: subject.id,
    weeklyHours: Number(weeklyHours || subject.weeklyHours || 1),
    teacherId: teacherId || "",
    roomId: opts.roomId || "",
    groupKey: opts.groupKey || "",
    splitEnabled: Boolean(opts.splitEnabled),
    teacherId2: opts.teacherId2 || "",
    roomId2: opts.roomId2 || "",
    groupName1: opts.groupName1 || "1-guruh",
    groupName2: opts.groupName2 || "2-guruh",
    levelGroupEnabled: Boolean(opts.levelGroupEnabled),
    levelGroupKey: opts.levelGroupKey || "",
    levelGroupCount: opts.levelGroups?.length || 3,
    levelGroups: opts.levelGroups || [],
    allowDouble: opts.allowDouble === undefined ? Boolean(subject.allowDouble) : Boolean(opts.allowDouble),
    parallelEnabled: Boolean(opts.parallelEnabled || opts.groupKey),
  };
}

function subjectPlanForGrade(grade) {
  if (grade <= 4) {
    return [
      ["Ona tili", 6, false], ["Matematika", 5, false], ["Ingliz tili", 4, true], ["Rus tili", 2, false],
      ["Jismoniy tarbiya", 2, true], ["Tasviriy san'at", 1, false], ["Musiqa", 1, false], ["Texnologiya", 1, false], ["Tarbiya", 1, false], ["Tabiatshunoslik", 1, false],
    ];
  }
  if (grade <= 8) {
    return [
      ["Ona tili", 5, false], ["Adabiyot", 2, false], ["Matematika", 5, false], ["Ingliz tili", 4, true], ["Rus tili", 2, false],
      ["Tarix", 2, false], ["Geografiya", 2, false], ["Biologiya", 2, false], ["Informatika", 2, true],
      ["Jismoniy tarbiya", 2, true], ["Tasviriy san'at", 1, false], ["Musiqa", 1, false], ["Texnologiya", 1, false], ["Tarbiya", 1, false],
    ];
  }
  return [
    ["Ona tili", 4, false], ["Adabiyot", 2, false], ["Algebra", grade === 10 ? 6 : 4, true], ["Geometriya", grade === 11 ? 3 : 2, false],
    ["Ingliz tili", 4, true], ["Rus tili", 2, false], ["Tarix", 2, false], ["Geografiya", 2, false], ["Biologiya", 2, false],
    ["Kimyo", 2, true], ["Fizika", 2, true], ["Informatika", 2, true], ["Jismoniy tarbiya", 2, true],
    ["Tarbiya", 1, false], ["Huquq", 1, false], ["Chaqiruvga qadar boshlang'ich tayyorgarlik", 1, false], ["SAT Matematika", 2, true], ["IELTS Speaking", 2, true],
  ];
}

export function buildDemoSchoolData() {
  const now = Date.now();
  const classes = [];
  for (let grade = 1; grade <= 11; grade++) {
    const letters = grade <= 9 ? ["A", "B", "C"] : ["A", "B", "C", "D"];
    letters.forEach((letter, idx) => classes.push({
      id: `class_${grade}_${letter}`,
      name: `${grade}-${letter}`,
      studentCount: grade <= 4 ? 28 + idx : grade <= 9 ? 26 + idx : 24 + idx,
      headTeacher: `${grade}-${letter} rahbari`,
      createdAt: now,
    }));
  }

  const subjectRows = [...STANDARD_SUBJECTS, ...EXTRA_SUBJECTS];
  const subjects = subjectRows.map((s, i) => ({
    id: idFrom("sub", s.name),
    name: s.name,
    weeklyHours: s.weeklyHours,
    type: s.type || "Oddiy",
    color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
    allowDouble: Boolean(s.allowDouble),
    createdAt: now,
  }));
  const subjectByName = Object.fromEntries(subjects.map(s => [s.name, s]));

  const teachers = [];
  subjects.forEach((subject, subjectIndex) => {
    const names = SUBJECT_TEACHER_NAMES[subject.name] || [`${subject.name} o'qituvchisi 1`, `${subject.name} o'qituvchisi 2`, `${subject.name} o'qituvchisi 3`];
    names.forEach((name, i) => teachers.push({
      id: idFrom("teacher", `${subject.name}_${i}_${name}`),
      name,
      subjectId: subject.id,
      subjectIds: [subject.id],
      phone: `+998 90 ${String(subjectIndex + 10).padStart(2, "0")} ${String(i + 11).padStart(2, "0")} ${String(i + 20).padStart(2, "0")}`,
      maxWeeklyHours: subject.name === "Ingliz tili" ? 36 : 30,
      status: "Bo'sh",
      createdAt: now,
    }));
  });
  const teachersBySubject = {};
  teachers.forEach(t => {
    const subject = subjects.find(s => s.id === t.subjectId);
    if (!subject) return;
    if (!teachersBySubject[subject.name]) teachersBySubject[subject.name] = [];
    teachersBySubject[subject.name].push(t);
  });

  const rooms = [];
  for (let i = 101; i <= 120; i++) rooms.push({ id: `room_${i}`, name: String(i), capacity: 30, type: "Oddiy", createdAt: now });
  rooms.push(
    { id: "room_it_1", name: "IT xona 1", capacity: 24, type: "IT xona", createdAt: now },
    { id: "room_it_2", name: "IT xona 2", capacity: 24, type: "IT xona", createdAt: now },
    { id: "room_lab_kimyo", name: "Kimyo laboratoriyasi", capacity: 24, type: "Laboratoriya", createdAt: now },
    { id: "room_lab_fizika", name: "Fizika laboratoriyasi", capacity: 24, type: "Laboratoriya", createdAt: now },
    { id: "room_sport", name: "Sport zal", capacity: 80, type: "Sport zal", createdAt: now }
  );

  const timeslots = [
    [1, "08:00", "08:45"], [2, "08:50", "09:35"], [3, "09:40", "10:25"], [4, "10:30", "11:15"],
    [5, "11:20", "12:05"], [6, "12:10", "12:55"], [7, "13:00", "13:45"], [8, "13:50", "14:35"], [9, "14:40", "15:25"],
  ].map(([lessonNumber, startTime, endTime]) => ({ id: `ts_${lessonNumber}`, lessonNumber, startTime, endTime, type: "lesson" }));

  const lowerClassIds = classes.filter(c => gradeOf(c.name) <= 7).map(c => c.id);
  const upperClassIds = classes.filter(c => gradeOf(c.name) >= 8).map(c => c.id);
  const lunchGroups = [
    { id: "lunch_lower", name: "1–7 sinflar obedi", startTime: "13:00", endTime: "13:45", classIds: lowerClassIds },
    { id: "lunch_upper", name: "8–11 sinflar obedi", startTime: "13:50", endTime: "14:35", classIds: upperClassIds },
  ];

  const classSubjects = {};
  const classIndexByGrade = {};
  classes.forEach(cls => {
    const grade = gradeOf(cls.name);
    classIndexByGrade[grade] = classIndexByGrade[grade] || 0;
    const idx = classIndexByGrade[grade]++;
    const plan = subjectPlanForGrade(grade);
    classSubjects[cls.id] = plan.map(([name, hours, allowDouble]) => {
      const subject = subjectByName[name];
      const tId = pickTeacher(teachersBySubject, name, idx + grade);
      const opts = { allowDouble };
      if (name === "Informatika") opts.roomId = idx % 2 === 0 ? roomByName(rooms, "IT xona 1") : roomByName(rooms, "IT xona 2");
      if (name === "Kimyo") opts.roomId = roomByName(rooms, "Kimyo laboratoriyasi");
      if (name === "Fizika") opts.roomId = roomByName(rooms, "Fizika laboratoriyasi");
      if (name === "Jismoniy tarbiya") opts.roomId = roomByName(rooms, "Sport zal");
      if (name === "Ingliz tili" && grade === 5) {
        const groupTeachers = (teachersBySubject["Ingliz tili"] || []).slice(0, 5);
        opts.levelGroupEnabled = true;
        opts.levelGroupKey = "5-sinf ingliz tili daraja guruhlari";
        opts.levelGroups = groupTeachers.map((t, i) => ({ name: `${i + 1}-level`, teacherId: t.id, roomId: "" }));
      }
      if (name === "Jismoniy tarbiya" && grade === 3 && ["class_3_A", "class_3_B"].includes(cls.id)) {
        opts.groupKey = "3-A va 3-B jismoniy tarbiya";
        opts.parallelEnabled = true;
        opts.teacherId = pickTeacher(teachersBySubject, name, 0);
      }
      if (name === "Musiqa" && grade === 4 && ["class_4_A", "class_4_B"].includes(cls.id)) {
        opts.groupKey = "4-A va 4-B musiqa";
        opts.parallelEnabled = true;
        opts.teacherId = pickTeacher(teachersBySubject, name, 0);
      }
      const assignment = baseAssignment(subject, opts.teacherId || tId, hours, opts);
      // 6-A sinf ingliz tili ikkita guruhga bo'linadigan oddiy test.
      if (name === "Ingliz tili" && cls.id === "class_6_A") {
        assignment.splitEnabled = true;
        assignment.teacherId2 = pickTeacher(teachersBySubject, "Ingliz tili", 3);
        assignment.groupName1 = "Strong group";
        assignment.groupName2 = "Support group";
      }
      return assignment;
    }).filter(Boolean);
  });

  // Tayyor nusxa (fayldagi asl obyekt tahrirlanib ketmasin)
  const schedule = structuredClone(demoSchedule);

  return {
    settings: { schoolName: "Demo Turon odob-ilm maktabi", academicYear: "2026-2027" },
    classes,
    subjects,
    teachers,
    rooms,
    timeslots,
    lunchGroups,
    classSubjects,
    schedule,
  };
}
