const content = document.getElementById('content');
const overlayRoot = document.getElementById('overlay-root');

let adminShiftsCache = [];
let pendingNoShiftId = null;
let adminCalendarDate = new Date();
let selectedAdminDate = null;
let adminOverlayState = null;

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
    data = { error: 'תגובת שרת לא תקינה' };
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
  closeAdminOverlay();
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

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function formatMonthTitle(dateObj) {
  return dateObj.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric'
  });
}

function formatHumanDate(dateKey) {
  if (!dateKey) return '';
  return parseDateKey(dateKey).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB);
}

function getShiftsByDateKey(dateKey) {
  return adminShiftsCache.filter((shift) => shift.shift_date === dateKey);
}

function getShiftById(shiftId) {
  return adminShiftsCache.find((shift) => Number(shift.id) === Number(shiftId)) || null;
}

function getShiftProblemCount(shift) {
  return Number(shift.pending_count || 0) + Number(shift.maybe_count || 0) + Number(shift.no_count || 0);
}

function isShiftFullyConfirmed(shift) {
  return Number(shift.total || 0) > 0 && getShiftProblemCount(shift) === 0;
}

function getCalendarDayStats(dateKey) {
  const shifts = getShiftsByDateKey(dateKey);

  let fullyConfirmed = 0;
  let withProblems = 0;

  shifts.forEach((shift) => {
    if (isShiftFullyConfirmed(shift)) {
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

function getCurrentMonthStats(dateObj) {
  const month = dateObj.getMonth();
  const year = dateObj.getFullYear();

  const shifts = adminShiftsCache.filter((shift) => {
    const shiftDate = parseDateKey(shift.shift_date);
    return shiftDate.getMonth() === month && shiftDate.getFullYear() === year;
  });

  let fullyConfirmed = 0;
  let withProblems = 0;

  shifts.forEach((shift) => {
    if (isShiftFullyConfirmed(shift)) {
      fullyConfirmed += 1;
    } else {
      withProblems += 1;
    }
  });

  return {
    total: shifts.length,
    fullyConfirmed,
    withProblems
  };
}

function getSelectedDayOverview(dateKey) {
  const shifts = getShiftsByDateKey(dateKey);
  const stats = getCalendarDayStats(dateKey);

  return {
    shifts,
    stats,
    title: dateKey ? formatHumanDate(dateKey) : 'לא נבחר תאריך'
  };
}

function buildMonthCells(dateObj) {
  const current = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
  const firstDayOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
  const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
  const daysInPrevMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate();

  const cells = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dateObjPrev = new Date(current.getFullYear(), current.getMonth() - 1, day);
    cells.push({ dateObj: dateObjPrev, muted: true });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObjCurrent = new Date(current.getFullYear(), current.getMonth(), day);
    cells.push({ dateObj: dateObjCurrent, muted: false });
  }

  while (cells.length % 7 !== 0) {
    const nextIndex = cells.length - (startWeekday + daysInMonth) + 1;
    const dateObjNext = new Date(current.getFullYear(), current.getMonth() + 1, nextIndex);
    cells.push({ dateObj: dateObjNext, muted: true });
  }

  return cells;
}

function renderShiftActions(shift, compact = false) {
  return `
    <div class="actions ${compact ? 'compact-actions' : ''}">
      <button onclick="openShift(${shift.id})">פרטים</button>
      <button class="secondary" onclick="showAssignUsers(${shift.id})">שבץ אנשים</button>
      <button class="secondary" onclick="showEditShiftForm(${shift.id})">ערוך</button>
      <button class="danger" onclick="deleteShift(${shift.id})">מחק</button>
    </div>
  `;
}

function renderShiftCard(shift, compact = false) {
  const problemCount = getShiftProblemCount(shift);

  return `
    <div class="list-item shift-card ${compact ? 'shift-card-compact' : ''}">
      <div class="shift-card-head">
        <div>
          <div class="list-main">${escapeHtml(shift.title)}</div>
          <div class="list-sub">${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)}</div>
        </div>
        <div class="status-cluster">
          <span class="badge ${problemCount > 0 ? 'warning' : 'success'}">
            ${problemCount > 0 ? `דורש טיפול ${problemCount}` : 'סגור'}
          </span>
        </div>
      </div>

      ${shift.notes ? `<div class="list-sub shift-notes">הערות: ${escapeHtml(shift.notes)}</div>` : ''}

      <div class="stat-line">
        <span class="mini-stat">סה״כ ${shift.total || 0}</span>
        <span class="mini-stat success-text">מגיעים ${shift.yes_count || 0}</span>
        <span class="mini-stat danger-text">לא מגיעים ${shift.no_count || 0}</span>
        <span class="mini-stat warning-text">לא בטוחים ${shift.maybe_count || 0}</span>
        <span class="mini-stat muted-text">ממתינים ${shift.pending_count || 0}</span>
      </div>

      ${renderShiftActions(shift, compact)}
    </div>
  `;
}

function renderAssignedPersonCard(person) {
  return `
    <div class="list-item person-card">
      <div class="list-main">${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}</div>
      <div class="list-sub">username: ${escapeHtml(person.username || '---')}</div>
      <div class="list-sub">phone: ${escapeHtml(person.phone || '---')}</div>
      <div class="list-sub">דרגה: ${escapeHtml(person.rank || '')}</div>
      <div class="list-sub">סוג שירות: ${escapeHtml(person.service_type || '')}</div>
      <div class="person-card-footer">
        <span class="badge ${statusBadgeClass(person.status)}">${statusText(person.status)}</span>
      </div>
      ${person.comment ? `
        <div class="note-box">
          <div class="label">סיבה</div>
          <div class="list-sub">${escapeHtml(person.comment)}</div>
        </div>
      ` : ''}
      <div class="actions compact-actions">
        ${
          person.username || person.phone
            ? `<button class="secondary" onclick='openTelegramChat(${JSON.stringify(person.username || '')}, ${JSON.stringify(person.phone || '')})'>פתח צ׳אט</button>`
            : `<button class="secondary" disabled>אין נתונים לצ׳אט</button>`
        }
        ${person.phone ? `<button class="secondary" onclick='copyText(${JSON.stringify(person.phone)})'>העתק טלפון</button>` : ''}
        ${person.username ? `<button class="secondary" onclick='copyText(${JSON.stringify(person.username)})'>העתק username</button>` : ''}
      </div>
    </div>
  `;
}

function setAdminOverlay(state) {
  adminOverlayState = state;
  renderAdminOverlay();
}

function closeAdminOverlay() {
  adminOverlayState = null;
  renderAdminOverlay();
}

function renderAdminOverlay() {
  if (!overlayRoot) return;

  if (!adminOverlayState) {
    overlayRoot.innerHTML = '';
    document.body.classList.remove('overlay-open');
    return;
  }

  document.body.classList.add('overlay-open');

  let panelClass = 'overlay-panel';
  let overlayContent = '';

  if (adminOverlayState.type === 'day') {
    const dateKey = adminOverlayState.dateKey;
    const overview = getSelectedDayOverview(dateKey);

    overlayContent = `
      <div class="overlay-header">
        <div>
          <div class="overlay-eyebrow">מרכז שליטה יומי</div>
          <div class="overlay-title">${escapeHtml(overview.title)}</div>
          <div class="subtitle">מכאן אפשר לפתוח יום, ליצור משמרת חדשה או לטפל במה שדורש תשומת לב.</div>
        </div>
        <button class="overlay-close" onclick="closeAdminOverlay()">×</button>
      </div>

      <div class="overlay-actions-bar">
        <button onclick="showCreateShiftForm('${dateKey}')">משמרת חדשה לתאריך הזה</button>
        <button class="secondary" onclick="closeAdminOverlay()">סגור</button>
      </div>

      <div class="overlay-metrics">
        <div class="metric-chip">
          <span class="metric-value">${overview.stats.total}</span>
          <span class="metric-label">משמרות</span>
        </div>
        <div class="metric-chip">
          <span class="metric-value success-text">${overview.stats.fullyConfirmed}</span>
          <span class="metric-label">סגורות</span>
        </div>
        <div class="metric-chip">
          <span class="metric-value warning-text">${overview.stats.withProblems}</span>
          <span class="metric-label">דורשות טיפול</span>
        </div>
      </div>

      <div class="overlay-body-stack">
        ${
          overview.shifts.length
            ? overview.shifts.map((shift) => renderShiftCard(shift, true)).join('')
            : `
              <div class="empty-state">
                <div class="page-title">אין משמרות ביום הזה</div>
                <p>זה זמן טוב לפתוח משמרת חדשה ישירות לתאריך שבחרת.</p>
              </div>
            `
        }
      </div>
    `;
  } else if (adminOverlayState.type === 'create-shift') {
    const dateKey = adminOverlayState.dateKey || selectedAdminDate || formatDateKey(new Date());

    overlayContent = `
      <div class="overlay-header">
        <div>
          <div class="overlay-eyebrow">יצירה מהירה</div>
          <div class="overlay-title">משמרת חדשה</div>
          <div class="subtitle">פתיחת משמרת בלי לצאת מהלוח.</div>
        </div>
        <button class="overlay-close" onclick="closeAdminOverlay()">×</button>
      </div>

      <div class="modal-fields">
        <div>
          <div class="label">שם המשמרת</div>
          <input id="shift-title" placeholder="לדוגמה: בוקר גזרה" />
        </div>

        <div>
          <div class="label">תאריך</div>
          <input id="shift-date" type="date" value="${escapeHtml(dateKey)}" />
        </div>

        <div class="modal-grid">
          <div>
            <div class="label">שעת התחלה</div>
            <input id="shift-start" type="time" />
          </div>
          <div>
            <div class="label">שעת סיום</div>
            <input id="shift-end" type="time" />
          </div>
        </div>

        <div>
          <div class="label">הערות</div>
          <textarea id="shift-notes" placeholder="מה חשוב לדעת על המשמרת"></textarea>
        </div>
      </div>

      <div class="overlay-actions-bar">
        <button onclick="createShift()">שמור משמרת</button>
        <button class="secondary" onclick="showDayPlanner('${dateKey}')">חזור ליום</button>
      </div>
    `;
  } else if (adminOverlayState.type === 'edit-shift') {
    const shift = adminOverlayState.shift;
    panelClass += ' overlay-panel-wide';

    overlayContent = `
      <div class="overlay-header">
        <div>
          <div class="overlay-eyebrow">עריכת משמרת</div>
          <div class="overlay-title">${escapeHtml(shift.title || 'משמרת')}</div>
          <div class="subtitle">אפשר לעדכן שעות, תאריך והערות בלי לעזוב את הלוח.</div>
        </div>
        <button class="overlay-close" onclick="closeAdminOverlay()">×</button>
      </div>

      <div class="modal-fields">
        <div>
          <div class="label">שם המשמרת</div>
          <input id="edit-shift-title" placeholder="שם המשמרת" value="${escapeHtml(shift.title || '')}" />
        </div>

        <div>
          <div class="label">תאריך</div>
          <input id="edit-shift-date" type="date" value="${escapeHtml(shift.shift_date || '')}" />
        </div>

        <div class="modal-grid">
          <div>
            <div class="label">שעת התחלה</div>
            <input id="edit-shift-start" type="time" value="${escapeHtml(shift.start_time || '')}" />
          </div>
          <div>
            <div class="label">שעת סיום</div>
            <input id="edit-shift-end" type="time" value="${escapeHtml(shift.end_time || '')}" />
          </div>
        </div>

        <div>
          <div class="label">הערות</div>
          <textarea id="edit-shift-notes" placeholder="הערות">${escapeHtml(shift.notes || '')}</textarea>
        </div>
      </div>

      <div class="overlay-actions-bar">
        <button onclick="updateShift(${shift.id})">שמור שינויים</button>
        <button class="secondary" onclick="showDayPlanner('${escapeHtml(shift.shift_date || selectedAdminDate || '')}')">חזור ליום</button>
      </div>
    `;
  } else if (adminOverlayState.type === 'shift-details') {
    const shift = adminOverlayState.shift;
    const people = adminOverlayState.people || [];
    panelClass += ' overlay-panel-wide';

    overlayContent = `
      <div class="overlay-header">
        <div>
          <div class="overlay-eyebrow">תמונת מצב</div>
          <div class="overlay-title">${escapeHtml(shift.title)}</div>
          <div class="subtitle">${escapeHtml(shift.shift_date)} · ${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)}</div>
        </div>
        <button class="overlay-close" onclick="closeAdminOverlay()">×</button>
      </div>

      ${shift.notes ? `<div class="note-box"><div class="label">הערות</div><div class="list-sub">${escapeHtml(shift.notes)}</div></div>` : ''}

      <div class="overlay-actions-bar">
        <button class="secondary" onclick="showAssignUsers(${shift.id})">שבץ אנשים</button>
        <button class="secondary" onclick="showEditShiftForm(${shift.id})">ערוך משמרת</button>
        <button class="secondary" onclick="showDayPlanner('${shift.shift_date}')">חזור ליום</button>
      </div>

      <div class="overlay-body-stack">
        ${
          people.length
            ? people.map((person) => renderAssignedPersonCard(person)).join('')
            : `
              <div class="empty-state">
                <div class="page-title">אין אנשים משויכים</div>
                <p>אפשר לשייך אנשים מהמסך הזה בלי לחזור אחורה.</p>
              </div>
            `
        }
      </div>
    `;
  } else if (adminOverlayState.type === 'assign-users') {
    const shift = adminOverlayState.shift;
    const users = adminOverlayState.users || [];
    panelClass += ' overlay-panel-wide';

    overlayContent = `
      <div class="overlay-header">
        <div>
          <div class="overlay-eyebrow">שיוך אנשים</div>
          <div class="overlay-title">${escapeHtml(shift.title)}</div>
          <div class="subtitle">בחר את האנשים שתרצה להוסיף למשמרת.</div>
        </div>
        <button class="overlay-close" onclick="closeAdminOverlay()">×</button>
      </div>

      <div class="checkbox-list">
        ${
          users.length
            ? users.map((user) => `
                <label class="list-item checkbox-card">
                  <div class="checkbox-row">
                    <input type="checkbox" class="assign-user" value="${user.id}" />
                    <div>
                      <div class="list-main">${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</div>
                      <div class="list-sub">דרגה: ${escapeHtml(user.rank || '')}</div>
                      <div class="list-sub">סוג שירות: ${escapeHtml(user.service_type || '')}</div>
                    </div>
                  </div>
                </label>
              `).join('')
            : `
              <div class="empty-state">
                <div class="page-title">אין משתמשים זמינים</div>
                <p>צריך קודם לאשר משתמשים במערכת כדי לשבץ אותם למשמרות.</p>
              </div>
            `
        }
      </div>

      <div class="overlay-actions-bar">
        <button onclick="assignUsers(${shift.id})">שמור שיוך</button>
        <button class="secondary" onclick="openShift(${shift.id})">חזור לפרטי המשמרת</button>
      </div>
    `;
  }

  overlayRoot.innerHTML = `
    <div class="overlay-backdrop" onclick="closeAdminOverlay()">
      <div class="${panelClass}" onclick="event.stopPropagation()">
        ${overlayContent}
      </div>
    </div>
  `;
}

// ================= USER =================

async function loadUser() {
  closeAdminOverlay();

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

async function loadAdmin(overlayToOpen = null) {
  try {
    const profile = await api('/me/profile');
    const user = profile.user;

    if (!user || user.role !== 'admin') {
      closeAdminOverlay();
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

    if (overlayToOpen) {
      setAdminOverlay(overlayToOpen);
    } else {
      renderAdminOverlay();
    }
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת אזור מנהל');
  }
}

function renderAdminCalendar() {
  const current = new Date(adminCalendarDate.getFullYear(), adminCalendarDate.getMonth(), 1);
  const today = new Date();
  const monthTitle = formatMonthTitle(current);
  const monthStats = getCurrentMonthStats(current);
  const selectedDay = getSelectedDayOverview(selectedAdminDate);
  const monthCells = buildMonthCells(current);

  const calendarCellsHtml = monthCells.map(({ dateObj, muted }) => {
    const dateKey = formatDateKey(dateObj);
    const dayStats = getCalendarDayStats(dateKey);
    const isToday = isSameDay(dateObj, today);
    const isSelected = selectedAdminDate === dateKey;
    const hasShifts = dayStats.total > 0;

    return `
      <button
        class="calendar-day ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasShifts ? 'has-shifts' : ''}"
        onclick="selectAdminDate('${dateKey}')"
      >
        <div class="calendar-day-top">
          <div class="calendar-day-number">${dateObj.getDate()}</div>
          ${hasShifts ? `<span class="calendar-day-count">${dayStats.total}</span>` : ''}
        </div>

        <div class="calendar-day-summary">
          ${dayStats.fullyConfirmed > 0 ? `<span class="calendar-mini-number ok">${dayStats.fullyConfirmed}</span>` : `<span></span>`}
          ${dayStats.withProblems > 0 ? `<span class="calendar-mini-number problem">${dayStats.withProblems}</span>` : ``}
        </div>
      </button>
    `;
  }).join('');

  content.innerHTML = `
    <div class="card admin-header-card fade-in">
      <div class="admin-header-main">
        <div>
          <div class="subtitle">כניסת מנהל</div>
          <div class="page-title">יומן משמרות</div>
          <p class="admin-header-copy">לחץ על יום בלוח כדי לפתוח חלון פעולות, ליצור משמרת חדשה ולטפל במה שדורש מענה.</p>
        </div>
        <div class="admin-header-actions">
          <button onclick="showCreateShiftForm('${escapeHtml(selectedAdminDate || formatDateKey(new Date()))}')">משמרת חדשה</button>
          <button class="secondary" onclick="showModeSelect()">חזרה</button>
        </div>
      </div>

      <div class="overview-grid">
        <div class="overview-card">
          <div class="overview-label">משמרות החודש</div>
          <div class="overview-value">${monthStats.total}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">סגורות</div>
          <div class="overview-value success-text">${monthStats.fullyConfirmed}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">דורשות טיפול</div>
          <div class="overview-value warning-text">${monthStats.withProblems}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">היום שנבחר</div>
          <div class="overview-value">${selectedDay.stats.total}</div>
        </div>
      </div>
    </div>

    <div class="card fade-in admin-calendar-card">
      <div class="calendar-toolbar">
        <button class="secondary" onclick="changeAdminMonth(-1)">חודש קודם</button>
        <button class="secondary" onclick="goToToday()">היום</button>
        <button class="secondary" onclick="changeAdminMonth(1)">חודש הבא</button>
      </div>

      <div class="calendar-title">${escapeHtml(monthTitle)}</div>
      <div class="calendar-caption">ירוק = יום סגור, אדום = יום עם בעיות, המספר הקטן מציג כמה משמרות יש ביום.</div>

      <div class="calendar-grid">
        <div class="calendar-weekday">ב׳</div>
        <div class="calendar-weekday">ג׳</div>
        <div class="calendar-weekday">ד׳</div>
        <div class="calendar-weekday">ה׳</div>
        <div class="calendar-weekday">ו׳</div>
        <div class="calendar-weekday">ש׳</div>
        <div class="calendar-weekday">א׳</div>
        ${calendarCellsHtml}
      </div>
    </div>

    <div class="card fade-in day-focus-card">
      <div class="day-focus-head">
        <div>
          <div class="subtitle">פוקוס נוכחי</div>
          <div class="page-title">${escapeHtml(selectedDay.title)}</div>
        </div>
        <div class="day-focus-actions">
          <button onclick="showDayPlanner('${escapeHtml(selectedAdminDate || '')}')">פתח את היום</button>
          <button class="secondary" onclick="showCreateShiftForm('${escapeHtml(selectedAdminDate || '')}')">הוסף משמרת</button>
        </div>
      </div>

      <div class="stat-line">
        <span class="mini-stat">משמרות ${selectedDay.stats.total}</span>
        <span class="mini-stat success-text">סגורות ${selectedDay.stats.fullyConfirmed}</span>
        <span class="mini-stat warning-text">דורשות טיפול ${selectedDay.stats.withProblems}</span>
      </div>

      ${
        selectedDay.shifts.length
          ? `
            <div class="day-preview-list">
              ${selectedDay.shifts.slice(0, 3).map((shift) => renderShiftCard(shift, true)).join('')}
            </div>
          `
          : `
            <div class="empty-state day-preview-empty">
              <div class="page-title">אין משמרות ביום הזה</div>
              <p>לחץ על "הוסף משמרת" כדי לפתוח את היום ישירות מהלוח.</p>
            </div>
          `
      }
    </div>
  `;
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
  showDayPlanner(selectedAdminDate);
}

function selectAdminDate(dateKey) {
  selectedAdminDate = dateKey;
  renderAdminCalendar();
  showDayPlanner(dateKey);
}

function showDayPlanner(dateKey = selectedAdminDate) {
  selectedAdminDate = dateKey;
  renderAdminCalendar();
  setAdminOverlay({ type: 'day', dateKey });
}

function showCreateShiftForm(dateKey = selectedAdminDate) {
  setAdminOverlay({
    type: 'create-shift',
    dateKey: dateKey || formatDateKey(new Date())
  });
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

    await loadAdmin({ type: 'day', dateKey: selectedAdminDate });
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

function showEditShiftForm(id) {
  const shift = getShiftById(id);

  if (!shift) {
    alert('המשמרת לא נמצאה');
    return;
  }

  setAdminOverlay({
    type: 'edit-shift',
    shift
  });
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
    await loadAdmin({ type: 'day', dateKey: selectedAdminDate });
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

async function deleteShift(id) {
  try {
    const shift = getShiftById(id);
    const ok = confirm('למחוק את המשמרת?');
    if (!ok) return;

    const result = await api(`/admin/shifts/${id}`, {
      method: 'DELETE'
    });

    alert(`המשמרת נמחקה. נשלחו ${result.notifications_sent || 0} הודעות.`);
    await loadAdmin({
      type: 'day',
      dateKey: shift?.shift_date || selectedAdminDate
    });
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

async function openShift(id) {
  try {
    const shift = getShiftById(id);
    const data = await api(`/admin/shifts/${id}`);

    setAdminOverlay({
      type: 'shift-details',
      shift,
      people: data.people || []
    });
  } catch (err) {
    showError(err.message || 'שגיאה בטעינת פרטי המשמרת');
  }
}

async function showAssignUsers(shiftId) {
  try {
    const shift = getShiftById(shiftId);
    const data = await api('/admin/users');

    setAdminOverlay({
      type: 'assign-users',
      shift,
      users: data.users || []
    });
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
    const shift = getShiftById(shiftId);
    await loadAdmin({
      type: 'shift-details',
      shift,
      people: (await api(`/admin/shifts/${shiftId}`)).people || []
    });
  } catch (err) {
    alert(err.message || 'שגיאה');
  }
}

// ================= MODE SELECT =================

async function showModeSelect() {
  closeAdminOverlay();

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
        <p class="subtitle">בחר איך תרצה להיכנס עכשיו</p>
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adminOverlayState) {
    closeAdminOverlay();
  }
});

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
window.closeAdminOverlay = closeAdminOverlay;
window.showDayPlanner = showDayPlanner;

initApp();
