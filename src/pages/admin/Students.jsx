import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

export default function Students() {
  const [students, setStudents] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [form, setForm]         = useState({ national_id: '', name: '', class_name: '', grade: '' })
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const fileRef = useRef()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('students').select('*').order('class_name').order('name')
    setStudents(data ?? [])
    setLoading(false)
  }

  const filtered = students.filter(s =>
    s.name.includes(search) ||
    s.national_id.includes(search) ||
    (s.class_name || '').includes(search)
  )

  async function addStudent(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const { error: err } = await supabase.from('students').insert({
      national_id: form.national_id.trim(),
      name: form.name.trim(),
      class_name: form.class_name.trim(),
      grade: form.grade ? Number(form.grade) : null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowAdd(false)
    setForm({ national_id: '', name: '', class_name: '', grade: '' })
    load()
  }

  async function deleteStudent(id) {
    if (!confirm('האם למחוק תלמיד זה?')) return
    await supabase.from('students').delete().eq('id', id)
    load()
  }

  async function handleExcelImport(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf)
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)

      const toInsert = rows.map(r => ({
        national_id: String(r['תעודת זהות'] || r['ת.ז.'] || r['id'] || '').trim(),
        name:        String(r['שם'] || r['שם מלא'] || r['name'] || '').trim(),
        class_name:  String(r['כיתה'] || r['class'] || '').trim(),
        grade:       Number(r['שכבה'] || r['grade'] || 0) || null,
      })).filter(r => r.national_id && r.name)

      let inserted = 0, skipped = 0
      for (const row of toInsert) {
        const { error } = await supabase.from('students').upsert(row, { onConflict: 'national_id', ignoreDuplicates: false })
        if (error) skipped++
        else inserted++
      }
      setImportResult({ inserted, skipped, total: toInsert.length })
      load()
    } catch (err) {
      setImportResult({ error: err.message })
    }
    setImporting(false)
    fileRef.current.value = ''
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">👥 ניהול תלמידים</h2>
        <p className="page-subtitle">{students.length} תלמידים רשומים במערכת</p>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between mb-4 gap-3" style={{ flexWrap: 'wrap' }}>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + הוסף תלמיד
          </button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            {importing ? '⏳ מייבא...' : '📂 ייבא מ-Excel'}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleExcelImport}
              disabled={importing}
            />
          </label>
        </div>
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="🔍 חיפוש לפי שם / ת.ז. / כיתה"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Import result */}
      {importResult && (
        <div className={`alert ${importResult.error ? 'alert-danger' : 'alert-success'}`} style={{ marginBottom: 16 }}>
          {importResult.error
            ? `❌ שגיאה: ${importResult.error}`
            : `✅ יובאו ${importResult.inserted} מתוך ${importResult.total} תלמידים. ${importResult.skipped} דולגו.`}
        </div>
      )}

      {/* Excel format hint */}
      <div className="alert alert-info" style={{ marginBottom: 16, fontSize: '0.8rem' }}>
        💡 פורמט קובץ Excel: עמודות <strong>תעודת זהות</strong>, <strong>שם</strong>, <strong>כיתה</strong>, <strong>שכבה</strong> (אופציונלי)
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            <p>לא נמצאו תלמידים</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>שם תלמיד</th>
                  <th>תעודת זהות</th>
                  <th>כיתה</th>
                  <th>שכבה</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>{s.national_id}</td>
                    <td><span className="badge badge-info">{s.class_name || '—'}</span></td>
                    <td className="text-muted">{s.grade || '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-light)' }} onClick={() => deleteStudent(s.id)}>
                        🗑️
                      </button>
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
              <h3 className="modal-title">➕ הוסף תלמיד</h3>
              <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={addStudent}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">תעודת זהות *</label>
                <input className="form-input" value={form.national_id} onChange={e => setForm(f => ({ ...f, national_id: e.target.value }))} required maxLength={9} pattern="\d{5,9}" placeholder="123456789" />
              </div>
              <div className="form-group">
                <label className="form-label">שם מלא *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="ישראל ישראלי" />
              </div>
              <div className="flex gap-3">
                <div className="form-group w-full">
                  <label className="form-label">כיתה</label>
                  <input className="form-input" value={form.class_name} onChange={e => setForm(f => ({ ...f, class_name: e.target.value }))} placeholder="ח'2" />
                </div>
                <div className="form-group w-full">
                  <label className="form-label">שכבה</label>
                  <input className="form-input" type="number" value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))} placeholder="8" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳ שומר...' : '✅ הוסף'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>ביטול</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
