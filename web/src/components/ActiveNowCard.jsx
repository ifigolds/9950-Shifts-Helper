import ShiftMissionDrone from './ShiftMissionDrone'

export default function ActiveNowCard({ activeNow, personName, currentUserId, onOpenMission }) {
  const primaryShift = activeNow[0] || null

  return (
    <div className="mode-card mode-card-status">
      <strong>עכשיו במשמרת</strong>
      {activeNow.length ? (
        <>
          <div className="mode-card-list">
            {activeNow.slice(0, 3).map((shift) => (
              <div key={`active-shift-${shift.shift_id}`} className="mode-card-list-item">
                <div className="mode-card-active-names">
                  {shift.people?.map((person) => personName(person)).join(' · ') || 'ללא שמות'}
                </div>
              </div>
            ))}
          </div>

          {primaryShift ? (
            <ShiftMissionDrone
              compact
              shift={primaryShift}
              personName={personName}
              currentUserId={currentUserId}
              onOpen={() => onOpenMission(primaryShift)}
            />
          ) : null}
        </>
      ) : (
        <div className="mode-card-count">אין כרגע משמרת פעילה</div>
      )}
    </div>
  )
}
