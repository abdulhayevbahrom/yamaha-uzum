# UzumBank PUBG API

API base URL:

```text
https://uzum.example.uz/api
```

Har bir so'rov `Authorization: Basic base64(login:password)` headeri bilan keladi.

## Catalog

`POST /uzum/pubg/catalog`

```json
{
  "serviceId": 7814652
}
```

Faqat Telegram admin botda aktiv qilingan, narxi 0 dan katta va GW'da mavjud
paketlar qaytadi.

```json
{
  "serviceId": 7814652,
  "timestamp": 1724300000000,
  "status": "OK",
  "data": {
    "game": { "value": "PUBG UC" },
    "plans": [
      { "code": "60", "label": "60 UC", "price": 13000 }
    ]
  }
}
```

## Check

`POST /uzum/pubg/check`

```json
{
  "serviceId": 7814652,
  "params": {
    "player_id": "512345678",
    "code": "60"
  }
}
```

Muvaffaqiyatli javobda GW'dan olingan `profile_name` qaytadi.

## Create

`POST /uzum/pubg/create`

```json
{
  "serviceId": 7814652,
  "transId": "UZM-PUBG-0001",
  "price_amount": 1300000,
  "params": {
    "player_id": "512345678",
    "code": "60"
  }
}
```

`price_amount` tiyinda keladi. `13000 UZS` uchun qiymat `1300000` bo'ladi.
Create faqat order yaratadi va UC sotib olmaydi.

## Confirm

`POST /uzum/pubg/confirm`

```json
{
  "serviceId": 7814652,
  "transId": "UZM-PUBG-0001"
}
```

Sotuv faqat confirmda bajariladi. Bir xil `transId` qayta yuborilsa MongoDB lock
va o'zgarmaydigan GW idempotency key sababli ikkinchi sotuv bajarilmaydi.
`confirmTime` GW sotuv muvaffaqiyatli yakunlangan vaqtdir.

## Status

`POST /uzum/pubg/status`

`transTime` created vaqt, `confirmTime` esa GW sotuv yakunlangan vaqt.

## Error kodlar

| Error code | HTTP | Ma'nosi |
| --- | ---: | --- |
| `10001` | `400` | Auth xato |
| `10005` | `400` | Majburiy parametr yo'q |
| `10006` | `400` | Service ID noto'g'ri |
| `10007` | `400` | Player yoki paket topilmadi |
| `10008` | `400` | Dublikat tranzaksiya |
| `10009` | `400` | Order yaratilmadi |
| `10011` | `400` | Narx mos emas |
| `10014` | `400` | Tranzaksiya topilmadi yoki tasdiqlanmagan |
| `10015` | `400` | Sotuv muvaffaqiyatli yakunlanmadi |
| `99999` | `500` | Ichki server xatosi |

Muvaffaqiyatli javoblar `HTTP 200` bilan qaytadi.
