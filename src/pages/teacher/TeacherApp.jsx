import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ── Helpers ───────────────────────────────────────────────────
function fmtCountdown(seconds) {
  if (seconds <= 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtTimeUntil(seconds) {
  if (seconds <= 0) return 'מתחיל עכשיו'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `מתחיל בעוד ${m} דק'`
  const h = Math.floor(m / 60), rm = m % 60
  return `מתחיל בעוד ${h}ש' ${rm > 0 ? rm + 'ד' : ''}`
}

function useNow() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

// ── Quick time options ─────────────────────────────────────────
function quickTimes() {
  const now = new Date()
  const times = []
  const base = new Date(now)
  base.setSeconds(0, 0)
  for (const addMin of [15, 30, 45, 60, 75, 90]) {
    const t = new Date(base.getTime() + addMin * 60000)
    times.push({
      label: t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      value: t.toTimeString().slice(0, 5),
      addMin,
    })
  }
  return times
}

// ── Lesson Card ────────────────────────────────────────────────
function LessonCard({ lesson, now, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [preAssigned, setPreAssigned] = useState([])
  const [loadingAssign, setLoadingAssign] = useState(false)

  const isScheduled = lesson.status === 'scheduled'
  const startTs = new Date(lesson.start_time).getTime()
  const endTs   = new Date(lesson.end_time).getTime()
  const nowTs   = now.getTime()
  const secUntilStart = (startTs - nowTs) / 1000
  const secRemaining  = (endTs   - nowTs) / 1000

  // אם שיעור מתוכנן הגיע הזמן שלו → הפעל אוטומטית
  useEffect(() => {
    if (isScheduled && secUntilStart <= 0) {
      supabase.from('lessons').update({ status: 'active' }).eq('id', lesson.id)
        .then(() => onRefresh())
    }
  }, [isScheduled, secUntilStart <= 0])

  const loadAssignments = useCallback(async () => {
    setLoadingAssign(true)
    const { data: lpa } = await supabase
      .from('lesson_pre_assignments')
      .select('student_id, students(name, class_name)')
      .eq('lesson_id', lesson.id)

    const { data: lp } = await supabase
      .from('lesson_participants')
      .select('student_id')
      .eq('lesson_id', lesson.id)

    const participantSet = new Set(lp?.map(p => p.student_id) ?? [])
    
    setPreAssigned((lpa ?? []).map(item => ({
      student_id: item.student_id,
      name: item.students?.name ?? 'תלמיד',
      class_name: item.students?.class_name ?? '',
      isPresent: participantSet.has(item.student_id)
    })))
    setLoadingAssign(false)
  }, [lesson.id])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  // Realtime update when students join the lesson
  useEffect(() => {
    const channel = supabase
      .channel(`lesson-participants-${lesson.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_participants', filter: `lesson_id=eq.${lesson.id}` }, () => {
        loadAssignments()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [lesson.id, loadAssignments])

  async function act(update) {
    setBusy(true)
    try {
      await fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          lessonId: lesson.id,
          status: update.status,
          isLocked: update.is_locked
        })
      })
    } catch (e) {
      console.error('Error updating lesson:', e)
    } finally {
      setBusy(false)
      onRefresh()
    }
  }

  async function extendLesson(minutes) {
    setBusy(true)
    try {
      const currentEndTime = new Date(lesson.end_time)
      const newEndTime = new Date(currentEndTime.getTime() + minutes * 60000)
      const newDuration = (lesson.duration_minutes || 45) + minutes
      await fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          lessonId: lesson.id,
          endTime: newEndTime.toISOString(),
          durationMinutes: newDuration
        })
      })
    } catch (e) {
      console.error('Error extending lesson:', e)
    } finally {
      setBusy(false)
      onRefresh()
    }
  }

  const color  = isScheduled ? '#6366f1' : secRemaining < 300 ? '#f97316' : '#22c55e'
  const border = isScheduled ? 'rgba(99,102,241,0.4)' : 'rgba(34,197,94,0.4)'

  return (
    <div style={{
      background: '#0d1526',
      border: `2px solid ${border}`,
      borderRadius: 20, padding: 24, position: 'relative',
    }}>
      {/* Status pill */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        background: isScheduled ? 'rgba(99,102,241,0.2)' : 'rgba(34,197,94,0.15)',
        color, borderRadius: 20, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700,
      }}>
        {isScheduled ? '🕐 מתוכנן' : '▶️ פעיל'}
      </div>

      {/* Subject */}
      <div style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: 4, marginTop: 4 }}>
        {lesson.subject || 'שיעור'}
      </div>

      {/* Code */}
      <div style={{
        fontFamily: 'monospace', fontSize: isScheduled ? '2rem' : '3rem',
        fontWeight: 900, color: isScheduled ? '#6366f1' : '#f1f5f9',
        letterSpacing: '0.3em', marginBottom: 8,
        opacity: isScheduled ? 0.7 : 1,
      }}>
        {lesson.lesson_code}
      </div>

      {/* Timer */}
      <div style={{ marginBottom: 16 }}>
        {isScheduled ? (
          <span style={{ color: '#6366f1', fontSize: '1rem' }}>
            {fmtTimeUntil(secUntilStart)}
            <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginRight: 8 }}>
              ({new Date(lesson.start_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})
            </span>
          </span>
        ) : (
          <span style={{ color, fontSize: '1.4rem', fontFamily: 'monospace', fontWeight: 700 }}>
            {fmtCountdown(secRemaining)}
            <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginRight: 8 }}>נשאר</span>
          </span>
        )}
      </div>

      {/* Progress bar – only for active */}
      {!isScheduled && (
        <div style={{ height: 4, background: '#1e2d4a', borderRadius: 2, marginBottom: 16 }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${Math.min(100, ((nowTs - startTs) / (endTs - startTs)) * 100)}%`,
            background: secRemaining < 300 ? '#f97316' : '#6366f1',
            transition: 'width 1s linear',
          }} />
        </div>
      )}

      {/* Participant count */}
      <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 16 }}>
        👥 {lesson.participant_count ?? 0} מחשבים מחוברים
      </div>

      {/* Actions */}
      {!isScheduled && (
        <>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => act({ is_locked: !lesson.is_locked })}
              disabled={busy}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'Heebo,sans-serif',
                background: lesson.is_locked ? '#6366f1' : 'rgba(255,255,255,0.07)',
                color: '#f1f5f9',
              }}
            >
              {lesson.is_locked ? '🔓 שחרר' : '🔒 נעל'}
            </button>
            <button
              onClick={() => { if (confirm('לסיים שיעור?')) act({ status: 'ended' }) }}
              disabled={busy}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'Heebo,sans-serif',
                background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
              }}
            >
              ⏹️ סיים
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button
              onClick={() => extendLesson(15)}
              disabled={busy}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 12, border: '1px solid rgba(99,102,241,0.3)',
                cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'Heebo,sans-serif',
                background: 'rgba(99,102,241,0.08)', color: '#a5b4fc',
              }}
            >
              ➕ הארך ב-15 דק'
            </button>
            <button
              onClick={() => extendLesson(30)}
              disabled={busy}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 12, border: '1px solid rgba(99,102,241,0.3)',
                cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'Heebo,sans-serif',
                background: 'rgba(99,102,241,0.08)', color: '#a5b4fc',
              }}
            >
              ➕ הארך ב-30 דק'
            </button>
          </div>
        </>
      )}
      {isScheduled && (
        <button
          onClick={() => { if (confirm('לבטל שיעור מתוכנן זה?')) act({ status: 'cancelled' }) }}
          disabled={busy}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 12, border: 'none',
            cursor: 'pointer', fontWeight: 700, fontFamily: 'Heebo,sans-serif',
            background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: '0.9rem',
          }}
        >
          🗑️ בטל שיעור
        </button>
      )}

      {/* Pre-assign button */}
      <button
        onClick={() => setShowAssignModal(true)}
        style={{
          width: '100%', padding: '10px 0', borderRadius: 12, border: 'none',
          cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'Heebo,sans-serif',
          background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', marginTop: 12
        }}
      >
        👤 שייך כיתה / קבוצה / תלמידים
      </button>

      {/* Live Attendance View */}
      {preAssigned.length > 0 && (
        <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16 }}>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 700, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>📋 נוכחות דיגיטלית חיה</span>
            <span style={{ color: '#22c55e' }}>{preAssigned.filter(p => p.isPresent).length} / {preAssigned.length} נוכחים</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 120, overflowY: 'auto', paddingRight: 4 }}>
            {preAssigned.map(p => (
              <div key={p.student_id} style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 8, padding: '6px 10px',
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: '0.78rem',
              }}>
                <span style={{ color: p.isPresent ? '#22c55e' : '#ef4444', fontSize: '0.8rem' }}>●</span>
                <span style={{ color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }} title={p.name}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign Modal component */}
      {showAssignModal && (
        <PreAssignModal
          lesson={lesson}
          onClose={() => setShowAssignModal(false)}
          onRefresh={loadAssignments}
        />
      )}
    </div>
  )
}

// ── PreAssignModal ─────────────────────────────────────────────
function PreAssignModal({ lesson, onClose, onRefresh }) {
  const [classes, setClasses] = useState([])
  const [groups, setGroups] = useState([])
  const [students, setStudents] = useState([])
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const { data: stuClasses } = await supabase.from('students').select('class_name')
      const classSet = new Set(stuClasses?.map(s => s.class_name).filter(Boolean) ?? [])
      setClasses(Array.from(classSet).sort())

      const { data: grps } = await supabase.from('student_groups').select('id, name').order('name')
      setGroups(grps ?? [])

      const { data: stus } = await supabase.from('students').select('id, name, national_id, class_name').order('name')
      setStudents(stus ?? [])
      setLoading(false)
    }
    loadData()
  }, [])

  async function assignClass(e) {
    e.preventDefault()
    if (!selectedClass) return
    setSaving(true)
    const { data: classStus } = await supabase.from('students').select('id').eq('class_name', selectedClass)
    if (classStus && classStus.length > 0) {
      const records = classStus.map(s => ({ lesson_id: lesson.id, student_id: s.id }))
      await supabase.from('lesson_pre_assignments').upsert(records, { onConflict: 'lesson_id,student_id' })
    }
    setSaving(false)
    onRefresh()
    onClose()
  }

  async function assignGroup(e) {
    e.preventDefault()
    if (!selectedGroup) return
    setSaving(true)
    const { data: groupStus } = await supabase.from('student_group_members').select('student_id').eq('group_id', selectedGroup)
    if (groupStus && groupStus.length > 0) {
      const records = groupStus.map(s => ({ lesson_id: lesson.id, student_id: s.student_id }))
      await supabase.from('lesson_pre_assignments').upsert(records, { onConflict: 'lesson_id,student_id' })
    }
    setSaving(false)
    onRefresh()
    onClose()
  }

  async function assignStudent(e) {
    e.preventDefault()
    if (!selectedStudent) return
    setSaving(true)
    await supabase.from('lesson_pre_assignments').upsert({ lesson_id: lesson.id, student_id: selectedStudent }, { onConflict: 'lesson_id,student_id' })
    setSaving(false)
    onRefresh()
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(5, 8, 16, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20, direction: 'rtl', fontFamily: 'Heebo, sans-serif'
    }}>
      <div style={{
        background: '#0d1526', border: '1.5px solid rgba(99,102,241,0.3)', borderRadius: 20,
        padding: 24, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 20,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ color: '#f1f5f9', margin: 0, fontSize: '1.15rem' }}>👤 שיוך תלמידים לשיעור</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>טוען אפשרויות שיוך...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* Class Option */}
            <form onSubmit={assignClass} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 16 }}>
              <label style={labelStyle}>שייך כיתה שלמה</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1, padding: '10px 12px' }} value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
                  <option value="">-- בחר כיתה --</option>
                  {classes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="submit" disabled={saving || !selectedClass} style={{ ...btnStyle('#6366f1'), width: 'auto', padding: '0 16px', borderRadius: 12, height: 46 }}>שייך כיתה</button>
              </div>
            </form>

            {/* Group Option */}
            <form onSubmit={assignGroup} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 16 }}>
              <label style={labelStyle}>שייך קבוצת למידה</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1, padding: '10px 12px' }} value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
                  <option value="">-- בחר קבוצה --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button type="submit" disabled={saving || !selectedGroup} style={{ ...btnStyle('#6366f1'), width: 'auto', padding: '0 16px', borderRadius: 12, height: 46 }}>שייך קבוצה</button>
              </div>
            </form>

            {/* Individual Student Option */}
            <form onSubmit={assignStudent} style={{ paddingBottom: 8 }}>
              <label style={labelStyle}>שייך תלמיד בודד</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select style={{ ...inputStyle, flex: 1, padding: '10px 12px' }} value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
                  <option value="">-- בחר תלמיד --</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (ת.ז. {s.national_id} {s.class_name ? `| ${s.class_name}` : ''})
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={saving || !selectedStudent} style={{ ...btnStyle('#6366f1'), width: 'auto', padding: '0 16px', borderRadius: 12, height: 46 }}>שייך</button>
              </div>
            </form>

          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{ ...btnStyle('rgba(255,255,255,0.07)'), width: 'auto', padding: '10px 24px', borderRadius: 12 }}>סגור</button>
        </div>
      </div>
    </div>
  )
}

// ── Open Lesson Form ───────────────────────────────────────────
function OpenLessonForm({ teacher, onCreated, onCancel }) {
  const DURATIONS = [30, 45, 60, 90]
  const [subject,  setSubject]  = useState('')
  const [duration, setDuration] = useState(45)
  const [startMode, setStartMode] = useState('now') // 'now' | 'scheduled'
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 45, 0, 0)
    return d.toTimeString().slice(0, 5)
  })
  const [saving, setSaving] = useState(false)
  const [newCode, setNewCode] = useState(null)
  const QUICK = quickTimes()

  async function submit(e) {
    e.preventDefault()
    setSaving(true)

    try {
      const res = await fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          teacherId: teacher.id,
          subject: subject.trim(),
          minutes: duration,
          isLocked
        })
      })
      const json = await res.json()
      setSaving(false)
      if (!res.ok || json.error) {
        alert('שגיאה: ' + (json.error || 'נכשלה יצירת השיעור'))
        return
      }

      setNewCode(json.lesson.lesson_code)
      onCreated()
    } catch (err) {
      setSaving(false)
      alert('שגיאה בחיבור לשרת: ' + err.message)
    }
  }

  if (newCode) return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ color: '#94a3b8', marginBottom: 8, fontSize: '0.9rem' }}>קוד השיעור:</div>
      <div style={{
        fontFamily: 'monospace', fontSize: '4rem', fontWeight: 900,
        color: '#6366f1', letterSpacing: '0.4em', marginBottom: 12,
      }}>{newCode}</div>
      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 24 }}>
        {startMode === 'now'
          ? 'מסור קוד זה לתלמידים – השיעור פעיל עכשיו'
          : `מסור קוד זה לתלמידים – יתחיל ב-${startTime}`}
      </div>
      <button onClick={onCancel} style={btnStyle('#6366f1')}>סגור</button>
    </div>
  )

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Subject */}
      <div>
        <label style={labelStyle}>נושא השיעור (אופציונלי)</label>
        <input
          style={inputStyle}
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="מתמטיקה, עברית, אנגלית..."
        />
      </div>

      {/* Duration */}
      <div>
        <label style={labelStyle}>משך השיעור</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {DURATIONS.map(d => (
            <button key={d} type="button"
              onClick={() => setDuration(d)}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'Heebo,sans-serif',
                background: duration === d ? '#6366f1' : 'rgba(255,255,255,0.07)',
                color: '#f1f5f9',
              }}>
              {d < 60 ? `${d}'` : d === 60 ? 'שעה' : `${d}'`}
            </button>
          ))}
        </div>
      </div>

      {/* Start time */}
      <div>
        <label style={labelStyle}>שעת התחלה</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['now', 'scheduled'].map(m => (
            <button key={m} type="button"
              onClick={() => setStartMode(m)}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontFamily: 'Heebo,sans-serif',
                background: startMode === m ? '#6366f1' : 'rgba(255,255,255,0.07)',
                color: '#f1f5f9',
              }}>
              {m === 'now' ? '▶️ עכשיו' : '🕐 שעה ספציפית'}
            </button>
          ))}
        </div>

        {startMode === 'scheduled' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Quick time chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {QUICK.map(q => (
                <button key={q.value} type="button"
                  onClick={() => setStartTime(q.value)}
                  style={{
                    padding: '8px 14px', borderRadius: 20, border: 'none',
                    cursor: 'pointer', fontFamily: 'Heebo,sans-serif', fontSize: '0.85rem',
                    background: startTime === q.value ? '#6366f1' : 'rgba(255,255,255,0.07)',
                    color: '#f1f5f9', fontWeight: 600,
                  }}>
                  {q.label}
                </button>
              ))}
            </div>
            {/* Manual time input */}
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '1.3rem', textAlign: 'center' }}
            />
          </div>
        )}
      </div>

      {/* Submit */}
      <button type="submit" disabled={saving}
        style={btnStyle('#6366f1')}>
        {saving ? '⏳ פותח...' : startMode === 'now' ? '▶️ פתח שיעור' : '🕐 תכנן שיעור'}
      </button>
      <button type="button" onClick={onCancel}
        style={btnStyle('rgba(255,255,255,0.07)')}>
        ביטול
      </button>
    </form>
  )
}

// ── Style helpers ──────────────────────────────────────────────
const labelStyle = {
  display: 'block', marginBottom: 8,
  color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600,
}
const inputStyle = {
  width: '100%', background: 'rgba(255,255,255,0.05)',
  border: '1.5px solid rgba(99,102,241,0.3)', borderRadius: 12,
  padding: '14px 16px', color: '#f1f5f9',
  fontFamily: 'Heebo,sans-serif', fontSize: '1rem',
  boxSizing: 'border-box',
}
const btnStyle = bg => ({
  width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
  background: bg, color: '#f1f5f9', fontWeight: 700,
  fontSize: '1rem', cursor: 'pointer', fontFamily: 'Heebo,sans-serif',
})

// ── Teacher Login ──────────────────────────────────────────────
function TeacherLogin({ onLogin }) {
  const [id, setId]       = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Check for one-time login token in URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      // Clean URL immediately so token is never saved in browser history
      window.history.replaceState({}, '', window.location.pathname)
      setLoading(true)
      fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem_token', token })
      })
        .then(r => r.json())
        .then(json => {
          setLoading(false)
          if (json.isValid && json.teacher) {
            onLogin({ id: json.teacher.id, name: json.teacher.name })
          } else {
            setError(json.error || 'אסימון הכניסה פג תוקף או שאינו תקין.')
          }
        })
        .catch(err => {
          setLoading(false)
          setError('שגיאה בחיבור לשרת: ' + err.message)
        })
    }
  }, [onLogin])

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', nationalId: id.trim() })
      })
      const json = await res.json()
      setLoading(false)
      if (!res.ok || !json.isValid) {
        setError(json.error || 'תעודת זהות לא נמצאה במערכת.')
        return
      }
      onLogin({ id: json.teacher.id, name: json.teacher.name })
    } catch (err) {
      setLoading(false)
      setError('שגיאה בחיבור לשרת: ' + err.message)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#060d1f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Heebo,sans-serif', direction: 'rtl', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏫</div>
          <h1 style={{ color: '#f1f5f9', fontSize: '1.6rem', margin: 0 }}>פורטל מורים</h1>
          <p style={{ color: '#64748b', marginTop: 8, fontSize: '0.9rem' }}>ניהול שיעורים</p>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>תעודת זהות</label>
            <input
              style={{ ...inputStyle, fontSize: '1.4rem', letterSpacing: '0.1em', textAlign: 'center' }}
              type="number"
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="123456789"
              autoFocus
            />
          </div>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: 12, color: '#fca5a5', textAlign: 'center', fontSize: '0.9rem',
            }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={btnStyle('#6366f1')}>
            {loading ? '⏳ בודק...' : 'כניסה →'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Teacher Dashboard ──────────────────────────────────────────
function TeacherDashboard({ teacher, onLogout }) {
  const [lessons,  setLessons]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const now = useNow()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', teacherId: teacher.id })
      })
      const json = await res.json()
      if (res.ok && json.lessons) {
        setLessons(json.lessons)
      }
    } catch (e) {
      console.error('Error loading lessons:', e)
    } finally {
      setLoading(false)
    }
  }, [teacher.id])

  useEffect(() => { load() }, [load])

  // Realtime – רענון כשמשתנה שיעור
  useEffect(() => {
    const ch = supabase
      .channel(`teacher-${teacher.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load, teacher.id])

  const active    = lessons.filter(l => l.status === 'active')
  const scheduled = lessons.filter(l => l.status === 'scheduled')

  return (
    <div style={{
      minHeight: '100vh', background: '#060d1f',
      fontFamily: 'Heebo,sans-serif', direction: 'rtl',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid rgba(99,102,241,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem' }}>
            👋 שלום, {teacher.name}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
            {active.length > 0 ? `${active.length} שיעורים פעילים` : 'אין שיעורים פעילים'}
          </div>
        </div>
        <button onClick={onLogout} style={{
          background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10,
          padding: '8px 14px', color: '#94a3b8', cursor: 'pointer', fontFamily: 'Heebo,sans-serif',
        }}>
          יציאה
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>

        {/* Open new lesson button */}
        {!showForm && (
          <button onClick={() => setShowForm(true)} style={{
            ...btnStyle('linear-gradient(135deg,#6366f1,#818cf8)'),
            marginBottom: 28, fontSize: '1.1rem', boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
          }}>
            + פתח שיעור חדש
          </button>
        )}

        {/* Open lesson form */}
        {showForm && (
          <div style={{
            background: '#0d1526', borderRadius: 20,
            border: '1px solid rgba(99,102,241,0.3)',
            padding: 24, marginBottom: 28,
          }}>
            <h3 style={{ color: '#f1f5f9', margin: '0 0 20px', fontSize: '1.1rem' }}>
              📚 שיעור חדש
            </h3>
            <OpenLessonForm
              teacher={teacher}
              onCreated={() => { load(); setShowForm(false) }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>טוען...</div>
        ) : (
          <>
            {/* Active lessons */}
            {active.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700,
                              marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  שיעורים פעילים
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {active.map(l => (
                    <LessonCard key={l.id} lesson={l} now={now} onRefresh={load} />
                  ))}
                </div>
              </div>
            )}

            {/* Scheduled lessons */}
            {scheduled.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700,
                              marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  שיעורים מתוכננים
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {scheduled.map(l => (
                    <LessonCard key={l.id} lesson={l} now={now} onRefresh={load} />
                  ))}
                </div>
              </div>
            )}

            {active.length === 0 && scheduled.length === 0 && !showForm && (
              <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📚</div>
                <p>אין שיעורים פעילים</p>
                <p style={{ fontSize: '0.85rem' }}>לחץ "פתח שיעור חדש" כדי להתחיל</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────
export default function TeacherApp() {
  const [teacher, setTeacher] = useState(null)
  if (!teacher) return <TeacherLogin onLogin={setTeacher} />
  return <TeacherDashboard teacher={teacher} onLogout={() => setTeacher(null)} />
}
