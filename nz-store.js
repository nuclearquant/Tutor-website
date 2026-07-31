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

  function blank() {
    return {
      admin: { username: 'admin', pinHash: hash('1234') },
      tutors: [], students: [], lessons: [], messages: [], activity: [],
      seq: 1
    };
  }

  function load() {
    if (db) return db;
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : null;
    } catch (e) { db = null; }
    if (!db || !db.students) { db = seed(); save(); return db; }
    migrate(db);
    return db;
  }

  /* older saved data may predate accounts — fill the gaps in place */
  function migrate(d) {
    if (!d.admin) d.admin = { username: 'admin', pinHash: hash('1234') };
    if (!d.tutors) d.tutors = [];
    if (!d.activity) d.activity = [];
    d.students.forEach(function (s) {
      if (!s.status) s.status = 'active';
      if (!('tutorId' in s)) s.tutorId = d.tutors[0] ? d.tutors[0].id : null;
      if (!('username' in s)) s.username = '';
      if (!('password' in s)) s.password = '';
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
    save();
    return s;
  }

  function studentByUsername(u) {
    if (!u) return null;
    u = String(u).trim().toLowerCase();
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
    Object.keys(patch).forEach(function (k) { l[k] = patch[k]; });
    save();
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
  function adminLogin(u, pin) {
    var a = load().admin;
    var ok = String(u).trim().toLowerCase() === a.username.toLowerCase() && hash(pin) === a.pinHash;
    if (ok) { setActor('admin', 'Tapuwa'); logEvent('Admin', 'Signed in', ''); save(); }
    return ok;
  }
  function setAdmin(u, pin) {
    var a = load().admin;
    if (u) a.username = String(u).trim();
    if (pin) a.pinHash = hash(pin);
    logEvent('Admin', 'Updated admin login', '');
    save();
  }

  /* =========================================================== TUTORS */
  function tutors() { return load().tutors.slice(); }
  function tutor(tid) {
    var f = load().tutors.filter(function (t) { return t.id === tid; });
    return f[0] || null;
  }
  function tutorByUsername(u) {
    if (!u) return null;
    u = String(u).trim().toLowerCase();
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
      pinHash: '',                 /* empty until the tutor sets it */
      active: true,
      joined: today()
    };
    d.tutors.push(t);
    logEvent('Admin', 'Registered tutor', t.name + ' (' + t.username + ')');
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
    return !!(t && t.active && !t.pinHash);
  }
  function tutorSetPin(u, pin) {
    var t = tutorByUsername(u);
    if (!t || !t.active) return false;
    t.pinHash = hash(pin);
    setActor('tutor', t.name);
    logEvent('Tutor · ' + t.name, 'Set PIN and signed in', '');
    save();
    return true;
  }
  function tutorLogin(u, pin) {
    var t = tutorByUsername(u);
    if (!t || !t.active || !t.pinHash) return false;
    var ok = hash(pin) === t.pinHash;
    if (ok) { setActor('tutor', t.name); logEvent('Tutor · ' + t.name, 'Signed in', ''); save(); }
    return ok;
  }

  /* ================================================= STUDENT SIGN-IN */
  function studentLogin(u, pw) {
    var s = studentByUsername(u);
    if (!s || s.status !== 'active' || !s.active) return null;
    if (s.password !== String(pw)) return null;
    setActor('student', (s.firstName + ' ' + s.surname).trim());
    logEvent('Student · ' + (s.firstName + ' ' + s.surname).trim(), 'Signed in', '');
    save();
    return s;
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

    /* the tutor (you). Username tapuwa, PIN already set to 1234 so the demo
       opens straight away — change it on first real use. */
    var tut = addTutor({ name: 'Tapuwa Sithole', username: 'tapuwa', email: 'tapuwasithole7@gmail.com', phone: '060 778 1905' });
    tut.pinHash = hash('1234');

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
    adminUser: adminUser, adminLogin: adminLogin, setAdmin: setAdmin,
    tutors: tutors, tutor: tutor, tutorName: tutorName, tutorByUsername: tutorByUsername,
    addTutor: addTutor, updateTutor: updateTutor, setTutorActive: setTutorActive, removeTutor: removeTutor,
    tutorNeedsPin: tutorNeedsPin, tutorSetPin: tutorSetPin, tutorLogin: tutorLogin,
    studentLogin: studentLogin, studentByUsername: studentByUsername,

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
