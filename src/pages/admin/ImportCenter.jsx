import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

export default function ImportCenter() {
  // Tabs: 'teachers' | 'groups' | 'students'
  const [activeTab, setActiveTab] = useState('teachers')
  
  // Universal States
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0, type: '' })
  
  // Missing Teachers Warning (Orphaned Groups)
  const [orphanGroups, setOrphanGroups] = useState([])
  
  // File Parsing States
  const [parsedData, setParsedData] = useState(null) // holds parsed rows before saving
  const [rawRows, setRawRows] = useState([])
  const [fileHeaders, setFileHeaders] = useState([])
  const [mapping, setMapping] = useState({}) // { targetField: fileHeader }
  const [showMapping, setShowMapping] = useState(false)
  const fileRef = useRef()

  // Conflict Resolver States (For Groups Import)
  const [conflicts, setConflicts] = useState([]) // [{ existingGroup, newRow }]
  const [resolvedActions, setResolvedActions] = useState({}) // { groupNumber: 'skip' | 'update' }
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingConfirmGroup, setPendingConfirmGroup] = useState(null) // Group row currently verifying for update
  const [showSecondConfirm, setShowSecondConfirm] = useState(false)

  // Independent Reset/Delete Groups States
  const [showDeleteModal1, setShowDeleteModal1] = useState(false)
  const [showDeleteModal2, setShowDeleteModal2] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    loadOrphanGroups()
  }, [])

  async function loadOrphanGroups() {
    try {
      const { data, error } = await supabase
        .from('student_groups')
        .select('group_number, name')
        .is('teacher_id', null)
      if (!error) {
        setOrphanGroups(data ?? [])
      }
    } catch (err) {
      console.error(err)
    }
  }

  const clearMessages = () => {
    setError('')
    setSuccess('')
    setParsedData(null)
    setRawRows([])
    setFileHeaders([])
    setMapping({})
    setShowMapping(false)
    setConflicts([])
    setProgress({ current: 0, total: 0, type: '' })
  }

  // ─── Auto-detect columns based on synonyms ─────────────────────
  const autoDetectMapping = (headers, type) => {
    const detect = (keywords) => {
      return headers.find(h => 
        keywords.some(kw => String(h).toLowerCase().includes(kw.toLowerCase()))
      ) || ''
    }

    if (type === 'teachers') {
      return {
        name: detect(['שם מורה', 'שם', 'מורה', 'name', 'teacher', 'שם מלא']),
        national_id: detect(['ת.ז', 'תעודת זהות', 'id', 'national'])
      }
    } else if (type === 'groups') {
      return {
        group_number: detect(['מספר קבוצה', 'מספר', 'קבוצה', 'group number', 'group_number', 'group id', 'קוד קבוצה']),
        name: detect(['שם קבוצה', 'מקצוע', 'שם', 'group name', 'subject']),
        teacher_name: detect(['שם המורה', 'שם מורה', 'teacher name', 'teacher_name', 'שם המורה/מלמד']),
        teacher_national_id: detect(['ת.ז. המורה', 'ת.ז מורה', 'ת.ז. מורה', 'teacher id', 'teacher_id', 'ת.ז מורה/מלמד'])
      }
    } else if (type === 'students') {
      return {
        name: detect(['תלמיד', 'שם תלמיד', 'שם', 'שם מלא', 'student name', 'name', 'שם התלמיד']),
        national_id: detect(['ת.ז', 'תעודת זהות', 'ת.ז תלמיד', 'id', 'student id', 'ת.ז. תלמיד']),
        class_name: detect(['כיתת אם', 'כיתה', 'כיתת', 'class', 'classroom', 'כיתת האם']),
        group_number: detect(['מספר', 'קבוצה', 'מספר קבוצה', 'group number', 'קוד קבוצה']),
        group_name: detect(['שם קבוצה', 'מקצוע', 'שם קבוצת לימוד', 'group name', 'subject'])
      }
    }
    return {}
  }

  // ─── File Parser ───────────────────────────────────────────────
  const handleFileChange = async (e, type) => {
    const file = e.target.files[0]
    if (!file) return
    clearMessages()
    setLoading(true)

    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)

      if (rows.length === 0) {
        setError('הקובץ שהועלה ריק.')
        setLoading(false)
        return
      }

      // Extract all headers from the first row
      const headers = Object.keys(rows[0] || {})
      setFileHeaders(headers)
      setRawRows(rows)

      // Initialize mapping auto-detection based on 'type'
      const initialMap = autoDetectMapping(headers, type)
      setMapping(initialMap)
      setShowMapping(true)
    } catch (err) {
      setError('שגיאה בפענוח הקובץ: ' + err.message)
    } finally {
      setLoading(false)
    }
    fileRef.current.value = ''
  }

  const handleMappingChange = (targetField, value) => {
    setMapping(prev => ({ ...prev, [targetField]: value }))
  }

  // ─── Process Mapped Data ───────────────────────────────────────
  const processMappedData = () => {
    if (activeTab === 'teachers') {
      if (!mapping.name || !mapping.national_id) {
        setError('אנא בחר עמודות עבור כל שדות החובה (שם המורה, תעודת זהות).')
        return
      }
      setError('')
      const validRows = rawRows.map(r => ({
        name: String(r[mapping.name] || '').trim(),
        national_id: String(r[mapping.national_id] || '').trim()
      })).filter(r => r.name && r.national_id && r.national_id.length >= 5)

      if (validRows.length === 0) {
        setError('לא נמצאו מורים תקינים עם המיפוי הנוכחי. ודא שהנתונים בעמודות אלו תקינים.')
        return
      }
      setParsedData({ type: 'teachers', rows: validRows })
      setShowMapping(false)
    }

    else if (activeTab === 'groups') {
      if (!mapping.group_number || !mapping.name) {
        setError('אנא בחר עמודות עבור שדות החובה (מספר קבוצה, שם קבוצה).')
        return
      }
      setError('')
      const validRows = rawRows.map(r => ({
        group_number: String(r[mapping.group_number] || '').trim(),
        name: String(r[mapping.name] || '').trim(),
        teacher_name: mapping.teacher_name ? String(r[mapping.teacher_name] || '').trim() : '',
        teacher_national_id: mapping.teacher_national_id ? String(r[mapping.teacher_national_id] || '').trim() : ''
      })).filter(r => r.group_number)

      if (validRows.length === 0) {
        setError('לא נמצאו קבוצות תקינות עם המיפוי הנוכחי.')
        return
      }
      
      checkGroupsConflicts(validRows)
    }

    else if (activeTab === 'students') {
      if (!mapping.name || !mapping.national_id || !mapping.class_name || !mapping.group_number) {
        setError('אנא בחר עמודות עבור כל שדות החובה (שם תלמיד, ת.ז, כיתת אם, מספר קבוצה).')
        return
      }
      setError('')
      const validRows = rawRows.map(r => ({
        name: String(r[mapping.name] || '').trim(),
        national_id: String(r[mapping.national_id] || '').trim(),
        class_name: String(r[mapping.class_name] || '').trim(),
        group_number: String(r[mapping.group_number] || '').trim(),
        group_name: mapping.group_name ? String(r[mapping.group_name] || '').trim() : ''
      })).filter(r => r.name && r.national_id && r.national_id.length >= 5)

      if (validRows.length === 0) {
        setError('לא נמצאו תלמידים תקינים עם המיפוי הנוכחי.')
        return
      }
      setParsedData({ type: 'students', rows: validRows })
      setShowMapping(false)
    }
  }

  // ─── Group Conflict Resolver ──────────────────────────────────
  const checkGroupsConflicts = async (validRows) => {
    setLoading(true)
    try {
      const groupNumbers = validRows.map(r => r.group_number)
      const { data: existingGroups } = await supabase
        .from('student_groups')
        .select('id, group_number, name, teacher_id, teachers(name)')
        .in('group_number', groupNumbers)

      const existingMap = new Map(existingGroups?.map(g => [g.group_number, g]) ?? [])
      const foundConflicts = []
      const defaultActions = {}

      for (const row of validRows) {
        if (existingMap.has(row.group_number)) {
          foundConflicts.push({
            newRow: row,
            existingGroup: existingMap.get(row.group_number)
          })
          defaultActions[row.group_number] = 'skip' // Default is 'skip' for safety!
        }
      }

      if (foundConflicts.length > 0) {
        setConflicts(foundConflicts)
        setResolvedActions(defaultActions)
        setShowConflictModal(true)
      }

      setParsedData({
        type: 'groups',
        rows: validRows
      })
      setShowMapping(false)
    } catch (err) {
      setError('שגיאה במהלך בדיקת התנגשויות קבוצות: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── 1. Save Teachers ──────────────────────────────────────────
  const saveTeachers = async () => {
    if (!parsedData || parsedData.type !== 'teachers') return
    setLoading(true)
    setError('')
    setProgress({ current: 0, total: parsedData.rows.length, type: 'teachers' })
    
    try {
      let inserted = 0, updated = 0
      for (let i = 0; i < parsedData.rows.length; i++) {
        const row = parsedData.rows[i]
        const { data: existing } = await supabase
          .from('teachers')
          .select('id')
          .eq('national_id', row.national_id)
          .maybeSingle()

        if (existing) {
          const { error: patchErr } = await supabase
            .from('teachers')
            .update({ name: row.name })
            .eq('national_id', row.national_id)
          if (!patchErr) updated++
        } else {
          const { error: postErr } = await supabase
            .from('teachers')
            .insert({ name: row.name, national_id: row.national_id })
          if (!postErr) inserted++
        }
        setProgress({ current: i + 1, total: parsedData.rows.length, type: 'teachers' })
      }
      setSuccess(`✅ קליטת המורים הושלמה! יובאו ${inserted} מורים חדשים, ועדכנו ${updated} מורים קיימים.`)
      setParsedData(null)
    } catch (err) {
      setError('שגיאה במהלך השמירה: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── 2. Save Groups ────────────────────────────────────────────
  const handleResolveActionChange = (groupNumber, action) => {
    if (action === 'update') {
      const conflictItem = conflicts.find(c => c.newRow.group_number === groupNumber)
      setPendingConfirmGroup(conflictItem)
      setShowSecondConfirm(true)
    } else {
      setResolvedActions(prev => ({ ...prev, [groupNumber]: 'skip' }))
    }
  }

  const confirmPendingUpdate = () => {
    if (pendingConfirmGroup) {
      const gNum = pendingConfirmGroup.newRow.group_number
      setResolvedActions(prev => ({ ...prev, [gNum]: 'update' }))
    }
    setShowSecondConfirm(false)
    setPendingConfirmGroup(null)
  }

  const cancelPendingUpdate = () => {
    setShowSecondConfirm(false)
    setPendingConfirmGroup(null)
  }

  const saveGroups = async () => {
    setLoading(true)
    setError('')
    setShowConflictModal(false)
    setProgress({ current: 0, total: parsedData.rows.length, type: 'groups' })

    try {
      let created = 0, updated = 0, skipped = 0

      for (let i = 0; i < parsedData.rows.length; i++) {
        const row = parsedData.rows[i]
        const action = resolvedActions[row.group_number]

        // Resolve teacher_id if national_id is provided
        let resolvedTeacherId = null
        if (row.teacher_national_id) {
          const { data: t } = await supabase
            .from('teachers')
            .select('id')
            .eq('national_id', row.teacher_national_id)
            .maybeSingle()
          
          if (t) {
            resolvedTeacherId = t.id
          } else {
            // Auto-create teacher if they don't exist yet
            const newTeacherName = row.teacher_name ? row.teacher_name.trim() : 'מורה חדש'
            const { data: newT, error: createTErr } = await supabase
              .from('teachers')
              .insert({
                name: newTeacherName,
                national_id: row.teacher_national_id
              })
              .select('id')
              .single()
            
            if (!createTErr && newT) {
              resolvedTeacherId = newT.id
            } else {
              console.error('Failed to auto-create teacher:', createTErr)
              throw new Error(`נכשל בהקמת מורה חדש "${newTeacherName}" (ת.ז ${row.teacher_national_id}): ${createTErr?.message || 'שגיאה לא ידועה'}`)
            }
          }
        }

        // If no teacher T.Z. was provided, try matching by teacher name (optional fallback)
        if (!resolvedTeacherId && row.teacher_name) {
          const { data: t } = await supabase
            .from('teachers')
            .select('id')
            .eq('name', row.teacher_name)
            .maybeSingle()
          if (t) {
            resolvedTeacherId = t.id
          }
        }

        // Check if group exists
        const { data: existing } = await supabase
          .from('student_groups')
          .select('id')
          .eq('group_number', row.group_number)
          .maybeSingle()

        if (existing) {
          if (action === 'update') {
            const { error: updErr } = await supabase
              .from('student_groups')
              .update({
                name: `${row.name} (${row.group_number})`,
                teacher_id: resolvedTeacherId,
                subject: row.name
              })
              .eq('group_number', row.group_number)
            if (!updErr) {
              updated++
            } else {
              throw new Error(`נכשל בעדכון קבוצה ${row.group_number}: ${updErr.message}`)
            }
          } else {
            skipped++
          }
        } else {
          // Insert new group
          const { error: insErr } = await supabase
            .from('student_groups')
            .insert({
              group_number: row.group_number,
              name: `${row.name} (${row.group_number})`,
              teacher_id: resolvedTeacherId,
              subject: row.name
            })
          if (!insErr) {
            created++
          } else {
            throw new Error(`נכשל ביצירת קבוצה ${row.group_number}: ${insErr.message}`)
          }
        }
        setProgress({ current: i + 1, total: parsedData.rows.length, type: 'groups' })
      }

      setSuccess(`✅ קליטת הקבוצות הושלמה! נוצרו ${created} קבוצות חדשות, עודכנו ${updated} קבוצות, ודולגו ${skipped} קבוצות קיימות.`)
      setParsedData(null)
      loadOrphanGroups()
    } catch (err) {
      setError('שגיאה במהלך שמירת הקבוצות: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── 3. Save Students ──────────────────────────────────────────
  const saveStudents = async () => {
    if (!parsedData || parsedData.type !== 'students') return
    setLoading(true)
    setError('')
    setProgress({ current: 0, total: parsedData.rows.length, type: 'students' })

    try {
      let stuUpserted = 0, membersLinked = 0, groupsCreated = 0

      for (let i = 0; i < parsedData.rows.length; i++) {
        const row = parsedData.rows[i]
        // 1. Upsert student record
        const { data: stu, error: stuErr } = await supabase
          .from('students')
          .upsert({
            national_id: row.national_id,
            name: row.name,
            class_name: row.class_name
          }, { onConflict: 'national_id' })
          .select('id')
          .single()

        if (stuErr || !stu) {
          console.error('Failed student upsert:', stuErr)
          setProgress({ current: i + 1, total: parsedData.rows.length, type: 'students' })
          continue
        }
        stuUpserted++

        // 2. Resolve/Create Group without teacher_id (NULL) if it doesn't exist
        if (row.group_number) {
          let { data: grp } = await supabase
            .from('student_groups')
            .select('id, name')
            .eq('group_number', row.group_number)
            .maybeSingle()

          const determinedGroupName = row.group_name 
            ? `${row.group_name} (${row.group_number})` 
            : `קבוצה ${row.group_number}`

          if (!grp) {
            // Group doesn't exist – create it with teacher_id = NULL
            const { data: newGrp, error: grpErr } = await supabase
              .from('student_groups')
              .insert({
                group_number: row.group_number,
                name: determinedGroupName,
                subject: row.group_name || null,
                teacher_id: null // Safe: do NOT create teachers from names!
              })
              .select('id')
              .single()

            if (!grpErr && newGrp) {
              grp = newGrp
              groupsCreated++
            } else if (grpErr) {
              throw new Error(`נכשל ביצירת קבוצה חדשה ${row.group_number}: ${grpErr.message}`)
            }
          } else {
            // If group already exists, but has a generic name and we have a specific name now, upgrade it
            if (grp && row.group_name && grp.name === `קבוצה ${row.group_number}`) {
              const { error: updGrpErr } = await supabase
                .from('student_groups')
                .update({
                  name: determinedGroupName,
                  subject: row.group_name
                })
                .eq('id', grp.id)
              
              if (updGrpErr) {
                throw new Error(`נכשל בעדכון שם הקבוצה ${row.group_number}: ${updGrpErr.message}`)
              }
            }
          }

          if (grp) {
            // 3. Upsert student group membership
            const { error: memErr } = await supabase
              .from('student_group_members')
              .upsert({
                group_id: grp.id,
                student_id: stu.id
              }, { onConflict: 'group_id,student_id' })
            
            if (!memErr) {
              membersLinked++
            }
          }
        }
        setProgress({ current: i + 1, total: parsedData.rows.length, type: 'students' })
      }

      setSuccess(`✅ קליטת התלמידים והשיבוצים הושלמה! יובאו/עודכנו ${stuUpserted} תלמידים, נוצרו ${groupsCreated} קבוצות לימוד חדשות (ללא מורה), וקושרו ${membersLinked} שיוכי תלמידים לקבוצות.`)
      setParsedData(null)
      loadOrphanGroups()
    } catch (err) {
      setError('שגיאה במהלך שמירת התלמידים: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Independent Delete All Groups ─────────────────────────────
  const initiateDeleteAllGroups = () => {
    setDeleteConfirmText('')
    setShowDeleteModal1(true)
  }

  const proceedToDelete2 = () => {
    setShowDeleteModal1(false)
    setShowDeleteModal2(true)
  }

  const executeDeleteAllGroups = async () => {
    if (deleteConfirmText !== 'מחק') {
      alert('יש להקליד "מחק" במדויק כדי לאשר.')
      return
    }

    setLoading(true)
    setShowDeleteModal2(false)
    setError('')
    
    try {
      // 1. Delete all student group memberships
      const { error: delMemErr } = await supabase
        .from('student_group_members')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Deletes all

      if (delMemErr) throw delMemErr

      // 2. Delete all student groups
      const { error: delGrpErr } = await supabase
        .from('student_groups')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')

      if (delGrpErr) throw delGrpErr

      setSuccess('🗑️ כל קבוצות הלימוד והשיוכים נמחקו בהצלחה מהמערכת!')
      loadOrphanGroups()
    } catch (err) {
      setError('שגיאה במהלך מחיקת הקבוצות: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">⚙️ מרכז ייבוא נתונים בית ספרי</h2>
        <p className="page-subtitle">ייבוא מרוכז של מורים, קבוצות לימוד ותלמידים מקבצי Excel / CSV ומחיקת נתונים מאובטחת</p>
      </div>

      {/* Orphan groups warnings */}
      {orphanGroups.length > 0 && (
        <div className="alert alert-danger" style={{ marginBottom: 20 }}>
          <h4 style={{ fontWeight: 'bold', marginBottom: 6 }}>⚠️ קיימות {orphanGroups.length} קבוצות לימוד ללא מורה אחראי!</h4>
          <p style={{ fontSize: '0.9rem', marginBottom: 8 }}>
            חלק מהקבוצות נוצרו בעת העלאת קובץ התלמידים. מומלץ להעלות את קובץ הגדרת קבוצות המורים (קובץ 2) על מנת להשלים את שיוך המורים.
          </p>
          <div style={{ maxHeight: 80, overflowY: 'auto', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 8 }}>
            {orphanGroups.map(g => g.group_number).join(', ')}
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="card" style={{ padding: 24, minHeight: 340, position: 'relative' }}>
        
        {/* Navigation Tabs */}
        <div className="flex gap-4 mb-6" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <button 
            className={`btn ${activeTab === 'teachers' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => { setActiveTab('teachers'); clearMessages(); }}
            style={{ fontSize: '0.95rem', padding: '8px 18px', borderRadius: 12 }}
            disabled={loading}
          >
            👩‍🏫 1. ייבוא קובץ מורים
          </button>
          <button 
            className={`btn ${activeTab === 'groups' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => { setActiveTab('groups'); clearMessages(); }}
            style={{ fontSize: '0.95rem', padding: '8px 18px', borderRadius: 12 }}
            disabled={loading}
          >
            🏫 2. ייבוא קבוצות לימוד
          </button>
          <button 
            className={`btn ${activeTab === 'students' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => { setActiveTab('students'); clearMessages(); }}
            style={{ fontSize: '0.95rem', padding: '8px 18px', borderRadius: 12 }}
            disabled={loading}
          >
            👥 3. ייבוא שיבוץ תלמידים
          </button>
          <button 
            className={`btn ${activeTab === 'downloads' ? 'btn-primary' : 'btn-ghost'}`} 
            onClick={() => { setActiveTab('downloads'); clearMessages(); }}
            style={{ fontSize: '0.95rem', padding: '8px 18px', borderRadius: 12 }}
            disabled={loading}
          >
            📥 4. הורדות קובצי התקנה
          </button>
        </div>

        {/* Global Loading Spinner with Progress Bar */}
        {loading && (
          <div className="loading-center" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 16, 0.85)', borderRadius: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <div className="spinner" />
            {progress.total > 0 && (
              <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
                <div style={{ color: 'var(--text-main)', fontSize: '0.95rem', fontWeight: 'bold', marginBottom: 8 }}>
                  {progress.type === 'teachers' && '👩‍🏫 מעבד ומייבא מורים...'}
                  {progress.type === 'groups' && '🏫 מעבד ומייבא קבוצות לימוד...'}
                  {progress.type === 'students' && '👥 מעבד ומייבא תלמידים ושיבוצים...'}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, height: 12, width: '100%', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', height: '100%', width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.15s ease-out' }} />
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
                  שורות שעובדו: {progress.current} מתוך {progress.total} ({Math.round((progress.current / progress.total) * 100)}%)
                </div>
              </div>
            )}
          </div>
        )}

        {/* Success / Error Messages */}
        {error && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ marginBottom: 16 }}>{success}</div>}

        {/* TAB 1: TEACHERS */}
        {activeTab === 'teachers' && !showMapping && !parsedData && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>ייבוא רשימת מורים</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
              העלה קובץ Excel או CSV המכיל את רשימת מורי בית הספר. המערכת תבצע זיהוי אוטומטי של עמודות המפתח ותאפשר לך להתאים אותן ידנית.
            </p>

            <div className="flex gap-4 items-center" style={{ flexWrap: 'wrap' }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer', padding: '12px 24px' }}>
                📂 בחר קובץ מורים
                <input 
                  ref={fileRef}
                  type="file" 
                  accept=".xlsx,.xls,.csv" 
                  style={{ display: 'none' }} 
                  onChange={(e) => handleFileChange(e, 'teachers')}
                  disabled={loading}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>קבצים נתמכים: .xlsx, .xls, .csv</span>
            </div>
          </div>
        )}

        {/* TAB 2: GROUPS */}
        {activeTab === 'groups' && !showMapping && !parsedData && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>ייבוא קבוצות לימוד והגדרת מורים</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
              העלה קובץ הגדרת קבוצות (קובץ 2) המקשר בין <strong>מספר קבוצה</strong>, <strong>שם קבוצה</strong>, לבין <strong>ת.ז. המורה</strong>.
            </p>

            <div className="flex gap-4 items-center" style={{ flexWrap: 'wrap' }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer', padding: '12px 24px' }}>
                📂 בחר קובץ קבוצות ומורים
                <input 
                  ref={fileRef}
                  type="file" 
                  accept=".xlsx,.xls,.csv" 
                  style={{ display: 'none' }} 
                  onChange={(e) => handleFileChange(e, 'groups')}
                  disabled={loading}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>קבצים נתמכים: .xlsx, .xls, .csv</span>
            </div>
          </div>
        )}

        {/* TAB 3: STUDENTS */}
        {activeTab === 'students' && !showMapping && !parsedData && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>ייבוא שיבוץ תלמידים</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
              העלה קובץ שיבוץ תלמידים (קובץ 1) המכיל את <strong>ת.ז. התלמיד</strong>, <strong>כיתת אם</strong> ו-<strong>מספר קבוצה</strong> לצורך שיוך.
            </p>

            <div className="flex gap-4 items-center" style={{ flexWrap: 'wrap' }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer', padding: '12px 24px' }}>
                📂 בחר קובץ תלמידים ושיבוצים
                <input 
                  ref={fileRef}
                  type="file" 
                  accept=".xlsx,.xls,.csv" 
                  style={{ display: 'none' }} 
                  onChange={(e) => handleFileChange(e, 'students')}
                  disabled={loading}
                />
              </label>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>קבצים נתמכים: .xlsx, .xls, .csv</span>
            </div>
          </div>
        )}

        {/* TAB 4: DOWNLOADS */}
        {activeTab === 'downloads' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>מרכז הורדות והתקנות עמדה וסוכן</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 24 }}>
              באפשרותך להוריד את קובצי ההתקנה העדכניים ישירות מכאן לצורך התקנה והקשחה של הטאבלטים והמחשבים הניידים בבית הספר:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              {/* Card 1: Android Kiosk APK */}
              <div className="card" style={{ padding: 20, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'between', height: '100%' }}>
                <div>
                  <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🤖</div>
                  <h4 style={{ color: 'var(--text-main)', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: 8 }}>עמדת השאלה לטאבלט (Android APK)</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>
                    אפליקציה מקורית (APK) להתקנה על גבי טאבלטים של אנדרואיד בעגלה. האפליקציה מקשיחה את הטאבלט, מעלימה את שורות הניווט ומחוות המגע של מערכת ההפעלה, וחוסמת יציאה מהעמדה (ניתן להגדיר כ-Home Launcher ברירת מחדל).
                  </p>
                </div>
                <div style={{ marginTop: 'auto' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>גודל קובץ: 11.8 MB | גרסה: 1.2.0 (ייצור)</div>
                  <a 
                    href="/CartKiosk.apk" 
                    download="CartKiosk.apk" 
                    className="btn btn-primary" 
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', width: '100%', justifyContent: 'center' }}
                  >
                    📥 הורד אפליקציה (CartKiosk.apk)
                  </a>
                  <a 
                    href="/kiosk_setup_instructions.txt" 
                    target="_blank" 
                    rel="noreferrer"
                    className="btn" 
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', width: '100%', justifyContent: 'center', marginTop: 8, background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1' }}
                  >
                    📖 מדריך הקשחה והתקנה (ADB)
                  </a>
                </div>
              </div>

              {/* Card 2: Windows Agent Installer */}
              <div className="card" style={{ padding: 20, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'between', height: '100%' }}>
                <div>
                  <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💻</div>
                  <h4 style={{ color: 'var(--text-main)', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: 8 }}>סוכן נעילת מחשבים (Windows Installer)</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>
                    חבילת התקנה ארגונית עצמאית (Self-contained Installer) הכוללת את ה-Agent, ה-Watchdog ומנהלי ההתקן לנעילת המחשבים הניידים בעגלה. התוכנה מונעת שימוש במחשב של העגלה ללא הזדהות ורישום שיעור פעיל מול השרת.
                  </p>
                </div>
                <div style={{ marginTop: 'auto' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>גודל קובץ: 59.0 MB | גרסה: 4.5.0 (ייצור)</div>
                  <a 
                    href="/setup_agent.exe" 
                    download="setup_agent.exe" 
                    className="btn btn-primary" 
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', width: '100%', justifyContent: 'center' }}
                  >
                    📥 הורד מתקין (setup_agent.exe)
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COLUMN MAPPING INTERACTION PANEL */}
        {showMapping && (
          <div className="card" style={{ marginTop: 8, padding: 20, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              📋 מיפוי עמודות מהקובץ: {activeTab === 'teachers' ? 'ייבוא מורים' : activeTab === 'groups' ? 'ייבוא קבוצות' : 'ייבוא תלמידים'}
            </h4>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 20 }}>
              המערכת זיהתה את העמודות הבאות בקובץ שלך. אנא ודא שכל שדה יעד מקושר לעמודה הנכונה מהקובץ (ניתן לשנות באופן חופשי).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
              {activeTab === 'teachers' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      שם המורה <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.name || ''} 
                      onChange={(e) => handleMappingChange('name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      תעודת זהות <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.national_id || ''} 
                      onChange={(e) => handleMappingChange('national_id', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'groups' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      מספר קבוצה <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.group_number || ''} 
                      onChange={(e) => handleMappingChange('group_number', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      שם הקבוצה / מקצוע <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.name || ''} 
                      onChange={(e) => handleMappingChange('name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      שם המורה <span style={{ color: 'var(--text-muted)' }}>(אופציונלי)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.teacher_name || ''} 
                      onChange={(e) => handleMappingChange('teacher_name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- לא לשייך מורה לפי שם --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      ת.ז. המורה <span style={{ color: 'var(--text-muted)' }}>(אופציונלי)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.teacher_national_id || ''} 
                      onChange={(e) => handleMappingChange('teacher_national_id', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- לא לשייך מורה לפי ת.ז --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'students' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      שם התלמיד <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.name || ''} 
                      onChange={(e) => handleMappingChange('name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      תעודת זהות תלמיד <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.national_id || ''} 
                      onChange={(e) => handleMappingChange('national_id', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      כיתת אם <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.class_name || ''} 
                      onChange={(e) => handleMappingChange('class_name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      מספר קבוצת לימוד <span style={{ color: '#f87171' }}>* (חובה)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.group_number || ''} 
                      onChange={(e) => handleMappingChange('group_number', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- בחר עמודה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: 6, color: 'var(--text-main)' }}>
                      שם קבוצת הלימוד <span style={{ color: 'var(--text-muted)' }}>(אופציונלי)</span>
                    </label>
                    <select 
                      className="form-input" 
                      value={mapping.group_name || ''} 
                      onChange={(e) => handleMappingChange('group_name', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 8 }}
                    >
                      <option value="">-- אל תגדיר שם קבוצה בייבוא זה --</option>
                      {fileHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-4">
              <button className="btn btn-primary" onClick={processMappedData} style={{ minWidth: 200, padding: '10px 24px' }}>
                🔄 אשר מיפוי ועבד נתונים
              </button>
              <button className="btn btn-ghost" onClick={() => { clearMessages(); }}>
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* PREVIEW AND SAVE SCREEN (AFTER MAPPING APPROVED) */}
        {parsedData && (
          <div className="card" style={{ marginTop: 8, padding: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
            <h4 style={{ fontWeight: 'bold', color: 'var(--text-main)', marginBottom: 8 }}>📋 תצוגה מקדימה של נתונים</h4>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              פוענחו בהצלחה **{parsedData.rows.length}** שורות מתוך הקובץ לפי המיפוי המבוקש.
            </p>
            
            {parsedData.type === 'teachers' && (
              <button className="btn btn-primary" onClick={saveTeachers} style={{ width: '100%', maxWidth: 200 }}>
                ✔ אשר וקלוט מורים
              </button>
            )}
            
            {parsedData.type === 'groups' && conflicts.length === 0 && (
              <button className="btn btn-primary" onClick={saveGroups} style={{ width: '100%', maxWidth: 200 }}>
                ✔ אשר וקלוט קבוצות
              </button>
            )}

            {parsedData.type === 'students' && (
              <button className="btn btn-primary" onClick={saveStudents} style={{ width: '100%', maxWidth: 200 }}>
                ✔ אשר וקלוט תלמידים
              </button>
            )}
          </div>
        )}

      </div>

      {/* INDEPENDENT WIPE CARD */}
      <div className="card" style={{ marginTop: 24, border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.02)', padding: 20 }}>
        <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h4 style={{ color: '#f87171', fontWeight: 'bold', fontSize: '1rem', marginBottom: 4 }}>🗑️ אזור מחיקה ואיפוס נתונים</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              באפשרותך למחוק את כל קבוצות הלימוד והשיוכים במערכת לצורך מעבר שנת לימודים. הפעולה אינה מוחקת תלמידים או מורים.
            </p>
          </div>
          <button className="btn" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: 'none' }} onClick={initiateDeleteAllGroups}>
            מחק את כל הקבוצות והשיוכים
          </button>
        </div>
      </div>

      {/* CONFLICT RESOLVER MODAL */}
      {showConflictModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 640, minHeight: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">⚠️ נמצאו התנגשויות קבוצות קיימות</h3>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px', maxHeight: 350, overflowY: 'auto' }}>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                מספרי קבוצות הלימוד הבאים כבר קיימים במערכת. בחר האם **לדלג** (להשאיר את הנתון הישן כפי שהוא) או **לעדכן** (לדרוס בפרטי המורה והשם החדשים):
              </p>
              
              <div className="table-wrapper" style={{ boxShadow: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>קוד קבוצה</th>
                      <th>הקבוצה הקיימת במערכת</th>
                      <th>הפעולה המבוקשת</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map(c => {
                      const gNum = c.newRow.group_number
                      const action = resolvedActions[gNum] || 'skip'
                      return (
                        <tr key={gNum}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{gNum}</td>
                          <td style={{ fontSize: '0.85rem' }}>
                            <strong>{c.existingGroup.name}</strong><br/>
                            <span className="text-muted">מורה: {c.existingGroup.teachers?.name || 'אין'}</span>
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <button 
                                type="button"
                                className={`btn btn-sm ${action === 'skip' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => handleResolveActionChange(gNum, 'skip')}
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              >
                                🛑 דלג
                              </button>
                              <button 
                                type="button"
                                className={`btn btn-sm ${action === 'update' ? 'btn-primary' : 'btn-ghost'}`}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '0.8rem',
                                  background: action === 'update' ? 'rgba(239, 68, 68, 0.2)' : '',
                                  color: action === 'update' ? '#fca5a5' : ''
                                }}
                                onClick={() => handleResolveActionChange(gNum, 'update')}
                              >
                                🔄 עדכן ודרוס
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-primary" onClick={saveGroups}>
                המשך וקלוט קבוצות
              </button>
              <button className="btn btn-ghost" onClick={() => { setShowConflictModal(false); setParsedData(null); }}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECOND CONFIRMATION MODAL FOR CONFLICT GROUP UPDATE */}
      {showSecondConfirm && pendingConfirmGroup && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#ef4444' }}>⚠️ אימות אישור דריסה מבוקשת</h3>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                האם אתה בטוח לחלוטין שברצונך לדרוס ולעדכן את קבוצת הלימוד **{pendingConfirmGroup.newRow.group_number}**? <br/><br/>
                המורה הנוכחי **({pendingConfirmGroup.existingGroup.teachers?.name || 'אין'})** יוחלף במורה החדש מהקובץ **({pendingConfirmGroup.newRow.teacher_name || 'אין'})**.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" style={{ background: '#ef4444', color: '#fff' }} onClick={confirmPendingUpdate}>
                כן, אני בטוח
              </button>
              <button className="btn btn-ghost" onClick={cancelPendingUpdate}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WIPE MODAL 1: PRE-CONFIRM */}
      {showDeleteModal1 && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#ef4444' }}>⚠️ מחיקת כל קבוצות הלימוד והשיוכים</h3>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                אתה עומד למחוק את כל קבוצות הלימוד והשיוכים של התלמידים במערכת.<br/><br/>
                <strong>פעולה זו לא תמחק את התלמידים או המורים עצמם</strong>, אלא רק את הקבוצות והשיוכים אליהן. האם ברצונך להמשיך?
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" style={{ background: '#ef4444', color: '#fff' }} onClick={proceedToDelete2}>
                המשך
              </button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal1(false)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WIPE MODAL 2: FINAL CONFIRM WITH VERIFY TYPING */}
      {showDeleteModal2 && (
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#ef4444' }}>🚨 אזהרה סופית מוחלטת!</h3>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: '0.92rem', color: 'var(--text-main)', marginBottom: 16 }}>
                פעולה זו תמחק לצמיתות את כל קבוצות הלימוד ולא ניתן לבטל אותה.<br/><br/>
                כדי לאשר את המחיקה הסופית, הקלד את המילה <strong>מחק</strong> בתיבה הבאה:
              </p>
              <input 
                className="form-input text-center" 
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder='הקלד "מחק"'
                style={{ fontSize: '1.1rem', fontWeight: 'bold', borderColor: '#ef4444' }}
              />
            </div>
            <div className="modal-footer">
              <button 
                className="btn" 
                style={{ background: '#ef4444', color: '#fff', opacity: deleteConfirmText === 'מחק' ? 1 : 0.5 }} 
                onClick={executeDeleteAllGroups}
                disabled={deleteConfirmText !== 'מחק'}
              >
                אשר ומחק הכל סופית
              </button>
              <button className="btn btn-ghost" onClick={() => setShowDeleteModal2(false)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
