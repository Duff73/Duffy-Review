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
  store_url    VARCHAR(500) NOT NULL DEFAULT '',
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

-- สมาชิก (รหัสผ่านเก็บเป็น hash แบบ scrypt ไม่เก็บรหัสจริง)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL UNIQUE,
  name          VARCHAR(30)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  profile       TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id      VARCHAR(32)  PRIMARY KEY,
  game_id INT          NOT NULL,
  user_id INT          NULL,
  name    VARCHAR(30)  NOT NULL,
  `text`  VARCHAR(600) NOT NULL,
  rating  INT          NULL,
  `date`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY comments_game_idx (game_id, `date`),
  KEY comments_user_idx (user_id),
  CONSTRAINT comments_game_fk FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  CONSTRAINT comments_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ดาวที่ผู้อ่านให้ (1 เบราว์เซอร์ต่อ 1 เกม เปลี่ยนดาวได้) ใช้คำนวณคะแนนรวม
CREATE TABLE IF NOT EXISTS ratings (
  game_id    INT         NOT NULL,
  voter      VARCHAR(64) NOT NULL,
  stars      INT         NOT NULL,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, voter),
  CONSTRAINT ratings_game_fk FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
  CONSTRAINT ratings_stars_chk CHECK (stars BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- รูปปกที่อัปโหลดจากหน้า admin (เสิร์ฟที่ /api/images/:id)
CREATE TABLE IF NOT EXISTS images (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  mime       VARCHAR(50) NOT NULL,
  data       MEDIUMBLOB  NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ข่าวสารจาก RSS (status: pending / approved / rejected / filtered)
CREATE TABLE IF NOT EXISTS news (
  id        VARCHAR(40)   PRIMARY KEY,
  source    VARCHAR(40)   NOT NULL,
  cat       VARCHAR(20)   NOT NULL,
  lang      VARCHAR(8)    NOT NULL DEFAULT '',
  title     VARCHAR(500)  NOT NULL,
  summary   TEXT          NOT NULL,
  link      VARCHAR(1000) NOT NULL,
  image     VARCHAR(1000) NOT NULL DEFAULT '',
  published DATETIME(3)   NOT NULL,
  fetched   DATETIME(3)   NOT NULL,
  status    VARCHAR(12)   NOT NULL DEFAULT 'pending',
  reason    VARCHAR(200)  NOT NULL DEFAULT '',
  KEY news_pub_idx (published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- การตั้งค่าที่แก้จากหน้า admin เก็บเป็น JSON
CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(50) PRIMARY KEY,
  v MEDIUMTEXT  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
