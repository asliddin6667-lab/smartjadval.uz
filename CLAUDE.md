# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Loyiha haqida

Smartjadval.uz — O'zbekiston maktablari uchun avtomatik dars jadvali platformasi.
React 19 + Vite 8 SPA, backend sifatida Supabase (Auth + Postgres + Edge Function),
GitHub Pages'ga `smartjadval.uz` domeni bilan deploy qilinadi.

**UI matnlari va kod izohlari — o'zbek tilida.** Yangi kod ham shu tilda yozilsin.

## Buyruqlar

```bash
npm run dev       # Vite dev server — port 5175, strictPort, brauzer avtomatik ochiladi
npm run build     # dist/ ga production build
npm run lint      # eslint . (flat config, dist/ e'tiborsiz)
npm run preview   # build natijasini ko'rish
```

Windows PowerShell'da `npm.ps1` execution-policy xatosi chiqsa — `npm.cmd run dev`.

Test to'plami yo'q (test runner ham o'rnatilmagan). Tekshirish = `npm run lint` +
`npm run build` + brauzerda qo'lda sinash.

## Arxitektura

### Navigatsiya — router kutubxonasi ISHLATILMAYDI

`react-router-dom` package.json'da bor, lekin hech qayerda import qilinmagan
(`framer-motion` va `react-icons` ham shunday — ishlatilmaydigan bog'liqliklar).

Navigatsiya [App.jsx](src/App.jsx) ichida: `activePage` state + `PAGE_IDS` ro'yxati +
`renderPage()` switch. Faol bo'lim URL hash'ida (`#/schedule`) saqlanadi — GitHub
Pages'da server tomonda rewrite yo'q, shuning uchun path emas, hash ishlatiladi.
`popstate` orqali brauzerning "Orqaga" tugmasi bo'limlar bo'ylab yuradi.

**Yangi sahifa qo'shish = 4 joyga tegish:** import, `PAGE_IDS`, `renderPage()` switch,
[Sidebar.jsx](src/components/Sidebar.jsx) menyusi.

### Rollar — uchta alohida ilova daraxti

`App.jsx` foydalanuvchi roliga qarab butunlay boshqa daraxt render qiladi:

| Rol | Nima ko'radi |
|---|---|
| `district_admin` | [DistrictApp.jsx](src/pages/DistrictApp.jsx) — maktab ma'lumotlari yuklanmaydi, cloudSync ishlamaydi |
| `superadmin` | oddiy ilova + [Users.jsx](src/pages/Users.jsx) sahifasi |
| `user` | oddiy ilova |

`mustChangePassword` bayrog'i hamma narsadan ustun — `ForcePasswordChange` ekrani
(App.jsx oxirida) ochiladi. Parol tiklash havolasi (`isPasswordRecoveryUrl()`) undan
ham ustun.

### Ma'lumot holati — props drilling, store yo'q

Maktab ma'lumotlari 11 ta state slice sifatida `App.jsx` da yashaydi:
`settings, classes, subjects, teachers, classSubjects, rooms, timeslots, lunchGroups,
shifts, schedule, savedSchedules`. Context/Redux/Zustand yo'q — hammasi `pageProps` orqali pastga
uzatiladi, sahifalar `setXxx` setterlarini oladi.

Bu ro'yxat **uch joyda sinxron turishi shart**: `App.jsx` state'lari va `saveUserData`
effektlari, `readLocalData()`, hamda [cloudSync.js](src/services/cloudSync.js) dagi
`SYNC_KEYS` + `EMPTY`. Bittasi unutilsa — ma'lumot bulutga bormaydi yoki qaytishda
yo'qoladi.

### Saqlash: bulut yagona haqiqat manbai (cloudSync v5)

**BULUT — YAGONA HAQIQAT MANBAI.** localStorage endi "asosiy nusxa" emas: u tezkor
kesh va internet uzilganda ko'rsatiladigan nusxa. Qaysi qurilmadan kirilmasin,
ekranda bulutdagi oxirgi holat turadi.

Fayllar:
[schoolBlob.js](src/services/schoolBlob.js) — ma'lumot shakli (SYNC_KEYS, EMPTY,
encode/decode, hash), [cloudSync.js](src/services/cloudSync.js) — sinxronizatsiya
dvigateli, [versionService.js](src/services/versionService.js) — bulutdagi versiya
tarixi, [Backups.jsx](src/pages/Backups.jsx) — "Zaxira nusxalar" sahifasi,
[SyncBadge.jsx](src/components/SyncBadge.jsx) — o'ng pastdagi holat nishoni.

- Kalit formati: `smartjadval_user_<userId>_<key>` ([storageService.js](src/services/storageService.js)).
  Prefiks rejimga bog'liq — lokal rejimda `smartjadval_dev_` (pastga qarang).
- Bulutda hammasi **bitta JSONB blob**: `schools` jadvalida `owner_id` bo'yicha bitta
  qator, ichida barcha SYNC_KEYS + `_rev`/`_ts`/`_dev`.
- **Yozish — CAS (compare-and-swap).** `pushToCloud()`
  `UPDATE ... WHERE owner_id = ? AND data->>'_rev' = <baseRev>` yuboradi. Bulut
  oldinga ketgan bo'lsa 0 qator o'zgaradi va push `stale` qaytaradi — ya'ni eski
  qurilma yangi ma'lumot ustidan **yoza olmaydi**. CAS so'rovining o'zi rad etilsa
  (PostgREST JSON filtrni qo'llamasa) `guardedUpsert()` ga o'tiladi — u ham avval
  `readCloudHead()` bilan bulut holatini tekshiradi.
- **Konflikt — kalitma-kalit uchtomonlama birlashtirish** (`threeWayMerge`,
  `reconcile`). `sync_meta_<userId>.keyHashes` — biz oxirgi ko'rgan bulut holatining
  HAR BIR kaliti hash'i. Har kalit uchun: faqat mahalliy o'zgargan → mahalliy qoladi;
  faqat bulut o'zgargan → bulutniki; ikkalasi ham → **bulut ustun**, mahalliy nusxa
  esa versiya tarixiga va `conflict_<userId>` ga zaxiraga tushadi.
  **Qurilma soati ishlatilmaydi** — noto'g'ri sana ma'lumotni yo'qota olmaydi
  (v4 da aynan shu ma'lumot yo'qolishiga sabab bo'lgan).
- Avtosaqlash: `schedulePush()` debounce (0.7s kutish, 2.5s maksimal) →
  `pushWithRetry()` (4 urinish) → `startAutoSync()` "qorovul"i har 10 soniyada
  yuborilmagan o'zgarishni jo'natadi yoki bulutni tekshiradi (oyna faol bo'lganda)
  → `flushPush()` sahifa yopilishida/chiqishda → `beforeunload` ogohlantirishi.
- `pushToCloud()` `updated_at` ni **qo'lda yozadi**. `schools` jadvalida UPDATE uchun
  trigger yo'q — busiz u INSERT vaqtida qotib qolardi va boshqa qurilma "bulut
  o'zgarmagan" deb ma'lumotni umuman tortmasdi.
- `checkRemote()` boshqa qurilmadagi o'zgarishni ekranga tushiradi
  (`onRemoteUpdate` → App.jsx). Mahalliyda yuborilmagan o'zgarish bo'lsa — tegmaydi
  (avval o'sha ketadi).
- **Internet yo'q → FAQAT O'QISH.** Sinxronizatsiya holati `offline`/`error` bo'lsa
  App.jsx `<main>` ustidagi `guardClick`/`guardFocus` barcha tahrirlashni bloklaydi
  va qizil banner chiqaradi (mehmon rejimi bilan bir xil naqsh; qulfdan chiqarish
  atributi — `data-sync-allow`). Bir martalik uzilishda qulflanmaydi — ketma-ket
  ikki muvaffaqiyatsiz tekshiruv kerak (`headFailures`).
- App.jsx `syncDone` bayrog'i: kirishdagi sinxronizatsiya tugamaguncha `schedulePush`
  chaqirilmaydi va tahrirlash ham kutdiriladi (`syncPending`).
- `SYNC_KEYS` ga yangi kalit qo'shsangiz — hozirgi ro'yxatni `LEGACY_KEY_SETS` ga
  ko'chiring (ikkalasi ham schoolBlob.js da). Aks holda `lastHash` barcha
  qurilmalarda mos kelmay qoladi.
- `classSubjects` "sim uchun" siqiladi (`encodeBlob`/`decodeBlob`, `WIRE_VERSION = 3`):
  `CS_DEFAULTS` dagi default qiymatlar tashlanadi, qaytarishda tiklanadi.
  **`classSubjects` yozuviga yangi maydon qo'shsangiz — `CS_DEFAULTS` ni ham yangilang**,
  aks holda qiymat bulutdan noto'g'ri tiklanadi. Bo'sh massivlar —
  `CS_EMPTY_ARRAYS` (`levelGroups`, `pairExtra`).
- `demo@smartjadval.uz` hisobi hech qachon bulutga yozilmaydi; ma'lumoti bo'sh bo'lsa
  [demoData.js](src/utils/demoData.js) dan avtomatik to'ldiriladi.

### Zaxira nusxalar (versiya tarixi)

`schools` da faqat OXIRGI holat turadi. Har bir muvaffaqiyatli yuborishdan keyin
holatning to'liq nusxasi `school_backups` jadvaliga tushadi
([versionService.js](src/services/versionService.js)):

- avtomatik zaxira — har 4 daqiqada bir martadan ko'p emas (`AUTO_GAP`);
- **majburiy** zaxira — konfliktda yutqazgan nusxa, tiklashdan oldingi holat,
  "💾 Hozirgi holatni zaxiraga olish" tugmasi;
- server trigger har foydalanuvchida oxirgi **40** tasini qoldiradi;
- "Zaxira nusxalar" sahifasi ro'yxatni ko'rsatadi va `restoreBlob()` orqali
  tiklaydi (tiklashdan oldingi holat ham avtomatik arxivlanadi — orqaga qaytish
  mumkin). Shu qurilmada qolgan `conflict_<userId>` zaxirasi ham shu sahifada
  ko'rinadi.

SQL: [school_backups_setup.sql](school_backups_setup.sql) — Supabase SQL Editor'da
bir marta ishga tushiriladi. Jadval bo'lmasa versiya tarixi jimgina o'chadi
(sinxronizatsiya baribir ishlayveradi), sahifada esa ogohlantirish chiqadi.

**LOKAL REJIM** ([devMode.js](src/services/devMode.js)): `npm run dev` da
(`import.meta.env.DEV`) cloudSync butunlay o'chadi — na push, na pull. Bundan tashqari
localStorage kalitlari `smartjadval_dev_` prefiksiga o'tadi, ya'ni sinov ma'lumoti
alohida "quti"da yotadi va bulutga yuboradigan kod uni umuman ko'rmaydi.
Production build'da `isLocalOnly()` doim `false` — Vite uni compile paytida yo'q qiladi
(`function k(){return!1}`), shuning uchun saytda bu mexanizmning izi ham qolmaydi.
Lokal ma'lumotni tozalash: dev konsolida `smartjadvalWipeLocal()`. Bulutni ataylab yoqish:
`localStorage.setItem("smartjadval_cloud_sync","on")` yoki `.env.local` da
`VITE_CLOUD_SYNC=on`. Rejim ekranning chap pastida "🔌 Lokal rejim" nishoni bilan
ko'rinadi. **Diqqat:** bu qulf faqat maktab ma'lumoti sinxronizatsiyasiga tegishli —
auth (login), superadmin RPC lari va tuman moduli yozuvlari lokalda ham haqiqiy
Supabase bilan ishlaydi.

### Jadval ma'lumot tuzilmasi

```js
schedule[day][timeslotId] = [ lesson, ... ]   // day — DAYS dagi o'zbekcha nom
lesson = { subjectId, classId, classIds[], teacherId, roomId, groupPart?,
           blockSize?, blockIndex?, groupKey?, alternating?, altTeacherId?,
           locked?, manual? }
```

`DAYS` ("Dushanba"…"Shanba", [constants.js](src/utils/constants.js)) obyekt KALITI
sifatida ishlatiladi — nomini o'zgartirish saqlangan barcha jadvallarni buzadi.

Bir katakda bir nechta dars bo'lishi normal: guruhli fanlar (`splitEnabled`), daraja
guruhlari (`levelGroupEnabled`), parallel sinflar (`classIds` bir nechta), juft/toq
hafta almashinuvi (`weekAltEnabled`), fan almashinuvi (`swapEnabled`),
**bir vaqtda bir nechta fan** (`pairEnabled`).

**Bir vaqtda bir nechta fan (`pairEnabled`)** — sinf 2, 3, 4… guruhga bo'linadi va
guruhlar AYNI BIR SOATDA turli fan o'qiydi (masalan 1-guruh Ona tili, 2-guruh Rus
tili, 3-guruh SAT). `swapEnabled` dan farqi: guruhlar almashmaydi va 2 soatlik blok
talab qilinmaydi.

Guruhlar modeli — [pairGroups.js](src/utils/pairGroups.js) (`pairSideGroups()`,
`pairSideSlots()`, `normalizePairExtra()`). **Yangi kod pair maydonlarini qo'lda
o'qimasin — shu yordamchilardan foydalansin**, aks holda 3-guruhdan boshlab
ma'lumot ko'rinmay qoladi.

| Guruh | Qayerda yashaydi |
|---|---|
| 1-guruh | qatorning o'z fani: `subjectId`, `teacherId`, `roomId`, `groupName1` |
| 2-guruh | `pairSubjectId`, `pairTeacherId`, `pairRoomId`, `groupName2`, `pairShare2` |
| 3-guruh+ | `pairExtra[]` = `{ gid, name, shared, subjectId, teacherId, roomId }` |

Kartada ko'pi bilan `PAIR_MAX_GROUPS = 6` guruh bo'ladi. Generatorda `type: "pair"`
so'rovi; dars yozuvlari `pairKey` bilan bog'lanadi — shu kalit ularni
[Schedule.jsx](src/pages/Schedule.jsx) `groupLessons()` da BITTA karta qiladi,
[moveResolver.js](src/utils/moveResolver.js) `sameCard()` da birga ko'chiradi va
`compactSchedule()` ning `baseKeyOf()` sida BITTA birlik qiladi.
**Uchala joyda ham `pairKey` hisobga olinishi SHART** — bittasida unutilsa, karta
bo'linib, guruhlar har xil soatga (hatto har xil kunga) tarqalib ketadi.
Guruh fanlarini "Sinf fanlari" ro'yxatida ALOHIDA belgilash shart emas
(belgilansa — soat ikki marta hisoblanadi, UI ogohlantiradi).

**Parallel sinflar (`pairGroupKey`).** Bir nechta sinf bitta kartani baham ko'radi —
hammasi AYNI SOATDA o'qiydi. Model **oynali**: guruhga kirgan HAR BIR sinfda o'z
`classSubjects` yozuvi turadi, ularni `pairGroupKey` bog'laydi. Guruhga ko'pi bilan
3 sinf kiradi (`PAIR_MAX_EXTRA = 2`).

Har bir guruh alohida **UMUMIY** (`shared`) bo'lishi mumkin:

- **1-guruh** — HAR DOIM umumiy: bitta dars, bitta ustoz, hamma sinf uchun.
  Umumiy maydonlar `PAIR_SHARED_FIELDS` (`weeklyHours, teacherId, roomId,
  groupName1/2, allowDouble, isCore, spacedDays, pairShare2`) barcha a'zoda
  BIR XIL yoziladi.
- **2-guruh** — `pairShare2` yoqilsa umumiy (fani/ustozi/xonasi hamma sinfda bir
  xil), aks holda har sinfda O'Z fani.
- **3-guruh+** — har `pairExtra` yozuvining o'z `shared` bayrog'i bor. Massivning
  TUZILISHI (`gid`, `name`, `shared`) barcha a'zoda bir xil turadi; qiymatlar esa
  umumiy guruhda bir xil, aks holda sinfga xos. Sinxronlash —
  ClassSubjects `eachPairRow()` / `mergePairExtra()`.

Misol: 11-A va 11-B — Matematika (1-guruh, umumiy) + Rus tili (2-guruh, umumiy) +
3-guruh sinfga xos (11-A: SAT, 11-B: Biologiya).

UI — [ClassSubjects.jsx](src/pages/ClassSubjects.jsx) dagi guruh kartalari
(«🔗 Parallel sinflarda umumiy» belgisi + «➕ Yana fan qo'shish») va
"🔗 Parallel sinflar" bo'limi, faqat `pairEnabled` yoqilganda ko'rinadi.
A'zo sinf kartasida FAQAT umumiy bo'lmagan guruhlar sozlanadi.

Generatorda a'zolar `pairMap` orqali BITTA so'rovga birlashadi: `classIds` — hamma
sinf, `pairGroups[]` — 1-guruhdan keyingi har bir "slot"; umumiy guruh bitta yozuv
(`classIds` ichida hamma sinf), umumiy bo'lmagani esa har sinf uchun alohida yozuv.
Kunlik fan limiti sinfma-sinf hisoblanadi (`req.perClassSIdx` — endi har sinf uchun
fan indekslari RO'YXATI), guruhsiz holatda esa avvalgidek `swapSubjectId` ishlaydi.
Ustoz soatlarida umumiy guruh BIR MARTA sanaladi (ClassSubjects
`computeTeacherHours`, TeacherAvailability, Schedule `computeTeacherLoadRows`,
VacancyAnalysis).

⚠️ Kartadagi hamma guruh bir vaqtda o'qiydi, shuning uchun **ustoz ham, xona ham
butun karta bo'ylab takrorlanmasligi shart** — UI tanlash ro'yxatlarini filtrlaydi
va ogohlantiradi, generator esa takroriy xonani olib tashlaydi (`dedupeRooms`),
takroriy ustozli so'rovni esa qabul qilmaydi.

**USTOZ SOATI — KARTADA BIR MARTA.** Kartadagi guruhlar ayni soatda o'qiydi va
parallel sinflar bitta kartani baham ko'radi, shuning uchun ustoz nechta guruhda
va nechta sinfda tursa ham ko'pi bilan `weeklyHours` soat band bo'ladi. Sanoq
`shared` bayrog'iga EMAS, `pairCardKey(a, classId)` + ustoz id'siga tayanadi —
bayroq sinflar orasida nomutanosib qolsa ham soat ikkilanmaydi. Shu qoida
ClassSubjects `computeTeacherHours`, Schedule `computeTeacherLoadRows`,
TeacherAvailability, VacancyAnalysis (`seenCardTeach`) va districtExcel da
takrorlangan. Generatorda ham xuddi shunday: guruh bo'laklari
`T__<gid>__<teacherId>` bo'yicha birlashadi — aks holda ayni ustoz ikki bo'lakka
tushib, `isValidRequest` butun kartani jimgina tashlab yuborardi. UI tomonda esa
a'zo sinf guruhlari `pairAlignSlots(owner, member)` orqali ASOSIY sinf tuzilishi
bo'yicha ko'rsatiladi.

Xuddi shu qoida **birga o'qiydigan boshqa rejimlarga** ham tegishli — ular ham
bir nechta sinfni BITTA darsga birlashtiradi, demak ustoz soati bir marta
sanaladi:

| Rejim | Dedup kaliti | Generatordagi manba |
|---|---|---|
| 🔁 Parallel dars | `groupKey` + fan + ustoz + xona | `groupMap` ([scheduleGenerator.js](src/utils/scheduleGenerator.js)) |
| Daraja guruhlari | `levelGroupKey` + fan + **ustoz** (guruh indeksi EMAS — tartib sinflarda har xil bo'lishi mumkin) | `levelGroupMap` |
| Parallel sinflar | `pairCardKey(a, classId)` + ustoz | `pairMap` |

Kalit bo'sh bo'lsa sinflar birga o'qimaydi — u holda kalit sinfga xos bo'lishi
kerak, aks holda aloqasiz sinflar noto'g'ri birlashib ketadi.

**Buni unutish qimmatga tushadi:** Schedule `computeTeacherLoadRows` da
`groupKey` hisobga olinmagani uchun 2 soatlik parallel dars 5 sinfda 10 soat
bo'lib ko'rinardi. Natijada «ustozning smenasiga sig'maydi» degan yolg'on
ogohlantirish chiqar, `hardBlocked` esa generatsiya vaqtini 30 s dan 10 s ga
qisqartirib qo'yardi.

**FAN esa TAKRORLANISHI MUMKIN** — masalan 1-guruh Fizika (Asilbek), 3-guruh ham
Fizika (Bekzod). Shu sababli soat sanashda ehtiyot bo'ling: guruhlar AYNI SOATDA
o'qiganidan, sinf setkasida har bir **TURLI** fan `weeklyHours` ta soat egallaydi
(takroriy fan bir marta). Bu qoida `requiredHours`/`requiredTotal`
([Schedule.jsx](src/pages/Schedule.jsx)), `totalWeeklyHours`
([scheduleGenerator.js](src/utils/scheduleGenerator.js)), `analysisExport`,
`hourGridExport` va `districtExcel` da takrorlangan — bittasi unutilsa, jadval
100% chiqsa ham "soat tushmadi" deb ko'rsatadi. Generatorda `req.perClassSIdx`
ham shu sababli takroriy fan indeksini (va `req.sIdx` ni) tashlaydi.
Ustoz yuklamasi esa aksincha — har guruh ustozi ALOHIDA sanaladi.

### Jadval dvigatellari

- [scheduleGenerator.js](src/utils/scheduleGenerator.js) (~3700 qator) — avtomatik
  generatsiya. `generateSchedule()` bir necha `generateScheduleAttempt()` chaqiradi
  (har birida boshqa `seed` va `strategy`), natijalarni `betterResult()` bilan
  leksikografik taqqoslaydi: tushmagan soat → joylangan soat → kun o'rtasidagi oyna →
  kunlik yuk notekisligi → yumshoq jarima. Vaqt byudjeti `budgetFor(totalHours)` da
  hisoblanadi va deadline'ga qarab erta to'xtaydi, shuning uchun UI qotib qolmaydi.
  `lockedSchedule` — 🔒 qulflangan darslar qayta generatsiyada joyida qoladi.
  **Qulf dars TURIGA bog‘liq emas:** guruhli darslar (🔁 parallel dars, daraja
  guruhlari, parallel sinflar) ham urug‘ sifatida qabul qilinadi. Soat ikki marta
  joylanmasligini `lockedCount` ta’minlaydi — u qulflangan yozuvning `classIds`
  dagi HAR BIR sinfidan `weeklyHours` ni ayiradi, shuning uchun guruh so‘rovi
  faqat qolgan soatga tuziladi. Qulflangan darsni seedan chiqarib tashlash
  (avval guruhli darslar shunday edi) — dars boshqa soatga ko‘chib ketishi
  demakdir.
- [moveResolver.js](src/utils/moveResolver.js) — **qo'lda ko'chirish/almashtirishning
  yagona dvigateli**. Sinf setkasi ([Schedule.jsx](src/pages/Schedule.jsx)) va ustoz
  setkasi ([TeacherGrid.jsx](src/components/TeacherGrid.jsx)) ikkalasi ham shundan
  foydalanadi — ko'chirish qoidasi o'zgarsa, faqat shu faylga tegiladi.
- `fillRemaining()` ([Schedule.jsx](src/pages/Schedule.jsx)) — **zaxira to'ldirgich**.
  Generator tushira olmagan soatlarni joylashtiradi: avtomatik (generatsiya oxirida,
  `markManual = false`) va «🔧 Hammasini bir bosishda hal qilish» tugmasi orqali
  (`resolveAll`, `markManual = true`).

**ZAXIRA TO'LDIRGICH SOZLAMANI TAKRORLASHI SHART.**
⚠️ Ilgari u darsni «shundoq» qo'yardi — `{ subjectId, teacherId, roomId: "" }`.
Natijada 2 guruhga bo'lingan fan yolg'iz, XONASIZ va BLOKSIZ tushib qolardi:
ekranda «Ingliz tili — 1-guruh ustozi • Xonasiz», 2-guruh ustozi esa umuman
yo'qolardi (`assignedTeacher()` faqat `a.teacherId` ni qaytaradi). «2 soat blok»
ham buzilib, ikki soat ikki xil kunga tarqalib ketardi.

Endi `fillTemplate(cls, sid)` sinf fanidagi sozlamadan **shablon** yasaydi va
`placeTemplate()` uni aynan generatordagi `buildEntries()` kabi yozadi:

| Sozlama | Shablon |
|---|---|
| Daraja guruhlari | har guruh — alohida yozuv, `levelGroupEnabled` + `groupKey = levelGroupKey`, sinflar `levelGroupInfo()` dan |
| 2 guruhga bo'lish (`splitEnabled`) | ikki yozuv BITTA katakda: `teacherId`/`roomId` va `teacherId2`/`roomId2`, `groupPart`, `splitEnabled` |
| Hafta almashinuvi | bitta yozuv + `alternating`/`altSubjectId`/`altTeacherId`/`altRoomId`, blok qilinmaydi |
| Parallel dars (`groupKey`) | bitta yozuv, `classIds` — guruhdagi HAMMA sinf, `groupKey` yoziladi |
| Oddiy dars | bitta yozuv, endi **xonasi bilan** |

`allowQuad`/`allowDouble` bo'lsa blok uzunligi 4 → 2 → 1 tartibida sinaladi
(`blockSize`/`blockIndex` yoziladi, aks holda zichlash blokni ikkiga bo'lardi).
Bo'laklar `blockLinkOk()` bilan bog'lanadi — obed ustidan o'tishga ruxsat, lekin
60 daqiqadan uzun uzilish (smena almashinuvi) orqali emas.

`spotFor()` joy qidirishda HAR BIR guruh ustozi va HAR BIR xonani tekshiradi
(ilgari xona umuman tekshirilmasdi, chunki hech qachon yozilmasdi).

**`pairEnabled` va `swapEnabled` — TEGILMAYDI.** Sinf guruhlarga bo'lingan yoki
soat hisobi boshqacha; yolg'iz dars qo'yish jadvalni buzadi, shuning uchun ular
«tushmadi» ro'yxatida rostgo'y qolib ketadi. **Yangi guruh turini qo'shsangiz —
`fillTemplate` ga ham shox qo'shing, aks holda u yerda jimgina buzilib chiqadi.**

Hard cheklovlar (ikkala dvigatelda ham): ustoz/sinf dam kuni, obed guruhlari, smena
(`timeslot.classIds`), ustoz/sinf/xona bandligi.

**ZICHLASH — «🧲 Oynani yopish» (`compactSchedule`, 9-parametr `options`).**
Funksiya ikki rejimda ishlaydi:

- **oddiy** (`options` berilmasa) — generatsiya sikli ichida har nomzod uchun
  chaqiriladi, tez (~30–100 ms), avvalgi xatti-harakat;
- **majburiy** (`{ hard: true, spin, budgetMs }`) — «🧲 Oynani yopish» tugmasi,
  `resolveAll()` va generatsiyaning YAKUNIY bosqichi. Oyna nolga tushmaguncha
  yoki `budgetMs` tugamaguncha to'xtamaydi.

Majburiy rejim bosqichlari (har raundda tartib bilan, `totalGaps()` kamaymasa
keyingisiga o'tiladi):

| # | Bosqich | Nima qiladi |
|---|---|---|
| 1 | `dayFullSolve(d)` | BUTUN kunni qayta yechadi: har sinf uchun maqsad — kunning dastlabki `n` ta ochiq katagi (`n` = o'sha kundagi dars soni). Yechim topilsa o'sha kunda hech bir sinfda oyna qolmaydi |
| 2 | `prefixRebuild` + `gapChainFix` | bitta sinf ichida prefiks yig'ish, zanjirli almashtirish (eski bosqichlar) |
| 3 | `transplantPass` | boshqa kundagi darsni oynaga tortib olish |
| 4 | `pushOut` | oynadan keyingi darsni boshqa kunga chiqarish (oyna DARHOL kamaysa) |
| 5 | `shrinkAndSolve` | kunni bir soatga qisqartirib IKKALA kunni qayta yechish; natija yomon bo'lsa `restoreSnap` bilan hammasi joyiga qaytariladi |
| — | `kick(n)` | mahalliy «cho'qqi»da qotib qolganda bir necha darsni ataylab tasodifiy joyga surish (iterated local search). Eng yaxshi holat `bestSnap` da saqlanadi va sikl oxirida tiklanadi |

`dayFullSolve` — **dinamik MRV + oldindan tekshirishli** backtracking. Kunda ~80
ta «o'zgaruvchi» bo'ladi; qat'iy tartibli oddiy backtracking bu o'lchamda deyarli
har doim tugun chegarasiga urilardi (sinovda 33 000 marta chegara, 3 marta yechim).
Har qadamda eng kam variantli birlik tanlanadi, biror birlikning varianti umuman
qolmasa shox darhol kesiladi. **Bu qidiruvni sekinlashtiradigan har qanday
o'zgartirish (masalan yana bir qat'iy tartib) natijani keskin yomonlashtiradi.**

`spin` — takroriy chaqiruvda domen va tartib aylantiriladi. Busiz «yana bosing»
aynan o'sha natijani qaytarardi. Shuning uchun UI sikli (`compactNow`) har
urinishda `spin` ni oshiradi va byudjetni kattalashtiradi.

⚠️ **Zichlash ilgari ustozning DAM KUNINI tekshirmasdi** — generator uni hurmat
qilar, lekin keyingi zichlash darsni dam kuniga ko'chirib yuborardi (sinovda 24
sinfli maktabda 18 ta buzilish). Endi `offDays` `tBlockedMap` ga to'liq yopiq kun
sifatida yoziladi. Zichlashga yangi cheklov qo'shsangiz — shu joyga qo'shing,
`fits()` va domen hisobi ikkalasi ham o'sha jadvalni o'qiydi.

**KUNLIK KVOTA — oynasizlik va teng taqsimotning kafolati.**
Generator ishga tushishidan oldin har sinf uchun `dayQuota[sinf][kun]` hisoblanadi
(`setDayQuotas()`): sinfning HAQIQIY talabi (barcha so'rov bloklari yig'indisi +
qulflangan darslar) ish kunlariga butun son bo'lib beriladi ("suv to'ldirish" —
sig'imi yetmagan qisqa kun to'ladi, ortgani qolgan kunlarga qayta bo'linadi).
Shundan keyin `fitsAt()` da IKKITA qattiq cheklov ishlaydi:

1. `balanceOk()` — kundagi dars soni kvotadan oshmaydi;
2. `quotaRankOk()` — dars faqat kunning DASTLABKI kvota ta soatiga tushadi
   (`slotRank < dayQuota`).

Ikkalasi birga turgani uchun: **barcha soat joylashsa, har kunda aynan kvota ta
dars bo'ladi va ular kun boshidan ketma-ket turadi** — ya'ni kun o'rtasida "oyna"
matematik jihatdan paydo bo'la olmaydi, yuk esa kunlarga teng tushadi. Bu cheklovni
tuzatuvchi bosqichlar emas, joylashtirishning O'ZI ta'minlaydi.

Yon berish **bosqichma-bosqich** bo'ladi. Qidiruv qat'iy kvota bilan boshlanadi;
soat joylashmay qolsa `solveSlack` BUTUN taxta bo'yicha kengayadi (to'lqin 3 →
+1, 6 → +2, 9 → cheklovsiz). Faqat joylashmagan darsni yumshatish yetmaydi:
yo'lni to'sgan dars ham o'z prefiksidan chiqa olmasa, zanjirli ko'chirish
ishlamaydi. Zichlash boshlanishida `solveSlack` va `balRelax` NOLGA qaytariladi,
kvota esa haqiqatda joylashgan soat bo'yicha qayta hisoblanadi;
`quotaFixPass()` kvotadan oshgan kunni majburan bo'shatadi (oyna ochadigan
ko'chirishni qabul qilmaydi; chetlanish ≥3 bo'lgan sinfda zanjirga ruxsat).

Ustuvorlik tartibi qat'iy: **joylangan soat → oyna → kunlik yuk tengligi**.
Shuning uchun oxirgi bosqichda (oyna baribir qolsa) kunlik yuk chegarasi 1 taga
yon beradi — kun o'rtasida nazoratsiz qolgan sinf notekis yukdan yomonroq.

**«2 SOAT BLOK» — BUZILMAYDIGAN QOIDA.** Blok hech qachon ikkita alohida
darsga bo'linmaydi: agar sozlamada 2 soat blok belgilangan bo'lsa, u ALBATTA
ketma-ket ikki soatda turadi. Blokka sinf, ustoz va xona bir vaqtda bo'sh
KETMA-KET ikki soat kerak; tor jadvalda bunday juftlik o'z-o'zidan qolmasligi
mumkin. Shuning uchun `forceBlockPlace()` **yo'lni tozalaydi**: to'sib turgan
darslar oddiy urinishdagidan ancha chuqur zanjir bilan (`EJECT_MAX`) boshqa
kataklarga suriladi va shu paytda `solveSlack` vaqtincha to'liq ochiladi.
Chuqur qidiruv qimmat, shuning uchun butun urinishga `forceBudgetMs = 2500`
umumiy vaqt chegarasi qo'yilgan.

**BLOK OBED/TANAFFUSDAN OSHIB O'TADI.** Maktabda obed alohida vaqt bandi
bo'lsa (masalan 5-o'rin, `type: "lunch"`), blok «4-dars → obed → 6-dars»
ko'rinishida ham joylanadi. Sabab: obed sloti `teachingTs` ro'yxatiga
kirmaydi, ya'ni sinf uchun bu katak ham, oyna ham emas — chop etilgan
jadvalda dars qatorma-qator turadi va ustoz ham obeddan keyin o'sha sinfda
davom etadi. Qoida `blockLink[]` da (scheduleGenerator.js, `generateScheduleAttempt`
va `compactSchedule` da AYNI bir xil hisoblanadi): `1` — bevosita ketma-ket,
`2` — orada obed/tanaffus bor, `0` — bog'lab bo'lmaydi. Uzilish
`BRIDGE_MAX_GAP = 60` daqiqadan uzun bo'lsa bog'lanmaydi — smena
almashinuvidagi katta tanaffus blokni ikkiga cho'zib yubormaydi.
Obedli variant `BRIDGE_W = 1200` jarima oladi, ya'ni generator avval
HAQIQIY ketma-ket juftlikni qidiradi, obeddan oshirishni faqat boshqa
iloji qolmaganda tanlaydi. **Blok butunligini tekshiradigan har qanday
yangi kod `nextConsecutive` emas, `linkOk()` dan foydalansin** — aks holda
zichlash (`compactSchedule`) bunday blokni ikkiga bo'lib yuboradi.
**Obed alohida vaqt bandi bo'lmasa ham qoida ishlaydi.** Sinf oddiy DARS
soatida ovqatlansa (`lunchGroups`), o'sha katak sinf setkasida BAND turadi —
demak «4-dars → obed → 6-dars» ham oyna emas. Blok bunday katakni O'TKAZIB
YUBORADI: `blockOffs(req, d, i)` blok bo'laklarining `i` ga nisbatan
ofsetlarini qaytaradi (`null` — oddiy ketma-ket, `undefined` — bu joyga blok
tushmaydi), `slotAt(offs, i, o)` esa bo'lakning slot indeksini beradi.
Sakrash faqat blokdagi HAMMA sinf o'sha soatda ovqatlanganda mumkin: bir
sinfda obed, boshqasida yo'q bo'lsa — ikkinchisida haqiqiy oyna paydo
bo'lardi. Smena chegarasi (`slotClassBlock`) va dam kuni ustidan sakralmaydi.
**Blok kataklarini bo'ylab yuradigan har qanday yangi kod `i + o` emas,
`slotAt(blockOffs(...), i, o)` dan foydalansin** — joylashtirish yozuvida
ofsetlar `p.offs` da saqlanadi (`place`/`unplace` shuni o'qiydi).
`compactSchedule` da xuddi shu qoida `u.offs` / `uSlotAt(u, o)` orqali
takrorlangan; obed ustidan o'tgan blok u yerda joyidan qo'zg'almaydi
(`locked`), aks holda uni ko'chirish uchun narigi tomonda ham xuddi shunday
obed kerak bo'lardi.

**«4 SOAT BLOK» — FAQAT SUPERADMIN.** Aynan shu mexanizm, faqat blok
uzunligi `QUAD_SIZE = 4`: fan bir kunda KETMA-KET 4 soat tushadi. Sozlama —
`classSubjects[].allowQuad`; `splitHoursToBlocks(hours, allowDouble, allowQuad)`
avval 4 lik bloklarni ajratadi, qolganini `allowDouble` ga qarab 2 lik yoki
bittalab bo'ladi (6 soat → `[4, 2]`, faqat quad bo'lsa → `[4, 1, 1]`).

- Almashtirgich [ClassSubjects.jsx](src/pages/ClassSubjects.jsx) sozlamalar
  panelida FAQAT `currentUser.role === "superadmin"` bo'lganda ko'rinadi
  (`isSuperadmin`). Ma'lumot har foydalanuvchining o'z blobida yotgani uchun
  boshqa rolda `allowQuad` hech qachon yoqilgan bo'lmaydi.
- **Blok uzunligi hech qayerda 2 deb qotib qolmasligi kerak.** Generatordagi
  joylashtirish `req.blockSize` bo'yicha umumiy, lekin `compactSchedule()`
  ilgari faqat `blockIndex` 0 va 1 ni birlashtirardi — endi u qismlarni
  `blockIndex` 0, 1, 2… tartibida ketma-ket yig'adi, aks holda 4 lik blok
  zichlashda ikkiga bo'linib ketardi.
- Kunlik fan limiti 4 ga ko'tariladi: generatorda `dayCapFor()`
  (`blockSize` orqali) va `compactSchedule` dagi `quadSet`, UI tomonda esa
  [Schedule.jsx](src/pages/Schedule.jsx) `subjectDayCap()`.
- Soat SANOG'I o'zgarmaydi: blok — `weeklyHours` ni guruhlash usuli, shuning
  uchun ustoz va sinf yuklamasi avvalgidek 4 soat deb hisoblanadi.
- Sinf kunida 4 ta dars bo'lmasa yoki haftalik soat 4 dan kam bo'lsa blok
  yig'ilmaydi — `capacityWarnings()` buni ro'yxatga chiqaradi.

**Bekor qilishda soat yo'qolmasligi uchun:**

- **BAND katakka qo'yish taqiqlangan.** `balancePass` ko'chirishni
  bekor qilganda darsni eski katagiga qaytaradi. U katak oraliqda band bo'lib
  qolgan bo'lishi mumkin (kun qayta yig'ilgan) — ilgari dars baribir o'sha
  yerga qo'yilar va **ustoz/xona bir vaqtda ikki joyda** bo'lib qolardi.
  Endi `restorePlace()` avval `rawFree()` bilan katakni tekshiradi, band bo'lsa
  boshqa bo'sh katak qidiradi. Har qanday yangi "bekor qilish" yo'li shu
  funksiyadan foydalanishi SHART.

### Boshlang'ich sinf rahbari — «bola nazoratsiz qolmasin»

1–4 sinfda darslarning katta qismini BITTA ustoz beradi. U boshqa sinfga
kirib ketgan soatda shu sinfda BOSHQA ustozning darsi turishi kerak —
aks holda bolalar ustozsiz qoladi.

Butun mantiq [homeroom.js](src/utils/homeroom.js) da:

- **Sinf rahbari** — `classes[].headTeacherId`. Belgilanmagan bo'lsa
  boshlang'ich sinf uchun AVTOMATIK aniqlanadi (`detectHomeroomId`): «Sinf
  fanlari»da eng ko'p FAN bergan ustoz, teng bo'lsa eng ko'p soat bergani.
  Eski `headTeacher` MATN maydoni saqlanib qoldi (eksport va qidiruv unga
  tayanadi) — [Classes.jsx](src/pages/Classes.jsx) uni tanlangan ustoz ismi
  bilan sinxron yuritadi. `classes[].superviseOff === true` — qoida shu
  sinfga qo'llanmaydi.
- **`buildTeacherStreams()`** — ustozning haftalik yuklamasi «dars oqimlari»
  bo'yicha: parallel dars, daraja guruhi va parallel sinflar BIR MARTA
  sanaladi. Schedule.jsx `computeTeacherLoadRows` ham SHU funksiyaga
  tayanadi — hisob ikki joyda ajralib ketmasin.
- **`supervisionRows()`** — sinfdagi «begona ustoz» soati (`coverHours`),
  rahbarning tashqi soati (`outHours`) va `riskHours = outHours − coverHours`.
  Boshqa smenadagi sinflar hisobga olinmaydi (vaqt kesishmaydi).
- **`findSupervisionGaps()`** — TAYYOR jadvaldagi buzilishlar: sinf katagi
  bo'sh, kun hali tugamagan va aynan o'sha vaqtda rahbar boshqa sinfda.
  Kun oxiridagi bo'sh kataklar va obed hisobga olinmaydi.

**Nega qattiq cheklov emas.** Kunlik kvota (`quotaRankOk` + `balanceOk`)
sinf kunini ketma-ket prefiks qilib to'ldiradi, shuning uchun jadval 100%
chiqqanda katak bo'sh QOLMAYDI — rahbar chiqib ketgan soatda u yerda
albatta boshqa ustozning darsi turadi. Ya'ni qoida ko'p hollarda O'ZIDAN
bajariladi. Buzilish faqat soat tushmay qolganda yoki QO'LDA tahrirdan
keyin paydo bo'ladi. Shuning uchun generatorda faqat ikkita yumshoq
turtki bor ([scheduleGenerator.js](src/utils/scheduleGenerator.js)):

| Joy | Nima qiladi |
|---|---|
| `setSuperviseFlags(req)` | so'rovga `coverCIdxs` / `outCIdxs` belgilarini qo'yadi |
| `req.tier` | «o'rin bosar» darslar 1-pog'onaga ko'tariladi — oddiy darslardan oldin joylanadi |
| `supervisePenalty()` | rahbarning tashqi darsi sinf katagi TO'LA bo'lgan soatga tortiladi (`SUPERVISE_W = 2600`, oynadan yengil, kunlik yuk tengligidan og'ir) |

Mexanizm faqat rahbarning tashqi soati bor sinflarda yoqiladi
(`row.outHours > 0`) — aks holda tartib bekorga buzilmasin.

**Foydalanuvchi nimani ko'radi** ([Schedule.jsx](src/pages/Schedule.jsx)):

- `supervisionCapacityWarnings()` — `riskHours > 0` bo'lsa OGOHLANTIRISH
  (xato emas): ortiqcha soatlar sinf kunini erta tugatish bilan qoplanadi;
- 🧒 qizil quti — `findSupervisionGaps()` topgan HAQIQIY nazoratsiz soatlar.
  `schedule` o'zgarganda qayta hisoblanadi, ya'ni qo'lda tahrirdan keyin ham
  darhol yangilanadi;
- ko'chirish oynasida `superviseMoveWarnings()` ([moveResolver.js](src/utils/moveResolver.js))
  — reja NUSXADA qo'llanib, YANGI nazoratsiz soat paydo bo'lsa ogohlantiradi
  (taqiqlamaydi: direktor bilib turib ko'chirishi mumkin).

⚠️ `homeroom.js` `scheduleGenerator.js` dan HECH NARSA import qilmaydi
(teskari import bor) — `isTeachingSlot`, `slotAllowsClass`, `classHasLunchAt`
va vaqt bandlari mantig'i u yerda ataylab takrorlangan.

### Ma'lumot xatolaridan tiklanish

Guruhlar AYNI VAQTDA o'qiydi, shuning uchun bitta ustoz yoki bitta xona ikki
guruhga yeta olmaydi. Ilgari bunday yozuv butun darsni yaroqsiz qilardi va
soatlar **jimgina yo'qolardi**. Endi generator tiklanadi:

| Xato | Nima bo'ladi |
|---|---|
| Daraja guruhlarida bir xil ustoz | takroriy daraja tashlanadi (`cleanLevelGroups`) |
| Daraja/guruh/juftlikda bir xil xona | takroriy xona olib tashlanadi, dars xonasiz joylanadi (`dedupeRooms`) |
| `splitEnabled`, lekin 1- va 2-guruhga bir xil ustoz | oddiy (bo'linmagan) dars sifatida joylanadi |

Ma'lumotni baribir to'g'rilash kerak, shuning uchun
[Schedule.jsx](src/pages/Schedule.jsx) `capacityWarnings()` bu holatlarni
ro'yxatga chiqaradi. U yerda «Kelajak soati faqat dushanba, lekin ustoz
dushanbada dam oladi» kabi **mumkin bo'lmagan** talablar ham ko'rsatiladi —
aks holda foydalanuvchi 100% chiqmaganda sababini bilmay qoladi.

**Ustoz va xona bandligi VAQT bo'yicha, slot id bo'yicha emas.** Ikki smena bir xil
soatda o'tishi mumkin (id boshqa, `startTime` bir xil) — shuning uchun bandlik
`slotsOverlap()` bilan aniqlanadigan «vaqt bandi»ga bog'langan (`buildTimeBuckets()`,
[scheduleGenerator.js](src/utils/scheduleGenerator.js)). Generatorda `teacherGrid` va
`roomGrid` indeksi `d * TB + tsBucket[i]`, `buildValidationReport` esa `tSeen`/`rSeen`
ni band bo'yicha yuritadi; [moveResolver.js](src/utils/moveResolver.js) dagi `cellsAt()`
vaqti kesishadigan barcha kataklarni birga o'qiydi. **Sinf** bandligi va ustoz
setkasidagi qulflar (`blockedSlots`) avvalgidek slot bo'yicha qoladi.

### Saqlangan jadvallar

Dars jadvali sahifasidagi «💾 Saqlash» tugmasi joriy jadvalning TO'LIQ nusxasini nom
bilan `savedSchedules` massiviga qo'shadi ([savedSchedules.js](src/utils/savedSchedules.js)
dagi `upsertSaved`). Nusxalar [SavedSchedules.jsx](src/pages/SavedSchedules.jsx)
sahifasida ko'rinadi — u yerdan qayta yuklash (joriy jadval ustiga), nomini
o'zgartirish, Excel'ga chiqarish yoki o'chirish mumkin.

Har bir nusxa butun jadvalni saqlaydi, shuning uchun `MAX_SAVED = 20` cheklovi bor —
aks holda localStorage kvotasi va bulutga ketadigan JSONB blob shishib ketadi.
Saqlash oynasi ([SaveScheduleModal.jsx](src/components/SaveScheduleModal.jsx)) ikkala
sahifada ham bir xil ishlatiladi.

### Supabase

Klient [supabaseClient.js](src/services/supabaseClient.js) da — URL va **publishable**
anon kalit kodda hardcoded (env fayl yo'q, GitHub Pages statik hosting).
`flowType: 'pkce'` va `detectSessionInUrl: true` — parol tiklash havolasi shularsiz
ishlamaydi.

Jadvallar: `profiles`, `schools`, `school_backups`, `districts`, `schedule_submissions`, `notifications`,
`audit_log`, `district_excel_data`, `standard_hours`.
RPC: `admin_set_subscription`, `admin_set_role`, `admin_set_status`, `admin_create_user`,
`admin_delete_user`, `admin_set_district`, `admin_set_location`, `admin_set_phone`,
`admin_update_profile`, `admin_revoke_subscription`, `clear_password_change_flag`.
Edge Function: **`quick-handler`** — admin tomonidan parol tiklash (`RESET_PASSWORD_FN`
konstantasi authService va districtService'da takrorlangan).

Xavfsizlik butunlay RLS va `security definer` funksiyalarda — frontend faqat so'rov
yuboradi, ruxsatni server tekshiradi.

### Standart soatlar (superadmin)

Superadmin "Standart soatlar" sahifasida ([StandardHours.jsx](src/pages/StandardHours.jsx))
qaysi sinfda qaysi fan necha soat bo'lishini belgilaydi. Ma'lumot `standard_hours`
jadvalida bitta JSONB qatorda (`id = global`) yotadi va HAMMA foydalanuvchiga o'qish
uchun ochiq (yozish — faqat superadmin, RLS `is_admin()`).
[standardHoursService.js](src/services/standardHoursService.js) uni localStorage'ga
keshlaydi; bulut ochilmasa kesh, u ham bo'lmasa [curriculum.js](src/utils/curriculum.js)
dagi `DEFAULT_CURRICULUM` ishlatiladi. "Sinf fanlari" sahifasidagi "⚡ Standart soatlar"
tugmasi shu rejani qo'llaydi (fan nomi `aliases` orqali solishtiriladi).
Jadval SQL i: [standard_hours_setup.sql](standard_hours_setup.sql) — Supabase SQL
Editor'da bir marta ishga tushiriladi.

⚠️ [supabase_setup.sql](supabase_setup.sql) faqat `profiles` + admin RPC larini qamraydi.
Repoda yana ikkita SQL bor: [standard_hours_setup.sql](standard_hours_setup.sql) va
[school_backups_setup.sql](school_backups_setup.sql) (versiya tarixi).
`schools`, `districts`, `district_excel_data` va tuman modulining migratsiyalari repoda
YO'Q — ular faqat Supabase loyihasida yashaydi. Shu jadvallarga ustun qo'shish kerak
bo'lsa, SQL Dashboard'da qo'lda bajariladi.

### Auth va obuna

[authService.js](src/services/authService.js): profil localStorage'da keshlanadi
(`smartjadval_auth_current_user`), shu sababli `getCurrentUser()` va
`checkSubscription()` **sinxron** — sahifalar ularni to'g'ridan-to'g'ri chaqiraveradi.

Kesh eskirishi mumkin: Supabase access token ~1 soatda tugaydi. Shuning uchun har bir
himoyalangan chaqiruvdan oldin `getFreshSession()` ishlatiladi va token `Authorization`
header'ida ANIQ yuboriladi. Yangi admin amali qo'shsangiz — shu naqshni takrorlang.

**Mehmon rejimi (paywall):** obuna tugagan bo'lsa `App.jsx` `<main>` ustida
`onClickCapture`/`onFocusCapture` bilan barcha bosishlarni ushlaydi va `PaywallModal`
ochadi. Qulfdan chiqarish uchun element `data-pw-allow` atributiga ega bo'lishi kerak.

### Excel import/export

`xlsx` (oddiy) va `xlsx-js-style` (rangli) — [excelUtils.js](src/utils/excelUtils.js)
dagi `loadXLSX()` / `loadStyledXLSX()` orqali olinadi (uslubli kutubxona dinamik import,
o'rnatilmagan bo'lsa faqat rangli eksport ishlamaydi).
Eksport modullari: `coloredScheduleExport` (rangli dars jadvali), `hourGridExport`
(soat setkasi), `analysisExport` (tahlil), `districtExcelService` (tuman moduli).

### Deploy

`main` ga push → [deploy.yml](.github/workflows/deploy.yml) → `npm run build` → GitHub
Pages. `CNAME` = `smartjadval.uz`, Vite `base: '/'`. `dist/` git'da kuzatilmaydi.

### Brauzer xotirasi (localStorage kvotasi)

localStorage ~5 MB. Bitta maktabning jadvali + 20 tagacha saqlangan nusxa allaqachon
bir necha MB — shu brauzerda IKKINCHI profil ochilsa kvota to'ladi.

- `saveData()` ([storageService.js](src/services/storageService.js)) **hech qachon xato
  chiqarmaydi** — `true`/`false` qaytaradi. Sabab: u App.jsx dagi `useEffect` ichidan
  chaqiriladi, xato chiqarsa React BUTUN DARAXTNI yechib tashlaydi va ekran **oppoq**
  bo'lib qoladi. Yangi saqlash yo'li qo'shsangiz — shu funksiyadan foydalaning,
  `localStorage.setItem` ni to'g'ridan-to'g'ri chaqirmang.
- Kvota to'lganda joy bosqichma-bosqich bo'shatiladi: eski `edujadval_` kalitlari →
  boshqa profillarning konflikt zaxiralari → boshqa profillarning butun keshi →
  (oxirgi chora) majburiy tozalash. Har bosqichdan keyin yozish qayta sinaladi.
- **Kirishda boshqa profillarning keshi tozalanadi** (`purgeOtherUsers`, App.jsx).
  Bulut yagona haqiqat manbai, shuning uchun xavfsiz. Bulutga yuborilmagan
  o'zgarishi bor profil (`sync_meta_<id>.dirty`) yoki meta'si umuman yo'q profil
  tozalanmaydi.
- Yozib bo'lmasa `onStorageError` ishga tushadi — App.jsx ogohlantirish ko'rsatadi.
- [ErrorBoundary.jsx](src/components/ErrorBoundary.jsx) butun ilovani o'raydi
  ([main.jsx](src/main.jsx)) — endi har qanday xato oq ekran emas, tushunarli
  xabar va "keshni tozalab qayta yuklash" tugmasi beradi.

## Bilib qo'yish kerak bo'lgan tuzoqlar

- **Uslublar aralash:** `src/styles/*.css` global fayllar bor, lekin JSX ichida ham ko'p
  inline style. Mavjud faylning uslubiga ergashing, birini ikkinchisiga ko'chirmang.
- **O'lik kod:** [deviceLock.js](src/services/deviceLock.js) va
  [DeviceLockNotice.jsx](src/components/DeviceLockNotice.jsx) hech qayerdan import
  qilinmaydi — qurilma cheklovi olib tashlangan. Ularga qarab xulosa chiqarmang.
- **Ildizdagi `README_*.md` fayllari** — eski versiya eslatmalari (port 5173, demo
  parollari va h.k. eskirgan). Haqiqat manbai — kod va shu fayl.
- Fayllar katta (`scheduleGenerator.js` 3.7k qator, `Schedule.jsx` ~2k). Tahrirlashdan
  oldin kerakli bo'limni grep bilan toping, butun faylni qayta yozmang.
