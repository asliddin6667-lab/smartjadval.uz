# Smartjadval → eMaktab: jadvalni ko'chirish qo'llanmasi

Smartjadval.uz da tuzilgan dars jadvalini eMaktab (kundalik.com) ga qo'lda
qayta terib chiqmaslik uchun.

---

## Nega bitta tugma yo'q?

eMaktab — alohida sayt, o'z parolingiz bilan ochiladi. Smartjadval u yerga
sizning nomingizdan yoza olmaydi (brauzer xavfsizlik qoidasi buni taqiqlaydi).

Shuning uchun ko'chirish **sizning brauzeringizda**, eMaktab sahifasining
o'zida bajariladi: Smartjadval kichik yordamchi dastur (ko'prik) beradi, siz
uni eMaktab sahifasiga qo'yasiz — u setkani to'ldiradi.

---

## Tayyorgarlik

1. Smartjadval'da jadval **tuzilgan** bo'lsin (`Dars jadvali` bo'limi, yashil
   «Barcha fan soatlari to'liq joylashtirildi» yozuvi chiqqan bo'lsa yaxshi).
2. eMaktab'da o'sha sinf uchun **fanlar va ustozlar biriktirilgan** bo'lsin —
   ko'prik faqat eMaktab ro'yxatida BOR fanni tanlay oladi, yangisini yarata olmaydi.
3. eMaktab'da sinf ochilib, **chorak sxemasi** tayyorlangan bo'lsin:
   `Dars jadvali → sinfni tanlang → Darslarni ishlab chiqish (yaratish) →
   Darslar jadvalining yangi sxemasi → nom bering (masalan «1 chorak»)`.

---

## Birinchi marta: «O'rganish»

Bu qadam bir marta bajariladi va ko'chirishni ancha aniq qiladi.

1. eMaktab'da chorak sxemasi setkasini oching (qatorlar 1…9, ustunlar Dush…Yak).
2. `F12` → **Console** bo'limini oching.
3. Smartjadval → **eMaktab** bo'limi → **«⚡ Hammasi birga»** tugmasi.
4. Console'ga qo'ying (`Ctrl+V`) va `Enter`.
5. O'ng pastda **SJ** tugmasi chiqadi — bosing.
6. **«⏺ Yozishni boshlash»** → setkada **bitta darsni qo'lda qo'shing**
   (odatdagidek: katakdagi «+», fan va ustozni tanlab, saqlash).
7. **«⏹ To'xtatish va nusxalash»** — natija nusxalanadi.
8. O'sha matnni dasturchiga yuboring.

> Bu qadam hech narsani buzmaydi: siz bitta darsni odatdagidek qo'shasiz, dastur
> faqat kuzatib turadi.

---

## Ko'chirish

1. Smartjadval → **eMaktab** bo'limi.
2. Sinflarni belgilang (darsi borlari avtomatik belgilangan bo'ladi).
3. Chorakni tanlang.
4. **«⚡ Hammasi birga»** — nusxa olinadi.
5. eMaktab'da o'sha sinfning chorak sxemasini oching.
6. `F12` → **Console** → qo'ying → `Enter`.
7. Chiqqan panelda:
   - sinfni tanlang;
   - avval **«🧪 Sinov»** — bitta darsni sinab ko'radi va **saqlamaydi**;
   - hammasi joyida bo'lsa **«▶ Joylashtirish»**.
8. Setka to'lgach **«Nashr etish»** ni **o'zingiz** bosasiz.

> ⚠️ Dastur «Nashr etish» ni hech qachon o'zi bosmaydi. Nashr haqiqiy
> jurnallarga tegadi — uni siz ko'zdan kechirib bosasiz.

---

## Har safar Console ochgingiz kelmasa — Tampermonkey

Ko'prik bir marta o'rnatiladi, keyin eMaktab'ning «Dars jadvali» sahifalarida
o'ng pastda **SJ** tugmasi o'zi turadi. Yangilanishlar ham avtomatik keladi.
Smartjadval'dagi «eMaktab» sahifasida **«🧩 Tampermonkey orqali»** usulini
tanlasangiz hamma qadam o'sha yerda ko'rsatib turiladi.

**1. Tampermonkey kengaytmasini o'rnating** (bepul, ro'yxatdan o'tish shart emas):

| Brauzer | Qayerdan |
|---|---|
| Chrome, Yandex, Opera | Chrome Web Store → «Tampermonkey» → *Add to Chrome* |
| Edge | Microsoft Edge Add-ons → «Tampermonkey» → *Get* |
| Firefox | Firefox Add-ons → «Tampermonkey» → *Add to Firefox* |

⚠️ Chrome, Edge va Yandex'da qo'shimcha bitta qadam bor: `chrome://extensions`
sahifasida o'ng yuqoridagi **«Dasturchi rejimi» (Developer mode)** ni yoqing.
Yoqilmasa Tampermonkey skriptlarni umuman ishga tushirmaydi va SJ tugmasi chiqmaydi.

**2. Ko'prik skriptini o'rnating.** Smartjadval → eMaktab → «Tayyorgarlik»
kartasidagi **«🧩 Skriptni o'rnatish»** tugmasini bosing. Tampermonkey
o'rnatish oynasini ochadi — **Install** ni bosing.
Oyna o'rniga oddiy matn ochilsa — 1-qadam bajarilmagan. Zaxira yo'l:
**«💾 Faylini yuklab olish»** → Tampermonkey → Boshqaruv paneli → *Utilities* →
*Import from file* → yuklab olingan `emaktab-bridge.user.js`.

**3. Tekshiring.** eMaktab'da istalgan sinfning chorak sxemasini oching —
o'ng pastda **SJ** chiqishi kerak. Tampermonkey belgisini bosganda
«Smartjadval → eMaktab ko'prigi» yashil (yoqiq) turadi.

**Keyin har safar:** Smartjadval'da sinflarni belgilab **«💾 Jadvalni yuklab
olish»** → eMaktab'da **SJ** → **«📂 Fayldan»** → sinfni tanlab **«▶ Shu
sinfga»** yoki **«🚀 Hamma sinfga joylashtirish»**. Fayl brauzerda eslab
qolinadi — 40 sinf uchun ham bir marta tanlash yetadi.

**SJ chiqmasa:** Tampermonkey va skript ikkalasi yoqiqmi → Dasturchi rejimi
yoqiqmi → siz «Dars jadvali» bo'limidamisiz (tugma jurnal/hisobotlarda ataylab
chiqmaydi) → sahifani yangilang.

---

## Nomlar mos kelmasa

Ikki platformada nomlar har xil yozilishi mumkin — dastur buni o'zi hisobga oladi:

| Smartjadval | eMaktab | Natija |
|---|---|---|
| `3-B` | `3-Б`, `3 б` | mos keladi |
| `Rus tili` | `Русский язык` | mos keladi |
| `Munavvarov A.M.` | `Munavvarov Akmal Murodovich` | mos keladi |

Agar mos kelmasa — panel jurnalida `✖ … mos nom topilmadi` deb yoziladi va
o'sha dars **tashlab ketiladi** (noto'g'ri fan qo'yilmaydi).

Bunday nomlarni paneldagi **«🔤 Nom mosligi»** bo'limida bir marta ko'rsatib
qo'yish mumkin — har qatorda bittadan:

```
Rus tili = Русский язык
Munavvarov A.M. = Munavvarov Akmal Murodovich
```

**«💾 Saqlash»** bosilsa, ro'yxat shu brauzerda qoladi va keyingi safar ham
ishlaydi.

---

## Tez-tez uchraydigan savollar

**Setka topilmadi, deyapti.**
Siz sxema setkasi ochiq sahifada emassiz. `Darslarni ishlab chiqish (yaratish)`
ichidagi chorak nomini bosib, qatorlari 1…9 bo'lgan setkani oching.

**Ba'zi darslar tushmadi.**
Panel jurnalida har bir dars uchun sabab yozilgan. Ko'p uchraydigani: o'sha fan
yoki ustoz eMaktab'da bu sinfga biriktirilmagan.

**Ikki marta bossam, dars ikkilanadimi?**
Ha. Ko'prik mavjud darsni tekshirmaydi — qayta yuborishdan oldin setkani
eMaktab'ning o'z **«Tozalash»** tugmasi bilan bo'shating.

**2-smena sinflari.**
«Soat raqami» sozlamasini tekshiring: `Smena ichida` (2-smena ham 1-dan
boshlanadi) yoki `Maktab bo'ylab uzluksiz` (7, 8, 9…). eMaktab setkangizdagi
qator raqamlari qanday bo'lsa — shuni tanlang.
