import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'https://nine950-backend.onrender.com'
const LOGO_SRC = '/logo-9950.png'
const MIN_BOOT_MS = 1400
const WEEKDAYS = ['ב', 'ג', 'ד', 'ה', 'ו', 'ש', 'א']

function statusText(status) {
  if (status === 'yes') return 'מגיע'
  if (status === 'no') return 'לא מגיע'
  if (status === 'maybe') return 'לא בטוח'
  return 'ממתין'
}

function statusBadgeClass(status) {
  if (status === 'yes') return 'success'
  if (status === 'no') return 'danger'
  if (status === 'maybe') return 'warning'
  return 'pending'
}

function formatDateKey(dateObj) {
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    year: 'numeric',
  })
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

function personName(person) {
  return [person.first_name, person.last_name].filter(Boolean).join(' ') || 'לא צוין'
}

function recommendationText(recommendation) {
  if (recommendation === 'overlap') return 'חופף למשמרת אחרת'
  if (recommendation === 'recent') return 'עשה משמרת לאחרונה'
  if (recommendation === 'assigned') return 'כבר משויך למשמרת הזאת'
  return 'מומלץ לשיבוץ'
}

function recommendationClass(recommendation) {
  if (recommendation === 'overlap') return 'danger'
  if (recommendation === 'recent') return 'warning'
  if (recommendation === 'assigned') return 'pending'
  return 'success'
}

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB)
}

function getShiftProblemCount(shift) {
  return Number(shift.pending_count || 0) + Number(shift.maybe_count || 0) + Number(shift.no_count || 0)
}

function isShiftFullyConfirmed(shift) {
  return Number(shift.total || 0) > 0 && getShiftProblemCount(shift) === 0
}

function LoadingScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-core">
        <div className="boot-logo-wrap">
          <span className="boot-ring" />
          <img src={LOGO_SRC} alt="9950" className="boot-logo" />
        </div>

        <div className="boot-copy">
          <div className="section-tag">9950 SHIFT SYSTEM</div>
          <h1 className="boot-title">מערכת משמרות</h1>
          <p className="boot-subtitle">מאתחל ממשק מבצעי ומסנכרן נתוני יחידה</p>
        </div>

        <div className="boot-progress">
          <span />
        </div>
      </div>
    </div>
  )
}

function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? 'brand-mark-compact' : ''}`}>
      <img src={LOGO_SRC} alt="9950" className="brand-logo" />
      <div className="brand-copy">
        <div className="section-tag">UNIT 9950</div>
        <div className="brand-title">מערכת משמרות</div>
      </div>
    </div>
  )
}

function StatusScreen({ title, text }) {
  return (
    <div className="screen screen-centered">
      <div className="status-shell">
        <BrandMark compact />
        <h2>{title}</h2>
        {text ? <p>{text}</p> : null}
      </div>
    </div>
  )
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [mode, setMode] = useState('select')

  const [userShifts, setUserShifts] = useState([])
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

    const response = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        'x-telegram-init-data': initData,
      },
    })

    const text = await response.text()

    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
    }

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`)
    }

    return data
  }

  function syncCalendarToDateKey(dateKey) {
    const parsedDate = parseDateKey(dateKey)
    setSelectedDate(dateKey)
    setCalendarDate(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1))
  }

  async function loadUserShifts() {
    const data = await api('/me/shifts')
    setUserShifts(data.shifts || [])
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
      total: shifts.length,
      fullyConfirmed,
      withProblems,
    }
  }

  const monthCells = useMemo(() => {
    const current = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
    const firstDayOfMonth = new Date(current.getFullYear(), current.getMonth(), 1)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()
    const daysInPreviousMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate()
    const cells = []

    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      const dateObj = new Date(current.getFullYear(), current.getMonth() - 1, daysInPreviousMonth - i)
      cells.push({ dateObj, muted: true })
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
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

  const selectedDayShifts = useMemo(
    () => adminShifts.filter((shift) => shift.shift_date === selectedDate),
    [selectedDate, adminShifts]
  )

  const selectedDayStats = useMemo(() => {
    let fullyConfirmed = 0
    let withProblems = 0

    selectedDayShifts.forEach((shift) => {
      if (isShiftFullyConfirmed(shift)) {
        fullyConfirmed += 1
      } else {
        withProblems += 1
      }
    })

    return {
      total: selectedDayShifts.length,
      fullyConfirmed,
      withProblems,
    }
  }, [selectedDayShifts])

  useEffect(() => {
    let cancelled = false
    let timeoutId

    async function init() {
      const bootStartedAt = Date.now()

      try {
        const tg = window.Telegram?.WebApp
        if (tg) {
          tg.ready()
          tg.expand()
        }

        const data = await api('/me/profile')
        if (!cancelled) {
          setProfile(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'שגיאה')
        }
      } finally {
        const elapsed = Date.now() - bootStartedAt
        const remaining = Math.max(0, MIN_BOOT_MS - elapsed)

        timeoutId = window.setTimeout(() => {
          if (!cancelled) {
            setLoading(false)
          }
        }, remaining)
      }
    }

    init()

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  useEffect(() => {
    if (!overlay) return undefined

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOverlay(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [overlay])

  async function enterUserMode() {
    try {
      setError('')
      setOverlay(null)
      await loadUserShifts()
      setMode('user')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת המשמרות שלך')
    }
  }

  async function enterAdminMode() {
    try {
      setError('')
      if (!profile?.user || profile.user.role !== 'admin') {
        throw new Error('אין לך הרשאת מנהל')
      }

      const today = formatDateKey(new Date())
      syncCalendarToDateKey(today)
      await loadAdminShifts()
      setOverlay(null)
      setMode('admin')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת אזור מנהל')
    }
  }

  async function refreshAdminCalendar() {
    try {
      setError('')
      await loadAdminShifts()
    } catch (err) {
      setError(err.message || 'שגיאה ברענון לוח המשמרות')
    }
  }

  async function respondToShift(shiftId, status, comment = '') {
    try {
      setError('')
      await api('/me/shift-response', {
        method: 'POST',
        body: JSON.stringify({
          shift_id: shiftId,
          status,
          comment,
        }),
      })

      setNoReason('')
      setOverlay(null)
      await loadUserShifts()
    } catch (err) {
      setError(err.message || 'שגיאה בעדכון התשובה למשמרת')
    }
  }

  function openDeclineOverlay(shift) {
    setNoReason(shift.status === 'no' ? shift.comment || '' : '')
    setOverlay({ type: 'decline-reason', shift })
  }

  function openResponseOverlay(shift) {
    setOverlay({ type: 'change-response', shift })
  }

  function openDayOverlay(dateKey) {
    syncCalendarToDateKey(dateKey)
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
      const data = await api(`/admin/users?shift_id=${shiftId}`)
      setOverlayUsers(data.users || [])
      setSelectedUserIds((data.users || []).filter((user) => user.assigned_to_target).map((user) => Number(user.id)))
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

      await loadAdminShifts()
      syncCalendarToDateKey(newShift.shift_date)
      setOverlay({ type: 'day', dateKey: newShift.shift_date })
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
      syncCalendarToDateKey(editShift.shift_date)
      setOverlay({ type: 'day', dateKey: editShift.shift_date })
    } catch (err) {
      setError(err.message || 'שגיאה בעדכון משמרת')
    }
  }

  async function deleteShift(shiftId) {
    const confirmed = window.confirm('למחוק את המשמרת?')
    if (!confirmed) return

    try {
      setError('')
      const shift = getShiftById(shiftId)
      await api(`/admin/shifts/${shiftId}`, {
        method: 'DELETE',
      })

      await loadAdminShifts()

      if (shift?.shift_date) {
        syncCalendarToDateKey(shift.shift_date)
        setOverlay({ type: 'day', dateKey: shift.shift_date })
      } else {
        setOverlay(null)
      }
    } catch (err) {
      setError(err.message || 'שגיאה במחיקת משמרת')
    }
  }

  function toggleUserSelection(userId) {
    const normalizedUserId = Number(userId)

    setSelectedUserIds((prev) =>
      prev.includes(normalizedUserId)
        ? prev.filter((id) => id !== normalizedUserId)
        : [...prev, normalizedUserId]
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

  function renderAdminShiftActions(shift) {
    return (
      <div className="actions compact-actions">
        <button className="secondary small-button" onClick={() => openShiftDetailsOverlay(shift.id)}>פרטים</button>
        <button className="secondary small-button" onClick={() => openAssignUsersOverlay(shift.id)}>שבץ</button>
        <button className="secondary small-button" onClick={() => openEditShiftOverlay(shift)}>ערוך</button>
        <button className="danger small-button" onClick={() => deleteShift(shift.id)}>מחק</button>
      </div>
    )
  }

  function renderAdminShiftCard(shift) {
    const total = Number(shift.total || 0)
    const problemCount = getShiftProblemCount(shift)
    const badgeTone = total === 0 || problemCount > 0 ? 'warning' : 'success'
    const badgeLabel = total === 0
      ? 'אין משובצים'
      : problemCount > 0
        ? `דורש טיפול ${problemCount}`
        : 'מוכן'

    return (
      <div
        key={shift.id}
        className={`shift-card-shell ${problemCount > 0 ? 'shift-card-alert' : 'shift-card-ready'}`}
      >
        <div className="shift-card-head">
          <div>
            <div className="list-main">{shift.title}</div>
            <div className="list-sub">{shift.start_time} - {shift.end_time}</div>
          </div>

          <div className="status-cluster">
            <span className={`badge ${badgeTone}`}>{badgeLabel}</span>
          </div>
        </div>

        {shift.notes ? <div className="note-box">הערות: {shift.notes}</div> : null}

        {shift.problem_people?.length ? (
          <div className="problem-strip">
            {shift.problem_people.slice(0, 4).map((person, index) => (
              <span key={`${shift.id}-problem-${index}`} className={`badge ${statusBadgeClass(person.status)}`}>
                {person.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="stat-line">
          <span className="mini-stat">סה״כ {total}</span>
          <span className="mini-stat success-text">מגיעים {shift.yes_count || 0}</span>
          <span className="mini-stat danger-text">לא מגיעים {shift.no_count || 0}</span>
          <span className="mini-stat warning-text">לא בטוחים {shift.maybe_count || 0}</span>
          <span className="mini-stat muted-text">ממתינים {shift.pending_count || 0}</span>
        </div>

        {renderAdminShiftActions(shift)}
      </div>
    )
  }

  function renderUserShiftCard(shift) {
    const showReplacement = shift.is_active && shift.replacement_people?.length
    const hasResponse = shift.status && shift.status !== 'pending'

    return (
      <div key={shift.id} className="shift-card-shell">
        <div className="shift-card-head">
          <div>
            <div className="list-main">{shift.title}</div>
            <div className="list-sub">{formatHumanDate(shift.shift_date)}</div>
            <div className="list-sub">{shift.start_time} - {shift.end_time}</div>
          </div>

          <span className={`badge ${statusBadgeClass(shift.status)}`}>{statusText(shift.status)}</span>
        </div>

        {shift.notes ? <div className="note-box">הערות: {shift.notes}</div> : null}
        {shift.comment ? <div className="note-box">סיבה שסומנה: {shift.comment}</div> : null}

        {showReplacement ? (
          <div className="handover-panel">
            <div className="handover-head">
              <div>
                <div className="section-tag">NEXT RELIEF</div>
                <strong>מי מחליף אותך</strong>
              </div>
              {shift.next_shift ? (
                <span className="mini-stat">
                  {shift.next_shift.start_time} · {shift.next_shift.title}
                </span>
              ) : null}
            </div>

            <div className="relief-list">
              {shift.replacement_people.map((person) => (
                <div key={`${shift.id}-${person.user_id}`} className="relief-card">
                  <div>
                    <div className="list-main">{personName(person)}</div>
                    <div className="list-sub">טלפון: {person.phone || '---'}</div>
                    <div className="list-sub">username: {person.username ? `@${String(person.username).replace(/^@/, '')}` : '---'}</div>
                  </div>

                  <div className="actions compact-actions">
                    {person.username || person.phone ? (
                      <button className="secondary small-button" onClick={() => openTelegramChat(person.username, person.phone)}>
                        פתח צ׳אט
                      </button>
                    ) : null}
                    {person.phone ? (
                      <button className="secondary small-button" onClick={() => copyText(person.phone)}>
                        העתק טלפון
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {hasResponse ? (
          <div className="response-summary">
            <span className="mini-stat">תשובה הוזנה</span>
            <button className="secondary small-button" onClick={() => openResponseOverlay(shift)}>
              שנה תשובה
            </button>
          </div>
        ) : (
          <div className="response-actions">
            <button
              className={`success small-button ${shift.status === 'yes' ? 'is-active' : ''}`}
              onClick={() => respondToShift(shift.id, 'yes')}
            >
              מגיע
            </button>

            <button
              className={`warning small-button ${shift.status === 'maybe' ? 'is-active' : ''}`}
              onClick={() => respondToShift(shift.id, 'maybe')}
            >
              אולי
            </button>

            <button
              className={`danger small-button ${shift.status === 'no' ? 'is-active' : ''}`}
              onClick={() => openDeclineOverlay(shift)}
            >
              לא מגיע
            </button>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (error && !profile) {
    return <StatusScreen title="שגיאה" text={error} />
  }

  if (!profile?.registered) {
    return <StatusScreen title="אינך רשום במערכת" text="יש לחזור לבוט ולשלוח /start" />
  }

  if (profile.user.registration_status === 'pending_review') {
    return <StatusScreen title="הבקשה שלך ממתינה לאישור" />
  }

  if (profile.user.registration_status === 'rejected') {
    return <StatusScreen title="ההרשמה נדחתה" text="יש לשלוח /start מחדש בבוט" />
  }

  return (
    <div className={`screen ${mode === 'admin' ? 'screen-admin' : ''}`}>
      {error ? (
        <div className="flash-message">
          <span className="flash-dot" />
          <span>{error}</span>
        </div>
      ) : null}

      {mode === 'select' && (
        <section className="landing-shell">
          <div className="landing-hero">
            <BrandMark />
            <p className="landing-copy">
              ממשק יבש, מהיר ומדויק לניהול משמרות. בלי זכוכית, בלי גימיקים, רק שליטה ברורה על מה שקורה.
            </p>
          </div>

          <div className="mode-grid single">
            <button className="mode-card" onClick={enterUserMode}>
              <span className="section-tag">PERSONAL ACCESS</span>
              <strong>כניסה רגילה</strong>
              <small>כל המשמרות שלך, תשובה מהירה ומעקב סטטוס במקום אחד.</small>
            </button>
          </div>

          {profile.user.role === 'admin' ? (
            <div className="admin-entry-row">
              <button className="ghost-admin-link" onClick={enterAdminMode}>
                כניסת מנהל
              </button>
            </div>
          ) : null}
        </section>
      )}

      {mode === 'user' && (
        <section className="workspace-shell">
          <div className="workspace-topbar">
            <BrandMark compact />
            <button className="secondary small-button" onClick={() => setMode('select')}>חזרה</button>
          </div>

          <div className="workspace-head">
            <div>
              <div className="section-tag">PERSONAL BOARD</div>
              <h2>כל המשמרות שלי</h2>
            </div>
            <span className="count-chip">{userShifts.length}</span>
          </div>

          <div className="profile-stats-grid">
            <div className="profile-stat-card">
              <span className="section-tag">COMPLETED SHIFTS</span>
              <strong>{profile?.stats?.completed_shifts ?? 0}</strong>
            </div>
            <div className="profile-stat-card">
              <span className="section-tag">COMPLETED HOURS</span>
              <strong>{profile?.stats?.completed_hours ?? 0}</strong>
            </div>
          </div>

          {userShifts.length ? (
            <div className="shift-list">
              {userShifts.map((shift) => renderUserShiftCard(shift))}
            </div>
          ) : (
            <div className="empty-state">
              <h3>אין לך משמרות כרגע</h3>
              <p>ברגע שאדמין ישבץ אותך, הן יופיעו כאן אוטומטית.</p>
            </div>
          )}
        </section>
      )}

      {mode === 'admin' && (
        <section className="command-shell">
          <div className="command-month">
            <div className="section-tag">COMMAND BOARD</div>
            <div className="calendar-title">{formatMonthTitle(calendarDate)}</div>
          </div>

          <div className="calendar-grid">
            {WEEKDAYS.map((day) => (
              <div key={day} className="weekday">{day}</div>
            ))}

            {monthCells.map(({ dateObj, muted }) => {
              const dateKey = formatDateKey(dateObj)
              const dayStats = getCalendarDayStats(dateKey)
              const hasShifts = dayStats.total > 0
              const isToday = isSameDay(dateObj, new Date())
              const isSelected = selectedDate === dateKey
              const toneClass = dayStats.withProblems > 0 ? 'has-issues' : dayStats.fullyConfirmed > 0 ? 'is-ready' : ''

              return (
                <button
                  key={`${dateKey}-${muted ? 'muted' : 'live'}`}
                  className={`day-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${toneClass}`}
                  onClick={() => openDayOverlay(dateKey)}
                >
                  <div className="day-cell-top">
                    <span className="day-number">{dateObj.getDate()}</span>
                    {hasShifts ? <span className="day-chip">{dayStats.total}x</span> : null}
                  </div>

                  <div className="day-stats">
                    {dayStats.withProblems > 0 ? (
                      <span className="day-chip day-chip-alert">!{dayStats.withProblems}</span>
                    ) : dayStats.fullyConfirmed > 0 ? (
                      <span className="day-chip day-chip-ok">OK</span>
                    ) : (
                      <span />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="calendar-nav">
            <button
              className="secondary small-button"
              onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
            >
              חודש קודם
            </button>
            <button className="secondary small-button" onClick={refreshAdminCalendar}>רענן</button>
            <button
              className="secondary small-button"
              onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
            >
              חודש הבא
            </button>
          </div>
        </section>
      )}

      {overlay ? (
        <div className="overlay-backdrop" onClick={() => setOverlay(null)}>
          <div
            className={`overlay-panel ${overlay.type === 'shift-details' || overlay.type === 'assign-users' ? 'overlay-panel-wide' : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            {overlay.type === 'decline-reason' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">RESPONSE UPDATE</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                    <div className="overlay-subtitle">יש לרשום סיבה אם אינך מגיע למשמרת.</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="modal-fields">
                  <div>
                    <div className="label">סיבה</div>
                    <textarea
                      value={noReason}
                      onChange={(event) => setNoReason(event.target.value)}
                      placeholder="למה אינך מגיע?"
                    />
                  </div>
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={() => respondToShift(overlay.shift.id, 'no', noReason)}>שמור תשובה</button>
                  <button className="secondary" onClick={() => setOverlay(null)}>ביטול</button>
                </div>
              </>
            )}

            {overlay.type === 'change-response' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">CHANGE RESPONSE</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                    <div className="overlay-subtitle">אפשר לעדכן את התשובה שלך למשמרת מכל מצב.</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="response-actions response-actions-modal">
                  <button className="success" onClick={() => respondToShift(overlay.shift.id, 'yes')}>
                    מגיע
                  </button>
                  <button className="warning" onClick={() => respondToShift(overlay.shift.id, 'maybe')}>
                    אולי
                  </button>
                  <button className="danger" onClick={() => openDeclineOverlay(overlay.shift)}>
                    לא מגיע
                  </button>
                </div>

                <div className="overlay-actions-bar">
                  <button className="secondary" onClick={() => setOverlay(null)}>סגור</button>
                </div>
              </>
            )}

            {overlay.type === 'day' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">DAY CONTROL</div>
                    <div className="overlay-title">{formatHumanDate(overlay.dateKey)}</div>
                    <div className="overlay-subtitle">
                      {selectedDayStats.total
                        ? 'כל המשמרות של היום נמצאות כאן.'
                        : 'אין עדיין משמרות ביום הזה.'}
                    </div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="stat-line">
                  <span className="mini-stat">משמרות {selectedDayStats.total}</span>
                  <span className="mini-stat success-text">סגורות {selectedDayStats.fullyConfirmed}</span>
                  <span className="mini-stat warning-text">בעייתיות {selectedDayStats.withProblems}</span>
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={() => openCreateShiftOverlay(overlay.dateKey)}>הוסף משמרת</button>
                  <button className="secondary" onClick={() => setOverlay(null)}>סגור</button>
                </div>

                <div className="overlay-body-stack">
                  {selectedDayShifts.length ? (
                    selectedDayShifts.map((shift) => renderAdminShiftCard(shift))
                  ) : (
                    <div className="empty-state">
                      <h3>אין משמרות ביום הזה</h3>
                      <p>אפשר לפתוח מכאן משמרת חדשה בלי לצאת מהלוח.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {overlay.type === 'create-shift' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">CREATE SHIFT</div>
                    <div className="overlay-title">משמרת חדשה</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="modal-fields">
                  <div>
                    <div className="label">שם המשמרת</div>
                    <input
                      value={newShift.title}
                      onChange={(event) => setNewShift({ ...newShift, title: event.target.value })}
                      placeholder="למשל: בוקר גזרה"
                    />
                  </div>

                  <div>
                    <div className="label">תאריך</div>
                    <input
                      type="date"
                      value={newShift.shift_date}
                      onChange={(event) => setNewShift({ ...newShift, shift_date: event.target.value })}
                    />
                  </div>

                  <div className="form-grid">
                    <div>
                      <div className="label">שעת התחלה</div>
                      <input
                        type="time"
                        value={newShift.start_time}
                        onChange={(event) => setNewShift({ ...newShift, start_time: event.target.value })}
                      />
                    </div>

                    <div>
                      <div className="label">שעת סיום</div>
                      <input
                        type="time"
                        value={newShift.end_time}
                        onChange={(event) => setNewShift({ ...newShift, end_time: event.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="label">הערות</div>
                    <textarea
                      value={newShift.notes}
                      onChange={(event) => setNewShift({ ...newShift, notes: event.target.value })}
                      placeholder="מידע חשוב על המשמרת"
                    />
                  </div>
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={createShift}>שמור</button>
                  <button className="secondary" onClick={() => openDayOverlay(newShift.shift_date)}>חזור ליום</button>
                </div>
              </>
            )}

            {overlay.type === 'edit-shift' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">EDIT SHIFT</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="modal-fields">
                  <div>
                    <div className="label">שם המשמרת</div>
                    <input
                      value={editShift.title}
                      onChange={(event) => setEditShift({ ...editShift, title: event.target.value })}
                    />
                  </div>

                  <div>
                    <div className="label">תאריך</div>
                    <input
                      type="date"
                      value={editShift.shift_date}
                      onChange={(event) => setEditShift({ ...editShift, shift_date: event.target.value })}
                    />
                  </div>

                  <div className="form-grid">
                    <div>
                      <div className="label">שעת התחלה</div>
                      <input
                        type="time"
                        value={editShift.start_time}
                        onChange={(event) => setEditShift({ ...editShift, start_time: event.target.value })}
                      />
                    </div>

                    <div>
                      <div className="label">שעת סיום</div>
                      <input
                        type="time"
                        value={editShift.end_time}
                        onChange={(event) => setEditShift({ ...editShift, end_time: event.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="label">הערות</div>
                    <textarea
                      value={editShift.notes}
                      onChange={(event) => setEditShift({ ...editShift, notes: event.target.value })}
                    />
                  </div>
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={saveEditShift}>שמור שינויים</button>
                  <button className="secondary" onClick={() => openDayOverlay(editShift.shift_date)}>חזור ליום</button>
                </div>
              </>
            )}

            {overlay.type === 'shift-details' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">SHIFT DETAILS</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                    <div className="overlay-subtitle">
                      {overlay.shift?.shift_date} · {overlay.shift?.start_time} - {overlay.shift?.end_time}
                    </div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                {overlay.shift?.notes ? <div className="note-box">הערות: {overlay.shift.notes}</div> : null}

                <div className="overlay-actions-bar">
                  <button className="secondary" onClick={() => openAssignUsersOverlay(overlay.shift.id)}>שבץ</button>
                  <button className="secondary" onClick={() => openEditShiftOverlay(overlay.shift)}>ערוך</button>
                  <button className="secondary" onClick={() => openDayOverlay(overlay.shift.shift_date)}>חזור ליום</button>
                </div>

                <div className="overlay-body-stack">
                  {overlayPeople.length ? (
                    overlayPeople.map((person, index) => (
                      <div key={`${person.user_id}-${index}`} className="shift-card-shell">
                        <div className="shift-card-head">
                          <div>
                            <div className="list-main">{person.first_name} {person.last_name}</div>
                            <div className="list-sub">username: {person.username || '---'}</div>
                            <div className="list-sub">phone: {person.phone || '---'}</div>
                            <div className="list-sub">דרגה: {person.rank || '-'}</div>
                            <div className="list-sub">סוג שירות: {person.service_type || '-'}</div>
                          </div>
                          <span className={`badge ${statusBadgeClass(person.status)}`}>{statusText(person.status)}</span>
                        </div>

                        {person.comment ? <div className="note-box">סיבה: {person.comment}</div> : null}

                        <div className="actions compact-actions">
                          {person.username || person.phone ? (
                            <button className="secondary small-button" onClick={() => openTelegramChat(person.username, person.phone)}>
                              פתח צ׳אט
                            </button>
                          ) : (
                            <button className="secondary small-button" disabled>אין פרטי צ׳אט</button>
                          )}

                          {person.phone ? (
                            <button className="secondary small-button" onClick={() => copyText(person.phone)}>העתק טלפון</button>
                          ) : null}

                          {person.username ? (
                            <button className="secondary small-button" onClick={() => copyText(person.username)}>העתק username</button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h3>אין אנשים משויכים</h3>
                      <p>אפשר לצרף אנשים למשמרת ישירות מהמסך הזה.</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {overlay.type === 'assign-users' && (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="section-tag">ASSIGN USERS</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="checkbox-list">
                  {overlayUsers.length ? (
                    overlayUsers.map((user) => (
                      <label key={user.id} className="shift-card-shell checkbox-card">
                        <div className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(Number(user.id))}
                            disabled={user.has_overlap}
                            onChange={() => toggleUserSelection(user.id)}
                          />
                          <div>
                            <div className="list-main">{user.first_name} {user.last_name}</div>
                            <div className="list-sub">דרגה: {user.rank || '-'}</div>
                            <div className="list-sub">סוג שירות: {user.service_type || '-'}</div>
                            <div className="list-sub">
                              משמרת אחרונה: {user.last_shift?.label || 'עדיין לא שובץ'}
                            </div>
                            {user.rest_hours !== null ? (
                              <div className="list-sub">מנוחה עד המשמרת: {user.rest_hours} שעות</div>
                            ) : null}
                            {user.overlap_shift ? (
                              <div className="list-sub danger-text">חופף עם: {user.overlap_shift.label}</div>
                            ) : null}
                            <div className="user-meta-row">
                              <span className={`badge ${recommendationClass(user.recommendation)}`}>
                                {recommendationText(user.recommendation)}
                              </span>
                              {user.assigned_to_target ? (
                                <span className="badge pending">כבר משויך</span>
                              ) : null}
                            </div>
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
                  <button className="secondary" onClick={() => openShiftDetailsOverlay(overlay.shift.id)}>חזור לפרטים</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
