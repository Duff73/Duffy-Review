// ฝั่งซ้ายของหน้าเข้าสู่ระบบ/สมัครสมาชิก: คอลัมน์ปกเกมจริงในเว็บ เลื่อนช้าๆ + ปุ่มสลับโหมดมืด
(function () {
  const COLS = [
    ["Valorant.jpg", "Minecraft.jpg", "header.jpg", "AION 2.jpg"],
    ["Cyberpunk 2077.jpg", "Apex Legends.jpg", "Roblox.jpg"],
    ["phantom blade zero.jpg", "Dota 2.jpg", "Counter-Strike 2.jpg"],
    ["MWA_Meta.jpg", "Forza Horizon 6.jpg", "Overwatch 2 .jpg"],
  ];
  const img = (f) => `<img src="images/${encodeURIComponent(f)}" alt="" decoding="async" onerror="this.remove()">`;
  const cols = document.getElementById("cols");
  // ใส่ซ้ำ 4 รอบ: ครึ่งบนกับครึ่งล่างเหมือนกัน เลื่อน -50% แล้ววนต่อได้พอดี และยาวพอไม่ให้มีช่องว่าง
  if (cols) cols.innerHTML = COLS.map((c) => `<div class="col">${c.map(img).join("").repeat(4)}</div>`).join("");

  // โหมดสว่าง/มืด (ใช้ค่าเดียวกับหน้าแรก)
  const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const root = document.documentElement, btn = document.getElementById("tg");
  const dark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const paint = () => { if (btn) btn.innerHTML = dark() ? sun : moon; };
  if (btn) btn.onclick = () => { const t = dark() ? "light" : "dark"; root.dataset.theme = t; try { localStorage.setItem("duffy-theme", t); } catch (_) {} paint(); };
  paint();
})();
