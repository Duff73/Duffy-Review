// ระบบสมาชิก: สมัคร / เข้าสู่ระบบ / ออกจากระบบ และหน้า admin จัดการสมาชิก
const auth = require("./auth");
const store = require("./store");
const state = store.state;

const pub = (u) => ({ id: u.id, username: u.username, name: u.name });
const findUser = (id) => state.users.find((u) => u.id === id);
const byName = (n) => state.users.find((u) => u.username === n);

// ใช้เปรียบเทียบเวลาเมื่อไม่พบชื่อผู้ใช้ เพื่อไม่ให้เดาได้ว่าชื่อไหนมีอยู่
let dummyHash = null;
auth.hashPassword("dummy-password").then((h) => { dummyHash = h; });

// คืนสมาชิกจากโทเคน (null ถ้าไม่ได้ล็อกอิน หรือบัญชีถูกลบแล้ว)
function memberFrom(req) {
  const d = auth.verify(auth.bearer(req));
  if (!d || d.r !== "member") return null;
  return findUser(d.uid) || null;
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

const issue = (u) => ({ token: auth.sign({ r: "member", uid: u.id }, auth.MEMBER_TTL), user: pub(u) });

function register(app) {
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

  // ---- admin: จัดการสมาชิก ----
  app.get("/api/admin/users", auth.requireAdmin, (_, res) => {
    const n = {};
    state.comments.forEach((c) => { if (c.userId) n[c.userId] = (n[c.userId] || 0) + 1; });
    res.json(state.users.map((u) => ({ ...pub(u), created: u.created, comments: n[u.id] || 0 }))
      .sort((a, b) => String(b.created).localeCompare(String(a.created))));
  });

  // ลบสมาชิก พร้อมความคิดเห็นทั้งหมดของสมาชิกคนนั้น (โทเคนเดิมจะใช้ไม่ได้ทันที)
  app.delete("/api/admin/users/:id", auth.requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!findUser(id)) return res.status(404).json({ error: "ไม่พบสมาชิกนี้" });
    try { const removed = await store.removeUser(id); res.json({ ok: true, commentsDeleted: removed }); }
    catch (e) { console.error("delete user failed:", e.message); res.status(500).json({ error: "ลบไม่สำเร็จ: " + e.message }); }
  });
}

module.exports = { register, memberFrom, requireMember };
