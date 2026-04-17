import { useEffect, useMemo, useState } from 'react'

function escapeHtml(str) {
  return String(str ?? '')
}

function statusText(status) {
  if (status === 'yes') return 'מגיע'
  if (status === 'no') return 'לא מגיע'
  if (status === 'maybe') return 'לא בטוח'
  return 'לא ענה'
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear()
  const m = String(dateObj.getMonth() + 1).padStart(2, '0')
  const d = String(dateObj.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatMonthTitle(dateObj) {
  return dateObj.toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  })
}

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB)
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

  async function api(path, options = {}) {
    const tg = window.Telegram?.WebApp

// 👇 если нет Telegram — используем тестовый ID
const initData = tg?.initData || 'debug_user=1933391248'

    coconst API_BASE = 'https://ТВОЙ-БЭКЕНД.onrender.com'

const res = await fetch(API_BASE + path, {nst res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': initData,
      },
    })

    let data
    try {
      data = await res.json()
    } catch {
      data = { error: 'תגובה לא תקינה מהשרת' }
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

  async function enterUserMode() {
    try {
      setError('')
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
      setMode('admin')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת אזור מנהל')
    }
  }

  async function respond(status, comment = '') {
    if (!userShift) return

    try {
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

  function getShiftsByDateKey(dateKey) {
    return adminShifts.filter((shift) => shift.shift_date === dateKey)
  }

  function getCalendarDayStats(dateKey) {
    const shifts = getShiftsByDateKey(dateKey)

    let fullyConfirmed = 0
    let withProblems = 0

    shifts.forEach((shift) => {
      const pending = Number(shift.pending_count || 0)
      const maybe = Number(shift.maybe_count || 0)
      const no = Number(shift.no_count || 0)

      if (pending === 0 && maybe === 0 && no === 0 && Number(shift.total || 0) > 0) {
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

  const selectedDayShifts = useMemo(() => {
    return getShiftsByDateKey(selectedDate)
  }, [selectedDate, adminShifts])

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
    <div className="screen">
      <div className="card hero center">
        <h1>מערכת משמרות</h1>
        <p>יחידה 9950</p>
      </div>

      {error && (
        <div className="card error-card">
          <p>{error}</p>
        </div>
      )}

      {mode === 'select' && (
        <div className="card center">
          <h2>ברוך הבא {escapeHtml(profile.user.first_name || '')}</h2>
          <p>נא לבחור סוג כניסה</p>

          <div className="actions">
            <button onClick={enterUserMode}>כניסה רגילה</button>
            <button className="secondary" onClick={enterAdminMode}>כניסת מנהל</button>
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
              <h2>{escapeHtml(userShift.title)}</h2>

              <div className="info-block">
                <strong>תאריך</strong>
                <div>{escapeHtml(userShift.shift_date)}</div>
              </div>

              <div className="info-block">
                <strong>שעה</strong>
                <div>{escapeHtml(userShift.start_time)} - {escapeHtml(userShift.end_time)}</div>
              </div>

              <div className="info-block">
                <strong>סטטוס</strong>
                <div>{statusText(userShift.status)}</div>
              </div>

              {userShift.comment && (
                <div className="info-block">
                  <strong>סיבה</strong>
                  <div>{escapeHtml(userShift.comment)}</div>
                </div>
              )}

              {userShift.notes && (
                <div className="info-block">
                  <strong>הערות</strong>
                  <div>{escapeHtml(userShift.notes)}</div>
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
          <div className="card">
            <div className="subtitle">כניסת מנהל</div>
            <h2>יומן משמרות</h2>

            <div className="actions wrap">
              <button className="secondary" onClick={() => {
                setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))
              }}>
                חודש קודם
              </button>

              <button className="secondary" onClick={() => {
                const today = new Date()
                setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1))
                setSelectedDate(formatDateKey(today))
              }}>
                היום
              </button>

              <button className="secondary" onClick={() => {
                setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))
              }}>
                חודש הבא
              </button>

              <button onClick={loadAdmin}>רענון</button>
              <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
            </div>

            <h3 className="month-title">{formatMonthTitle(calendarDate)}</h3>

            <div className="calendar-grid">
              {['ב׳','ג׳','ד׳','ה׳','ו׳','ש׳','א׳'].map((day) => (
                <div key={day} className="weekday">{day}</div>
              ))}

              {monthCells.map(({ dateObj, muted }) => {
                const dateKey = formatDateKey(dateObj)
                const dayStats = getCalendarDayStats(dateKey)
                const isToday = isSameDay(dateObj, new Date())
                const isSelected = selectedDate === dateKey

                return (
                  <button
                    key={dateKey + String(muted)}
                    className={`day-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedDate(dateKey)}
                  >
                    <div className="day-number">{dateObj.getDate()}</div>
                    <div className="day-stats">
                      {dayStats.fullyConfirmed > 0 ? (
                        <span className="green-number">{dayStats.fullyConfirmed}</span>
                      ) : <span />}
                      {dayStats.withProblems > 0 ? (
                        <span className="red-number">{dayStats.withProblems}</span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card">
            <h2>משמרות ליום {selectedDate}</h2>

            {selectedDayShifts.length === 0 ? (
              <p>אין משמרות ביום הזה</p>
            ) : (
              <div className="shift-list">
                {selectedDayShifts.map((shift) => (
                  <div key={shift.id} className="shift-card">
                    <h3>{escapeHtml(shift.title)}</h3>
                    <p>{escapeHtml(shift.start_time)} - {escapeHtml(shift.end_time)}</p>
                    {shift.notes ? <p>{escapeHtml(shift.notes)}</p> : null}

                    <div className="small-stats">
                      <span className="badge ok">אושר: {shift.yes_count || 0}</span>
                      <span className="badge bad">בעיה: {(shift.no_count || 0) + (shift.pending_count || 0) + (shift.maybe_count || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}