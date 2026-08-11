# smartjadval v1.13 — Chiroyli rangli dars jadvali

Qo'shildi:

- Dars jadvali rasmga o'xshash zamonaviy dizaynga o'tkazildi.
- Har bir fan o'z rangida ko'rinadi.
- Sinflar kesimida jadval: 1-A, 1-B, 1-C ... ketma-ket chiqadi.
- Guruhli va daraja guruhlari bitta katak ichida chiroyli ko'rinadi.
- Parallel darslarda qaysi sinflar birga ekanligi chiqadi.
- Excel yuklashda ham fanlar rangli chiqadi.
- PDF/print uchun qulay ko'rinish qo'shildi.
- Avtomatik jadval va Tozalash tugmalari saqlandi.

Ishga tushirish:

```cmd
npm install
npm.cmd run dev
```

Agar eski ma'lumot localStorage'da qolgan bo'lsa, Console'da:

```js
localStorage.removeItem("smartjadval_auth_current_user");
location.reload();
```
