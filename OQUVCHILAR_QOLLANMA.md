# Turon → eMaktab: o'quvchilar ro'yxatini moslashtirish

Turon bazasidagi o'quvchilar eMaktab (kundalik.com) ga avtomatik qo'shiladi,
Turonda yo'q bola eMaktabdan chiqariladi, sinfi o'zgargani ko'chiriladi.

Skript: `emaktab-oquvchilar.user.js` — dars jadvali ko'prigidan ALOHIDA.
Ikki saytda ishlaydi, har birida o'z **T→E** tugmasi chiqadi:

| Sayt | Sahifa | Vazifasi |
|---|---|---|
| Turon | `turon-odob-ilm.xususiy-maktab.uz/head-office/students` | ro'yxatni yig'ib eMaktabga uzatadi |
| eMaktab | `schools.emaktab.uz/v2/admin/persons/default?…&group=students` | solishtiradi va bajaradi |

---

## O'rnatish

1. Brauzerga Tampermonkey kengaytmasini o'rnating.
2. `https://smartjadval.uz/emaktab-oquvchilar.user.js` ni oching → «O'rnatish».
3. Turon «O'quvchilar» sahifasini oching — o'ng pastda **T→E** chiqadi.
   eMaktab «Odamlarni izlash» sahifasida ham shu tugma chiqadi.

Tampermonkeysiz (F12 → Console): ro'yxat saytlar orasida o'zi o'tmaydi —
Turon panelida «💾 JSON fayl» yuklab olinadi, eMaktab panelida «📂 Fayldan» ochiladi.

---

## Sinf nomi qoidasi

| Turon | Filial | eMaktab |
|---|---|---|
| 4-A | Furqat | `4 A` |
| 4-A | Oltiariq | `4 A O` |
| 4-A | Qo'qon | `4 A Q` |
| 4-A | Yaypan | `4 A Y` |

Harflar panelning 2-bo'limida o'zgartiriladi.

**Yo'nalish nomlari sinf emas.** «8-Ijtimoiy», «Ijtimoiy1», «Aniq 1»
(yonida «8-sinf» / «10-sinf») uchun faqat raqam olinadi: bola shu filialdagi
8-sinflardan biriga («8 A», «8 B» yoki Qo'qonda «8 A Q», «8 B Q») tushadi.
Agar u eMaktabda allaqachon shu raqamli sinfda tursa — tegilmaydi. Yangi bola
eng kam o'quvchili sinfga qo'shiladi. Solishtirishdan keyin jurnalda
«🏫 Sinf mosligi» jadvali chiqadi — har Turon sinfi qaysi eMaktab sinfiga
tushishini shu yerda tekshiring.

**Boshqa filial sinfiga tushirilmaydi.** Qo'qonning «4-A» si faqat «4 A Q» ga
qo'shiladi. eMaktabda «4 A Q» hali ochilmagan bo'lsa bola kutadi (jurnalda
«sinf ochilgach qo'shiladi» deb chiqadi) va «4 A» (Furqat) ga QO'SHILMAYDI.
Sinf ochilgach «🚀» ni yana bosasiz — faqat kutayotganlar qo'shiladi,
avval qo'shilganlar takrorlanmaydi.

**Qabul sanasi.** Qo'shish va ko'chirishda sana maydoniga shu oyning
1-sanasi yoziladi (masalan 01.09.2026) — bola oy boshidan jurnalga tushadi.

**Qo'shish qanday bo'ladi.** eMaktabning «Yangi shaxsni yaratish» ustasi:
«Yangi odam» → asosiy forma (o'quvchi, 2026/2027, sinf, qabul sanasi oy
boshi, buyruq №1 «Boshqa buyruq», F.I.O, tug'ilgan sana, jins) → tasdiq
«Yaratish». Natija — bola sahifasi «Yangi shaxs yaratildi». PINFL
so'ralmaydi.

**Ko'chirish qanday bo'ladi.** eMaktabning o'z «O'quvchini ko'chirish
masteri» ishlatiladi (shaxs sahifasi → Ko'chirish): yangi sinf, tur
«Haqiqiy», a'zolik sanasi oy boshi, «Keyingi qadam», so'ng «Tasdiqlash».
Bola eski sinfda «Sinfda bo'lganlar» ro'yxatiga o'tadi, yangi sinfda
«Hozir sinfda» ga tushadi.

Aniq bir sinfga majburlash kerak bo'lsa «Sinf mosligi» ga qo'lda yoziladi:

```
8-Ijtimoiy | Furqat = 8 B
Aniq 1 | Qo'qon = 10 A Q
```

---

## Sinflar (o'quvchilardan OLDIN)

Panelning «3. Sinflar» bo'limi. «🏫 Sinflarni solishtirish» Turon bo'yicha
qaysi sinflar kerakligini hisoblaydi:

- harfli sinf («4-A» + Qo'qon) → eMaktabda «4 A Q» bo'lishi shart, yo'q
  bo'lsa yaratiladi;
- yo'nalishli guruhlar («8-Ijtimoiy», «Aniq-1», «Tabiiy-2») sinf emas:
  filial + sinf raqami bo'yicha bolalar sanaladi va «sinf sig'imi» (standart
  35) ga bo'linadi. 100 bola → 3 sinf. Mavjud sinflar ayirilib, qolgani
  A, B, V, G, D… harflari bilan yaratiladi: «8 A Q», «8 B Q», «8 V Q».

«➕ Yetishmagan sinflarni yaratish» — SINOV yoqiq bo'lsa faqat forma
ko'rsatiladi (2 tagacha), o'chiq bo'lsa hammasi yaratiladi. Keyin
«🔎 eMaktabni o'qib solishtirish» — bolalar yangi sinflarga taqsimlanadi.
Skript eMaktabning «Boshqaruv → Sinflar» sahifasida ham ishlaydi.

## Eng qisqa yo'l (bir tugma)

1. Turon → O'quvchilar → **T→E** → «🔄 Hamma sahifani o'qish» (yig'ildi = Faol bo'lguncha).
2. eMaktab → Odamlarni izlash → **T→E** → «🚀 HAMMASINI AVTOMATIK».
   Solishtiradi, bitta tasdiq oynasida uchala sonni ko'rsatadi, so'ng
   sinf tartibida (1-sinfdan boshlab, ichida F.I.O bo'yicha) qo'shadi,
   ko'chiradi va oxirida Turonda yo'q bolalarni maktabdan chiqaradi.
   Kutishsiz, chegarasiz, 5 bola bir vaqtda — bir bosishda hammasi
   (2700 amal ≈ 20–30 daqiqa). Jurnal qatorlari aralash keladi, bu normal. Turonga mos sinfi yo'q
   sinflardagi bolalar (masalan «1 I» harfsiz) chiqarilmaydi, jurnal
   ogohlantiradi. Turon ro'yxati to'liq bo'lmasa chiqarish o'tkazib
   yuboriladi.
   Birinchi marta SINOV belgisi yoqiq holda bosing — faqat ko'rsatadi.
   Jurnalda «maydon → qiymat» to'g'ri bo'lsa SINOV ni o'chirib yana bosing.

## Ishlatish (bosqichma-bosqich)

1. **Turon ro'yxati.** Turon → O'quvchilar (filtr «Faol») → **T→E** →
   «🔄 Hamma sahifani o'qish». Panel sahifalarni o'zi varaqlab yig'adi va
   «📤 eMaktabga uzatish» ni o'zi bajaradi. «Yig'ildi» soni Turon «Faol»
   soniga yetganini tekshiring (panelda ko'rsatiladi).
   ⚠️ Turon ro'yxati sahifalarda barqaror tartiblanmagan: bir o'tishda
   hammasi kelmasligi mumkin. Panel buni o'zi bir necha marta qayta o'tadi;
   baribir kam bo'lsa «🔄» ni yana bosing — har o'tish yangilarini qo'shadi.
   Ro'yxat to'liq bo'lmaguncha eMaktab paneli CHIQARISHga ruxsat bermaydi.
   Avtomatik o'qilmasa (jurnalda ogohlantirish) — sahifalarni qo'lda
   varaqlang, har ochilgan sahifa o'zi yig'imga qo'shiladi.
   Zaxira yo'l: Excel'dan nusxa yoki JSON'ni eMaktab panelining 1-bo'limiga
   qo'yish ham ishlaydi (sarlavha qatori bilan).
2. **Solishtirish.** eMaktab → Odamlarni izlash → **T→E**. Jurnalda
   «📡 Ro'yxat Turon sahifasidan keldi» chiqadi.
   «🔎 eMaktabni o'qib solishtirish» — eMaktab ro'yxati
   sahifama-sahifa o'qiladi (1300 o'quvchi ≈ 1 daqiqa). Natija:
   - ＋ qo'shish — Turonda bor, eMaktabda yo'q
   - ➜ ko'chirish — sinfi boshqa
   - － chiqarish — eMaktabda bor, Turonda yo'q
   - ⚠ shubhali — ismi o'xshash juftlik (yozilishi farq qiladi), avtomatik
     bajarilmaydi, qo'lda tekshiriladi
   - ? sinf yo'q — Turon sinfi aniqlanmadi (harf jadvali yoki qo'lda moslik kerak)

   «📄 Hisobot (CSV)» to'liq ro'yxatni Excel'ga beradi.
3. **Sinov.** «SINOV» belgisi yoqiq holda «▶ Bajarish» — hech narsa yuborilmaydi,
   jurnalda har amal uchun «maydon → qiymat» chiqadi. **Birinchi marta shuni
   tekshiring**: familiya/ism/sinf to'g'ri maydonga tushyaptimi.
   Sinovda eMaktab sahifalari faqat dastlabki 3 bola uchun ochiladi (forma
   tekshiriladi), qolganlari uchun faqat yuboriladigan ma'lumot bir qatorda
   chiqadi — 800 bola uchun sahifa ochib yurish shart emas.
   **«■ To'xtatish»** — bosilganda hozir ketayotgan so'rov ham uziladi, keyingi
   bola boshlanmaydi. Solishtirish paytida ham ishlaydi.
4. **Haqiqiy yurish.** SINOV ni o'chiring va «▶ Bajarish» (belgilangan
   amallar) yoki «🚀» (hammasi). Kutish va chegara yo'q. Sessiya tugasa
   skript uni fonda o'zi tiklab davom etadi; tiklanmasa F5 bosib qayta
   kiring — panel oldingi solishtirishni o'zi tiklaydi («♻ Oldingi
   solishtirish tiklandi»), «🚀» qolgan joyidan davom etadi, «🔎» shart emas.
   Panel ochiq turganda skript har 3 daqiqada sessiyani fonda «uyg'otib»
   turadi; baribir «Failed to fetch» chiqsa — eMaktabga login/parol bilan
   qayta kiring (fon tiklash faqat SSO tirik bo'lsa ishlaydi), so'ng «🚀».
5. **Chiqarish** «▶ Bajarish» da alohida belgi bilan yoqiladi, «🚀» da
   o'zi kiradi; ikkalasi tasdiq so'raydi. Ro'yxat to'liq o'qilmagan
   bo'lsa chiqarish o'tkazib yuboriladi.
   Skript bola sahifasidagi «maktabdan chiqarish» havolasini ishlatadi:
   tur «Haqiqiy», chiqish sanasi bugun, buyruq №1, buyruq turi «Ta'lim
   muassasasidan chiqarish to‘g‘risidagi buyruq» (bu formada «Boshqa
   buyruq» yo'q; «bitirish» va «ko'chirish» hech qachon tanlanmaydi),
   chiqish sababi «Boshqa kunduzgi umumiy ta'lim muassasalariga» (ro'yxatda
   «boshqa sabab» bo'lsa o'sha; sabab majburiy), hujjat (attestat)
   maydonlari bo'sh, so'ng «Tasdiqlash». Natija: «Shaxs
   maktabdan muvaffaqiyatli chiqarildi». «Shaxsni o'chirib tashlash»
   (baholari bilan butunlay o'chirish) hech qachon ishlatilmaydi.
   Avval 2 ta amal bilan sinab, bolaning Buyruqlar bo'limini tekshiring.
6. **Rad etilgan bolalar.** eMaktab bolani qabul qilmasa (masalan
   tug'ilgan sanasi 2026 deb kiritilgan, yoki 1-sinf bolasi 31 dekabrda
   7 yoshga to'lmaydi — qonun bo'yicha qabul qilinmaydi) skript uni sabab
   bilan belgilaydi va keyingi yurishlarda qayta yubormaydi. Jurnalda
   «⚠ N bola o'tkazib yuboriladi» ro'yxati, «📄 Hisobot (CSV)» da izoh
   ustunida sababi chiqadi. Turonda sanani to'g'rilab, Turon panelida
   «🔄» ni bosing — yangi ro'yxat kelgach solishtirish qaytadan bo'ladi
   va bola yana uriniladi. 7 yosh qoidasiga tushgan bolani eMaktabda
   qo'lda hal qilasiz.

---

## Forma to'ldirilmasa

eMaktab formalari maydon nomi bo'yicha taxmin bilan to'ldiriladi. Sinovda
«familiya maydoni topilmadi» yoki noto'g'ri moslik chiqsa:

1. «🧾 Yaratish formasi» — forma maydonlari jurnalga chiqadi, «?» bo'lganlari tanilmagan.
2. «⏺ Boshlash» → eMaktabda bitta o'quvchini QO'LDA yarating (yoki sinfini
   o'zgartiring / chiqaring) → «⏹ To'xtatish va saqlash».
3. `oquvchi-dump.json` faylini dasturchiga bering — skript aniq maydonlarga moslanadi.
