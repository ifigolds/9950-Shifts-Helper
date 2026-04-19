import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'https://nine950-backend.onrender.com'

function statusText(status) {
  if (status === 'yes') return 'מגיע'
  if (status === 'no') return 'לא מגיע'
  if (status === 'maybe') return 'לא בטוח'
  return 'לא ענה'
}

function statusBadgeClass(status) {
  if (status === 'yes') return 'success'
  if (status === 'no') return 'danger'
  if (status === 'maybe') return 'warning'
  return 'pending'
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear()
  const m = String(dateObj.getMonth() + 1).padStart(2, '0')
  const d = String(dateObj.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`)
}

function formatMonthTitle(dateObj) {
  return dateObj.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  })
}

function formatHumanDate(dateKey) {
  if (!dateKey) return ''

  return parseDateKey(dateKey).toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB)
}

function emptyShiftForm(dateKey = formatDateKey(new Date())) {
  return {
    title: '',
    shift_date: dateKey,
    start_time: '',
    end_time: '',
    notes: '',
  }
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '')
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [mode, setMode] = useState('select')

  const [userShift, setUserShift] = useState(null)
  const [noReasonOpen, setNoReasonOpen] = useState(false)
  const [noReason, setNoReason] = useState('')

  const [adminShifts, setAdminShifts] = useState([])
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(formatDateKey(new Date()))

  const [overlay, setOverlay] = useState(null)
  const [newShift, setNewShift] = useState(emptyShiftForm())
  const [editShift, setEditShift] = useState(emptyShiftForm())
  const [overlayPeople, setOverlayPeople] = useState([])
  const [overlayUsers, setOverlayUsers] = useState([])
  const [selectedUserIds, setSelectedUserIds] = useState([])

  async function api(path, options = {}) {
    const tg = window.Telegram?.WebApp
    const initData = tg?.initData || 'debug_user=1933391248'

    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': initData,
      },
    })

    const text = await res.text()

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }

    return data
  }

  async function loadProfile() {
    const data = await api('/me/profile')
    setProfile(data)
    return data
  }

  async function loadUserShift() {
    const data = await api('/me/next-shift')
    setUserShift(data.shift || null)
  }

  async function loadAdminShifts() {
    const data = await api('/admin/shifts')
    setAdminShifts(data.shifts || [])
  }

  function getShiftById(shiftId) {
    return adminShifts.find((shift) => Number(shift.id) === Number(shiftId)) || null
  }

  function getShiftsByDateKey(dateKey) {
    return adminShifts.filter((shift) => shift.shift_date === dateKey)
  }

  function getShiftProblemCount(shift) {
    return Number(shift.pending_count || 0) + Number(shift.maybe_count || 0) + Number(shift.no_count || 0)
  }

  function isShiftFullyConfirmed(shift) {
    return Number(shift.total || 0) > 0 && getShiftProblemCount(shift) === 0
  }

  function getCalendarDayStats(dateKey) {
    const shifts = getShiftsByDateKey(dateKey)

    let fullyConfirmed = 0
    let withProblems = 0

    shifts.forEach((shift) => {
      if (isShiftFullyConfirmed(shift)) {
        fullyConfirmed += 1
      } else {
        withProblems += 1
      }
    })

    return {
      fullyConfirmed,
      withProblems,
      total: shifts.length,
    }
  }

  function getCurrentMonthStats(dateObj) {
    const month = dateObj.getMonth()
    const year = dateObj.getFullYear()

    const shifts = adminShifts.filter((shift) => {
      const shiftDate = parseDateKey(shift.shift_date)
      return shiftDate.getMonth() === month && shiftDate.getFullYear() === year
    })

    let fullyConfirmed = 0
    let withProblems = 0

    shifts.forEach((shift) => {
      if (isShiftFullyConfirmed(shift)) {
        fullyConfirmed += 1
      } else {
        withProblems += 1
      }
    })

    return {
      total: shifts.length,
      fullyConfirmed,
      withProblems,
    }
  }

  const selectedDayOverview = useMemo(() => {
    const shifts = getShiftsByDateKey(selectedDate)

    return {
      shifts,
      stats: getCalendarDayStats(selectedDate),
      title: formatHumanDate(selectedDate),
    }
  }, [selectedDate, adminShifts])

  const monthStats = useMemo(() => getCurrentMonthStats(calendarDate), [calendarDate, adminShifts])

  const monthCells = useMemo(() => {
    const current = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
    const firstDayOfMonth = new Date(current.getFullYear(), current.getMonth(), 1)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()
    const daysInPrevMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate()

    const cells = []

    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i
      const dateObj = new Date(current.getFullYear(), current.getMonth() - 1, day)
      cells.push({ dateObj, muted: true })
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(current.getFullYear(), current.getMonth(), day)
      cells.push({ dateObj, muted: false })
    }

    while (cells.length % 7 !== 0) {
      const nextIndex = cells.length - (startWeekday + daysInMonth) + 1
      const dateObj = new Date(current.getFullYear(), current.getMonth() + 1, nextIndex)
      cells.push({ dateObj, muted: true })
    }

    return cells
  }, [calendarDate])

  useEffect(() => {
    async function init() {
      try {
        const tg = window.Telegram?.WebApp
        if (tg) {
          tg.ready()
          tg.expand()
        }
        await loadProfile()
      } catch (err) {
        setError(err.message || 'שגיאה')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  useEffect(() => {
    if (!overlay) return

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOverlay(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlay])

  async function enterUserMode() {
    try {
      setError('')
      setOverlay(null)
      await loadUserShift()
      setMode('user')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת משמרת')
    }
  }

  async function enterAdminMode() {
    try {
      setError('')
      if (!profile?.user || profile.user.role !== 'admin') {
        throw new Error('אין לך הרשאת מנהל')
      }
      await loadAdminShifts()
      setOverlay(null)
      setMode('admin')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת אזור מנהל')
    }
  }

  async function respond(status, comment = '') {
    if (!userShift) return

    try {
      setError('')
      await api('/me/shift-response', {
        method: 'POST',
        body: JSON.stringify({
          shift_id: userShift.id,
          status,
          comment,
        }),
      })

      setNoReason('')
      setNoReasonOpen(false)
      await loadUserShift()
    } catch (err) {
      setError(err.message || 'שגיאה בעדכון תשובה')
    }
  }

  function openDayOverlay(dateKey) {
    setSelectedDate(dateKey)
    setOverlay({ type: 'day', dateKey })
  }

  function openCreateShiftOverlay(dateKey = selectedDate) {
    setNewShift(emptyShiftForm(dateKey))
    setOverlay({ type: 'create-shift', dateKey })
  }

  function openEditShiftOverlay(shift) {
    setEditShift({
      title: shift.title || '',
      shift_date: shift.shift_date || formatDateKey(new Date()),
      start_time: shift.start_time || '',
      end_time: shift.end_time || '',
      notes: shift.notes || '',
    })
    setOverlay({ type: 'edit-shift', shift })
  }

  async function openShiftDetailsOverlay(shiftId) {
    try {
      setError('')
      const shift = getShiftById(shiftId)
      const data = await api(`/admin/shifts/${shiftId}`)
      setOverlayPeople(data.people || [])
      setOverlay({ type: 'shift-details', shift })
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת פרטי המשמרת')
    }
  }

  async function openAssignUsersOverlay(shiftId) {
    try {
      setError('')
      const shift = getShiftById(shiftId)
      const data = await api('/admin/users')
      setOverlayUsers(data.users || [])
      setSelectedUserIds([])
      setOverlay({ type: 'assign-users', shift })
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת רשימת המשתמשים')
    }
  }

  async function createShift() {
    try {
      setError('')
      await api('/admin/shifts', {
        method: 'POST',
        body: JSON.stringify(newShift),
      })

      setOverlay(null)
      await loadAdminShifts()
      if (newShift.shift_date) {
        const [y, m] = newShift.shift_date.split('-').map(Number)
        setCalendarDate(new Date(y, m - 1, 1))
        setSelectedDate(newShift.shift_date)
        setOverlay({ type: 'day', dateKey: newShift.shift_date })
      }
    } catch (err) {
      setError(err.message || 'שגיאה ביצירת משמרת')
    }
  }

  async function saveEditShift() {
    if (!overlay?.shift) return

    try {
      setError('')
      await api(`/admin/shifts/${overlay.shift.id}`, {
        method: 'PUT',
        body: JSON.stringify(editShift),
      })

      await loadAdminShifts()
      if (editShift.shift_date) {
        const [y, m] = editShift.shift_date.split('-').map(Number)
        setCalendarDate(new Date(y, m - 1, 1))
        setSelectedDate(editShift.shift_date)
        setOverlay({ type: 'day', dateKey: editShift.shift_date })
      } else {
        setOverlay(null)
      }
    } catch (err) {
      setError(err.message || 'שגיאה בעדכון משמרת')
    }
  }

  async function deleteShift(shiftId) {
    const ok = window.confirm('למחוק את המשמרת?')
    if (!ok) return

    try {
      setError('')
      const shift = getShiftById(shiftId)
      await api(`/admin/shifts/${shiftId}`, {
        method: 'DELETE',
      })

      await loadAdminShifts()

      if (shift?.shift_date) {
        setSelectedDate(shift.shift_date)
        setOverlay({ type: 'day', dateKey: shift.shift_date })
      } else {
        setOverlay(null)
      }
    } catch (err) {
      setError(err.message || 'שגיאה במחיקת משמרת')
    }
  }

  function toggleUserSelection(userId) {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  async function assignUsersToShift() {
    if (!overlay?.shift) return

    try {
      setError('')
      await api(`/admin/shifts/${overlay.shift.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          user_ids: selectedUserIds,
        }),
      })

      await loadAdminShifts()
      await openShiftDetailsOverlay(overlay.shift.id)
    } catch (err) {
      setError(err.message || 'שגיאה בשיוך משתמשים')
    }
  }

  function copyText(text) {
    navigator.clipboard.writeText(String(text || ''))
      .then(() => window.alert('הועתק'))
      .catch(() => window.alert('שגיאה בהעתקה'))
  }

  function openTelegramChat(username, phone) {
    const tg = window.Telegram?.WebApp
    const cleanUsername = String(username || '').trim().replace(/^@/, '')
    const cleanPhone = normalizePhone(phone)

    try {
      if (cleanUsername) {
        const usernameUrl = `https://t.me/${cleanUsername}`
        if (tg && typeof tg.openTelegramLink === 'function') {
          tg.openTelegramLink(usernameUrl)
        } else {
          window.open(usernameUrl, '_blank')
        }
        return
      }

      if (cleanPhone) {
        const phoneUrl = `https://t.me/+${cleanPhone.replace(/^\+/, '')}`
        if (tg && typeof tg.openTelegramLink === 'function') {
          tg.openTelegramLink(phoneUrl)
        } else {
          window.open(phoneUrl, '_blank')
        }
        return
      }

      window.alert('אין username או טלפון לפתיחת צ׳אט')
    } catch {
      window.alert('לא ניתן לפתוח את הצ׳אט')
    }
  }

  function renderShiftActions(shift, compact = false) {
    return (
      <div className={`actions ${compact ? 'compact-actions' : ''}`}>
        <button onClick={() => openShiftDetailsOverlay(shift.id)}>פרטים</button>
        <button className="secondary" onClick={() => openAssignUsersOverlay(shift.id)}>שבץ אנשים</button>
        <button className="secondary" onClick={() => openEditShiftOverlay(shift)}>ערוך</button>
        <button className="danger" onClick={() => deleteShift(shift.id)}>מחק</button>
      </div>
    )
  }

  function renderShiftCard(shift, compact = false) {
    const problemCount = getShiftProblemCount(shift)

    return (
      <div key={shift.id} className={`shift-card-shell ${compact ? 'shift-card-compact' : ''}`}>
        <div className="shift-card-head">
          <div>
            <div className="list-main">{shift.title}</div>
            <div className="list-sub">{shift.start_time} - {shift.end_time}</div>
          </div>
          <div className="status-cluster">
            <span className={`badge ${problemCount > 0 ? 'warning' : 'success'}`}>
              {problemCount > 0 ? `דורש טיפול ${problemCount}` : 'סגור'}
            </span>
          </div>
        </div>

        {shift.notes ? <div className="list-sub shift-notes">הערות: {shift.notes}</div> : null}

        <div className="stat-line">
          <span className="mini-stat">סה״כ {shift.total || 0}</span>
          <span className="mini-stat success-text">מגיעים {shift.yes_count || 0}</span>
          <span className="mini-stat danger-text">לא מגיעים {shift.no_count || 0}</span>
          <span className="mini-stat warning-text">לא בטוחים {shift.maybe_count || 0}</span>
          <span className="mini-stat muted-text">ממתינים {shift.pending_count || 0}</span>
        </div>

        {renderShiftActions(shift, compact)}
      </div>
    )
  }

  if (loading) {
    return <div className="screen">טוען...</div>
  }

  if (error && !profile) {
    return (
      <div className="screen">
        <div className="card center">
          <h2>שגיאה</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!profile?.registered) {
    return (
      <div className="screen">
        <div className="card center">
          <h2>אינך רשום במערכת</h2>
          <p>יש לחזור לבוט ולשלוח /start</p>
        </div>
      </div>
    )
  }

  if (profile.user.registration_status === 'pending_review') {
    return (
      <div className="screen">
        <div className="card center">
          <h2>הבקשה שלך ממתינה לאישור</h2>
        </div>
      </div>
    )
  }

  if (profile.user.registration_status === 'rejected') {
    return (
      <div className="screen">
        <div className="card center">
          <h2>ההרשמה נדחתה</h2>
          <p>יש לשלוח /start מחדש בבוט</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`screen ${overlay ? 'overlay-open' : ''}`}>
      <div className="card hero hero-card">
        <h1>מערכת משמרות</h1>
        <p>יחידה 9950</p>
      </div>

      {error && (
        <div className="card error-card">
          <p>{error}</p>
        </div>
      )}

      {mode === 'select' && (
        <div className="entry-screen">
          <div className="card center entry-main-card">
            <h2>ברוך הבא {profile.user.first_name || ''}</h2>
            <p>בחר איך תרצה להיכנס עכשיו</p>
            <button className="entry-main-button" onClick={enterUserMode}>
              כניסה רגילה
            </button>
          </div>

          <div className="entry-admin-wrap">
            <button className="entry-admin-button" onClick={enterAdminMode}>
              כניסת מנהל
            </button>
          </div>
        </div>
      )}

      {mode === 'user' && (
        <div className="card">
          {!userShift ? (
            <>
              <h2>אין משמרות כרגע</h2>
              <p>כרגע לא שובצה לך משמרת חדשה</p>
              <div className="actions">
                <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
              </div>
            </>
          ) : (
            <>
              <div className="subtitle">כניסה רגילה</div>
              <h2>{userShift.title}</h2>

              <div className="info-block">
                <strong>תאריך</strong>
                <div>{userShift.shift_date}</div>
              </div>

              <div className="info-block">
                <strong>שעה</strong>
                <div>{userShift.start_time} - {userShift.end_time}</div>
              </div>

              <div className="info-block">
                <strong>סטטוס</strong>
                <div>{statusText(userShift.status)}</div>
              </div>

              {userShift.comment && (
                <div className="info-block">
                  <strong>סיבה</strong>
                  <div>{userShift.comment}</div>
                </div>
              )}

              {userShift.notes && (
                <div className="info-block">
                  <strong>הערות</strong>
                  <div>{userShift.notes}</div>
                </div>
              )}

              {!noReasonOpen ? (
                <div className="actions">
                  <button className="success" onClick={() => respond('yes')}>אני מגיע</button>
                  <button className="danger" onClick={() => setNoReasonOpen(true)}>לא מגיע</button>
                  <button className="warning" onClick={() => respond('maybe')}>לא בטוח</button>
                  <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
                </div>
              ) : (
                <>
                  <div className="info-block">
                    <strong>סיבה לאי הגעה</strong>
                    <textarea
                      value={noReason}
                      onChange={(e) => setNoReason(e.target.value)}
                      placeholder="כתוב כאן את הסיבה"
                    />
                  </div>
                  <div className="actions">
                    <button className="danger" onClick={() => respond('no', noReason)}>שלח</button>
                    <button className="secondary" onClick={() => setNoReasonOpen(false)}>ביטול</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'admin' && (
        <>
          <div className="card admin-header-card">
            <div className="admin-header-main">
              <div>
                <div className="subtitle">כניסת מנהל</div>
                <h2>יומן משמרות</h2>
                <p className="admin-header-copy">
                  לחץ על יום בלוח כדי לפתוח חלון פעולות, ליצור משמרת חדשה ולטפל במה שדורש תשומת לב.
                </p>
              </div>

              <div className="admin-header-actions">
                <button onClick={() => openCreateShiftOverlay(selectedDate)}>משמרת חדשה</button>
                <button className="secondary" onClick={loadAdminShifts}>רענון</button>
                <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
              </div>
            </div>

            <div className="overview-grid">
              <div className="overview-card">
                <div className="overview-label">משמרות החודש</div>
                <div className="overview-value">{monthStats.total}</div>
              </div>
              <div className="overview-card">
                <div className="overview-label">סגורות</div>
                <div className="overview-value success-text">{monthStats.fullyConfirmed}</div>
              </div>
              <div className="overview-card">
                <div className="overview-label">דורשות טיפול</div>
                <div className="overview-value warning-text">{monthStats.withProblems}</div>
              </div>
              <div className="overview-card">
                <div className="overview-label">משמרות ביום שנבחר</div>
                <div className="overview-value">{selectedDayOverview.stats.total}</div>
              </div>
            </div>
          </div>

          <div className="card admin-calendar-card">
            <div className="calendar-toolbar">
              <button
                className="secondary"
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
              >
                חודש קודם
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const today = new Date()
                  setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1))
                  openDayOverlay(formatDateKey(today))
                }}
              >
                היום
              </button>
              <button
                className="secondary"
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
              >
                חודש הבא
              </button>
            </div>

            <h3 className="month-title">{formatMonthTitle(calendarDate)}</h3>
            <p className="calendar-caption">ירוק = יום סגור, אדום = יום עם בעיות. המספר הקטן מציג כמה משמרות יש ביום.</p>

            <div className="calendar-grid">
              {['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'].map((day) => (
                <div key={day} className="weekday">{day}</div>
              ))}

              {monthCells.map(({ dateObj, muted }) => {
                const dateKey = formatDateKey(dateObj)
                const dayStats = getCalendarDayStats(dateKey)
                const isToday = isSameDay(dateObj, new Date())
                const isSelected = selectedDate === dateKey
                const hasShifts = dayStats.total > 0

                return (
                  <button
                    key={dateKey + String(muted)}
                    className={`day-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasShifts ? 'has-shifts' : ''}`}
                    onClick={() => openDayOverlay(dateKey)}
                  >
                    <div className="day-cell-top">
                      <div className="day-number">{dateObj.getDate()}</div>
                      {hasShifts ? <span className="day-count">{dayStats.total}</span> : null}
                    </div>
                    <div className="day-stats">
                      {dayStats.fullyConfirmed > 0 ? <span className="green-number">{dayStats.fullyConfirmed}</span> : <span />}
                      {dayStats.withProblems > 0 ? <span className="red-number">{dayStats.withProblems}</span> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card day-focus-card">
            <div className="day-focus-head">
              <div>
                <div className="subtitle">פוקוס נוכחי</div>
                <h2>{selectedDayOverview.title}</h2>
              </div>

              <div className="day-focus-actions">
                <button onClick={() => openDayOverlay(selectedDate)}>פתח את היום</button>
                <button className="secondary" onClick={() => openCreateShiftOverlay(selectedDate)}>הוסף משמרת</button>
              </div>
            </div>

            <div className="stat-line">
              <span className="mini-stat">משמרות {selectedDayOverview.stats.total}</span>
              <span className="mini-stat success-text">סגורות {selectedDayOverview.stats.fullyConfirmed}</span>
              <span className="mini-stat warning-text">דורשות טיפול {selectedDayOverview.stats.withProblems}</span>
            </div>

            {selectedDayOverview.shifts.length ? (
              <div className="day-preview-list">
                {selectedDayOverview.shifts.slice(0, 3).map((shift) => renderShiftCard(shift, true))}
              </div>
            ) : (
              <div className="empty-state day-preview-empty">
                <h3>אין משמרות ביום הזה</h3>
                <p>לחץ על "הוסף משמרת" כדי לפתוח את היום ישירות מהלוח.</p>
              </div>
            )}
          </div>
        </>
      )}

      {overlay && (
        <div className="overlay-backdrop" onClick={() => setOverlay(null)}>
          <div className={`overlay-panel ${overlay.type === 'shift-details' || overlay.type === 'assign-users' ? 'overlay-panel-wide' : ''}`} onClick={(event) => event.stopPropagation()}>
            <div className="overlay-header">
              <div>
                {overlay.type === 'day' && (
                  <>
                    <div className="overlay-eyebrow">מרכז שליטה יומי</div>
                    <div className="overlay-title">{formatHumanDate(overlay.dateKey)}</div>
                    <div className="subtitle">מכאן אפשר ליצור משמרת חדשה או לטפל במשמרות של היום.</div>
                  </>
                )}

                {overlay.type === 'create-shift' && (
                  <>
                    <div className="overlay-eyebrow">יצירה מהירה</div>
                    <div className="overlay-title">משמרת חדשה</div>
                    <div className="subtitle">פתיחת משמרת בלי לעזוב את הלוח.</div>
                  </>
                )}

                {overlay.type === 'edit-shift' && (
                  <>
                    <div className="overlay-eyebrow">עריכת משמרת</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                    <div className="subtitle">עדכון השעות והפרטים של המשמרת.</div>
                  </>
                )}

                {overlay.type === 'shift-details' && (
                  <>
                    <div className="overlay-eyebrow">תמונת מצב</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                    <div className="subtitle">{overlay.shift?.shift_date} · {overlay.shift?.start_time} - {overlay.shift?.end_time}</div>
                  </>
                )}

                {overlay.type === 'assign-users' && (
                  <>
                    <div className="overlay-eyebrow">שיוך אנשים</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                    <div className="subtitle">בחר את האנשים שתרצה לצרף למשמרת.</div>
                  </>
                )}
              </div>

              <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
            </div>

            {overlay.type === 'day' && (
              <>
                <div className="overlay-metrics">
                  <div className="metric-chip">
                    <span className="metric-value">{selectedDayOverview.stats.total}</span>
                    <span className="metric-label">משמרות</span>
                  </div>
                  <div className="metric-chip">
                    <span className="metric-value success-text">{selectedDayOverview.stats.fullyConfirmed}</span>
                    <span className="metric-label">סגורות</span>
                  </div>
                  <div className="metric-chip">
                    <span className="metric-value warning-text">{selectedDayOverview.stats.withProblems}</span>
                    <span className="metric-label">דורשות טיפול</span>
                  </div>
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={() => openCreateShiftOverlay(overlay.dateKey)}>משמרת חדשה לתאריך הזה</button>
                  <button className="secondary" onClick={() => setOverlay(null)}>סגור</button>
                </div>

                <div className="overlay-body-stack">
                  {selectedDayOverview.shifts.length ? (
                    selectedDayOverview.shifts.map((shift) => renderShiftCard(shift, true))
                  ) : (
                    <div className="empty-state">
                      <h3>אין משמרות ביום הזה</h3>
                      <p>זה זמן טוב לפתוח משמרת חדשה ישירות לתאריך שבחרת.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {overlay.type === 'create-shift' && (
              <>
                <div className="modal-fields">
                  <div>
                    <div className="label">שם המשמרת</div>
                    <input
                      placeholder="לדוגמה: בוקר גזרה"
                      value={newShift.title}
                      onChange={(e) => setNewShift({ ...newShift, title: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="label">תאריך</div>
                    <input
                      type="date"
                      value={newShift.shift_date}
                      onChange={(e) => setNewShift({ ...newShift, shift_date: e.target.value })}
                    />
                  </div>

                  <div className="form-grid">
                    <input
                      type="time"
                      value={newShift.start_time}
                      onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                    />
                    <input
                      type="time"
                      value={newShift.end_time}
                      onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                    />
                  </div>

                  <textarea
                    placeholder="מה חשוב לדעת על המשמרת"
                    value={newShift.notes}
                    onChange={(e) => setNewShift({ ...newShift, notes: e.target.value })}
                  />
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={createShift}>שמור משמרת</button>
                  <button className="secondary" onClick={() => openDayOverlay(newShift.shift_date)}>חזור ליום</button>
                </div>
              </>
            )}

            {overlay.type === 'edit-shift' && (
              <>
                <div className="modal-fields">
                  <div>
                    <div className="label">שם המשמרת</div>
                    <input
                      value={editShift.title}
                      onChange={(e) => setEditShift({ ...editShift, title: e.target.value })}
                    />
                  </div>

                  <div>
                    <div className="label">תאריך</div>
                    <input
                      type="date"
                      value={editShift.shift_date}
                      onChange={(e) => setEditShift({ ...editShift, shift_date: e.target.value })}
                    />
                  </div>

                  <div className="form-grid">
                    <input
                      type="time"
                      value={editShift.start_time}
                      onChange={(e) => setEditShift({ ...editShift, start_time: e.target.value })}
                    />
                    <input
                      type="time"
                      value={editShift.end_time}
                      onChange={(e) => setEditShift({ ...editShift, end_time: e.target.value })}
                    />
                  </div>

                  <textarea
                    value={editShift.notes}
                    onChange={(e) => setEditShift({ ...editShift, notes: e.target.value })}
                  />
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={saveEditShift}>שמור שינויים</button>
                  <button className="secondary" onClick={() => openDayOverlay(editShift.shift_date)}>חזור ליום</button>
                </div>
              </>
            )}

            {overlay.type === 'shift-details' && (
              <>
                {overlay.shift?.notes ? (
                  <div className="note-box">
                    <div className="label">הערות</div>
                    <div className="list-sub">{overlay.shift.notes}</div>
                  </div>
                ) : null}

                <div className="overlay-actions-bar">
                  <button className="secondary" onClick={() => openAssignUsersOverlay(overlay.shift.id)}>שבץ אנשים</button>
                  <button className="secondary" onClick={() => openEditShiftOverlay(overlay.shift)}>ערוך משמרת</button>
                  <button className="secondary" onClick={() => openDayOverlay(overlay.shift.shift_date)}>חזור ליום</button>
                </div>

                <div className="overlay-body-stack">
                  {overlayPeople.length ? (
                    overlayPeople.map((person, index) => (
                      <div key={`${person.user_id}-${index}`} className="shift-card-shell">
                        <div className="list-main">{person.first_name} {person.last_name}</div>
                        <div className="list-sub">username: {person.username || '---'}</div>
                        <div className="list-sub">phone: {person.phone || '---'}</div>
                        <div className="list-sub">דרגה: {person.rank || '-'}</div>
                        <div className="list-sub">סוג שירות: {person.service_type || '-'}</div>
                        <div className="person-card-footer">
                          <span className={`badge ${statusBadgeClass(person.status)}`}>{statusText(person.status)}</span>
                        </div>
                        {person.comment ? (
                          <div className="note-box">
                            <div className="label">סיבה</div>
                            <div className="list-sub">{person.comment}</div>
                          </div>
                        ) : null}
                        <div className="actions compact-actions">
                          {person.username || person.phone ? (
                            <button className="secondary" onClick={() => openTelegramChat(person.username, person.phone)}>פתח צ׳אט</button>
                          ) : (
                            <button className="secondary" disabled>אין נתונים לצ׳אט</button>
                          )}
                          {person.phone ? (
                            <button className="secondary" onClick={() => copyText(person.phone)}>העתק טלפון</button>
                          ) : null}
                          {person.username ? (
                            <button className="secondary" onClick={() => copyText(person.username)}>העתק username</button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h3>אין אנשים משויכים</h3>
                      <p>אפשר לשייך אנשים מהמסך הזה בלי לחזור אחורה.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {overlay.type === 'assign-users' && (
              <>
                <div className="checkbox-list">
                  {overlayUsers.length ? (
                    overlayUsers.map((user) => (
                      <label key={user.id} className="shift-card-shell checkbox-card">
                        <div className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(user.id)}
                            onChange={() => toggleUserSelection(user.id)}
                          />
                          <div>
                            <div className="list-main">{user.first_name} {user.last_name}</div>
                            <div className="list-sub">דרגה: {user.rank || '-'}</div>
                            <div className="list-sub">סוג שירות: {user.service_type || '-'}</div>
                          </div>
                        </div>
                      </label>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h3>אין משתמשים זמינים</h3>
                      <p>צריך קודם לאשר משתמשים במערכת כדי לשבץ אותם למשמרות.</p>
                    </div>
                  )}
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={assignUsersToShift}>שמור שיוך</button>
                  <button className="secondary" onClick={() => openShiftDetailsOverlay(overlay.shift.id)}>חזור לפרטי המשמרת</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
