// ฟีเจอร์เสริม: รายงานความคิดเห็น, ลิงก์แชร์รีวิว
const store = require("./store");
const auth = require("./auth");
const members = require("./members");
const state = store.state;

const FRONTEND = (process.env.FRONTEND_URL || "https://duffy-review-frontend.vercel.app").replace(/\/+$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= รายงานความคิดเห็นที่ไม่เหมาะสม ================= */
// เก็บใน settings.reports = { [commentId]: [{ uid, reason, at }] }
const REASONS = { spam: "สแปม/โฆษณา", rude: "หยาบคาย/ดูหมิ่น", spoiler: "สปอยล์", other: "อื่นๆ" };
const reports = () => state.settings.reports || {};
const repHits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of repHits) if (!a.some((t) => now - t < 3600000)) repHits.delete(k); }, 600000).unref();
async function saveReports(r) {
  // ตัดรายงานของความคิดเห็นที่ถูกลบไปแล้วทิ้ง
  const alive = new Set(state.comments.map((c) => c.id));
  await store.saveSetting("reports", Object.fromEntries(Object.entries(r).filter(([cid, a]) => alive.has(cid) && a.length)));
}
const reportCount = (cid) => (reports()[cid] || []).length;

/* ================= หน้าแชร์รีวิว (มีภาพปก/ชื่อเกมตอนแปะลิงก์ใน Facebook, Discord, LINE) ================= */
function imageUrl(g, req) {
  if (!g.image) return "";
  if (/^https?:\/\//i.test(g.image)) return g.image;
  if (g.image.startsWith("/api/images/")) return `${req.protocol}://${req.get("host")}${g.image}`;
  return `${FRONTEND}/${g.image.replace(/^\/+/, "")}`;
}
// คะแนนรวมแบบเดียวกับที่หน้าเว็บแสดง (คะแนนทีมงาน + ดาวผู้อ่าน) ดูสูตรใน server.js
const PRIOR = Number(process.env.SCORE_PRIOR_WEIGHT) || 10;
function scoreOf(g) {
  const r = Object.values(state.ratings[g.id] || {});
  const sum = r.reduce((s, x) => s + x, 0);
  return +((g.score * PRIOR + sum * 2) / (PRIOR + r.length)).toFixed(1);
}
function sharePage(req, res) {
  const g = state.games.find((x) => x.id === Number(req.params.id));
  const to = g ? `${FRONTEND}/?g=${g.id}` : `${FRONTEND}/`;
  if (!g) return res.redirect(302, to);
  const score = scoreOf(g);
  const title = `${g.title} รีวิว${score > 0 ? ` คะแนน ${score}/10` : ""} | Duffy Review`; // ยังไม่มีคะแนนเลย -> ไม่แสดงตัวเลข
  const desc = (g.desc || "").slice(0, 200);
  const img = imageUrl(g, req);
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  res.send(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Duffy Review">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(FRONTEND + "/g/" + g.id)}">${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<link rel="canonical" href="${esc(FRONTEND + "/g/" + g.id)}">
<meta http-equiv="refresh" content="0;url=${esc(to)}"></head>
<body><script>location.replace(${JSON.stringify(to)})</script><a href="${esc(to)}">อ่านรีวิว ${esc(g.title)}</a></body></html>`);
}

function register(app) {
  app.post("/api/comments/:cid/report", members.requireMember, async (req, res) => {
    const c = state.comments.find((x) => x.id === req.params.cid);
    if (!c) return res.status(404).json({ error: "ไม่พบความคิดเห็นนี้" });
    if (c.userId === req.member.id) return res.status(400).json({ error: "รายงานความคิดเห็นของตัวเองไม่ได้" });
    const reason = REASONS[(req.body || {}).reason] ? req.body.reason : "other";
    const now = Date.now(), k = req.member.id;
    const a = (repHits.get(k) || []).filter((t) => now - t < 3600000);
    if (a.length >= 20) return res.status(429).json({ error: "รายงานถี่เกินไป กรุณาลองใหม่ภายหลัง" });
    const r = { ...reports() };
    const list = (r[c.id] || []).filter((x) => x.uid !== k);
    r[c.id] = [...list, { uid: k, reason, at: new Date().toISOString() }];
    try { await saveReports(r); a.push(now); repHits.set(k, a); res.json({ ok: true }); }
    catch (e) { console.error("report failed:", e.message); res.status(500).json({ error: "ส่งรายงานไม่สำเร็จ" }); }
  });

  app.get("/api/admin/reports", auth.requireAdmin, (_, res) => {
    const t = Object.fromEntries(state.games.map((g) => [g.id, g.title]));
    const names = Object.fromEntries(state.users.map((u) => [u.id, u.username]));
    const out = [];
    for (const [cid, list] of Object.entries(reports())) {
      const c = state.comments.find((x) => x.id === cid);
      if (!c || !list.length) continue;
      const why = {};
      list.forEach((x) => { why[REASONS[x.reason] || x.reason] = (why[REASONS[x.reason] || x.reason] || 0) + 1; });
      out.push({ ...members.decorateComment(c), gameTitle: t[c.gameId] || "-", count: list.length, reasons: why, by: list.map((x) => names[x.uid] || "?"), last: list[list.length - 1].at });
    }
    res.json(out.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)));
  });

  app.post("/api/admin/reports/:cid/dismiss", auth.requireAdmin, async (req, res) => {
    const r = { ...reports() }; delete r[req.params.cid];
    try { await saveReports(r); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: "บันทึกไม่สำเร็จ" }); }
  });

  app.get("/share/:id", sharePage);
}

module.exports = { register, reportCount };
