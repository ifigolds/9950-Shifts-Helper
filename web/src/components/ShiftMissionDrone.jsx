import { useEffect, useMemo, useRef, useState } from 'react'
import './ShiftMissionDrone.css'

const TOTAL_DISTANCE_KM = 8
const MIN_BATTERY = 18

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

function getBatteryPercent(progress) {
  return Math.round(100 - (100 - MIN_BATTERY) * clamp(progress, 0, 1))
}

function getDistanceKm(progress) {
  return Math.max(0, TOTAL_DISTANCE_KM * (1 - clamp(progress, 0, 1))).toFixed(1)
}

function getMissionPhase(progress) {
  if (progress >= 1) return 'LANDED'
  if (progress >= 0.75) return 'TARGET LOCKED'
  if (progress >= 0.5) return 'FINAL VECTOR'
  if (progress >= 0.25) return 'CRUISE'
  return 'TAKEOFF'
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

  const metrics = getMissionMetrics(shift, nowMs)
  const progressPercent = Math.round(metrics.progress * 100)
  const battery = getBatteryPercent(metrics.progress)
  const distance = getDistanceKm(metrics.progress)
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

      <div className="mission-drone-track">
        <DroneSvg compact={compact} />
      </div>

      <div className="mission-hud">
        <div className="mission-hud-top">
          <div>
            <span className="mission-kicker">FPV SHIFT MISSION</span>
            <strong>{peopleNames.join(' · ') || 'No pilot assigned'}</strong>
          </div>
          <span className={`mission-status ${phase === 'LANDED' ? 'complete' : ''}`}>{phase}</span>
        </div>

        {!compact ? (
          <div className="mission-hud-grid">
            <span>ELAPSED <strong>{formatDuration(metrics.elapsedMs)}</strong></span>
            <span>ETA <strong>{formatDuration(metrics.remainingMs)}</strong></span>
            <span>MISSION <strong>{progressPercent}%</strong></span>
            <span>BATTERY <strong>{battery}%</strong></span>
            <span>DISTANCE <strong>{distance} KM</strong></span>
            <span>SIGNAL <strong>{metrics.progress >= 0.75 ? 'LOCKED' : 'SEARCHING'}</strong></span>
          </div>
        ) : (
          <div className="mission-compact-meta">
            <span>{progressPercent}%</span>
            <span>{distance} km</span>
            <span>{battery}%</span>
          </div>
        )}
      </div>

      {metrics.progress >= 1 ? (
        <div className="mission-complete">
          <span>MISSION COMPLETE</span>
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
    <div className="shift-mission shift-mission-full" style={rootStyle}>
      {content}
    </div>
  )
}
