import { useEffect, useMemo, useRef, useState } from 'react'
import './ShiftMissionDrone.css'

const LOFI_TRACK_SRC = '/audio/lofi-jazz-loop.wav'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function formatDuration(ms) {
  const safeMs = Math.max(0, ms || 0)
  const totalMinutes = Math.floor(safeMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

function getMissionPhase(progress) {
  if (progress >= 1) return 'המשמרת הושלמה'
  if (progress >= 0.75) return 'לקראת סיום'
  if (progress >= 0.5) return 'עברנו את האמצע'
  if (progress >= 0.25) return 'בטיסה יציבה'
  return 'תחילת מסלול'
}

function getMissionMetrics(shift, clientNowMs) {
  const timing = shift?.timing || {}
  const startMs = Date.parse(timing.start_iso)
  const endMs = Date.parse(timing.end_iso)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      progress: 0,
      elapsedMs: 0,
      remainingMs: 0,
      durationMs: 0,
    }
  }

  const durationMs = endMs - startMs
  const elapsedMs = clamp(clientNowMs - startMs, 0, durationMs)
  const progress = clamp(elapsedMs / durationMs, 0, 1)

  return {
    progress,
    elapsedMs,
    remainingMs: Math.max(0, durationMs - elapsedMs),
    durationMs,
  }
}

function getPeopleNames(shift, personName) {
  return (shift?.people || [])
    .map((person) => personName(person))
    .filter(Boolean)
}

function DroneSvg({ compact = false }) {
  return (
    <div className={`mission-drone ${compact ? 'mission-drone-compact' : ''}`} aria-hidden="true">
      <span className="drone-prop prop-a" />
      <span className="drone-prop prop-b" />
      <span className="drone-prop prop-c" />
      <span className="drone-prop prop-d" />
      <span className="drone-arm arm-a" />
      <span className="drone-arm arm-b" />
      <span className="drone-body">
        <span className="drone-camera" />
      </span>
    </div>
  )
}

export default function ShiftMissionDrone({ shift, personName, compact = false, onOpen }) {
  const missionRef = useRef(null)
  const audioRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLofiPlaying, setIsLofiPlaying] = useState(false)
  const serverNowMs = Date.parse(shift?.timing?.now_iso || '')
  const clientMountedAtRef = useRef(Date.now())
  const serverMountedAtRef = useRef(Number.isFinite(serverNowMs) ? serverNowMs : Date.now())
  const [nowMs, setNowMs] = useState(serverMountedAtRef.current)
  const peopleNames = useMemo(() => getPeopleNames(shift, personName), [shift, personName])

  useEffect(() => {
    const nextServerNowMs = Date.parse(shift?.timing?.now_iso || '')
    clientMountedAtRef.current = Date.now()
    serverMountedAtRef.current = Number.isFinite(nextServerNowMs) ? nextServerNowMs : Date.now()
    setNowMs(serverMountedAtRef.current)
  }, [shift?.shift_id, shift?.timing?.now_iso])

  useEffect(() => {
    let frameId = 0

    function tick() {
      const clientDelta = Date.now() - clientMountedAtRef.current
      setNowMs(serverMountedAtRef.current + clientDelta)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === missionRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => () => {
    stopLofi(false)
  }, [])

  function stopLofi(updateState = true) {
    const currentAudio = audioRef.current
    audioRef.current = null
    if (updateState) {
      setIsLofiPlaying(false)
    }

    if (!currentAudio) {
      return
    }

    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio.src = ''
    currentAudio.load?.()
  }

  function playLofi() {
    if (audioRef.current) {
      return
    }

    const audio = new Audio(LOFI_TRACK_SRC)
    audio.loop = true
    audio.volume = 0.42
    audioRef.current = audio

    audio
      .play()
      .then(() => {
        setIsLofiPlaying(true)
      })
      .catch(() => {
        audioRef.current = null
        setIsLofiPlaying(false)
      })
  }

  async function enterFullscreenWithLofi() {
    if (compact) {
      onOpen?.()
      return
    }

    playLofi()
    setIsFullscreen(true)

    try {
      if (missionRef.current?.requestFullscreen) {
        await missionRef.current.requestFullscreen()
      }
    } catch {
      setIsFullscreen(true)
    }
  }

  async function exitFullscreen() {
    setIsFullscreen(false)

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch {
      setIsFullscreen(false)
    }
  }

  function toggleLofi() {
    if (isLofiPlaying) {
      stopLofi()
      return
    }

    playLofi()
  }

  const metrics = getMissionMetrics(shift, nowMs)
  const progressPercent = Math.round(metrics.progress * 100)
  const phase = getMissionPhase(metrics.progress)
  const droneLeft = compact
    ? `${clamp(14 + metrics.progress * 58, 14, 72)}%`
    : `${clamp(7 + metrics.progress * 78, 7, 85)}%`
  const targetPulse = 0.35 + metrics.progress * 1.15

  const rootStyle = {
    '--mission-progress': metrics.progress,
    '--drone-left': droneLeft,
    '--target-pulse': targetPulse,
  }

  const content = (
    <>
      <div className="mission-sky">
        <span className="mission-cloud cloud-a" />
        <span className="mission-cloud cloud-b" />
        <span className="mission-cloud cloud-c" />
        <span className="mission-ridge ridge-a" />
        <span className="mission-ridge ridge-b" />
        <span className="mission-grid" />
        <span className="mission-scanline" />
      </div>

      <div className="mission-target" aria-hidden="true">
        <span />
      </div>

      <div className="mission-route" aria-hidden="true">
        <span className="route-line route-line-total" />
        <span className="route-line route-line-complete" />
        <span className="route-dot route-start" />
        <span className="route-dot route-mid" />
        <span className="route-dot route-end" />
        <span className="route-label route-label-start">תחילת המשמרת</span>
        <span className="route-label route-label-now">כאן הרחפן עכשיו</span>
        <span className="route-label route-label-end">סיום</span>
      </div>

      <div className="mission-drone-track">
        <DroneSvg compact={compact} />
      </div>

      <div className="mission-hud">
        <div className="mission-hud-top">
          <div>
            <span className="mission-kicker">משימת FPV למשמרת</span>
            <strong>{peopleNames.join(' · ') || 'אין צוות משויך'}</strong>
          </div>
          <span className={`mission-status ${metrics.progress >= 1 ? 'complete' : ''}`}>{phase}</span>
        </div>

        {!compact ? (
          <div className="mission-hud-grid">
            <span>זמן שעבר <strong>{formatDuration(metrics.elapsedMs)}</strong></span>
            <span>זמן שנשאר <strong>{formatDuration(metrics.remainingMs)}</strong></span>
            <span>מסלול שהושלם <strong>{progressPercent}%</strong></span>
          </div>
        ) : (
          <div className="mission-compact-meta">
            <span>{progressPercent}% מהמסלול</span>
            <span>{formatDuration(metrics.elapsedMs)} עברו</span>
          </div>
        )}
      </div>

      {metrics.progress >= 1 ? (
        <div className="mission-complete">
          <span>המשימה הושלמה</span>
        </div>
      ) : null}
    </>
  )

  if (compact) {
    return (
      <button
        type="button"
        className="shift-mission shift-mission-compact"
        style={rootStyle}
        onClick={onOpen}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      ref={missionRef}
      className={`shift-mission shift-mission-full ${isFullscreen ? 'shift-mission-expanded' : ''}`}
      style={rootStyle}
    >
      {content}
      <div className="mission-controls">
        <button type="button" onClick={enterFullscreenWithLofi}>
          מסך מלא + לופיי
        </button>
        <button type="button" onClick={toggleLofi}>
          {isLofiPlaying ? 'עצור לופיי' : 'נגן לופיי'}
        </button>
        {isFullscreen ? (
          <button type="button" onClick={exitFullscreen}>יציאה</button>
        ) : null}
      </div>
    </div>
  )
}
