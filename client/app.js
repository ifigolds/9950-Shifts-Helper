const content = document.getElementById('content');

let adminShiftsCache = [];
let pendingNoShiftId = null;
let adminCalendarDate = new Date();
let selectedAdminDate = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(path, options = {}) {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';

  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData
    }
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: 'תגובה לא תקינה מהשרת' };
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

function statusText(status) {
  if (status === 'yes') return 'מגיע';
  if (status === 'no') return 'לא מגיע';
  if (status === 'maybe') return 'לא בטוח';
  return 'לא ענה';
}

function statusBadgeClass(status) {
  if (status === 'yes') return 'success';
  if (status === 'no') return 'danger';
  if (status === 'maybe') return 'warning';
  return 'pending';
}

function showError(message) {
  content.innerHTML = `
    <div class="card center fade-in">
      <div class="page-title">שגיאה</div>
      <p class="subtitle">${escapeHtml(message)}</p>
      <div class="actions">
        <button class="secondary" onclick="initApp()">נסה שוב</button>
      </div>
    </div>
  `;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function copyText(text) {
  navigator.clipboard.writeText(String(text || ''))
    .then(() => alert('הועתק'))
    .catch(() => alert('שגיאה בהעתקה'));
}

function openTelegramChat(username, phone) {
  const tg = window.Telegram?.WebApp;
  const cleanUsername = String(username || '').trim().replace(/^@/, '');
  const cleanPhone = normalizePhone(phone);

  try {
    if (cleanUsername) {
      const usernameUrl = `https://t.me/${cleanUsername}`;

      if (tg && typeof tg.openTelegramLink === 'function') {
        tg.openTelegramLink(usernameUrl);
      } else {
        window.open(usernameUrl, '_blank');
      }
      return;
    }

    if (cleanPhone) {
      const phoneUrl = `https://t.me/+${cleanPhone.replace(/^\+/, '')}`;

      if (tg && typeof tg.openTelegramLink === 'function') {
        tg.openTelegramLink(phoneUrl);
      } else {
        window.open(phoneUrl, '_blank');
      }
      return;
    }

    alert('אין username או טלפון לפתיחת צ׳אט');
  } catch (e) {
    console.error('openTelegramChat error:', e);
    alert('לא ניתן לפתוח את הצ׳אט');
  }
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonthTitle(dateObj) {
  return dateObj.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric'
  });
}

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB);
}

function getShiftsByDateKey(dateKey) {
  return adminShiftsCache.filter((shift) => shift.shift_date === dateKey);
}
function getCalendarDayStats(dateKey) {
  const shifts = getShiftsByDateKey(dateKey);

  let fullyConfirmed = 0;
  let withProblems = 0;

  shifts.forEach((shift) => {
    const pending = Number(shift.pending_count || 0);
    const maybe = Number(shift.maybe_count || 0);
    const no = Number(shift.no_count || 0);

    if (pending === 0 && maybe === 0 && no === 0 && Number(shift.total || 0) > 0) {
      fullyConfirmed += 1;
    } else {
      withProblems += 1;
    }
  });

  return {
    fullyConfirmed,
    withProblems,
    total: shifts.length
  };
}
// ================= USER =================

async function loadUser() {
  try {
    const data = await api('/me/next-shift');
    const shift = data.shift;

    if (!shift) {
      content.innerHTML = `
        <div class="card empty-state fade-in">
          <div class="page-title">אין משמרות כרגע</div>
          <p>כרגע לא שובצה לך משמרת חדשה</p>
          <div class="actions">
            <button class="secondary" onclick="showModeSelect()">חזרה</button>
          </div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="card fade-in">
        <div class="subtitle">כניסה רגילה</div>
        <div class="page-title">${escapeHtml(shift.title)}</div>
        <div class="divider"></div>

        <div class="stagger">
          <div class="list-item">
            <div class="list-main">תאריך</div>
            <div class="list-sub">${escapeHtml(shift.shift_date)}</div>
          </div>

          <div class="list-item">
            <div class="list-main">שעה</div>
            <div class="list-sub">${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)}</div>
          </div>

          <div class="list-item">
            <div class="list-main">סטטוס</div>
            <div style="margin-top: 8px;">
              <span class="badge ${statusBadgeClass(shift.status)}">${statusText(shift.status)}</span>
            </div>
          </div>

          ${shift.comment ? `
            <div class="list-item">
              <div class="list-main">סיבה</div>
              <div class="list-sub">${escapeHtml(shift.comment)}</div>
            </div>
          ` : ''}

          ${shift.notes ? `
            <div class="list-item">
              <div class="list-main">הערות</div>
              <div class="list-sub">${escapeHtml(shift.notes)}</div>
            </div>
          ` : ''}
        </div>

        <div class="actions">
          <button class="success" onclick="respond(${shift.id}, 'yes')">אני מגיע</button>
          <button class="danger" onclick="showNoReasonForm(${shift.id})">לא מגיע</button>
          <button class="warning" onclick="respond(${shift.id}, 'maybe')">לא בטוח</button>
          <button class="secondary" onclick="showModeSelect()">חזרה</button>
        </div>
      </div>
    `;
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת המשמרת');
  }
}

async function respond(id, status, comment = '') {
  try {
    await api('/me/shift-response', {
      method: 'POST',
      body: JSON.stringify({ shift_id: id, status, comment })
    });

    pendingNoShiftId = null;
    await loadUser();
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

function showNoReasonForm(shiftId) {
  pendingNoShiftId = shiftId;

  content.innerHTML = `
    <div class="card fade-in">
      <div class="page-title">אי הגעה למשמרת</div>
      <p class="subtitle">יש לכתוב סיבה לאי הגעה</p>

      <div class="label">סיבה</div>
      <textarea id="no-reason-input" placeholder="כתוב כאן את הסיבה"></textarea>

      <div class="actions">
        <button class="danger" onclick="submitNoReason()">שלח</button>
        <button class="secondary" onclick="loadUser()">חזרה</button>
      </div>
    </div>
  `;
}

function submitNoReason() {
  const reason = document.getElementById('no-reason-input')?.value.trim() || '';

  if (!reason) {
    alert('יש להזין סיבה');
    return;
  }

  respond(pendingNoShiftId, 'no', reason);
}

// ================= ADMIN =================

async function loadAdmin() {
  try {
    const profile = await api('/me/profile');
    const user = profile.user;

    if (!user || user.role !== 'admin') {
      content.innerHTML = `
        <div class="card center fade-in">
          <div class="page-title">כניסת מנהל</div>
          <p class="subtitle">אין לך הרשאת מנהל</p>
          <div class="actions">
            <button class="secondary" onclick="showModeSelect()">חזרה</button>
          </div>
        </div>
      `;
      return;
    }

    const data = await api('/admin/shifts');
    adminShiftsCache = data.shifts || [];

    if (!selectedAdminDate) {
      selectedAdminDate = formatDateKey(new Date());
    }

    renderAdminCalendar();
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת אזור מנהל');
  }
}

function renderAdminCalendar() {
  const current = new Date(adminCalendarDate.getFullYear(), adminCalendarDate.getMonth(), 1);
  const today = new Date();

  const monthTitle = formatMonthTitle(current);

  const firstDayOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
  const startWeekday = (firstDayOfMonth.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
  const daysInPrevMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate();

  const monthCells = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dateObj = new Date(current.getFullYear(), current.getMonth() - 1, day);
    monthCells.push({ dateObj, muted: true });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(current.getFullYear(), current.getMonth(), day);
    monthCells.push({ dateObj, muted: false });
  }

  while (monthCells.length % 7 !== 0) {
    const nextIndex = monthCells.length - (startWeekday + daysInMonth) + 1;
    const dateObj = new Date(current.getFullYear(), current.getMonth() + 1, nextIndex);
    monthCells.push({ dateObj, muted: true });
  }

  let calendarHtml = `
    <div class="card fade-in">
      <div class="subtitle">כניסת מנהל</div>
      <div class="page-title">יומן משמרות</div>

      <div class="calendar-toolbar">
        <button class="secondary" onclick="changeAdminMonth(-1)">חודש קודם</button>
        <button class="secondary" onclick="goToToday()">היום</button>
        <button class="secondary" onclick="changeAdminMonth(1)">חודש הבא</button>
        <button onclick="showCreateShiftForm()">יצירת משמרת חדשה</button>
        <button class="secondary" onclick="showModeSelect()">חזרה</button>
      </div>

      <div class="calendar-title">${escapeHtml(monthTitle)}</div>

      <div class="calendar-grid">
        <div class="calendar-weekday">ב׳</div>
        <div class="calendar-weekday">ג׳</div>
        <div class="calendar-weekday">ד׳</div>
        <div class="calendar-weekday">ה׳</div>
        <div class="calendar-weekday">ו׳</div>
        <div class="calendar-weekday">ש׳</div>
        <div class="calendar-weekday">א׳</div>
  `;

  monthCells.forEach(({ dateObj, muted }) => {
    const dateKey = formatDateKey(dateObj);
    const dayShifts = getShiftsByDateKey(dateKey);
    const dayStats = getCalendarDayStats(dateKey);
    const isToday = isSameDay(dateObj, today);
    const isSelected = selectedAdminDate === dateKey;

    calendarHtml += `
  <div
    class="calendar-day ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
    onclick="selectAdminDate('${dateKey}')"
  >
    <div class="calendar-day-number">${dateObj.getDate()}</div>

    <div class="calendar-day-summary">
      ${dayStats.fullyConfirmed > 0 ? `<span class="calendar-mini-number ok">${dayStats.fullyConfirmed}</span>` : `<span></span>`}
      ${dayStats.withProblems > 0 ? `<span class="calendar-mini-number problem">${dayStats.withProblems}</span>` : ``}
    </div>
  </div>
`;
  });

  calendarHtml += `
      </div>
    </div>
  `;

  const dayShifts = getShiftsByDateKey(selectedAdminDate);

  let shiftsHtml = `
    <div class="card fade-in calendar-section">
      <div class="page-title">משמרות ליום ${escapeHtml(selectedAdminDate || '')}</div>
  `;

  if (!dayShifts.length) {
    shiftsHtml += `
      <div class="calendar-empty">אין משמרות ביום הזה</div>
    `;
  } else {
    dayShifts.forEach((shift) => {
      shiftsHtml += `
        <div class="list-item">
          <div class="list-main">${escapeHtml(shift.title)}</div>
          <div class="list-sub">${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)}</div>
          ${shift.notes ? `<div class="list-sub">הערות: ${escapeHtml(shift.notes)}</div>` : ''}

          <div style="margin-top: 12px;" class="stagger">
            <div class="badge pending">סה״כ ${shift.total || 0}</div>
            <div class="badge success">מגיעים ${shift.yes_count || 0}</div>
            <div class="badge danger">לא מגיעים ${shift.no_count || 0}</div>
            <div class="badge warning">לא בטוחים ${shift.maybe_count || 0}</div>
          </div>

          <div class="actions">
            <button onclick="openShift(${shift.id})">פתח</button>
            <button class="secondary" onclick="showAssignUsers(${shift.id})">שייך אנשים</button>
            <button class="secondary" onclick="showEditShiftForm(${shift.id})">ערוך</button>
            <button class="danger" onclick="deleteShift(${shift.id})">מחק</button>
          </div>
        </div>
      `;
    });
  }

  shiftsHtml += `</div>`;

  content.innerHTML = calendarHtml + shiftsHtml;
}

function changeAdminMonth(delta) {
  adminCalendarDate = new Date(
    adminCalendarDate.getFullYear(),
    adminCalendarDate.getMonth() + delta,
    1
  );
  renderAdminCalendar();
}

function goToToday() {
  const today = new Date();
  adminCalendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedAdminDate = formatDateKey(today);
  renderAdminCalendar();
}

function selectAdminDate(dateKey) {
  selectedAdminDate = dateKey;
  renderAdminCalendar();
}

function showCreateShiftForm() {
  content.innerHTML = `
    <div class="card fade-in">
      <div class="page-title">יצירת משמרת חדשה</div>

      <div class="label">שם המשמרת</div>
      <input id="shift-title" placeholder="שם המשמרת" />

      <div style="height: 12px;"></div>

      <div class="label">תאריך</div>
      <input id="shift-date" type="date" />

      <div style="height: 12px;"></div>

      <div class="row">
        <div class="col">
          <div class="label">שעת התחלה</div>
          <input id="shift-start" type="time" />
        </div>
        <div class="col">
          <div class="label">שעת סיום</div>
          <input id="shift-end" type="time" />
        </div>
      </div>

      <div style="height: 12px;"></div>

      <div class="label">הערות</div>
      <textarea id="shift-notes" placeholder="הערות"></textarea>

      <div class="actions">
        <button onclick="createShift()">שמור</button>
        <button class="secondary" onclick="loadAdmin()">חזרה</button>
      </div>
    </div>
  `;
}

async function createShift() {
  try {
    const title = document.getElementById('shift-title')?.value.trim() || '';
    const shift_date = document.getElementById('shift-date')?.value || '';
    const start_time = document.getElementById('shift-start')?.value || '';
    const end_time = document.getElementById('shift-end')?.value || '';
    const notes = document.getElementById('shift-notes')?.value.trim() || '';

    await api('/admin/shifts', {
      method: 'POST',
      body: JSON.stringify({ title, shift_date, start_time, end_time, notes })
    });

    selectedAdminDate = shift_date || selectedAdminDate;
    if (shift_date) {
      const [y, m] = shift_date.split('-').map(Number);
      adminCalendarDate = new Date(y, m - 1, 1);
    }

    await loadAdmin();
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

function showEditShiftForm(id) {
  const shift = adminShiftsCache.find((s) => Number(s.id) === Number(id));

  if (!shift) {
    alert('המשמרת לא נמצאה');
    return;
  }

  content.innerHTML = `
    <div class="card fade-in">
      <div class="page-title">עריכת משמרת</div>

      <div class="label">שם המשמרת</div>
      <input id="edit-shift-title" placeholder="שם המשמרת" value="${escapeHtml(shift.title || '')}" />

      <div style="height: 12px;"></div>

      <div class="label">תאריך</div>
      <input id="edit-shift-date" type="date" value="${escapeHtml(shift.shift_date || '')}" />

      <div style="height: 12px;"></div>

      <div class="row">
        <div class="col">
          <div class="label">שעת התחלה</div>
          <input id="edit-shift-start" type="time" value="${escapeHtml(shift.start_time || '')}" />
        </div>
        <div class="col">
          <div class="label">שעת סיום</div>
          <input id="edit-shift-end" type="time" value="${escapeHtml(shift.end_time || '')}" />
        </div>
      </div>

      <div style="height: 12px;"></div>

      <div class="label">הערות</div>
      <textarea id="edit-shift-notes" placeholder="הערות">${escapeHtml(shift.notes || '')}</textarea>

      <div class="actions">
        <button onclick="updateShift(${id})">שמור שינויים</button>
        <button class="secondary" onclick="loadAdmin()">חזרה</button>
      </div>
    </div>
  `;
}

async function updateShift(id) {
  try {
    const title = document.getElementById('edit-shift-title')?.value.trim() || '';
    const shift_date = document.getElementById('edit-shift-date')?.value || '';
    const start_time = document.getElementById('edit-shift-start')?.value || '';
    const end_time = document.getElementById('edit-shift-end')?.value || '';
    const notes = document.getElementById('edit-shift-notes')?.value.trim() || '';

    await api(`/admin/shifts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, shift_date, start_time, end_time, notes })
    });

    selectedAdminDate = shift_date || selectedAdminDate;
    if (shift_date) {
      const [y, m] = shift_date.split('-').map(Number);
      adminCalendarDate = new Date(y, m - 1, 1);
    }

    alert('המשמרת עודכנה ונשלחה הודעה למשתמשים');
    await loadAdmin();
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

async function deleteShift(id) {
  try {
    const ok = confirm('למחוק את המשמרת?');
    if (!ok) return;

    const result = await api(`/admin/shifts/${id}`, {
      method: 'DELETE'
    });

    alert(`המשמרת נמחקה. נשלחו ${result.notifications_sent || 0} הודעות.`);
    await loadAdmin();
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

async function openShift(id) {
  try {
    const data = await api(`/admin/shifts/${id}`);

    let html = `
      <div class="card fade-in">
        <div class="page-title">אנשים משויכים למשמרת</div>
        <div class="stagger">
    `;

    if (!data.people || !data.people.length) {
      html += `
        <div class="empty-state">
          <div class="page-title">אין אנשים משויכים</div>
          <p>אפשר לשייך אנשים מהמסך הקודם</p>
        </div>
      `;
    }

    (data.people || []).forEach((person) => {
      html += `
        <div class="list-item">
          <div class="list-main">${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}</div>
          <div class="list-sub">username: ${escapeHtml(person.username || '---')}</div>
          <div class="list-sub">phone: ${escapeHtml(person.phone || '---')}</div>
          <div class="list-sub">דרגה: ${escapeHtml(person.rank || '')}</div>
          <div class="list-sub">סוג שירות: ${escapeHtml(person.service_type || '')}</div>
          <div style="margin-top: 8px;">
            <span class="badge ${statusBadgeClass(person.status)}">${statusText(person.status)}</span>
          </div>
          ${person.comment ? `
            <div style="margin-top: 10px;">
              <div class="list-main" style="font-size:14px;">סיבה</div>
              <div class="list-sub">${escapeHtml(person.comment)}</div>
            </div>
          ` : ''}
          <div class="actions">
            ${
              person.username || person.phone
                ? `<button class="secondary" onclick='openTelegramChat(${JSON.stringify(person.username || "")}, ${JSON.stringify(person.phone || "")})'>פתח צ׳אט</button>`
                : `<button class="secondary" disabled>אין נתונים לצ׳אט</button>`
            }
            ${person.phone ? `<button class="secondary" onclick='copyText(${JSON.stringify(person.phone)})'>העתק טלפון</button>` : ''}
            ${person.username ? `<button class="secondary" onclick='copyText(${JSON.stringify(person.username)})'>העתק username</button>` : ''}
          </div>
        </div>
      `;
    });

    html += `
        </div>
        <div class="actions">
          <button class="secondary" onclick="loadAdmin()">חזרה</button>
        </div>
      </div>
    `;

    content.innerHTML = html;
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת פרטי המשמרת');
  }
}

async function showAssignUsers(shiftId) {
  try {
    const data = await api('/admin/users');
    const users = data.users || [];

    let html = `
      <div class="card fade-in">
        <div class="page-title">שיוך אנשים למשמרת</div>
    `;

    if (!users.length) {
      html += `
        <div class="empty-state">
          <div class="page-title">אין משתמשים זמינים</div>
          <p>צריך לאשר משתמשים במערכת קודם</p>
        </div>
      `;
    }

    users.forEach((user) => {
      html += `
        <label class="list-item" style="display:block; cursor:pointer;">
          <div class="list-main">
            <input type="checkbox" class="assign-user" value="${user.id}" style="width:auto; margin-left:8px;" />
            ${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}
          </div>
          <div class="list-sub">דרגה: ${escapeHtml(user.rank || '')}</div>
          <div class="list-sub">סוג שירות: ${escapeHtml(user.service_type || '')}</div>
        </label>
      `;
    });

    html += `
        <div class="actions">
          <button onclick="assignUsers(${shiftId})">שמור</button>
          <button class="secondary" onclick="loadAdmin()">חזרה</button>
        </div>
      </div>
    `;

    content.innerHTML = html;
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת רשימת המשתמשים');
  }
}

async function assignUsers(shiftId) {
  try {
    const selected = [...document.querySelectorAll('.assign-user:checked')]
      .map((el) => Number(el.value));

    await api(`/admin/shifts/${shiftId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ user_ids: selected })
    });

    alert('המשתמשים שובצו ונשלחה הודעה בבוט');
    await openShift(shiftId);
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

// ================= MODE SELECT =================

async function showModeSelect() {
  try {
    const profile = await api('/me/profile');

    if (!profile.registered) {
      content.innerHTML = `
        <div class="card center fade-in">
          <div class="page-title">אינך רשום במערכת</div>
          <p class="subtitle">יש לחזור לבוט ולשלוח /start</p>
        </div>
      `;
      return;
    }

    const user = profile.user;

    if (user.registration_status === 'pending_review') {
      content.innerHTML = `
        <div class="card center fade-in">
          <div class="page-title">הבקשה שלך ממתינה לאישור</div>
          <p class="subtitle">לאחר אישור תוכל להיכנס למערכת</p>
        </div>
      `;
      return;
    }

    if (user.registration_status === 'rejected') {
      content.innerHTML = `
        <div class="card center fade-in">
          <div class="page-title">ההרשמה נדחתה</div>
          <p class="subtitle">יש לשלוח /start מחדש בבוט</p>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="card center fade-in">
        <div class="page-title">ברוך הבא ${escapeHtml(user.first_name || '')}</div>
        <p class="subtitle">נא לבחור סוג כניסה</p>
        <div class="actions">
          <button onclick="loadUser()">כניסה רגילה</button>
          <button class="secondary" onclick="loadAdmin()">כניסת מנהל</button>
        </div>
      </div>
    `;
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת המערכת');
  }
}

// ================= INIT =================

async function initApp() {
  try {
    const tg = window.Telegram?.WebApp;

    if (tg) {
      tg.ready();
      tg.expand();
    }

    await showModeSelect();
  } catch (err) {
    showError(err.message || 'שגיאה באתחול');
  }
}

window.respond = respond;
window.openShift = openShift;
window.showCreateShiftForm = showCreateShiftForm;
window.createShift = createShift;
window.showAssignUsers = showAssignUsers;
window.assignUsers = assignUsers;
window.showEditShiftForm = showEditShiftForm;
window.updateShift = updateShift;
window.deleteShift = deleteShift;
window.showModeSelect = showModeSelect;
window.showNoReasonForm = showNoReasonForm;
window.submitNoReason = submitNoReason;
window.openTelegramChat = openTelegramChat;
window.copyText = copyText;
window.initApp = initApp;
window.changeAdminMonth = changeAdminMonth;
window.goToToday = goToToday;
window.selectAdminDate = selectAdminDate;

initApp();