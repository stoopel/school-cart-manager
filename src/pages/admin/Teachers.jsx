import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = { national_id: '', name: '', email: '' }

export default function Teachers() {
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('teachers').select('*').order('name')
    setTeachers(data ?? [])
    setLoading(false)
  }

  const filtered = teachers.filter(t =>
    t.name.includes(search) || t.national_id.includes(search)
  )

  async function addTeacher(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const { error: err } = await supabase.from('teachers').insert({
      national_id: form.national_id.trim(),
      name:        form.name.trim(),
      email:       form.email.trim() || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowAdd(false)
    setForm(EMPTY)
    load()
  }

  async function toggleActive(t) {
    await supabase.from('teachers')
      .update({ is_active: !t.is_active }).eq('id', t.id)
    load()
  }

  async function deleteTeacher(id) {
    if (!confirm('האם למחוק מורה זה?')) return
    await supabase.from('teachers').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">👩‍🏫 ניהול מורים</h2>
        <p className="page-subtitle">{teachers.length} מורים רשומים במערכת</p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mb-4 gap-3" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + הוסף מורה
        </button>
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="🔍 חיפוש לפי שם / ת.ז."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Alert - teacher is also admin bypass */}
      <div className="alert alert-info" style={{ marginBottom: 16, fontSize: '0.85rem' }}>
        💡 תעודת הזהות של המורה משמשת לכניסה ישירה למחשב ללא קוד שיעור.
        הקפד לוודא את הנתונים לפני ההוספה.
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👩‍🏫</div>
            <p>לא נמצאו מורים</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>שם מורה</th>
                  <th>תעודת זהות</th>
                  <th>אימייל</th>
                  <th>סטטוס</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                      {t.national_id}
                    </td>
                    <td className="text-muted">{t.email || '—'}</td>
                    <td>
                      <span className={`badge ${t.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {t.is_active ? 'פעיל' : 'לא פעיל'}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-ghost btn-sm"
                          title={t.is_active ? 'השבת' : 'הפעל'}
                          onClick={() => toggleActive(t)}
                        >
                          {t.is_active ? '🔒' : '🔓'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger-light)' }}
                          onClick={() => deleteTeacher(t.id)}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">➕ הוסף מורה</h3>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={addTeacher}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">תעודת זהות *</label>
                <input
                  className="form-input"
                  value={form.national_id}
                  onChange={e => setForm(f => ({ ...f, national_id: e.target.value }))}
                  required maxLength={9} pattern="\d{5,9}" placeholder="123456789"
                />
              </div>
              <div className="form-group">
                <label className="form-label">שם מלא *</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="ישראל ישראלי"
                />
              </div>
              <div className="form-group">
                <label className="form-label">אימייל (אופציונלי)</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="teacher@school.edu"
                />
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '⏳ שומר...' : '✅ הוסף'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>
                  ביטול
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
