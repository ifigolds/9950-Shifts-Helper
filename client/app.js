const content = document.getElementById('content');
const overlayRoot = document.getElementById('overlay-root');
const noticeRoot = document.getElementById('notice-root');

const ISRAEL_TIMEZONE = 'Asia/Jerusalem';
const WEEKDAY_LABELS = ['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'];

let adminShiftsCache = [];
let pendingNoShiftId = null;
let adminCalendarDate = getCurrentIsraelCalendarMonth();
let selectedAdminDate = null;
let adminOverlayState = null;
let noticeTimer = null;
let userDashboardState = null;
let userTicker = null;
let activeScreen = 'loading';

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

function getIsraelDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const values = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  });

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function getCurrentIsraelDateKey() {
  const parts = getIsraelDateParts();
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getCurrentIsraelCalendarMonth() {
  const parts = getIsraelDateParts();
  return new Date(parts.year, parts.month - 1, 1);
}

function getCurrentIsraelTimeLabel() {
  const parts = getIsraelDateParts();
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function showNotice(message, tone = 'info') {
  if (!noticeRoot) return;

  noticeRoot.innerHTML = `
    <div class="notice notice-${escapeHtml(tone)}">
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  noticeRoot.classList.add('visible');
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    noticeRoot.classList.remove('visible');
    noticeRoot.innerHTML = '';
  }, 2600);
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

function recommendationText(recommendation) {
  if (recommendation === 'overlap') return 'חופף למשמרת אחרת';
  if (recommendation === 'recent') return 'היה במשמרת לאחרונה';
  if (recommendation === 'assigned') return 'כבר משויך למשמרת הזאת';
  return 'מומלץ לשיבוץ';
}

function recommendationClass(recommendation) {
  if (recommendation === 'overlap') return 'danger';
  if (recommendation === 'recent') return 'warning';
  if (recommendation === 'assigned') return 'pending';
  return 'success';
}

function showError(message) {
  stopUserTicker();
  activeScreen = 'error';
  closeAdminOverlay();
  content.innerHTML = `
    <div class="surface surface-centered fade-in">
      <div class="eyebrow">תקלה</div>
      <div class="page-title">לא הצלחנו להשלים את הפעולה</div>
      <p class="subtitle wide-copy">${escapeHtml(message)}</p>
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
    .then(() => showNotice('המידע הועתק ללוח', 'success'))
    .catch(() => showNotice('ההעתקה נכשלה', 'danger'));
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

    showNotice('אין פרטי קשר לפתיחת צ׳אט', 'warning');
  } catch (e) {
    console.error('openTelegramChat error:', e);
    showNotice('לא ניתן לפתוח את הצ׳אט כרגע', 'danger');
  }
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
}

function formatMonthTitle(dateObj) {
  return new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), 1, 12)).toLocaleDateString('he-IL', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  });
}

function formatHumanDate(dateKey) {
  if (!dateKey) return '';
  return parseDateKey(dateKey).toLocaleDateString('he-IL', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatHumanTimeRange(shift) {
  return `${shift.start_time} - ${shift.end_time}`;
}

function formatClockLabel(date = new Date()) {
  return date.toLocaleTimeString('he-IL', {
    timeZone: ISRAEL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatHoursLabel(hours) {
  const value = Number(hours || 0);
  if (Number.isInteger(value)) {
    return `${value}`;
  }

  return value.toFixed(1);
}

function formatDurationLabel(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes} דק׳`;
  if (!minutes) return `${hours} ש׳`;
  return `${hours} ש׳ ${minutes} דק׳`;
}

function formatRelativeDuration(ms, suffixFuture = 'עד תחילת המשמרת', suffixPast = 'מתחילת המשמרת') {
  if (ms < 0) {
    return `${formatDurationLabel(Math.abs(ms))} ${suffixFuture}`;
  }

  return `${formatDurationLabel(ms)} ${suffixPast}`;
}

function getShiftLiveTiming(shift, nowMs = Date.now()) {
  if (!shift?.timing?.start_iso || !shift?.timing?.end_iso) {
    return {
      durationMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      progressPercent: 0,
      isActive: false,
      isCompleted: false,
      isUpcoming: false,
      startsInMs: 0
    };
  }

  const startMs = new Date(shift.timing.start_iso).getTime();
  const endMs = new Date(shift.timing.end_iso).getTime();
  const durationMs = Math.max(1, endMs - startMs);
  const elapsedMs = Math.min(Math.max(nowMs - startMs, 0), durationMs);
  const remainingMs = Math.max(endMs - nowMs, 0);
  const isActive = nowMs >= startMs && nowMs < endMs;
  const isCompleted = nowMs >= endMs;
  const isUpcoming = nowMs < startMs;

  return {
    startMs,
    endMs,
    durationMs,
    elapsedMs,
    remainingMs,
    startsInMs: Math.max(startMs - nowMs, 0),
    progressPercent: Math.min(100, Math.max(0, (elapsedMs / durationMs) * 100)),
    isActive,
    isCompleted,
    isUpcoming
  };
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
  const badgeLabel = problemCount > 0 ? `דורש טיפול ${problemCount}` : 'סגור ומוכן';

  return `
    <div class="list-item shift-card ${compact ? 'shift-card-compact' : ''} ${problemCount > 0 ? 'shift-card-alert' : 'shift-card-ready'}">
      <div class="shift-card-head">
        <div>
          <div class="list-main">${escapeHtml(shift.title)}</div>
          <div class="list-sub">${escapeHtml(formatHumanDate(shift.shift_date))}</div>
          <div class="list-sub">${escapeHtml(shift.start_time)} - ${escapeHtml(shift.end_time)}</div>
        </div>
        <div class="status-cluster">
          <span class="badge ${problemCount > 0 ? 'warning' : 'success'}">${escapeHtml(badgeLabel)}</span>
        </div>
      </div>

      ${shift.notes ? `<div class="list-sub shift-notes">הערות: ${escapeHtml(shift.notes)}</div>` : ''}
      ${
        shift.problem_people?.length
          ? `
            <div class="problem-strip">
              ${shift.problem_people.slice(0, 4).map((person) => `
                <span class="badge ${statusBadgeClass(person.status)}">${escapeHtml(person.name)}</span>
              `).join('')}
            </div>
          `
          : ''
      }

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

function renderAssignableUserCard(user) {
  return `
    <label class="list-item checkbox-card ${user.has_overlap ? 'checkbox-card-disabled' : ''}">
      <div class="checkbox-row">
        <input
          type="checkbox"
          class="assign-user"
          value="${user.id}"
          ${user.assigned_to_target ? 'checked' : ''}
          ${user.has_overlap ? 'disabled' : ''}
        />
        <div class="checkbox-body">
          <div class="list-main">${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</div>
          <div class="list-sub">דרגה: ${escapeHtml(user.rank || '-')}</div>
          <div class="list-sub">סוג שירות: ${escapeHtml(user.service_type || '-')}</div>
          <div class="list-sub">משמרת אחרונה: ${escapeHtml(user.last_shift?.label || 'טרם שובץ')}</div>
          ${user.rest_hours !== null ? `<div class="list-sub">זמן מנוחה עד המשמרת: ${escapeHtml(String(user.rest_hours))} שעות</div>` : ''}
          ${user.overlap_shift ? `<div class="list-sub danger-text">חופף עם: ${escapeHtml(user.overlap_shift.label)}</div>` : ''}
          <div class="status-cluster">
            <span class="badge ${recommendationClass(user.recommendation)}">${escapeHtml(recommendationText(user.recommendation))}</span>
            ${user.assigned_to_target ? '<span class="badge pending">כבר משויך</span>' : ''}
          </div>
        </div>
      </div>
    </label>
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
    const dateKey = adminOverlayState.dateKey || selectedAdminDate || getCurrentIsraelDateKey();

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
            ? users.map((user) => renderAssignableUserCard(user)).join('')
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

function stopUserTicker() {
  if (userTicker) {
    window.clearInterval(userTicker);
    userTicker = null;
  }
}

function startUserTicker() {
  stopUserTicker();
  userTicker = window.setInterval(() => {
    if (activeScreen === 'user' && userDashboardState) {
      renderUserDashboard(userDashboardState.profile, userDashboardState.shifts);
    }
  }, 15000);
}

function renderUserResponseActions(shift, liveTiming) {
  if (!shift || liveTiming.isCompleted) {
    return `
      <div class="actions">
        <button class="secondary" onclick="showModeSelect()">חזרה</button>
      </div>
    `;
  }

  return `
    <div class="actions">
      <button class="success" onclick="respond(${shift.id}, 'yes')">אני מגיע</button>
      <button class="warning" onclick="respond(${shift.id}, 'maybe')">לא בטוח</button>
      <button class="danger" onclick="showNoReasonForm(${shift.id})">לא מגיע</button>
      <button class="secondary" onclick="showModeSelect()">חזרה</button>
    </div>
  `;
}

function renderNextReplacementBlock(shift) {
  if (!shift?.next_shift) return '';

  const names = (shift.replacement_people || [])
    .slice(0, 3)
    .map((person) => [person.first_name, person.last_name].filter(Boolean).join(' '))
    .filter(Boolean);

  return `
    <div class="note-box handover-box">
      <div class="label">החלפה הבאה</div>
      <div class="list-main">${escapeHtml(shift.next_shift.title)}</div>
      <div class="list-sub">${escapeHtml(shift.next_shift.shift_date)} · ${escapeHtml(shift.next_shift.start_time)} - ${escapeHtml(shift.next_shift.end_time)}</div>
      ${
        names.length
          ? `<div class="supporting-copy">צוות מתחלף: ${escapeHtml(names.join(', '))}</div>`
          : '<div class="supporting-copy">עדיין לא שובצו מחליפים למשמרת הבאה.</div>'
      }
    </div>
  `;
}

function renderTimelineCard(shift, isFocus = false) {
  const liveTiming = getShiftLiveTiming(shift);
  const liveLabel = liveTiming.isActive
    ? 'במהלך משמרת'
    : liveTiming.isUpcoming
      ? `מתחילה בעוד ${formatDurationLabel(liveTiming.startsInMs)}`
      : 'הסתיימה';
  const tone = liveTiming.isActive ? 'success' : liveTiming.isUpcoming ? 'warning' : 'pending';

  return `
    <div class="timeline-card ${isFocus ? 'timeline-card-focus' : ''}">
      <div class="timeline-card-head">
        <div>
          <div class="list-main">${escapeHtml(shift.title)}</div>
          <div class="list-sub">${escapeHtml(formatHumanDate(shift.shift_date))}</div>
        </div>
        <span class="badge ${tone}">${escapeHtml(liveLabel)}</span>
      </div>
      <div class="timeline-meta">
        <span class="mini-stat">${escapeHtml(formatHumanTimeRange(shift))}</span>
        <span class="mini-stat">${escapeHtml(statusText(shift.status))}</span>
        <span class="mini-stat muted-text">${formatHoursLabel(shift.duration_hours)} ש׳ מתוכננות</span>
      </div>
      ${shift.comment ? `<div class="supporting-copy">סיבה שנשמרה: ${escapeHtml(shift.comment)}</div>` : ''}
    </div>
  `;
}

function renderUserDashboard(profile, shifts) {
  const safeProfile = profile || { user: {}, stats: {} };
  const user = safeProfile.user || {};
  const completedStats = safeProfile.stats || {};
  const nowMs = Date.now();
  const normalizedShifts = (shifts || []).map((shift) => ({
    ...shift,
    liveTiming: getShiftLiveTiming(shift, nowMs)
  }));

  const activeShift = normalizedShifts.find((shift) => shift.liveTiming.isActive) || null;
  const nextUpcomingShift = normalizedShifts.find((shift) => shift.liveTiming.isUpcoming) || null;
  const fallbackShift = normalizedShifts.length ? normalizedShifts[normalizedShifts.length - 1] : null;
  const focusShift = activeShift || nextUpcomingShift || normalizedShifts.find((shift) => !shift.liveTiming.isCompleted) || fallbackShift;
  const focusTiming = focusShift ? focusShift.liveTiming : null;
  const otherShifts = normalizedShifts.filter((shift) => shift.id !== focusShift?.id).slice(0, 4);
  const upcomingCount = normalizedShifts.filter((shift) => shift.liveTiming.isUpcoming).length;
  const totalAssigned = normalizedShifts.length;
  const currentClock = getCurrentIsraelTimeLabel();
  const todayLabel = formatHumanDate(getCurrentIsraelDateKey());

  let headline = 'כל המשמרות שלך במקום אחד';
  let focusTag = 'המשמרת הקרובה';
  let progressCopy = 'כאן מופיעים פרטי המשמרת והתגובה שלך.';
  let progressTrack = '';
  let supportPanel = '';

  if (focusShift && focusTiming?.isActive) {
    headline = 'אתה כרגע במהלך משמרת';
    focusTag = 'משמרת פעילה עכשיו';
    progressCopy = `עברו ${formatDurationLabel(focusTiming.elapsedMs)} מתוך ${formatDurationLabel(focusTiming.durationMs)} · ${Math.round(focusTiming.progressPercent)}% הושלמו`;
    progressTrack = `
      <div class="progress-panel">
        <div class="progress-panel-head">
          <span>משך שעבר</span>
          <strong>${Math.round(focusTiming.progressPercent)}%</strong>
        </div>
        <div class="progress-track">
          <span style="width: ${Math.max(4, focusTiming.progressPercent)}%"></span>
        </div>
        <div class="progress-meta">
          <span>${formatDurationLabel(focusTiming.elapsedMs)} מהתחלה</span>
          <span>${formatDurationLabel(focusTiming.remainingMs)} לסיום</span>
        </div>
      </div>
    `;
    supportPanel = renderNextReplacementBlock(focusShift);
  } else if (focusShift && focusTiming?.isUpcoming) {
    headline = 'המשמרת הבאה כבר מוכנה';
    focusTag = 'בקרוב מתחיל';
    progressCopy = `נשארו ${formatDurationLabel(focusTiming.startsInMs)} עד תחילת המשמרת.`;
    progressTrack = `
      <div class="support-strip">
        <span class="mini-stat warning-text">מתחילה בעוד ${formatDurationLabel(focusTiming.startsInMs)}</span>
        <span class="mini-stat muted-text">${formatHoursLabel(focusShift.duration_hours)} ש׳ מתוכננות</span>
      </div>
    `;
  } else if (!focusShift) {
    headline = 'אין כרגע משמרת פעילה או קרובה';
    focusTag = 'לוח אישי';
    progressCopy = 'כשתשובץ משמרת חדשה, היא תופיע כאן בצורה ברורה ומרוכזת.';
  }

  content.innerHTML = `
    <div class="view-shell user-view fade-in">
      <section class="hero-panel user-hero">
        <div>
          <div class="eyebrow">מרחב אישי</div>
          <div class="page-title">שלום ${escapeHtml(user.first_name || 'לך')}</div>
          <p class="subtitle wide-copy">${escapeHtml(headline)}</p>
        </div>
        <div class="hero-meta">
          <span class="meta-pill meta-pill-strong">${escapeHtml(todayLabel)}</span>
          <span class="meta-pill">השעה כעת ${escapeHtml(currentClock)}</span>
          <span class="meta-pill">שעון ישראל</span>
        </div>
      </section>

      <section class="dashboard-layout">
        <div class="surface focus-surface ${focusTiming?.isActive ? 'focus-surface-active' : ''}">
          <div class="focus-header">
            <div>
              <div class="eyebrow">${escapeHtml(focusTag)}</div>
              <div class="section-title">${escapeHtml(focusShift?.title || 'אין משמרת זמינה')}</div>
              <p class="subtitle wide-copy">${escapeHtml(progressCopy)}</p>
            </div>
            ${
              focusShift
                ? `<span class="badge ${focusTiming?.isActive ? 'success' : focusTiming?.isUpcoming ? 'warning' : 'pending'}">${escapeHtml(focusTiming?.isActive ? 'פעילה עכשיו' : focusTiming?.isUpcoming ? 'ממתינה להתחלה' : 'ללא פעילות')}</span>`
                : ''
            }
          </div>

          ${
            focusShift
              ? `
                <div class="focus-info-grid">
                  <div class="info-tile">
                    <div class="label">תאריך</div>
                    <div class="info-value">${escapeHtml(formatHumanDate(focusShift.shift_date))}</div>
                  </div>
                  <div class="info-tile">
                    <div class="label">טווח שעות</div>
                    <div class="info-value">${escapeHtml(formatHumanTimeRange(focusShift))}</div>
                  </div>
                  <div class="info-tile">
                    <div class="label">סטטוס תגובה</div>
                    <div class="info-value">
                      <span class="badge ${statusBadgeClass(focusShift.status)}">${escapeHtml(statusText(focusShift.status))}</span>
                    </div>
                  </div>
                  <div class="info-tile">
                    <div class="label">${focusTiming?.isActive ? 'זמן שעבר' : focusTiming?.isUpcoming ? 'זמן עד התחלה' : 'משך מתוכנן'}</div>
                    <div class="info-value">
                      ${
                        focusTiming?.isActive
                          ? escapeHtml(formatDurationLabel(focusTiming.elapsedMs))
                          : focusTiming?.isUpcoming
                            ? escapeHtml(formatDurationLabel(focusTiming.startsInMs))
                            : escapeHtml(formatDurationLabel(focusTiming?.durationMs || 0))
                      }
                    </div>
                  </div>
                </div>
                ${progressTrack}
                ${focusShift.notes ? `<div class="note-box"><div class="label">הערות למשמרת</div><div class="list-sub">${escapeHtml(focusShift.notes)}</div></div>` : ''}
                ${focusShift.comment ? `<div class="note-box"><div class="label">סיבה שנשמרה</div><div class="list-sub">${escapeHtml(focusShift.comment)}</div></div>` : ''}
                ${supportPanel}
                ${renderUserResponseActions(focusShift, focusTiming)}
              `
              : `
                <div class="empty-state panel-empty">
                  <div class="section-title">אין כרגע משמרות להצגה</div>
                  <p class="subtitle">המערכת תציג כאן אוטומטית את המשמרת הפעילה או הקרובה ביותר.</p>
                  <div class="actions">
                    <button class="secondary" onclick="showModeSelect()">חזרה</button>
                  </div>
                </div>
              `
          }
        </div>

        <aside class="summary-column">
          <div class="surface summary-surface">
            <div class="eyebrow">סטטוס אישי</div>
            <div class="stats-grid">
              <div class="stat-tile">
                <span class="stat-label">משמרות שהושלמו</span>
                <strong>${completedStats.completed_shifts || 0}</strong>
              </div>
              <div class="stat-tile">
                <span class="stat-label">שעות שבוצעו</span>
                <strong>${formatHoursLabel(completedStats.completed_hours || 0)}</strong>
              </div>
              <div class="stat-tile">
                <span class="stat-label">משמרות עתידיות</span>
                <strong>${upcomingCount}</strong>
              </div>
              <div class="stat-tile">
                <span class="stat-label">סה״כ שיבוצים</span>
                <strong>${totalAssigned}</strong>
              </div>
            </div>
          </div>

          <div class="surface summary-surface subtle-surface">
            <div class="eyebrow">זמן נוכחי</div>
            <div class="section-title">${escapeHtml(currentClock)}</div>
            <p class="subtitle">כל ההצגות והחישובים במסך הזה עובדים לפי ${escapeHtml(ISRAEL_TIMEZONE)}.</p>
          </div>
        </aside>
      </section>

      <section class="surface timeline-surface">
        <div class="section-head">
          <div>
            <div class="eyebrow">ציר משמרות</div>
            <div class="section-title">מבט מהיר על השיבוצים שלך</div>
          </div>
          <span class="meta-pill">${totalAssigned} משמרות במערכת</span>
        </div>

        ${
          focusShift || otherShifts.length
            ? `
              <div class="timeline-list">
                ${focusShift ? renderTimelineCard(focusShift, true) : ''}
                ${otherShifts.map((shift) => renderTimelineCard(shift)).join('')}
              </div>
            `
            : `
              <div class="empty-state panel-empty">
                <div class="section-title">עדיין אין היסטוריית משמרות</div>
                <p class="subtitle">ברגע שתשובץ למשמרת, היא תופיע כאן יחד עם הסטטוס והזמנים שלה.</p>
              </div>
            `
        }
      </section>
    </div>
  `;
}

async function loadUser() {
  stopUserTicker();
  closeAdminOverlay();
  activeScreen = 'user';

  try {
    const [profileData, shiftsData] = await Promise.all([
      api('/me/profile'),
      api('/me/shifts')
    ]);

    userDashboardState = {
      profile: profileData,
      shifts: shiftsData.shifts || []
    };

    renderUserDashboard(profileData, shiftsData.shifts || []);
    startUserTicker();
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
    showNotice('התגובה שלך נשמרה', 'success');
    await loadUser();
  } catch (err) {
    showNotice(err.message || 'שגיאה', 'danger');
  }
}

function showNoReasonForm(shiftId) {
  stopUserTicker();
  pendingNoShiftId = shiftId;
  activeScreen = 'user';

  content.innerHTML = `
    <div class="surface surface-form fade-in">
      <div class="eyebrow">עדכון תגובה</div>
      <div class="page-title">אי הגעה למשמרת</div>
      <p class="subtitle wide-copy">כדי לעדכן שאינך מגיע, צריך לצרף סיבה קצרה וברורה.</p>

      <div class="label">סיבה</div>
      <textarea id="no-reason-input" placeholder="כתוב כאן את הסיבה לאי ההגעה"></textarea>

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
    showNotice('יש להזין סיבה לפני השליחה', 'warning');
    return;
  }

  respond(pendingNoShiftId, 'no', reason);
}

// ================= ADMIN =================

async function loadAdmin(overlayToOpen = null) {
  stopUserTicker();
  activeScreen = 'admin';

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
      selectedAdminDate = getCurrentIsraelDateKey();
      adminCalendarDate = getCurrentIsraelCalendarMonth();
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
  const todayKey = getCurrentIsraelDateKey();
  const monthTitle = formatMonthTitle(current);
  const monthStats = getCurrentMonthStats(current);
  const selectedDay = getSelectedDayOverview(selectedAdminDate);
  const monthCells = buildMonthCells(current);

  const calendarCellsHtml = monthCells.map(({ dateObj, muted }) => {
    const dateKey = formatDateKey(dateObj);
    const dayStats = getCalendarDayStats(dateKey);
    const isToday = dateKey === todayKey;
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
          <div class="eyebrow">כניסת מנהל</div>
          <div class="page-title">יומן משמרות</div>
          <p class="admin-header-copy">לחץ על יום בלוח כדי לפתוח חלון פעולות, ליצור משמרת חדשה ולטפל במה שדורש מענה.</p>
        </div>
        <div class="admin-header-actions">
          <button onclick="showCreateShiftForm('${escapeHtml(selectedAdminDate || getCurrentIsraelDateKey())}')">משמרת חדשה</button>
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
  adminCalendarDate = getCurrentIsraelCalendarMonth();
  selectedAdminDate = getCurrentIsraelDateKey();
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
    dateKey: dateKey || getCurrentIsraelDateKey()
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
    showNotice('המשמרת נוצרה בהצלחה', 'success');
  } catch (err) {
    showNotice(err.message || 'שגיאה', 'danger');
  }
}

function showEditShiftForm(id) {
  const shift = getShiftById(id);

  if (!shift) {
    showNotice('המשמרת לא נמצאה', 'warning');
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

    showNotice('המשמרת עודכנה והמשתמשים קיבלו הודעה', 'success');
    await loadAdmin({ type: 'day', dateKey: selectedAdminDate });
  } catch (err) {
    showNotice(err.message || 'שגיאה', 'danger');
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

    showNotice(`המשמרת נמחקה. נשלחו ${result.notifications_sent || 0} הודעות.`, 'success');
    await loadAdmin({
      type: 'day',
      dateKey: shift?.shift_date || selectedAdminDate
    });
  } catch (err) {
    showNotice(err.message || 'שגיאה', 'danger');
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
    const data = await api(`/admin/users?shift_id=${shiftId}`);

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

    showNotice('המשתמשים שובצו ונשלחה הודעה בבוט', 'success');
    const shift = getShiftById(shiftId);
    await loadAdmin({
      type: 'shift-details',
      shift,
      people: (await api(`/admin/shifts/${shiftId}`)).people || []
    });
  } catch (err) {
    showNotice(err.message || 'שגיאה', 'danger');
  }
}

// ================= MODE SELECT =================

async function showModeSelect() {
  stopUserTicker();
  closeAdminOverlay();
  activeScreen = 'mode-select';

  try {
    const profile = await api('/me/profile');

    if (!profile.registered) {
      content.innerHTML = `
        <div class="surface surface-centered fade-in">
          <div class="eyebrow">חיבור לחשבון</div>
          <div class="page-title">אינך רשום במערכת</div>
          <p class="subtitle wide-copy">יש לחזור לבוט, לשלוח <code>/start</code> ולהשלים את תהליך ההרשמה.</p>
        </div>
      `;
      return;
    }

    const user = profile.user;

    if (user.registration_status === 'pending_review') {
      content.innerHTML = `
        <div class="surface surface-centered fade-in">
          <div class="eyebrow">ממתין לאישור</div>
          <div class="page-title">הבקשה שלך ממתינה לאישור</div>
          <p class="subtitle wide-copy">ברגע שהמנהל יאשר את ההרשמה, הכניסה למערכת תיפתח אוטומטית.</p>
        </div>
      `;
      return;
    }

    if (user.registration_status === 'rejected') {
      content.innerHTML = `
        <div class="surface surface-centered fade-in">
          <div class="eyebrow">סטטוס הרשמה</div>
          <div class="page-title">ההרשמה נדחתה</div>
          <p class="subtitle wide-copy">אפשר לחזור לבוט, לשלוח <code>/start</code> ולהגיש את הפרטים מחדש.</p>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="view-shell fade-in">
        <section class="hero-panel mode-hero">
          <div>
            <div class="eyebrow">9950 Shift System</div>
            <div class="page-title">ברוך הבא ${escapeHtml(user.first_name || '')}</div>
            <p class="subtitle wide-copy">בחר את סביבת העבודה שמתאימה לך עכשיו. האזור האישי שם את המשמרת שחשובה כרגע במרכז, ואזור המנהל נותן מבט ברור על כל ימי הלוח.</p>
          </div>
          <div class="hero-meta">
            <span class="meta-pill meta-pill-strong">${escapeHtml(formatHumanDate(getCurrentIsraelDateKey()))}</span>
            <span class="meta-pill">השעה כעת ${escapeHtml(getCurrentIsraelTimeLabel())}</span>
            <span class="meta-pill">שעון ישראל</span>
          </div>
        </section>

        <section class="mode-grid">
          <button class="mode-card mode-card-primary" onclick="loadUser()">
            <span class="mode-card-tag">אישי</span>
            <strong>לוח משמרות אישי</strong>
            <span>המשמרת הפעילה או הקרובה, זמן שעבר, התקדמות ותגובה מהירה במקום אחד.</span>
          </button>
          <button class="mode-card" onclick="loadAdmin()">
            <span class="mode-card-tag">ניהול</span>
            <strong>יומן משמרות למנהל</strong>
            <span>לוח חודשי, בעיות שדורשות טיפול, פתיחת יום ושיבוץ מהיר של אנשים.</span>
          </button>
        </section>
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
