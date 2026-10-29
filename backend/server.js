const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const games = require("./data/games.json");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1); // ให้ req.ip ถูกต้องหลัง proxy ของ Render
app.use(express.json({ limit: "10kb" }));

// CORS_ORIGIN = โดเมน Vercel ของคุณ (คั่นหลายค่าด้วยจุลภาค) ถ้าไม่ตั้งจะอนุญาตทุกโดเมน
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes("*") ? true : origins }));

const CATEGORIES = ["แอคชัน", "RPG", "ผจญภัย", "แข่งรถ", "จำลอง", "ต่อสู้", "สยองขวัญ"];
const AGES = [3, 7, 12, 16, 18];

// ---------- ความคิดเห็น (เก็บในไฟล์ JSON) ----------
// หมายเหตุ: Render แพ็กเกจฟรีมี disk ชั่วคราว ข้อมูลจะหายเมื่อ deploy ใหม่/รีสตาร์ต
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const CFILE = path.join(DATA_DIR, "comments.json");
let comments = [];
try { comments = JSON.parse(fs.readFileSync(CFILE, "utf8")); } catch (_) {}
const save = () => { try { fs.writeFileSync(CFILE, JSON.stringify(comments)); } catch (e) { console.error("save failed", e.message); } };

function stats(id) {
  const c = comments.filter((x) => x.gameId === id);
  const r = c.filter((x) => x.rating);
  return {
    commentCount: c.length,
    readerVotes: r.length,
    readerRating: r.length ? +(r.reduce((s, x) => s + x.rating, 0) / r.length).toFixed(1) : null,
  };
}
const decorate = (g) => ({ ...g, ...stats(g.id) });

const hits = new Map();
function limiter(req, res, next) {
  const now = Date.now();
  const a = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (a.length >= 5) return res.status(429).json({ error: "ส่งถี่เกินไป กรุณารอสักครู่" });
  a.push(now); hits.set(req.ip, a); next();
}

// ---------- routes ----------
app.get("/", (_, res) => res.json({ name: "Duffy Review API", ok: true }));
app.get("/api/health", (_, res) => res.json({ status: "ok" }));
app.get("/api/meta", (_, res) => res.json({ categories: CATEGORIES, ages: AGES, sorts: ["new", "pop", "score"] }));

app.get("/api/games", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const cat = String(req.query.cat || "");
  const age = Number(req.query.age);
  const sort = String(req.query.sort || "new");
  let items = games.filter((g) =>
    (!cat || cat === "ทั้งหมด" || g.category === cat) &&
    (!age || g.age === age) &&
    (!q || `${g.title} ${g.category} ${g.desc} ${g.platforms}`.toLowerCase().includes(q))
  ).map(decorate);
  const by = {
    pop: (a, b) => b.views - a.views,
    score: (a, b) => b.score - a.score,
    new: (a, b) => b.date.localeCompare(a.date),
  };
  items.sort(by[sort] || by.new);
  res.json({ total: items.length, items });
});

app.get("/api/top", (_, res) => res.json([...games].sort((a, b) => b.score - a.score).slice(0, 10).map(decorate)));

app.get("/api/games/:id", (req, res) => {
  const g = games.find((x) => x.id === Number(req.params.id));
  g ? res.json(decorate(g)) : res.status(404).json({ error: "ไม่พบเกมนี้" });
});

app.get("/api/games/:id/comments", (req, res) => {
  const id = Number(req.params.id);
  res.json(comments.filter((c) => c.gameId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100));
});

app.post("/api/games/:id/comments", limiter, (req, res) => {
  const id = Number(req.params.id);
  if (!games.some((g) => g.id === id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const name = String((req.body || {}).name || "").trim();
  const text = String((req.body || {}).text || "").trim();
  const rating = (req.body || {}).rating ? Number(req.body.rating) : null;
  if (name.length < 1 || name.length > 30) return res.status(400).json({ error: "กรุณาใส่ชื่อ (ไม่เกิน 30 ตัวอักษร)" });
  if (text.length < 2 || text.length > 500) return res.status(400).json({ error: "ความคิดเห็นต้องยาว 2–500 ตัวอักษร" });
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return res.status(400).json({ error: "คะแนนต้องเป็น 1–5" });
  const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), gameId: id, name, text, rating, date: new Date().toISOString() };
  comments.push(c); save();
  res.status(201).json(c);
});

// ลบความคิดเห็น (ต้องตั้ง ADMIN_TOKEN บน Render): ส่ง header x-admin-token
app.delete("/api/comments/:cid", (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.get("x-admin-token") !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const n = comments.length;
  comments = comments.filter((c) => c.id !== req.params.cid);
  save();
  res.json({ deleted: n - comments.length });
});

app.listen(PORT, () => console.log(`Duffy Review API running on port ${PORT}`));
