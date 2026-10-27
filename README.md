# Duffy Review

เว็บรีวิวเกม — **frontend** (HTML/CSS/JS) deploy บน Vercel, **backend** (Node.js + Express) deploy บน Render

```
frontend/   หน้าเว็บ (index.html, config.js, vercel.json)
backend/    REST API (server.js, data/games.json)
render.yaml ตั้งค่า Render
```

## API
| Endpoint | ใช้ทำอะไร |
|---|---|
| `GET /api/games?q=&cat=&age=&sort=` | ค้นหา/กรอง (`sort` = new, pop, score) |
| `GET /api/games/:id` | รายละเอียดเกม |
| `GET /api/top` | Top 10 คะแนนสูงสุด |
| `GET /api/health` | เช็กสถานะ |

## รันในเครื่อง
```bash
cd backend && npm install && npm run dev      # http://localhost:3000
cd frontend && npx serve .                     # เปิดหน้าเว็บ (config.js จะชี้ localhost:3000 อัตโนมัติ)
```

## Deploy
1. **Push ขึ้น GitHub** ทั้งโฟลเดอร์นี้เป็น repo เดียว
2. **Render (backend)**: New → Web Service → เลือก repo → ตั้ง Root Directory = `backend`, Build = `npm install`, Start = `npm start` (หรือใช้ Blueprint จาก `render.yaml`) → ได้ URL เช่น `https://duffy-review-api.onrender.com`
3. **แก้ `frontend/config.js`** ใส่ URL ของ Render แล้ว commit/push
4. **Vercel (frontend)**: Add New Project → เลือก repo → ตั้ง Root Directory = `frontend`, Framework = Other (ไม่ต้อง build) → Deploy
5. **CORS**: กลับไป Render → Environment ใส่ `CORS_ORIGIN` = โดเมน Vercel เช่น `https://duffy-review.vercel.app` แล้ว redeploy

> แพ็กเกจฟรีของ Render จะหลับเมื่อไม่มีคนใช้ การเปิดเว็บครั้งแรกอาจรอประมาณ 30–50 วินาที

## เปลี่ยนข้อมูลรีวิว
แก้ไฟล์ `backend/data/games.json` (ตอนนี้เป็นข้อมูลตัวอย่าง) ภายหลังเปลี่ยนไปใช้ฐานข้อมูลจริงได้ เช่น PostgreSQL บน Render
