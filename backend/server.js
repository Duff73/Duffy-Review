const express = require("express");
const cors = require("cors");
const store = require("./store");
const auth = require("./auth");
const members = require("./members");
// ให้ผู้ที่ไม่ได้เป็นสมาชิกแสดงความคิดเห็นได้ไหม (ค่าเริ่มต้น: ไม่ได้ ต้องสมัครสมาชิกก่อน)
const COMMENT_GUESTS = process.env.COMMENT_GUESTS === "true";

const app = express();
const PORT = process.env.PORT || 3000;
const state = store.state;
app.set("trust proxy", 1);
app.use("/api/admin", express.json({ limit: "200kb" })); // เนื้อรีวิวยาวได้
app.use(express.json({ limit: "10kb" }));

// CORS_ORIGIN = โดเมน Vercel ของคุณ (คั่นหลายค่าด้วยจุลภาค) ถ้าไม่ตั้งจะอนุญาตทุกโดเมน
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes("*") ? true : origins }));

const VIEW_COOLDOWN = (Number(process.env.VIEW_COOLDOWN_SEC) || 60) * 1000;

const viewsOf = (g) => (g.views || 0) + (state.views[g.id] || 0);
// คะแนนรวม = (คะแนนทีมงาน x PRIOR + ดาวผู้อ่านทุกดวง x 2) / (PRIOR + จำนวนผู้โหวต)
// คือนับคะแนนทีมงานเหมือนมีผู้โหวต PRIOR คน (ดาว 1-5 คูณ 2 ให้เป็นสเกล 10) ปรับได้ด้วย SCORE_PRIOR_WEIGHT
const PRIOR = Number(process.env.SCORE_PRIOR_WEIGHT) || 10;
function stats(g) {
  const r = Object.values(state.ratings[g.id] || {});
  const sum = r.reduce((s, x) => s + x, 0);
  return {
    commentCount: state.comments.filter((x) => x.gameId === g.id).length,
    editorScore: g.score,
    readerVotes: r.length,
    readerRating: r.length ? +(sum / r.length).toFixed(1) : null,
    score: +((g.score * PRIOR + sum * 2) / (PRIOR + r.length)).toFixed(1),
  };
}
const decorate = (g) => ({ ...g, views: viewsOf(g), ...stats(g) });

// จำกัดการส่งคอมเมนต์ และกันนับวิวซ้ำจากคนเดิมในเวลาสั้นๆ
const hits = new Map();
const vhits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of hits) if (!a.some((t) => now - t < 60000)) hits.delete(k);
  for (const [k, t] of vhits) if (now - t > VIEW_COOLDOWN) vhits.delete(k);
}, 600000).unref();

const rhits = new Map();
function rlimiter(req, res, next) {
  const now = Date.now();
  const a = (rhits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (a.length >= 20) return res.status(429).json({ error: "โหวตถี่เกินไป กรุณารอสักครู่" });
  a.push(now); rhits.set(req.ip, a); next();
}

function limiter(req, res, next) {
  const now = Date.now();
  const a = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (a.length >= 5) return res.status(429).json({ error: "ส่งถี่เกินไป กรุณารอสักครู่" });
  a.push(now); hits.set(req.ip, a); next();
}

app.get("/", (_, res) => res.json({ name: "Duffy Review API", ok: true }));
app.get("/api/health", (_, res) => res.json({ status: "ok", version: "members-v1", storage: store.kind, games: state.games.length }));
// ยอดวิวรวมของทุกเกม (หน้าเว็บเรียกทุก 10 วินาทีเพื่ออัปเดตตัวเลขสด)
app.get("/api/views", (_, res) => res.json(Object.fromEntries(state.games.map((g) => [g.id, viewsOf(g)]))));
// หมวดหมู่และเรตอายุในเมนู สร้างอัตโนมัติจากข้อมูลเกมที่มีอยู่จริง
app.get("/api/meta", (_, res) => {
  const n = {};
  state.games.forEach((g) => { n[g.category] = (n[g.category] || 0) + 1; });
  res.json({
    categories: Object.keys(n).sort((a, b) => n[b] - n[a]),
    ages: [...new Set(state.games.map((g) => g.age))].sort((a, b) => a - b),
    sorts: ["new", "pop", "score"],
    commentGuests: COMMENT_GUESTS,
  });
});

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

app.get("/api/top", (_, res) => res.json(state.games.map(decorate).sort((a, b) => b.score - a.score).slice(0, 10)));

app.get("/api/games/:id", (req, res) => {
  const g = state.games.find((x) => x.id === Number(req.params.id));
  if (!g) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const d = decorate(g);
  d.myRating = (state.ratings[g.id] || {})[String(req.query.voter || "")] || null; // ดาวที่เครื่องนี้เคยให้
  res.json(d);
});

// ให้ดาว 1-5 (1 เครื่อง/เบราว์เซอร์ ต่อ 1 เกม กดใหม่คือเปลี่ยนดาว) แล้วคำนวณคะแนนรวมใหม่
app.post("/api/games/:id/rate", rlimiter, (req, res) => {
  const id = Number(req.params.id);
  const g = state.games.find((x) => x.id === id);
  if (!g) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const voter = String((req.body || {}).voter || "");
  const stars = Number((req.body || {}).stars);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(voter)) return res.status(400).json({ error: "voter ไม่ถูกต้อง" });
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: "ดาวต้องเป็น 1–5" });
  if (!state.ratings[id]) state.ratings[id] = {};
  state.ratings[id][voter] = stars;
  store.persistRating(id, voter, stars);
  res.json({ ...stats(g), myRating: stars });
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

// แสดงความคิดเห็น: สมาชิกใช้ชื่อจากบัญชี / ผู้เยี่ยมชมพิมพ์ชื่อเอง (เฉพาะเมื่อ COMMENT_GUESTS=true)
app.post("/api/games/:id/comments", limiter, (req, res) => {
  const id = Number(req.params.id);
  if (!state.games.some((g) => g.id === id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const b = req.body || {};
  const member = members.memberFrom(req);
  if (!member && !COMMENT_GUESTS) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อนแสดงความคิดเห็น", needLogin: true });
  const name = member ? member.name : String(b.name || "").trim();
  const text = String(b.text || "").trim();
  const rating = null; // ดาวให้ผ่าน /rate แล้ว ไม่รับดาวในคอมเมนต์
  if (name.length < 1 || name.length > 30) return res.status(400).json({ error: "กรุณาใส่ชื่อ (ไม่เกิน 30 ตัวอักษร)" });
  if (text.length < 2 || text.length > 500) return res.status(400).json({ error: "ความคิดเห็นต้องยาว 2–500 ตัวอักษร" });
  const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), gameId: id, userId: member ? member.id : null, name, text, rating, date: new Date().toISOString() };
  state.comments.push(c);
  store.persistComment(c);
  res.status(201).json(c);
});

// ลบคอมเมนต์: ผู้ดูแลที่ล็อกอินแล้ว, header x-admin-token แบบเดิม หรือสมาชิกเจ้าของความคิดเห็น
app.delete("/api/comments/:cid", (req, res) => {
  const viaToken = process.env.ADMIN_TOKEN && req.get("x-admin-token") === process.env.ADMIN_TOKEN;
  const member = members.memberFrom(req);
  const own = member && state.comments.some((c) => c.id === req.params.cid && c.userId === member.id);
  if (!viaToken && !auth.adminFrom(req) && !own) return res.status(401).json({ error: "unauthorized" });
  const n = state.comments.length;
  state.comments = state.comments.filter((c) => c.id !== req.params.cid);
  store.persistDelete(req.params.cid);
  res.json({ deleted: n - state.comments.length });
});

// ================= ระบบผู้ดูแล (admin) =================
members.register(app); // สมัครสมาชิก / เข้าสู่ระบบ / ออกจากระบบ + admin จัดการสมาชิก
app.post("/api/admin/login", auth.login);
app.post("/api/admin/logout", auth.logout);
app.get("/api/admin/me", auth.requireAdmin, (req, res) => res.json({ user: req.admin.u, exp: req.admin.exp, storage: store.kind }));

const AGES_OK = [3, 7, 12, 16, 18];
const list = (v) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
// ตรวจและแปลงข้อมูลเกมจากฟอร์ม คืนค่า [error, game]
function cleanGame(b = {}) {
  const s = (k, max) => String(b[k] ?? "").trim().slice(0, max);
  const g = {
    title: s("title", 200), category: s("category", 50), age: Number(b.age), score: Number(b.score),
    views: Math.max(0, Math.floor(Number(b.views) || 0)), date: s("date", 10) || new Date().toISOString().slice(0, 10),
    desc: s("desc", 1000), review: s("review", 50000), pros: list(b.pros).map((x) => x.slice(0, 200)), cons: list(b.cons).map((x) => x.slice(0, 200)),
    platforms: s("platforms", 200), image: s("image", 500), hue: Math.round(Number(b.hue)),
  };
  if (!g.title) return ["กรุณาใส่ชื่อเกม"];
  if (!g.category) return ["กรุณาใส่หมวดหมู่"];
  if (!AGES_OK.includes(g.age)) return ["เรตอายุต้องเป็น " + AGES_OK.join(", ")];
  if (!(g.score >= 0 && g.score <= 10)) return ["คะแนนต้องอยู่ระหว่าง 0–10"];
  g.score = Math.round(g.score * 10) / 10;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date) || isNaN(Date.parse(g.date))) return ["วันที่ต้องเป็นรูปแบบ YYYY-MM-DD"];
  if (!(g.hue >= 0 && g.hue <= 360)) g.hue = 200;
  if (g.image && !/^(https?:\/\/|images\/)/i.test(g.image)) return ["รูปต้องเป็นลิงก์ https://... หรือ images/ชื่อไฟล์"];
  return [null, g];
}
const findGame = (id) => state.games.find((x) => x.id === id);
const fail = (res, e) => { console.error("admin error:", e.message); res.status(500).json({ error: "บันทึกไม่สำเร็จ: " + e.message }); };

app.get("/api/admin/games", auth.requireAdmin, (_, res) =>
  res.json(state.games.map((g) => ({ ...g, totalViews: viewsOf(g), ...stats(g) })).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)));

app.post("/api/admin/games", auth.requireAdmin, async (req, res) => {
  const [err, g] = cleanGame(req.body);
  if (err) return res.status(400).json({ error: err });
  try { res.status(201).json(await store.createGame(g)); } catch (e) { fail(res, e); }
});

app.put("/api/admin/games/:id", auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!findGame(id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  const [err, g] = cleanGame(req.body);
  if (err) return res.status(400).json({ error: err });
  try { res.json(await store.updateGame(id, g)); } catch (e) { fail(res, e); }
});

app.delete("/api/admin/games/:id", auth.requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!findGame(id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
  try { await store.removeGame(id); res.json({ ok: true }); } catch (e) { fail(res, e); }
});

// คอมเมนต์ล่าสุดทุกเกม สำหรับหน้า admin
app.get("/api/admin/comments", auth.requireAdmin, (_, res) => {
  const t = Object.fromEntries(state.games.map((g) => [g.id, g.title]));
  res.json(state.comments.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300).map((c) => ({ ...c, gameTitle: t[c.gameId] || "-" })));
});

store.init()
  .then(() => { setInterval(() => store.refreshGames().catch((e) => console.error("refresh failed:", e.message)), 60000).unref(); return app.listen(PORT, () => console.log(`Duffy Review API running on port ${PORT}`)); })
  .catch((e) => { console.error("startup failed:", e.message); process.exit(1); });
