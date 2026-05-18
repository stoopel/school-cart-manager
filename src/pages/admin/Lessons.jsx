import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const DURATIONS = [
  { label: '30 דקות',  value: 30 },
  { label: '45 דקות',  value: 45 },
  { label: 'שעה',      value: 60 },
  { label: 'שעה וחצי', value: 90 },
  { label: 'שעתיים',   value: 120 },
]

const EMPTY_FORM = { teacher_id: '', subject: '', duration: 45 }

// ── Countdown component ────────────────────────────────────────
function Countdown({ endTime, isLocked }) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    function calc() {
      const diff = new Date(endTime) - new Date()
      setRemaining(Math.max(0, Math.floor(diff / 1000)))
    }
    calc()
    const t = setInterval(calc, 1000)
    return () => clearInterval(t)
  }, [endTime])

  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  const urgent = remaining < 300 && remaining > 0
  const color = isLocked ? 'var(--warning)' : urgent ? '#f97316' : 'var(--accent)'

  return (
    <span style={{ fontFamily: 'monospace', fontSize: '1.4rem',
                   fontWeight: 700, color, letterSpacing: '0.05em' }}>
      {remaining === 0 ? '00:00' : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
    </span>
  )
}

// ── Lesson Card ────────────────────────────────────────────────
function LessonCard({ lesson, onEnd, onToggleLock, onRefresh }) {
  const [ending, setEnding]   = useState(false)
  const [locking, setLocking] = useState(false)

  async function handleEnd() {
    if (!confirm(`לסגור את השיעור עם קוד ${lesson.lesson_code}?`)) return
    setEnding(true)
    await supabase.from('lessons').update({ status: 'ended' }).eq('id', lesson.id)
    onEnd()
  }

  async function handleToggleLock() {
    setLocking(true)
    await supabase.from('lessons')
      .update({ is_locked: !lesson.is_locked }).eq('id', lesson.id)
    setLocking(false)
    onRefresh()
  }

  return (
    <div className="card" style={{
      borderRight: `4px solid ${lesson.is_locked ? 'var(--warning)' : 'var(--accent)'}`,
      position: 'relative',
    }}>
      {/* Code badge */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        background: 'var(--accent)', color: '#fff',
        borderRadius: 8, padding: '4px 14px',
        fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.2em',
      }}>
        {lesson.lesson_code}
      </div>

      {/* Status badge */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <span className={`badge ${lesson.is_locked ? 'badge-warning' : 'badge-success'}`}>
          {lesson.is_locked ? '🔒 נעול' : '✅ פעיל'}
        </span>
      </div>

      <div style={{ marginTop: 56 }}>
        {/* Info row */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {lesson.subject || 'שיעור ללא נושא'}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
            👩‍🏫 {lesson.teacher_name || '—'} &nbsp;|&nbsp;
            👥 {lesson.participant_count ?? 0} מחשבים מחוברים
          </div>
        </div>

        {/* Timer */}
        <div style={{ marginBottom: 16 }}>
          <Countdown endTime={lesson.end_time} isLocked={lesson.is_locked} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: 8 }}>
            נשאר
          </span>
        </div>

        {/* Progress bar */}
        <ProgressBar startTime={lesson.start_time} endTime={lesson.end_time} />

        {/* Actions */}
        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button
            className={`btn ${lesson.is_locked ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={handleToggleLock}
            disabled={locking}
          >
            {locking ? '⏳' : lesson.is_locked ? '🔓 שחרר מסכים' : '🔒 נעל מסכים'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ color: 'var(--danger-light)', flex: 1 }}
            onClick={handleEnd}
            disabled={ending}
          >
            {ending ? '⏳' : '⏹️ סיים שיעור'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ startTime, endTime }) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    function calc() {
      const total  = new Date(endTime) - new Date(startTime)
      const elapsed = new Date() - new Date(startTime)
      setPct(Math.min(100, Math.max(0, (elapsed / total) * 100)))
    }
    calc()
    const t = setInterval(calc, 5000)
    return () => clearInterval(t)
  }, [startTime, endTime])

  return (
    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: pct > 80 ? 'var(--danger-light)' : 'var(--accent)',
        borderRadius: 2, transition: 'width 1s linear',
      }} />
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────
export default function Lessons() {
  const [active,   setActive]   = useState([])
  const [teachers, setTeachers] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showNew,  setShowNew]  = useState(false)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [newCode,  setNewCode]  = useState(null)  // קוד שיעור שנפתח

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: lessons }, { data: tchrs }] = await Promise.all([
      supabase.from('active_lessons').select('*').order('start_time'),
      supabase.from('teachers').select('id,name').eq('is_active', true).order('name'),
    ])
    setActive(lessons ?? [])
    setTeachers(tchrs ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Realtime: רענון כשמשהו משתנה בשיעורים
  useEffect(() => {
    const ch = supabase
      .channel('lessons-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' },
          () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load])

  async function openLesson(e) {
    e.preventDefault()
    setSaving(true)
    setNewCode(null)

    // שלב א: ייצר קוד ייחודי
    const { data: code, error: codeErr } = await supabase.rpc('generate_lesson_code')
    if (codeErr || !code) {
      alert('שגיאה בייצור קוד שיעור: ' + (codeErr?.message || 'unknown'))
      setSaving(false)
      return
    }

    // שלב ב: צור שיעור
    const startTime = new Date()
    const endTime   = new Date(startTime.getTime() + form.duration * 60 * 1000)

    const { error: insErr } = await supabase.from('lessons').insert({
      teacher_id:       form.teacher_id || null,
      subject:          form.subject.trim() || null,
      lesson_code:      code,
      duration_minutes: form.duration,
      start_time:       startTime.toISOString(),
      end_time:         endTime.toISOString(),
      status:           'active',
    })

    setSaving(false)
    if (insErr) { alert('שגיאה: ' + insErr.message); return }

    setNewCode(code)
    setForm(EMPTY_FORM)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">📚 ניהול שיעורים</h2>
        <p className="page-subtitle">{active.length} שיעורים פעילים כעת</p>
      </div>

      {/* Open lesson button */}
      <div className="flex gap-3 mb-5">
        <button className="btn btn-primary" onClick={() => { setShowNew(true); setNewCode(null) }}>
          ▶️ פתח שיעור חדש
        </button>
        <button className="btn btn-ghost" onClick={load}>🔄 רענן</button>
      </div>

      {/* Active lessons grid */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : active.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 32 }}>
          <div className="empty-icon">📚</div>
          <p>אין שיעורים פעילים כרגע</p>
          <p style={{ fontSize: '0.85rem' }}>לחץ "פתח שיעור חדש" כדי להתחיל</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 20, marginBottom: 32,
        }}>
          {active.map(lesson => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onEnd={load}
              onToggleLock={() => {}}
              onRefresh={load}
            />
          ))}
        </div>
      )}

      {/* ── New Lesson Modal ── */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">▶️ פתיחת שיעור</h3>
              <button className="modal-close" onClick={() => setShowNew(false)}>✕</button>
            </div>

            {/* Code display after creation */}
            {newCode ? (
              <div style={{ padding: '0 0 24px' }}>
                <div style={{
                  background: 'var(--bg-card)',
                  borderRadius: 12, textAlign: 'center', padding: '32px 20px',
                  border: '2px solid var(--accent)',
                }}>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>קוד השיעור שלך:</p>
                  <div style={{
                    fontSize: '3.5rem', fontFamily: 'monospace', fontWeight: 900,
                    color: 'var(--accent)', letterSpacing: '0.3em',
                  }}>
                    {newCode}
                  </div>
                  <p style={{ color: 'var(--text-muted)', marginTop: 12, fontSize: '0.85rem' }}>
                    מסור קוד זה לתלמידים. הם יזינו אותו לאחר תעודת הזהות.
                  </p>
                </div>
                <div className="modal-footer" style={{ marginTop: 20 }}>
                  <button className="btn btn-primary" onClick={() => {
                    setShowNew(false); setNewCode(null)
                  }}>
                    סגור
                  </button>
                  <button className="btn btn-ghost" onClick={() => setNewCode(null)}>
                    פתח שיעור נוסף
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={openLesson}>
                <div className="form-group">
                  <label className="form-label">מורה</label>
                  <select
                    className="form-input"
                    value={form.teacher_id}
                    onChange={e => setForm(f => ({ ...f, teacher_id: e.target.value }))}
                  >
                    <option value="">— ללא מורה —</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">נושא השיעור (אופציונלי)</label>
                  <input
                    className="form-input"
                    value={form.subject}
                    onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    placeholder="מתמטיקה, עברית..."
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">משך השיעור *</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {DURATIONS.map(d => (
                      <button
                        key={d.value}
                        type="button"
                        className={`btn ${form.duration === d.value ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ padding: '10px 4px' }}
                        onClick={() => setForm(f => ({ ...f, duration: d.value }))}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '⏳ פותח...' : '▶️ פתח שיעור'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>
                    ביטול
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
