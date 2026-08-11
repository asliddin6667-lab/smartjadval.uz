# smartjadval — TO'LIQ O'RNATISH QO'LLANMASI

Bu zip ichida BARCHA o'zgarishlar jamlangan:
- Domen sozlamalari (base '/', CNAME, SEO)
- Supabase migratsiyasi (hisoblar + obuna serverda)
- Tahrirlash funksiyasi (Foydalanuvchilar sahifasida)

## O'RNATISH TARTIBI (qat'iy shu ketma-ketlikda!)

### 1. Supabase sozlash (push qilishdan OLDIN)
1. supabase.com -> loyihangiz -> SQL Editor
2. `supabase_setup.sql` faylini to'liq nusxalab -> Run ("Success" chiqishi kerak)
3. Authentication -> Sign In / Providers -> Email:
   - "Confirm email" ni O'CHIRING
   - "Secure email change" ni O'CHIRING

### 2. Kod
1. Eski loyiha papkasini shu bilan almashtiring
2. PowerShell: npm.cmd install
3. Lokal tekshirish: npm.cmd run dev + Ctrl+Shift+R

### 3. Superadmin ochish
1. Saytda yangi hisob oching (o'z emailingiz + kuchli parol)
2. Supabase SQL Editor'da (emailni moslang):

   update public.profiles set role = 'superadmin', sub_status = 'active'
   where email = 'sizning@emailingiz.uz';

3. Saytdan chiqib, qayta kiring

### 4. Demo hisob
1. Saytda demo@smartjadval.uz bilan ro'yxatdan o'ting
2. SQL:

   update public.profiles set sub_status = 'active', sub_expires_at = null
   where email = 'demo@smartjadval.uz';

### 5. Sinov
- Incognito'da test-mijoz oching
- O'z brauzeringizda: Foydalanuvchilar -> unga +6 oy
- Incognito'da: "Tekshirish" tugmasi -> ochilishi kerak
- Ishlasa -> git push

## ESLATMALAR
- Eski lokal hisoblar ishlamaydi — hamma qaytadan ro'yxatdan o'tadi
- Mijoz parol unutsa: hisobini o'chirib, xuddi shu email bilan qayta yarating
- supabase_setup.sql faqat Supabase'da ishlatiladi, saytga deploy bo'lmaydi (zarari yo'q)
