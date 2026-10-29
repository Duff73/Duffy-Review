// เก็บเกม ยอดวิว และความคิดเห็น เลือกตามค่า DATABASE_URL:
//   postgres://...  -> PostgreSQL (Neon, Supabase, Render)
//   mysql://...     -> MySQL / MariaDB (จัดการผ่าน phpMyAdmin ได้)
//   (ไม่ตั้ง)         -> ไฟล์ JSON (ชั่วคราว: หายเมื่อ Render ฟรีรีสตาร์ต)
const fs = require("fs");
const path = require("path");

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "store.json");
const URL_ = process.env.DATABASE_URL || "";
const kind = !URL_ ? "file" : /^mysql/i.test(URL_) ? "mysql" : "postgres";
const state = { games: [], views: {}, comments: [] };

const arr = (x) => { if (Array.isArray(x)) return x; try { return JSON.parse(x || "[]"); } catch (_) { return []; } };
const toGame = (r) => ({
  id: r.id, title: r.title, category: r.category, age: r.age, score: Number(r.score),
  views: r.base_views, date: r.date, desc: r.description, review: r.review,
  pros: arr(r.pros), cons: arr(r.cons), platforms: r.platforms, image: r.image, hue: r.hue,
});
const toComment = (r) => ({ id: r.id, gameId: r.game_id, name: r.name, text: r.text, rating: r.rating, date: new Date(r.date).toISOString() });
const readSql = (dir) => fs.readFileSync(path.join(__dirname, "db", dir, "schema.sql"), "utf8");

// ---------------- PostgreSQL ----------------
function pgAdapter() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: URL_,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pg error:", e.message));
  const GAMES = `SELECT id, title, category, age, score, base_views, release_date::text AS date,
    description, review, pros, cons, platforms, image, hue FROM games ORDER BY id`;
  return {
    async init(seed) {
      await pool.query(readSql("postgres"));
      const n = (await pool.query("SELECT COUNT(*)::int AS n FROM games")).rows[0].n;
      if (n === 0) {
        for (const g of seed) {
          await pool.query(
            `INSERT INTO games (id,title,category,age,score,base_views,release_date,description,review,pros,cons,platforms,image,hue)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
            [g.id, g.title, g.category, g.age, g.score, g.views || 0, g.date, g.desc, g.review || "", g.pros || [], g.cons || [], g.platforms, g.image || "", g.hue]);
        }
        await pool.query("SELECT setval(pg_get_serial_sequence('games','id'), (SELECT MAX(id) FROM games))");
        console.log("seeded sample games");
      }
    },
    loadGames: async () => (await pool.query(GAMES)).rows.map(toGame),
    loadViews: async () => Object.fromEntries((await pool.query("SELECT game_id, count FROM views")).rows.map((r) => [r.game_id, r.count])),
    loadComments: async () => (await pool.query("SELECT * FROM comments")).rows.map(toComment),
    saveView: (id, n) => pool.query("INSERT INTO views (game_id, count) VALUES ($1, $2) ON CONFLICT (game_id) DO UPDATE SET count = EXCLUDED.count", [id, n]),
    saveComment: (c) => pool.query("INSERT INTO comments (id, game_id, name, text, rating, date) VALUES ($1,$2,$3,$4,$5,$6)", [c.id, c.gameId, c.name, c.text, c.rating, c.date]),
    deleteComment: (id) => pool.query("DELETE FROM comments WHERE id = $1", [id]),
  };
}

// ---------------- MySQL / MariaDB ----------------
function mysqlAdapter() {
  const mysql = require("mysql2/promise");
  const u = new URL(URL_); // mysql://USER:PASSWORD@HOST:3306/DBNAME  (รหัสผ่านที่มีอักขระพิเศษต้อง URL-encode)
  const pool = mysql.createPool({
    host: u.hostname, port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    charset: "utf8mb4", timezone: "Z", connectionLimit: 5,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  const GAMES = `SELECT id, title, category, age, score, base_views, DATE_FORMAT(release_date, '%Y-%m-%d') AS date,
    description, review, pros, cons, platforms, image, hue FROM games ORDER BY id`;
  return {
    async init(seed) {
      const sql = readSql("mysql").replace(/^\s*--.*$/gm, "");
      for (const st of sql.split(";").map((s) => s.trim()).filter(Boolean)) await pool.query(st);
      const [rows] = await pool.query("SELECT COUNT(*) AS n FROM games");
      if (Number(rows[0].n) === 0) {
        for (const g of seed) { // ไม่ใส่ id ให้ AUTO_INCREMENT ทำเอง (id 0 ใช้ไม่ได้ใน MySQL)
          await pool.query(
            "INSERT INTO games (title,category,age,score,base_views,release_date,description,review,pros,cons,platforms,image,hue) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [g.title, g.category, g.age, g.score, g.views || 0, g.date, g.desc, g.review || "", JSON.stringify(g.pros || []), JSON.stringify(g.cons || []), g.platforms, g.image || "", g.hue]);
        }
        console.log("seeded sample games");
      }
    },
    loadGames: async () => (await pool.query(GAMES))[0].map(toGame),
    loadViews: async () => Object.fromEntries((await pool.query("SELECT game_id, `count` FROM views"))[0].map((r) => [r.game_id, r.count])),
    loadComments: async () => (await pool.query("SELECT * FROM comments"))[0].map(toComment),
    saveView: (id, n) => pool.query("INSERT INTO views (game_id, `count`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `count` = VALUES(`count`)", [id, n]),
    saveComment: (c) => pool.query("INSERT INTO comments (id, game_id, name, `text`, rating, `date`) VALUES (?,?,?,?,?,?)", [c.id, c.gameId, c.name, c.text, c.rating, new Date(c.date)]),
    deleteComment: (id) => pool.query("DELETE FROM comments WHERE id = ?", [id]),
  };
}

const db = kind === "postgres" ? pgAdapter() : kind === "mysql" ? mysqlAdapter() : null;
const fileSave = () => {
  try { fs.writeFileSync(FILE, JSON.stringify({ views: state.views, comments: state.comments })); }
  catch (e) { console.error("save failed:", e.message); }
};
const safe = (p) => p.catch((e) => console.error("db error:", e.message));

async function refreshGames() { if (db) state.games = await db.loadGames(); }

async function init() {
  const seed = require("./data/games.json");
  if (db) {
    await db.init(seed);
    await refreshGames();
    state.views = await db.loadViews();
    state.comments = await db.loadComments();
  } else {
    state.games = seed;
    try { Object.assign(state, JSON.parse(fs.readFileSync(FILE, "utf8"))); } catch (_) {}
  }
  console.log(`storage: ${kind}${db ? " (ถาวร)" : " (ชั่วคราวบน Render ฟรี)"} | games: ${state.games.length}`);
}

const persistView = (id) => db ? safe(db.saveView(id, state.views[id])) : fileSave();
const persistComment = (c) => db ? safe(db.saveComment(c)) : fileSave();
const persistDelete = (id) => db ? safe(db.deleteComment(id)) : fileSave();

module.exports = { state, init, refreshGames, persistView, persistComment, persistDelete };
