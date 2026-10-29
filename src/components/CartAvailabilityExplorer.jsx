import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

export default function CartAvailabilityExplorer({ teacher, onBookLesson, onRefreshLessons }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().slice(0, 10)
  })

  const [periods, setPeriods] = useState([])
  const [carts, setCarts] = useState([])
  const [lessons, setLessons] = useState([])
  const [recurringRules, setRecurringRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    loadData()
  }, [selectedDate])

  async function loadData() {
    setLoading(true)
    try {
      // 1. Fetch school periods
      const { data: pData } = await supabase
        .from('school_periods')
        .select('*')
        .eq('is_active', true)
        .order('period_number', { ascending: true })

      setPeriods(pData || [])

      // 2. Fetch active carts with devices
      const { data: cData } = await supabase
        .from('carts')
        .select('id, name, total_devices, devices(id, status, is_charging, battery_level)')
        .is('deleted_at', null)
        .order('name', { ascending: true })

      setCarts(cData || [])

      // 3. Fetch lessons for selected date
      // We look for lessons that start or end on selectedDate
      const startOfDay = new Date(`${selectedDate}T00:00:00Z`).toISOString()
      const endOfDay = new Date(`${selectedDate}T23:59:59Z`).toISOString()

      const { data: lData } = await supabase
        .from('lessons')
        .select('id, teacher_id, teacher_name, subject, class_name, start_time, end_time, status, cart_id, lesson_code')
        .neq('status', 'cancelled')
        .gte('end_time', startOfDay)
        .lte('start_time', endOfDay)

      setLessons(lData || [])

      // 4. Fetch approved recurring rules for this day of week
      const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay()
      const { data: rData } = await supabase
        .from('recurring_lessons_overview')
        .select('*')
        .eq('is_active', true)
        .eq('status', 'approved')
        .eq('day_of_week', dayOfWeek)

      setRecurringRules(rData || [])
    } catch (err) {
      console.error('Error loading availability data:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function changeDay(deltaDays) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + deltaDays)
    setSelectedDate(d.toISOString().slice(0, 10))
  }

  function setToday() {
    setSelectedDate(new Date().toISOString().slice(0, 10))
  }

  const formattedDateHebrew = useMemo(() => {
    try {
      const d = new Date(selectedDate + 'T12:00:00')
      const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
      const dayName = days[d.getDay()]
      const isToday = selectedDate === new Date().toISOString().slice(0, 10)
      const datePart = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `יום ${dayName}, ${datePart} ${isToday ? '(היום)' : ''}`
    } catch {
      return selectedDate
    }
  }, [selectedDate])

  // Helper to determine status of a cart during a specific period
  function getCartPeriodStatus(cartId, period) {
    if (!period.start_time || !period.end_time) return { status: 'free' }

    // Build period timestamps in local time
    const pStartStr = `${selectedDate}T${period.start_time.slice(0, 5)}:00`
    const pEndStr = `${selectedDate}T${period.end_time.slice(0, 5)}:00`
    const pStart = new Date(pStartStr).getTime()
    const pEnd = new Date(pEndStr).getTime()

    // Find any lesson associated with this cart that overlaps with period
    const bookedLesson = lessons.find(l => {
      // If lesson explicitly specifies cart_id
      if (l.cart_id && l.cart_id === cartId) {
        const lStart = new Date(l.start_time).getTime()
        const lEnd = new Date(l.end_time).getTime()
        return (pStart < lEnd && pEnd > lStart)
      }
      return false
    })

    if (bookedLesson) {
      const isMine = teacher && bookedLesson.teacher_id === teacher.id
      return {
        status: isMine ? 'mine' : 'occupied',
        lesson: bookedLesson,
        isRecurring: false
      }
    }

    // Check approved recurring schedule
    const recRule = recurringRules.find(r => r.cart_id === cartId && r.period_id === period.id)
    if (recRule) {
      const isMine = teacher && recRule.teacher_id === teacher.id
      return {
        status: isMine ? 'mine' : 'occupied',
        isRecurring: true,
        lesson: {
          id: recRule.id,
          subject: recRule.subject,
          teacher_id: recRule.teacher_id,
          teacher_name: recRule.teacher_name,
          class_name: recRule.class_name,
          lesson_code: recRule.lesson_code || 'קבוע',
          start_time: pStartStr,
          end_time: pEndStr
        }
      }
    }

    return { status: 'free' }
  }

  return (
    <div className="space-y-6 pb-12 font-sans" dir="rtl">
      {/* Top Header & Day Navigator */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span>📅 לוח זמינות עגלות ומחשבים</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            מעקב ויזואלי אחר שיבוץ העגלות בבית הספר לפי מערכת השעות והצלצולים
          </p>
        </div>

        {/* Date Navigator Controls */}
        <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200/80 self-start md:self-auto">
          <button
            type="button"
            onClick={() => changeDay(-1)}
            className="p-1.5 hover:bg-white rounded-lg text-gray-600 transition-colors"
            title="יום קודם"
          >
            ▶️
          </button>

          <span className="text-sm font-semibold text-gray-800 px-3 min-w-[190px] text-center select-none">
            {formattedDateHebrew}
          </span>

          <button
            type="button"
            onClick={() => changeDay(1)}
            className="p-1.5 hover:bg-white rounded-lg text-gray-600 transition-colors"
            title="יום הבא"
          >
            ◀️
          </button>

          <button
            type="button"
            onClick={setToday}
            className="text-xs font-medium text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors border border-primary/20"
          >
            היום
          </button>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => { setRefreshing(true); loadData(); if (onRefreshLessons) onRefreshLessons() }}
            className="p-1.5 hover:bg-white rounded-lg text-gray-500 transition-colors ml-1"
            title="רענן נתונים"
          >
            {refreshing ? '⏳' : '🔄'}
          </button>
        </div>
      </div>

      {/* Gatekeeper Banner: If no periods configured by admin */}
      {periods.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6 text-amber-900 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-3xl">⚠️</span>
            <div>
              <h3 className="font-bold text-lg text-amber-900 mb-1">
                מערכת שעות בית-ספרית טרם הוגדרה
              </h3>
              <p className="text-sm text-amber-800 leading-relaxed">
                לוח זמינות העגלות ושריון עגלות לשיעורים מבוססים על לוח הצלצולים של בית הספר.
                <br />
                יש לפנות למנהל המערכת על מנת שיגדיר את שעות השיעור במסך הניהול (בלשונית <strong>"מערכת שעות"</strong>).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Summary KPIs */}
      {periods.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl p-3.5 border border-gray-100 shadow-sm">
            <div className="text-[11px] text-gray-500">עגלות רשומות</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{carts.length} עגלות</div>
          </div>
          <div className="bg-white rounded-xl p-3.5 border border-gray-100 shadow-sm">
            <div className="text-[11px] text-gray-500">שעות שיעור מוגדרות</div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{periods.length} שעות</div>
          </div>
          <div className="bg-white rounded-xl p-3.5 border border-gray-100 shadow-sm">
            <div className="text-[11px] text-gray-500">שיעורים מתוזמנים היום</div>
            <div className="text-xl font-bold text-primary mt-0.5">{lessons.length} שיעורים</div>
          </div>
          <div className="bg-white rounded-xl p-3.5 border border-gray-100 shadow-sm">
            <div className="text-[11px] text-gray-500">השיעורים שלי היום</div>
            <div className="text-xl font-bold text-indigo-600 mt-0.5">
              {lessons.filter(l => l.teacher_id === teacher?.id).length} שיעורים
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Carts Availability Matrix */}
      {periods.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              <span>📊 שיבוץ עגלות לפי שעות</span>
              <span className="text-xs text-gray-400 font-normal">
                (לחץ על משבצת פנויה לשריון מהיר של עגלה)
              </span>
            </h3>

            {/* Visual Legend */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span>פנוי לשריון</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                <span>השיעור שלי</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                <span>תפוס</span>
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-16 text-center text-gray-400">
              <div className="animate-spin text-2xl mb-2">⏳</div>
              <p className="text-xs">טוען נתוני זמינות עגלות...</p>
            </div>
          ) : carts.length === 0 ? (
            <div className="p-16 text-center text-gray-400">
              <p className="text-sm">לא נמצאו עגלות פעילות במערכת.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse min-w-[750px]">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200/80 text-gray-500 text-xs font-semibold">
                    <th className="p-3.5 w-48 sticky right-0 bg-gray-50 z-10 shadow-[1px_0_3px_rgba(0,0,0,0.05)]">
                      שם העגלה ומחשבים
                    </th>
                    {periods.map(p => (
                      <th key={p.id} className="p-3 text-center min-w-[120px] border-r border-gray-200/50">
                        <div className="text-gray-900 font-bold">{p.name}</div>
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                          {p.start_time.slice(0, 5)} - {p.end_time.slice(0, 5)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {carts.map(cart => {
                    const devCount = cart.devices?.length || cart.total_devices || 0
                    const activeDevs = cart.devices ? cart.devices.filter(d => d.status !== 'maintenance').length : devCount

                    return (
                      <tr key={cart.id} className="hover:bg-gray-50/40 transition-colors">
                        {/* Cart Name Header Column */}
                        <td className="p-3.5 sticky right-0 bg-white z-10 shadow-[1px_0_3px_rgba(0,0,0,0.05)]">
                          <div className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                            <span>🖥️</span>
                            <span>{cart.name}</span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-2">
                            <span>{activeDevs} מחשבים תקינים</span>
                          </div>
                        </td>

                        {/* Period Cells */}
                        {periods.map(period => {
                          const cell = getCartPeriodStatus(cart.id, period)

                          if (cell.status === 'mine') {
                            const l = cell.lesson
                            return (
                              <td key={period.id} className="p-2 border-r border-gray-100 text-center">
                                <div className="bg-indigo-50 border border-indigo-200/80 text-indigo-900 rounded-xl p-2.5 shadow-sm text-right">
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className="font-bold text-indigo-950 text-xs truncate">
                                      {l.subject || 'השיעור שלי'}
                                    </span>
                                    <span className="text-[10px] bg-indigo-200/70 text-indigo-900 px-1.5 py-0.5 rounded font-mono font-bold">
                                      {cell.isRecurring ? `🔄 ${l.lesson_code}` : l.lesson_code}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-indigo-700">
                                    {l.class_name ? `כיתה: ${l.class_name}` : 'משוריין עבורך'}
                                  </div>
                                </div>
                              </td>
                            )
                          }

                          if (cell.status === 'occupied') {
                            const l = cell.lesson
                            return (
                              <td key={period.id} className="p-2 border-r border-gray-100 text-center">
                                <div className="bg-amber-50/70 border border-amber-200/60 text-amber-900 rounded-xl p-2.5 text-right">
                                  <div className="font-semibold text-amber-950 text-xs truncate">
                                    🔒 {l.teacher_name || 'מורה אחר'}
                                  </div>
                                  <div className="text-[10px] text-amber-700 truncate mt-0.5">
                                    {l.subject || 'שיעור'}
                                  </div>
                                </div>
                              </td>
                            )
                          }

                          // Free Slot
                          return (
                            <td key={period.id} className="p-2 border-r border-gray-100 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  if (onBookLesson) {
                                    onBookLesson({
                                      cart,
                                      period,
                                      date: selectedDate
                                    })
                                  }
                                }}
                                className="w-full h-full min-h-[58px] bg-emerald-50/40 hover:bg-emerald-100/70 border border-dashed border-emerald-300/80 hover:border-emerald-500 rounded-xl p-2 flex flex-col items-center justify-center gap-1 transition-all group cursor-pointer"
                                title={`שריון ${cart.name} ל-${period.name}`}
                              >
                                <span className="text-[11px] font-semibold text-emerald-800 group-hover:text-emerald-950 flex items-center gap-1">
                                  <span>🟢 פנוי</span>
                                </span>
                                <span className="text-[10px] text-emerald-600/90 group-hover:underline">
                                  לחץ לשריון
                                </span>
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
