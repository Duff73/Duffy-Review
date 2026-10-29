// เก็บเกม ยอดวิว และความคิดเห็น
// - ตั้ง DATABASE_URL (PostgreSQL) -> อ่าน/เขียนฐานข้อมูล ถาวร (ตารางสร้างจาก db/schema.sql อัตโนมัติ)
// - ไม่ตั้ง -> ใช้ data/games.json + เก็บยอดวิว/คอมเมนต์เป็นไฟล์ (หายเมื่อ Render ฟรีรีสตาร์ต)
const fs = require("fs");
const path = require("path");

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "store.json");
const state = { games: [], views: {}, comments: [] };
let pool = null;

if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pg error:", e.message));
}

const fileSave = () => {
  try { fs.writeFileSync(FILE, JSON.stringify({ views: state.views, comments: state.comments })); }
  catch (e) { console.error("save failed:", e.message); }
};
const q = (sql, p) => pool.query(sql, p).catch((e) => console.error("db error:", e.message));

const GAMES_SQL = `SELECT id, title, category, age, score, base_views, release_date::text AS date,
  description, review, pros, cons, platforms, image, hue FROM games ORDER BY id`;
const rowToGame = (r) => ({
  id: r.id, title: r.title, category: r.category, age: r.age, score: Number(r.score),
  views: r.base_views, date: r.date, desc: r.description, review: r.review,
  pros: r.pros || [], cons: r.cons || [], platforms: r.platforms, image: r.image, hue: r.hue,
});

// โหลดรายการเกมจากฐานข้อมูลใหม่ (เรียกเป็นระยะ เพื่อให้การแก้ไขผ่าน SQL แสดงผลเอง)
async function refreshGames() {
  if (!pool) return;
  state.games = (await pool.query(GAMES_SQL)).rows.map(rowToGame);
}

async function init() {
  const seed = require("./data/games.json");
  if (pool) {
    await pool.query(fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8"));
    const n = (await pool.query("SELECT COUNT(*)::int AS n FROM games")).rows[0].n;
    if (n === 0) {
      for (const g of seed) {
        await pool.query(
          `INSERT INTO games (id,title,category,age,score,base_views,release_date,description,review,pros,cons,platforms,image,hue)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
          [g.id, g.title, g.category, g.age, g.score, g.views || 0, g.date, g.desc, g.review || "", g.pros || [], g.cons || [], g.platforms, g.image || "", g.hue]
        );
      }
      await pool.query("SELECT setval(pg_get_serial_sequence('games','id'), (SELECT MAX(id) FROM games))");
      console.log("seeded sample games");
    }
    await refreshGames();
    const v = await pool.query("SELECT game_id, count FROM views");
    const c = await pool.query("SELECT * FROM comments");
    state.views = Object.fromEntries(v.rows.map((r) => [r.game_id, r.count]));
    state.comments = c.rows.map((r) => ({ id: r.id, gameId: r.game_id, name: r.name, text: r.text, rating: r.rating, date: new Date(r.date).toISOString() }));
  } else {
    state.games = seed;
    try { Object.assign(state, JSON.parse(fs.readFileSync(FILE, "utf8"))); } catch (_) {}
  }
  console.log(`storage: ${pool ? "postgres (ถาวร)" : "file (ชั่วคราวบน Render ฟรี)"} | games: ${state.games.length}`);
}

const persistView = (id) => pool
  ? q("INSERT INTO views (game_id, count) VALUES ($1, $2) ON CONFLICT (game_id) DO UPDATE SET count = EXCLUDED.count", [id, state.views[id]])
  : fileSave();
const persistComment = (c) => pool
  ? q("INSERT INTO comments (id, game_id, name, text, rating, date) VALUES ($1,$2,$3,$4,$5,$6)", [c.id, c.gameId, c.name, c.text, c.rating, c.date])
  : fileSave();
const persistDelete = (id) => pool ? q("DELETE FROM comments WHERE id = $1", [id]) : fileSave();

module.exports = { state, init, refreshGames, persistView, persistComment, persistDelete };
