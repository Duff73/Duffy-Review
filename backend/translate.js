// แปลหัวข้อและสรุปข่าวภาษาอังกฤษเป็นภาษาไทย
//   ตั้ง ANTHROPIC_API_KEY  -> ใช้ Claude แปล (สำนวนดีกว่า, มีค่าใช้จ่ายตามการใช้งาน)
//   ไม่ตั้ง                  -> ใช้ Google Translate แบบฟรี (ไม่ต้องสมัคร แต่เป็นบริการไม่เป็นทางการ อาจใช้ไม่ได้บางช่วง)
//   TRANSLATE_DISABLED=true -> ปิดการแปล (แสดงภาษาต้นฉบับ)
const MODEL = process.env.TRANSLATE_MODEL || "claude-opus-5-5";
let claude = null;
function claudeClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!claude) { const Anthropic = require("@anthropic-ai/sdk"); claude = new Anthropic(); }
  return claude;
}
const provider = () => (process.env.TRANSLATE_DISABLED === "true" ? "off" : claudeClient() ? "claude" : "google");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Google Translate (ฟรี) ---------- */
async function google(text) {
  if (!text) return "";
  const u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=th&dt=t&q=" + encodeURIComponent(text);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    return (Array.isArray(d?.[0]) ? d[0].map((s) => s?.[0] || "").join("") : "").trim();
  } finally { clearTimeout(timer); }
}

/* ---------- Claude ---------- */
const SYSTEM = `You translate English gaming and technology news into natural Thai for a Thai game-review website.
Keep game titles, product names, company names, model numbers and platform names in their original English form.
Translate faithfully: do not add, remove or editorialize facts. Use a neutral news tone.
Input is a JSON array of {"i","title","summary"}. Reply with only a JSON array of {"i","title","summary"} in Thai, same order, no other text.`;
async function claudeBatch(items) {
  const res = await claudeClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(items.map((n, i) => ({ i, title: n.title, summary: n.summary }))) }],
  });
  if (res.stop_reason !== "end_turn") throw new Error("stop_reason " + res.stop_reason);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return items.map((_, i) => out.find((o) => Number(o.i) === i) || null);
}

// คืนค่า [{ titleTh, summaryTh } | null] ตามลำดับเดิม (null = แปลไม่สำเร็จ ลองใหม่รอบหน้า)
async function translateItems(items) {
  const mode = provider();
  if (mode === "off" || !items.length) return items.map(() => null);
  if (mode === "claude") {
    const out = [];
    for (let k = 0; k < items.length; k += 10) {
      const part = items.slice(k, k + 10);
      try {
        (await claudeBatch(part)).forEach((o) => out.push(o && o.title ? { titleTh: String(o.title).slice(0, 400), summaryTh: String(o.summary || "").slice(0, 500) } : null));
      } catch (e) {
        console.error("translate (claude) failed, using Google instead:", e.message);
        for (const n of part) out.push(await googleItem(n));
      }
    }
    return out;
  }
  const out = [];
  for (const n of items) out.push(await googleItem(n));
  return out;
}
async function googleItem(n) {
  try {
    const titleTh = await google(n.title);
    const summaryTh = n.summary ? await google(n.summary) : "";
    return titleTh ? { titleTh: titleTh.slice(0, 400), summaryTh: summaryTh.slice(0, 500) } : null;
  } catch (e) {
    console.error("translate (google) failed:", e.name === "AbortError" ? "timeout" : e.message);
    return null;
  } finally { await sleep(250); }
}

module.exports = { translateItems, provider };
