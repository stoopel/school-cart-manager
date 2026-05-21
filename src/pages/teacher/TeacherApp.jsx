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

  async function act(update) {
    setBusy(true)
    await supabase.from('lessons').update(update).eq('id', lesson.id)
    setBusy(false); onRefresh()
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

    const { data: code, error: codeErr } = await supabase.rpc('generate_lesson_code')
    if (codeErr || !code) { alert('שגיאה בייצור קוד'); setSaving(false); return }

    let startDt
    if (startMode === 'now') {
      startDt = new Date()
    } else {
      const [h, m] = startTime.split(':').map(Number)
      startDt = new Date()
      startDt.setHours(h, m, 0, 0)
      if (startDt < new Date()) startDt.setDate(startDt.getDate() + 1) // מחר
    }
    const endDt = new Date(startDt.getTime() + duration * 60000)
    const status = startMode === 'now' ? 'active' : 'scheduled'

    const { error } = await supabase.from('lessons').insert({
      teacher_id:       teacher.id,
      lesson_code:      code,
      subject:          subject.trim() || null,
      duration_minutes: duration,
      start_time:       startDt.toISOString(),
      end_time:         endDt.toISOString(),
      status,
    })
    setSaving(false)
    if (error) { alert('שגיאה: ' + error.message); return }
    setNewCode(code)
    onCreated()
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

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('verify_teacher_id', { entered_id: id.trim() })
    setLoading(false)
    if (rpcError || !data || !data.is_valid) { setError('תעודת זהות לא נמצאה במערכת.'); return }
    onLogin({ id: data.teacher_id, name: data.teacher_name })
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
    const { data } = await supabase
      .from('teacher_lessons')
      .select('*')
      .eq('teacher_id', teacher.id)
      .order('start_time')
    setLessons(data ?? [])
    setLoading(false)
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
