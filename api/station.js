import { supabaseAdmin, setCorsHeaders, normalizeAndHashId } from './_supabase.js'


async function checkReservationBypass(bypassAttempt, curLesson) {
  if (!bypassAttempt) return { bypassed: false }
  const cleanBypass = String(bypassAttempt).trim()
  const adminSecret = process.env.ADMIN_CODE || 'admin2024'

  // 1. Admin Code check (admin2024, case-insensitive, or Hebrew layout שדמין2024)
  if (
    cleanBypass.toLowerCase() === adminSecret.toLowerCase() ||
    cleanBypass.toLowerCase() === 'admin2024' ||
    cleanBypass === 'שדמין2024'
  ) {
    return { bypassed: true, approver: 'admin', approverName: 'מנהל מערכת' }
  }

  // 2. Specific Lesson Teacher ID check
  const bypassHash = normalizeAndHashId(cleanBypass)
  const { data: teachRpc } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: bypassHash })
  if (teachRpc && teachRpc.is_valid) {
    if (curLesson && teachRpc.teacher_id === curLesson.teacher_id) {
      return { bypassed: true, approver: 'teacher', approverName: teachRpc.teacher_name }
    } else {
      const lessonTeacherName = curLesson?.teachers?.name || 'מורה השיעור'
      return {
        bypassed: false,
        mismatch: true,
        error: `תעודת הזהות שייכת למורה ${teachRpc.teacher_name}, אך השיעור שייך למורה ${lessonTeacherName}. רק מורה השיעור או מנהל רשאים לאשר חריגה.`
      }
    }
  }

  const lessonTeacherName = curLesson?.teachers?.name ? `של המורה ${curLesson.teachers.name}` : 'של מורה השיעור'
  return {
    bypassed: false,
    invalid: true,
    error: `קוד אישור שגוי. יש להזין קוד מנהל או את תעודת הזהות ${lessonTeacherName}.`
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const targetRoute = body.route || body.endpoint || body.action || req.query?.route

    // Route 1: Cart Details & Stats (including lesson reservation info)
    if (targetRoute === 'cart-details') {
      const { cartId } = body
      if (!cartId) return res.status(400).json({ error: 'cartId is required' })

      const { data: cart, error: cartError } = await supabaseAdmin
        .from('carts')
        .select('id, name, display_name, location, allow_manual_entry, enable_charge_tracking')
        .eq('id', cartId)
        .is('deleted_at', null)
        .maybeSingle()

      if (cartError || !cart) return res.status(400).json({ error: 'Cart not found' })

      const { data: statusData } = await supabaseAdmin
        .from('cart_status')
        .select('available_devices, active_loans')
        .eq('id', cartId)
        .maybeSingle()

      // Fetch active or imminent lesson reservation for this cart (active now or starting within 10 minutes)
      const now = new Date()
      const imminentWindow = new Date(now.getTime() + 10 * 60000)

      const { data: reservedLessons } = await supabaseAdmin
        .from('lessons')
        .select('id, lesson_code, subject, start_time, end_time, status, teacher_id, teachers(name)')
        .eq('cart_id', cartId)
        .in('status', ['active', 'scheduled'])
        .gt('end_time', now.toISOString())
        .lte('start_time', imminentWindow.toISOString())
        .order('start_time', { ascending: true })
        .limit(1)

      let reservation = null
      if (reservedLessons && reservedLessons.length > 0) {
        const l = reservedLessons[0]
        const { data: preAssigned } = await supabaseAdmin
          .from('lesson_pre_assignments')
          .select('student_id')
          .eq('lesson_id', l.id)

        const allowedStudentIds = (preAssigned || []).map(p => p.student_id)

        reservation = {
          lessonId: l.id,
          lessonCode: l.lesson_code,
          subject: l.subject || 'שיעור',
          teacherName: l.teachers?.name || 'מורה',
          teacherId: l.teacher_id,
          startTime: l.start_time,
          endTime: l.end_time,
          status: l.status,
          allowedStudentIds,
          hasPreAssignedStudents: allowedStudentIds.length > 0
        }
      }

      // Check recurring schedule for today if no explicit lesson reservation found
      if (!reservation) {
        const todayDay = now.getDay()
        const nowTimeStr = now.toTimeString().slice(0, 8)
        const todayDateStr = now.toISOString().slice(0, 10)

        const { data: activePeriods } = await supabaseAdmin
          .from('school_periods')
          .select('id, name, period_number, start_time, end_time')
          .eq('is_active', true)
          .lte('start_time', nowTimeStr)
          .gte('end_time', nowTimeStr)
          .limit(1)

        if (activePeriods && activePeriods.length > 0) {
          const curPeriod = activePeriods[0]
          const { data: recRules } = await supabaseAdmin
            .from('recurring_lessons_overview')
            .select('*')
            .eq('cart_id', cartId)
            .eq('day_of_week', todayDay)
            .eq('period_id', curPeriod.id)
            .eq('status', 'approved')
            .eq('is_active', true)
            .limit(1)

          if (recRules && recRules.length > 0) {
            const r = recRules[0]
            const periodEndDt = new Date(`${todayDateStr}T${curPeriod.end_time.slice(0, 5)}:00`)
            reservation = {
              lessonId: r.id,
              isRecurring: true,
              lessonCode: 'קבוע',
              subject: r.subject || 'שיעור קבוע',
              teacherName: r.teacher_name || 'מורה',
              teacherId: r.teacher_id,
              startTime: `${todayDateStr}T${curPeriod.start_time.slice(0, 5)}:00`,
              endTime: periodEndDt.toISOString(),
              status: 'active',
              allowedStudentIds: [],
              hasPreAssignedStudents: false
            }
          }
        }
      }

      return res.status(200).json({
        cart,
        stats: {
          available: statusData?.available_devices ?? 0,
          taken: statusData?.active_loans ?? 0
        },
        isReserved: !!reservation,
        reservation
      })
    }

    // Route 2: Verify Kiosk Code
    if (targetRoute === 'verify-kiosk-code') {
      const { cartId, code } = body
      if (!cartId || !code) return res.status(400).json({ error: 'cartId and code are required' })

      const { data: isValid, error } = await supabaseAdmin.rpc('verify_kiosk_code', {
        p_cart_id: cartId,
        p_code: code
      })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ isValid: !!isValid })
    }

    // Route 3: Take Laptop (Confirm ID & Checkout)
        // Route 2.5: Verify Reservation Bypass Code (Admin code or Lesson Teacher ID)
    if (targetRoute === 'verify-reservation-bypass') {
      const { cartId, code } = body
      if (!cartId || !code) return res.status(400).json({ error: 'cartId and code are required' })

      const now = new Date()
      const { data: activeLessons } = await supabaseAdmin
        .from('lessons')
        .select('id, subject, teacher_id, teachers(name)')
        .eq('cart_id', cartId)
        .in('status', ['active', 'scheduled'])
        .gt('end_time', now.toISOString())
        .lte('start_time', now.toISOString())
        .limit(1)

      const curLesson = activeLessons && activeLessons.length > 0 ? activeLessons[0] : null
      const checkResult = await checkReservationBypass(code, curLesson)

      if (checkResult.bypassed) {
        return res.status(200).json({
          isValid: true,
          approver: checkResult.approver,
          approverName: checkResult.approverName
        })
      } else {
        return res.status(403).json({
          isValid: false,
          error: checkResult.error
        })
      }
    }

    if (targetRoute === 'take-laptop' || targetRoute === 'confirm_id' || targetRoute === 'checkout') {
      const action = body.action || targetRoute
      const { cartId, nationalId, deviceId, deviceNumber, studentId, checkoutMethod } = body
      if (!cartId) return res.status(400).json({ error: 'cartId is required' })

      if (action === 'confirm_id') {
        if (!nationalId || nationalId.length < 5) {
          return res.status(400).json({ error: 'תעודת זהות חייבת להכיל לפחות 5 ספרות' })
        }
        // 1. Search in students table by cryptographic hash
        const cleanId = String(nationalId).trim()
        const idHash = normalizeAndHashId(cleanId)

        const { data: stus, error: stuErr } = await supabaseAdmin
          .from('students')
          .select('id, name, class_name, grade, is_active, charge_strikes, id_last4')
          .eq('id_hash', idHash)
          .is('deleted_at', null)
          .limit(1)

        if (stuErr) return res.status(500).json({ error: 'שגיאת תקשורת במסד הנתונים. נסה שוב.' })

        let stu = stus && stus.length > 0 ? stus[0] : null
        let isTeacher = false

        if (stu && stu.is_active === false) {
          return res.status(400).json({ error: 'תלמיד זה אינו פעיל במערכת. פנה למנהל.' })
        }

        // 2. If not found in students, verify via secure teacher RPC
        if (!stu) {
          const { data: resRpc } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: idHash || cleanId })
          if (resRpc && resRpc.is_valid) {
            isTeacher = true
            stu = {
              id: resRpc.teacher_id,
              name: resRpc.teacher_name,
              id_last4: resRpc.id_last4,
              class_name: 'איש צוות',
              grade: 0,
              is_teacher: true
            }
          }
        }

        if (!stu) return res.status(400).json({ error: 'תעודת זהות לא נמצאה במערכת. פנה למורה.' })

        // 2.5 Reservation Check: Is cart currently reserved for a lesson?
        const nowReservation = new Date()
        const { data: activeRes } = await supabaseAdmin
          .from('lessons')
          .select('id, lesson_code, subject, start_time, end_time, teacher_id, teachers(name)')
          .eq('cart_id', cartId)
          .in('status', ['active', 'scheduled'])
          .gt('end_time', nowReservation.toISOString())
          .lte('start_time', nowReservation.toISOString())
          .limit(1)

        if (activeRes && activeRes.length > 0) {
          const curLesson = activeRes[0]
          const { data: preAssigned } = await supabaseAdmin
            .from('lesson_pre_assignments')
            .select('student_id')
            .eq('lesson_id', curLesson.id)

          const preList = preAssigned || []
          if (preList.length > 0) {
            const isAllowed = preList.some(p => p.student_id === stu.id)
            if (!isAllowed && !isTeacher) {
              // Check if valid bypass code was provided
              let bypassed = false
              const bypassAttempt = body.bypassCode || body.adminPasscode
              if (bypassAttempt) {
                const { data: validPass } = await supabaseAdmin.rpc('verify_kiosk_code', {
                  p_cart_id: cartId,
                  p_code: String(bypassAttempt).trim()
                })
                if (validPass) bypassed = true

                if (!bypassed) {
                  const bypassHash = normalizeAndHashId(String(bypassAttempt).trim())
                  const { data: teachRpc } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: bypassHash })
                  if (teachRpc && teachRpc.is_valid) bypassed = true
                }
              }

              if (!bypassed) {
                const teacherName = curLesson.teachers?.name ? ` (המורה ${curLesson.teachers.name})` : ''
                const endTimeStr = new Date(curLesson.end_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                return res.status(403).json({
                  error: `🔒 עגלה זו משוריינת כעת לשיעור "${curLesson.subject}"${teacherName} (משתחררת בשעה ${endTimeStr}). ההשאלה מורשית רק לתלמידים הרשומים לשיעור זה.`,
                  code: 'CART_RESERVED_FOR_LESSON',
                  isReserved: true,
                  lessonSubject: curLesson.subject,
                  teacherName: curLesson.teachers?.name,
                  endTime: curLesson.end_time
                })
              }
            }
          }
        }

        // 3. Check for existing active loans
        if (!isTeacher) {
          const { data: existing } = await supabaseAdmin
            .from('device_loans')
            .select('id, devices(device_number, carts(name, display_name))')
            .eq('student_id', stu.id)
            .eq('status', 'active')
            .is('checkin_at', null)
            .maybeSingle()

          if (existing) {
            const devNum = existing.devices?.device_number
            const cartName = existing.devices?.carts?.display_name || existing.devices?.carts?.name
            return res.status(400).json({
              error: `יש לך מחשב מס' ${devNum} מ${cartName} שלא הוחזר. יש להחזירו לפני לקיחת מחשב חדש.`
            })
          }
        }

        // 4. Check charge strikes if charge tracking is enabled for this cart
        let strikeWarning = null
        if (!isTeacher) {
          const { data: cartData } = await supabaseAdmin
            .from('carts')
            .select('enable_charge_tracking')
            .eq('id', cartId)
            .maybeSingle()

          const trackingEnabled = cartData ? cartData.enable_charge_tracking !== false : true

          if (trackingEnabled) {
            const strikes = Number(stu.charge_strikes) || 0
            if (strikes >= 3) {
              return res.status(403).json({
                error: `⛔ חשבונך חסום (${strikes} עבירות אי-טעינה). לא ניתן להשאיל מחשב. יש לפנות לרכז המחשבים.`
              })
            }
            if (strikes > 0) {
              strikeWarning = `⚠️ שים לב: צברת ${strikes} מתוך 3 עבירות אי-טעינה! בסיום השימוש חובה לחבר את המחשב לכבל הטעינה בעגלה.`
            }
          }
        }

        return res.status(200).json({ student: stu, isTeacher, strikeWarning })
      }

      if (action === 'checkout') {
        if (!studentId) return res.status(400).json({ error: 'studentId is required' })

        // Reservation check on checkout
        const nowCheckout = new Date()
        const { data: activeResCheckout } = await supabaseAdmin
          .from('lessons')
          .select('id, lesson_code, subject, start_time, end_time, teacher_id, teachers(name)')
          .eq('cart_id', cartId)
          .in('status', ['active', 'scheduled'])
          .gt('end_time', nowCheckout.toISOString())
          .lte('start_time', nowCheckout.toISOString())
          .limit(1)

        if (activeResCheckout && activeResCheckout.length > 0) {
          const curLesson = activeResCheckout[0]
          const { data: preAssigned } = await supabaseAdmin
            .from('lesson_pre_assignments')
            .select('student_id')
            .eq('lesson_id', curLesson.id)

          const preList = preAssigned || []
          if (preList.length > 0) {
            const isAllowed = preList.some(p => p.student_id === studentId)
            const bypassAttempt = body.bypassCode || body.adminPasscode
            let bypassed = false
            if (bypassAttempt) {
              const bypassCheck = await checkReservationBypass(bypassAttempt, curLesson)
              if (bypassCheck.bypassed) {
                bypassed = true
              }
            }

            if (!isAllowed && !body.isTeacher && !bypassed) {
              const teacherName = curLesson.teachers?.name ? ` (המורה ${curLesson.teachers.name})` : ''
              const endTimeStr = new Date(curLesson.end_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
              return res.status(403).json({
                error: `🔒 עגלה זו משוריינת כעת לשיעור "${curLesson.subject}"${teacherName} (משתחררת בשעה ${endTimeStr}). ההשאלה מורשית לתלמידי השיעור בלבד.`,
                code: 'CART_RESERVED_FOR_LESSON'
              })
            }
          }
        }

        // Check if student is blocked by charge strikes on this cart
        const { data: cartData } = await supabaseAdmin
          .from('carts')
          .select('enable_charge_tracking')
          .eq('id', cartId)
          .maybeSingle()

        const trackingEnabled = cartData ? cartData.enable_charge_tracking !== false : true
        if (trackingEnabled) {
          const { data: stuCheck } = await supabaseAdmin
            .from('students')
            .select('charge_strikes')
            .eq('id', studentId)
            .maybeSingle()

          if (stuCheck && (Number(stuCheck.charge_strikes) || 0) >= 3) {
            return res.status(403).json({ error: '⛔ חשבונך חסום (3 עבירות אי-טעינה). לא ניתן להשאיל מחשב.' })
          }
        }

        let targetDev = null
        if (deviceId) {
          const { data } = await supabaseAdmin.from('devices').select('*').eq('id', deviceId).eq('cart_id', cartId).is('deleted_at', null).maybeSingle()
          targetDev = data
        } else if (deviceNumber) {
          const { data } = await supabaseAdmin.from('devices').select('*').eq('cart_id', cartId).eq('device_number', deviceNumber).is('deleted_at', null).maybeSingle()
          targetDev = data
        }

        if (!targetDev) {
          if (deviceId) {
            const { data: otherDev } = await supabaseAdmin
              .from('devices')
              .select('device_number, carts(name, display_name)')
              .eq('id', deviceId)
              .is('deleted_at', null)
              .maybeSingle()

            if (otherDev) {
              const otherCartName = otherDev.carts?.display_name || otherDev.carts?.name || 'עגלה אחרת'
              return res.status(400).json({
                error: `מחשב מס' ${otherDev.device_number} שייך ל${otherCartName}. יש להשאילו מעמדת ${otherCartName}.`
              })
            }
          }
          return res.status(400).json({ error: 'מחשב לא נמצא במערכת.' })
        }

        const { data: takenLoan } = await supabaseAdmin.from('device_loans').select('id').eq('device_id', targetDev.id).eq('status', 'active').is('checkin_at', null).maybeSingle()
        if (takenLoan) return res.status(400).json({ error: `מחשב מס' ${targetDev.device_number} כבר נלקח.` })

        const validMethod = (checkoutMethod === 'qr_scan' || checkoutMethod === 'manual_number') ? checkoutMethod : 'manual_number'

        // Check if studentId is a teacher ID
        let isTeacher = body.isTeacher === true || !!body.teacherId
        let teacherId = isTeacher ? (body.teacherId || studentId) : null

        if (!isTeacher) {
          const { data: stuRecord } = await supabaseAdmin.from('students').select('id').eq('id', studentId).maybeSingle()
          if (!stuRecord) {
            // Not a student ID in students table -> teacher checkout
            isTeacher = true
            teacherId = studentId
          } else {
            // Re-verify that student does not have another active unreturned loan
            const { data: existingLoan } = await supabaseAdmin
              .from('device_loans')
              .select('id, devices(device_number, carts(name, display_name))')
              .eq('student_id', studentId)
              .eq('status', 'active')
              .is('checkin_at', null)
              .maybeSingle()

            if (existingLoan) {
              const devNum = existingLoan.devices?.device_number
              const cartName = existingLoan.devices?.carts?.display_name || existingLoan.devices?.carts?.name || 'העגלה'
              return res.status(400).json({
                error: `כבר קיים מחשב מושאל פעיל על שמך (מחשב ${devNum} מ${cartName}). יש להחזירו לפני לקיחת מחשב נוסף.`
              })
            }
          }
        }

        const insertPayload = {
          device_id: targetDev.id,
          student_id: isTeacher ? null : studentId,
          teacher_id: teacherId,
          notes: null,
          checkout_method: validMethod,
          status: 'active'
        }

        const { data: newLoan, error: insertErr } = await supabaseAdmin.from('device_loans').insert(insertPayload).select().single()

        if (insertErr) return res.status(500).json({ error: 'שגיאה ברשת. נסה שנית.' })
        return res.status(200).json({ success: true, device: targetDev, loan: newLoan })
      }
    }

    // Route 4: Return Laptop
    if (targetRoute === 'return-laptop') {
      const { cartId, deviceIdOrNumber, loanId } = body
      if (!cartId) return res.status(400).json({ error: 'cartId is required' })

      if (loanId) {
        const { error: updateErr } = await supabaseAdmin
          .from('device_loans')
          .update({ checkin_at: new Date().toISOString(), status: 'returned', return_method: 'cart_station' })
          .eq('id', loanId)
          .eq('status', 'active')

        if (updateErr) return res.status(500).json({ error: 'שגיאה בהחזרת המחשב. נסה שוב.' })
        return res.status(200).json({ success: true })
      }

      if (!deviceIdOrNumber) return res.status(400).json({ error: 'deviceIdOrNumber or loanId is required' })

      const isUUID = /^[0-9a-f-]{36}$/i.test(deviceIdOrNumber)
      let dev = null
      if (isUUID) {
        const { data } = await supabaseAdmin.from('devices').select('*').eq('id', deviceIdOrNumber).eq('cart_id', cartId).is('deleted_at', null).maybeSingle()
        dev = data
      } else {
        const { data } = await supabaseAdmin.from('devices').select('*').eq('cart_id', cartId).eq('device_number', deviceIdOrNumber).is('deleted_at', null).maybeSingle()
        dev = data
      }

      if (!dev) {
        if (isUUID) {
          const { data: otherDev } = await supabaseAdmin
            .from('devices')
            .select('device_number, carts(name, display_name)')
            .eq('id', deviceIdOrNumber)
            .is('deleted_at', null)
            .maybeSingle()

          if (otherDev) {
            const otherCartName = otherDev.carts?.display_name || otherDev.carts?.name || 'עגלה אחרת'
            return res.status(400).json({
              error: `מחשב מס' ${otherDev.device_number} שייך ל${otherCartName}. יש להחזירו לעמדת ${otherCartName}.`
            })
          }
        } else {
          const { data: otherDevs } = await supabaseAdmin
            .from('devices')
            .select('device_number, carts(name, display_name)')
            .eq('device_number', deviceIdOrNumber)
            .is('deleted_at', null)

          if (otherDevs && otherDevs.length > 0) {
            const cartNames = [...new Set(otherDevs.map(d => d.carts?.display_name || d.carts?.name).filter(Boolean))]
            if (cartNames.length > 0) {
              return res.status(400).json({
                error: `מחשב מס' ${deviceIdOrNumber} אינו קיים בעגלה זו (קיים ב: ${cartNames.join(', ')}). יש להחזירו לעמדה המתאימה.`
              })
            }
          }
        }
        return res.status(400).json({ error: 'מחשב לא נמצא במערכת.' })
      }

      const { data: activeLoan } = await supabaseAdmin.from('device_loans').select('*, students(name, class_name), teachers(name)').eq('device_id', dev.id).eq('status', 'active').is('checkin_at', null).maybeSingle()
      if (!activeLoan) {
        if (!isUUID) {
          const { data: otherDevLoans } = await supabaseAdmin
            .from('device_loans')
            .select('devices!inner(device_number, carts(name, display_name))')
            .eq('devices.device_number', dev.device_number)
            .eq('status', 'active')
            .is('checkin_at', null)

          if (otherDevLoans && otherDevLoans.length > 0) {
            const otherCartNames = [...new Set(otherDevLoans.map(l => l.devices?.carts?.display_name || l.devices?.carts?.name).filter(Boolean))]
            if (otherCartNames.length > 0) {
              return res.status(400).json({
                error: `מחשב מס' ${dev.device_number} אינו מושאל מעגלה זו (אך מושאל כעת מ: ${otherCartNames.join(', ')}). יש להחזירו לעמדה המתאימה.`
              })
            }
          }
        }
        return res.status(400).json({ error: `מחשב מס' ${dev.device_number} אינו מוגדר כמשואל כעת.` })
      }

      if (activeLoan && activeLoan.teachers && !activeLoan.students) {
        activeLoan.students = {
          name: activeLoan.teachers.name,
          class_name: 'מורה'
        }
      }

      return res.status(200).json({ device: dev, loan: activeLoan })
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API station error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
