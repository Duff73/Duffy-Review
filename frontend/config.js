// ใส่ URL ของ backend บน Render (ไม่ต้องมี / ท้าย) หลัง deploy แล้ว
window.DUFFY_API_URL =
  ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "http://localhost:3000"
    : "https://duffy-review.onrender.com";
