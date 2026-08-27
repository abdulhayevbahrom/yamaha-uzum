# Yamaha Uzum PUBG

UzumBank PUBG UC integratsiyasi uchun Yamaha mini appdan mustaqil Node.js servis.

Talab: Node.js `18` yoki undan yangi versiya.

## Tarkib

- Uzum endpointlari: `catalog`, `check`, `create`, `confirm`, `status`
- Alohida MongoDB paketlari va tranzaksiyalari
- GW PUBG katalog sinxronizatsiyasi va player verify
- Atomik lock hamda bir xil GW idempotency key bilan xavfsiz auto-fulfillment
- Telegram admin bot orqali narx va aktivlik boshqaruvi
- Eski Yamaha bazasidan paket va Uzum orderlarini ko'chirish skripti

## O'rnatish

```bash
npm install
cp .env.example .env
```

`.env` ichida kamida quyidagilarni to'ldiring:

```env
MONGO_URI=mongodb://127.0.0.1:27017/yamaha_uzum
SOURCE_MONGO_URI=mongodb://127.0.0.1:27017/yamaha
UZUM_PUBG_SERVICE_IDS=7814652
UZUM_PUBG_LOGIN=...
UZUM_PUBG_PASSWORD=...
GW_API_KEY=...
UZUM_ADMIN_BOT_TOKEN=...
UZUM_ADMIN_TG_IDS=123456789,987654321
```

`MONGO_URI` Yamaha mini app bazasidan alohida bo'lishi shart. `SOURCE_MONGO_URI`
faqat bir martalik migratsiya uchun ishlatiladi.

## Ko'chirish tartibi

Yangi servisni productionda ishga tushirishdan oldin:

```bash
npm run migrate:yamaha
npm run preflight
```

Migratsiya:

- Yamaha bazasidagi `UzumPubgPlan` narxi va aktivligini ko'chiradi
- mavjud Uzum orderlarini, jumladan yakunlangan va jarayondagi orderlarni ko'chiradi
- qayta bajarilganda bot orqali keyin o'zgartirilgan sozlamalarni ustidan yozmaydi

## Ishga tushirish

```bash
npm start
```

PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Telegram polling sababli PM2 `instances: 1` bo'lishi kerak.

## Reverse proxy

UzumBankdagi mavjud URL o'zgarmasligi uchun eski Yamaha domenida faqat Uzum
pathini yangi processga yo'naltirish mumkin:

```nginx
location /api/uzum/pubg/ {
    proxy_pass http://127.0.0.1:4100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Yoki alohida domen ishlatilsa API bazasi:

```text
https://uzum.example.uz/api
```

## Xavfsiz deploy

1. Yangi MongoDB va `.env`ni tayyorlang.
2. `npm run migrate:yamaha`ni bajaring.
3. `GW_PUBG_AUTOBUY_ENABLED=false` holatida servis va botni ishga tushiring.
4. Botdagi `GW katalogni yangilash` tugmasini bosing va paketlarni tekshiring.
5. Reverse proxy orqali health va catalogni tekshiring.
6. Eski Yamaha Uzum pathini yangi servisga o'tkazing.
7. `npm run migrate:yamaha`ni yana bir marta bajarib, almashish oralig'idagi orderlarni sinxronlang.
8. Faqat shundan keyin Yamaha backenddagi eski Uzum routelari olib tashlangan versiyani deploy qiling.
9. `GW_PUBG_AUTOBUY_ENABLED=true` qilib yangi processni restart qiling.

`SOURCE_MONGO_URI` ikkinchi migratsiyadan keyin production `.env`dan olib tashlanishi mumkin.

`/create` UC sotib olmaydi. Sotuv faqat `/confirm`da boshlanadi.
