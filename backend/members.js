// ระบบสมาชิก: สมัคร / เข้าสู่ระบบ / ออกจากระบบ และหน้า admin จัดการสมาชิก
const auth = require("./auth");
const store = require("./store");
const state = store.state;

// ---- โปรไฟล์: แบนเนอร์สำเร็จรูป / สีประจำตัว / รูปที่อัปโหลด (/api/images/:id) ----
const BANNERS = ["duffy", "sunset", "ocean", "aurora", "neon", "forest", "candy", "midnight"];
const ACCENTS = ["#ff6a2b", "#7c4dff", "#22c55e", "#06b6d4", "#ec4899", "#eab308", "#ef4444", "#64748b"];
const IMG = /^\/api\/images\/\d+$/;
const profileOf = (u) => {
  const p = u.profile || {};
  return {
    bio: p.bio || "", avatar: IMG.test(p.avatar || "") ? p.avatar : "",
    banner: BANNERS.includes(p.banner) || IMG.test(p.banner || "") ? p.banner : "duffy",
    accent: ACCENTS.includes(p.accent) ? p.accent : ACCENTS[0],
    favs: Array.isArray(p.favs) ? p.favs.filter(Number.isInteger).slice(0, 3) : [],
    wish: Array.isArray(p.wish) ? p.wish.filter(Number.isInteger).slice(0, WISH_MAX) : [],
  };
};
const WISH_MAX = 200;
// เวอร์ชันรหัสผ่านในโทเคน: เปลี่ยนรหัสผ่านแล้วโทเคนเก่าทุกอันใช้ไม่ได้ทันที
const pv = (u) => require("crypto").createHash("sha256").update(String(u.passwordHash)).digest("hex").slice(0, 12);
const pub = (u) => ({ id: u.id, username: u.username, name: u.name, ...profileOf(u) });
const findUser = (id) => state.users.find((u) => u.id === id);

// ใส่ชื่อ/รูปปัจจุบันของสมาชิกให้ความคิดเห็น (เปลี่ยนชื่อแล้วความคิดเห็นเก่าเปลี่ยนตาม)
function decorateComment(c) {
  const u = c.userId ? findUser(c.userId) : null;
  if (!u) return c;
  const p = profileOf(u);
  return { ...c, name: u.name, username: u.username, avatar: p.avatar, accent: p.accent };
}

// ป้ายเกียรติยศ คำนวณจากกิจกรรมจริง
function badgesOf(u, commentCount, favCount) {
  const b = [];
  if (u.id <= 50) b.push({ key: "pioneer", label: "สมาชิกยุคบุกเบิก" });
  if (commentCount >= 10) b.push({ key: "critic", label: "นักวิจารณ์ตัวยง" });
  else if (commentCount >= 1) b.push({ key: "talker", label: "ร่วมแสดงความเห็น" });
  if (favCount >= 3) b.push({ key: "fan", label: "สายเกมตัวจริง" });
  return b;
}
const byName = (n) => state.users.find((u) => u.username === n);

// ใช้เปรียบเทียบเวลาเมื่อไม่พบชื่อผู้ใช้ เพื่อไม่ให้เดาได้ว่าชื่อไหนมีอยู่
let dummyHash = null;
auth.hashPassword("dummy-password").then((h) => { dummyHash = h; });

// คืนสมาชิกจากโทเคน (null ถ้าไม่ได้ล็อกอิน หรือบัญชีถูกลบแล้ว)
function memberFrom(req) {
  const d = auth.verify(auth.bearer(req));
  if (!d || d.r !== "member") return null;
  const u = findUser(d.uid);
  return u && d.pv === pv(u) ? u : null;
}

function requireMember(req, res, next) {
  const u = memberFrom(req);
  if (!u) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ", needLogin: true });
  req.member = u;
  next();
}

// สมัครได้ไม่เกิน 5 บัญชี / ชั่วโมง / IP
const regHits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of regHits) if (!a.some((t) => now - t < 3600000)) regHits.delete(k); }, 600000).unref();

const issue = (u) => ({ token: auth.sign({ r: "member", uid: u.id, pv: pv(u) }, auth.MEMBER_TTL), user: pub(u) });
// รหัสผ่านชั่วคราวที่ admin ออกให้ (ตัดตัวที่สับสนง่าย เช่น 0/O, 1/l ออก)
function tempPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = require("crypto").randomBytes(10);
  return [...b].map((x) => abc[x % abc.length]).join("");
}

// ตรวจชื่อผู้ใช้ซ้ำระหว่างพิมพ์ในหน้าสมัคร (จำกัด 60 ครั้ง/นาที/IP)
const checkHits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of checkHits) if (!a.some((t) => now - t < 60000)) checkHits.delete(k); }, 300000).unref();

function register(app) {
  app.get("/api/auth/username-check", (req, res) => {
    const now = Date.now();
    const a = (checkHits.get(req.ip) || []).filter((t) => now - t < 60000);
    if (a.length >= 60) return res.status(429).json({ error: "ตรวจถี่เกินไป" });
    a.push(now); checkHits.set(req.ip, a);
    const username = String(req.query.u || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.json({ valid: false, available: false });
    res.json({ valid: true, available: !byName(username) });
  });

  app.post("/api/auth/register", async (req, res) => {
    const b = req.body || {};
    const username = String(b.username || "").trim().toLowerCase();
    const name = String(b.name || "").trim().replace(/\s+/g, " ");
    const password = String(b.password || "");
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "ชื่อผู้ใช้ต้องเป็น a-z, 0-9 หรือ _ ยาว 3–20 ตัว", field: "username" });
    if (name.length < 1 || name.length > 30) return res.status(400).json({ error: "ชื่อที่แสดงต้องยาว 1–30 ตัวอักษร", field: "name" });
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "รหัสผ่านต้องยาว 8–100 ตัวอักษร", field: "password" });
    if (password.toLowerCase() === username) return res.status(400).json({ error: "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้", field: "password" });
    const now = Date.now();
    const a = (regHits.get(req.ip) || []).filter((t) => now - t < 3600000);
    if (a.length >= 5) return res.status(429).json({ error: "สมัครถี่เกินไป กรุณาลองใหม่ภายหลัง" });
    if (byName(username)) return res.status(409).json({ error: "ชื่อผู้ใช้นี้มีคนใช้แล้ว", field: "username" });
    try {
      const passwordHash = await auth.hashPassword(password);
      if (byName(username)) return res.status(409).json({ error: "ชื่อผู้ใช้นี้มีคนใช้แล้ว", field: "username" });
      const u = await store.createUser({ username, name, passwordHash });
      a.push(now); regHits.set(req.ip, a);
      res.status(201).json(issue(u));
    } catch (e) {
      if (/duplicate|unique/i.test(e.message)) return res.status(409).json({ error: "ชื่อผู้ใช้นี้มีคนใช้แล้ว", field: "username" });
      console.error("register failed:", e.message);
      res.status(500).json({ error: "สมัครไม่สำเร็จ กรุณาลองใหม่" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const username = String((req.body || {}).username || "").trim().toLowerCase();
    const password = String((req.body || {}).password || "");
    const key = "m:" + req.ip;
    if (auth.locked(key)) return res.status(429).json({ error: "ล็อกอินผิดหลายครั้ง กรุณารอ 15 นาที" });
    const u = byName(username);
    const ok = await auth.checkPassword(password, u ? u.passwordHash : dummyHash);
    if (!u || !ok) { auth.addFail(key); return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }); }
    auth.clearFail(key);
    res.json(issue(u));
  });

  app.post("/api/auth/logout", (req, res) => { auth.revoke(req); res.json({ ok: true }); });
  app.get("/api/auth/me", requireMember, (req, res) => res.json({ user: pub(req.member) }));

  // แก้ไขโปรไฟล์ตัวเอง (ส่งเฉพาะช่องที่จะเปลี่ยนก็ได้)
  app.put("/api/auth/profile", requireMember, async (req, res) => {
    const b = req.body || {}, u = req.member, cur = profileOf(u);
    const bad = (error, field) => res.status(400).json({ error, field });
    const name = b.name === undefined ? u.name : String(b.name).trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 30) return bad("ชื่อที่แสดงต้องยาว 1–30 ตัวอักษร", "name");
    const bio = b.bio === undefined ? cur.bio : String(b.bio).replace(/\r/g, "").trim();
    if (bio.length > 160) return bad("แนะนำตัวได้ไม่เกิน 160 ตัวอักษร", "bio");
    if ((bio.match(/\n/g) || []).length > 3) return bad("แนะนำตัวขึ้นบรรทัดใหม่ได้ไม่เกิน 4 บรรทัด", "bio");
    const avatar = b.avatar === undefined ? cur.avatar : String(b.avatar);
    if (avatar && !IMG.test(avatar)) return bad("รูปโปรไฟล์ไม่ถูกต้อง", "avatar");
    const banner = b.banner === undefined ? cur.banner : String(b.banner);
    if (!BANNERS.includes(banner) && !IMG.test(banner)) return bad("แบนเนอร์ไม่ถูกต้อง", "banner");
    const accent = b.accent === undefined ? cur.accent : String(b.accent).toLowerCase();
    if (!ACCENTS.includes(accent)) return bad("สีประจำตัวไม่ถูกต้อง", "accent");
    let favs = b.favs === undefined ? cur.favs : b.favs;
    if (!Array.isArray(favs) || favs.length > 3) return bad("เลือกเกมโปรดได้ไม่เกิน 3 เกม", "favs");
    favs = [...new Set(favs.map(Number))];
    if (!favs.every((id) => state.games.some((g) => g.id === id))) return bad("ไม่พบเกมที่เลือก", "favs");
    try {
      await store.updateUser(u.id, { name, profile: { ...(u.profile || {}), bio, avatar, banner, accent, favs } });
      res.json({ user: pub(findUser(u.id)) });
    } catch (e) { console.error("profile save failed:", e.message); res.status(500).json({ error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }); }
  });

  // เปลี่ยนรหัสผ่านตัวเอง (ต้องใส่รหัสเดิม) แล้วออกโทเคนใหม่ให้ เครื่องอื่นที่ล็อกอินค้างไว้จะหลุดทันที
  app.put("/api/auth/password", requireMember, async (req, res) => {
    const u = req.member, b = req.body || {};
    const current = String(b.current || ""), password = String(b.password || "");
    const key = "pw:" + u.id;
    if (auth.locked(key)) return res.status(429).json({ error: "ใส่รหัสผ่านเดิมผิดหลายครั้ง กรุณารอ 15 นาที" });
    if (!(await auth.checkPassword(current, u.passwordHash))) { auth.addFail(key); return res.status(400).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง", field: "current" }); }
    auth.clearFail(key);
    if (password.length < 8 || password.length > 100) return res.status(400).json({ error: "รหัสผ่านใหม่ต้องยาว 8–100 ตัวอักษร", field: "password" });
    if (password.toLowerCase() === u.username) return res.status(400).json({ error: "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้", field: "password" });
    if (password === current) return res.status(400).json({ error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม", field: "password" });
    try { await store.setPassword(u.id, await auth.hashPassword(password)); res.json(issue(findUser(u.id))); }
    catch (e) { console.error("password change failed:", e.message); res.status(500).json({ error: "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" }); }
  });

  // รายการเกมที่อยากเล่น: { gameId, on: true/false }
  app.post("/api/auth/wishlist", requireMember, async (req, res) => {
    const u = req.member, id = Number((req.body || {}).gameId), on = !!(req.body || {}).on;
    if (!state.games.some((g) => g.id === id)) return res.status(404).json({ error: "ไม่พบเกมนี้" });
    const p = profileOf(u);
    let wish = p.wish.filter((x) => x !== id);
    if (on) { if (wish.length >= WISH_MAX) return res.status(400).json({ error: `เก็บได้ไม่เกิน ${WISH_MAX} เกม` }); wish = [id, ...wish]; }
    try { await store.updateUser(u.id, { name: u.name, profile: { ...(u.profile || {}), wish } }); res.json({ wish }); }
    catch (e) { console.error("wishlist save failed:", e.message); res.status(500).json({ error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }); }
  });

  // ดูโปรไฟล์ของสมาชิก พร้อมสถิติ ป้าย เกมโปรด เกมที่อยากเล่น และความคิดเห็นล่าสุด
  app.get("/api/users/:username", (req, res) => {
    const u = byName(String(req.params.username || "").toLowerCase());
    if (!u) return res.status(404).json({ error: "ไม่พบสมาชิกนี้" });
    const p = profileOf(u);
    const games = Object.fromEntries(state.games.map((g) => [g.id, g]));
    const mine = state.comments.filter((c) => c.userId === u.id).sort((a, b) => b.date.localeCompare(a.date));
    const card = (g) => ({ id: g.id, title: g.title, category: g.category, image: g.image || "", hue: g.hue, score: g.score, age: g.age });
    const favs = p.favs.map((id) => games[id]).filter(Boolean).map(card);
    const wish = p.wish.map((id) => games[id]).filter(Boolean).map(card);
    const me = memberFrom(req);
    res.json({
      user: { username: u.username, name: u.name, created: u.created, ...p, favs, wish },
      stats: { comments: mine.length, games: new Set(mine.map((c) => c.gameId)).size },
      badges: badgesOf(u, mine.length, favs.length),
      recent: mine.slice(0, 8).map((c) => ({ id: c.id, gameId: c.gameId, gameTitle: (games[c.gameId] || {}).title || "-", text: c.text, date: c.date })),
      isMe: !!me && me.id === u.id,
    });
  });

  // ---- admin: จัดการสมาชิก ----
  app.get("/api/admin/users", auth.requireAdmin, (_, res) => {
    const n = {};
    state.comments.forEach((c) => { if (c.userId) n[c.userId] = (n[c.userId] || 0) + 1; });
    res.json(state.users.map((u) => ({ ...pub(u), created: u.created, comments: n[u.id] || 0 }))
      .sort((a, b) => String(b.created).localeCompare(String(a.created))));
  });

  // admin รีเซ็ตรหัสผ่านให้สมาชิกที่ลืมรหัส: ได้รหัสชั่วคราวแสดงครั้งเดียว ให้สมาชิกไปเปลี่ยนเองในหน้าโปรไฟล์
  app.post("/api/admin/users/:id/reset-password", auth.requireAdmin, async (req, res) => {
    const u = findUser(Number(req.params.id));
    if (!u) return res.status(404).json({ error: "ไม่พบสมาชิกนี้" });
    const password = tempPassword();
    try { await store.setPassword(u.id, await auth.hashPassword(password)); res.json({ username: u.username, password }); }
    catch (e) { console.error("reset password failed:", e.message); res.status(500).json({ error: "รีเซ็ตไม่สำเร็จ: " + e.message }); }
  });

  // ลบสมาชิก พร้อมความคิดเห็นทั้งหมดของสมาชิกคนนั้น (โทเคนเดิมจะใช้ไม่ได้ทันที)
  app.delete("/api/admin/users/:id", auth.requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!findUser(id)) return res.status(404).json({ error: "ไม่พบสมาชิกนี้" });
    try { const removed = await store.removeUser(id); res.json({ ok: true, commentsDeleted: removed }); }
    catch (e) { console.error("delete user failed:", e.message); res.status(500).json({ error: "ลบไม่สำเร็จ: " + e.message }); }
  });
}

module.exports = { register, memberFrom, requireMember, decorateComment };
