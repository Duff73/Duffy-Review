const express = require("express");
const cors = require("cors");
const games = require("./data/games.json");

const app = express();
const PORT = process.env.PORT || 3000;
// CORS_ORIGIN = โดเมน Vercel ของคุณ (คั่นหลายค่าด้วยจุลภาค) ถ้าไม่ตั้งจะอนุญาตทุกโดเมน
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes("*") ? true : origins }));

const CATEGORIES = ["แอคชัน", "RPG", "ผจญภัย", "แข่งรถ", "จำลอง", "ต่อสู้"];
const AGES = [3, 7, 12, 16, 18];

app.get("/", (_, res) => res.json({ name: "Duffy Review API", ok: true }));
app.get("/api/health", (_, res) => res.json({ status: "ok" }));
app.get("/api/meta", (_, res) => res.json({ categories: CATEGORIES, ages: AGES, sorts: ["new", "pop", "score"] }));

// GET /api/games?q=&cat=&age=&sort=new|pop|score
app.get("/api/games", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const cat = String(req.query.cat || "");
  const age = Number(req.query.age);
  const sort = String(req.query.sort || "new");

  let items = games.filter((g) =>
    (!cat || cat === "ทั้งหมด" || g.category === cat) &&
    (!age || g.age === age) &&
    (!q || `${g.title} ${g.category} ${g.desc} ${g.platforms}`.toLowerCase().includes(q))
  );
  const by = {
    pop: (a, b) => b.views - a.views,
    score: (a, b) => b.score - a.score,
    new: (a, b) => b.date.localeCompare(a.date),
  };
  items = items.sort(by[sort] || by.new);
  res.json({ total: items.length, items });
});

app.get("/api/top", (_, res) => {
  res.json([...games].sort((a, b) => b.score - a.score).slice(0, 10));
});

app.get("/api/games/:id", (req, res) => {
  const g = games.find((x) => x.id === Number(req.params.id));
  g ? res.json(g) : res.status(404).json({ error: "not found" });
});

app.listen(PORT, () => console.log(`Duffy Review API running on port ${PORT}`));
