import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ── Battery bar component ──────────────────────────────────────
function BatteryBar({ level, charging }) {
  const color = charging ? '#22c55e'
              : level < 20 ? '#ef4444'
              : level < 50 ? '#f59e0b'
              : '#3b82f6'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${level}%`, height: '100%', background: color,
                      borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color, minWidth: 36 }}>
        {level != null ? `${level}%` : '?'}
      </span>
      {charging && <span title="מחובר לחשמל">⚡</span>}
    </div>
  )
}

export default function Dashboard() {
  const [stats,     setStats]     = useState(null)
  const [unreturned,setUnreturned]= useState([])
  const [strikes,   setStrikes]   = useState([])
  const [lowBat,    setLowBat]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [clearing,  setClearing]  = useState(null)  // student id being cleared

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cartsRes, studentsRes, loansRes, unreturnedRes,
             strikesRes, lowBatRes] = await Promise.all([
        supabase.from('carts').select('id', { count: 'exact', head: true }),
        supabase.from('students').select('id', { count: 'exact', head: true }),
        supabase.from('device_loans')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active').is('checkin_at', null),
        supabase.from('unreturned_loans')
          .select('*').order('checkout_at', { ascending: true }).limit(10),

        // תלמידים עם strikes
        supabase.from('students')
          .select('id,name,class_name,charge_strikes,last_charged_at')
          .gt('charge_strikes', 0)
          .order('charge_strikes', { ascending: false }),

        // מחשבים עם סוללה נמוכה (<30%) או לא מחוברים
        supabase.from('devices')
          .select('id,device_number,asset_tag,battery_level,is_charging,last_seen,cart_id,carts(name,display_name)')
          .not('battery_level', 'is', null)
          .lt('battery_level', 30)
          .order('battery_level', { ascending: true })
          .limit(20),
      ])

      setStats({
        carts:    cartsRes.count     ?? 0,
        students: studentsRes.count  ?? 0,
        active:   loansRes.count     ?? 0,
        strikes:  strikesRes.data?.length ?? 0,
      })
      setUnreturned(unreturnedRes.data  ?? [])
      setStrikes(strikesRes.data         ?? [])
      setLowBat(lowBatRes.data           ?? [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function clearStrike(student) {
    if (!confirm(`לנקות ${student.charge_strikes} strikes של ${student.name}?`)) return
    setClearing(student.id)
    await supabase.from('students')
      .update({ charge_strikes: 0, last_charged_at: new Date().toISOString() })
      .eq('id', student.id)
    setClearing(null)
    load()
  }

  function formatDuration(minutes) {
    if (!minutes) return '—'
    const m = Math.floor(minutes)
    if (m < 60) return `${m} דק'`
    return `${Math.floor(m/60)}ש' ${m%60}ד'`
  }

  function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return (
    <div className="loading-center">
      <div className="spinner" />
      <span>טוען נתונים...</span>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">📊 דשבורד</h2>
        <p className="page-subtitle">סקירה כללית של מצב המערכת</p>
      </div>

      {/* ── Stats grid ── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon accent">🛒</div>
          <div className="stat-info">
            <div className="stat-value">{stats.carts}</div>
            <div className="stat-label">עגלות רשומות</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success">👥</div>
          <div className="stat-info">
            <div className="stat-value">{stats.students}</div>
            <div className="stat-label">תלמידים רשומים</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon warning">💻</div>
          <div className="stat-info">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">מחשבים בשימוש</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon danger">⚠️</div>
          <div className="stat-info">
            <div className="stat-value"
                 style={{ color: unreturned.length > 0 ? 'var(--danger-light)' : 'var(--success-light)' }}>
              {unreturned.length}
            </div>
            <div className="stat-label">לא הוחזרו</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: '#f97316' }}>🔋</div>
          <div className="stat-info">
            <div className="stat-value"
                 style={{ color: strikes.length > 0 ? '#f97316' : 'var(--success-light)' }}>
              {stats.strikes}
            </div>
            <div className="stat-label">תלמידים עם strikes</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>🪫</div>
          <div className="stat-info">
            <div className="stat-value"
                 style={{ color: lowBat.length > 0 ? 'var(--danger-light)' : 'var(--success-light)' }}>
              {lowBat.length}
            </div>
            <div className="stat-label">מחשבים עם סוללה נמוכה</div>
          </div>
        </div>
      </div>

      {/* ── Charge Strikes ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 className="card-title">🔋 תלמידים עם עבירות אי-טעינה</h3>
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 רענן</button>
        </div>

        {strikes.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="empty-icon">✅</div>
            <p>כל התלמידים מטעינים כהלכה!</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>שם תלמיד</th>
                  <th>כיתה</th>
                  <th>מספר strikes</th>
                  <th>טעינה אחרונה</th>
                  <th>פעולה</th>
                </tr>
              </thead>
              <tbody>
                {strikes.map(s => (
                  <tr key={s.id}
                      style={{ background: s.charge_strikes >= 3 ? 'rgba(239,68,68,0.06)' : undefined }}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td><span className="badge badge-info">{s.class_name || '—'}</span></td>
                    <td>
                      <span className={`badge ${
                        s.charge_strikes >= 3 ? 'badge-danger'
                        : s.charge_strikes === 2 ? 'badge-warning'
                        : 'badge-info'
                      }`}>
                        {s.charge_strikes >= 3 ? '⛔ חסום' : `⚠️ ${s.charge_strikes}`}
                      </span>
                    </td>
                    <td className="text-muted">{formatDate(s.last_charged_at)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--success-light)' }}
                        onClick={() => clearStrike(s)}
                        disabled={clearing === s.id}
                      >
                        {clearing === s.id ? '⏳' : '✅ נקה strikes'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Low Battery Devices ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 className="card-title">🪫 מחשבים עם סוללה נמוכה (&lt;30%)</h3>
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 רענן</button>
        </div>

        {lowBat.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="empty-icon">⚡</div>
            <p>כל המחשבים טעונים כהלכה!</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>מחשב</th>
                  <th>עגלה</th>
                  <th>רמת סוללה</th>
                  <th>נראה לאחרונה</th>
                </tr>
              </thead>
              <tbody>
                {lowBat.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>מס' {d.device_number}</td>
                    <td className="text-muted">{d.carts?.display_name || d.carts?.name || '—'}</td>
                    <td style={{ minWidth: 160 }}>
                      <BatteryBar level={d.battery_level} charging={d.is_charging} />
                    </td>
                    <td className="text-muted">{formatDate(d.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Unreturned Loans ── */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">⚠️ מחשבים שלא הוחזרו</h3>
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 רענן</button>
        </div>

        {unreturned.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <p>כל המחשבים הוחזרו!</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>תלמיד</th>
                  <th>כיתה</th>
                  <th>עגלה</th>
                  <th>מחשב</th>
                  <th>נלקח ב</th>
                  <th>משך</th>
                </tr>
              </thead>
              <tbody>
                {unreturned.map(row => (
                  <tr key={row.loan_id}>
                    <td style={{ fontWeight: 600 }}>{row.student_name}</td>
                    <td><span className="badge badge-info">{row.class_name}</span></td>
                    <td>{row.cart_name}</td>
                    <td>מס' {row.device_number}</td>
                    <td className="text-muted">
                      {new Date(row.checkout_at).toLocaleTimeString('he-IL',
                        { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <span className={`badge ${
                        row.minutes_out > 120 ? 'badge-danger'
                        : row.minutes_out > 60  ? 'badge-warning'
                        : 'badge-success'
                      }`}>
                        {formatDuration(row.minutes_out)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
