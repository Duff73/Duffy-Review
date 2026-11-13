// ข่าวสารวงการเกม / ไอที / คอมพิวเตอร์ จาก RSS ของสำนักข่าว
// ขั้นตอน: ดึงทุก NEWS_INTERVAL_MIN นาที -> ตัดข่าวเก่า/ซ้ำ/คำต้องห้าม -> เข้าคิว "รอตรวจ" -> admin อนุมัติ -> ขึ้นเว็บ
// แสดงแค่หัวข้อ สรุปสั้น รูป และลิงก์ไปต้นทาง (ไม่คัดลอกบทความทั้งชิ้น)
const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");
const store = require("./store");
const translate = require("./translate");
const auth = require("./auth");
const state = store.state;

const INTERVAL = (Number(process.env.NEWS_INTERVAL_MIN) || 10) * 60000;
const MAX_AGE_DAYS = 3;   // ไม่เก็บข่าวที่เก่ากว่านี้ตอนดึง
const KEEP_DAYS = 30;     // ลบข่าวในระบบที่เก่ากว่านี้
const CATS = { game: "เกม", tech: "ไอทีและดิจิทัล", hw: "ฮาร์ดแวร์คอมพิวเตอร์" };

// คัดเฉพาะสำนักข่าวที่มีกองบรรณาธิการและมีชื่อเสียง (site = โดเมนของสำนักข่าว ลิงก์ข่าวต้องอยู่ในโดเมนนี้)
const DEFAULT_SOURCES = [
  { id: "gamingdose", name: "GamingDose", url: "https://www.gamingdose.com/feed/", site: "gamingdose.com", cat: "game", lang: "th", enabled: true, auto: false },
  { id: "blognone", name: "Blognone", url: "https://www.blognone.com/atom.xml", site: "blognone.com", cat: "tech", lang: "th", enabled: true, auto: false },
  { id: "ign", name: "IGN", url: "https://feeds.feedburner.com/ign/all", site: "ign.com", cat: "game", lang: "en", enabled: true, auto: false },
  { id: "gamespot", name: "GameSpot", url: "https://www.gamespot.com/feeds/news/", site: "gamespot.com", cat: "game", lang: "en", enabled: true, auto: false },
  { id: "eurogamer", name: "Eurogamer", url: "https://www.eurogamer.net/feed", site: "eurogamer.net", cat: "game", lang: "en", enabled: true, auto: false },
  { id: "pcgamer", name: "PC Gamer", url: "https://www.pcgamer.com/rss/", site: "pcgamer.com", cat: "game", lang: "en", enabled: true, auto: false },
  { id: "verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", site: "theverge.com", cat: "tech", lang: "en", enabled: true, auto: false },
  { id: "arstechnica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", site: "arstechnica.com", cat: "tech", lang: "en", enabled: true, auto: false },
  { id: "tomshw", name: "Tom's Hardware", url: "https://www.tomshardware.com/feeds/all", site: "tomshardware.com", cat: "hw", lang: "en", enabled: true, auto: false },
  { id: "techpowerup", name: "TechPowerUp", url: "https://www.techpowerup.com/rss/news", site: "techpowerup.com", cat: "hw", lang: "en", enabled: true, auto: false },
];
const CFG_VER = 2; // v2: เพิ่ม Eurogamer / Ars Technica / TechPowerUp, ปิด beartai (ฟีดไม่อัปเดตแล้ว)
// คำที่เจอแล้วข่าวจะถูกกรองออกอัตโนมัติ (admin ดู/กู้คืนได้ในแท็บ "ถูกกรอง")
const DEFAULT_BLOCK = ["คาสิโน", "บาคาร่า", "สล็อตออนไลน์", "เว็บพนัน", "พนันออนไลน์", "แทงบอล", "หวยออนไลน์", "casino", "gambling", "sportsbook", "porn", "xxx", "onlyfans", "nsfw", "airdrop"];

const cfg = () => {
  const c = state.settings.news || {};
  let sources = Array.isArray(c.sources) ? c.sources : DEFAULT_SOURCES;
  if (Array.isArray(c.sources) && !(c.ver >= CFG_VER)) { // ค่าที่ admin บันทึกไว้ก่อน v2: เติมแหล่งใหม่ + ใส่โดเมนให้แหล่งเดิม
    const def = new Map(DEFAULT_SOURCES.map((s) => [s.id, s]));
    sources = sources.map((s) => ({ ...s, site: s.site || (def.get(s.id) || {}).site || "", enabled: s.id === "beartai" ? false : s.enabled }));
    for (const d of DEFAULT_SOURCES) if (!sources.some((s) => s.id === d.id)) sources.push(d);
  }
  return { sources, block: Array.isArray(c.block) ? c.block : DEFAULT_BLOCK };
};

/* ---------- อ่าน RSS / Atom ---------- */
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", cdataPropName: false, processEntities: true, htmlEntities: true });
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ""), /^#x/i.test(e) ? 16 : 10) || 32) : ENT[e.toLowerCase()] ?? m);
const plain = (html) => decode(decode(String(html || "")).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);
const okUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(u || "") ? u : "";
// ตัดข้อความขยะที่บางเว็บแปะมากับสรุป (เช่น "The post ... appeared first on ...", หัวข้อซ้ำ + "Body")
function cleanSummary(sum, title) {
  let s = sum.replace(/\s*The post .+? appeared first on .+?\.?\s*$/i, "").replace(/\s*(Continue reading|Read more|อ่านต่อ)\s*[.…»›]*\s*$/i, "").trim();
  if (title && s.startsWith(title)) s = s.slice(title.length).trim();
  return s.replace(/^Body\s+/i, "").trim();
}

function pickImage(it, html) {
  for (const m of [...arr(it["media:content"]), ...arr(it["media:group"]?.["media:content"])]) {
    const u = m?.["@url"], t = String(m?.["@type"] || m?.["@medium"] || "");
    if (u && (/image/i.test(t) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u))) return okUrl(u);
  }
  for (const m of arr(it["media:thumbnail"])) if (m?.["@url"]) return okUrl(m["@url"]);
  for (const e of arr(it.enclosure)) if (e?.["@url"] && /image/i.test(e["@type"] || "image")) return okUrl(e["@url"]);
  const m = decode(String(html || "")).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? okUrl(m[1]) : "";
}

function parseFeed(xml) {
  const d = parser.parse(xml);
  if (d.rss) {
    return arr(d.rss.channel?.item).map((it) => {
      const html = txt(it["content:encoded"]) || txt(it.description);
      return { title: plain(txt(it.title)), link: okUrl(txt(it.link).trim() || txt(it.guid).trim()), summary: plain(txt(it.description) || html), image: pickImage(it, html), date: txt(it.pubDate) || txt(it["dc:date"]) };
    });
  }
  if (d.feed) {
    return arr(d.feed.entry).map((it) => {
      const links = arr(it.link);
      const l = links.find((x) => !x["@rel"] || x["@rel"] === "alternate") || links[0] || {};
      const html = txt(it.content) || txt(it.summary);
      return { title: plain(txt(it.title)), link: okUrl(l["@href"] || txt(l)), summary: plain(txt(it.summary) || html), image: pickImage(it, html), date: txt(it.published) || txt(it.updated) };
    });
  }
  return [];
}

/* ---------- กรองข่าว ---------- */
// โพสต์ขายของ/ดีลลดราคา/สปอนเซอร์ ไม่ใช่ข่าว
const PROMO = /\b(deals?|on sale|\d+% off|coupons?|promo codes?|sponsored|giveaway|black friday|cyber monday|prime day|lowest price|save \$\d+|for just \$\d+|only \$\d+|exclusively at|lifetime (access|subscription|license))\b|\$\d+(\.\d\d)?\s*\(MSRP|ลดราคา|โปรโมชั่น|ส่วนลด|ดีลเด็ด/i;
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function screen(item, block) {
  const hay = (item.title + " " + item.summary).toLowerCase();
  const hit = block.find((w) => w && hay.includes(String(w).toLowerCase()));
  if (hit) return "มีคำต้องห้าม: " + hit;
  if (PROMO.test(item.title)) return "โพสต์ดีลลดราคา/โฆษณา";
  const t = norm(item.title), since = Date.now() - MAX_AGE_DAYS * 86400000;
  if (t.length > 8 && state.news.some((n) => norm(n.title) === t && Date.parse(n.published) > since)) return "ข่าวซ้ำกับที่มีอยู่แล้ว";
  return "";
}

/* ---------- ดึงข่าว ---------- */
let running = null, lastRun = null;
async function fetchSource(src) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(src.url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; DuffyReviewBot/1.0; +news-reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const xml = await r.text();
    if (xml.length > 3_000_000) throw new Error("ไฟล์ใหญ่เกินไป");
    return parseFeed(xml);
  } finally { clearTimeout(timer); }
}
async function runFetch() {
  if (running) return running;
  running = (async () => {
    const { sources, block } = cfg();
    const report = [], fresh = [], minDate = Date.now() - MAX_AGE_DAYS * 86400000;
    const have = new Set(state.news.map((n) => n.id));
    for (const src of sources.filter((s) => s.enabled)) {
      try {
        const items = (await fetchSource(src)).slice(0, 40);
        let added = 0, filtered = 0;
        for (const it of items) {
          if (!it.title || !it.link) continue;
          const id = crypto.createHash("sha1").update(it.link).digest("hex").slice(0, 20);
          if (have.has(id)) continue;
          const t = Date.parse(it.date);
          const published = new Date(isNaN(t) ? Date.now() : Math.min(t, Date.now())).toISOString();
          if (Date.parse(published) < minDate) continue;
          // ลิงก์ต้องพาไปที่เว็บของสำนักข่าวนั้นจริง ๆ (กันฟีดที่แอบใส่ลิงก์ไปเว็บอื่น)
          const h = host(it.link);
          if (src.site && h !== src.site && !h.endsWith("." + src.site)) continue;
          const n = { id, source: src.id, cat: src.cat, lang: src.lang || "", title: cut(it.title, 300), summary: cut(cleanSummary(it.summary, it.title), 280), link: it.link, image: it.image || "", published, fetched: new Date().toISOString(), status: "pending", reason: "" };
          const why = screen(n, block);
          if (why) { n.status = "filtered"; n.reason = why; filtered++; } else if (src.auto) n.status = "approved";
          have.add(id); fresh.push(n); state.news.push(n); added++;
        }
        report.push({ source: src.name, ok: true, added, filtered });
      } catch (e) {
        report.push({ source: src.name, ok: false, error: e.name === "AbortError" ? "หมดเวลา" : e.message });
      }
    }
    if (fresh.length) await store.saveNews(fresh);
    const tr = await translatePending();
    await store.pruneNews(Date.now() - KEEP_DAYS * 86400000);
    lastRun = { at: new Date().toISOString(), report, translated: tr };
    console.log(`news: +${fresh.length} (${report.filter((r) => !r.ok).length} sources failed), translated ${tr.done}/${tr.tried} via ${tr.provider}`);
    return lastRun;
  })().finally(() => { running = null; });
  return running;
}

/* ---------- แปลข่าวภาษาอังกฤษเป็นไทย ---------- */
// แปลเฉพาะข่าวที่จะขึ้นเว็บ (รอตรวจ/อนุมัติ) ที่ยังไม่มีคำแปล ใหม่สุดก่อน รอบละไม่เกิน 40 ข่าว ที่เหลือแปลรอบถัดไป
async function translatePending(limit = 40) {
  const p = translate.provider();
  const todo = p === "off" ? [] : state.news.filter((n) => n.lang === "en" && !n.titleTh && (n.status === "pending" || n.status === "approved")).sort(byNew).slice(0, limit);
  const out = await translate.translateItems(todo);
  let done = 0;
  for (let i = 0; i < todo.length; i++) {
    if (!out[i]) continue;
    Object.assign(todo[i], out[i]);
    try { await store.setNewsTh(todo[i]); done++; } catch (e) { console.error("save translation failed:", e.message); }
  }
  return { provider: p, tried: todo.length, done };
}

/* ---------- ส่งออกให้หน้าเว็บ ---------- */
const srcName = (id) => (cfg().sources.find((s) => s.id === id) || {}).name || id;
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } }
// เครดิตแหล่งที่มา: ชื่อสำนักข่าว + โดเมนของบทความต้นฉบับ + หน้าแรกของเว็บนั้น
const view = (n) => {
  const d = host(n.link);
  return { ...n, sourceName: srcName(n.source), sourceDomain: d, sourceHome: d ? `https://${new URL(n.link).hostname}/` : "", catName: CATS[n.cat] || n.cat };
};
// รายชื่อแหล่งข่าวที่มีข่าวขึ้นเว็บ (ใช้ทำกล่องเครดิตท้ายหน้าข่าว)
function creditList() {
  const seen = new Map();
  for (const n of state.news) if (n.status === "approved" && !seen.has(n.source)) seen.set(n.source, view(n));
  return [...seen.values()].map((v) => ({ name: v.sourceName, domain: v.sourceDomain, home: v.sourceHome, cat: v.catName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function byNew(a, b) { return b.published.localeCompare(a.published); }

function register(app) {
  // ข่าวที่อนุมัติแล้ว (ต้องล็อกอินตามกฎของเว็บ)
  app.get("/api/news", (req, res) => {
    const cat = String(req.query.cat || "");
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 30));
    const approved = state.news.filter((n) => n.status === "approved");
    const counts = Object.fromEntries(Object.keys(CATS).map((k) => [k, approved.filter((n) => n.cat === k).length]));
    const items = approved.filter((n) => !cat || n.cat === cat).sort(byNew);
    res.json({ items: items.slice(0, limit).map(view), total: items.length, counts, cats: CATS, sources: creditList(), updated: lastRun && lastRun.at });
  });

  // ---- admin ----
  app.get("/api/admin/news", auth.requireAdmin, (req, res) => {
    const status = String(req.query.status || "pending");
    const counts = { pending: 0, approved: 0, rejected: 0, filtered: 0 };
    state.news.forEach((n) => { counts[n.status] = (counts[n.status] || 0) + 1; });
    res.json({ items: state.news.filter((n) => n.status === status).sort(byNew).slice(0, 200).map(view), counts, lastRun, running: !!running });
  });
  app.post("/api/admin/news/status", auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
    if (!["approved", "rejected", "pending"].includes(b.status)) return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
    if (!ids.length) return res.status(400).json({ error: "ยังไม่ได้เลือกข่าว" });
    const set = new Set(ids);
    const hit = state.news.filter((n) => set.has(n.id));
    try {
      await store.setNewsStatus(hit.map((n) => n.id), b.status);
      hit.forEach((n) => { n.status = b.status; if (b.status !== "filtered") n.reason = ""; });
      res.json({ updated: hit.length });
    } catch (e) { console.error("news status failed:", e.message); res.status(500).json({ error: "บันทึกไม่สำเร็จ" }); }
  });
  app.post("/api/admin/news/fetch", auth.requireAdmin, async (_, res) => {
    try { res.json(await runFetch()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/admin/news/config", auth.requireAdmin, (_, res) => res.json({ ...cfg(), cats: CATS, interval: INTERVAL / 60000, translator: translate.provider() }));
  app.put("/api/admin/news/config", auth.requireAdmin, async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.sources) || b.sources.length > 40) return res.status(400).json({ error: "รายการแหล่งข่าวไม่ถูกต้อง" });
    const seen = new Set(), sources = [];
    for (const s of b.sources) {
      const name = String(s.name || "").trim().slice(0, 40), url = String(s.url || "").trim();
      if (!name) return res.status(400).json({ error: "แหล่งข่าวต้องมีชื่อ" });
      if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 500) return res.status(400).json({ error: `ลิงก์ RSS ของ "${name}" ไม่ถูกต้อง` });
      if (!CATS[s.cat]) return res.status(400).json({ error: `หมวดของ "${name}" ไม่ถูกต้อง` });
      let id = String(s.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "src" + sources.length;
      while (seen.has(id)) id += "x";
      seen.add(id);
      const site = String(s.site || "").trim().toLowerCase().replace(/^www\./, "");
      sources.push({ id, name, url, site: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site) ? site : "", cat: s.cat, lang: s.lang === "en" ? "en" : "th", enabled: !!s.enabled, auto: !!s.auto });
    }
    const block = (Array.isArray(b.block) ? b.block : String(b.block || "").split(/[\n,]/)).map((w) => String(w).trim()).filter(Boolean).slice(0, 300);
    try { await store.saveSetting("news", { ver: CFG_VER, sources, block }); res.json({ ...cfg(), cats: CATS }); }
    catch (e) { console.error("news config failed:", e.message); res.status(500).json({ error: "บันทึกไม่สำเร็จ" }); }
  });
}

function start() {
  if (process.env.NEWS_DISABLED === "true") return;
  setTimeout(() => runFetch().catch((e) => console.error("news fetch failed:", e.message)), 20000).unref();
  setInterval(() => runFetch().catch((e) => console.error("news fetch failed:", e.message)), INTERVAL).unref();
}

module.exports = { register, start, runFetch, parseFeed, translatePending };
