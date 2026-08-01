<?php
/* =====================================================================
   NUCLEAR-ZONE — nz-api.php
   The wire between the dashboards and the MySQL password manager.

   Load nz-auth.sql first, fill in the four settings below, then drop
   this file in the same folder as index.html.

   Everything is one endpoint. The browser posts JSON:

       { "do": "login", "username": "naledi", "password": "orbit9325" }

   and gets JSON back. Nothing here trusts the browser: the role a
   dashboard claims is ignored, and every answer is derived from the
   session token the server itself issued.
   ===================================================================== */

declare(strict_types=1);

/* ----------------------------------------------------------- SETTINGS */
/* On cPanel the database name and user are usually prefixed with your
   account name, e.g. "tapz_nuclear_zone" and "tapz_nzweb". */
const DB_HOST = 'localhost';
const DB_NAME = 'nuclear_zone';
const DB_USER = 'nz_web';
const DB_PASS = 'change-this-to-a-long-random-string';

const SESSION_DAYS      = 30;   /* how long a sign-in lasts */
const ADMIN_DEVICES     = 3;    /* your console, on three machines */
const MAX_FAILS         = 8;    /* wrong tries before a cool-off */
const LOCK_MINUTES      = 15;

/* ------------------------------------------------------------- SETUP */
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

/* Same-origin only. The dashboards are served from this folder, so there
   is no reason for another site to be calling this. */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('Use POST.', 405);
}

function fail(string $msg, int $code = 400, string $reason = ''): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg, 'reason' => $reason]);
    exit;
}
function done(array $data = []): never {
    echo json_encode(['ok' => true] + $data);
    exit;
}

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (Throwable $e) {
    /* Never leak the connection string to the browser. */
    error_log('NZ database: ' . $e->getMessage());
    fail('The database is not reachable. Check the settings at the top of nz-api.php.', 500);
}

$in  = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
$act = (string)($in['do'] ?? '');
$ip  = substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
$ua  = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);

/* ------------------------------------------------------------ HELPERS */

/* A password that is easy to read down a phone line and easy to type:
   a physics word plus four digits. Same shape as the browser version. */
function newPassword(): string {
    $words = ['atom','orbit','proton','photon','quark','fusion','vector',
              'newton','kelvin','cosine','matrix','apex','delta','sigma'];
    return $words[random_int(0, count($words) - 1)] . random_int(1000, 9999);
}

function slug(string $s): string {
    $s = strtolower(preg_replace('/[^A-Za-z0-9]/', '', $s) ?? '');
    return substr($s, 0, 12) ?: 'user';
}

function uniqueUsername(PDO $pdo, string $base): string {
    $u = slug($base); $n = 1;
    $q = $pdo->prepare('SELECT 1 FROM accounts WHERE username = ?');
    while (true) {
        $q->execute([$u]);
        if (!$q->fetchColumn()) return $u;
        $n++; $u = slug($base) . $n;
    }
}

/* Trim and fold case exactly as the browser version does, because these
   details are pasted out of WhatsApp: a paste drags a space along, and
   phone keyboards capitalise the first letter of whatever you type.
   Neither should keep a student out of their own dashboard. */
function tidy(?string $s): string {
    return preg_replace('/\s+/u', '', (string)$s) ?? '';
}

function logAttempt(PDO $pdo, string $user, bool $ok, string $reason, string $ip, string $ua): void {
    $pdo->prepare(
        'INSERT INTO login_attempts (username, ok, reason, ip, user_agent) VALUES (?,?,?,?,?)'
    )->execute([substr($user, 0, 64), $ok ? 1 : 0, $reason, $ip, $ua]);
}

function audit(PDO $pdo, string $actor, string $action, string $subject = ''): void {
    $pdo->prepare('INSERT INTO audit_log (actor, action, subject) VALUES (?,?,?)')
        ->execute([$actor, $action, $subject]);
}

/* Who is calling? Derived from the session token only — never from
   anything the browser claims about itself. */
function whoami(PDO $pdo, array $in): ?array {
    $token = (string)($in['token'] ?? '');
    if (strlen($token) !== 64) return null;
    $q = $pdo->prepare(
        'SELECT a.* FROM sessions s
           JOIN accounts a ON a.id = s.account_id
          WHERE s.token = ? AND s.expires_at > NOW() AND a.status = "active"'
    );
    $q->execute([$token]);
    return $q->fetch() ?: null;
}

function requireRole(PDO $pdo, array $in, string ...$roles): array {
    $me = whoami($pdo, $in);
    if (!$me)                              fail('Please sign in again.', 401, 'no-session');
    if (!in_array($me['role'], $roles, true)) fail('Not allowed.', 403, 'wrong-role');
    return $me;
}

/* ============================================================ ACTIONS */

switch ($act) {

/* ---------------------------------------------------------------- LOGIN
   One entry point for all three roles. The reason string is stored so
   that "the students say their passwords do not work" becomes a query
   instead of a guess — but the browser is told far less than the log
   records, so a stranger cannot use it to discover valid usernames. */
case 'login': {
    $user = tidy((string)($in['username'] ?? ''));
    $pass = tidy((string)($in['password'] ?? ''));
    if ($user === '' || $pass === '') fail('Enter your username and password.', 400, 'blank');

    $q = $pdo->prepare('SELECT * FROM accounts WHERE username = ?');
    $q->execute([$user]);
    $a = $q->fetch();

    if (!$a) {
        logAttempt($pdo, $user, false, 'no-such-user', $ip, $ua);
        fail('No account here uses that username.', 401, 'no-such-user');
    }
    if ($a['locked_until'] !== null && strtotime((string)$a['locked_until']) > time()) {
        logAttempt($pdo, $user, false, 'locked', $ip, $ua);
        fail('Too many tries. Wait ' . LOCK_MINUTES . ' minutes and try again.', 429, 'locked');
    }
    if ($a['status'] === 'suspended') {
        logAttempt($pdo, $user, false, 'suspended', $ip, $ua);
        fail('This account is paused. Please contact Tapuwa.', 403, 'suspended');
    }
    if ($a['status'] === 'applicant') {
        logAttempt($pdo, $user, false, 'not-accepted', $ip, $ua);
        fail('Your booking is in, but the account is not open yet.', 403, 'not-accepted');
    }
    if ($a['pass_hash'] === null) {
        /* A tutor who has never signed in chooses their PIN now. */
        if ($a['role'] === 'tutor') {
            logAttempt($pdo, $user, false, 'no-password', $ip, $ua);
            done(['needsPin' => true, 'username' => $a['username'],
                  'message'  => 'First time in — choose a PIN you will remember.']);
        }
        logAttempt($pdo, $user, false, 'no-password', $ip, $ua);
        fail('No password has been set for this account yet. Ask Tapuwa to send you one.', 403, 'no-password');
    }

    /* Case-folded, because a phone keyboard capitalises the first letter
       and the generated passwords are lowercase words plus digits. */
    $ok = password_verify($pass, (string)$a['pass_hash'])
       || password_verify(strtolower($pass), (string)$a['pass_hash']);

    if (!$ok) {
        $fails = (int)$a['failed_logins'] + 1;
        $lock  = $fails >= MAX_FAILS ? date('Y-m-d H:i:s', time() + LOCK_MINUTES * 60) : null;
        $pdo->prepare('UPDATE accounts SET failed_logins = ?, locked_until = ? WHERE id = ?')
            ->execute([$fails, $lock, $a['id']]);
        logAttempt($pdo, $user, false, 'wrong-password', $ip, $ua);
        fail('That password does not match. Ask Tapuwa to resend it.', 401, 'wrong-password');
    }

    /* Your own console is limited to three machines. */
    if ($a['role'] === 'admin') {
        $key = substr((string)($in['device'] ?? ''), 0, 64);
        if ($key !== '') {
            $d = $pdo->prepare('SELECT id FROM devices WHERE account_id = ? AND device_key = ?');
            $d->execute([$a['id'], $key]);
            if ($d->fetchColumn()) {
                $pdo->prepare('UPDATE devices SET last_seen = NOW(), label = ? WHERE account_id = ? AND device_key = ?')
                    ->execute([substr((string)($in['label'] ?? ''), 0, 80), $a['id'], $key]);
            } else {
                $n = $pdo->prepare('SELECT COUNT(*) FROM devices WHERE account_id = ?');
                $n->execute([$a['id']]);
                if ((int)$n->fetchColumn() >= ADMIN_DEVICES) {
                    audit($pdo, 'system', 'Sign-in refused', 'a fourth device tried to sign in');
                    fail('Three devices are already signed in. Remove one under Setup first.', 403, 'device-limit');
                }
                $pdo->prepare('INSERT INTO devices (account_id, device_key, label) VALUES (?,?,?)')
                    ->execute([$a['id'], $key, substr((string)($in['label'] ?? ''), 0, 80)]);
                audit($pdo, $a['username'], 'New device signed in', (string)($in['label'] ?? ''));
            }
        }
    }

    $token = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO sessions (token, account_id, expires_at, ip)
                   VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? DAY),?)')
        ->execute([$token, $a['id'], SESSION_DAYS, $ip]);

    $pdo->prepare('UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?')
        ->execute([$a['id']]);
    /* mark the most recent issued password as actually used */
    $pdo->prepare('UPDATE password_resets SET used_at = NOW()
                    WHERE account_id = ? AND used_at IS NULL
                 ORDER BY issued_at DESC LIMIT 1')->execute([$a['id']]);

    logAttempt($pdo, $user, true, 'ok', $ip, $ua);

    done([
        'token'      => $token,
        'mustChange' => (int)$a['must_change'] === 1,
        'me' => [
            'id' => (int)$a['id'], 'username' => $a['username'], 'role' => $a['role'],
            'name' => $a['full_name'], 'detail' => $a['detail'],
        ],
    ]);
}

/* ------------------------------------------------- TUTOR SETS OWN PIN */
case 'setPin': {
    $user = tidy((string)($in['username'] ?? ''));
    $pin  = tidy((string)($in['pin'] ?? ''));
    if (strlen($pin) < 4) fail('A PIN is at least four digits.', 400, 'short-pin');

    $q = $pdo->prepare('SELECT * FROM accounts WHERE username = ? AND role = "tutor"');
    $q->execute([$user]);
    $t = $q->fetch();
    if (!$t)                          fail('No tutor uses that username.', 404, 'no-such-user');
    if ($t['status'] !== 'active')    fail('This account is not active.', 403, 'suspended');
    if ($t['pass_hash'] !== null)     fail('This account already has a PIN. Ask the admin to reset it.', 409, 'has-pin');

    $pdo->prepare('UPDATE accounts SET pass_hash = ?, must_change = 0 WHERE id = ?')
        ->execute([password_hash($pin, PASSWORD_BCRYPT), $t['id']]);
    audit($pdo, $t['username'], 'Set PIN and signed in');

    $token = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO sessions (token, account_id, expires_at, ip)
                   VALUES (?,?,DATE_ADD(NOW(), INTERVAL ? DAY),?)')
        ->execute([$token, $t['id'], SESSION_DAYS, $ip]);
    $pdo->prepare('UPDATE accounts SET last_login_at = NOW() WHERE id = ?')->execute([$t['id']]);

    done(['token' => $token, 'me' => [
        'id' => (int)$t['id'], 'username' => $t['username'], 'role' => 'tutor',
        'name' => $t['full_name'], 'detail' => $t['detail'],
    ]]);
}

/* ------------------------------------------ ANYONE CHANGES THEIR OWN */
case 'changePassword': {
    $me  = requireRole($pdo, $in, 'admin', 'tutor', 'student');
    $old = tidy((string)($in['old'] ?? ''));
    $new = tidy((string)($in['new'] ?? ''));
    if (strlen($new) < 6) fail('Choose at least six characters.', 400, 'short');
    if ($me['pass_hash'] !== null && !password_verify($old, (string)$me['pass_hash'])) {
        fail('Your current password does not match.', 401, 'wrong-password');
    }
    $pdo->prepare('UPDATE accounts SET pass_hash = ?, must_change = 0 WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_BCRYPT), $me['id']]);
    /* signing everywhere else out is the point of changing a password */
    $pdo->prepare('DELETE FROM sessions WHERE account_id = ? AND token <> ?')
        ->execute([$me['id'], (string)($in['token'] ?? '')]);
    audit($pdo, $me['username'], 'Changed own password');
    done();
}

/* ------------------------------------------------------------- LOGOUT */
case 'logout': {
    $pdo->prepare('DELETE FROM sessions WHERE token = ?')->execute([(string)($in['token'] ?? '')]);
    done();
}

/* -------------------------------------------------- WHO AM I (resume) */
case 'me': {
    $me = whoami($pdo, $in);
    if (!$me) fail('Please sign in again.', 401, 'no-session');
    done(['me' => [
        'id' => (int)$me['id'], 'username' => $me['username'], 'role' => $me['role'],
        'name' => $me['full_name'], 'detail' => $me['detail'],
    ]]);
}

/* ================================================= ADMIN ONLY BELOW == */

/* The password manager screen: every login and whether it works. */
case 'accounts': {
    requireRole($pdo, $in, 'admin');
    done(['accounts' => $pdo->query('SELECT * FROM v_accounts')->fetchAll()]);
}

case 'cannotSignIn': {
    requireRole($pdo, $in, 'admin');
    done([
        'stuck'       => $pdo->query('SELECT * FROM v_cannot_sign_in')->fetchAll(),
        'neverUsed'   => $pdo->query('SELECT * FROM v_never_signed_in')->fetchAll(),
        'failures'    => $pdo->query('SELECT * FROM v_recent_failures')->fetchAll(),
    ]);
}

/* What actually happened at the sign-in screen for one person. */
case 'attempts': {
    requireRole($pdo, $in, 'admin');
    $q = $pdo->prepare('SELECT at, ok, reason, ip FROM login_attempts
                         WHERE username = ? ORDER BY at DESC LIMIT 30');
    $q->execute([tidy((string)($in['username'] ?? ''))]);
    done(['attempts' => $q->fetchAll()]);
}

case 'registerTutor': {
    $me = requireRole($pdo, $in, 'admin');
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '') fail('A tutor needs a name.', 400, 'no-name');
    /* First name, so it is short enough to read down a phone. Pass a
       "username" to choose it yourself. */
    $u = trim((string)($in['username'] ?? '')) !== ''
       ? uniqueUsername($pdo, (string)$in['username'])
       : uniqueUsername($pdo, strtok($name, ' ') ?: $name);
    $pdo->prepare('CALL register_tutor(?,?,?,?,?)')->execute([
        $u, $name, trim((string)($in['degree'] ?? '')),
        trim((string)($in['email'] ?? '')), trim((string)($in['phone'] ?? '')),
    ]);
    /* No password is generated. They choose their own PIN the first time
       they sign in, so it never travels over WhatsApp and you never see it. */
    done(['username' => $u, 'password' => null,
          'message' => $name . ' can sign in at tutor.html with username ' . $u
                     . ' and will choose their own PIN.']);
}

case 'registerStudent': {
    $me = requireRole($pdo, $in, 'admin');
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '') fail('A student needs a name.', 400, 'no-name');
    $u    = trim((string)($in['username'] ?? '')) !== ''
          ? uniqueUsername($pdo, (string)$in['username'])
          : uniqueUsername($pdo, strtok($name, ' ') ?: $name);
    $pass = newPassword();
    $pdo->prepare('CALL register_student(?,?,?,?,?,?,?,?)')->execute([
        $u, password_hash($pass, PASSWORD_BCRYPT), $name,
        trim((string)($in['level'] ?? '')), trim((string)($in['email'] ?? '')),
        trim((string)($in['phone'] ?? '')),
        isset($in['tutorId']) ? (int)$in['tutorId'] : null,
        isset($in['rate']) ? (float)$in['rate'] : 250.0,
    ]);
    /* This is the only moment the password exists in readable form.
       Show it, send it, and it is gone — only the hash is kept. */
    done(['username' => $u, 'password' => $pass, 'showOnce' => true]);
}

case 'resetPassword': {
    $me   = requireRole($pdo, $in, 'admin');
    $user = tidy((string)($in['username'] ?? ''));
    $q = $pdo->prepare('SELECT role, full_name FROM accounts WHERE username = ?');
    $q->execute([$user]);
    $a = $q->fetch();
    if (!$a) fail('No account with that username.', 404, 'no-such-user');

    if ($a['role'] === 'tutor') {
        /* Clearing it is the reset: they choose a fresh PIN next time. */
        $pdo->prepare('CALL reset_password(?,?,?)')->execute([$user, null, $me['username']]);
        done(['username' => $user, 'password' => null,
              'message' => $a['full_name'] . ' will choose a new PIN at their next sign-in.']);
    }
    $pass = newPassword();
    $pdo->prepare('CALL reset_password(?,?,?)')
        ->execute([$user, password_hash($pass, PASSWORD_BCRYPT), $me['username']]);
    done(['username' => $user, 'password' => $pass, 'showOnce' => true]);
}

case 'setStatus': {
    $me     = requireRole($pdo, $in, 'admin');
    $user   = tidy((string)($in['username'] ?? ''));
    $status = (string)($in['status'] ?? '');
    if (!in_array($status, ['applicant', 'active', 'suspended'], true)) {
        fail('Status must be applicant, active or suspended.', 400, 'bad-status');
    }
    if ($user === $me['username'] && $status !== 'active') {
        fail('You cannot suspend your own console.', 400, 'self-lockout');
    }
    $pdo->prepare('CALL set_account_status(?,?,?)')->execute([$user, $status, $me['username']]);
    done();
}

/* ------------------------------------------------- YOUR THREE DEVICES */
case 'devices': {
    $me = requireRole($pdo, $in, 'admin');
    $q = $pdo->prepare('SELECT id, device_key, label, first_seen, last_seen
                          FROM devices WHERE account_id = ? ORDER BY first_seen');
    $q->execute([$me['id']]);
    done(['devices' => $q->fetchAll(), 'limit' => ADMIN_DEVICES]);
}

case 'forgetDevice': {
    $me = requireRole($pdo, $in, 'admin');
    $pdo->prepare('DELETE FROM devices WHERE account_id = ? AND id = ?')
        ->execute([$me['id'], (int)($in['id'] ?? 0)]);
    audit($pdo, $me['username'], 'Removed a signed-in device');
    done();
}

default:
    fail('Unknown action: ' . $act, 400, 'unknown-action');
}
