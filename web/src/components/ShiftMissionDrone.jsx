import { useEffect, useMemo, useRef, useState } from 'react'
import './ShiftMissionDrone.css'

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

    window.clearInterval(currentAudio.intervalId)
    currentAudio.timeoutIds?.forEach((timeoutId) => window.clearTimeout(timeoutId))
    currentAudio.nodes.forEach((node) => {
      try {
        node.stop?.()
      } catch {
        // Oscillators may already be stopped.
      }
      node.disconnect?.()
    })
    currentAudio.context.close?.()
  }

  function playLofi() {
    if (audioRef.current) {
      return
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) {
      return
    }

    const context = new AudioContextClass()
    const master = context.createGain()
    const filter = context.createBiquadFilter()
    const delay = context.createDelay()
    const feedback = context.createGain()
    const noiseGain = context.createGain()
    const bassGain = context.createGain()
    const nodes = [master, filter, delay, feedback]
    const timeoutIds = []

    master.gain.value = 0.048
    filter.type = 'lowpass'
    filter.frequency.value = 1450
    delay.delayTime.value = 0.34
    feedback.gain.value = 0.18
    noiseGain.gain.value = 0.012
    bassGain.gain.value = 0.18

    master.connect(filter)
    filter.connect(context.destination)
    filter.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(context.destination)
    bassGain.connect(master)
    noiseGain.connect(filter)

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const noiseData = noiseBuffer.getChannelData(0)
    for (let index = 0; index < noiseData.length; index += 1) {
      noiseData[index] = (Math.random() * 2 - 1) * 0.18
    }

    const vinylNoise = context.createBufferSource()
    vinylNoise.buffer = noiseBuffer
    vinylNoise.loop = true
    vinylNoise.connect(noiseGain)
    vinylNoise.start()
    nodes.push(noiseGain, bassGain, vinylNoise)

    // Warm seventh/ninth voicings with a small swing offset: simple, jazzy and unobtrusive.
    const progression = [
      { bass: 110, chord: [261.63, 329.63, 392, 493.88] },
      { bass: 98, chord: [246.94, 293.66, 369.99, 440] },
      { bass: 87.31, chord: [220, 261.63, 329.63, 392] },
      { bass: 92.5, chord: [233.08, 277.18, 349.23, 415.3] },
    ]
    let step = 0

    function playTone(frequency, startAt, duration, type, gainNode, peak = 0.22) {
      const oscillator = context.createOscillator()
      const voiceGain = context.createGain()

      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, startAt)
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 5, startAt)
      voiceGain.gain.setValueAtTime(0.0001, startAt)
      voiceGain.gain.linearRampToValueAtTime(peak, startAt + 0.08)
      voiceGain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)

      oscillator.connect(voiceGain)
      voiceGain.connect(gainNode)
      oscillator.start(startAt)
      oscillator.stop(startAt + duration + 0.08)
      nodes.push(oscillator, voiceGain)
    }

    function playDustTap(startAt, accent = 1) {
      const tap = context.createBufferSource()
      const tapGain = context.createGain()
      const tapBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.04), context.sampleRate)
      const tapData = tapBuffer.getChannelData(0)

      for (let index = 0; index < tapData.length; index += 1) {
        tapData[index] = (Math.random() * 2 - 1) * (1 - index / tapData.length)
      }

      tap.buffer = tapBuffer
      tapGain.gain.setValueAtTime(0.018 * accent, startAt)
      tapGain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.05)
      tap.connect(tapGain)
      tapGain.connect(filter)
      tap.start(startAt)
      tap.stop(startAt + 0.06)
      nodes.push(tap, tapGain)
    }

    function scheduleBar() {
      const barStart = context.currentTime + 0.02
      const chord = progression[step % progression.length]
      step += 1

      chord.chord.forEach((frequency, index) => {
        playTone(frequency, barStart + index * 0.012, 2.75, index === 0 ? 'triangle' : 'sine', master, 0.18)
      })

      playTone(chord.bass, barStart, 0.82, 'triangle', bassGain, 0.28)
      playTone(chord.bass * 1.5, barStart + 1.62, 0.56, 'sine', bassGain, 0.16)
      playDustTap(barStart + 0.02, 1.2)
      playDustTap(barStart + 0.82, 0.55)
      playDustTap(barStart + 1.62, 0.9)
      playDustTap(barStart + 2.42, 0.5)
    }

    scheduleBar()
    const swingStartId = window.setTimeout(scheduleBar, 3200)
    timeoutIds.push(swingStartId)
    const intervalId = window.setInterval(scheduleBar, 6400)

    audioRef.current = {
      context,
      intervalId,
      timeoutIds,
      nodes,
    }
    setIsLofiPlaying(true)
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
