# NUCLEAR-ZONE — website + dashboards

Your tutoring website with three sign-ins on top of it: one for you (the owner), one for each tutor, and one for each student.

| File | What it is |
|---|---|
| `index.html` | Your website. **Admin / Tutor / Student** buttons in the header; the booking form registers an *application* |
| `admin.html` | **Your** console — alerts, every tutor and student, all messages, complaints, Teams links, photos, Excel exports |
| `tutor.html` | A tutor's register — only *their* students and lessons |
| `student.html` | What a student or parent sees — lessons, times, payments, profile |
| `nz-store.js` | The one place all data is kept. Every screen reads from it |
| `nz-dash.css` | The shared skin for the three dashboards |

All files must sit in the **same folder**. No Node, no database, no monthly fee.

---

## Run it on your own machine first

```bash
cd ~/Downloads/nuclear-zone          # wherever you unzipped it
python3 -m http.server 8000
```

Open <http://localhost:8000/index.html> and use the coloured buttons at the top, or go straight to:

| Who | Address | Demo sign-in |
|---|---|---|
| Admin (you) | `/admin.html` | username **admin**, PIN **1234** |
| Tutor | `/tutor.html` | username **tapuwa**, PIN **1234** |
| Student | `/student.html` | shown on the admin **Students** tab |

Clear the demo under **Admin → Setup → Clear everything** once your real people are in.

> Open the files by double-clicking (a `file://` address) and the dashboards will not see each other's data. Always **serve** them, or host them.

---

## You control every account

**Only the admin can register or de-register anyone.** Tutors can no longer add or delete students — they teach, mark and message, nothing else.

1. **Register a tutor.** Admin → Tutors → **Register a tutor**. You're asked for their name, **highest degree**, email and phone. The system makes a username; **Send link** WhatsApps them their sign-in. They choose their own PIN the first time — you never see it.
2. **Register a student** either way: they book on the website and land in **Applications**, or you add one directly with **＋ Register a student** on the Students tab. Both create a username and password and show a slip with **Send on WhatsApp** and **Send by email** ready to go.
3. **Reset a forgotten login.** Students get **Reset password** (mints a new one and offers to send it). Tutors get **Reset PIN**, which clears theirs so they choose a fresh one next sign-in. Nobody, including you, can read an existing PIN back.
4. **Suspend or de-register.** Suspend blocks sign-in but keeps the history; the ✕ removes the account entirely.

### Sign-in is forgiving on purpose

Passwords are handed out over WhatsApp, so people paste them — and a paste usually drags a space along, while phone keyboards capitalise the first letter of whatever you type. Either of those used to be rejected as a wrong password. Now spaces are stripped and the password is checked without case, so `orbit9325`, ` Orbit9325 ` and `ORBIT9325` all open the same dashboard. A genuinely wrong password is still refused. The same trimming applies to tutor PINs and to your own admin PIN.

### Your console opens on three devices

The admin console remembers up to **three** devices — say your laptop, your phone and the office machine. A fourth is refused and told to free a slot first, and you get an alert that it happened. **Setup → Signed-in devices** lists them with when each was first used and last seen, marks the one you are on, and lets you remove any of the others. Signing in again from a device already on the list does not use another slot.

---

## Alerts — on the dashboard and on your WhatsApp

The **Alerts** tab and the counter beside the bell in the header carry everything worth knowing:

| Alert | When |
|---|---|
| 📝 New booking | Somebody applies on the website |
| 🎓 Still pending | A lesson is within a day and nobody has accepted it |
| 🎓 Lesson started | The slot has begun |
| 🎓 Lesson finished | It has ended and needs marking Taught or Missed |
| 🎥 Teams link added | A tutor pastes a join link |
| ⚠️ Complaint | A tutor or student writes to you privately |
| 🔑 Account | Tutor registered, password reset, and so on |

Lessons are re-checked every minute while the console is open, so "started" and "finished" appear on their own.

**To your WhatsApp:** save your number under **Setup → Your WhatsApp number**, then **Send new ones to my WhatsApp** on the Alerts tab opens WhatsApp with all your unread alerts written out. One tap to send. (Alerts arriving on your phone *without* you pressing anything needs a paid messaging service and a server — see the note further down.)

---

## Seeing what's going on

- **Messages** — every tutor-and-student lesson conversation on the platform, read-only. Opening one leaves no mark: read counts and unread badges on their own screens are untouched.
- **Complaints** — the private line. Students see a **Contact office** tab, tutors see **Contact Tapuwa**. Whatever they write comes only to you, and your reply goes only back to them. The tutor cannot see a student's complaint and vice versa.
- **Teams** — every join link a tutor has made, with the student, tutor, date and status, plus **Join** and **Copy link**. Exports to Excel.
- **Activity** — sign-ins, acceptances, suspensions and lesson changes.

---

## Faces and name tags

The **Faces** tab holds a picture and a name tag for everyone. Students get their name and level; **tutors get their name and their highest degree underneath**, which is what students see on their own **My profile** tab next to their own photo. Tutors see their own tag under **Setup**.

Add a picture with **Add photo** on any card — students can also set their own. Pictures are cropped square and shrunk before they are saved (a 4MB phone photo becomes roughly 5–20KB), because the whole browser store is capped near 5MB.

---

## Getting it into Excel

**Export** sits on every admin tab, and **Export everything to Excel** on the Overview downloads students, lessons (with Teams links), the activity log and the alerts as `.csv` files that open straight in Excel or LibreOffice.

### The dots (in every register)

| Dot | Means |
|---|---|
| 🟡 Yellow | Pending — the student hasn't answered yet |
| 🟢 Green | Accepted |
| 🔴 Red | Missed |
| 🔵 Cyan | Taught |
| ⚪ Grey | Declined |

---

## Microsoft Teams — what's real

**Working now, no setup:** a tutor pastes a join link into a lesson; the student gets a **Join on Teams** button; you get an alert and the link on your Teams tab; **Add to calendar** downloads an `.ics` that drops the lesson into their Teams/Outlook calendar with a 30-minute reminder; Accept / Decline / Pending are recorded the moment the student taps.

**Needs a server:** having Teams itself *create* the meeting, and reading the student's real Teams RSVP back, go through the Microsoft Graph API, which needs a secret that cannot live in a web page. The shape: register an app in Azure (free with any Microsoft 365 account), give it `Calendars.ReadWrite`, and from a small server function `POST /me/events` with `isOnlineMeeting: true` and the student as attendee — Graph returns the join URL and each attendee's `status.response`.

---

## The one thing to be clear about

**Three honest limits, all with the same fix.**

1. **Data lives in one browser on one device.** Your laptop, your phone and a student's phone each hold a separate copy that never meets the others. **This is why a student's password appears not to work on their own phone** — the account is real, but it only exists on the machine you created it on, so there is nothing there to check it against. The dashboards now say exactly that instead of claiming the password is wrong, and a student's phone is never given invented demo students. Until the data is shared, every dashboard has to be opened on the device that set it up. The three-device limit on the console counts devices in the same shared copy, so it only does its real job once you have done the step below.
2. **Usernames, PINs and passwords are checked inside the browser**, because there's no server yet. Enough to keep people out of each other's dashboards by accident; a determined person could bypass it.
3. **Message oversight is silent on their screens, but not secret from this console.** Anyone who opens `admin.html` can read the same conversations, so the PIN on it is the only thing protecting them.

### The fix — move the data to Supabase (about 20 minutes)

Free tier at <https://supabase.com> is more than enough.

1. Make a project. In the table editor create tables — `tutors`, `students`, `lessons`, `messages`, `complaints`, `notices`, `activity` — with columns matching the objects in `nz-store.js` (listed at the top of each section: `addTutor`, `addStudent`, `addLesson`, `addMessage`, `addComplaint`).
2. Copy your project URL and the *anon* key from Settings → API.
3. In `nz-store.js`, replace the two functions **`load()`** and **`save()`** with calls to the Supabase client. Nothing else in the file, and none of the dashboards, need to change — every screen only ever calls `NZ.lessons()`, `NZ.acceptStudent()` and so on.
4. Turn on **Row Level Security** and move the password/PIN check to Supabase Auth. Photos should move to Supabase Storage at the same time, which also lifts the 5MB ceiling.

### A word on monitoring and the law

Reading messages sent through your own platform is ordinary oversight, and there's a real safeguarding argument for it when most of your students are minors. Because they *are* minors, and because POPIA applies, add one line to your terms of use — something like *"messages sent through this platform may be reviewed by NUCLEAR-ZONE management"*. It doesn't tell anyone when you're reading, so it costs you nothing day to day, and it's the thing that protects you if a parent ever asks.

### Back it up

Admin → Setup → **Download a backup** writes the whole practice, photos included, to one JSON file. Do it weekly, and always before clearing browser data — clearing "cookies and site data" wipes the register with it. **Load a backup** restores it.

---

## Small things worth knowing

- **Times have no timezone.** 15:00 is 15:00 wherever the file is opened.
- **Ctrl/Cmd+Enter** sends a message or a complaint without the mouse.
- **The registers update themselves.** Leave a dashboard open while a student accepts a lesson in another tab and the dot changes in front of you.
- **Rate per hour** on the Students tab is what a new lesson uses to work out the fee; change any fee afterwards and it stays changed.
- **A newly registered tutor has no PIN** — the first sign-in sets it. If they forget it, use **Reset PIN**.
- **Alerts are capped** at the most recent 400, complaints and messages are not.

