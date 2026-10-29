-- ตัวอย่างคำสั่งที่ใช้บ่อย (phpMyAdmin > เลือกฐานข้อมูล > แท็บ SQL)
-- หน้าเว็บจะเห็นการแก้ไขภายในประมาณ 1 นาที

-- 1) เพิ่มเกมใหม่ (ต้องใส่ครบทุกคอลัมน์ จุดเด่น/จุดด้อยเขียนเป็น JSON array)
INSERT INTO games (title, category, age, score, release_date, description, review, pros, cons, platforms, image, hue)
VALUES ('ชื่อเกมใหม่', 'แอคชัน', 12, 8.5, CURDATE(), 'คำอธิบายสั้น', 'เนื้อรีวิวเต็ม',
        '["จุดเด่น 1","จุดเด่น 2"]', '["จุดด้อย 1"]', 'PC · PS5', 'images/new-game.jpg', 120);

-- 2) แก้ชื่อเกม / คะแนน / รูป
UPDATE games SET title = 'ชื่อใหม่' WHERE id = 2;
UPDATE games SET score = 9.1 WHERE title = 'Stellar Odyssey';
UPDATE games SET image = 'images/dragon-blade.jpg' WHERE id = 1;

-- 3) ลบเกม (ยอดวิวและคอมเมนต์ของเกมนั้นถูกลบตาม)
DELETE FROM games WHERE id = 12;

-- 4) ดูยอดวิวรวมของแต่ละเกม เรียงมากไปน้อย
SELECT g.id, g.title, g.base_views + IFNULL(v.`count`, 0) AS total_views
FROM games g LEFT JOIN views v ON v.game_id = g.id
ORDER BY total_views DESC;

-- 5) ดูความคิดเห็นล่าสุด
SELECT c.id, g.title, c.name, c.rating, c.`text`, c.`date`
FROM comments c JOIN games g ON g.id = c.game_id
ORDER BY c.`date` DESC LIMIT 50;

-- 6) ลบความคิดเห็นสแปม
DELETE FROM comments WHERE id = 'ใส่ id ของคอมเมนต์';

-- 7) รีเซ็ตยอดวิวทั้งหมดเป็น 0
UPDATE views SET `count` = 0;
