-- Duffy Review : MySQL / MariaDB schema (นำเข้าผ่าน phpMyAdmin ได้)
-- รันซ้ำได้ปลอดภัย (IF NOT EXISTS) เซิร์ฟเวอร์จะรันไฟล์นี้อัตโนมัติตอนเริ่มทำงาน ถ้า DATABASE_URL ขึ้นต้นด้วย mysql://

CREATE TABLE IF NOT EXISTS games (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  category     VARCHAR(50)  NOT NULL,
  age          INT          NOT NULL,
  score        DECIMAL(3,1) NOT NULL,
  base_views   INT          NOT NULL DEFAULT 0,
  release_date DATE         NOT NULL,
  description  TEXT         NOT NULL,
  review       TEXT         NOT NULL,
  pros         TEXT         NOT NULL,
  cons         TEXT         NOT NULL,
  platforms    VARCHAR(200) NOT NULL DEFAULT '',
  image        VARCHAR(500) NOT NULL DEFAULT '',
  hue          INT          NOT NULL DEFAULT 200,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY games_category_idx (category),
  KEY games_age_idx (age),
  CONSTRAINT games_age_chk CHECK (age IN (3, 7, 12, 16, 18)),
  CONSTRAINT games_score_chk CHECK (score BETWEEN 0 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS views (
  game_id INT PRIMARY KEY,
  `count` INT NOT NULL DEFAULT 0,
  CONSTRAINT views_game_fk FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id      VARCHAR(32)  PRIMARY KEY,
  game_id INT          NOT NULL,
  name    VARCHAR(30)  NOT NULL,
  `text`  VARCHAR(600) NOT NULL,
  rating  INT          NULL,
  `date`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY comments_game_idx (game_id, `date`),
  CONSTRAINT comments_game_fk FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  CONSTRAINT comments_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
