// ระบบล็อกอิน: ผู้ดูแล (admin) และสมาชิก (member)
// ตั้งค่าบน Render > Environment:
//   ADMIN_USERNAME       ชื่อผู้ใช้ admin (ค่าเริ่มต้น "admin")
//   ADMIN_PASSWORD       รหัสผ่าน admin (จำเป็น ถ้าไม่ตั้ง ระบบ admin จะปิดไว้)
//   SESSION_SECRET       ข้อความลับยาวๆ สำหรับเซ็นโทเคน (ถ้าไม่ตั้ง ทุกครั้งที่เซิร์ฟเวอร์รีสตาร์ตต้องล็อกอินใหม่)
//   SESSION_HOURS        อายุการล็อกอินของ admin (ชั่วโมง ค่าเริ่มต้น 12)
//   MEMBER_SESSION_DAYS  อายุการล็อกอินของสมาชิก (วัน ค่าเริ่มต้น 30)
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const USER = process.env.ADMIN_USERNAME || "admin";
const PASS = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const ADMIN_TTL = (Number(process.env.SESSION_HOURS) || 12) * 3600 * 1000;
const MEMBER_TTL = (Number(process.env.MEMBER_SESSION_DAYS) || 30) * 86400 * 1000;

const enabled = () => PASS.length > 0;
const revoked = new Map(); // jti -> exp (โทเคนที่ออกจากระบบแล้ว)
const fails = new Map(); // key -> [เวลาที่ล็อกอินผิด]

const b64 = (s) => Buffer.from(s).toString("base64url");
const hmac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // เทียบแบบกันการเดาจากเวลา

// สร้างโทเคน: r = "admin" หรือ "member"
function sign(data, ttl) {
  const p = b64(JSON.stringify({ ...data, exp: Date.now() + ttl, jti: crypto.randomBytes(12).toString("hex") }));
  return `${p}.${hmac(p)}`;
}

function verify(token) {
  const [p, s] = String(token || "").split(".");
  if (!p || !s) return null;
  const good = hmac(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  let d;
  try { d = JSON.parse(Buffer.from(p, "base64url").toString()); } catch (_) { return null; }
  if (!d.exp || d.exp < Date.now() || revoked.has(d.jti)) return null;
  return d;
}

const bearer = (req) => (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
const revoke = (req) => { const d = verify(bearer(req)); if (d) revoked.set(d.jti, d.exp); };

// กันเดารหัส: ผิดเกิน 5 ครั้งใน 15 นาที ต่อ key
const WINDOW = 15 * 60000;
const locked = (key) => (fails.get(key) || []).filter((t) => Date.now() - t < WINDOW).length >= 5;
const addFail = (key) => fails.set(key, [...(fails.get(key) || []).filter((t) => Date.now() - t < WINDOW), Date.now()]);
const clearFail = (key) => fails.delete(key);

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of revoked) if (exp < now) revoked.delete(k);
  for (const [k, a] of fails) if (!a.some((t) => now - t < WINDOW)) fails.delete(k);
}, 600000).unref();

// ---------- รหัสผ่านสมาชิก (scrypt + salt) ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(String(pw), salt, 64);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
async function checkPassword(pw, stored) {
  const [k, s, h] = String(stored || "").split("$");
  if (k !== "scrypt" || !s || !h) return false;
  const hb = Buffer.from(h, "base64");
  const c = await scrypt(String(pw), Buffer.from(s, "base64"), hb.length);
  return crypto.timingSafeEqual(c, hb);
}

// ---------- admin ----------
// POST /api/admin/login  { username, password }
function login(req, res) {
  if (!enabled()) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD บนเซิร์ฟเวอร์" });
  const key = "admin:" + req.ip;
  if (locked(key)) return res.status(429).json({ error: "ล็อกอินผิดหลายครั้ง กรุณารอ 15 นาที" });
  const { username = "", password = "" } = req.body || {};
  const ok = same(username, USER) & same(password, PASS); // ใช้ & เพื่อให้เช็กทั้งสองค่าเสมอ
  if (!ok) { addFail(key); return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }); }
  clearFail(key);
  res.json({ token: sign({ r: "admin", u: USER }, ADMIN_TTL), user: USER, expiresIn: ADMIN_TTL / 1000 });
}

// POST /api/admin/logout
function logout(req, res) { revoke(req); res.json({ ok: true }); }

const adminFrom = (req) => { const d = verify(bearer(req)); return d && d.r === "admin" ? d : null; };

// middleware สำหรับเส้นทางที่ต้องเป็น admin
function requireAdmin(req, res, next) {
  const d = adminFrom(req);
  if (!d) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" });
  req.admin = d;
  next();
}

module.exports = {
  enabled, login, logout, requireAdmin, adminFrom, verify, bearer, revoke, sign,
  MEMBER_TTL, hashPassword, checkPassword, locked, addFail, clearFail,
};
