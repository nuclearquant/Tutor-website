# What changed, and what to do next

Four things were asked for. Three are finished and working now. The fourth
— the MySQL password manager — is built and tested, but it needs about
twenty minutes of setup on a host before it does anything.

---

## 1. Your login is now tapz007 / 19458779

Open `admin.html` and use:

| | |
|---|---|
| Username | **tapz007** |
| PIN | **19458779** |

Browsers that already hold the old `admin` / `1234` login are rewritten
automatically the first time they open a dashboard, so you do not have to
clear anything. Your three registered devices survive the change.

Change the PIN under **Setup** once you are in. To change the *username*
as well, edit these two lines near the top of `nz-store.js` and bump the
version number below them:

```js
var ADMIN_USER = 'tapz007';
var ADMIN_PIN  = '19458779';
var CREDS_VERSION = 2;      // <- change to 3 to force the new details out
```

---

## 2. Why the students and tutors could not sign in

There were two separate causes. Only one of them was a bug.

### The bug

`studentLogin` refused anybody unless **both** `status === 'active'` **and**
`active === true`. But students saved before the `active` flag existed came
back with `active` undefined — so a perfectly correct password was rejected
with *"that username or password does not match."* Tutors had the same hole.

Both are fixed, and old saved data is repaired on load. Tested: a student
record in the old format now signs in with the exact password, and also
with `" Naledi "` / `" Orbit9325 "` — spaces and capitals that a WhatsApp
paste drags along.

### The part that is not a bug

**localStorage lives in one browser on one device.** When you register a
student on your laptop, the account exists *only* on your laptop. Their
phone has an empty database, so there is nothing there to check a password
against. Nothing written in the page can reach across that gap — this is
what sections 3 and 4 below are for.

### The screens now tell you which is which

Instead of one message blaming the password for everything, the sign-in
screens now say what actually happened: unknown username, booking not
accepted yet, account paused, no password issued, or wrong password. That
alone should stop most of the guessing.

---

## 3. The header and the slideshow

**Book a lesson** was one of four saturated colours fighting each other at
the right-hand edge. It is now a navy pill that echoes your logo — cyan
ring, orange nucleus — separated from the three sign-in pills by a hairline.
It reads as the single main action instead of a fourth competing colour,
and shortens to "Book" on small screens.

**Inside a lesson** now holds twelve of your photographs. The row of
anonymous dots became a strip of thumbnails, because thirteen dots tell a
visitor nothing while a contact sheet lets them see everything at once.

Portrait phone photos are shown *whole* against a blurred copy of
themselves rather than cropped to fit a wide frame — cropping was cutting
learners' heads off. Photos were resized for the web: a 6 MB phone photo is
now about 150 KB, and only the first one loads up front.

> **The `img/` folder must travel with `index.html`.** If you move the site,
> move the folder too, or the slideshow will be empty.

One photo, `IMG_20180802_190811.jpg`, was left out because it is visibly out
of focus. To add it back, resize it into `img/` and copy any existing
`<figure class="slide slide--tall">` block in `index.html`.

---

## 4. The MySQL password manager

Two files: `nz-auth.sql` (the database) and `nz-api.php` (the wire between
the browser and the database). Both were loaded into a real MySQL server and
exercised end to end, not just written.

### What it fixes

Accounts stop living inside one browser. A student signs in on their own
phone, from anywhere, because the check happens on the server.

### Setting it up

You need any host with PHP and MySQL — most South African shared hosting
from about R40 a month has both.

1. **Make the database.** In cPanel → phpMyAdmin, paste the whole of
   `nz-auth.sql` into the SQL tab and run it. Or from a terminal:
   `mysql -u root -p < nz-auth.sql`
2. **Make a database user** in cPanel → MySQL Databases, give it all
   privileges on the new database, and note the name and password. (The
   `CREATE USER` at the bottom of the SQL file does the same thing if your
   host allows it; if it fails, that is fine — everything above it worked.)
3. **Fill in four lines** at the top of `nz-api.php`:

   ```php
   const DB_HOST = 'localhost';
   const DB_NAME = 'nuclear_zone';     // cPanel usually prefixes this
   const DB_USER = 'nz_web';           // and this
   const DB_PASS = 'your real password here';
   ```
4. **Upload** `nz-api.php` alongside `index.html`.
5. **Turn on HTTPS.** Passwords will be crossing the internet. Free with
   Let's Encrypt, one toggle in most control panels. Do not skip this.

### How passwords are kept

As bcrypt hashes, never as text. Nobody can read an existing password back
— **including you.** That is a deliberate trade: if the database is ever
stolen, the passwords in it are useless.

It does change your routine. Today you can look up a student's password and
resend it. From now on you press reset, the new password is shown **once**,
you send it, and it is gone. Same as the tutor PINs already work.

### The bit you will actually use

When somebody says their password is not working, stop guessing:

```sql
SELECT * FROM v_cannot_sign_in;
```

One row per person who cannot get in, with the reason spelled out. And for
one specific person:

```sql
SELECT at, ok, reason, ip FROM login_attempts
 WHERE username = 'naledi' ORDER BY at DESC LIMIT 20;
```

That tells you whether they mistyped, used the wrong username, or were
never sent a password at all.

Other views: `v_accounts` (every login and its state), `v_never_signed_in`
(password sent, never used — the WhatsApp probably never arrived),
`v_recent_failures` (the last week, worst first).

### What was found by testing it

Three faults that reading alone would not have caught:

- The nightly cleanup task aborted the whole import, so the admin account
  was never created. Moved and wrapped correctly.
- The tables were silently taking the *server's* default collation instead
  of the database's, which broke every procedure that compares a username.
  Invisible until you run it.
- `CREATE USER` and `SET GLOBAL` sat mid-file, where a shared host refusing
  them would kill everything after. Both moved to the end.

Also verified: a student cannot list accounts or reset anyone's password, a
forged session token is refused, SQL injection in the username field does
nothing, you cannot suspend your own console, and the fourth device is
turned away.

### Still to wire

`nz-api.php` handles accounts and sign-in. Lessons, messages and complaints
still read from `nz-store.js`. To move those too, replace `load()` and
`save()` in that file with calls to the API — every dashboard only ever
calls `NZ.lessons()`, `NZ.acceptStudent()` and so on, so nothing else needs
touching.

---

## One thing to sort out before this goes public

Several of the photographs show identifiable learners who look like minors.
Under POPIA you need parental consent on file before their faces appear on a
public website. A WhatsApp to each parent asking for a yes in writing, kept
somewhere safe, is enough — but do it before the site goes live, not after
somebody asks.

The same clause about message oversight from the earlier README still
applies: *"messages sent through this platform may be reviewed by
NUCLEAR-ZONE management."*
