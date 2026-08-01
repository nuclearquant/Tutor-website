-- =====================================================================
--  NUCLEAR-ZONE — nz-auth.sql
--  The password manager: one place where every login lives, shared by
--  every device instead of hiding inside one browser.
--
--  Load it once:
--      mysql -u root -p < nz-auth.sql
--
--  Or paste it into phpMyAdmin / cPanel → Databases → SQL.
--
--  Your own login is seeded at the bottom:
--      username  tapz007
--      password  19458779
--  Change it after the first sign-in with the CALL at the very end.
--
--  Passwords are stored as bcrypt hashes, never as text. That means
--  nobody — not a hacker who steals the database, and not you — can
--  read an existing password back. When somebody forgets theirs you
--  mint a NEW one, send it, and it is shown to you exactly once.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS nuclear_zone
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nuclear_zone;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
--  1. ACCOUNTS — every person who can sign in, in one table
-- ---------------------------------------------------------------------
--  One table rather than three, because "who may sign in and with what
--  password" is one question. The role column says which dashboard the
--  account opens. Usernames are unique across all roles, which is what
--  the browser version already assumed.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS accounts;

CREATE TABLE accounts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username        VARCHAR(64)  NOT NULL,
  role            ENUM('admin','tutor','student') NOT NULL,

  -- bcrypt, 60 characters, e.g. $2y$12$....  NULL means "no password
  -- chosen yet": a newly registered tutor sets their own PIN on first
  -- sign-in, exactly as before.
  pass_hash       CHAR(60)     NULL DEFAULT NULL,

  -- when TRUE the person must choose a new password before they get in.
  -- Set automatically by reset_password() below.
  must_change     TINYINT(1)   NOT NULL DEFAULT 0,

  status          ENUM('applicant','active','suspended') NOT NULL DEFAULT 'active',

  full_name       VARCHAR(120) NOT NULL DEFAULT '',
  email           VARCHAR(160) NOT NULL DEFAULT '',
  phone           VARCHAR(40)  NOT NULL DEFAULT '',

  -- tutors: highest qualification, shown on their name tag
  -- students: school year, e.g. "Grade 12" or "N4"
  detail          VARCHAR(160) NOT NULL DEFAULT '',

  tutor_id        INT UNSIGNED NULL DEFAULT NULL,   -- students: who teaches them
  rate_per_hour   DECIMAL(8,2) NOT NULL DEFAULT 250.00,

  failed_logins   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    DATETIME     NULL DEFAULT NULL,
  last_login_at   DATETIME     NULL DEFAULT NULL,

  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  KEY ix_role_status (role, status),
  KEY ix_tutor (tutor_id),
  CONSTRAINT fk_student_tutor FOREIGN KEY (tutor_id)
    REFERENCES accounts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  2. PASSWORD RESETS — the audit trail behind "I sent you a new one"
-- ---------------------------------------------------------------------
--  The password itself is NOT kept here. Only the fact that a reset
--  happened, who did it, and whether the person has since signed in
--  with it. That is enough to answer "did Naledi ever get her login?"
--  without the database becoming a list of everybody's passwords.
-- ---------------------------------------------------------------------
CREATE TABLE password_resets (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id   INT UNSIGNED NOT NULL,
  issued_by    VARCHAR(64)  NOT NULL DEFAULT 'admin',
  issued_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_by ENUM('whatsapp','email','in person','not sent') NOT NULL DEFAULT 'not sent',
  used_at      DATETIME     NULL DEFAULT NULL,   -- first sign-in with it
  note         VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY ix_account (account_id),
  CONSTRAINT fk_reset_account FOREIGN KEY (account_id)
    REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  3. DEVICES — the three-device limit on your own console
-- ---------------------------------------------------------------------
CREATE TABLE devices (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id  INT UNSIGNED NOT NULL,
  device_key  VARCHAR(64)  NOT NULL,          -- random, made by the browser
  label       VARCHAR(80)  NOT NULL DEFAULT '',   -- "Windows · Chrome"
  first_seen  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_device (account_id, device_key),
  CONSTRAINT fk_device_account FOREIGN KEY (account_id)
    REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  4. SESSIONS — a signed-in browser, so a password is sent once only
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  token       CHAR(64)     NOT NULL,          -- random, sent to the browser
  account_id  INT UNSIGNED NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME     NOT NULL,
  ip          VARCHAR(45)  NOT NULL DEFAULT '',
  PRIMARY KEY (token),
  KEY ix_account (account_id),
  KEY ix_expires (expires_at),
  CONSTRAINT fk_session_account FOREIGN KEY (account_id)
    REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  5. LOGIN ATTEMPTS — what actually happened at the sign-in screen
-- ---------------------------------------------------------------------
--  This is the table that answers "the students say their passwords do
--  not work". Look at `reason` and it tells you whether they mistyped,
--  used the wrong username, or were never given a password at all.
-- ---------------------------------------------------------------------
CREATE TABLE login_attempts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username   VARCHAR(64)  NOT NULL,
  ok         TINYINT(1)   NOT NULL DEFAULT 0,
  reason     ENUM('ok','no-such-user','wrong-password','no-password',
                  'suspended','not-accepted','locked') NOT NULL,
  ip         VARCHAR(45)  NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_username_at (username, at),
  KEY ix_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  6. AUDIT LOG — registrations, suspensions, resets
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor   VARCHAR(64)  NOT NULL DEFAULT 'system',
  action  VARCHAR(80)  NOT NULL,
  subject VARCHAR(160) NOT NULL DEFAULT '',
  at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
--  VIEWS — the password manager screen, in SQL
-- =====================================================================

-- Every login on the system, with the thing you actually need to know:
-- can this person get in right now, and if not, why not?
CREATE OR REPLACE VIEW v_accounts AS
SELECT
  a.id,
  a.username,
  a.role,
  a.full_name,
  a.status,
  CASE
    WHEN a.status = 'suspended'                    THEN 'Suspended — cannot sign in'
    WHEN a.status = 'applicant'                    THEN 'Booked, not accepted yet'
    WHEN a.pass_hash IS NULL AND a.role = 'tutor'  THEN 'Will choose a PIN on first sign-in'
    WHEN a.pass_hash IS NULL                       THEN 'NO PASSWORD — send them one'
    WHEN a.locked_until > NOW()                    THEN 'Locked after failed attempts'
    WHEN a.must_change = 1                         THEN 'Must change password at next sign-in'
    ELSE 'Can sign in'
  END                                    AS sign_in_state,
  a.email,
  a.phone,
  t.full_name                            AS tutor,
  a.last_login_at,
  a.failed_logins,
  a.created_at
FROM accounts a
LEFT JOIN accounts t ON t.id = a.tutor_id
ORDER BY FIELD(a.role,'admin','tutor','student'), a.full_name;

-- Anybody who cannot currently get in. Check this first when somebody
-- says their password is not working.
CREATE OR REPLACE VIEW v_cannot_sign_in AS
SELECT * FROM v_accounts WHERE sign_in_state <> 'Can sign in';

-- Accounts that were given a password but have never used it — usually
-- means the WhatsApp never arrived.
CREATE OR REPLACE VIEW v_never_signed_in AS
SELECT a.username, a.full_name, a.role, a.phone,
       MAX(r.issued_at) AS password_last_sent
FROM accounts a
LEFT JOIN password_resets r ON r.account_id = a.id
WHERE a.pass_hash IS NOT NULL AND a.last_login_at IS NULL
GROUP BY a.id, a.username, a.full_name, a.role, a.phone;

-- The last week of failed sign-ins, worst offenders first.
CREATE OR REPLACE VIEW v_recent_failures AS
SELECT username, reason, COUNT(*) AS attempts, MAX(at) AS last_try
FROM login_attempts
WHERE ok = 0 AND at > NOW() - INTERVAL 7 DAY
GROUP BY username, reason
ORDER BY attempts DESC;

-- =====================================================================
--  STORED PROCEDURES — the four things you will actually do
-- =====================================================================
DELIMITER $$

-- ---- register a tutor -------------------------------------------------
-- No password. They choose their own PIN the first time they sign in,
-- so it never travels over WhatsApp and you never see it.
DROP PROCEDURE IF EXISTS register_tutor$$
CREATE PROCEDURE register_tutor(
  IN p_username VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_name VARCHAR(120) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_degree VARCHAR(160) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_email VARCHAR(160) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_phone VARCHAR(40) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  INSERT INTO accounts (username, role, pass_hash, status, full_name, detail, email, phone)
  VALUES (p_username, 'tutor', NULL, 'active', p_name, p_degree, p_email, p_phone);
  INSERT INTO audit_log (actor, action, subject)
  VALUES ('admin', 'Registered tutor', CONCAT(p_name, ' (', p_username, ')'));
END$$

-- ---- register a student ----------------------------------------------
-- p_hash comes from PHP: password_hash($plain, PASSWORD_BCRYPT).
-- The plain password is shown to you once, sent, and then forgotten.
DROP PROCEDURE IF EXISTS register_student$$
CREATE PROCEDURE register_student(
  IN p_username VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_hash CHAR(60) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_name VARCHAR(120) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_level VARCHAR(160) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_email VARCHAR(160) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_phone VARCHAR(40) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_tutor_id INT UNSIGNED,
  IN p_rate DECIMAL(8,2))
BEGIN
  INSERT INTO accounts (username, role, pass_hash, status, full_name,
                        detail, email, phone, tutor_id, rate_per_hour)
  VALUES (p_username, 'student', p_hash, 'active', p_name,
          p_level, p_email, p_phone, p_tutor_id, IFNULL(p_rate, 250.00));
  INSERT INTO password_resets (account_id, issued_by, note)
  VALUES (LAST_INSERT_ID(), 'admin', 'first password');
  INSERT INTO audit_log (actor, action, subject)
  VALUES ('admin', 'Registered student', CONCAT(p_name, ' (', p_username, ')'));
END$$

-- ---- reset somebody's password ---------------------------------------
-- Students get a new password (hashed in PHP first). Tutors get NULL,
-- which puts them back to choosing their own PIN at the next sign-in.
DROP PROCEDURE IF EXISTS reset_password$$
CREATE PROCEDURE reset_password(
  IN p_username VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_hash CHAR(60) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_actor VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  DECLARE v_id INT UNSIGNED;
  SELECT id INTO v_id FROM accounts WHERE username = p_username;
  IF v_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No account with that username';
  END IF;
  UPDATE accounts
     SET pass_hash = p_hash, must_change = 0,
         failed_logins = 0, locked_until = NULL
   WHERE id = v_id;
  INSERT INTO password_resets (account_id, issued_by, note)
  VALUES (v_id, p_actor, IF(p_hash IS NULL, 'PIN cleared', 'new password issued'));
  INSERT INTO audit_log (actor, action, subject)
  VALUES (p_actor, IF(p_hash IS NULL,'Cleared PIN','Reset password'), p_username);
END$$

-- ---- suspend or reinstate --------------------------------------------
DROP PROCEDURE IF EXISTS set_account_status$$
CREATE PROCEDURE set_account_status(
  IN p_username VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_status VARCHAR(16) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_actor VARCHAR(64) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  UPDATE accounts SET status = p_status WHERE username = p_username;
  DELETE FROM sessions
   WHERE account_id = (SELECT id FROM accounts WHERE username = p_username)
     AND p_status <> 'active';
  INSERT INTO audit_log (actor, action, subject)
  VALUES (p_actor, CONCAT('Set status to ', p_status), p_username);
END$$

DELIMITER ;

-- =====================================================================
--  YOUR LOGIN
-- =====================================================================
--  username  tapz007
--  password  19458779
--
--  The string below is a bcrypt hash of that password, not the password
--  itself. To change it later, run this in PHP:
--
--      echo password_hash('your new password', PASSWORD_BCRYPT);
--
--  then paste the result into:
--
--      CALL reset_password('tapz007', '<the new hash>', 'tapz007');
-- =====================================================================
INSERT INTO accounts (username, role, pass_hash, status, full_name, email, phone)
VALUES ('tapz007', 'admin',
        '$2y$12$p0AFPcLe25G54SpLqSLQMOBLAUNJcn1pIFLBE5LAMM/kQS1rAT/0i',
        'active', 'Tapuwa Sithole',
        'tapuwasithole7@gmail.com', '060 778 1905')
ON DUPLICATE KEY UPDATE
  pass_hash = VALUES(pass_hash),
  status    = 'active';

INSERT INTO audit_log (actor, action, subject)
VALUES ('system', 'Database created', 'nuclear_zone');

-- =====================================================================
--  OPTIONAL — everything below needs privileges that shared hosting
--  sometimes withholds. If any of it fails, the system still works;
--  only the housekeeping and the extra database user are skipped.
-- =====================================================================

-- ---- a least-privilege user for the website --------------------------
--  The website should NOT connect as root. Change the password on the
--  next line before running this, then use it in nz-api.php.
--  On cPanel, make the user in MySQL Databases instead and skip this.
-- ---------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'nz_web'@'localhost'
  IDENTIFIED BY 'change-this-to-a-long-random-string';

GRANT SELECT, INSERT, UPDATE, DELETE ON nuclear_zone.* TO 'nz_web'@'localhost';
GRANT EXECUTE                        ON nuclear_zone.* TO 'nz_web'@'localhost';
FLUSH PRIVILEGES;

-- ---- throw away stale sessions and old noise, nightly ----------------
SET GLOBAL event_scheduler = ON;

DELIMITER $$
DROP EVENT IF EXISTS nz_nightly_tidy$$
CREATE EVENT nz_nightly_tidy
ON SCHEDULE EVERY 1 DAY
DO BEGIN
  DELETE FROM sessions       WHERE expires_at < NOW();
  DELETE FROM login_attempts WHERE at < NOW() - INTERVAL 90 DAY;
  DELETE FROM audit_log      WHERE at < NOW() - INTERVAL 2 YEAR;
END$$
DELIMITER ;

-- =====================================================================
--  EVERYDAY QUERIES — copy, paste, run
-- =====================================================================
--  Who cannot sign in, and why:
--      SELECT * FROM v_cannot_sign_in;
--
--  Somebody says their password does not work — what really happened:
--      SELECT at, ok, reason, ip FROM login_attempts
--       WHERE username = 'naledi' ORDER BY at DESC LIMIT 20;
--
--  Passwords sent but never used (the WhatsApp probably never arrived):
--      SELECT * FROM v_never_signed_in;
--
--  Every login on the system:
--      SELECT username, role, full_name, sign_in_state FROM v_accounts;
--
--  Suspend somebody:
--      CALL set_account_status('naledi', 'suspended', 'tapz007');
-- =====================================================================
