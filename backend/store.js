// เก็บเกม ยอดวิว และความคิดเห็น เลือกตามค่า DATABASE_URL:
//   postgres://...  -> PostgreSQL (Neon, Supabase, Render)
//   mysql://...     -> MySQL / MariaDB (จัดการผ่าน phpMyAdmin ได้)
//   (ไม่ตั้ง)         -> ไฟล์ JSON (ชั่วคราว: หายเมื่อ Render ฟรีรีสตาร์ต)
const fs = require("fs");
const path = require("path");

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "store.json");
const URL_ = process.env.DATABASE_URL || "";
const kind = !URL_ ? "file" : /^mysql/i.test(URL_) ? "mysql" : "postgres";
const state = { games: [], views: {}, comments: [], ratings: {}, users: [] };

const arr = (x) => { if (Array.isArray(x)) return x; try { return JSON.parse(x || "[]"); } catch (_) { return []; } };
const toGame = (r) => ({
  id: r.id, title: r.title, category: r.category, age: r.age, score: Number(r.score),
  views: r.base_views, date: r.date, desc: r.description, review: r.review,
  pros: arr(r.pros), cons: arr(r.cons), platforms: r.platforms, image: r.image, hue: r.hue,
  link: r.store_url || "",
});
const toComment = (r) => ({ id: r.id, gameId: r.game_id, userId: r.user_id ?? null, name: r.name, text: r.text, rating: r.rating, date: new Date(r.date).toISOString() });
const toUser = (r) => ({ id: r.id, username: r.username, name: r.name, passwordHash: r.password_hash, created: new Date(r.created_at).toISOString() });
// ค่าคอลัมน์ของเกมตามลำดับ title..hue, store_url (MySQL เก็บ pros/cons เป็น JSON text)
const gameParams = (g, json) => [g.title, g.category, g.age, g.score, g.views || 0, g.date, g.desc, g.review || "",
  json ? JSON.stringify(g.pros || []) : g.pros || [], json ? JSON.stringify(g.cons || []) : g.cons || [], g.platforms, g.image || "", g.hue,
  g.link || ""];
const readSql =(dir) => fs.readFileSync(path.join(__dirname, "db", dir, "schema.sql"), "utf8");

// ---------------- PostgreSQL ----------------
function pgAdapter() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: URL_,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pg error:", e.message));
  const GAMES = `SELECT id, title, category, age, score, base_views, release_date::text AS date,
    description, review, pros, cons, platforms, image, hue, store_url FROM games ORDER BY id`;
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
    saveComment: (c) => pool.query("INSERT INTO comments (id, game_id, user_id, name, text, rating, date) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.id, c.gameId, c.userId, c.name, c.text, c.rating, c.date]),
    loadUsers: async () => (await pool.query("SELECT * FROM users ORDER BY id")).rows.map(toUser),
    insertUser: async (u) => toUser((await pool.query("INSERT INTO users (username, name, password_hash) VALUES ($1,$2,$3) RETURNING *", [u.username, u.name, u.passwordHash])).rows[0]),
    deleteUser: async (id) => { await pool.query("DELETE FROM comments WHERE user_id = $1", [id]); await pool.query("DELETE FROM users WHERE id = $1", [id]); },
    deleteComment: (id) => pool.query("DELETE FROM comments WHERE id = $1", [id]),
    loadRatings: async () => { const o = {}; (await pool.query("SELECT game_id, voter, stars FROM ratings")).rows.forEach((r) => { (o[r.game_id] = o[r.game_id] || {})[r.voter] = r.stars; }); return o; },
    saveRating: (g, v, s) => pool.query("INSERT INTO ratings (game_id, voter, stars) VALUES ($1,$2,$3) ON CONFLICT (game_id, voter) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()", [g, v, s]),
    // ---- ใช้โดยหน้า admin ----
    insertGame: async (g) => (await pool.query(
      `INSERT INTO games (title,category,age,score,base_views,release_date,description,review,pros,cons,platforms,image,hue,store_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, gameParams(g))).rows[0].id,
    updateGame: (id, g) => pool.query(
      `UPDATE games SET title=$1, category=$2, age=$3, score=$4, base_views=$5, release_date=$6, description=$7,
       review=$8, pros=$9, cons=$10, platforms=$11, image=$12, hue=$13, store_url=$14 WHERE id=$15`, [...gameParams(g), id]),
    deleteGame: (id) => pool.query("DELETE FROM games WHERE id = $1", [id]),
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
    description, review, pros, cons, platforms, image, hue, store_url FROM games ORDER BY id`;
  return {
    async init(seed) {
      const sql = readSql("mysql").replace(/^\s*--.*$/gm, "");
      for (const st of sql.split(";").map((s) => s.trim()).filter(Boolean)) await pool.query(st);
      // ฐานข้อมูลเดิมที่สร้างก่อนมีระบบสมาชิก: เพิ่มคอลัมน์ user_id ให้ตาราง comments (ถ้ามีอยู่แล้วข้าม)
      try { await pool.query("ALTER TABLE comments ADD COLUMN user_id INT NULL, ADD KEY comments_user_idx (user_id)"); }
      catch (e) { if (e.errno !== 1060 && e.errno !== 1061) throw e; }
      // ฐานข้อมูลเดิม: เพิ่มคอลัมน์ลิงก์ร้านค้า/เว็บเกม (ถ้ามีอยู่แล้วข้าม)
      try { await pool.query("ALTER TABLE games ADD COLUMN store_url VARCHAR(500) NOT NULL DEFAULT ''"); }
      catch (e) { if (e.errno !== 1060) throw e; }
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
    saveComment: (c) => pool.query("INSERT INTO comments (id, game_id, user_id, name, `text`, rating, `date`) VALUES (?,?,?,?,?,?,?)", [c.id, c.gameId, c.userId, c.name, c.text, c.rating, new Date(c.date)]),
    loadUsers: async () => (await pool.query("SELECT * FROM users ORDER BY id"))[0].map(toUser),
    insertUser: async (u) => {
      const [r] = await pool.query("INSERT INTO users (username, name, password_hash) VALUES (?,?,?)", [u.username, u.name, u.passwordHash]);
      return toUser((await pool.query("SELECT * FROM users WHERE id = ?", [r.insertId]))[0][0]);
    },
    deleteUser: async (id) => { await pool.query("DELETE FROM comments WHERE user_id = ?", [id]); await pool.query("DELETE FROM users WHERE id = ?", [id]); },
    deleteComment: (id) => pool.query("DELETE FROM comments WHERE id = ?", [id]),
    loadRatings: async () => { const o = {}; (await pool.query("SELECT game_id, voter, stars FROM ratings"))[0].forEach((r) => { (o[r.game_id] = o[r.game_id] || {})[r.voter] = r.stars; }); return o; },
    saveRating: (g, v, s) => pool.query("INSERT INTO ratings (game_id, voter, stars) VALUES (?,?,?) ON DUPLICATE KEY UPDATE stars = VALUES(stars)", [g, v, s]),
    // ---- ใช้โดยหน้า admin ----
    insertGame: async (g) => (await pool.query(
      "INSERT INTO games (title,category,age,score,base_views,release_date,description,review,pros,cons,platforms,image,hue,store_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      gameParams(g, true)))[0].insertId,
    updateGame: (id, g) => pool.query(
      "UPDATE games SET title=?, category=?, age=?, score=?, base_views=?, release_date=?, description=?, review=?, pros=?, cons=?, platforms=?, image=?, hue=?, store_url=? WHERE id=?",
      [...gameParams(g, true), id]),
    deleteGame: (id) => pool.query("DELETE FROM games WHERE id = ?", [id]),
  };
}

const db = kind === "postgres" ? pgAdapter() : kind === "mysql" ? mysqlAdapter() : null;
let gamesEdited = false; // โหมดไฟล์: เมื่อแก้เกมผ่าน admin จะเก็บรายการเกมลง store.json ด้วย
const fileSave = () => {
  const data = { views: state.views, comments: state.comments, ratings: state.ratings, users: state.users };
  if (gamesEdited) data.games = state.games;
  try { fs.writeFileSync(FILE, JSON.stringify(data)); }
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
    state.ratings = await db.loadRatings();
    state.users = await db.loadUsers();
  } else {
    state.games = seed;
    try { const d = JSON.parse(fs.readFileSync(FILE, "utf8")); Object.assign(state, d); gamesEdited = Array.isArray(d.games); } catch (_) {}
  }
  console.log(`storage: ${kind}${db ? " (ถาวร)" : " (ชั่วคราวบน Render ฟรี)"} | games: ${state.games.length} | users: ${state.users.length}`);
}

const persistView = (id) => db ? safe(db.saveView(id, state.views[id])) : fileSave();
const persistComment = (c) => db ? safe(db.saveComment(c)) : fileSave();
const persistDelete = (id) => db ? safe(db.deleteComment(id)) : fileSave();
const persistRating = (g, v, s) => db ? safe(db.saveRating(g, v, s)) : fileSave();

// ---- จัดการเกม (admin) : เขียนลงฐานข้อมูลก่อน แล้วค่อยอัปเดต state ----
async function createGame(g) {
  if (db) { const id = await db.insertGame(g); await refreshGames(); return state.games.find((x) => x.id === Number(id)); }
  const game = { ...g, id: state.games.reduce((m, x) => Math.max(m, x.id), -1) + 1 };
  state.games.push(game); gamesEdited = true; fileSave();
  return game;
}
async function updateGame(id, g) {
  if (db) { await db.updateGame(id, g); await refreshGames(); return state.games.find((x) => x.id === id); }
  const i = state.games.findIndex((x) => x.id === id);
  state.games[i] = { ...g, id }; gamesEdited = true; fileSave();
  return state.games[i];
}
async function removeGame(id) {
  if (db) await db.deleteGame(id); // ยอดวิว คอมเมนต์ ดาว ถูกลบตาม (ON DELETE CASCADE)
  state.games = state.games.filter((x) => x.id !== id);
  state.comments = state.comments.filter((c) => c.gameId !== id);
  delete state.views[id]; delete state.ratings[id];
  if (!db) { gamesEdited = true; fileSave(); }
}

// ---- สมาชิก ----
async function createUser(u) {
  let user;
  if (db) user = await db.insertUser(u);
  else user = { ...u, id: state.users.reduce((m, x) => Math.max(m, x.id), 0) + 1, created: new Date().toISOString() };
  state.users.push(user);
  if (!db) fileSave();
  return user;
}
// ลบสมาชิกและความคิดเห็นของเขา คืนจำนวนความคิดเห็นที่ลบ
async function removeUser(id) {
  if (db) await db.deleteUser(id);
  const n = state.comments.length;
  state.users = state.users.filter((u) => u.id !== id);
  state.comments = state.comments.filter((c) => c.userId !== id);
  if (!db) fileSave();
  return n - state.comments.length;
}

module.exports = { state, kind, init, refreshGames, persistView, persistComment, persistDelete, persistRating, createGame, updateGame, removeGame, createUser, removeUser };
