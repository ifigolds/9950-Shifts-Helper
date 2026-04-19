import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'https://nine950-backend.onrender.com'

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

function emptyShiftForm() {
  return {
    title: '',
    shift_date: formatDateKey(new Date()),
    start_time: '',
    end_time: '',
    notes: '',
  }
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

  const [showCreateShift, setShowCreateShift] = useState(false)
  const [newShift, setNewShift] = useState(emptyShiftForm())

  const [editingShiftId, setEditingShiftId] = useState(null)
  const [editShift, setEditShift] = useState(emptyShiftForm())

  const [selectedShiftDetails, setSelectedShiftDetails] = useState(null)
  const [selectedShiftId, setSelectedShiftId] = useState(null)

  const [assignShiftId, setAssignShiftId] = useState(null)
  const [assignableUsers, setAssignableUsers] = useState([])
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

  async function loadShiftDetails(shiftId) {
    const data = await api(`/admin/shifts/${shiftId}`)
    setSelectedShiftDetails(data.people || [])
    setSelectedShiftId(shiftId)
  }

  async function loadAssignableUsers(shiftId) {
    const data = await api('/admin/users')
    setAssignableUsers(data.users || [])
    setAssignShiftId(shiftId)
    setSelectedUserIds([])
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
      setSelectedShiftDetails(null)
      setAssignShiftId(null)
      setEditingShiftId(null)
      setShowCreateShift(false)
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
      setSelectedShiftDetails(null)
      setAssignShiftId(null)
      setEditingShiftId(null)
      setShowCreateShift(false)
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

  async function createShift() {
    try {
      setError('')
      await api('/admin/shifts', {
        method: 'POST',
        body: JSON.stringify(newShift),
      })

      setShowCreateShift(false)
      setNewShift(emptyShiftForm())
      await loadAdminShifts()
      if (newShift.shift_date) {
        const [y, m] = newShift.shift_date.split('-').map(Number)
        setCalendarDate(new Date(y, m - 1, 1))
        setSelectedDate(newShift.shift_date)
      }
    } catch (err) {
      setError(err.message || 'שגיאה ביצירת משמרת')
    }
  }

  function startEditShift(shift) {
    setEditingShiftId(shift.id)
    setEditShift({
      title: shift.title || '',
      shift_date: shift.shift_date || formatDateKey(new Date()),
      start_time: shift.start_time || '',
      end_time: shift.end_time || '',
      notes: shift.notes || '',
    })
    setShowCreateShift(false)
    setSelectedShiftDetails(null)
    setAssignShiftId(null)
  }

  async function saveEditShift() {
    try {
      setError('')
      await api(`/admin/shifts/${editingShiftId}`, {
        method: 'PUT',
        body: JSON.stringify(editShift),
      })

      setEditingShiftId(null)
      setEditShift(emptyShiftForm())
      await loadAdminShifts()
      if (editShift.shift_date) {
        const [y, m] = editShift.shift_date.split('-').map(Number)
        setCalendarDate(new Date(y, m - 1, 1))
        setSelectedDate(editShift.shift_date)
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
      await api(`/admin/shifts/${shiftId}`, {
        method: 'DELETE',
      })

      if (selectedShiftId === shiftId) {
        setSelectedShiftId(null)
        setSelectedShiftDetails(null)
      }
      if (editingShiftId === shiftId) {
        setEditingShiftId(null)
      }
      await loadAdminShifts()
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
    try {
      setError('')
      await api(`/admin/shifts/${assignShiftId}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          user_ids: selectedUserIds,
        }),
      })

      setAssignShiftId(null)
      setAssignableUsers([])
      setSelectedUserIds([])
      await loadAdminShifts()
      await loadShiftDetails(assignShiftId)
    } catch (err) {
      setError(err.message || 'שגיאה בשיוך משתמשים')
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
  <div className="entry-screen">
    <div className="card center entry-main-card">
      <h2>ברוך הבא {profile.user.first_name || ''}</h2>
      <p>נא לבחור סוג כניסה</p>

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
          <div className="card">
            <div className="subtitle">כניסת מנהל</div>
            <h2>יומן משמרות</h2>

            <div className="actions wrap">
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
                  setSelectedDate(formatDateKey(today))
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

              <button onClick={() => {
                setShowCreateShift(!showCreateShift)
                setEditingShiftId(null)
                setAssignShiftId(null)
                setSelectedShiftDetails(null)
              }}>
                יצירת משמרת חדשה
              </button>

              <button className="secondary" onClick={loadAdminShifts}>רענון</button>
              <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
            </div>

            {showCreateShift && (
              <div className="info-block">
                <strong>יצירת משמרת חדשה</strong>

                <input
                  placeholder="שם המשמרת"
                  value={newShift.title}
                  onChange={(e) => setNewShift({ ...newShift, title: e.target.value })}
                />

                <div className="form-grid">
                  <input
                    type="date"
                    value={newShift.shift_date}
                    onChange={(e) => setNewShift({ ...newShift, shift_date: e.target.value })}
                  />
                  <input
                    type="time"
                    value={newShift.start_time}
                    onChange={(e) => setNewShift({ ...newShift, start_time: e.target.value })}
                  />
                </div>

                <input
                  type="time"
                  value={newShift.end_time}
                  onChange={(e) => setNewShift({ ...newShift, end_time: e.target.value })}
                />

                <textarea
                  placeholder="הערות"
                  value={newShift.notes}
                  onChange={(e) => setNewShift({ ...newShift, notes: e.target.value })}
                />

                <div className="actions">
                  <button onClick={createShift}>שמור</button>
                  <button className="secondary" onClick={() => setShowCreateShift(false)}>ביטול</button>
                </div>
              </div>
            )}

            {editingShiftId && (
              <div className="info-block">
                <strong>עריכת משמרת</strong>

                <input
                  placeholder="שם המשמרת"
                  value={editShift.title}
                  onChange={(e) => setEditShift({ ...editShift, title: e.target.value })}
                />

                <div className="form-grid">
                  <input
                    type="date"
                    value={editShift.shift_date}
                    onChange={(e) => setEditShift({ ...editShift, shift_date: e.target.value })}
                  />
                  <input
                    type="time"
                    value={editShift.start_time}
                    onChange={(e) => setEditShift({ ...editShift, start_time: e.target.value })}
                  />
                </div>

                <input
                  type="time"
                  value={editShift.end_time}
                  onChange={(e) => setEditShift({ ...editShift, end_time: e.target.value })}
                />

                <textarea
                  placeholder="הערות"
                  value={editShift.notes}
                  onChange={(e) => setEditShift({ ...editShift, notes: e.target.value })}
                />

                <div className="actions">
                  <button onClick={saveEditShift}>שמור שינויים</button>
                  <button className="secondary" onClick={() => setEditingShiftId(null)}>ביטול</button>
                </div>
              </div>
            )}

            <h3 className="month-title">{formatMonthTitle(calendarDate)}</h3>

            <div className="calendar-grid">
              {['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'].map((day) => (
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
                      {dayStats.fullyConfirmed > 0 ? <span className="green-number">{dayStats.fullyConfirmed}</span> : <span />}
                      {dayStats.withProblems > 0 ? <span className="red-number">{dayStats.withProblems}</span> : null}
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
                    <h3>{shift.title}</h3>
                    <p>{shift.start_time} - {shift.end_time}</p>
                    {shift.notes ? <p>{shift.notes}</p> : null}

                    <div className="small-stats">
                      <span className="badge ok">אושר: {shift.yes_count || 0}</span>
                      <span className="badge bad">
                        בעיה: {(shift.no_count || 0) + (shift.pending_count || 0) + (shift.maybe_count || 0)}
                      </span>
                    </div>

                    <div className="actions wrap">
                      <button onClick={() => loadShiftDetails(shift.id)}>פתח</button>
                      <button className="secondary" onClick={() => loadAssignableUsers(shift.id)}>שייך אנשים</button>
                      <button className="secondary" onClick={() => startEditShift(shift)}>ערוך</button>
                      <button className="danger" onClick={() => deleteShift(shift.id)}>מחק</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedShiftId && (
            <div className="card">
              <h2>אנשים במשמרת</h2>

              {!selectedShiftDetails || selectedShiftDetails.length === 0 ? (
                <p>אין אנשים משויכים למשמרת הזאת</p>
              ) : (
                <div className="shift-list">
                  {selectedShiftDetails.map((person, index) => (
                    <div key={index} className="shift-card">
                      <h3>{person.first_name} {person.last_name}</h3>
                      <p>דרגה: {person.rank || '-'}</p>
                      <p>סוג שירות: {person.service_type || '-'}</p>
                      <p>סטטוס: {statusText(person.status)}</p>
                      {person.comment ? <p>סיבה: {person.comment}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {assignShiftId && (
            <div className="card">
              <h2>שיוך אנשים למשמרת</h2>

              {assignableUsers.length === 0 ? (
                <p>אין משתמשים זמינים</p>
              ) : (
                <div className="shift-list">
                  {assignableUsers.map((user) => (
                    <label key={user.id} className="shift-card" style={{ display: 'block', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                        style={{ width: 'auto', marginLeft: 8 }}
                      />
                      <strong>{user.first_name} {user.last_name}</strong>
                      <p>דרגה: {user.rank || '-'}</p>
                      <p>סוג שירות: {user.service_type || '-'}</p>
                    </label>
                  ))}
                </div>
              )}

              <div className="actions">
                <button onClick={assignUsersToShift}>שמור שיוך</button>
                <button className="secondary" onClick={() => setAssignShiftId(null)}>ביטול</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}