import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

export default function Students() {
  const [activeTab, setActiveTab] = useState('students') // 'students' | 'groups'
  
  // Students state
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

  // Groups state
  const [groups, setGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [searchGroup, setSearchGroup] = useState('')
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  
  // Group members modal state
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [groupMembers, setGroupMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [studentToAdd, setStudentToAdd] = useState('')

  useEffect(() => {
    load()
    loadGroups()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('students').select('*').order('class_name').order('name')
    setStudents(data ?? [])
    setLoading(false)
  }

  async function loadGroups() {
    setLoadingGroups(true)
    const { data } = await supabase
      .from('student_groups')
      .select('*, student_group_members(student_id)')
      .order('name')
    setGroups(data ?? [])
    setLoadingGroups(false)
  }

  async function loadGroupMembers(groupId) {
    setLoadingMembers(true)
    const { data, error } = await supabase
      .from('student_group_members')
      .select('student_id, students(*)')
      .eq('group_id', groupId)
    if (!error) {
      setGroupMembers(data ?? [])
    }
    setLoadingMembers(false)
  }

  const filteredStudents = students.filter(s =>
    s.name.includes(search) ||
    s.national_id.includes(search) ||
    (s.class_name || '').includes(search)
  )

  const filteredGroups = groups.filter(g =>
    g.name.includes(searchGroup) ||
    (g.description || '').includes(searchGroup)
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
    loadGroups() // Member counts might change
    if (selectedGroup) {
      loadGroupMembers(selectedGroup.id)
    }
  }

  async function handleAddGroup(e) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setError('')
    setSavingGroup(true)
    const { error: err } = await supabase.from('student_groups').insert({
      name: newGroupName.trim(),
      description: newGroupDesc.trim()
    })
    setSavingGroup(false)
    if (err) { setError(err.message); return }
    setNewGroupName('')
    setNewGroupDesc('')
    setShowAddGroup(false)
    loadGroups()
  }

  async function deleteGroup(id) {
    if (!confirm('האם למחוק קבוצה זו? מחיקת הקבוצה לא תמחק את התלמידים עצמם.')) return
    await supabase.from('student_groups').delete().eq('id', id)
    if (selectedGroup?.id === id) {
      setSelectedGroup(null)
    }
    loadGroups()
  }

  async function addStudentToGroup(e) {
    e.preventDefault()
    if (!studentToAdd || !selectedGroup) return
    const { error: err } = await supabase.from('student_group_members').insert({
      group_id: selectedGroup.id,
      student_id: studentToAdd
    })
    if (err) { alert('תלמיד זה כבר חבר בקבוצה או שחלה שגיאה: ' + err.message); return }
    setStudentToAdd('')
    loadGroupMembers(selectedGroup.id)
    loadGroups()
  }

  async function removeStudentFromGroup(studentId) {
    if (!selectedGroup) return
    if (!confirm('האם להסיר תלמיד זה מהקבוצה?')) return
    await supabase.from('student_group_members').delete().eq('group_id', selectedGroup.id).eq('student_id', studentId)
    loadGroupMembers(selectedGroup.id)
    loadGroups()
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
        group_name:  String(r['קבוצה'] || r['group'] || r['שם קבוצה'] || '').trim()
      })).filter(r => r.national_id && r.name)

      let inserted = 0, skipped = 0
      for (const row of toInsert) {
        // 1. Upsert Student
        const { data: stuData, error: stuErr } = await supabase
          .from('students')
          .upsert({
            national_id: row.national_id,
            name: row.name,
            class_name: row.class_name,
            grade: row.grade
          }, { onConflict: 'national_id' })
          .select('id')
          .single()

        if (stuErr || !stuData) {
          skipped++
          continue
        }

        inserted++

        // 2. Associate with Group if provided
        if (row.group_name) {
          // Check/Create group
          let { data: grp } = await supabase
            .from('student_groups')
            .select('id')
            .eq('name', row.group_name)
            .maybeSingle()

          if (!grp) {
            const { data: newGrp } = await supabase
              .from('student_groups')
              .insert({ name: row.group_name })
              .select('id')
              .single()
            grp = newGrp
          }

          if (grp) {
            // Upsert group membership
            await supabase
              .from('student_group_members')
              .upsert({ group_id: grp.id, student_id: stuData.id }, { onConflict: 'group_id,student_id' })
          }
        }
      }
      setImportResult({ inserted, skipped, total: toInsert.length })
      load()
      loadGroups()
    } catch (err) {
      setImportResult({ error: err.message })
    }
    setImporting(false)
    fileRef.current.value = ''
  }

  // Find students not currently in the active group
  const existingMemberIds = new Set(groupMembers.map(m => m.student_id))
  const eligibleStudents = students.filter(s => !existingMemberIds.has(s.id))

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">👥 ניהול תלמידים וקבוצות</h2>
        <p className="page-subtitle">ניהול רשימת התלמידים, קבוצות הלמידה וייבוא ממנב"ס</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <button 
          className={`btn ${activeTab === 'students' ? 'btn-primary' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('students')}
          style={{ fontSize: '1rem', padding: '8px 20px', borderRadius: 12 }}
        >
          👥 רשימת תלמידים
        </button>
        <button 
          className={`btn ${activeTab === 'groups' ? 'btn-primary' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('groups')}
          style={{ fontSize: '1rem', padding: '8px 20px', borderRadius: 12 }}
        >
          🏫 קבוצות למידה
        </button>
      </div>

      {activeTab === 'students' ? (
        <>
          {/* Actions bar */}
          <div className="flex items-center justify-between mb-4 gap-3" style={{ flexWrap: 'wrap' }}>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                + הוסף תלמיד
              </button>
              <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                {importing ? '⏳ מייבא...' : '📂 ייבא מ-Excel/מנב"ס'}
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
                : `✅ יובאו ${importResult.inserted} מתוך ${importResult.total} תלמידים. ${importResult.skipped} דולגו (או עודכנו בהצלחה).`}
            </div>
          )}

          {/* Excel format hint */}
          <div className="alert alert-info" style={{ marginBottom: 16, fontSize: '0.8rem' }}>
            💡 פורמט קובץ Excel: עמודות <strong>תעודת זהות</strong>, <strong>שם</strong>, <strong>כיתה</strong>, <strong>שכבה</strong>, <strong>קבוצה</strong> (אופציונלי - לקישור אוטומטי לקבוצת למידה)
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0 }}>
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : filteredStudents.length === 0 ? (
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
                    {filteredStudents.map(s => (
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
        </>
      ) : (
        <>
          {/* Groups Main view */}
          <div className="flex items-center justify-between mb-4 gap-3" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setShowAddGroup(true)}>
              + יצר קבוצת למידה
            </button>
            <input
              className="form-input"
              style={{ maxWidth: 280 }}
              placeholder="🔍 חיפוש קבוצה..."
              value={searchGroup}
              onChange={e => setSearchGroup(e.target.value)}
            />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {loadingGroups ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : filteredGroups.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🏫</div>
                <p>לא נמצאו קבוצות למידה</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>שם קבוצה</th>
                      <th>תיאור</th>
                      <th>חברים בקבוצה</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroups.map(g => (
                      <tr key={g.id}>
                        <td style={{ fontWeight: 600 }}>{g.name}</td>
                        <td className="text-muted">{g.description || '—'}</td>
                        <td>
                          <span className="badge badge-success" style={{ cursor: 'pointer' }} onClick={() => { setSelectedGroup(g); loadGroupMembers(g.id); }}>
                            👥 {g.student_group_members?.length || 0} תלמידים
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedGroup(g); loadGroupMembers(g.id); }} style={{ color: '#3b82f6' }}>
                              📝 נהל חברים
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-light)' }} onClick={() => deleteGroup(g.id)}>
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
        </>
      )}

      {/* Add Student Modal */}
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

      {/* Add Group Modal */}
      {showAddGroup && (
        <div className="modal-overlay" onClick={() => setShowAddGroup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">➕ יצר קבוצת למידה</h3>
              <button className="modal-close" onClick={() => setShowAddGroup(false)}>✕</button>
            </div>
            <form onSubmit={handleAddGroup}>
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-group">
                <label className="form-label">שם הקבוצה *</label>
                <input className="form-input" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} required placeholder="למשל: הקבצה א מתמטיקה" />
              </div>
              <div className="form-group">
                <label className="form-label">תיאור</label>
                <textarea className="form-input" style={{ minHeight: 80 }} value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} placeholder="קבוצת למידה במקצוע..." />
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary" disabled={savingGroup}>{savingGroup ? '⏳ שומר...' : '✅ יצר קבוצה'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddGroup(false)}>ביטול</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Members Management Modal */}
      {selectedGroup && (
        <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🏫 ניהול חברי קבוצה: {selectedGroup.name}</h3>
              <button className="modal-close" onClick={() => setSelectedGroup(null)}>✕</button>
            </div>
            
            {/* Add member form */}
            <form onSubmit={addStudentToGroup} className="flex gap-2 mb-4 items-end" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
              <div className="form-group w-full" style={{ marginBottom: 0 }}>
                <label className="form-label">הוסף תלמיד לקבוצה</label>
                <select 
                  className="form-input" 
                  value={studentToAdd} 
                  onChange={e => setStudentToAdd(e.target.value)}
                >
                  <option value="">-- בחר תלמיד להוספה --</option>
                  {eligibleStudents.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} (ת.ז. {s.national_id} {s.class_name ? `| כיתה ${s.class_name}` : ''})
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={!studentToAdd} style={{ height: 46 }}>
                ➕ הוסף
              </button>
            </form>

            {/* Members List */}
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <h4 style={{ color: 'var(--text-main)', marginBottom: 8, fontSize: '0.9rem', fontWeight: 700 }}>חברי הקבוצה הנוכחיים:</h4>
              
              {loadingMembers ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : groupMembers.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>אין תלמידים בקבוצה זו עדיין.</p>
              ) : (
                <div className="table-wrapper" style={{ boxShadow: 'none', background: 'transparent' }}>
                  <table style={{ background: 'transparent' }}>
                    <thead>
                      <tr>
                        <th>שם תלמיד</th>
                        <th>כיתה</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupMembers.map(m => (
                        <tr key={m.student_id}>
                          <td style={{ fontWeight: 600 }}>{m.students?.name}</td>
                          <td><span className="badge badge-info">{m.students?.class_name || '—'}</span></td>
                          <td>
                            <button 
                              type="button" 
                              className="btn btn-ghost btn-sm" 
                              style={{ color: 'var(--danger-light)', padding: 4 }} 
                              onClick={() => removeStudentFromGroup(m.student_id)}
                            >
                              🗑️ הסר
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setSelectedGroup(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
