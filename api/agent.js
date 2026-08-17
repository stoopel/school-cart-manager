import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const targetRoute = body.endpoint || body.action

    // Route 0: Register Device (Secure installer registration)
    if (targetRoute === 'register_device' || targetRoute === 'register-device') {
      const assetTag = body.assetTag || body.asset_tag
      const cartId = body.cartId || body.cart_id
      const deviceNumber = parseInt(body.deviceNumber || body.device_number, 10)

      if (!assetTag || !cartId || isNaN(deviceNumber)) {
        return res.status(400).json({ error: 'assetTag, cartId, and numeric deviceNumber are required' })
      }

      // Check if device already exists under this cart with this number (even if soft-deleted)
      let { data: dev } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('cart_id', cartId)
        .eq('device_number', deviceNumber)
        .maybeSingle()

      if (!dev) {
        // Check if device exists by asset_tag
        const { data: devByTag } = await supabaseAdmin
          .from('devices')
          .select('*')
          .eq('asset_tag', assetTag)
          .maybeSingle()
        dev = devByTag
      }

      if (dev) {
        const { data: updated, error: uErr } = await supabaseAdmin
          .from('devices')
          .update({
            asset_tag: assetTag,
            cart_id: cartId,
            device_number: deviceNumber,
            status: 'locked',
            deleted_at: null,
            is_charging: true,
            battery_level: 100
          })
          .eq('id', dev.id)
          .select()
          .single()

        if (uErr) return res.status(500).json({ error: uErr.message })
        return res.status(200).json({ success: true, device: updated })
      } else {
        const { data: inserted, error: iErr } = await supabaseAdmin
          .from('devices')
          .insert({
            asset_tag: assetTag,
            cart_id: cartId,
            device_number: deviceNumber,
            status: 'locked',
            deleted_at: null,
            is_charging: true,
            battery_level: 100
          })
          .select()
          .single()

        if (iErr) return res.status(500).json({ error: iErr.message })
        return res.status(200).json({ success: true, device: inserted })
      }
    }

    // Route 1: Active Loan
    if (targetRoute === 'active-loan' || (!targetRoute && body.assetTag)) {
      const { assetTag } = body
      if (!assetTag) return res.status(400).json({ error: 'assetTag is required' })

      const { data: devs, error: devErr } = await supabaseAdmin
        .from('devices')
        .select('id, device_number, cart_id, carts(enable_charge_tracking), device_loans(id, student_id, checkout_at, digital_login_at, lesson_id, students(id, national_id, name, class_name, grade, charge_strikes))')
        .eq('asset_tag', assetTag)
        .eq('device_loans.status', 'active')
        .is('device_loans.checkin_at', null)

      if (devErr) return res.status(500).json({ error: devErr.message })
      if (!devs || devs.length === 0) {
        // Look up device directly to provide device_id for realtime websocket
        const { data: rawDev } = await supabaseAdmin.from('devices').select('id, device_number, cart_id').eq('asset_tag', assetTag).maybeSingle()
        return res.status(200).json({ loan: null, device_id: rawDev?.id || null })
      }

      const dev = devs[0]
      const loans = dev.device_loans
      if (!loans || !Array.isArray(loans) || loans.length === 0) {
        return res.status(200).json({ loan: null, device_id: dev.id })
      }

      const loan = loans[0]
      const s = Array.isArray(loan.students) ? loan.students[0] : loan.students
      if (!s) return res.status(200).json({ loan: null, device_id: dev.id })

      const cartData = dev.carts
      const enable_tracking = (Array.isArray(cartData) ? cartData[0]?.enable_charge_tracking : cartData?.enable_charge_tracking) ?? true

      const formattedLoan = {
        device_id: dev.id,
        device_number: dev.device_number,
        cart_id: dev.cart_id,
        loan_id: loan.id,
        student_id: s.id,
        national_id: s.national_id,
        student_name: s.name,
        class_name: s.class_name || '',
        grade: s.grade || 0,
        charge_strikes: s.charge_strikes || 0,
        enable_charge_tracking: enable_tracking,
        lesson_id: loan.lesson_id
      }
      return res.status(200).json({ loan: formattedLoan, device_id: dev.id })
    }

    // Route 2: Heartbeat
    if (targetRoute === 'heartbeat' || (!targetRoute && (body.batteryLevel !== undefined || body.eventType))) {
      const { deviceId, batteryLevel, isCharging, status, loanId, eventType, payload } = body
      if (!deviceId) return res.status(400).json({ error: 'deviceId is required' })

      const now = new Date().toISOString()
      const updateData = { last_seen: now }
      if (batteryLevel !== undefined) updateData.last_battery_level = batteryLevel
      if (isCharging !== undefined) updateData.is_charging = isCharging
      if (status) updateData.status = status

      await supabaseAdmin.from('devices').update(updateData).eq('id', deviceId)

      if (eventType === 'digital_login' && loanId) {
        await supabaseAdmin.from('device_loans').update({ digital_login_at: now }).eq('id', loanId)
        await supabaseAdmin.from('devices').update({ status: 'active', last_seen: now }).eq('id', deviceId)
      } else if (eventType === 'digital_logout' && loanId) {
        await supabaseAdmin.from('device_loans').update({ digital_logout_at: now }).eq('id', loanId)
        await supabaseAdmin.from('devices').update({ status: 'locked', last_seen: now }).eq('id', deviceId)
      }

      if (eventType) {
        await supabaseAdmin.from('event_log').insert({
          device_id: deviceId,
          loan_id: loanId || null,
          source: 'agent',
          event_type: eventType,
          payload: payload || {}
        })
      }
      return res.status(200).json({ success: true, server_time: now })
    }

    // Route 3: Verify ID (Teacher / Student)
    if (targetRoute === 'verify-id' || targetRoute === 'verify_teacher' || targetRoute === 'verify_student' || body.nationalId) {
      const action = body.action || targetRoute
      const { nationalId } = body
      if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })

      if (action === 'verify_teacher' || action === 'verify-id') {
        const { data: resRpc, error } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: nationalId })
        if (error) return res.status(500).json({ error: error.message })
        if (resRpc && resRpc.is_valid) {
          return res.status(200).json({ isTeacher: true, teacher: { id: resRpc.teacher_id, name: resRpc.teacher_name } })
        }
        return res.status(200).json({ isTeacher: false, teacher: null })
      }

      if (action === 'verify_student') {
        const { data: stu, error } = await supabaseAdmin.from('students').select('id, national_id, name, class_name, charge_strikes').eq('national_id', nationalId).single()
        if (error || !stu) return res.status(404).json({ error: 'Student not found' })
        return res.status(200).json({ student: stu })
      }
    }

    // Route 4: Lesson operations
    if (targetRoute === 'get_by_code' || targetRoute === 'get_by_id' || targetRoute === 'join' || targetRoute === 'disconnect' || targetRoute === 'check_pre_assigned') {
      const action = targetRoute
      const { lessonCode, lessonId, studentId, loanId, deviceId, nationalId } = body

      if (action === 'get_by_code') {
        const { data: rows } = await supabaseAdmin.from('active_lessons').select('*').eq('lesson_code', lessonCode)
        if (!rows || rows.length === 0) return res.status(200).json({ lesson: null })
        const { data: serverNow } = await supabaseAdmin.rpc('get_server_time')
        return res.status(200).json({ lesson: rows[0], server_now: serverNow })
      }

      if (action === 'get_by_id') {
        const { data: rows } = await supabaseAdmin.from('active_lessons').select('*').eq('id', lessonId)
        if (!rows || rows.length === 0) return res.status(200).json({ lesson: null })
        const { data: serverNow } = await supabaseAdmin.rpc('get_server_time')
        return res.status(200).json({ lesson: rows[0], server_now: serverNow })
      }

      if (action === 'join') {
        const { data: lessonData } = await supabaseAdmin.from('lessons').select('id, end_time, status, teacher_name').eq('id', lessonId).single()
        if (!lessonData || lessonData.status !== 'active') return res.status(400).json({ error: 'Lesson is not active' })

        await supabaseAdmin.from('lesson_participants').insert({ lesson_id: lessonId, student_id: studentId, loan_id: loanId, device_id: deviceId })
        await supabaseAdmin.from('device_loans').update({ lesson_id: lessonId }).eq('id', loanId)
        return res.status(200).json({ success: true, lesson: lessonData })
      }

      if (action === 'disconnect') {
        await supabaseAdmin.rpc('disconnect_student_from_lesson', { p_loan_id: loanId, p_student_id: studentId, p_lesson_id: lessonId })
        return res.status(200).json({ success: true })
      }

      if (action === 'check_pre_assigned') {
        const { data: resRpc } = await supabaseAdmin.rpc('get_pre_assigned_active_lesson', { entered_id: nationalId })
        return res.status(200).json({ lesson: resRpc })
      }
    }

    // Route 5: Get Device ID
    if (targetRoute === 'get_device_id' || targetRoute === 'get_device' || body.action === 'get_device_id') {
      const assetTag = body.assetTag || body.asset_tag
      if (!assetTag) return res.status(400).json({ error: 'assetTag is required' })
      const { data: dev, error: devErr } = await supabaseAdmin.from('devices').select('id, device_number, cart_id, status').eq('asset_tag', assetTag).maybeSingle()
      if (devErr) return res.status(500).json({ error: devErr.message })
      return res.status(200).json({ device: dev, device_id: dev?.id || null })
    }

    // Route 6: Battery Tracking
    if (targetRoute === 'save_battery' || targetRoute === 'get_last_battery' || body.action === 'save_battery' || body.action === 'get_last_battery') {
      const action = targetRoute || body.action
      const deviceId = body.deviceId || body.device_id
      if (!deviceId) return res.status(400).json({ error: 'deviceId is required' })

      if (action === 'save_battery') {
        const { batteryLevel } = body
        const now = new Date().toISOString()
        const { data, error } = await supabaseAdmin.from('devices').update({
          last_battery_level: batteryLevel,
          last_battery_recorded: now
        }).eq('id', deviceId).select('id, last_battery_level, last_battery_recorded').single()

        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, device: data })
      }

      if (action === 'get_last_battery') {
        const { data, error } = await supabaseAdmin.from('devices').select('last_battery_level, last_battery_recorded, battery_level').eq('id', deviceId).single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ battery: data })
      }
    }

    // Route 7: Strikes Management
    if (targetRoute === 'add_strike' || targetRoute === 'reset_strikes' || targetRoute === 'get_strikes' || body.action === 'add_strike' || body.action === 'reset_strikes' || body.action === 'get_strikes') {
      const action = targetRoute || body.action
      const studentId = body.studentId || body.student_id
      const deviceId = body.deviceId || body.device_id
      const loanId = body.loanId || body.loan_id

      if (!studentId) return res.status(400).json({ error: 'studentId is required' })

      if (action === 'add_strike') {
        let targetStudentId = studentId
        let targetLoanId = loanId
        if (!targetStudentId && deviceId) {
          const { data: lastLoan } = await supabaseAdmin
            .from('device_loans')
            .select('id, student_id')
            .eq('device_id', deviceId)
            .eq('status', 'returned')
            .order('checkin_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (lastLoan) {
            targetStudentId = lastLoan.student_id
            targetLoanId = lastLoan.id
          }
        }
        if (!targetStudentId) return res.status(400).json({ error: 'studentId or deviceId with return history is required' })

        const { data: stu } = await supabaseAdmin.from('students').select('charge_strikes').eq('id', targetStudentId).single()
        const newCount = (stu?.charge_strikes || 0) + 1
        await supabaseAdmin.from('students').update({ charge_strikes: newCount }).eq('id', targetStudentId)

        if (deviceId) {
          await supabaseAdmin.from('event_log').insert({
            device_id: deviceId,
            loan_id: targetLoanId || null,
            source: 'agent',
            event_type: 'charge_strike_added',
            payload: { strike_count: newCount, student_id: targetStudentId }
          })
        }
        return res.status(200).json({ success: true, count: newCount, student_id: targetStudentId })
      }

      if (action === 'reset_strikes') {
        const now = new Date().toISOString()
        await supabaseAdmin.from('students').update({ charge_strikes: 0, last_charged_at: now }).eq('id', studentId)

        if (deviceId) {
          await supabaseAdmin.from('event_log').insert({
            device_id: deviceId,
            loan_id: loanId || null,
            source: 'agent',
            event_type: 'charge_strike_reset',
            payload: {}
          })
        }
        return res.status(200).json({ success: true })
      }

      if (action === 'get_strikes') {
        const { data: stu } = await supabaseAdmin.from('students').select('charge_strikes').eq('id', studentId).single()
        return res.status(200).json({ strikes: stu?.charge_strikes || 0 })
      }
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API agent error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
