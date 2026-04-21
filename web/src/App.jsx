import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'https://nine950-backend.onrender.com'
const LOGO_SRC = '/logo-9950.png'
const MIN_BOOT_MS = 1400
const ISRAEL_TIMEZONE = 'Asia/Jerusalem'
const WEEKDAYS = ['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳']

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

function recommendationText(recommendation) {
  if (recommendation === 'overlap') return 'חופף למשמרת אחרת'
  if (recommendation === 'recent') return 'היה במשמרת לאחרונה'
  if (recommendation === 'assigned') return 'כבר משויך למשמרת הזאת'
  return 'מומלץ לשיבוץ'
}

function recommendationClass(recommendation) {
  if (recommendation === 'overlap') return 'danger'
  if (recommendation === 'recent') return 'warning'
  if (recommendation === 'assigned') return 'pending'
  return 'success'
}

function formatDateKey(dateObj) {
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number)
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1, 12, 0, 0))
}

function getIsraelDateParts(date = new Date(), timeZone = ISRAEL_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = {}
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value
    }
  })

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function getCurrentIsraelDateKey(date = new Date(), timeZone = ISRAEL_TIMEZONE) {
  const parts = getIsraelDateParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function getCurrentIsraelCalendarMonth(date = new Date(), timeZone = ISRAEL_TIMEZONE) {
  const parts = getIsraelDateParts(date, timeZone)
  return new Date(parts.year, parts.month - 1, 1)
}

function getCurrentIsraelTimeLabel(date = new Date(), timeZone = ISRAEL_TIMEZONE) {
  const parts = getIsraelDateParts(date, timeZone)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function formatMonthTitle(dateObj) {
  return new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), 1, 12, 0, 0)).toLocaleDateString('he-IL', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

function formatHumanDate(dateKey) {
  if (!dateKey) return ''

  return parseDateKey(dateKey).toLocaleDateString('he-IL', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function emptyShiftForm(dateKey = getCurrentIsraelDateKey()) {
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

function isSameDay(dateA, dateB) {
  return formatDateKey(dateA) === formatDateKey(dateB)
}

function getShiftProblemCount(shift) {
  return Number(shift.pending_count || 0) + Number(shift.maybe_count || 0) + Number(shift.no_count || 0)
}

function isShiftFullyConfirmed(shift) {
  return Number(shift.total || 0) > 0 && getShiftProblemCount(shift) === 0
}

function formatHoursLabel(hours) {
  const value = Number(hours || 0)
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function formatDurationLabel(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes} דק׳`
  if (!minutes) return `${hours} ש׳`
  return `${hours} ש׳ ${minutes} דק׳`
}

function buildServerClock(nowIso) {
  if (!nowIso) return null

  const serverNowMs = new Date(nowIso).getTime()
  if (Number.isNaN(serverNowMs)) return null

  return {
    serverNowMs,
    clientNowMs: Date.now(),
  }
}

function resolveReferenceNow(serverClock) {
  if (!serverClock) {
    return new Date()
  }

  const adjustedNowMs = serverClock.serverNowMs + (Date.now() - serverClock.clientNowMs)
  return new Date(adjustedNowMs)
}

function getShiftLiveTiming(shift, nowMs = Date.now()) {
  if (!shift?.timing?.start_iso || !shift?.timing?.end_iso) {
    return {
      durationMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      startsInMs: 0,
      progressPercent: 0,
      isActive: false,
      isCompleted: false,
      isUpcoming: false,
    }
  }

  const startMs = new Date(shift.timing.start_iso).getTime()
  const endMs = new Date(shift.timing.end_iso).getTime()
  const durationMs = Math.max(1, endMs - startMs)
  const elapsedMs = Math.min(Math.max(nowMs - startMs, 0), durationMs)
  const remainingMs = Math.max(endMs - nowMs, 0)
  const isActive = nowMs >= startMs && nowMs < endMs
  const isCompleted = nowMs >= endMs
  const isUpcoming = nowMs < startMs

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
    isUpcoming,
  }
}

function getLiveStateMeta(liveTiming) {
  if (liveTiming.isActive) {
    return {
      tone: 'success',
      label: 'משמרת פעילה',
    }
  }

  if (liveTiming.isUpcoming) {
    return {
      tone: 'warning',
      label: `מתחילה בעוד ${formatDurationLabel(liveTiming.startsInMs)}`,
    }
  }

  return {
    tone: 'pending',
    label: 'הסתיימה',
  }
}

function LoadingScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-card">
        <img src={LOGO_SRC} alt="9950" className="boot-logo" />
        <div className="eyebrow">9950 SHIFT SYSTEM</div>
        <h1 className="page-title">טוען את מערכת המשמרות</h1>
        <p className="subtitle wide-copy">מסנכרן את הפרופיל, המשמרות והזמנים לפי שעון ישראל.</p>
        <div className="boot-progress">
          <span />
        </div>
      </div>
    </div>
  )
}

function BrandLockup({ compact = false }) {
  return (
    <div className={`brand-lockup ${compact ? 'compact' : ''}`}>
      <img src={LOGO_SRC} alt="9950" className="brand-logo" />
      <div>
        <div className="eyebrow">UNIT 9950</div>
        <div className="brand-title">מערכת משמרות</div>
      </div>
    </div>
  )
}

function StatusScreen({ title, text }) {
  return (
    <div className="boot-screen">
      <div className="surface surface-centered status-card">
        <BrandLockup compact />
        <h2 className="page-title">{title}</h2>
        {text ? <p className="subtitle wide-copy">{text}</p> : null}
      </div>
    </div>
  )
}

function AppFooter() {
  return (
    <div className="app-footer">
      <span>version 1.2</span>
      <span>Israel timezone active</span>
    </div>
  )
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [mode, setMode] = useState('select')
  const [serverClock, setServerClock] = useState(null)
  const [, setTick] = useState(0)

  const [userShifts, setUserShifts] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [currentLeaderboardUser, setCurrentLeaderboardUser] = useState(null)
  const [noReason, setNoReason] = useState('')

  const [adminShifts, setAdminShifts] = useState([])
  const [calendarDate, setCalendarDate] = useState(getCurrentIsraelCalendarMonth())
  const [selectedDate, setSelectedDate] = useState(getCurrentIsraelDateKey())

  const [overlay, setOverlay] = useState(null)
  const [newShift, setNewShift] = useState(emptyShiftForm())
  const [editShift, setEditShift] = useState(emptyShiftForm())
  const [overlayPeople, setOverlayPeople] = useState([])
  const [overlayUsers, setOverlayUsers] = useState([])
  const [selectedUserIds, setSelectedUserIds] = useState([])

  const timezoneLabel = profile?.timezone || ISRAEL_TIMEZONE
  const referenceNow = resolveReferenceNow(serverClock)
  const referenceNowMs = referenceNow.getTime()
  const todayKey = getCurrentIsraelDateKey(referenceNow, timezoneLabel)
  const currentClock = getCurrentIsraelTimeLabel(referenceNow, timezoneLabel)
  const todayLabel = formatHumanDate(todayKey)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1)
    }, 15000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const tg = window.Telegram?.WebApp

    function applyViewportVars() {
      const viewportHeight = tg?.viewportHeight ? `${tg.viewportHeight}px` : '100svh'
      const stableHeight = tg?.viewportStableHeight ? `${tg.viewportStableHeight}px` : viewportHeight

      document.documentElement.style.setProperty('--tg-viewport-height', viewportHeight)
      document.documentElement.style.setProperty('--tg-stable-height', stableHeight)
    }

    applyViewportVars()

    if (tg && typeof tg.onEvent === 'function') {
      tg.onEvent('viewportChanged', applyViewportVars)
    }

    window.addEventListener('resize', applyViewportVars)

    return () => {
      if (tg && typeof tg.offEvent === 'function') {
        tg.offEvent('viewportChanged', applyViewportVars)
      }

      window.removeEventListener('resize', applyViewportVars)
    }
  }, [])

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
          const clock = buildServerClock(data?.now?.iso)
          if (clock) {
            setServerClock(clock)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'שגיאה בטעינת הפרופיל')
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
    if (!overlay) {
      document.body.classList.remove('overlay-open')
      return undefined
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOverlay(null)
      }
    }

    document.body.classList.add('overlay-open')
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.classList.remove('overlay-open')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [overlay])

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

  function syncServerNow(nowIso) {
    const clock = buildServerClock(nowIso)
    if (clock) {
      setServerClock(clock)
    }
  }

  function syncCalendarToDateKey(dateKey) {
    const parsedDate = parseDateKey(dateKey)
    setSelectedDate(dateKey)
    setCalendarDate(new Date(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), 1))
  }

  async function loadUserShifts() {
    const data = await api('/me/shifts')
    setUserShifts(data.shifts || [])
    syncServerNow(data?.now?.iso || data?.shifts?.[0]?.timing?.now_iso)
  }

  async function loadLeaderboard() {
    const data = await api('/me/leaderboard')
    setLeaderboard(data.leaderboard || [])
    setCurrentLeaderboardUser(data.current_user || null)
    syncServerNow(data?.now?.iso)
  }

  async function loadAdminShifts() {
    const data = await api('/admin/shifts')
    setAdminShifts(data.shifts || [])
    syncServerNow(data?.now?.iso)
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

  const normalizedUserShifts = useMemo(
    () => userShifts.map((shift) => ({ ...shift, liveTiming: getShiftLiveTiming(shift, referenceNowMs) })),
    [userShifts, referenceNowMs]
  )

  const userDashboard = useMemo(() => {
    const activeShift = normalizedUserShifts.find((shift) => shift.liveTiming.isActive) || null
    const upcomingShift = normalizedUserShifts.find((shift) => shift.liveTiming.isUpcoming) || null
    const fallbackShift = normalizedUserShifts.length ? normalizedUserShifts[normalizedUserShifts.length - 1] : null
    const focusShift =
      activeShift ||
      upcomingShift ||
      normalizedUserShifts.find((shift) => !shift.liveTiming.isCompleted) ||
      fallbackShift

    const upcomingCount = normalizedUserShifts.filter((shift) => shift.liveTiming.isUpcoming).length

    return {
      activeShift,
      focusShift,
      upcomingCount,
      totalAssigned: normalizedUserShifts.length,
    }
  }, [normalizedUserShifts])

  const monthCells = useMemo(() => {
    const current = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)
    const firstDayOfMonth = new Date(current.getFullYear(), current.getMonth(), 1)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7
    const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate()
    const daysInPreviousMonth = new Date(current.getFullYear(), current.getMonth(), 0).getDate()
    const cells = []

    for (let index = startWeekday - 1; index >= 0; index -= 1) {
      cells.push({
        dateObj: new Date(current.getFullYear(), current.getMonth() - 1, daysInPreviousMonth - index),
        muted: true,
      })
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({
        dateObj: new Date(current.getFullYear(), current.getMonth(), day),
        muted: false,
      })
    }

    while (cells.length % 7 !== 0) {
      const nextIndex = cells.length - (startWeekday + daysInMonth) + 1
      cells.push({
        dateObj: new Date(current.getFullYear(), current.getMonth() + 1, nextIndex),
        muted: true,
      })
    }

    return cells
  }, [calendarDate])

  const monthStats = useMemo(() => {
    const month = calendarDate.getMonth()
    const year = calendarDate.getFullYear()
    const shifts = adminShifts.filter((shift) => {
      const parsed = parseDateKey(shift.shift_date)
      return parsed.getUTCMonth() === month && parsed.getUTCFullYear() === year
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
  }, [adminShifts, calendarDate])

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

  async function enterUserMode() {
    try {
      setError('')
      setOverlay(null)
      await Promise.all([loadUserShifts(), loadLeaderboard()])
      setMode('user')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת אזור אישי')
    }
  }

  async function enterAdminMode() {
    try {
      setError('')

      if (!profile?.user || profile.user.role !== 'admin') {
        throw new Error('אין לך הרשאת מנהל')
      }

      syncCalendarToDateKey(todayKey)
      await loadAdminShifts()
      setOverlay(null)
      setMode('admin')
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת אזור ניהול')
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
      await Promise.all([loadUserShifts(), loadLeaderboard()])
    } catch (err) {
      setError(err.message || 'שגיאה בעדכון התגובה למשמרת')
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
      shift_date: shift.shift_date || todayKey,
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
    setSelectedUserIds((previous) =>
      previous.includes(normalizedUserId)
        ? previous.filter((id) => id !== normalizedUserId)
        : [...previous, normalizedUserId]
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

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text || ''))
    } catch {
      setError('לא ניתן היה להעתיק את הטקסט')
    }
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

      setError('אין פרטי קשר לפתיחת צ׳אט')
    } catch {
      setError('לא ניתן לפתוח את הצ׳אט כרגע')
    }
  }

  function renderFocusActions(shift) {
    if (!shift) return null

    if (shift.liveTiming.isCompleted) {
      return (
        <div className="actions">
          <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
        </div>
      )
    }

    if (shift.status && shift.status !== 'pending') {
      return (
        <div className="actions">
          <button className="secondary" onClick={() => openResponseOverlay(shift)}>שנה תגובה</button>
          <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
        </div>
      )
    }

    return (
      <div className="actions">
        <button className="success" onClick={() => respondToShift(shift.id, 'yes')}>אני מגיע</button>
        <button className="warning" onClick={() => respondToShift(shift.id, 'maybe')}>לא בטוח</button>
        <button className="danger" onClick={() => openDeclineOverlay(shift)}>לא מגיע</button>
        <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
      </div>
    )
  }

  function renderNextReplacementBlock(shift) {
    if (!shift?.next_shift) return null

    const names = (shift.replacement_people || [])
      .slice(0, 3)
      .map((person) => personName(person))
      .filter(Boolean)

    return (
      <div className="note-box handover-box">
        <div className="label">החלפה הבאה</div>
        <div className="list-main">{shift.next_shift.title}</div>
        <div className="list-sub">
          {shift.next_shift.shift_date} · {shift.next_shift.start_time} - {shift.next_shift.end_time}
        </div>
        <div className="supporting-copy">
          {names.length
            ? `צוות מתחלף: ${names.join(', ')}`
            : 'עדיין לא שובצו מחליפים למשמרת הבאה.'}
        </div>
      </div>
    )
  }

  function renderAdminShiftActions(shift, compact = false) {
    return (
      <div className={`actions ${compact ? 'compact-actions' : ''}`}>
        <button className="secondary" onClick={() => openShiftDetailsOverlay(shift.id)}>פרטים</button>
        <button className="secondary" onClick={() => openAssignUsersOverlay(shift.id)}>שבץ אנשים</button>
        <button className="secondary" onClick={() => openEditShiftOverlay(shift)}>ערוך</button>
        <button className="danger" onClick={() => deleteShift(shift.id)}>מחק</button>
      </div>
    )
  }

  function renderAdminShiftCard(shift, compact = false) {
    const problemCount = getShiftProblemCount(shift)
    const badgeLabel = problemCount > 0 ? `דורש טיפול ${problemCount}` : 'סגור ומוכן'

    return (
      <div
        key={shift.id}
        className={`list-item shift-card ${compact ? 'shift-card-compact' : ''} ${problemCount > 0 ? 'shift-card-alert' : 'shift-card-ready'}`}
      >
        <div className="shift-card-head">
          <div>
            <div className="list-main">{shift.title}</div>
            <div className="list-sub">{formatHumanDate(shift.shift_date)}</div>
            <div className="list-sub">{shift.start_time} - {shift.end_time}</div>
          </div>
          <div className="status-cluster">
            <span className={`badge ${problemCount > 0 ? 'warning' : 'success'}`}>{badgeLabel}</span>
          </div>
        </div>

        {shift.notes ? <div className="list-sub shift-notes">הערות: {shift.notes}</div> : null}

        {shift.problem_people?.length ? (
          <div className="problem-strip">
            {shift.problem_people.slice(0, 4).map((person, index) => (
              <span key={`${shift.id}-${index}`} className={`badge ${statusBadgeClass(person.status)}`}>
                {person.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="stat-line">
          <span className="mini-stat">סה״כ {shift.total || 0}</span>
          <span className="mini-stat success-text">מגיעים {shift.yes_count || 0}</span>
          <span className="mini-stat danger-text">לא מגיעים {shift.no_count || 0}</span>
          <span className="mini-stat warning-text">לא בטוחים {shift.maybe_count || 0}</span>
          <span className="mini-stat muted-text">ממתינים {shift.pending_count || 0}</span>
        </div>

        {renderAdminShiftActions(shift, compact)}
      </div>
    )
  }

  function renderUserShiftCard(shift) {
    const liveMeta = getLiveStateMeta(shift.liveTiming)
    const hasResponse = shift.status && shift.status !== 'pending'
    const showReplacement = shift.liveTiming.isActive && shift.replacement_people?.length

    return (
      <div key={shift.id} className="list-item shift-card">
        <div className="shift-card-head">
          <div>
            <div className="list-main">{shift.title}</div>
            <div className="list-sub">{formatHumanDate(shift.shift_date)}</div>
            <div className="list-sub">{shift.start_time} - {shift.end_time}</div>
          </div>
          <div className="status-cluster">
            <span className={`badge ${liveMeta.tone}`}>{liveMeta.label}</span>
            <span className={`badge ${statusBadgeClass(shift.status)}`}>{statusText(shift.status)}</span>
          </div>
        </div>

        <div className="stat-line">
          <span className="mini-stat">{formatHoursLabel(shift.duration_hours)} ש׳ מתוכננות</span>
          {shift.liveTiming.isActive ? (
            <>
              <span className="mini-stat success-text">{formatDurationLabel(shift.liveTiming.elapsedMs)} מהתחלה</span>
              <span className="mini-stat muted-text">{formatDurationLabel(shift.liveTiming.remainingMs)} לסיום</span>
            </>
          ) : null}
          {shift.liveTiming.isUpcoming ? (
            <span className="mini-stat warning-text">מתחילה בעוד {formatDurationLabel(shift.liveTiming.startsInMs)}</span>
          ) : null}
        </div>

        {shift.liveTiming.isActive ? (
          <div className="progress-panel compact-progress">
            <div className="progress-panel-head">
              <span>התקדמות המשמרת</span>
              <strong>{Math.round(shift.liveTiming.progressPercent)}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${Math.max(4, shift.liveTiming.progressPercent)}%` }} />
            </div>
          </div>
        ) : null}

        {shift.notes ? <div className="note-box"><div className="label">הערות למשמרת</div><div className="list-sub">{shift.notes}</div></div> : null}
        {shift.comment ? <div className="note-box"><div className="label">סיבה שנשמרה</div><div className="list-sub">{shift.comment}</div></div> : null}

        {showReplacement ? renderNextReplacementBlock(shift) : null}

        {showReplacement ? (
          <div className="checkbox-list">
            {shift.replacement_people.map((person) => (
              <div key={`${shift.id}-${person.user_id}`} className="list-item person-card">
                <div className="list-main">{personName(person)}</div>
                <div className="list-sub">טלפון: {person.phone || '---'}</div>
                <div className="list-sub">
                  username: {person.username ? `@${String(person.username).replace(/^@/, '')}` : '---'}
                </div>
                <div className="actions compact-actions">
                  {person.username || person.phone ? (
                    <button className="secondary" onClick={() => openTelegramChat(person.username, person.phone)}>
                      פתח צ׳אט
                    </button>
                  ) : (
                    <button className="secondary" disabled>אין נתונים לצ׳אט</button>
                  )}
                  {person.phone ? (
                    <button className="secondary" onClick={() => copyText(person.phone)}>העתק טלפון</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {shift.liveTiming.isCompleted ? null : hasResponse ? (
          <div className="actions compact-actions">
            <button className="secondary" onClick={() => openResponseOverlay(shift)}>שנה תגובה</button>
          </div>
        ) : (
          <div className="actions compact-actions">
            <button className="success" onClick={() => respondToShift(shift.id, 'yes')}>אני מגיע</button>
            <button className="warning" onClick={() => respondToShift(shift.id, 'maybe')}>לא בטוח</button>
            <button className="danger" onClick={() => openDeclineOverlay(shift)}>לא מגיע</button>
          </div>
        )}
      </div>
    )
  }

  function renderAssignedPersonCard(person, index) {
    return (
      <div key={`${person.user_id}-${index}`} className="list-item person-card">
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
            <button className="secondary" onClick={() => openTelegramChat(person.username, person.phone)}>
              פתח צ׳אט
            </button>
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
    )
  }

  function renderAssignableUserCard(user) {
    return (
      <label key={user.id} className={`list-item checkbox-card ${user.has_overlap ? 'checkbox-card-disabled' : ''}`}>
        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={selectedUserIds.includes(Number(user.id))}
            disabled={user.has_overlap}
            onChange={() => toggleUserSelection(user.id)}
          />
          <div className="checkbox-body">
            <div className="list-main">{user.first_name} {user.last_name}</div>
            <div className="list-sub">דרגה: {user.rank || '-'}</div>
            <div className="list-sub">סוג שירות: {user.service_type || '-'}</div>
            <div className="list-sub">משמרת אחרונה: {user.last_shift?.label || 'טרם שובץ'}</div>
            {user.rest_hours !== null ? (
              <div className="list-sub">זמן מנוחה עד המשמרת: {user.rest_hours} שעות</div>
            ) : null}
            {user.overlap_shift ? (
              <div className="list-sub danger-text">חופף עם: {user.overlap_shift.label}</div>
            ) : null}

            <div className="status-cluster">
              <span className={`badge ${recommendationClass(user.recommendation)}`}>{recommendationText(user.recommendation)}</span>
              {user.assigned_to_target ? <span className="badge pending">כבר משויך</span> : null}
            </div>
          </div>
        </div>
      </label>
    )
  }

  function renderLeaderboardRow(entry, highlight = false) {
    const medalTone =
      entry.rank === 1 ? 'success' :
      entry.rank === 2 ? 'warning' :
      entry.rank === 3 ? 'pending' :
      'pending'

    return (
      <div
        key={`leaderboard-${entry.user_id}-${highlight ? 'highlight' : 'normal'}`}
        className={`leaderboard-row ${highlight ? 'leaderboard-row-highlight' : ''}`}
      >
        <div className="leaderboard-rank">
          <span className={`badge ${medalTone}`}>#{entry.rank}</span>
        </div>
        <div className="leaderboard-main">
          <div className="list-main">{personName(entry)}</div>
          <div className="list-sub">{entry.completed_shifts} משמרות שהושלמו</div>
        </div>
        <div className="leaderboard-hours">
          <strong>{formatHoursLabel(entry.completed_hours)}</strong>
          <span>שעות</span>
        </div>
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

  const focusShift = userDashboard.focusShift
  const focusTiming = focusShift?.liveTiming

  let focusHeadline = 'המשמרת הקרובה במרכז המסך'
  let focusTag = 'לוח אישי'
  let focusCopy = 'כאן תראה בזמן אמת מה קורה עם המשמרת הפעילה או הקרובה שלך.'
  let progressNode = null

  if (focusShift && focusTiming?.isActive) {
    focusHeadline = 'אתה כרגע במהלך משמרת'
    focusTag = 'משמרת פעילה עכשיו'
    focusCopy = `עברו ${formatDurationLabel(focusTiming.elapsedMs)} מתוך ${formatDurationLabel(focusTiming.durationMs)}.`
    progressNode = (
      <div className="progress-panel pulse">
        <div className="progress-panel-head">
          <span>התקדמות המשמרת</span>
          <strong>{Math.round(focusTiming.progressPercent)}%</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${Math.max(4, focusTiming.progressPercent)}%` }} />
        </div>
        <div className="progress-meta">
          <span>{formatDurationLabel(focusTiming.elapsedMs)} מהתחלה</span>
          <span>{formatDurationLabel(focusTiming.remainingMs)} לסיום</span>
        </div>
      </div>
    )
  } else if (focusShift && focusTiming?.isUpcoming) {
    focusHeadline = 'המשמרת הבאה כבר מוכנה'
    focusTag = 'בקרוב מתחיל'
    focusCopy = `נשארו ${formatDurationLabel(focusTiming.startsInMs)} עד תחילת המשמרת.`
    progressNode = (
      <div className="support-strip">
        <span className="mini-stat warning-text">מתחילה בעוד {formatDurationLabel(focusTiming.startsInMs)}</span>
        <span className="mini-stat muted-text">{formatHoursLabel(focusShift.duration_hours)} ש׳ מתוכננות</span>
      </div>
    )
  } else if (!focusShift) {
    focusHeadline = 'אין כרגע משמרת פעילה או קרובה'
    focusTag = 'לוח אישי'
    focusCopy = 'כשתשובץ משמרת חדשה, היא תופיע כאן בצורה ברורה ומרוכזת.'
  }

  return (
    <div className="view-shell">
      {error ? (
        <div className="flash-message">
          <span className="flash-dot" />
          <span>{error}</span>
        </div>
      ) : null}

      {mode === 'select' ? (
        <>
          <section className="hero-panel mode-hero fade-in">
            <BrandLockup />
            <p className="subtitle wide-copy">
              בחר את סביבת העבודה שמתאימה לך עכשיו. האזור האישי שם את המשמרת החשובה במרכז, ואזור הניהול נותן תמונה נקייה וברורה על כל ימי הלוח.
            </p>
            <div className="hero-meta">
              <span className="meta-pill meta-pill-strong">{todayLabel}</span>
              <span className="meta-pill">השעה כעת {currentClock}</span>
              <span className="meta-pill">שעון ישראל</span>
            </div>
          </section>

          <section className="mode-grid fade-in">
            <button className="mode-card mode-card-primary" onClick={enterUserMode}>
              <span className="mode-card-tag">אישי</span>
              <strong>לוח משמרות אישי</strong>
              <span>המשמרת הפעילה או הקרובה, זמן שעבר, התקדמות ותגובה מהירה במקום אחד.</span>
            </button>

            {profile.user.role === 'admin' ? (
              <button className="mode-card" onClick={enterAdminMode}>
                <span className="mode-card-tag">ניהול</span>
                <strong>יומן משמרות למנהל</strong>
                <span>לוח חודשי, ימים שדורשים טיפול, פתיחת יום ושיבוץ מהיר של אנשים.</span>
              </button>
            ) : (
              <div className="mode-card mode-card-muted">
                <span className="mode-card-tag">מידע</span>
                <strong>אזור ניהול סגור</strong>
                <span>כניסת מנהל מוצגת רק לחשבונות עם הרשאת ניהול מאושרת.</span>
              </div>
            )}
          </section>

          <AppFooter />
        </>
      ) : null}

      {mode === 'user' ? (
        <div className="view-shell fade-in">
          <div className="topbar">
            <BrandLockup compact />
            <div className="actions topbar-actions">
              {profile.user.role === 'admin' ? (
                <button className="secondary" onClick={enterAdminMode}>אזור ניהול</button>
              ) : null}
              <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
            </div>
          </div>

          <section className="hero-panel user-hero">
            <div>
              <div className="eyebrow">לוח אישי</div>
              <div className="page-title">שלום {profile.user.first_name || 'לך'}</div>
              <p className="subtitle wide-copy">{focusHeadline}</p>
            </div>
            <div className="hero-meta">
              <span className="meta-pill meta-pill-strong">{todayLabel}</span>
              <span className="meta-pill">השעה כעת {currentClock}</span>
              <span className="meta-pill">{timezoneLabel}</span>
            </div>
          </section>

          <section className="dashboard-layout">
            <div className={`surface focus-surface ${focusTiming?.isActive ? 'focus-surface-active' : ''}`}>
              <div className="focus-header">
                <div>
                  <div className="eyebrow">{focusTag}</div>
                  <div className="section-title">{focusShift?.title || 'אין משמרת זמינה'}</div>
                  <p className="subtitle wide-copy">{focusCopy}</p>
                </div>
                {focusShift ? (
                  <span className={`badge ${getLiveStateMeta(focusTiming).tone}`}>{getLiveStateMeta(focusTiming).label}</span>
                ) : null}
              </div>

              {focusShift ? (
                <>
                  <div className="focus-info-grid">
                    <div className="info-tile">
                      <div className="label">תאריך</div>
                      <div className="info-value">{formatHumanDate(focusShift.shift_date)}</div>
                    </div>
                    <div className="info-tile">
                      <div className="label">טווח שעות</div>
                      <div className="info-value">{focusShift.start_time} - {focusShift.end_time}</div>
                    </div>
                    <div className="info-tile">
                      <div className="label">סטטוס תגובה</div>
                      <div className="info-value">
                        <span className={`badge ${statusBadgeClass(focusShift.status)}`}>{statusText(focusShift.status)}</span>
                      </div>
                    </div>
                    <div className="info-tile">
                      <div className="label">
                        {focusTiming?.isActive ? 'זמן שחלף' : focusTiming?.isUpcoming ? 'זמן עד ההתחלה' : 'משך מתוכנן'}
                      </div>
                      <div className="info-value">
                        {focusTiming?.isActive
                          ? formatDurationLabel(focusTiming.elapsedMs)
                          : focusTiming?.isUpcoming
                            ? formatDurationLabel(focusTiming.startsInMs)
                            : formatDurationLabel(focusTiming?.durationMs || 0)}
                      </div>
                    </div>
                  </div>

                  {progressNode}
                  {focusShift.notes ? <div className="note-box"><div className="label">הערות למשמרת</div><div className="list-sub">{focusShift.notes}</div></div> : null}
                  {focusShift.comment ? <div className="note-box"><div className="label">סיבה שנשמרה</div><div className="list-sub">{focusShift.comment}</div></div> : null}
                  {focusTiming?.isActive ? renderNextReplacementBlock(focusShift) : null}
                  {renderFocusActions(focusShift)}
                </>
              ) : (
                <div className="empty-state panel-empty">
                  <div className="section-title">אין כרגע משמרות להצגה</div>
                  <p className="subtitle">המערכת תציג כאן אוטומטית את המשמרת הפעילה או הקרובה ביותר.</p>
                </div>
              )}
            </div>

            <aside className="summary-column">
              <div className="surface summary-surface">
                <div className="eyebrow">סטטוס אישי</div>
                <div className="stats-grid">
                  <div className="stat-tile">
                    <span className="stat-label">משמרות שהושלמו</span>
                    <strong>{profile?.stats?.completed_shifts || 0}</strong>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-label">שעות שבוצעו</span>
                    <strong>{formatHoursLabel(profile?.stats?.completed_hours || 0)}</strong>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-label">משמרות עתידיות</span>
                    <strong>{userDashboard.upcomingCount}</strong>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-label">סה״כ שיבוצים</span>
                    <strong>{userDashboard.totalAssigned}</strong>
                  </div>
                </div>
              </div>

              <div className="surface summary-surface subtle-surface">
                <div className="eyebrow">זמן נוכחי</div>
                <div className="section-title">{currentClock}</div>
                <p className="subtitle">כל ההצגות והחישובים במסך הזה עובדים לפי {timezoneLabel}.</p>
              </div>
            </aside>
          </section>

          <section className="surface timeline-surface">
            <div className="section-head">
              <div>
                <div className="eyebrow">ציר משמרות</div>
                <div className="section-title">מבט מהיר על כל השיבוצים שלך</div>
              </div>
              <span className="meta-pill">{userDashboard.totalAssigned} משמרות במערכת</span>
            </div>

            {normalizedUserShifts.length ? (
              <div className="timeline-list">
                {normalizedUserShifts.map((shift) => renderUserShiftCard(shift))}
              </div>
            ) : (
              <div className="empty-state panel-empty">
                <div className="section-title">עדיין אין היסטוריית משמרות</div>
                <p className="subtitle">ברגע שתשובץ למשמרת, היא תופיע כאן יחד עם הסטטוס והזמנים שלה.</p>
              </div>
            )}
          </section>

          <section className="surface leaderboard-surface">
            <div className="section-head">
              <div>
                <div className="eyebrow">דירוג עולמי</div>
                <div className="section-title">טופ שעות של כל האנשים במערכת</div>
              </div>
              <span className="meta-pill">{leaderboard.length} משתתפים</span>
            </div>

            {currentLeaderboardUser ? (
              <div className="leaderboard-hero">
                <div>
                  <div className="label">המיקום שלך</div>
                  <div className="leaderboard-self-rank">#{currentLeaderboardUser.rank}</div>
                </div>
                <div className="leaderboard-self-copy">
                  <div className="list-main">{personName(currentLeaderboardUser)}</div>
                  <div className="list-sub">
                    {formatHoursLabel(currentLeaderboardUser.completed_hours)} שעות · {currentLeaderboardUser.completed_shifts} משמרות
                  </div>
                </div>
              </div>
            ) : null}

            {leaderboard.length ? (
              <div className="leaderboard-list">
                {leaderboard.slice(0, 3).map((entry) => renderLeaderboardRow(entry))}
                {leaderboard.length > 3 ? (
                  <div className="leaderboard-divider">המשך הדירוג</div>
                ) : null}
                {leaderboard.slice(3).map((entry) => renderLeaderboardRow(entry, entry.is_current_user))}
              </div>
            ) : (
              <div className="empty-state panel-empty">
                <div className="section-title">עדיין אין דירוג</div>
                <p className="subtitle">הדירוג יתמלא אוטומטית אחרי שיושלמו משמרות במערכת.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {mode === 'admin' ? (
        <div className="view-shell fade-in">
          <div className="topbar">
            <BrandLockup compact />
            <div className="actions topbar-actions">
              <button className="secondary" onClick={() => syncCalendarToDateKey(todayKey)}>היום</button>
              <button className="secondary" onClick={() => setMode('select')}>חזרה</button>
            </div>
          </div>

          <section className="card admin-header-card">
            <div className="admin-header-main">
              <div>
                <div className="eyebrow">כניסת מנהל</div>
                <div className="page-title">יומן משמרות</div>
                <p className="admin-header-copy">
                  לחץ על יום בלוח כדי לפתוח חלון פעולות, ליצור משמרת חדשה ולטפל במה שדורש מענה.
                </p>
              </div>
              <div className="actions admin-header-actions">
                <button onClick={() => openCreateShiftOverlay(selectedDate || todayKey)}>משמרת חדשה</button>
                <button className="secondary" onClick={refreshAdminCalendar}>רענן</button>
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
                <div className="overview-label">היום שנבחר</div>
                <div className="overview-value">{selectedDayStats.total}</div>
              </div>
            </div>
          </section>

          <section className="card admin-calendar-card">
            <div className="calendar-toolbar">
              <button className="secondary" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}>
                חודש קודם
              </button>
              <button className="secondary" onClick={() => {
                setCalendarDate(getCurrentIsraelCalendarMonth(referenceNow, timezoneLabel))
                syncCalendarToDateKey(todayKey)
              }}>
                חזור להיום
              </button>
              <button className="secondary" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}>
                חודש הבא
              </button>
            </div>

            <div className="calendar-title">{formatMonthTitle(calendarDate)}</div>
            <div className="calendar-caption">
              ירוק = יום סגור, אדום = יום עם בעיות, המספר הקטן מציג כמה משמרות יש ביום.
            </div>

            <div className="calendar-grid">
              {WEEKDAYS.map((day) => (
                <div key={day} className="calendar-weekday">{day}</div>
              ))}

              {monthCells.map(({ dateObj, muted }) => {
                const dateKey = formatDateKey(dateObj)
                const dayStats = getCalendarDayStats(dateKey)
                const isToday = dateKey === todayKey
                const isSelected = selectedDate === dateKey
                const hasShifts = dayStats.total > 0

                return (
                  <button
                    key={`${dateKey}-${muted ? 'muted' : 'live'}`}
                    className={`calendar-day ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasShifts ? 'has-shifts' : ''}`}
                    onClick={() => openDayOverlay(dateKey)}
                  >
                    <div className="calendar-day-top">
                      <div className="calendar-day-number">{dateObj.getDate()}</div>
                      {hasShifts ? <span className="calendar-day-count">{dayStats.total}</span> : null}
                    </div>
                    <div className="calendar-day-summary">
                      {dayStats.fullyConfirmed > 0 ? <span className="calendar-mini-number ok">{dayStats.fullyConfirmed}</span> : <span />}
                      {dayStats.withProblems > 0 ? <span className="calendar-mini-number problem">{dayStats.withProblems}</span> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="card day-focus-card">
            <div className="day-focus-head">
              <div>
                <div className="subtitle">פוקוס נוכחי</div>
                <div className="page-title">{formatHumanDate(selectedDate)}</div>
              </div>
              <div className="actions day-focus-actions">
                <button onClick={() => openDayOverlay(selectedDate)}>פתח את היום</button>
                <button className="secondary" onClick={() => openCreateShiftOverlay(selectedDate)}>הוסף משמרת</button>
              </div>
            </div>

            <div className="stat-line">
              <span className="mini-stat">משמרות {selectedDayStats.total}</span>
              <span className="mini-stat success-text">סגורות {selectedDayStats.fullyConfirmed}</span>
              <span className="mini-stat warning-text">דורשות טיפול {selectedDayStats.withProblems}</span>
            </div>

            {selectedDayShifts.length ? (
              <div className="day-preview-list">
                {selectedDayShifts.slice(0, 3).map((shift) => renderAdminShiftCard(shift, true))}
              </div>
            ) : (
              <div className="empty-state panel-empty">
                <div className="page-title">אין משמרות ביום הזה</div>
                <p>לחץ על "הוסף משמרת" כדי לפתוח את היום ישירות מהלוח.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {overlay ? (
        <div className="overlay-backdrop" onClick={() => setOverlay(null)}>
          <div
            className={`overlay-panel ${overlay.type === 'shift-details' || overlay.type === 'assign-users' ? 'overlay-panel-wide' : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            {overlay.type === 'decline-reason' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">עדכון תגובה</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                    <div className="subtitle">כדי לעדכן שאינך מגיע, צריך לצרף סיבה קצרה וברורה.</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="modal-fields">
                  <div>
                    <div className="label">סיבה</div>
                    <textarea
                      value={noReason}
                      onChange={(event) => setNoReason(event.target.value)}
                      placeholder="כתוב כאן את הסיבה לאי ההגעה"
                    />
                  </div>
                </div>

                <div className="overlay-actions-bar">
                  <button className="danger" onClick={() => respondToShift(overlay.shift.id, 'no', noReason)}>שלח</button>
                  <button className="secondary" onClick={() => setOverlay(null)}>ביטול</button>
                </div>
              </>
            ) : null}

            {overlay.type === 'change-response' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">שינוי תגובה</div>
                    <div className="overlay-title">{overlay.shift.title}</div>
                    <div className="subtitle">אפשר לעדכן את התגובה שלך למשמרת מכל מצב.</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="actions">
                  <button className="success" onClick={() => respondToShift(overlay.shift.id, 'yes')}>אני מגיע</button>
                  <button className="warning" onClick={() => respondToShift(overlay.shift.id, 'maybe')}>לא בטוח</button>
                  <button className="danger" onClick={() => openDeclineOverlay(overlay.shift)}>לא מגיע</button>
                </div>

                <div className="overlay-actions-bar">
                  <button className="secondary" onClick={() => setOverlay(null)}>סגור</button>
                </div>
              </>
            ) : null}

            {overlay.type === 'day' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">ניהול יום</div>
                    <div className="overlay-title">{formatHumanDate(overlay.dateKey)}</div>
                    <div className="subtitle">
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
            ) : null}

            {overlay.type === 'create-shift' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">יצירת משמרת</div>
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

                  <div className="modal-grid">
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
            ) : null}

            {overlay.type === 'edit-shift' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">עריכת משמרת</div>
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

                  <div className="modal-grid">
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
            ) : null}

            {overlay.type === 'shift-details' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">פרטי משמרת</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                    <div className="subtitle">
                      {overlay.shift?.shift_date} · {overlay.shift?.start_time} - {overlay.shift?.end_time}
                    </div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                {overlay.shift?.notes ? <div className="note-box"><div className="label">הערות</div><div className="list-sub">{overlay.shift.notes}</div></div> : null}

                <div className="overlay-actions-bar">
                  <button className="secondary" onClick={() => openAssignUsersOverlay(overlay.shift.id)}>שבץ</button>
                  <button className="secondary" onClick={() => openEditShiftOverlay(overlay.shift)}>ערוך</button>
                  <button className="secondary" onClick={() => openDayOverlay(overlay.shift.shift_date)}>חזור ליום</button>
                </div>

                <div className="overlay-body-stack">
                  {overlayPeople.length ? (
                    overlayPeople.map((person, index) => renderAssignedPersonCard(person, index))
                  ) : (
                    <div className="empty-state">
                      <h3>אין אנשים משויכים</h3>
                      <p>אפשר לצרף אנשים למשמרת ישירות מהמסך הזה.</p>
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {overlay.type === 'assign-users' ? (
              <>
                <div className="overlay-header">
                  <div>
                    <div className="eyebrow">שיבוץ משתמשים</div>
                    <div className="overlay-title">{overlay.shift?.title}</div>
                  </div>
                  <button className="overlay-close" onClick={() => setOverlay(null)}>×</button>
                </div>

                <div className="checkbox-list">
                  {overlayUsers.length ? (
                    overlayUsers.map((user) => renderAssignableUserCard(user))
                  ) : (
                    <div className="empty-state">
                      <h3>אין משתמשים זמינים</h3>
                      <p>צריך קודם לאשר משתמשים במערכת כדי לשבץ אותם למשמרות.</p>
                    </div>
                  )}
                </div>

                <div className="overlay-actions-bar">
                  <button onClick={assignUsersToShift}>שמור שיבוץ</button>
                  <button className="secondary" onClick={() => openShiftDetailsOverlay(overlay.shift.id)}>חזור לפרטים</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
