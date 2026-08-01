/* ======================================================================
   NUCLEAR-ZONE — nz-store.js
   The one place where lesson data is kept, read and written.

   Right now this saves into the browser's own storage (localStorage), so
   everything works with no server, no account and no monthly bill. That
   also means data lives in ONE browser on ONE device.

   When you are ready for the tutor's laptop and the student's phone to
   see the same rows, you only have to change the four functions marked
   ADAPTER at the bottom of this file. Nothing else in the dashboards
   needs touching. See README-dashboards.md.
   ====================================================================== */

var NZ = (function () {
  'use strict';

  var KEY = 'nuclearzone.v1';

  /* ------------------------------------------------------- status table */
  /* These are the coloured dots. Yellow = waiting on the student,
     green = student said yes, red = nobody showed up.                  */
  var STATUS = {
    pending:  { label: 'Pending',  dot: '#FFC53D', note: 'Waiting for the student to accept' },
    accepted: { label: 'Accepted', dot: '#2FBF71', note: 'Student accepted the meeting' },
    missed:   { label: 'Missed',   dot: '#FF4D4D', note: 'Lesson was missed' },
    done:     { label: 'Taught',   dot: '#00CFE8', note: 'Lesson happened and is finished' },
    declined: { label: 'Declined', dot: '#8A97AE', note: 'Student declined the meeting' }
  };
  var STATUS_ORDER = ['pending', 'accepted', 'done', 'missed', 'declined'];

  /* ------------------------------------------------------------- state */
  var db = null;
  var listeners = [];

  /* ------------------------------------------------------ your login */
  /* The owner account. Change these two lines and every dashboard picks
     the new details up — including browsers that already hold old data,
     because CREDS_VERSION below forces a one-time rewrite.            */
  var ADMIN_USER = 'tapz007';
  var ADMIN_PIN  = '19458779';
  var CREDS_VERSION = 2;

  function freshAdmin() {
    return { username: ADMIN_USER, pinHash: hash(ADMIN_PIN), phone: '', photo: '', devices: [] };
  }

  function blank() {
    return {
      admin: freshAdmin(),
      tutors: [], students: [], lessons: [], messages: [],
      complaints: [], notices: [], activity: [],
      credsVersion: CREDS_VERSION,
      seq: 1
    };
  }

  /* Which page is asking? The demo tutor and students exist so the admin
     console is never an empty grid. They must NOT be created on a
     student's or a tutor's own device: doing that invents people who do
     not exist and makes a correct password look wrong. On those pages an
     empty browser stays empty, and the sign-in screen says so plainly. */
  function isSignInPage() {
    var p = (location.pathname || '').toLowerCase();
    return /student\.html$|tutor\.html$/.test(p);
  }

  var blankDevice = false;
  function isBlankDevice() { return blankDevice; }

  function load() {
    if (db) return db;
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : null;
    } catch (e) { db = null; }
    if (!db || !db.students) {
      if (isSignInPage()) {
        /* nothing here yet, and nothing invented — do not even save */
        blankDevice = true;
        db = blank();
        return db;
      }
      db = seed(); save(); return db;
    }
    migrate(db);
    save();          /* the repairs above are worth keeping */
    return db;
  }

  /* older saved data may predate accounts — fill the gaps in place */
  function migrate(d) {
    if (!d.admin) d.admin = freshAdmin();
    if (!('phone' in d.admin)) d.admin.phone = '';
    if (!('photo' in d.admin)) d.admin.photo = '';
    if (!d.admin.devices) d.admin.devices = [];

    /* One-time: browsers that already hold data were still holding the old
       admin/1234 login. Rewrite it to the real one, once, and keep the
       registered devices so nobody is locked out of their own console.  */
    if (d.credsVersion !== CREDS_VERSION) {
      d.admin.username = ADMIN_USER;
      d.admin.pinHash  = hash(ADMIN_PIN);
      d.credsVersion   = CREDS_VERSION;
    }

    if (!d.tutors) d.tutors = [];
    if (!d.activity) d.activity = [];
    if (!d.complaints) d.complaints = [];
    if (!d.notices) d.notices = [];
    d.tutors.forEach(function (t) {
      if (!('photo' in t)) t.photo = '';
      if (!('degree' in t)) t.degree = '';
      /* a tutor with no active flag at all was being refused at sign-in */
      if (!('active' in t)) t.active = true;
      if (!('username' in t)) t.username = '';
      if (!('pinHash' in t)) t.pinHash = '';
    });
    d.students.forEach(function (s) {
      if (!s.status) s.status = 'active';
      if (!('tutorId' in s)) s.tutorId = d.tutors[0] ? d.tutors[0].id : null;
      if (!('username' in s)) s.username = '';
      if (!('password' in s)) s.password = '';
      if (!('photo' in s)) s.photo = '';
      /* THE SIGN-IN BUG. studentLogin needs BOTH status === 'active' and
         active === true. Students saved before the active flag existed
         came back undefined, so a perfectly correct password was refused
         with "that username or password does not match". Derive it from
         the status they already have.                                  */
      if (typeof s.active !== 'boolean') s.active = (s.status !== 'suspended');
      /* An accepted student with no password can never sign in. Mint one
         so the admin can send it, rather than leaving a dead account.  */
      if (s.status === 'active' && s.username && !s.password) s.password = newPassword();
    });
    d.lessons.forEach(function (l) {
      if (!l.flags) l.flags = {};
    });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* another tab changed something — refresh this one */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    db = null; load();
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  });

  function onChange(fn) { listeners.push(fn); }

  function id(prefix) {
    var d = load();
    d.seq = (d.seq || 1) + 1;
    return prefix + '-' + d.seq + '-' + Math.random().toString(36).slice(2, 6);
  }

  /* ------------------------------------------------------------ hashing */
  /* A light scramble so a PIN or password is not sitting in plain sight in
     the browser store. It is NOT real security — a page with no server
     cannot truly protect a secret — but it keeps casual eyes out. The
     honest note is in README-dashboards.md and on the admin Setup tab.  */
  function hash(s) {
    var h = 5381, str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /* ---------------------------------------------------- access codes */
  /* Legacy: the short code the earlier student dashboard used. Kept so old
     links still open. New students sign in with a username and password. */
  function newCode() {
    var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   /* no I or O — they read as 1 and 0 */
    var digits = '23456789';
    var s = 'NZ-';
    for (var i = 0; i < 2; i++) s += letters[Math.floor(Math.random() * letters.length)];
    for (var j = 0; j < 4; j++) s += digits[Math.floor(Math.random() * digits.length)];
    return s;
  }

  /* ------------------------------------------------------- credentials */
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'user';
  }

  /* username taken by any account? */
  function usernameTaken(u) {
    var d = load();
    u = String(u).toLowerCase();
    if (d.admin.username.toLowerCase() === u) return true;
    if (d.tutors.some(function (t) { return t.username.toLowerCase() === u; })) return true;
    return d.students.some(function (s) { return (s.username || '').toLowerCase() === u; });
  }

  function uniqueUsername(base) {
    var u = slug(base), n = 1;
    while (usernameTaken(u)) { n++; u = slug(base) + n; }
    return u;
  }

  /* a password that is easy to read aloud and type: word + four digits */
  function newPassword() {
    var words = ['atom', 'orbit', 'proton', 'photon', 'quark', 'fusion', 'vector',
                 'newton', 'kelvin', 'cosine', 'matrix', 'apex', 'delta', 'sigma'];
    var w = words[Math.floor(Math.random() * words.length)];
    var n = '';
    for (var i = 0; i < 4; i++) n += '23456789'[Math.floor(Math.random() * 8)];
    return w + n;
  }

  /* ========================================================== STUDENTS */
  function students() { return load().students.slice(); }

  function student(sid) {
    var f = load().students.filter(function (s) { return s.id === sid; });
    return f[0] || null;
  }

  function studentByCode(code) {
    if (!code) return null;
    var want = String(code).trim().toUpperCase();
    var f = load().students.filter(function (s) { return s.code === want; });
    return f[0] || null;
  }

  /* Called by the website booking form the moment somebody registers.
     They arrive as an APPLICANT: no login yet. A tutor or the admin
     accepts them, which creates the username and password to send.     */
  function addStudent(a) {
    var d = load();
    var s = {
      id: id('stu'),
      code: newCode(),
      username: '',
      password: '',
      status: a.status || 'applicant',   /* applicant → active → suspended */
      tutorId: a.tutorId || null,
      firstName: a.firstName || '',
      surname: a.surname || '',
      role: a.role || 'Learner',
      level: a.level || '',
      subjects: a.subjects || [],
      phone: a.phone || '',
      email: a.email || '',
      school: a.school || '',
      when: a.when || '',
      notes: a.notes || '',
      rate: a.rate == null ? 250 : Number(a.rate),
      joined: today(),
      active: true
    };
    d.students.push(s);
    if (a.notes) {
      d.messages.push({
        id: id('msg'), studentId: s.id, from: 'student',
        text: a.notes, at: new Date().toISOString(), read: false
      });
    }
    logEvent('website', 'New application', (s.firstName + ' ' + s.surname).trim() + ' — ' + (s.level || 'level not set'));
    notify('application', 'New booking: ' + (s.firstName + ' ' + s.surname).trim(),
           (s.level || 'level not set') + ' · ' + ((s.subjects || []).join(', ') || 'no subjects') + ' · ' + (s.phone || 'no phone'), true);
    save();
    return s;
  }

  function studentByUsername(u) {
    if (!u) return null;
    u = tidy(u).toLowerCase();
    var f = load().students.filter(function (s) { return (s.username || '').toLowerCase() === u; });
    return f[0] || null;
  }

  /* Accept an applicant: assign a tutor, switch on their account, and mint
     a username + password if they do not have one. Returns the login the
     tutor should send. */
  function acceptStudent(sid, tutorId) {
    var s = student(sid); if (!s) return null;
    if (!s.username) s.username = uniqueUsername(s.firstName || 'student');
    if (!s.password) s.password = newPassword();
    s.status = 'active';
    s.active = true;
    if (tutorId) s.tutorId = tutorId;
    logEvent(actorLabel(), 'Accepted student', (s.firstName + ' ' + s.surname).trim());
    save();
    return { username: s.username, password: s.password };
  }

  function setStudentActive(sid, on) {
    var s = student(sid); if (!s) return;
    s.active = !!on;
    s.status = on ? 'active' : 'suspended';
    logEvent(actorLabel(), on ? 'Reactivated student' : 'Suspended student', studentName(sid));
    save();
  }

  /* the login details, ready to paste into WhatsApp or an email */
  function credentialsMessage(sid) {
    var s = student(sid); if (!s || !s.username) return '';
    var base = location.href.replace(/[^/]*$/, '');
    return 'Hi ' + s.firstName + ' — welcome to NUCLEAR-ZONE. Your dashboard is ready.\n\n' +
      'Open: ' + base + 'student.html\n' +
      'Username: ' + s.username + '\n' +
      'Password: ' + s.password + '\n\n' +
      'It shows your lessons, times and what is paid. — Tapuwa';
  }

  function updateStudent(sid, patch) {
    var s = student(sid); if (!s) return;
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    save();
  }

  function removeStudent(sid) {
    var d = load();
    d.students = d.students.filter(function (s) { return s.id !== sid; });
    d.lessons = d.lessons.filter(function (l) { return l.studentId !== sid; });
    d.messages = d.messages.filter(function (m) { return m.studentId !== sid; });
    save();
  }

  function studentName(sid) {
    var s = student(sid);
    return s ? (s.firstName + ' ' + s.surname).trim() : 'Unknown';
  }

  /* =========================================================== LESSONS */
  function lessons(sid) {
    var all = load().lessons.slice();
    if (sid) all = all.filter(function (l) { return l.studentId === sid; });
    return all.sort(function (a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    });
  }

  function lesson(lid) {
    var f = load().lessons.filter(function (l) { return l.id === lid; });
    return f[0] || null;
  }

  function addLesson(a) {
    var d = load();
    var s = student(a.studentId);
    var l = {
      id: id('les'),
      studentId: a.studentId || '',
      subject: a.subject || 'Mathematics',
      topic: a.topic || '',
      date: a.date || today(),
      start: a.start || '15:00',
      end: a.end || '16:00',
      status: a.status || 'pending',
      fee: a.fee == null ? Math.round((s ? s.rate : 250) * hours(a.start || '15:00', a.end || '16:00')) : Number(a.fee),
      paid: Number(a.paid || 0),
      teamsUrl: a.teamsUrl || '',
      note: a.note || ''
    };
    d.lessons.push(l);
    save();
    return l;
  }

  function updateLesson(lid, patch) {
    var l = lesson(lid); if (!l) return;
    var hadTeams = !!l.teamsUrl, wasStatus = l.status;
    Object.keys(patch).forEach(function (k) { l[k] = patch[k]; });

    /* the admin wants the Teams link the moment a tutor makes the meeting */
    if (!hadTeams && l.teamsUrl) {
      notify('teams', 'Teams link added: ' + studentName(l.studentId),
             l.subject + ' · ' + prettyDate(l.date) + ' ' + l.start + ' · ' + l.teamsUrl);
      logEvent(actorLabel(), 'Added Teams link', studentName(l.studentId) + ' — ' + prettyDate(l.date));
    }
    if (patch.status && patch.status !== wasStatus) {
      logEvent(actorLabel(), 'Lesson marked ' + (STATUS[l.status] ? STATUS[l.status].label : l.status),
               studentName(l.studentId) + ' — ' + prettyDate(l.date));
      if (l.status === 'done' || l.status === 'missed') {
        notify('lesson', studentName(l.studentId) + ': ' + STATUS[l.status].label,
               l.subject + ' · ' + prettyDate(l.date));
      }
    }
    save();
  }

  /* every lesson with a Teams link, newest first — the admin's Teams list */
  function teamsLessons() {
    return lessons().filter(function (l) { return !!l.teamsUrl; })
      .sort(function (a, b) { return (b.date + b.start).localeCompare(a.date + a.start); });
  }

  function removeLesson(lid) {
    var d = load();
    d.lessons = d.lessons.filter(function (l) { return l.id !== lid; });
    save();
  }

  function balance(l) { return Number(l.fee || 0) - Number(l.paid || 0); }

  /* ========================================================== MESSAGES */
  function messages(sid) {
    var all = load().messages.slice();
    if (sid) all = all.filter(function (m) { return m.studentId === sid; });
    return all.sort(function (a, b) { return a.at.localeCompare(b.at); });
  }

  function addMessage(sid, from, text) {
    if (!text || !String(text).trim()) return null;
    var d = load();
    var m = {
      id: id('msg'), studentId: sid, from: from,
      text: String(text).trim(), at: new Date().toISOString(), read: false
    };
    d.messages.push(m);
    save();
    return m;
  }

  function markRead(sid, side) {
    var d = load(), touched = false;
    d.messages.forEach(function (m) {
      if (m.studentId === sid && m.from !== side && !m.read) { m.read = true; touched = true; }
    });
    if (touched) save();
  }

  function unread(sid, side) {
    return messages(sid).filter(function (m) { return m.from !== side && !m.read; }).length;
  }

  /* ========================================================= ACTIVITY */
  /* Who is doing things right now. A dashboard calls setActor on sign-in
     so the log reads "Naledi Mokoena" rather than "someone". */
  var actor = { role: 'system', name: '' };
  function setActor(role, name) { actor = { role: role, name: name || '' }; }
  function actorLabel() {
    if (actor.role === 'admin') return 'Admin';
    if (actor.role === 'tutor') return 'Tutor · ' + (actor.name || '');
    if (actor.role === 'student') return 'Student · ' + (actor.name || '');
    return actor.name || 'System';
  }

  function logEvent(who, action, detail) {
    var d = db || {};
    if (!d.activity) return;
    d.activity.unshift({
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(),
      who: who || actorLabel(), action: action, detail: detail || ''
    });
    if (d.activity.length > 600) d.activity.length = 600;
  }
  function activity() { return load().activity.slice(); }

  /* ============================================================ ADMIN */
  function adminUser() { return load().admin.username; }

  /* This browser's own name for itself. Written once and kept, so signing
     in again from the same laptop does not eat another of the three
     slots.                                                             */
  function deviceId() {
    var k = 'nz.device';
    var v = null;
    try { v = localStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  }

  /* a readable guess at what this machine is, for the list under Setup */
  function deviceLabel() {
    var ua = (navigator && navigator.userAgent) || '';
    var os = /Android/i.test(ua) ? 'Android' :
             /iPhone|iPad|iPod/i.test(ua) ? 'iPhone or iPad' :
             /Windows/i.test(ua) ? 'Windows' :
             /Mac OS X/i.test(ua) ? 'Mac' :
             /Linux/i.test(ua) ? 'Linux' : 'This device';
    var br = /Edg\//i.test(ua) ? 'Edge' :
             /OPR\//i.test(ua) ? 'Opera' :
             /Chrome\//i.test(ua) ? 'Chrome' :
             /Firefox\//i.test(ua) ? 'Firefox' :
             /Safari\//i.test(ua) ? 'Safari' : 'browser';
    return os + ' · ' + br;
  }

  var ADMIN_DEVICE_LIMIT = 3;

  function adminDevices() { return (load().admin.devices || []).slice(); }

  function forgetAdminDevice(id) {
    var a = load().admin;
    a.devices = (a.devices || []).filter(function (d) { return d.id !== id; });
    logEvent('Admin', 'Removed a signed-in device', '');
    save();
  }

  /* Returns true when signed in, or a reason string when refused. The PIN
     is checked first so a wrong PIN never reveals anything about which
     devices are registered.                                            */
  function adminLogin(u, pin) {
    var a = load().admin;
    var ok = tidy(u).toLowerCase() === a.username.toLowerCase() &&
             (hash(tidy(pin)) === a.pinHash || hash(String(pin)) === a.pinHash);
    if (!ok) return false;

    if (!a.devices) a.devices = [];
    var id = deviceId();
    var known = a.devices.filter(function (d) { return d.id === id; })[0];

    if (!known) {
      if (a.devices.length >= ADMIN_DEVICE_LIMIT) {
        logEvent('Admin', 'Sign-in refused', 'a fourth device tried to sign in');
        notify('account', 'Sign-in blocked on a new device',
               'Three devices are already signed in. Remove one under Setup to allow another.', true);
        save();
        return 'limit';
      }
      a.devices.push({ id: id, label: deviceLabel(), at: new Date().toISOString(), seen: new Date().toISOString() });
      logEvent('Admin', 'New device signed in', deviceLabel());
    } else {
      known.seen = new Date().toISOString();
      known.label = deviceLabel();
    }

    setActor('admin', 'Tapuwa');
    logEvent('Admin', 'Signed in', '');
    save();
    return true;
  }
  function setAdmin(u, pin, phone) {
    var a = load().admin;
    if (u) a.username = String(u).trim();
    if (pin) a.pinHash = hash(tidy(pin));
    if (phone != null) a.phone = String(phone).trim();
    logEvent('Admin', 'Updated admin login', '');
    save();
  }
  function adminPhone() { return load().admin.phone || ''; }

  /* =========================================================== TUTORS */
  function tutors() { return load().tutors.slice(); }
  function tutor(tid) {
    var f = load().tutors.filter(function (t) { return t.id === tid; });
    return f[0] || null;
  }
  function tutorByUsername(u) {
    if (!u) return null;
    u = tidy(u).toLowerCase();
    var f = load().tutors.filter(function (t) { return t.username.toLowerCase() === u; });
    return f[0] || null;
  }
  function tutorName(tid) {
    var t = tutor(tid);
    return t ? t.name : (tid ? 'Unknown tutor' : 'Unassigned');
  }

  /* Admin registers a tutor. Username is generated from the name (admin can
     change it). No PIN yet — the tutor sets their own on first sign-in.  */
  function addTutor(a) {
    var d = load();
    var t = {
      id: id('tut'),
      username: a.username ? String(a.username).trim() : uniqueUsername(a.name || 'tutor'),
      name: a.name || '',
      email: a.email || '',
      phone: a.phone || '',
      degree: a.degree || '',      /* highest qualification, shown on their name tag */
      photo: a.photo || '',
      pinHash: '',                 /* empty until the tutor sets it */
      active: true,
      joined: today()
    };
    d.tutors.push(t);
    logEvent('Admin', 'Registered tutor', t.name + ' (' + t.username + ')');
    notify('account', 'Tutor registered', t.name + ' — send them their sign-in link');
    save();
    return t;
  }
  function updateTutor(tid, patch) {
    var t = tutor(tid); if (!t) return;
    Object.keys(patch).forEach(function (k) { t[k] = patch[k]; });
    save();
  }
  function setTutorActive(tid, on) {
    var t = tutor(tid); if (!t) return;
    t.active = !!on;
    logEvent('Admin', on ? 'Reactivated tutor' : 'Suspended tutor', t.name);
    save();
  }
  function removeTutor(tid) {
    var d = load();
    d.students.forEach(function (s) { if (s.tutorId === tid) s.tutorId = null; });
    d.tutors = d.tutors.filter(function (t) { return t.id !== tid; });
    logEvent('Admin', 'Removed tutor', tutorName(tid));
    save();
  }

  /* first sign-in has no PIN yet → the dashboard calls tutorSetPin */
  function tutorNeedsPin(u) {
    var t = tutorByUsername(u);
    return !!(t && t.active !== false && !t.pinHash);
  }
  function tutorSetPin(u, pin) {
    var t = tutorByUsername(u);
    if (!t || t.active === false) return false;
    t.pinHash = hash(tidy(pin));
    setActor('tutor', t.name);
    logEvent('Tutor · ' + t.name, 'Set PIN and signed in', '');
    save();
    return true;
  }
  function tutorLogin(u, pin) {
    var t = tutorByUsername(u);
    if (!t || t.active === false || !t.pinHash) return false;
    /* older PINs were stored untrimmed — accept both so nobody is stranded */
    var ok = hash(tidy(pin)) === t.pinHash || hash(String(pin)) === t.pinHash;
    if (ok) { setActor('tutor', t.name); logEvent('Tutor · ' + t.name, 'Signed in', ''); save(); }
    return ok;
  }

  function whyTutorLoginFailed(u, pin) {
    if (blankDevice) return 'blank-device';
    var t = tutorByUsername(u);
    if (!t) return 'no-such-user';
    if (t.active === false) return 'suspended';
    if (!t.pinHash) return 'needs-pin';
    if (hash(tidy(pin)) !== t.pinHash && hash(String(pin)) !== t.pinHash) return 'wrong-pin';
    return 'ok';
  }

  /* ================================================= STUDENT SIGN-IN */
  /* Be forgiving about how the details arrive. People paste them out of
     WhatsApp, which drags a space along, and phone keyboards capitalise
     the first letter of anything they type. Neither should lock a
     student out of their own dashboard, so trim both and compare the
     password without case. The generated passwords are lowercase words
     plus digits, so nothing is lost by doing that.                     */
  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

  /* Returns the student on success, or null. whyStudentLoginFailed() below
     tells the dashboard which of the several possible reasons applied, so
     the screen can say something true instead of always blaming the
     password.                                                          */
  function studentLogin(u, pw) {
    var s = studentByUsername(u);
    if (!s) return null;
    if (s.status === 'suspended' || s.active === false) return null;
    if (s.status === 'applicant') return null;
    if (!s.password) return null;
    if (tidy(s.password).toLowerCase() !== tidy(pw).toLowerCase()) return null;
    setActor('student', (s.firstName + ' ' + s.surname).trim());
    logEvent('Student · ' + (s.firstName + ' ' + s.surname).trim(), 'Signed in', '');
    save();
    return s;
  }

  function whyStudentLoginFailed(u, pw) {
    if (blankDevice) return 'blank-device';
    var s = studentByUsername(u);
    if (!s) return 'no-such-user';
    if (s.status === 'applicant') return 'not-accepted';
    if (s.status === 'suspended' || s.active === false) return 'suspended';
    if (!s.password) return 'no-password';
    if (tidy(s.password).toLowerCase() !== tidy(pw).toLowerCase()) return 'wrong-password';
    return 'ok';
  }

  /* ============================================= SCOPING (who sees who) */
  function applicants() {
    return load().students.filter(function (s) { return s.status === 'applicant'; });
  }
  function studentsByTutor(tid) {
    return load().students.filter(function (s) {
      return s.status !== 'applicant' && s.tutorId === tid;
    });
  }
  function lessonsByTutor(tid) {
    var mine = {};
    studentsByTutor(tid).forEach(function (s) { mine[s.id] = true; });
    return lessons().filter(function (l) { return mine[l.studentId]; });
  }

  /* ====================================================== NOTIFICATIONS */
  /* Everything the admin should know about, newest first. The dashboard
     shows these with an unread count, and any of them can be pushed to
     the admin's WhatsApp in one tap.                                    */
  function notify(kind, title, detail, urgent) {
    var d = db || load();
    if (!d.notices) d.notices = [];
    d.notices.unshift({
      id: 'ntc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(),
      kind: kind,                 /* application | lesson | teams | complaint | account */
      title: title,
      detail: detail || '',
      urgent: !!urgent,
      read: false
    });
    if (d.notices.length > 400) d.notices.length = 400;
  }
  function notices(kind) {
    var all = load().notices.slice();
    if (kind) all = all.filter(function (n) { return n.kind === kind; });
    return all;
  }
  function unreadNotices() {
    return load().notices.filter(function (n) { return !n.read; }).length;
  }
  function markNoticeRead(id) {
    var n = load().notices.filter(function (x) { return x.id === id; })[0];
    if (n && !n.read) { n.read = true; save(); }
  }
  function markAllNoticesRead() {
    var touched = false;
    load().notices.forEach(function (n) { if (!n.read) { n.read = true; touched = true; } });
    if (touched) save();
  }

  /* the unread notifications written out for a WhatsApp message to yourself */
  function noticeDigest(onlyUnread) {
    var list = load().notices.filter(function (n) { return onlyUnread ? !n.read : true; }).slice(0, 25);
    if (!list.length) return 'NUCLEAR-ZONE — nothing new right now.';
    var lines = ['NUCLEAR-ZONE — ' + list.length + ' update' + (list.length === 1 ? '' : 's'), ''];
    list.forEach(function (n) {
      lines.push('• ' + (n.urgent ? '[!] ' : '') + n.title + (n.detail ? ' — ' + n.detail : '') +
                 '  (' + shortWhen(n.at) + ')');
    });
    return lines.join('\n');
  }
  function shortWhen(iso) {
    var d = new Date(iso);
    return prettyDate(d.toISOString().slice(0, 10)) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ------------------------------------------------- the lesson watcher */
  /* Called on a timer by the admin dashboard. It notices when a lesson is
     about to start, has started, or has ended, and raises each of those
     once. Pending lessons close to their slot are flagged as urgent —
     nobody has accepted them yet.                                       */
  function checkLessons() {
    var d = load(), now = new Date(), changed = false;
    d.lessons.forEach(function (l) {
      if (!l.flags) l.flags = {};
      var start = new Date(l.date + 'T' + l.start);
      var end = new Date(l.date + 'T' + l.end);
      var who = studentName(l.studentId);
      var mins = (start - now) / 60000;

      /* still pending and the slot is within a day — chase it */
      if (l.status === 'pending' && mins > 0 && mins < 1440 && !l.flags.chase) {
        l.flags.chase = true; changed = true;
        notify('lesson', 'Still pending: ' + who,
               l.subject + ' on ' + prettyDate(l.date) + ' at ' + l.start + ' — not accepted yet', true);
      }
      /* the lesson is under way */
      if (now >= start && now < end && !l.flags.live && (l.status === 'accepted' || l.status === 'pending')) {
        l.flags.live = true; changed = true;
        notify('lesson', 'Lesson started: ' + who,
               l.subject + (l.topic ? ' — ' + l.topic : '') + ' with ' + tutorNameForStudent(l.studentId));
      }
      /* the lesson has run its course */
      if (now >= end && !l.flags.done && l.status !== 'done' && l.status !== 'declined' && l.status !== 'missed') {
        l.flags.done = true; changed = true;
        notify('lesson', 'Lesson finished: ' + who,
               l.subject + ' ended at ' + l.end + ' — mark it Taught or Missed', true);
      }
    });
    if (changed) save();
    return changed;
  }
  function tutorNameForStudent(sid) {
    var s = student(sid);
    return s ? tutorName(s.tutorId) : 'a tutor';
  }

  /* ========================================================= COMPLAINTS */
  /* A private line from one student or tutor straight to the admin. It is
     kept apart from the tutor/student lesson chat on purpose.           */
  function complaints(partyType, partyId) {
    var all = load().complaints.slice();
    if (partyType) all = all.filter(function (c) {
      return c.partyType === partyType && c.partyId === partyId;
    });
    return all.sort(function (a, b) { return a.at.localeCompare(b.at); });
  }

  function addComplaint(partyType, partyId, from, text) {
    if (!text || !String(text).trim()) return null;
    var d = load();
    var c = {
      id: id('cmp'),
      partyType: partyType,        /* 'student' or 'tutor' */
      partyId: partyId,
      from: from,                  /* 'student' | 'tutor' | 'admin' */
      text: String(text).trim(),
      at: new Date().toISOString(),
      read: false
    };
    d.complaints.push(c);
    if (from !== 'admin') {
      var who = partyType === 'tutor' ? tutorName(partyId) : studentName(partyId);
      notify('complaint', 'Message to you from ' + who,
             String(text).trim().slice(0, 90), true);
    }
    save();
    return c;
  }

  /* how many are waiting on the given side to read them */
  function unreadComplaints(side, partyType, partyId) {
    return complaints(partyType, partyId).filter(function (c) {
      return c.from !== side && !c.read;
    }).length;
  }
  function markComplaintsRead(side, partyType, partyId) {
    var touched = false;
    complaints(partyType, partyId).forEach(function (c) {
      if (c.from !== side && !c.read) { c.read = true; touched = true; }
    });
    if (touched) save();
  }
  /* everyone who has ever written in, for the admin's list */
  function complaintParties() {
    var seen = {}, out = [];
    load().complaints.forEach(function (c) {
      var k = c.partyType + ':' + c.partyId;
      if (seen[k]) return;
      seen[k] = true;
      out.push({ partyType: c.partyType, partyId: c.partyId });
    });
    return out;
  }

  /* ======================================================= QUIET READING */
  /* The admin's oversight view. It returns the lesson chat WITHOUT
     touching any read flag, so opening it changes nothing that the tutor
     or student would ever see on their own screen.                      */
  function readThreadQuietly(sid) { return messages(sid); }
  function threadSummaries() {
    return load().students
      .filter(function (s) { return s.status !== 'applicant'; })
      .map(function (s) {
        var m = messages(s.id);
        return {
          studentId: s.id,
          name: studentName(s.id),
          tutor: tutorName(s.tutorId),
          count: m.length,
          last: m.length ? m[m.length - 1] : null
        };
      })
      .filter(function (t) { return t.count > 0; })
      .sort(function (a, b) { return b.last.at.localeCompare(a.last.at); });
  }

  /* ==================================================== PASSWORD RESETS */
  /* The admin can mint a new password for a student, and can clear a
     tutor's PIN so the tutor chooses a fresh one on their next sign-in.
     Nobody, including the admin, can read an existing tutor PIN back.   */
  function resetStudentPassword(sid) {
    var s = student(sid); if (!s) return null;
    if (!s.username) s.username = uniqueUsername(s.firstName || 'student');
    s.password = newPassword();
    logEvent('Admin', 'Reset student password', studentName(sid));
    notify('account', 'Password reset', studentName(sid) + ' — send them the new one');
    save();
    return { username: s.username, password: s.password };
  }
  function resetTutorPin(tid) {
    var t = tutor(tid); if (!t) return false;
    t.pinHash = '';
    logEvent('Admin', 'Cleared tutor PIN', t.name);
    notify('account', 'Tutor PIN cleared', t.name + ' will choose a new PIN at next sign-in');
    save();
    return true;
  }

  /* ============================================================ PHOTOS */
  /* Stored as a small data URL. The dashboards shrink the picture before
     it ever reaches here, so the browser store stays well under its
     limit — see photo handling in the dashboards.                       */
  function setPhoto(kind, ident, dataUrl) {
    if (kind === 'student') { var s = student(ident); if (s) s.photo = dataUrl || ''; }
    else if (kind === 'tutor') { var t = tutor(ident); if (t) t.photo = dataUrl || ''; }
    else if (kind === 'admin') { load().admin.photo = dataUrl || ''; }
    save();
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return ((p[0] || '')[0] || '?').toUpperCase() + ((p[1] || '')[0] || '').toUpperCase();
  }

  /* Take whatever the phone camera produced and cut it down to a square
     thumbnail before it is ever stored. A 4MB photo becomes about 20KB,
     which matters because the whole browser store is capped near 5MB.  */
  function shrinkPhoto(file, done, fail) {
    if (!file || !/^image\//.test(file.type)) { if (fail) fail('That file is not a picture.'); return; }
    var reader = new FileReader();
    reader.onerror = function () { if (fail) fail('That picture could not be read.'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { if (fail) fail('That picture could not be opened.'); };
      img.onload = function () {
        var SIDE = 320;
        var side = Math.min(img.width, img.height);          /* centre square crop */
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        var c = document.createElement('canvas');
        c.width = SIDE; c.height = SIDE;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE);
        done(c.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ============================================================ MONEY */
  function money(n) {
    var v = Number(n || 0);
    var neg = v < 0;
    var s = Math.abs(v).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '−R ' : 'R ') + parts.join('.');
  }

  function totals(list) {
    var t = { hours: 0, fee: 0, paid: 0, balance: 0, count: list.length };
    list.forEach(function (l) {
      t.hours += hours(l.start, l.end);
      t.fee += Number(l.fee || 0);
      t.paid += Number(l.paid || 0);
    });
    t.balance = t.fee - t.paid;
    return t;
  }

  /* ============================================================= TIME */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function hours(start, end) {
    var a = mins(start), b = mins(end);
    if (b <= a) return 0;
    return (b - a) / 60;
  }
  function mins(t) {
    var p = String(t || '0:00').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function prettyDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + mon[d.getMonth()];
  }

  function isPast(l) {
    return (l.date + 'T' + l.end) < new Date().toISOString().slice(0, 16);
  }

  /* ====================================================== TEAMS / .ics */
  /* A calendar file the student can open. Outlook and Teams both accept
     it, so the lesson lands in their Teams calendar with the join link
     inside. This needs no Microsoft account and no developer setup.    */
  function ics(l) {
    var s = student(l.studentId);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    var dt = function (d, t) { return d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00'; };
    var title = l.subject + (l.topic ? ' — ' + l.topic : '') + ' | NUCLEAR-ZONE';
    var body = [
      'Tutor: Tapuwa Sithole, NUCLEAR-ZONE',
      s ? 'Student: ' + (s.firstName + ' ' + s.surname).trim() : '',
      l.topic ? 'Topic: ' + l.topic : '',
      l.teamsUrl ? 'Join the meeting: ' + l.teamsUrl : 'The join link will be sent before the lesson.',
      l.note ? 'Note: ' + l.note : ''
    ].filter(Boolean).join('\\n');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NUCLEAR-ZONE//Lessons//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + l.id + '@nuclear-zone',
      'DTSTAMP:' + stamp,
      'DTSTART:' + dt(l.date, l.start),
      'DTEND:' + dt(l.date, l.end),
      'SUMMARY:' + esc(title),
      'DESCRIPTION:' + esc(body),
      'LOCATION:' + (l.teamsUrl ? 'Microsoft Teams' : 'Online'),
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Lesson in 30 minutes',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].map(fold).join('\r\n');
  }
  function esc(s) { return String(s).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n'); }

  /* the calendar standard wants no line longer than 75 characters */
  function fold(line) {
    if (line.length <= 74) return line;
    var out = line.slice(0, 74), rest = line.slice(74);
    while (rest.length > 73) { out += '\r\n ' + rest.slice(0, 73); rest = rest.slice(73); }
    return out + '\r\n ' + rest;
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ============================================================== CSV */
  /* Opens straight in Excel. The BOM is what stops Excel mangling the R
     sign and any accented names.                                       */
  function csv(rows) {
    var body = rows.map(function (r) {
      return r.map(function (c) {
        var v = c == null ? '' : String(c);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
    return '\ufeff' + body;
  }

  /* ============================================================= SEED */
  /* Three example rows so the dashboards are never an empty grid on the
     first open. Delete them with "Clear the demo rows" in the tutor
     dashboard once your real students are in.                          */
  function seed() {
    var d = blank();
    db = d;
    var base = new Date();
    var day = function (offset) {
      var x = new Date(base.getTime() + offset * 86400000);
      return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    };

    /* the tutor (you). No PIN is set, so the first sign-in on tutor.html
       asks you to choose one — same as any tutor you register. */
    var tut = addTutor({ name: 'Tapuwa Sithole', username: 'tapuwa', email: 'tapuwasithole7@gmail.com', phone: '060 778 1905', degree: 'PhD candidate, Nuclear Physics (UNISA)' });

    var a = addStudent({
      firstName: 'Naledi', surname: 'Mokoena', role: 'Learner', level: 'Grade 12',
      subjects: ['Mathematics', 'Physics'], phone: '082 555 0114',
      email: 'naledi@example.com', school: 'Rondebosch High', rate: 280,
      when: 'Weekday afternoons', notes: 'Trigonometry is the problem and my exam is in three weeks.',
      tutorId: tut.id
    });
    var b = addStudent({
      firstName: 'Yusuf', surname: 'Patel', role: 'Parent', level: 'Grade 10',
      subjects: ['Mathematics'], phone: '083 555 0921',
      email: 'y.patel@example.com', school: 'Wynberg Boys', rate: 250,
      when: 'Saturday mornings', notes: 'Booking for my son Ismail. Algebra basics need rebuilding.',
      tutorId: tut.id
    });
    var c = addStudent({
      firstName: 'Thandeka', surname: 'Dube', role: 'College / university student', level: 'University',
      subjects: ['Physics', 'Assignments and projects'], phone: '071 555 0333',
      email: 't.dube@example.com', school: 'UWC', rate: 350, when: 'Evenings',
      tutorId: tut.id
    });
    /* accept the three so they have working logins in the demo */
    [a, b, c].forEach(function (s) { acceptStudent(s.id, tut.id); });

    /* one applicant still waiting, to show the accept flow */
    addStudent({
      firstName: 'Sipho', surname: 'Nkosi', role: 'Learner', level: 'Grade 11',
      subjects: ['Physics'], phone: '082 555 0777', email: 'sipho@example.com',
      school: 'Pinelands High', when: 'Weekday evenings',
      notes: 'Struggling with electric circuits before the June exam.'
    });

    [
      { studentId: a.id, subject: 'Mathematics', topic: 'Compound angles', date: day(-7), start: '15:00', end: '16:30', status: 'done', fee: 420, paid: 420, teamsUrl: '' },
      { studentId: a.id, subject: 'Physics', topic: 'Momentum and impulse', date: day(-3), start: '15:00', end: '16:00', status: 'missed', fee: 280, paid: 0, teamsUrl: '' },
      { studentId: a.id, subject: 'Mathematics', topic: 'Trig identities, past paper', date: day(1), start: '15:00', end: '16:30', status: 'accepted', fee: 420, paid: 200, teamsUrl: '' },
      { studentId: a.id, subject: 'Mathematics', topic: 'Trig equations', date: day(4), start: '15:00', end: '16:30', status: 'pending', fee: 420, paid: 0, teamsUrl: '' },
      { studentId: b.id, subject: 'Mathematics', topic: 'Exponents and surds', date: day(-2), start: '09:00', end: '10:30', status: 'done', fee: 375, paid: 375, teamsUrl: '' },
      { studentId: b.id, subject: 'Mathematics', topic: 'Linear equations', date: day(2), start: '09:00', end: '10:30', status: 'pending', fee: 375, paid: 0, teamsUrl: '' },
      { studentId: c.id, subject: 'Physics', topic: 'Rigid body dynamics assignment', date: day(0), start: '18:00', end: '19:30', status: 'accepted', fee: 525, paid: 0, teamsUrl: '' },
      { studentId: c.id, subject: 'Physics', topic: 'Lagrangian mechanics intro', date: day(6), start: '18:00', end: '19:30', status: 'pending', fee: 525, paid: 0, teamsUrl: '' }
    ].forEach(addLesson);

    addMessage(a.id, 'tutor', 'Hi Naledi — I have set Thursday at 15:00 for trig identities. Please accept the lesson so it goes into your calendar.');
    addMessage(a.id, 'student', 'Thank you sir. Can we also do the September past paper question 4?');
    addMessage(c.id, 'student', 'Sir, I have uploaded the assignment brief. Is 18:00 still fine tonight?');

    addComplaint('student', b.id, 'student', 'Good day. The Saturday slot keeps clashing with my son\u2019s sport. Could we look at a different time?');

    db.demo = true;
    return db;
  }

  function clearDemo() {
    localStorage.removeItem(KEY);
    db = blank();
    save();
  }

  function wipeAll() { clearDemo(); }

  /* ------------------------------------------------------------ export */
  return {
    STATUS: STATUS, STATUS_ORDER: STATUS_ORDER,
    onChange: onChange, setActor: setActor,

    /* accounts + auth */
    adminUser: adminUser, adminLogin: adminLogin, setAdmin: setAdmin, adminPhone: adminPhone,
    adminDevices: adminDevices, forgetAdminDevice: forgetAdminDevice,
    deviceId: deviceId, ADMIN_DEVICE_LIMIT: ADMIN_DEVICE_LIMIT,
    tutors: tutors, tutor: tutor, tutorName: tutorName, tutorByUsername: tutorByUsername,
    addTutor: addTutor, updateTutor: updateTutor, setTutorActive: setTutorActive, removeTutor: removeTutor,
    tutorNeedsPin: tutorNeedsPin, tutorSetPin: tutorSetPin, tutorLogin: tutorLogin,
    whyTutorLoginFailed: whyTutorLoginFailed, whyStudentLoginFailed: whyStudentLoginFailed,
    studentLogin: studentLogin, studentByUsername: studentByUsername,
    resetStudentPassword: resetStudentPassword, resetTutorPin: resetTutorPin,

    /* notifications */
    notify: notify, notices: notices, unreadNotices: unreadNotices,
    markNoticeRead: markNoticeRead, markAllNoticesRead: markAllNoticesRead,
    noticeDigest: noticeDigest, checkLessons: checkLessons,

    /* complaints — the private line to the admin */
    complaints: complaints, addComplaint: addComplaint,
    unreadComplaints: unreadComplaints, markComplaintsRead: markComplaintsRead,
    complaintParties: complaintParties,

    /* admin oversight */
    readThreadQuietly: readThreadQuietly, threadSummaries: threadSummaries,
    teamsLessons: teamsLessons,

    /* photos */
    setPhoto: setPhoto, initials: initials, shrinkPhoto: shrinkPhoto,
    isBlankDevice: isBlankDevice,

    /* students */
    students: students, student: student, studentByCode: studentByCode,
    addStudent: addStudent, updateStudent: updateStudent, removeStudent: removeStudent,
    studentName: studentName,
    acceptStudent: acceptStudent, setStudentActive: setStudentActive,
    credentialsMessage: credentialsMessage,
    applicants: applicants, studentsByTutor: studentsByTutor, lessonsByTutor: lessonsByTutor,

    /* lessons + messages */
    lessons: lessons, lesson: lesson, addLesson: addLesson,
    updateLesson: updateLesson, removeLesson: removeLesson, balance: balance,
    messages: messages, addMessage: addMessage, markRead: markRead, unread: unread,

    /* activity */
    activity: activity,

    /* helpers */
    money: money, totals: totals, hours: hours, today: today,
    prettyDate: prettyDate, isPast: isPast,
    ics: ics, csv: csv, download: download,
    newCode: newCode, clearDemo: clearDemo, wipeAll: wipeAll
  };
})();

/* ======================================================================
   ADAPTER — read this when you want real online sync
   ----------------------------------------------------------------------
   Everything above talks to localStorage through exactly two functions:
   load() and save(). To put the data online instead, sign up for a free
   Supabase project and replace those two with a fetch to your tables.
   Every dashboard screen keeps working unchanged, because they only ever
   call NZ.lessons(), NZ.addLesson() and so on. README-dashboards.md has
   the step-by-step.
   ====================================================================== */
