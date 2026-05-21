import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function AllowedAdmins() {
  const [admins, setAdmins] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    // קבלת המשתמש המחובר הנוכחי
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user)
    })
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    setSuccess('')
    const { data, error: err } = await supabase
      .from('allowed_admins')
      .select('*')
      .order('email')
    
    if (err) {
      setError('שגיאה בטעינת המנהלים המורשים: ' + err.message)
    } else {
      setAdmins(data ?? [])
    }
    setLoading(false)
  }

  async function addAdmin(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    const email = emailInput.trim().toLowerCase()

    if (!email) {
      setError('אנא הזן כתובת אימייל תקינה')
      return
    }

    setSaving(true)
    const { error: err } = await supabase
      .from('allowed_admins')
      .insert({ email })

    setSaving(false)
    if (err) {
      if (err.code === '23505') {
        setError('כתובת אימייל זו כבר קיימת ברשימת המנהלים המורשים')
      } else {
        setError(err.message)
      }
      return
    }

    setSuccess(`המייל ${email} נוסף בהצלחה לרשימת המורשים. כעת מנהל זה יכול להירשם!`)
    setEmailInput('')
    load()
  }

  async function deleteAdmin(email) {
    setError('')
    setSuccess('')

    if (currentUser && currentUser.email?.toLowerCase() === email.toLowerCase()) {
      alert('אינך יכול להסיר את עצמך מרשימת המנהלים המורשים כדי למנוע נעילת החשבון שלך!')
      return
    }

    if (!confirm(`האם להסיר את ${email} מרשימת המנהלים המורשים? מנהל זה לא יוכל להירשם או להיכנס אם יימחק.`)) return

    const { error: err } = await supabase
      .from('allowed_admins')
      .delete()
      .eq('email', email)

    if (err) {
      setError('שגיאה בהסרת המנהל: ' + err.message)
    } else {
      setSuccess(`המנהל ${email} הוסר בהצלחה מרשימת המורשים.`)
      load()
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">🛡️ מנהלים מורשים</h2>
        <p className="page-subtitle">ניהול רשימת כתובות האימייל המורשות להירשם כמנהלים במערכת</p>
      </div>

      {/* הסבר אבטחה */}
      <div className="alert alert-info" style={{ marginBottom: 24, fontSize: '0.9rem', lineHeight: 1.5 }}>
        💡 <strong>כיצד זה עובד?</strong> כדי להגן על המערכת מפני הרשמות של משתמשים זרים, מסד הנתונים חוסם הרשמת מנהלים חדשים. 
        כדי להוסיף מנהל חדש למערכת, <strong>עליך להוסיף תחילה את כתובת האימייל שלו לרשימה זו</strong>. 
        לאחר ההוספה, המנהל החדש יוכל להיכנס לעמוד הבית, לעבור לכרטיסיית "רישום מנהל" ולהשלים את ההרשמה עם סיסמה.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        
        {/* טופס הוספה */}
        <div className="card" style={{ height: 'fit-content' }}>
          <h3 style={{ margin: '0 0 16px 0', color: '#f1f5f9', fontSize: '1.2rem' }}>הוספת מנהל מורשה חדש</h3>
          <form onSubmit={addAdmin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: 8 }}>כתובת אימייל של המנהל</label>
              <input
                type="email"
                required
                className="form-input"
                placeholder="example@school.org"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            {error && (
              <div style={{
                color: '#fca5a5',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: '0.85rem',
                textAlign: 'center'
              }}>
                ⚠️ {error}
              </div>
            )}

            {success && (
              <div style={{
                color: '#a7f3d0',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.2)',
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: '0.85rem',
                textAlign: 'center'
              }}>
                ✅ {success}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
              {saving ? '⏳ שומר...' : '+ הוסף מנהל מורשה'}
            </button>
          </form>
        </div>

        {/* רשימת מורשים */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.2rem' }}>רשימת הכתובות המורשות במערכת ({admins.length})</h3>
          </div>

          {loading ? (
            <div className="loading-center" style={{ padding: 40 }}><div className="spinner" /></div>
          ) : admins.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="empty-icon">🛡️</div>
              <p>אין מנהלים ברשימת המורשים</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>כתובת אימייל</th>
                    <th>תאריך הוספה</th>
                    <th style={{ width: 80, textAlign: 'center' }}>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(admin => {
                    const isSelf = currentUser && currentUser.email?.toLowerCase() === admin.email.toLowerCase()
                    return (
                      <tr key={admin.email} style={{ background: isSelf ? 'rgba(245,158,11,0.03)' : 'transparent' }}>
                        <td style={{ fontWeight: 600, color: '#f1f5f9' }}>
                          {admin.email}
                          {isSelf && <span style={{ marginRight: 8, fontSize: '0.75rem', background: '#f59e0b', color: '#000', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>אתה</span>}
                        </td>
                        <td style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                          {new Date(admin.created_at).toLocaleDateString('he-IL')} {new Date(admin.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => deleteAdmin(admin.email)}
                            className="btn-action"
                            title="הסר מרשימת המורשים"
                            disabled={isSelf}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: isSelf ? '#475569' : '#fca5a5',
                              cursor: isSelf ? 'not-allowed' : 'pointer',
                              fontSize: '1rem',
                              opacity: isSelf ? 0.4 : 1
                            }}
                          >
                            🗑️
                          </button>
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
