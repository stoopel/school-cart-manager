import { useState, useEffect, useCallback, useRef } from 'react'
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
function LessonCard({ lesson, teacher, now, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [preAssigned, setPreAssigned] = useState([])
  const [loadingAssign, setLoadingAssign] = useState(false)

  const isScheduled = lesson.status === 'scheduled'
  const startTs = new Date(lesson.start_time).getTime()
  const endTs   = new Date(lesson.end_time).getTime()
  const nowTs   = now.getTime()
  const secUntilStart = (startTs - nowTs) / 1000
  const secRemaining  = (endTs   - nowTs) / 1000

  useEffect(() => {
    if (isScheduled && secUntilStart <= 0) {
      supabase.from('lessons').update({ status: 'active' }).eq('id', lesson.id)
        .then(() => onRefresh())
    }
  }, [isScheduled, secUntilStart, onRefresh, lesson.id])

  const loadAssignments = useCallback(async () => {
    setLoadingAssign(true)
    const { data: lpa } = await supabase
      .from('lesson_pre_assignments')
      .select('student_id, students(name, class_name)')
      .eq('lesson_id', lesson.id)

    const { data: lp } = await supabase
      .from('lesson_participants')
      .select('student_id')
      .eq('lesson_id', lesson.id)

    const participantSet = new Set(lp?.map(p => p.student_id) ?? [])
    
    setPreAssigned((lpa ?? []).map(item => ({
      student_id: item.student_id,
      name: item.students?.name ?? 'תלמיד',
      class_name: item.students?.class_name ?? '',
      isPresent: participantSet.has(item.student_id)
    })))
    setLoadingAssign(false)
  }, [lesson.id])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  useEffect(() => {
    const channel = supabase
      .channel(`lesson-participants-${lesson.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_participants', filter: `lesson_id=eq.${lesson.id}` }, () => {
        loadAssignments()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [lesson.id, loadAssignments])

  async function act(update) {
    setBusy(true)
    await supabase.from('lessons').update(update).eq('id', lesson.id)
    setBusy(false); onRefresh()
  }

  async function extendLesson(minutes) {
    setBusy(true)
    const currentEndTime = new Date(lesson.end_time)
    const newEndTime = new Date(currentEndTime.getTime() + minutes * 60000)
    const newDuration = (lesson.duration_minutes || 45) + minutes
    await supabase.from('lessons')
      .update({ 
        end_time: newEndTime.toISOString(),
        duration_minutes: newDuration 
      })
      .eq('id', lesson.id)
    setBusy(false)
    onRefresh()
  }

  const isLocked = lesson.is_locked
  const progressPercent = Math.min(100, ((nowTs - startTs) / (endTs - startTs)) * 100)

  return (
    <div className="editorial-card rounded-lg p-5 relative overflow-hidden border-t-4 border-t-primary transition-all">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-primary font-headline font-bold text-lg">{lesson.subject || 'שיעור כללי'}</h3>
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border mt-1.5 font-body ${
            isScheduled 
              ? 'bg-blue-50 text-blue-700 border-blue-200' 
              : 'bg-green-50 text-green-700 border-green-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isScheduled ? 'bg-blue-500' : 'bg-green-600'}`}></span>
            {isScheduled ? 'מתוכנן' : 'פעיל'}
          </span>
        </div>
        <div className="text-left">
          <div className="font-headline text-4xl font-bold text-on-surface tracking-tighter">
            {lesson.lesson_code}
          </div>
          <div className="text-[10px] text-gray-400 uppercase font-body">קוד כניסה</div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Timer / Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-body">
            {isScheduled ? (
              <span className="text-primary font-semibold">{fmtTimeUntil(secUntilStart)}</span>
            ) : (
              <span className="text-primary font-semibold">{fmtCountdown(secRemaining)} נשאר</span>
            )}
            <span className="text-gray-400">
              {isScheduled ? `יתחיל ב- ${new Date(lesson.start_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : `${lesson.duration_minutes}:00 סה"כ`}
            </span>
          </div>
          {!isScheduled && (
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
            </div>
          )}
        </div>

        {/* Connections Info */}
        <div className="flex items-center gap-1.5 text-xs text-on-surface font-body py-2 border-y border-gray-100">
          <span className="material-symbols-outlined text-sm text-gray-400">groups</span>
          <span>{lesson.participant_count ?? 0} מחשבים מחוברים</span>
        </div>

        {/* Buttons */}
        {!isScheduled ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => act({ is_locked: !isLocked })}
                disabled={busy}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-body transition-all active:scale-[0.98] ${
                  isLocked
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="material-symbols-outlined text-sm">{isLocked ? 'lock_open' : 'lock'}</span>
                {isLocked ? 'שחרר' : 'נעל'}
              </button>
              <button
                onClick={() => { if (confirm('לסיים שיעור?')) act({ status: 'ended' }) }}
                disabled={busy}
                className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-body hover:bg-red-100 active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-sm">stop_circle</span>
                סיים
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button
                onClick={() => extendLesson(15)}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-body hover:bg-indigo-100 active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-sm">more_time</span>
                הארך ב-15 דק'
              </button>
              <button
                onClick={() => extendLesson(30)}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-body hover:bg-indigo-100 active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-sm">more_time</span>
                הארך ב-30 דק'
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => { if (confirm('לבטל שיעור מתוכנן זה?')) act({ status: 'cancelled' }) }}
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-body hover:bg-red-100 active:scale-[0.98] transition-all"
          >
            🗑️ ביטול שיעור מתוכנן
          </button>
        )}

        {/* Pre-assign button */}
        <button
          onClick={() => setShowAssignModal(true)}
          className="w-full py-3 rounded-lg bg-gray-50 border border-dashed border-gray-300 text-xs text-gray-500 font-body flex items-center justify-center gap-2 hover:bg-gray-100 transition-all"
        >
          <span className="material-symbols-outlined text-sm">person_add</span>
          שייך כיתה / קבוצה / תלמידים
        </button>
      </div>

      {/* Live Attendance Panel inside Card */}
      {preAssigned.length > 0 && (
        <div className="mt-6 pt-5 border-t border-gray-100 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-headline font-semibold text-on-surface text-sm">נוכחות דיגיטלית חיה</h2>
            <span className="text-[10px] bg-primary/5 text-primary border border-primary/20 px-2 py-0.5 rounded-lg font-body">
              {preAssigned.filter(p => p.isPresent).length} / {preAssigned.length} נוכחים
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-[155px] overflow-y-auto custom-scrollbar pr-1">
            {preAssigned.map(p => (
              <div key={p.student_id} className={`bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between transition-all ${p.isPresent ? 'opacity-100' : 'opacity-50'}`}>
                <span className="text-xs font-body text-on-surface truncate max-w-[80%]" title={p.name}>{p.name}</span>
                <span className={`w-2 h-2 rounded-full ${p.isPresent ? 'bg-green-500' : 'bg-red-400'}`}></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign Modal component */}
      {showAssignModal && (
        <PreAssignModal
          lesson={lesson}
          teacher={teacher}
          onClose={() => setShowAssignModal(false)}
          onRefresh={loadAssignments}
        />
      )}
    </div>
  )
}

// ── Is Mobile Hook ─────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  return isMobile
}

// ── Custom SearchSelect Dropdown ──────────────────────────────
function SearchSelect({ 
  placeholder, 
  options, 
  value, 
  onChange, 
  isMulti = false, 
  emptyText = "לא נמצאו תוצאות" 
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [openUpward, setOpenUpward] = useState(false)
  const containerRef = useRef(null)
  const isMobile = useIsMobile()
  
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return
      if (e.target.closest('.bottom-sheet-backdrop') || e.target.closest('.bottom-sheet-container')) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const toggleOpen = (e) => {
    e.stopPropagation()
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 340 && rect.top > spaceBelow) {
        setOpenUpward(true)
      } else {
        setOpenUpward(false)
      }
    }
    setIsOpen(!isOpen)
  }

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    (opt.subtitle && opt.subtitle.toLowerCase().includes(search.toLowerCase()))
  )

  const handleSelect = (optVal) => {
    if (isMulti) {
      const currentValues = Array.isArray(value) ? value : []
      if (currentValues.includes(optVal)) {
        onChange(currentValues.filter(v => v !== optVal))
      } else {
        onChange([...currentValues, optVal])
      }
    } else {
      onChange(optVal)
      setIsOpen(false)
      setSearch('')
    }
  }

  const handleSelectAll = () => {
    if (!isMulti) return
    const currentValues = Array.isArray(value) ? value : []
    const filteredVals = filteredOptions.map(o => o.value)
    const allSelected = filteredVals.every(v => currentValues.includes(v))

    if (allSelected) {
      onChange(currentValues.filter(v => !filteredVals.includes(v)))
    } else {
      onChange(Array.from(new Set([...currentValues, ...filteredVals])))
    }
  }

  let displayLabel = placeholder
  if (isMulti) {
    const currentValues = Array.isArray(value) ? value : []
    if (currentValues.length === 1) {
      const selectedOpt = options.find(opt => opt.value === currentValues[0])
      displayLabel = selectedOpt ? selectedOpt.label : placeholder
    } else if (currentValues.length > 1) {
      displayLabel = `נבחרו ${currentValues.length} פריטים`
    }
  } else {
    const selectedOpt = options.find(opt => opt.value === value)
    displayLabel = selectedOpt ? selectedOpt.label : placeholder
  }

  return (
    <div ref={containerRef} className="custom-select-container relative flex-1 min-w-0 max-w-full w-full font-body">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-10 pl-3 py-2.5 text-xs text-right text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none flex items-center justify-between transition-all"
      >
        <span className="truncate font-semibold">{displayLabel}</span>
        <span className="material-symbols-outlined text-gray-400 text-base absolute right-3 pointer-events-none">arrow_drop_down</span>
      </button>

      {/* Desktop Dropdown */}
      {isOpen && !isMobile && (
        <div className={`absolute right-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 space-y-2 max-h-[320px] flex flex-col ${
          openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          <div className="relative flex-shrink-0">
            <input
              type="text"
              placeholder="חפש ברשימה..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-8 pl-2 py-1.5 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none text-on-surface placeholder-gray-400 font-body"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
            <span className="material-symbols-outlined absolute right-2.5 top-2 text-gray-400 text-xs pointer-events-none">search</span>
          </div>

          {isMulti && filteredOptions.length > 0 && (
            <button 
              type="button" 
              onClick={handleSelectAll} 
              className="flex items-center gap-1.5 py-1 px-2 hover:bg-gray-50 rounded text-right font-body text-[10px] text-primary font-semibold flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[12px]">
                {filteredOptions.every(o => (Array.isArray(value) ? value : []).includes(o.value)) ? 'deselect' : 'select_all'}
              </span>
              {filteredOptions.every(o => (Array.isArray(value) ? value : []).includes(o.value)) ? 'בטל בחירת הכל' : 'בחר את כל התוצאות'}
            </button>
          )}

          <div className="overflow-y-auto custom-scrollbar flex-1 space-y-0.5">
            {filteredOptions.length === 0 ? (
              <div className="text-[10px] text-gray-400 text-center py-3">{emptyText}</div>
            ) : (
              filteredOptions.map(opt => {
                const isSelected = isMulti 
                  ? (Array.isArray(value) && value.includes(opt.value))
                  : value === opt.value

                return (
                  <div
                    key={opt.value}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelect(opt.value)
                    }}
                    className={`px-3 py-2 text-[11px] rounded-md cursor-pointer hover:bg-gray-50 text-on-surface flex items-center justify-between transition-all ${
                      isSelected ? 'bg-primary/5 text-primary font-semibold' : ''
                    }`}
                  >
                    <div className="flex flex-col text-right truncate">
                      <span className="truncate">{opt.label}</span>
                      {opt.subtitle && (
                        <span className="text-[9px] text-gray-400 font-body mt-0.5">{opt.subtitle}</span>
                      )}
                    </div>
                    {isMulti ? (
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        isSelected ? 'bg-primary border-primary text-white' : 'border-gray-300'
                      }`}>
                        {isSelected && <span className="material-symbols-outlined text-[10px] font-bold">check</span>}
                      </div>
                    ) : (
                      isSelected && <span className="material-symbols-outlined text-primary text-[11px] flex-shrink-0">check</span>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {isMulti && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsOpen(false)
                setSearch('')
              }}
              className="w-full py-2 bg-primary text-white rounded-md font-headline font-bold text-[10px] hover:opacity-90 transition-opacity flex-shrink-0"
            >
              אישור בחירה ({(Array.isArray(value) ? value : []).length})
            </button>
          )}
        </div>
      )}

      {/* Mobile Bottom Sheet */}
      {isOpen && isMobile && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bottom-sheet-backdrop" style={{ background: 'rgba(27, 28, 29, 0.4)', backdropFilter: 'blur(4px)' }} onClick={() => setIsOpen(false)}>
          <div 
            className="w-full bg-white rounded-t-2xl shadow-2xl p-4 pb-8 space-y-4 max-h-[85vh] flex flex-col bottom-sheet-container transform translate-y-0 transition-transform duration-300 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-1 flex-shrink-0" />
            
            <div className="flex justify-between items-center flex-shrink-0">
              <h4 className="text-sm font-headline font-bold text-on-surface">{placeholder}</h4>
              <button onClick={() => setIsOpen(false)} className="material-symbols-outlined text-gray-400 text-lg hover:text-on-surface">close</button>
            </div>

            <div className="relative flex-shrink-0">
              <input
                type="text"
                placeholder="חפש ברשימה..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pr-8 pl-2 py-2 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none text-on-surface placeholder-gray-400 font-body"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-gray-400 text-sm pointer-events-none">search</span>
            </div>

            {isMulti && filteredOptions.length > 0 && (
              <button 
                type="button" 
                onClick={handleSelectAll} 
                className="flex items-center gap-2 py-2 px-3 hover:bg-gray-50 rounded-lg text-right font-body text-xs text-primary font-semibold flex-shrink-0"
              >
                <span className="material-symbols-outlined text-sm">
                  {filteredOptions.every(o => (Array.isArray(value) ? value : []).includes(o.value)) ? 'deselect' : 'select_all'}
                </span>
                {filteredOptions.every(o => (Array.isArray(value) ? value : []).includes(o.value)) ? 'בטל בחירת הכל' : 'בחר את כל התוצאות'}
              </button>
            )}

            <div className="overflow-y-auto custom-scrollbar flex-1 space-y-1">
              {filteredOptions.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-6">{emptyText}</div>
              ) : (
                filteredOptions.map(opt => {
                  const isSelected = isMulti 
                    ? (Array.isArray(value) && value.includes(opt.value))
                    : value === opt.value

                  return (
                    <div
                      key={opt.value}
                      onClick={() => handleSelect(opt.value)}
                      className={`px-3 py-3 text-xs rounded-lg cursor-pointer hover:bg-gray-50 text-on-surface flex items-center justify-between transition-all ${
                        isSelected ? 'bg-primary/5 text-primary font-semibold' : ''
                      }`}
                    >
                      <div className="flex flex-col text-right truncate">
                        <span className="truncate">{opt.label}</span>
                        {opt.subtitle && (
                          <span className="text-[10px] text-gray-400 font-body mt-0.5">{opt.subtitle}</span>
                        )}
                      </div>
                      {isMulti ? (
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                          isSelected ? 'bg-primary border-primary text-white' : 'border-gray-300'
                        }`}>
                          {isSelected && <span className="material-symbols-outlined text-sm font-bold">check</span>}
                        </div>
                      ) : (
                        isSelected && <span className="material-symbols-outlined text-primary text-sm flex-shrink-0">check</span>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {isMulti && (
              <button
                type="button"
                onClick={() => { setIsOpen(false); setSearch('') }}
                className="w-full py-3 bg-primary text-white rounded-lg font-headline font-bold text-xs hover:opacity-90 transition-opacity flex-shrink-0 mt-2"
              >
                אישור בחירה (נבחרו {(Array.isArray(value) ? value : []).length})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PreAssignModal ─────────────────────────────────────────────
function PreAssignModal({ lesson, teacher, onClose, onRefresh }) {
  const [classes, setClasses] = useState([])
  const [groups, setGroups] = useState([])
  const [students, setStudents] = useState([])
  const [selectedClasses, setSelectedClasses] = useState([])
  const [selectedGroups, setSelectedGroups] = useState([])
  const [selectedStudents, setSelectedStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const { data: stuClasses } = await supabase.from('students').select('class_name')
      const classSet = new Set(
        stuClasses?.map(s => s.class_name)
          .filter(Boolean)
          .filter(c => c !== 'מורה' && c !== 'מורים') ?? []
      )
      setClasses(Array.from(classSet).sort())

      const { data: grps } = await supabase.from('student_groups').select('id, name, teacher_id').order('name')
      setGroups(grps ?? [])

      // Exclude teachers from the list of students for selection
      const { data: stus } = await supabase.from('students').select('id, name, national_id, class_name').order('name')
      const filteredStus = stus?.filter(s => s.class_name !== 'מורה' && s.class_name !== 'מורים') ?? []
      setStudents(filteredStus)
      setLoading(false)
    }
    loadData()
  }, [])

  async function assignClass(e) {
    e.preventDefault()
    if (!selectedClasses || selectedClasses.length === 0) return
    setSaving(true)
    try {
      const { data: existing } = await supabase.from('lesson_pre_assignments').select('student_id').eq('lesson_id', lesson.id)
      const existingIds = existing?.map(ex => ex.student_id) ?? []

      const { data: classStus } = await supabase.from('students').select('id').in('class_name', selectedClasses)
      const newIds = classStus?.map(s => s.id) ?? []

      const combinedIds = Array.from(new Set([...existingIds, ...newIds]))

      const { error } = await supabase.rpc('secure_pre_assign_students', {
        entered_teacher_id: teacher.national_id,
        target_lesson_id: lesson.id,
        student_ids: combinedIds
      })
      if (error) throw error
    } catch (err) {
      alert('שגיאה בשיוך כיתה: ' + err.message)
    } finally {
      setSaving(false)
      onRefresh()
      onClose()
    }
  }

  async function assignGroup(e) {
    e.preventDefault()
    if (!selectedGroups || selectedGroups.length === 0) return
    setSaving(true)
    try {
      const { data: existing } = await supabase.from('lesson_pre_assignments').select('student_id').eq('lesson_id', lesson.id)
      const existingIds = existing?.map(ex => ex.student_id) ?? []

      const { data: groupStus } = await supabase.from('student_group_members').select('student_id').in('group_id', selectedGroups)
      const newIds = groupStus?.map(s => s.student_id) ?? []

      const combinedIds = Array.from(new Set([...existingIds, ...newIds]))

      const { error } = await supabase.rpc('secure_pre_assign_students', {
        entered_teacher_id: teacher.national_id,
        target_lesson_id: lesson.id,
        student_ids: combinedIds
      })
      if (error) throw error
    } catch (err) {
      alert('שגיאה בשיוך קבוצה: ' + err.message)
    } finally {
      setSaving(false)
      onRefresh()
      onClose()
    }
  }

  async function assignStudent(e) {
    e.preventDefault()
    if (!selectedStudents || selectedStudents.length === 0) return
    setSaving(true)
    try {
      const { data: existing } = await supabase.from('lesson_pre_assignments').select('student_id').eq('lesson_id', lesson.id)
      const existingIds = existing?.map(ex => ex.student_id) ?? []

      const combinedIds = Array.from(new Set([...existingIds, ...selectedStudents]))

      const { error } = await supabase.rpc('secure_pre_assign_students', {
        entered_teacher_id: teacher.national_id,
        target_lesson_id: lesson.id,
        student_ids: combinedIds
      })
      if (error) throw error
    } catch (err) {
      alert('שגיאה בשיוך תלמיד: ' + err.message)
    } finally {
      setSaving(false)
      onRefresh()
      onClose()
    }
  }

  // Format dropdown options with subtitles
  const classOptions = classes.map(c => ({ value: c, label: c }))
  
  const groupOptions = [
    ...groups.filter(g => g.teacher_id === teacher.id).map(g => ({
      value: g.id,
      label: g.name,
      subtitle: "⭐ קבוצת הלימוד שלי"
    })),
    ...groups.filter(g => g.teacher_id !== teacher.id).map(g => ({
      value: g.id,
      label: g.name,
      subtitle: "🏫 קבוצת בית הספר"
    }))
  ]

  const studentOptions = students.map(s => ({
    value: s.id,
    label: s.name,
    subtitle: `ת.ז. ${s.national_id} ${s.class_name ? `| כיתה ${s.class_name}` : ''}`
  }))

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-10 modal-overlay" onClick={onClose}>
      <div className="w-full max-w-md editorial-card rounded-lg p-6 space-y-6 transition-all" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-headline font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">person_add</span>
            שיוך כיתה / קבוצה
          </h3>
          <button onClick={onClose} className="material-symbols-outlined text-gray-400 hover:text-on-surface transition-colors">close</button>
        </div>

        {loading ? (
          <div className="text-gray-500 text-center py-8 font-body">טוען אפשרויות שיוך...</div>
        ) : (
          <div className="space-y-5">
            {/* Class Option */}
            <form onSubmit={assignClass} className="border-b border-gray-100 pb-4 space-y-2">
              <label className="text-xs text-gray-500 block px-1 font-body">שייך כיתה שלמה (בחירה מרובה)</label>
              <div className="flex gap-2">
                <SearchSelect
                  placeholder="-- בחר כיתה --"
                  options={classOptions}
                  value={selectedClasses}
                  onChange={setSelectedClasses}
                  isMulti={true}
                  emptyText="לא נמצאו כיתות תואמות"
                />
                <button type="submit" disabled={saving || selectedClasses.length === 0} className="py-2 px-4 rounded-lg bg-primary text-white text-xs font-bold font-headline hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0">שייך</button>
              </div>
            </form>

            {/* Group Option */}
            <form onSubmit={assignGroup} className="border-b border-gray-100 pb-4 space-y-2">
              <label className="text-xs text-gray-500 block px-1 font-body">שייך קבוצת למידה (בחירה מרובה)</label>
              <div className="flex gap-2">
                <SearchSelect
                  placeholder="-- בחר קבוצה --"
                  options={groupOptions}
                  value={selectedGroups}
                  onChange={setSelectedGroups}
                  isMulti={true}
                  emptyText="לא נמצאו קבוצות תואמות"
                />
                <button type="submit" disabled={saving || selectedGroups.length === 0} className="py-2 px-4 rounded-lg bg-primary text-white text-xs font-bold font-headline hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0">שייך</button>
              </div>
            </form>

            {/* Individual Student Option */}
            <form onSubmit={assignStudent} className="space-y-2">
              <label className="text-xs text-gray-500 block px-1 font-body">שייך תלמידים בודדים (בחירה מרובה)</label>
              <div className="flex gap-2">
                <SearchSelect
                  placeholder="-- בחר תלמיד --"
                  options={studentOptions}
                  value={selectedStudents}
                  onChange={setSelectedStudents}
                  isMulti={true}
                  emptyText="לא נמצאו תלמידים תואמים"
                />
                <button type="submit" disabled={saving || selectedStudents.length === 0} className="py-2 px-4 rounded-lg bg-primary text-white text-xs font-bold font-headline hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0">שייך</button>
              </div>
            </form>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-gray-100 transition-colors">סגור</button>
        </div>
      </div>
    </div>
  )
}

// ── Open Lesson Form ───────────────────────────────────────────
function OpenLessonForm({ teacher, onCreated, onCancel }) {
  const DURATIONS = [30, 45, 60, 90]
  const [subject,  setSubject]  = useState('')
  const [presetDuration, setPresetDuration] = useState(45)
  const [customDuration, setCustomDuration] = useState('')
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
      if (startDt < new Date()) startDt.setDate(startDt.getDate() + 1)
    }

    const durationVal = customDuration ? Math.max(1, Number(customDuration) || 0) : presetDuration
    const endDt = new Date(startDt.getTime() + durationVal * 60000)
    const status = startMode === 'now' ? 'active' : 'scheduled'

    const { error } = await supabase.from('lessons').insert({
      teacher_id:       teacher.id,
      lesson_code:      code,
      subject:          subject.trim() || null,
      duration_minutes: durationVal,
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
    <div className="text-center py-6 space-y-4">
      <div className="text-gray-500 text-xs font-semibold font-body">קוד השיעור שיוצר:</div>
      <div className="font-headline text-5xl font-extrabold text-on-surface tracking-widest py-2">
        {newCode}
      </div>
      <div className="text-xs text-gray-500 font-body">
        {startMode === 'now'
          ? 'מסור קוד זה לתלמידים – השיעור פעיל עכשיו'
          : `מסור קוד זה לתלמידים – יתחיל בשעה ${startTime}`}
      </div>
      <button onClick={onCancel} className="w-full py-3.5 bg-primary rounded-lg font-bold text-white text-sm hover:opacity-90 transition-opacity font-headline">סגור חלונית</button>
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Subject */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-500 px-1 font-body block">נושא השיעור</label>
        <input
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none font-body text-on-surface placeholder-gray-400"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder='הקלד נושא (למשל: תנ"ך, אנגלית, מתמטיקה...)'
        />
      </div>

      {/* Duration */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-500 px-1 font-body block">משך זמן (דקות)</label>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {DURATIONS.map(d => (
            <button key={d} type="button"
              onClick={() => {
                setPresetDuration(d)
                setCustomDuration('')
              }}
              className={`px-4 py-2 rounded-lg border text-xs font-body whitespace-nowrap transition-all ${
                presetDuration === d && !customDuration
                  ? 'bg-primary text-white border-primary'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}>
              {d}
            </button>
          ))}
          <input
            type="number"
            placeholder="ידני ✍️"
            className="w-16 px-2 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-center outline-none focus:border-primary font-body"
            value={customDuration}
            onChange={e => {
              setCustomDuration(e.target.value)
              setPresetDuration(null)
            }}
            min={1}
          />
        </div>
      </div>

      {/* Start Mode Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setStartMode('now')}
          className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-body transition-all border ${
            startMode === 'now'
              ? 'bg-primary-container/10 border-primary-container text-primary font-semibold'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          ◀️ עכשיו
        </button>
        <button
          type="button"
          onClick={() => setStartMode('scheduled')}
          className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-body transition-all border ${
            startMode === 'scheduled'
              ? 'bg-primary-container/10 border-primary-container text-primary font-semibold'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          🕐 שעה ספציפית
        </button>
      </div>

      {/* Scheduled Time options */}
      {startMode === 'scheduled' && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap gap-2">
            {QUICK.map(q => (
              <button key={q.value} type="button"
                onClick={() => setStartTime(q.value)}
                className={`px-3 py-1.5 rounded-full border text-[10px] font-semibold transition-all ${
                  startTime === q.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                }`}>
                {q.label}
              </button>
            ))}
          </div>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-center text-sm font-mono text-on-surface focus:border-primary outline-none"
          />
        </div>
      )}

      {/* Submit Button */}
      <button type="submit" disabled={saving}
        className="w-full py-4 bg-primary rounded-lg font-bold text-white transition-all font-headline hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
      >
        {saving ? '⏳ פותח שיעור...' : startMode === 'now' ? 'פתח שיעור' : 'תזמן שיעור'}
      </button>

      {onCancel && (
        <button type="button" onClick={onCancel}
          className="w-full py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-xs font-semibold hover:bg-gray-100 transition-colors"
        >
          ביטול
        </button>
      )}
    </form>
  )
}

// ── Teacher Login ──────────────────────────────────────────────
function TeacherLogin({ onLogin }) {
  const [id, setId]       = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Check for one-time login token in URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      // Clean URL immediately so token is never saved in browser history
      window.history.replaceState({}, '', window.location.pathname)
      setLoading(true)
      fetch('/api/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem_token', token })
      })
        .then(r => r.json())
        .then(json => {
          setLoading(false)
          if (json.isValid && json.teacher) {
            onLogin({ id: json.teacher.id, name: json.teacher.name, national_id: json.teacher.national_id })
          } else {
            setError(json.error || 'אסימון הכניסה פג תוקף או שאינו תקין.')
          }
        })
        .catch(err => {
          setLoading(false)
          setError('שגיאה בחיבור לשרת: ' + err.message)
        })
    }
  }, [onLogin])

  async function submit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('verify_teacher_id', { entered_id: id.trim() })
    setLoading(false)
    if (rpcError || !data || !data.is_valid) { setError('תעודת זהות לא נמצאה במערכת.'); return }
    onLogin({ id: data.teacher_id, name: data.teacher_name, national_id: id.trim() })
  }

  return (
    <div className="flex items-center justify-center min-h-[90vh] px-4 font-headline">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="text-5xl animate-bounce">🏫</div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight font-headline">פורטל מורים</h1>
          <p className="text-gray-400 text-xs font-medium font-body">ניהול שיעורים דיגיטלי מתקדם</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="editorial-card rounded-lg p-6 border border-gray-200 shadow-xl space-y-4">
            <label className="text-xs text-gray-500 font-semibold block px-1 font-body">הקש תעודת זהות לכניסה</label>
            <input
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3.5 text-lg font-mono text-center tracking-widest text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none"
              type="number"
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="123456789"
              autoFocus
            />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-center text-xs font-semibold font-body">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="w-full py-4 bg-primary rounded-lg font-bold text-white transition-all font-headline hover:opacity-90 active:scale-[0.99] disabled:opacity-50">
            {loading ? '⏳ בודק...' : 'כניסה למערכת ←'}
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

  // Group Management States
  const [tab, setTab] = useState('dashboard') // 'dashboard' | 'groups'
  const [myGroups, setMyGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [groupMembersToEdit, setGroupMembersToEdit] = useState(null)
  const [selectedStudentIds, setSelectedStudentIds] = useState([])
  const [savingMembers, setSavingMembers] = useState(false)
  const [students, setStudents] = useState([])

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

  useEffect(() => {
    const ch = supabase
      .channel(`teacher-${teacher.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load, teacher.id])

  // Groups and Students Loaders
  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    const { data: grps } = await supabase
      .from('student_groups')
      .select('*, student_group_members(student_id)')
      .eq('teacher_id', teacher.id)
      .order('name')
    
    const formatted = grps?.map(g => ({
      ...g,
      memberCount: g.student_group_members?.length || 0,
      memberIds: g.student_group_members?.map(m => m.student_id) || []
    })) ?? []
    
    setMyGroups(formatted)
    setLoadingGroups(false)
  }, [teacher.id])

  useEffect(() => {
    if (tab === 'groups') {
      loadGroups()
    }
  }, [tab, loadGroups])

  useEffect(() => {
    async function loadStudents() {
      const { data } = await supabase
        .from('students')
        .select('id, name, national_id, class_name')
        .order('name')
      const filtered = data?.filter(s => s.class_name !== 'מורה' && s.class_name !== 'מורים') ?? []
      setStudents(filtered)
    }
    loadStudents()
  }, [])

  // Actions
  async function handleCreateGroup(e) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setSavingGroup(true)
    const { data, error } = await supabase.rpc('secure_create_teacher_group', {
      entered_teacher_id: teacher.national_id,
      group_name: newGroupName.trim()
    })
    setSavingGroup(false)
    if (error || (data && !data.success)) {
      alert('שגיאה ביצירת קבוצה: ' + (error?.message || data?.error || 'שגיאה לא ידועה'))
      return
    }
    setNewGroupName('')
    setShowAddGroup(false)
    loadGroups()
  }

  async function handleDeleteGroup(groupId, groupName) {
    if (!confirm(`האם אתה בטוח שברצונך למחוק את הקבוצה "${groupName}"?`)) return
    const { data, error } = await supabase.rpc('secure_delete_teacher_group', {
      entered_teacher_id: teacher.national_id,
      target_group_id: groupId
    })
    if (error || (data && !data.success)) {
      alert('שגיאה במחיקת קבוצה: ' + (error?.message || data?.error))
      return
    }
    loadGroups()
  }

  async function handleSaveMembers() {
    setSavingMembers(true)
    const { data, error } = await supabase.rpc('secure_set_group_members', {
      entered_teacher_id: teacher.national_id,
      target_group_id: groupMembersToEdit.id,
      student_ids: selectedStudentIds
    })
    setSavingMembers(false)
    if (error || (data && !data.success)) {
      alert('שגיאה בשמירת תלמידים: ' + (error?.message || data?.error))
      return
    }
    setGroupMembersToEdit(null)
    loadGroups()
  }

  const studentOptions = students.map(s => ({
    value: s.id,
    label: s.name,
    subtitle: `ת.ז. ${s.national_id} ${s.class_name ? `| כיתה ${s.class_name}` : ''}`
  }))

  const active    = lessons.filter(l => l.status === 'active')
  const scheduled = lessons.filter(l => l.status === 'scheduled')

  return (
    <div className="min-h-screen bg-background">
      {/* Header matching Stitch Mockup */}
      <header className="bg-white sticky top-0 z-40 w-full px-5 h-16 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg border border-gray-200 overflow-hidden flex items-center justify-center bg-gray-50 text-xl">
            🎓
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-headline font-bold text-on-surface">👋 שלום, {teacher.name}</h1>
            <span className="text-[10px] text-primary flex items-center gap-1 font-body font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              {active.length > 0 ? `${active.length} שיעורים פעילים` : 'אין שיעורים פעילים'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onLogout} className="bg-gray-50 px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-100 transition-all font-body">
            יציאה
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="px-5 pt-4 pb-20 max-w-md mx-auto space-y-6">
        {tab === 'dashboard' ? (
          <>
            {/* Open new lesson card */}
            {!showForm && (
              <button onClick={() => setShowForm(true)} className="w-full py-4 bg-primary rounded-lg font-bold text-white transition-all font-headline hover:opacity-90 active:scale-[0.99] text-center shadow-md">
                + פתח שיעור חדש כעת
              </button>
            )}

            {/* Open lesson form inside editorial-card */}
            {showForm && (
              <section className="editorial-card rounded-lg p-5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-primary">add_circle</span>
                  <h2 className="font-headline font-semibold text-lg text-on-surface">פתח שיעור חדש</h2>
                </div>
                <OpenLessonForm
                  teacher={teacher}
                  onCreated={() => { load(); setShowForm(false) }}
                  onCancel={() => setShowForm(false)}
                />
              </section>
            )}

            {loading ? (
              <div className="text-center text-gray-500 text-xs py-12 font-body">טוען את השיעורים...</div>
            ) : (
              <div className="space-y-6">
                {/* Active lessons */}
                {active.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-gray-400 text-[10px] font-bold tracking-wider uppercase px-1 font-body">
                      שיעורים פעילים
                    </div>
                    <div className="space-y-4">
                      {active.map(l => (
                        <LessonCard key={l.id} lesson={l} teacher={teacher} now={now} onRefresh={load} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Scheduled lessons */}
                {scheduled.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-gray-400 text-[10px] font-bold tracking-wider uppercase px-1 font-body">
                      שיעורים מתוכננים
                    </div>
                    <div className="space-y-4">
                      {scheduled.map(l => (
                        <LessonCard key={l.id} lesson={l} teacher={teacher} now={now} onRefresh={load} />
                      ))}
                    </div>
                  </div>
                )}

                {active.length === 0 && scheduled.length === 0 && !showForm && (
                  <div className="text-center text-gray-500 py-16 bg-white border border-gray-200 rounded-lg shadow-sm space-y-3 font-body">
                    <div className="text-4xl">📚</div>
                    <h3 className="text-on-surface font-headline font-bold text-base">אין שיעורים פעילים או מתוכננים</h3>
                    <p className="text-xs text-gray-400">לחץ על הכפתור למעלה כדי לפתוח שיעור חדש.</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-6">
            {/* Manage Groups Header & Create Button */}
            <div className="flex justify-between items-center">
              <h2 className="font-headline font-bold text-xl text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">groups</span>
                קבוצות הלימוד שלי
              </h2>
              {!showAddGroup && (
                <button 
                  onClick={() => setShowAddGroup(true)} 
                  className="py-2 px-4 bg-primary text-white text-xs font-bold font-headline rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  קבוצה חדשה
                </button>
              )}
            </div>

            {/* Create New Group Card */}
            {showAddGroup && (
              <form onSubmit={handleCreateGroup} className="editorial-card rounded-lg p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-primary">add_circle</span>
                  <h3 className="font-headline font-semibold text-base text-on-surface">יצירת קבוצה חדשה</h3>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-gray-500 font-body block px-1">שם הקבוצה</label>
                  <input
                    type="text"
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none font-body text-on-surface placeholder-gray-400"
                    placeholder='למשל: הקבצה א מתמטיקה, אנגלית ט1 וכד...'
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                  />
                </div>
                <div className="flex gap-2.5">
                  <button 
                    type="submit" 
                    disabled={savingGroup || !newGroupName.trim()} 
                    className="flex-1 py-2.5 bg-primary text-white rounded-lg text-xs font-bold font-headline hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {savingGroup ? '⏳ מייצר...' : 'צור קבוצה'}
                  </button>
                  <button 
                    type="button" 
                    onClick={() => { setShowAddGroup(false); setNewGroupName('') }} 
                    className="px-4 py-2.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </form>
            )}

            {/* Groups List */}
            {loadingGroups ? (
              <div className="text-center text-gray-500 text-xs py-12 font-body">טוען קבוצות...</div>
            ) : myGroups.length === 0 ? (
              <div className="text-center text-gray-500 py-16 bg-white border border-gray-200 rounded-lg shadow-sm space-y-3 font-body">
                <div className="text-4xl">👥</div>
                <h3 className="text-on-surface font-headline font-bold text-base">אין קבוצות רשומות</h3>
                <p className="text-xs text-gray-400">לחץ על כפתור "קבוצה חדשה" כדי ליצור את הקבוצה הראשונה שלך.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {myGroups.map(g => {
                  const isCreator = g.created_by_teacher_id === teacher.id
                  return (
                    <div key={g.id} className="editorial-card rounded-lg p-5 space-y-4 relative overflow-hidden transition-all border-t-2 border-t-primary">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <h3 className="text-primary font-headline font-bold text-base">{g.name}</h3>
                          <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full border bg-gray-50 text-gray-500 font-body">
                            קוד קבוצה: {g.group_number}
                          </span>
                        </div>
                        <div className="text-left">
                          <div className="font-headline text-2xl font-bold text-on-surface tracking-tighter">
                            {g.memberCount}
                          </div>
                          <div className="text-[9px] text-gray-400 uppercase font-body">תלמידים רשומים</div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <button
                          onClick={() => {
                            setGroupMembersToEdit(g)
                            setSelectedStudentIds(g.memberIds || [])
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold font-body hover:bg-gray-100 transition-all active:scale-[0.98]"
                        >
                          <span className="material-symbols-outlined text-xs">edit</span>
                          ערוך תלמידים
                        </button>
                        {isCreator ? (
                          <button
                            onClick={() => handleDeleteGroup(g.id, g.name)}
                            className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-semibold font-body hover:bg-red-100 transition-all active:scale-[0.98]"
                          >
                            <span className="material-symbols-outlined text-xs">delete</span>
                            מחק קבוצה
                          </button>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-50 border border-gray-150 text-gray-400 text-xs font-medium font-body select-none">
                            <span>🛡️ קבוצה מנהלתית</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Edit Group Members Modal */}
      {groupMembersToEdit && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-10 modal-overlay" onClick={() => setGroupMembersToEdit(null)}>
          <div className="w-full max-w-md editorial-card rounded-lg p-6 space-y-6 transition-all max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div className="flex justify-between items-center flex-shrink-0">
              <h3 className="text-base font-headline font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">edit</span>
                עריכת תלמידים בקבוצה: {groupMembersToEdit.name}
              </h3>
              <button onClick={() => setGroupMembersToEdit(null)} className="material-symbols-outlined text-gray-400 hover:text-on-surface transition-colors">close</button>
            </div>

            {/* Multi-Select Student Search */}
            <div className="space-y-2 flex-shrink-0">
              <label className="text-xs text-gray-500 block px-1 font-body">הוסף/הסר תלמידים לקבוצה</label>
              <SearchSelect
                placeholder="🔍 חפש ובחר תלמידים..."
                options={studentOptions}
                value={selectedStudentIds}
                onChange={setSelectedStudentIds}
                isMulti={true}
                emptyText="לא נמצאו תלמידים תואמים"
              />
            </div>

            {/* Selected Members List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-0">
              <h4 className="text-xs font-semibold text-gray-400 px-1 pt-1 font-body">תלמידים בקבוצה ({selectedStudentIds.length}):</h4>
              {selectedStudentIds.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200 font-body">אין תלמידים משוייכים לקבוצה זו כרגע.</div>
              ) : (
                <div className="space-y-1.5">
                  {selectedStudentIds.map(sid => {
                    const s = students.find(stud => stud.id === sid)
                    if (!s) return null
                    return (
                      <div key={sid} className="bg-gray-50 border border-gray-200 rounded-lg py-2 px-3 flex items-center justify-between transition-all">
                        <div className="flex flex-col text-right truncate">
                          <span className="text-xs font-bold text-on-surface truncate">{s.name}</span>
                          <span className="text-[10px] text-gray-400 font-body">ת.ז. {s.national_id} {s.class_name ? `| כיתה ${s.class_name}` : ''}</span>
                        </div>
                        <button
                          onClick={() => setSelectedStudentIds(selectedStudentIds.filter(id => id !== sid))}
                          className="material-symbols-outlined text-red-400 hover:text-red-600 text-sm p-1 hover:bg-red-50 rounded-full transition-colors"
                          title="הסר מהקבוצה"
                        >
                          delete
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex gap-2.5 flex-shrink-0 pt-2 border-t border-gray-100">
              <button
                onClick={handleSaveMembers}
                disabled={savingMembers}
                className="flex-1 py-3 bg-primary text-white rounded-lg text-xs font-bold font-headline hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {savingMembers ? '⏳ שומר שינויים...' : 'שמור שינויים'}
              </button>
              <button
                onClick={() => setGroupMembersToEdit(null)}
                className="px-5 py-3 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 h-16 px-16 flex items-center justify-around z-50">
        <button 
          onClick={() => setTab('dashboard')} 
          className={`flex flex-col items-center gap-1 transition-colors ${tab === 'dashboard' ? 'text-primary font-bold' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <span className="material-symbols-outlined text-2xl">dashboard</span>
          <span className="text-[10px] font-medium font-body">ראשי</span>
        </button>
        <button 
          onClick={() => setTab('groups')} 
          className={`flex flex-col items-center gap-1 transition-colors ${tab === 'groups' ? 'text-primary font-bold' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <span className="material-symbols-outlined text-2xl">groups</span>
          <span className="text-[10px] font-medium font-body">ניהול קבוצות</span>
        </button>
      </nav>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────
export default function TeacherAppPremium() {
  const [teacher, setTeacher] = useState(null)
  const [tailwindLoaded, setTailwindLoaded] = useState(false)

  // Scroll to top automatically on successful login to prevent viewport keyboard scroll bugs
  useEffect(() => {
    if (teacher) {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [teacher])

  // Dynamically load Tailwind Config, custom fonts and CSS rules to strictly inherit Stitch styling
  useEffect(() => {
    // 1. Google Fonts
    const fontsLink = document.createElement('link')
    fontsLink.href = "https://fonts.googleapis.com/css2?family=Noto+Serif:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Public+Sans:wght@300;400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
    fontsLink.rel = "stylesheet"
    fontsLink.id = "fonts-premium-stitch"
    document.head.appendChild(fontsLink)

    // 2. Tailwind Script CDN
    const tailwindScript = document.createElement('script')
    tailwindScript.src = "https://cdn.tailwindcss.com?plugins=forms,container-queries"
    tailwindScript.id = "tailwind-cdn-premium-stitch"
    
    // Safety Event Listener: Execute tailwind config ONLY after tailwind runtime script has fully loaded!
    tailwindScript.onload = () => {
      if (window.tailwind) {
        window.tailwind.config = {
          darkMode: "class",
          theme: {
            extend: {
              colors: {
                "surface-container-highest": "#e3e2e3",
                "on-secondary-fixed-variant": "#42474b",
                "surface-container-low": "#f5f3f4",
                "on-surface": "#1b1c1d",
                "secondary": "#5a5f63",
                "on-surface-variant": "#434653",
                "tertiary-container": "#bfab49",
                "primary-container": "#3366cc",
                "error-container": "#ffdad6",
                "background": "#f9fafb",
                "on-primary-container": "#e7ebff",
                "tertiary-fixed-dim": "#dcc661",
                "primary-fixed-dim": "#b1c5ff",
                "outline": "#737784",
                "on-tertiary-container": "#4a3f00",
                "on-primary-fixed-variant": "#00419d",
                "surface": "#ffffff",
                "secondary-container": "#dfe3e8",
                "on-primary-fixed": "#001946",
                "surface-tint": "#2259bf",
                "inverse-surface": "#303031",
                "surface-variant": "#e3e2e3",
                "inverse-on-surface": "#f2f0f1",
                "inverse-primary": "#b1c5ff",
                "tertiary-fixed": "#f9e37a",
                "secondary-fixed": "#dfe3e8",
                "on-error": "#ffffff",
                "error": "#ba1a1a",
                "surface-container-lowest": "#ffffff",
                "surface-bright": "#faf9fa",
                "primary": "#3366cc",
                "on-background": "#1b1c1d",
                "secondary-fixed-dim": "#c2c7cc",
                "on-tertiary-fixed-variant": "#524600",
                "on-error-container": "#93000a",
                "surface-dim": "#dbdadb",
                "outline-variant": "#c3c6d5",
                "on-secondary": "#ffffff",
                "on-secondary-fixed": "#171c20",
                "primary-fixed": "#d9e2ff",
                "tertiary": "#6d5e00",
                "surface-container-high": "#e9e8e9",
                "on-secondary-container": "#606569",
                "surface-container": "#efedee",
                "on-primary": "#ffffff",
                "on-tertiary-fixed": "#211b00",
                "on-tertiary": "#ffffff"
              },
              borderRadius: {
                "DEFAULT": "0.125rem",
                "lg": "0.25rem",
                "xl": "0.5rem",
                "full": "0.75rem"
              },
              spacing: {
                "gutter": "20px",
                "section-gap": "24px"
              },
              fontFamily: {
                "headline": ["Noto Serif", "serif"],
                "display": ["Noto Serif", "serif"],
                "body": ["Inter", "sans-serif"],
                "label": ["Public Sans", "sans-serif"]
              }
            }
          }
        }
        setTailwindLoaded(true)
      }
    }
    document.head.appendChild(tailwindScript)

    // 4. Custom CSS overrides
    const customStyle = document.createElement('style')
    customStyle.id = "custom-styles-premium-stitch"
    customStyle.textContent = `
      body {
        background-color: #f9fafb !important;
        min-height: 100vh;
        color: #1b1c1d !important;
        font-family: 'Noto Serif', serif !important;
      }
      .editorial-card {
        background: #ffffff !important;
        border: 1px solid #e5e7eb !important;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
      }
      .modal-overlay {
        background: rgba(27, 28, 29, 0.4) !important;
        backdrop-filter: blur(4px) !important;
      }
      .no-scrollbar::-webkit-scrollbar {
        display: none;
      }
      .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 5px !important;
        height: 5px !important;
        display: block !important;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.03) !important;
        border-radius: 4px !important;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #cbd5e1 !important;
        border-radius: 4px !important;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #94a3b8 !important;
      }
      .custom-scrollbar {
        scrollbar-width: thin !important;
        scrollbar-color: #cbd5e1 rgba(0, 0, 0, 0.03) !important;
      }
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
      .animate-slide-up {
        animation: slideUp 0.25s ease-out forwards;
      }
    `
    document.head.appendChild(customStyle)

    // Apply unique wrapper style to root
    document.body.classList.add('premium-stitch-active')

    return () => {
      document.getElementById('tailwind-cdn-premium-stitch')?.remove()
      document.getElementById('fonts-premium-stitch')?.remove()
      document.getElementById('custom-styles-premium-stitch')?.remove()
      document.body.classList.remove('premium-stitch-active')
    }
  }, [])

  if (!tailwindLoaded) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
        color: '#1b1c1d',
        direction: 'rtl'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #e5e7eb',
            borderTopColor: '#3366cc',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <div style={{ fontSize: '14px', fontWeight: '500' }}>טוען ממשק פרימיום יוקרתי...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  return (
    <div className="premium-stitch-wrapper dir-rtl text-on-background min-h-screen pb-24 font-body select-none">
      {!teacher ? (
        <TeacherLogin onLogin={setTeacher} />
      ) : (
        <TeacherDashboard teacher={teacher} onLogout={() => setTeacher(null)} />
      )}
    </div>
  )
}
