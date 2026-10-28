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

const DAYS = [
  { id: 0, name: 'ראשון' },
  { id: 1, name: 'שני' },
  { id: 2, name: 'שלישי' },
  { id: 3, name: 'רביעי' },
  { id: 4, name: 'חמישי' },
  { id: 5, name: 'שישי' },
]

export default function Periods() {
  const [activeTab, setActiveTab] = useState('periods') // 'periods' | 'recurring'
  const [periods, setPeriods] = useState([])
  const [recurringRules, setRecurringRules] = useState([])
  const [teachers, setTeachers] = useState([])
  const [carts, setCarts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form states - Periods
  const [editingId, setEditingId] = useState(null)
  const [periodNum, setPeriodNum] = useState('')
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Form states - Recurring Lessons
  const [showAddRecurringModal, setShowAddRecurringModal] = useState(false)
  const [filterDay, setFilterDay] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [recTeacherId, setRecTeacherId] = useState('')
  const [recCartId, setRecCartId] = useState('')
  const [recDayOfWeek, setRecDayOfWeek] = useState(0)
  const [recPeriodId, setRecPeriodId] = useState('')
  const [recSubject, setRecSubject] = useState('')
  const [recClassName, setRecClassName] = useState('')
  const [recCollisionWarning, setRecCollisionWarning] = useState('')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [pRes, rRes, tRes, cRes] = await Promise.all([
        supabase.from('school_periods').select('*').order('period_number', { ascending: true }),
        supabase.from('recurring_lessons_overview').select('*').order('day_of_week').order('period_number'),
        supabase.from('teachers').select('id, name, id_last4').eq('is_active', true).order('name'),
        supabase.from('carts').select('id, name, display_name').is('deleted_at', null).order('name')
      ])

      if (pRes.error) setError('שגיאה בטעינת מערכת השעות: ' + pRes.error.message)
      else {
        setPeriods(pRes.data || [])
        if (pRes.data && pRes.data.length > 0) {
          const maxNum = Math.max(...pRes.data.map(p => p.period_number))
          setPeriodNum(String(maxNum + 1))
          setName(`שעה ${maxNum + 1}`)
        } else {
          setPeriodNum('1')
          setName('שעה ראשונה')
        }
      }

      if (rRes.data) setRecurringRules(rRes.data)
      if (tRes.data) setTeachers(tRes.data)
      if (cRes.data) setCarts(cRes.data)
    } catch (err) {
      setError('שגיאה בטעינת נתונים: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // --- Live collision check for recurring modal ---
  useEffect(() => {
    if (!recCartId || !recPeriodId) {
      setRecCollisionWarning('')
      return
    }
    const conflict = recurringRules.find(r =>
      r.cart_id === recCartId &&
      r.day_of_week === Number(recDayOfWeek) &&
      r.period_id === recPeriodId &&
      r.status === 'approved' &&
      r.is_active
    )
    if (conflict) {
      setRecCollisionWarning(`שים לב: העגלה כבר משוריינת בקביעות ביום ובשעה זו עבור "${conflict.subject}" (מורה: ${conflict.teacher_name || 'אחר'}).`)
    } else {
      setRecCollisionWarning('')
    }
  }, [recCartId, recPeriodId, recDayOfWeek, recurringRules])

  // --- Period Form Handlers ---
  function resetPeriodForm() {
    setEditingId(null)
    const maxNum = periods.length > 0 ? Math.max(...periods.map(p => p.period_number)) : 0
    setPeriodNum(String(maxNum + 1))
    setName(`שעה ${maxNum + 1}`)
    setStartTime('')
    setEndTime('')
    setIsActive(true)
  }

  function handleEditPeriod(p) {
    setEditingId(p.id)
    setPeriodNum(String(p.period_number))
    setName(p.name)
    setStartTime(p.start_time.slice(0, 5))
    setEndTime(p.end_time.slice(0, 5))
    setIsActive(p.is_active)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSavePeriod(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const num = parseInt(periodNum, 10)
    if (isNaN(num) || num < 1) {
      setError('מספר שעה חייב להיות מספר שלם חיובי')
      return
    }
    if (!name.trim()) {
      setError('יש להזין שם לשעה (למשל: שעה ראשונה)')
      return
    }
    if (!startTime || !endTime) {
      setError('יש להזין שעת התחלה ושעת סיום')
      return
    }
    if (startTime >= endTime) {
      setError('שעת הסיום חייבת להיות מאוחרת יותר משעת ההתחלה')
      return
    }

    const collision = periods.find(p => {
      if (editingId && p.id === editingId) return false
      const pStart = p.start_time.slice(0, 5)
      const pEnd = p.end_time.slice(0, 5)
      return (startTime < pEnd && endTime > pStart)
    })

    if (collision) {
      setError(`קיים חפיפה בזמנים עם ${collision.name} (${collision.start_time.slice(0, 5)} - ${collision.end_time.slice(0, 5)})`)
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
      const { error: err } = await supabase.from('school_periods').update(payload).eq('id', editingId)
      if (err) setError('שגיאה בעדכון שעה: ' + err.message)
      else {
        setSuccess('השעה עודכנה בהצלחה')
        resetPeriodForm()
        load()
      }
    } else {
      const { error: err } = await supabase.from('school_periods').insert(payload)
      if (err) {
        if (err.code === '23505') {
          setError(`מספר שעה ${num} כבר קיים במערכת. בחר מספר שעה אחר.`)
        } else {
          setError('שגיאה בהוספת שעה: ' + err.message)
        }
      } else {
        setSuccess('השעה נוספה למערכת בהצלחה')
        resetPeriodForm()
        load()
      }
    }
    setSaving(false)
  }

  async function handleDeletePeriod(p) {
    if (!window.confirm(`האם אתה בטוח שברצונך למחוק את ${p.name}? פעולה זו עלולה להשפיע על שיעורים קבועים המשובצים לשעה זו.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('school_periods').delete().eq('id', p.id)
    if (err) setError('שגיאה במחיקת שעה: ' + err.message)
    else {
      setSuccess(`${p.name} נמחקה מהמערכת`)
      load()
    }
    setSaving(false)
  }

  async function handleTogglePeriod(p) {
    setSaving(true)
    const { error: err } = await supabase.from('school_periods').update({ is_active: !p.is_active }).eq('id', p.id)
    if (err) setError('שגיאה בעדכון סטטוס: ' + err.message)
    else load()
    setSaving(false)
  }

  async function loadPreset() {
    if (periods.length > 0) {
      if (!window.confirm('טעינת תבנית מוגדרת מראש תדרוס את מערכת השעות הנוכחית. האם להמשיך?')) return
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await supabase.from('school_periods').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      const formatted = DEFAULT_PERIODS_PRESET.map(p => ({
        ...p,
        start_time: p.start_time + ':00',
        end_time: p.end_time + ':00',
        is_active: true
      }))
      const { error: err } = await supabase.from('school_periods').insert(formatted)
      if (err) setError('שגיאה בטעינת תבנית: ' + err.message)
      else {
        setSuccess('8 שעות לימוד סטנדרטיות נטענו בהצלחה למערכת!')
        resetPeriodForm()
        load()
      }
    } catch (err) {
      setError('שגיאה בטעינת תבנית: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // --- Recurring Rules Handlers ---
  async function handleApproveRule(ruleId) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'recurring', action: 'approve_recurring', ruleId })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'שגיאה באישור שיעור קבוע')
      } else {
        setSuccess('השיעור הקבוע אושר בהצלחה! העגלה שוריינה בקביעות במערכת.')
        load()
      }
    } catch (err) {
      setError('שגיאה בביצוע הפעולה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRejectRule(ruleId) {
    const notes = window.prompt('הערה לדחייה (אופציונלי):', '')
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'recurring', action: 'reject_recurring', ruleId, adminNotes: notes })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'שגיאה בדחיית שיעור קבוע')
      } else {
        setSuccess('הבקשה נדחתה.')
        load()
      }
    } catch (err) {
      setError('שגיאה בביצוע הפעולה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleRuleActive(ruleId, currentIsActive) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'recurring', action: 'toggle_recurring', ruleId, isActive: !currentIsActive })
      })
      const json = await res.json()
      if (!res.ok || json.error) setError(json.error || 'שגיאה בעדכון סטטוס')
      else load()
    } catch (err) {
      setError('שגיאה בעדכון: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRule(ruleId) {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק שריון קבוע זה מהמערכת?')) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'recurring', action: 'delete_recurring', ruleId })
      })
      const json = await res.json()
      if (!res.ok || json.error) setError(json.error || 'שגיאה במחיקת שיעור קבוע')
      else {
        setSuccess('השיעור הקבוע נמחק מהמערכת.')
        load()
      }
    } catch (err) {
      setError('שגיאה במחיקה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateRecurringRule(e) {
    e.preventDefault()
    if (!recTeacherId) { setError('יש לבחור מורה'); return }
    if (!recPeriodId) { setError('יש לבחור שעה במערכת'); return }
    if (!recSubject.trim()) { setError('יש להזין מקצוע'); return }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'recurring',
          action: 'create_recurring',
          teacherId: recTeacherId,
          cartId: recCartId || null,
          dayOfWeek: Number(recDayOfWeek),
          periodId: recPeriodId,
          subject: recSubject.trim(),
          className: recClassName.trim() || null,
          status: 'approved'
        })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'שגיאה ביצירת שיעור קבוע')
      } else {
        setSuccess('שיעור קבוע נוסף ואושר בהצלחה במערכת!')
        setShowAddRecurringModal(false)
        setRecSubject('')
        setRecClassName('')
        setRecCartId('')
        load()
      }
    } catch (err) {
      setError('שגיאה ביצירה: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const pendingRulesCount = recurringRules.filter(r => r.status === 'pending').length
  const filteredRecurring = recurringRules.filter(r => {
    if (filterDay !== 'all' && r.day_of_week !== Number(filterDay)) return false
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    return true
  })

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40, fontFamily: 'Heebo, sans-serif' }}>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 6px 0', color: '#f8fafc' }}>
            ⏱️ מערכת שעות ושריון עגלות
          </h2>
          <p className="page-subtitle" style={{ margin: 0, color: '#94a3b8', fontSize: '0.95rem' }}>
            הגדרת לוח הצלצולים השנתי, וניהול שיעורים שבועיים קבועים ושריון עגלות באישור מנהל.
          </p>
        </div>

        {activeTab === 'periods' && (
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
              borderRadius: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(37,99,235,0.2)'
            }}
          >
            ⚡ טען 8 שעות סטנדרטיות (תבנית בית-ספר)
          </button>
        )}

        {activeTab === 'recurring' && (
          <button
            type="button"
            onClick={() => {
              setError('')
              setSuccess('')
              setShowAddRecurringModal(true)
            }}
            className="btn"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 10,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(124,58,237,0.3)'
            }}
          >
            ➕ הוסף שיעור קבוע חדש
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 12, margin: '20px 0 24px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12 }}>
        <button
          type="button"
          onClick={() => { setActiveTab('periods'); setError(''); setSuccess(''); }}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: activeTab === 'periods' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
            color: activeTab === 'periods' ? '#fff' : '#94a3b8',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s'
          }}
        >
          <span>⏱️ לוח צלצולים ושעות לימוד</span>
          <span style={{ background: 'rgba(0,0,0,0.25)', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' }}>
            {periods.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('recurring'); setError(''); setSuccess(''); }}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            background: activeTab === 'recurring' ? '#7c3aed' : 'rgba(255,255,255,0.05)',
            color: activeTab === 'recurring' ? '#fff' : '#94a3b8',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s'
          }}
        >
          <span>🔄 שיעורים שבועיים קבועים ושריון עגלות</span>
          <span style={{ background: 'rgba(0,0,0,0.25)', padding: '2px 8px', borderRadius: 12, fontSize: '0.8rem' }}>
            {recurringRules.length}
          </span>
          {pendingRulesCount > 0 && (
            <span style={{
              background: '#ef4444',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: '0.75rem',
              fontWeight: 800,
              animation: 'pulse 1.5s infinite'
            }}>
              {pendingRulesCount} ממתינים!
            </span>
          )}
        </button>
      </div>

      {/* Global Alerts */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)',
          color: '#fca5a5', padding: '12px 18px', borderRadius: 12, marginBottom: 20, fontSize: '0.95rem'
        }}>
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)',
          color: '#6ee7b7', padding: '12px 18px', borderRadius: 12, marginBottom: 20, fontSize: '0.95rem'
        }}>
          ✅ {success}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 1: BELLS & PERIODS SCHEDULE                               */}
      {/* ============================================================== */}
      {activeTab === 'periods' && (
        <>
          {/* Gatekeeper Status Indicator */}
          {periods.length === 0 && !loading ? (
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: 14, padding: '18px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: '2rem' }}>⚠️</span>
                <div>
                  <strong style={{ color: '#fbbf24', fontSize: '1.1rem', display: 'block' }}>
                    מערכת שעות ריקה (תנאי מקדים טרם הושלם)
                  </strong>
                  <span style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                    לא הוגדרו שעות לימוד במערכת. מורים ועמדות ההשאלה אינם יכולים לפעול לפני קביעת מערכת שעות.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={loadPreset}
                disabled={saving}
                style={{
                  background: '#f59e0b', color: '#0f172a', fontWeight: 700, border: 'none', padding: '10px 18px', borderRadius: 8, cursor: 'pointer'
                }}
              >
                טען תבנית שעות כעת
              </button>
            </div>
          ) : (
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: 12, padding: '12px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <span style={{ color: '#6ee7b7', fontSize: '0.95rem', fontWeight: 600 }}>
                ✅ מערכת השעות מוגדרת ופעילה ({periods.length} שעות לימוד). תנאי מקדים מתקיים בהצלחה.
              </span>
            </div>
          )}

          {/* Form: Add / Edit Period */}
          <div style={{
            background: 'var(--card-bg, #0d1526)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16, padding: '24px', marginBottom: 30, boxShadow: '0 8px 30px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', color: '#f8fafc', fontWeight: 700 }}>
              {editingId ? '✏️ עריכת שעת לימוד' : '➕ הוספת שעת לימוד למערכת'}
            </h3>

            <form onSubmit={handleSavePeriod} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>מספר שעה</label>
                <input
                  type="number"
                  min="1"
                  value={periodNum}
                  onChange={e => setPeriodNum(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>שם השעה</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="למשל: שעה ראשונה"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>שעת התחלה</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 6 }}>שעת סיום</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 8, border: 'none',
                    background: editingId ? '#10b981' : '#3b82f6', color: '#fff', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  {saving ? 'שומר...' : editingId ? 'עדכן שעה' : 'הוסף שעה'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetPeriodForm}
                    style={{
                      padding: '11px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
                      background: 'transparent', color: '#94a3b8', cursor: 'pointer'
                    }}
                  >
                    ביטול
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Periods Table */}
          <div style={{
            background: 'var(--card-bg, #0d1526)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16, overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>מספר</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>שם השעה</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>התחלה</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>סיום</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>משך (דקות)</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>סטטוס</th>
                  <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'left' }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {periods.map(p => {
                  const s = p.start_time.slice(0, 5)
                  const e = p.end_time.slice(0, 5)
                  const [sh, sm] = s.split(':').map(Number)
                  const [eh, em] = e.split(':').map(Number)
                  const durationMin = (eh * 60 + em) - (sh * 60 + sm)

                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '14px 18px', color: '#fff', fontWeight: 700 }}>{p.period_number}</td>
                      <td style={{ padding: '14px 18px', color: '#fff', fontWeight: 600 }}>{p.name}</td>
                      <td style={{ padding: '14px 18px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '1rem' }}>{s}</td>
                      <td style={{ padding: '14px 18px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '1rem' }}>{e}</td>
                      <td style={{ padding: '14px 18px', color: '#94a3b8' }}>{durationMin} דק׳</td>
                      <td style={{ padding: '14px 18px' }}>
                        <button
                          type="button"
                          onClick={() => handleTogglePeriod(p)}
                          style={{
                            padding: '4px 10px', borderRadius: 12, border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                            background: p.is_active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: p.is_active ? '#6ee7b7' : '#fca5a5'
                          }}
                        >
                          {p.is_active ? 'פעיל' : 'מושבת'}
                        </button>
                      </td>
                      <td style={{ padding: '14px 18px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => handleEditPeriod(p)}
                            style={{
                              padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
                              background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.85rem'
                            }}
                          >
                            ערוך
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePeriod(p)}
                            style={{
                              padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                              background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', fontSize: '0.85rem'
                            }}
                          >
                            מחק
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ============================================================== */}
      {/* TAB 2: RECURRING LESSONS & CART BOOKINGS                      */}
      {/* ============================================================== */}
      {activeTab === 'recurring' && (
        <>
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 18 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>סה״כ שיעורים קבועים</div>
              <div style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 800 }}>{recurringRules.length}</div>
            </div>

            <div style={{
              background: pendingRulesCount > 0 ? 'rgba(245, 158, 11, 0.12)' : '#0d1526',
              border: pendingRulesCount > 0 ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14, padding: 18
            }}>
              <div style={{ color: pendingRulesCount > 0 ? '#f59e0b' : '#94a3b8', fontSize: '0.85rem', marginBottom: 4, fontWeight: 700 }}>
                ממתינים לאישור מנהל
              </div>
              <div style={{ color: pendingRulesCount > 0 ? '#f59e0b' : '#fff', fontSize: '1.6rem', fontWeight: 800 }}>
                {pendingRulesCount}
              </div>
            </div>

            <div style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 18 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>שיעורים מאושרים ופעילים</div>
              <div style={{ color: '#10b981', fontSize: '1.6rem', fontWeight: 800 }}>
                {recurringRules.filter(r => r.status === 'approved' && r.is_active).length}
              </div>
            </div>

            <div style={{ background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 18 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: 4 }}>עגלות שוריינו בקביעות</div>
              <div style={{ color: '#a855f7', fontSize: '1.6rem', fontWeight: 800 }}>
                {new Set(recurringRules.filter(r => r.status === 'approved' && r.is_active && r.cart_id).map(r => r.cart_id)).size}
              </div>
            </div>
          </div>

          {/* Filters Bar */}
          <div style={{
            background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
            padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>יום:</span>
              <select
                value={filterDay}
                onChange={e => setFilterDay(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.9rem'
                }}
              >
                <option value="all">כל הימים</option>
                {DAYS.map(d => (
                  <option key={d.id} value={d.id}>יום {d.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>סטטוס:</span>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.9rem'
                }}
              >
                <option value="all">כל הסטטוסים</option>
                <option value="pending">ממתין לאישור מנהל</option>
                <option value="approved">מאושר</option>
                <option value="rejected">נדחה</option>
              </select>
            </div>

            <span style={{ color: '#64748b', fontSize: '0.85rem', marginRight: 'auto' }}>
              מציג {filteredRecurring.length} מתוך {recurringRules.length} שיעורים
            </span>
          </div>

          {/* Recurring Rules List */}
          {filteredRecurring.length === 0 ? (
            <div style={{
              background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
              padding: '40px 20px', textAlign: 'center', color: '#94a3b8'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📅</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>אין שיעורים קבועים התואמים לסינון</div>
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem' }}>
                ניתן להוסיף שיעור קבוע חדש ישירות באמצעות הכפתור בראש העמוד, או לחכות לבקשות מורים מתוך אפליקציית המורה.
              </p>
            </div>
          ) : (
            <div style={{
              background: '#0d1526', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>יום ושעה</th>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>עגלה משוריינת</th>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>מקצוע וכיתה</th>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>מורה</th>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem' }}>סטטוס</th>
                    <th style={{ padding: '14px 18px', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'left' }}>פעולות מנהל</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecurring.map(rule => {
                    const dayObj = DAYS.find(d => d.id === rule.day_of_week)
                    const dayLabel = dayObj ? `יום ${dayObj.name}` : `יום ${rule.day_of_week}`

                    return (
                      <tr key={rule.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <strong style={{ color: '#fff', display: 'block', fontSize: '0.95rem' }}>{dayLabel}</strong>
                          <span style={{ color: '#38bdf8', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            {rule.period_name || `שעה ${rule.period_number}`} ({rule.start_time?.slice(0, 5)} - {rule.end_time?.slice(0, 5)})
                          </span>
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          {rule.cart_name ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              background: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.3)',
                              color: '#c084fc', padding: '4px 10px', borderRadius: 8, fontWeight: 700, fontSize: '0.85rem'
                            }}>
                              🛒 {rule.cart_display_name || rule.cart_name}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>ללא עגלה</span>
                          )}
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <strong style={{ color: '#fff', display: 'block', fontSize: '0.95rem' }}>{rule.subject}</strong>
                          {rule.class_name && (
                            <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>כיתה: {rule.class_name}</span>
                          )}
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.9rem' }}>
                            👤 {rule.teacher_name || 'מורה לא ידוע'}
                          </span>
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          {rule.status === 'pending' && (
                            <span style={{
                              background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #f59e0b',
                              color: '#fbbf24', padding: '4px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700
                            }}>
                              ⏳ ממתין לאישור
                            </span>
                          )}
                          {rule.status === 'approved' && (
                            <span style={{
                              background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981',
                              color: '#6ee7b7', padding: '4px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700
                            }}>
                              ✅ מאושר
                            </span>
                          )}
                          {rule.status === 'rejected' && (
                            <span style={{
                              background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444',
                              color: '#fca5a5', padding: '4px 10px', borderRadius: 12, fontSize: '0.8rem', fontWeight: 700
                            }}>
                              ❌ נדחה
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '14px 18px', textAlign: 'left' }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {rule.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApproveRule(rule.id)}
                                  disabled={saving}
                                  style={{
                                    padding: '6px 12px', borderRadius: 8, border: 'none',
                                    background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem'
                                  }}
                                >
                                  אשר שריון
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectRule(rule.id)}
                                  disabled={saving}
                                  style={{
                                    padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)',
                                    background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: 'pointer', fontSize: '0.85rem'
                                  }}
                                >
                                  דחה
                                </button>
                              </>
                            )}

                            {rule.status === 'approved' && (
                              <button
                                type="button"
                                onClick={() => handleToggleRuleActive(rule.id, rule.is_active)}
                                disabled={saving}
                                style={{
                                  padding: '6px 10px', borderRadius: 8, border: 'none',
                                  background: rule.is_active ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                  color: rule.is_active ? '#fbbf24' : '#6ee7b7',
                                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                                }}
                              >
                                {rule.is_active ? 'השבת' : 'הפעל'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteRule(rule.id)}
                              disabled={saving}
                              style={{
                                padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem'
                              }}
                              title="מחק מהמערכת"
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

          {/* Modal: Add Recurring Rule */}
          {showAddRecurringModal && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
              zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
            }} onClick={() => setShowAddRecurringModal(false)}>
              <div style={{
                background: '#0d1526', border: '1.5px solid rgba(124, 58, 237, 0.3)', borderRadius: 20,
                padding: 28, maxWidth: 500, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
              }} onClick={e => e.stopPropagation()}>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <h3 style={{ color: '#fff', fontSize: '1.35rem', fontWeight: 800, margin: '0 0 6px 0' }}>
                    ➕ הוספת שיעור קבוע במערכת
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
                    שיעור שנוסף ישירות על ידי מנהל מקבל אישור מיידי ומשוריין בקביעות.
                  </p>
                </div>

                {recCollisionWarning && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5',
                    padding: '10px 14px', borderRadius: 10, fontSize: '0.85rem', marginBottom: 16
                  }}>
                    ⚠️ {recCollisionWarning}
                  </div>
                )}

                <form onSubmit={handleCreateRecurringRule} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>בחר מורה *</label>
                    <select
                      value={recTeacherId}
                      onChange={e => setRecTeacherId(e.target.value)}
                      required
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                      }}
                    >
                      <option value="">-- בחר מורה --</option>
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>{t.name} (ת.ז מסתיימת ב-{t.id_last4})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>יום בשבוע *</label>
                      <select
                        value={recDayOfWeek}
                        onChange={e => setRecDayOfWeek(Number(e.target.value))}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                        }}
                      >
                        {DAYS.map(d => (
                          <option key={d.id} value={d.id}>יום {d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>שעה במערכת *</label>
                      <select
                        value={recPeriodId}
                        onChange={e => setRecPeriodId(e.target.value)}
                        required
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                        }}
                      >
                        <option value="">-- בחר שעה --</option>
                        {periods.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>עגלה לשריון (אופציונלי)</label>
                    <select
                      value={recCartId}
                      onChange={e => setRecCartId(e.target.value)}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                      }}
                    >
                      <option value="">-- ללא עגלה --</option>
                      {carts.map(c => (
                        <option key={c.id} value={c.id}>{c.display_name || c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>מקצוע *</label>
                      <input
                        type="text"
                        value={recSubject}
                        onChange={e => setRecSubject(e.target.value)}
                        placeholder="למשל: פיזיקה מוגבר"
                        required
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4 }}>כיתה</label>
                      <input
                        type="text"
                        value={recClassName}
                        onChange={e => setRecClassName(e.target.value)}
                        placeholder="יא' 2"
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.95rem'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                    <button
                      type="submit"
                      disabled={saving || !!recCollisionWarning}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                        background: recCollisionWarning ? '#64748b' : 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                        color: '#fff', fontWeight: 700, fontSize: '0.95rem',
                        cursor: recCollisionWarning ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {saving ? 'יוצר ומאשר...' : 'צור שיעור קבוע'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddRecurringModal(false)}
                      style={{
                        padding: '12px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
                        background: 'transparent', color: '#94a3b8', cursor: 'pointer'
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
