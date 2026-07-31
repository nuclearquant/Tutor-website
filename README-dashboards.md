# NUCLEAR-ZONE — website + dashboards

Your tutoring website now has three sign-ins built on top of it: one for you (the owner), one for each tutor, and one for each student.

| File | What it is |
|---|---|
| `index.html` | Your website. Header now has **Admin / Tutor / Student** login buttons, and the booking form registers an *application* |
| `admin.html` | **Your** console — every tutor, every student, every lesson, plus the activity log and Excel exports |
| `tutor.html` | A tutor's register — only *their* students and lessons |
| `student.html` | What a student or parent sees — their lessons, times and payments |
| `nz-store.js` | The one place all data is kept. Every screen reads from it |
| `nz-dash.css` | The shared skin for the three dashboards |

All files must sit in the **same folder**. No Node, no database, no monthly fee.

---

## Run it on your own machine first

```bash
cd ~/Downloads/nuclear-zone          # wherever you unzipped it
python3 -m http.server 8000
```

Then open <http://localhost:8000/index.html> and use the coloured buttons at the top, or go straight to:

| Who | Address | Demo sign-in |
|---|---|---|
| Admin (you) | `/admin.html` | username **admin**, PIN **1234** |
| Tutor | `/tutor.html` | username **tapuwa**, PIN **1234** |
| Student | `/student.html` | shown on the admin **Students** tab |

The demo comes with one tutor (you), three accepted students with working logins, and one application waiting to be accepted. Clear all of it under **Admin → Setup → Clear everything** once your real people are in.

> Open the files by double-clicking (a `file://` address) and the dashboards will not see each other's data — browsers treat every `file://` page as a stranger. Always **serve** them, or host them.

---

## Putting it online

Any static host works. The free ones that take a folder as-is:

- **Netlify Drop** — drag the folder onto <https://app.netlify.com/drop>. Live in seconds.
- **GitHub Pages** — push the folder to a repo, turn Pages on in Settings.
- **Cloudflare Pages** — connect the repo.

---

## How the three roles fit together

**You are the Admin.** You register tutors and oversee everything.

1. **Register a tutor.** Admin → Tutors → **Register a tutor**. The system makes them a username. Use **Send link** to WhatsApp them their sign-in. They pick their own PIN the first time they open `tutor.html` — you never see or set it.
2. **A parent or learner books** on the website. They arrive as an **application** (no login yet) and land in Admin → *Applications* and, once assigned, in the tutor's list.
3. **Accept the application.** Admin → Applications → choose a tutor → **Accept & create login**. That mints a **username and password** and shows a slip with **Send on WhatsApp** and **Send by email** buttons already filled in. One tap each. (A tutor can also accept their own — or add a student by hand, which creates the login straight away.)
4. **The student signs in** at `student.html` with that username and password, and sees their lessons, times and what's paid.
5. **Suspend or reactivate** anyone. Admin → Students (or Tutors) → **Suspend**. A suspended person can no longer sign in; **Activate** lets them back.

Everything — sign-ins, acceptances, suspensions, lesson changes — is written to **Admin → Activity**, which exports to Excel.

### The dots (in every register)

| Dot | Means |
|---|---|
| 🟡 Yellow | Pending — the student hasn't answered yet |
| 🟢 Green | Accepted |
| 🔴 Red | Missed |
| 🔵 Cyan | Taught |
| ⚪ Grey | Declined |

### Getting it into Excel

Admin has **Export** on every tab and **Export everything to Excel** on the Overview, which downloads students, lessons and the activity log as `.csv` files that open straight in Excel or LibreOffice. Each tutor can export their own register and print it.

---

## "Automatically on WhatsApp and email" — what's real

When you accept a student, the login is created **automatically** and the WhatsApp and email messages are written for you, prefilled with their username, password and dashboard link. You tap **once** to send each.

Truly *zero-tap* sending — the message leaving on its own with nobody pressing anything — needs a server and a paid messaging service (Twilio or WhatsApp Cloud API for WhatsApp; Resend, SendGrid or similar for email), because a web page on its own is not allowed to send messages as you. The one-tap version here needs no accounts and no cost. If you later add the server described below, the same credentials can be pushed out automatically.

---

## Microsoft Teams — what's real

**Working now, no setup:** paste a Teams join link into a lesson and the student gets a **Join on Teams** button; **Add to calendar** downloads an `.ics` that drops the lesson into their Teams/Outlook calendar with the link inside and a 30-minute reminder; Accept / Decline / Pending are recorded the moment the student taps.

**Needs a server:** having Teams itself *create* the meeting and reading the student's real Teams RSVP back go through the Microsoft Graph API, which needs a secret that can't live in a web page. The shape of it: register an app in Azure (free with any Microsoft 365 account), give it `Calendars.ReadWrite`, and from a small server function `POST /me/events` with `isOnlineMeeting: true` and the student as attendee — Graph returns the join URL and each attendee's `status.response` (`accepted` / `declined` / `none`) to write back into the lesson.

---

## The one thing to be clear about — security & sharing

**Two honest limits, both with the same fix.**

1. **Data lives in one browser on one device.** Your laptop, your phone and a student's phone each hold a separate copy that never meets the others. Fine while you're the only one entering data; not enough for students on their own phones seeing what you typed.
2. **Usernames, PINs and passwords are checked inside the browser**, because there's no server yet. That keeps tutors and students out of each other's dashboards by accident, but a determined person could bypass it. Don't store anything truly sensitive in the notes until this is fixed.

### The fix — move the data to Supabase (about 20 minutes)

Free tier at <https://supabase.com> is more than enough.

1. Make a project. In the table editor create tables — `tutors`, `students`, `lessons`, `messages`, `activity` — with columns matching the objects in `nz-store.js` (listed at the top of each section: `addTutor`, `addStudent`, `addLesson`, `addMessage`).
2. Copy your project URL and the *anon* key from Settings → API.
3. In `nz-store.js`, replace the two functions **`load()`** and **`save()`** with calls to the Supabase client. Nothing else in the file, and none of the dashboards, need to change — every screen only ever calls `NZ.lessons()`, `NZ.acceptStudent()` and so on, so they never know where the data came from.
4. Turn on **Row Level Security** and move the password/PIN check to Supabase Auth. Now the login is a real lock, not just a doorknob, and everyone shares one live copy.

### Back it up

Admin → Setup → **Download a backup** writes the whole practice to one JSON file. Do it weekly, and always before clearing browser data — clearing "cookies and site data" wipes the register with it. **Load a backup** restores it.

---

## Small things worth knowing

- **Times have no timezone.** 15:00 is 15:00 wherever the file is opened — right for you and South African students.
- **Ctrl/Cmd+Enter** sends a message without the mouse.
- **The registers update themselves.** Leave a dashboard open while a student accepts a lesson in another tab and the dot changes in front of you.
- **Rate per hour** on the Students tab is what a new lesson uses to work out the fee; change any fee afterwards and it stays changed.
- **First tutor PIN.** A newly registered tutor has *no* PIN — the first sign-in sets it. If they forget it, an admin can't read it, but removing and re-registering the tutor lets them set a fresh one.
