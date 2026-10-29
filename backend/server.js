const express = require("express");
const cors = require("cors");
const store = require("./store");

const app = express();
const PORT = process.env.PORT || 3000;
const state = store.state;
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

// CORS_ORIGIN = โดเมน Vercel ของคุณ (คั่นหลายค่าด้วยจุลภาค) ถ้าไม่ตั้งจะอนุญาตทุกโดเมน
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes("*") ? true : origins }));

const CATEGORIES = ["แอคชัน", "RPG", "ผจญภัย", "แข่งรถ", "จำลอง", "ต่อสู้"];
const AGES = [3, 7, 12, 16, 18];
const VIEW_COOLDOWN = (Number(process.env.VIEW_COOLDOWN_SEC) || 60) * 1000;

const viewsOf = (g) => (g.views || 0) + (state.views[g.id] || 0);
function stats(id) {
  const c = state.comments.filter((x) => x.gameId === id);
  const r = c.filter((x) => x.rating);
  return {
    commentCount: c.length,
    readerVotes: r.length,
    readerRating: r.length ? +(r.reduce((s, x) => s + x.rating, 0) / r.length).toFixed(1) : null,
  };
}
const decorate = (g) => ({ ...g, views: viewsOf(g), ...stats(g.id) });

// จำกัดการส่งคอมเมนต์ และกันนับวิวซ้ำจากคนเดิมในเวลาสั้นๆ
const hits = new Map();
const vhits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of hits) if (!a.some((t) => now - t < 60000)) hits.delete(k);
  for (const [k, t] of vhits) if (now - t > VIEW_COOLDOWN) vhits.delete(k);
}, 600000).unref();

function limiter(req, res, next) {
  const now = Date.now();
  const a = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (a.length >= 5) return res.status(429).json({ error: "ส่งถี่เกินไป กรุณารอสักครู่" });
  a.push(now); hits.set(req.ip, a); next();
}

app.get("/", (_, res) => res.json({ name: "Duffy Review API", ok: true }));
app.get("/api/health", (_, res) => res.json({ status: "ok" }));
app.get("/api/meta", (_, res) => res.json({ categories: CATEGORIES, ages: AGES, sorts: ["new", "pop", "score"] }));

app.get("/api/games", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const cat = String(req.query.cat || "");
  const age = Number(req.query.age);
  const sort = String(req.query.sort || "new");
  const items = state.games.filter((g) =>
    (!cat || cat === "ทั้งหมด" || g.category === cat) &&
    (!age || g.age === age) &&
    (!q || `${g.title} ${g.category} ${g.desc} ${g.platforms}`.toLowerCase().includes(q))
  ).map(decorate);
  const by = {
    pop: (a, b) => b.views - a.views || b.score - a.score,
    score: (a, b) => b.score - a.score,
    new: (a, b) => b.date.localeCompare(a.date),
  };
  items.sort(by[sort] || by.new);
  res.json({ total: items.length, items });
});

app.get("/api/top", (_, res) => res.json([...state.games].sort((a, b) => b.score - a.score).slice(0, 10).map(decorate)));

app.get("/api/games/:id", (req, res) => {
  const g = state.games.find((x) => x.id === Number(req.params.id));
  g ? res.json(decorate(g)) : res.status(404).json({ error: "ไม่พบเกมนี้" });
});

// นับยอดเข้าชม: เรียกทุกครั้งที่มีคนเปิดหน้ารีวิว (คนเดิม+เกมเดิม ภายใน VIEW_COOLDOWN_SEC วินาที นับครั้งเดียว)
app.post("/api/games/:id/view", (req, res) => {
  const id = Number(req.params.id);
  const g = state.games.find((x) => x.id === id);
  if (!g) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const key = `${req.ip}:${id}`, now = Date.now();
  const counted = !(vhits.get(key) > now - VIEW_COOLDOWN);
  if (counted) {
    vhits.set(key, now);
    state.views[id] = (state.views[id] || 0) + 1;
    store.persistView(id);
  }
  res.json({ views: viewsOf(g), counted });
});

app.get("/api/games/:id/comments", (req, res) => {
  const id = Number(req.params.id);
  res.json(state.comments.filter((c) => c.gameId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100));
});

app.post("/api/games/:id/comments", limiter, (req, res) => {
  const id = Number(req.params.id);
  if (!state.games.some((g) => g.id === id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const text = String(b.text || "").trim();
  const rating = b.rating ? Number(b.rating) : null;
  if (name.length < 1 || name.length > 30) return res.status(400).json({ error: "กรุณาใส่ชื่อ (ไม่เกิน 30 ตัวอักษร)" });
  if (text.length < 2 || text.length > 500) return res.status(400).json({ error: "ความคิดเห็นต้องยาว 2–500 ตัวอักษร" });
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return res.status(400).json({ error: "คะแนนต้องเป็น 1–5" });
  const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), gameId: id, name, text, rating, date: new Date().toISOString() };
  state.comments.push(c);
  store.persistComment(c);
  res.status(201).json(c);
});

app.delete("/api/comments/:cid", (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.get("x-admin-token") !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const n = state.comments.length;
  state.comments = state.comments.filter((c) => c.id !== req.params.cid);
  store.persistDelete(req.params.cid);
  res.json({ deleted: n - state.comments.length });
});

store.init()
  .then(() => { setInterval(() => store.refreshGames().catch((e) => console.error("refresh failed:", e.message)), 60000).unref(); return app.listen(PORT, () => console.log(`Duffy Review API running on port ${PORT}`)); })
  .catch((e) => { console.error("startup failed:", e.message); process.exit(1); });
