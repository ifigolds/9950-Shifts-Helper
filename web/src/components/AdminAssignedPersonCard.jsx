export default function AdminAssignedPersonCard({
  person,
  index,
  statusText,
  statusBadgeClass,
  openTelegramChat,
  copyText,
  onUnassign,
  unassigningKey,
  onStatusChange,
  statusUpdatingKey,
}) {
  const personKey = `${person.user_id}-${index}`
  const isUnassigning = unassigningKey === personKey
  const isStatusUpdating = statusUpdatingKey === personKey

  return (
    <div className="list-item person-card">
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

      <div className="note-box admin-status-box">
        <div className="label">עדכון הגעה על ידי מנהל</div>
        <div className="actions compact-actions">
          <button
            className="success"
            disabled={isStatusUpdating || person.status === 'yes'}
            onClick={() => onStatusChange(person, personKey, 'yes')}
          >
            מגיע
          </button>
          <button
            className="warning"
            disabled={isStatusUpdating || person.status === 'maybe'}
            onClick={() => onStatusChange(person, personKey, 'maybe')}
          >
            לא בטוח
          </button>
          <button
            className="danger"
            disabled={isStatusUpdating || person.status === 'no'}
            onClick={() => onStatusChange(person, personKey, 'no')}
          >
            לא מגיע
          </button>
          <button
            className="secondary"
            disabled={isStatusUpdating || person.status === 'pending'}
            onClick={() => onStatusChange(person, personKey, 'pending')}
          >
            ממתין
          </button>
        </div>
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

        {person.username ? (
          <button className="secondary" onClick={() => copyText(person.username)}>העתק username</button>
        ) : null}

        <button
          className="danger"
          disabled={isUnassigning}
          onClick={() => onUnassign(person, personKey)}
        >
          {isUnassigning ? 'מסיר...' : 'הסר מהמשמרת'}
        </button>
      </div>
    </div>
  )
}
