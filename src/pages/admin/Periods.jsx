import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const DEFAULT_PERIODS_PRESET = [
  { period_number: 1, name: 'שעה ראשונה', start_time: '08:00', end_time: '08:45' },
  { period_number: 2, name: 'שעה שנייה',  start_time: '08:50', end_time: '09:35' },
  { period_number: 3, name: 'שעה שלישית', start_time: '09:55', end_time: '10:40' },
  { period_number: 4, name: 'שעה רביעית', start_time: '10:45', end_time: '11:30' },
  { period_number: 5, name: 'שעה חמישית', start_time: '11:45', end_time: '12:30' },
  { period_number: 6, name: 'שעה שישית',  start_time: '12:35', end_time: '13:20' },
  { period_number: 7, name: 'שעה שביעית', start_time: '13:30', end_time: '14:15' },
  { period_number: 8, name: 'שעה שמינית', start_time: '14:20', end_time: '15:05' },
]

export default function Periods() {
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form states
  const [editingId, setEditingId] = useState(null)
  const [periodNum, setPeriodNum] = useState('')
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('school_periods')
      .select('*')
      .order('period_number', { ascending: true })

    if (err) {
      setError('שגיאה בטעינת מערכת השעות: ' + err.message)
    } else {
      setPeriods(data || [])
      // suggest next period number
      if (data && data.length > 0) {
        const maxNum = Math.max(...data.map(p => p.period_number))
        setPeriodNum(String(maxNum + 1))
        setName(`שעה ${maxNum + 1}`)
      } else {
        setPeriodNum('1')
        setName('שעה ראשונה')
      }
    }
    setLoading(false)
  }

  function resetForm() {
    setEditingId(null)
    const maxNum = periods.length > 0 ? Math.max(...periods.map(p => p.period_number)) : 0
    setPeriodNum(String(maxNum + 1))
    setName(`שעה ${maxNum + 1}`)
    setStartTime('')
    setEndTime('')
    setIsActive(true)
  }

  function startEdit(p) {
    setEditingId(p.id)
    setPeriodNum(String(p.period_number))
    setName(p.name)
    setStartTime(p.start_time.slice(0, 5))
    setEndTime(p.end_time.slice(0, 5))
    setIsActive(p.is_active ?? true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function calcDuration(start, end) {
    if (!start || !end) return null
    const [h1, m1] = start.split(':').map(Number)
    const [h2, m2] = end.split(':').map(Number)
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    return mins > 0 ? mins : null
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const num = parseInt(periodNum, 10)
    if (isNaN(num) || num < 1) {
      setError('מספר השעה חייב להיות מספר חיובי.')
      return
    }

    if (!name.trim()) {
      setError('אנא הזן שם לשעה (לדוגמה: "שעה ראשונה").')
      return
    }

    if (!startTime || !endTime) {
      setError('אנא בחר שעת התחלה ושעת סיום.')
      return
    }

    const duration = calcDuration(startTime, endTime)
    if (!duration || duration <= 0) {
      setError('שעת הסיום חייבת להיות מאוחרת יותר משעת ההתחלה.')
      return
    }

    // Check collision with other periods
    const conflict = periods.find(p => {
      if (editingId && p.id === editingId) return false
      // Check number conflict
      if (p.period_number === num) return true
      // Check time overlap
      const pStart = p.start_time.slice(0, 5)
      const pEnd = p.end_time.slice(0, 5)
      return (startTime < pEnd && endTime > pStart)
    })

    if (conflict) {
      if (conflict.period_number === num) {
        setError(`מספר שעה ${num} כבר קיים במערכת (${conflict.name}).`)
      } else {
        setError(`קיימת חפיפת זמנים עם ${conflict.name} (${conflict.start_time.slice(0, 5)} - ${conflict.end_time.slice(0, 5)}).`)
      }
      return
    }

    setSaving(true)

    const payload = {
      period_number: num,
      name: name.trim(),
      start_time: startTime + ':00',
      end_time: endTime + ':00',
      is_active: isActive
    }

    if (editingId) {
      const { error: err } = await supabase
        .from('school_periods')
        .update(payload)
        .eq('id', editingId)

      setSaving(false)
      if (err) {
        setError('שגיאה בעדכון השעה: ' + err.message)
      } else {
        setSuccess(`השעה "${name}" עודכנה בהצלחה!`)
        resetForm()
        load()
      }
    } else {
      const { error: err } = await supabase
        .from('school_periods')
        .insert(payload)

      setSaving(false)
      if (err) {
        setError('שגיאה בהוספת השעה: ' + err.message)
      } else {
        setSuccess(`השעה "${name}" נוספה בהצלחה למערכת!`)
        resetForm()
        load()
      }
    }
  }

  async function handleDelete(p) {
    setError('')
    setSuccess('')
    if (!confirm(`האם אתה בטוח שברצונך למחוק את "${p.name}" (${p.start_time.slice(0, 5)} - ${p.end_time.slice(0, 5)})?`)) {
      return
    }

    const { error: err } = await supabase
      .from('school_periods')
      .delete()
      .eq('id', p.id)

    if (err) {
      setError('שגיאה במחיקת השעה: ' + err.message)
    } else {
      setSuccess(`השעה "${p.name}" נמחקה בהצלחה.`)
      if (editingId === p.id) resetForm()
      load()
    }
  }

  async function loadPreset() {
    if (periods.length > 0) {
      if (!confirm('קיימות כבר שעות מוגדרות במערכת. טעינת התבנית תמחק את השעות הקיימות ותטען 8 שעות סטנדרטיות. להמשיך?')) {
        return
      }
    }

    setSaving(true)
    setError('')
    setSuccess('')

    // Clear existing
    if (periods.length > 0) {
      await supabase.from('school_periods').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    }

    // Insert presets
    const toInsert = DEFAULT_PERIODS_PRESET.map(p => ({
      ...p,
      start_time: p.start_time + ':00',
      end_time: p.end_time + ':00',
      is_active: true
    }))

    const { error: insErr } = await supabase.from('school_periods').insert(toInsert)
    setSaving(false)

    if (insErr) {
      setError('שגיאה בטעינת מערכת השעות: ' + insErr.message)
    } else {
      setSuccess('מערכת שעות סטנדרטית (8 שעות שיעור) נטענה בהצלחה! שריון עגלות פעיל כעת.')
      load()
    }
  }

  const duration = calcDuration(startTime, endTime)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 className="page-title">⏰ מערכת שעות ולוח צלצולים</h2>
          <p className="page-subtitle">הגדרת שעות השיעורים וההפסקות. שריון עגלות למורים מבוסס על שעות אלו ומופעל רק לאחר הגדרתן.</p>
        </div>
        <button
          type="button"
          onClick={loadPreset}
          disabled={saving}
          className="btn"
          style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            color: '#fff',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 8,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(37,99,235,0.2)'
          }}
        >
          ⚡ טען 8 שעות מומלצות (התקנה מהירה)
        </button>
      </div>

      {/* Gatekeeper Status Indicator */}
      {periods.length === 0 && !loading ? (
        <div style={{
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: 12,
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '1.8rem' }}>⚠️</span>
            <div>
              <strong style={{ color: '#fbbf24', fontSize: '1.05rem', display: 'block' }}>
                שריון עגלות מושבת כעת (תנאי מקדים חסר)
              </strong>
              <span style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                טרם הוגדרו שעות שיעור במערכת. מורים אינם יכולים לשריין עגלות עד שתוגדר מערכת השעות.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={loadPreset}
            disabled={saving}
            style={{
              background: '#f59e0b',
              color: '#0f172a',
              fontWeight: 700,
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            טען מערכת שעות כעת
          </button>
        </div>
      ) : (
        <div style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 12,
          padding: '12px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{ fontSize: '1.4rem' }}>✅</span>
          <span style={{ color: '#a7f3d0', fontSize: '0.95rem' }}>
            <strong>מערכת השעות פעילה:</strong> מוגדרות <strong>{periods.length}</strong> שעות שיעור. שריון עגלות זמין למורים על פי שעות אלו.
          </span>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div className="alert alert-success" style={{ marginBottom: 20 }}>
          🎉 {success}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        
        {/* טופס הוספה / עריכה */}
        <div className="card" style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{editingId ? '✏️ עריכת שעת שיעור' : '➕ הוספת שעת שיעור חדשה'}</span>
          </h3>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  מספר שעה
                </label>
                <input
                  type="number"
                  min="1"
                  max="15"
                  required
                  value={periodNum}
                  onChange={e => setPeriodNum(e.target.value)}
                  placeholder="1"
                  className="input"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  שם השעה
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder='לדוגמה: "שעה ראשונה"'
                  className="input"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  שעת התחלה 🕐
                </label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="input"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>
                  שעת סיום 🕐
                </label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="input"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#fff' }}
                />
              </div>
            </div>

            {duration && (
              <div style={{ fontSize: '0.85rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '6px 12px', borderRadius: 6, display: 'inline-block' }}>
                ⏱️ משך השיעור: <strong>{duration} דקות</strong>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input
                type="checkbox"
                id="is_active_cb"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <label htmlFor="is_active_cb" style={{ color: '#cbd5e1', fontSize: '0.9rem', cursor: 'pointer' }}>
                שעה פעילה במערכת
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none'
                }}
              >
                {saving ? 'שומר...' : editingId ? '💾 שמור שינויים' : '➕ הוסף שעה למערכת'}
              </button>

              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn"
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    background: '#334155',
                    color: '#e2e8f0',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  ביטול
                </button>
              )}
            </div>
          </form>
        </div>

        {/* רשימת שעות המערכת */}
        <div className="card" style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem' }}>
              📋 לוח הצלצולים הקיים ({periods.length})
            </h3>
            {periods.length > 0 && (
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                ממויין לפי סדר כרונולוגי
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>
              טוען שעות שיעור...
            </div>
          ) : periods.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>טרם הוגדרו שעות שיעור.</p>
              <p style={{ fontSize: '0.85rem', margin: 0 }}>השתמש בטופס מימין להוספת שעה או לחץ על "טען 8 שעות מומלצות" למעלה.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.85rem' }}>
                    <th style={{ padding: '8px 12px' }}>#</th>
                    <th style={{ padding: '8px 12px' }}>שם השעה</th>
                    <th style={{ padding: '8px 12px' }}>שעות</th>
                    <th style={{ padding: '8px 12px' }}>משך</th>
                    <th style={{ padding: '8px 12px' }}>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map(p => {
                    const dur = calcDuration(p.start_time.slice(0, 5), p.end_time.slice(0, 5))
                    const isSelected = editingId === p.id
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          background: isSelected ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        <td style={{ padding: '12px', fontWeight: 700, color: '#38bdf8' }}>
                          {p.period_number}
                        </td>
                        <td style={{ padding: '12px', color: '#f1f5f9', fontWeight: 600 }}>
                          {p.name}
                        </td>
                        <td style={{ padding: '12px', color: '#cbd5e1', direction: 'ltr', textAlign: 'right' }}>
                          <span style={{ background: '#0f172a', padding: '4px 8px', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            {p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#94a3b8', fontSize: '0.85rem' }}>
                          {dur ? `${dur} דק'` : '-'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => startEdit(p)}
                              title="ערוך שעה"
                              style={{
                                background: 'transparent',
                                border: '1px solid #475569',
                                color: '#94a3b8',
                                borderRadius: 6,
                                padding: '4px 8px',
                                cursor: 'pointer',
                                fontSize: '0.85rem'
                              }}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(p)}
                              title="מחק שעה"
                              style={{
                                background: 'transparent',
                                border: '1px solid rgba(239,68,68,0.3)',
                                color: '#f87171',
                                borderRadius: 6,
                                padding: '4px 8px',
                                cursor: 'pointer',
                                fontSize: '0.85rem'
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
