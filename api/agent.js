import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const targetRoute = body.endpoint || body.action

    // Route 1: Active Loan
    if (targetRoute === 'active-loan' || body.assetTag) {
      const { assetTag } = body
      if (!assetTag) return res.status(400).json({ error: 'assetTag is required' })

      const { data: devs, error: devErr } = await supabaseAdmin
        .from('devices')
        .select('id, device_number, cart_id, carts(enable_charge_tracking), device_loans(id, student_id, checkout_at, digital_login_at, lesson_id, students(id, national_id, name, class_name, grade, charge_strikes))')
        .eq('asset_tag', assetTag)
        .eq('device_loans.status', 'active')
        .is('device_loans.checkin_at', null)

      if (devErr) return res.status(500).json({ error: devErr.message })
      if (!devs || devs.length === 0) return res.status(200).json({ loan: null })

      const dev = devs[0]
      const loans = dev.device_loans
      if (!loans || !Array.isArray(loans) || loans.length === 0) return res.status(200).json({ loan: null })

      const loan = loans[0]
      const s = Array.isArray(loan.students) ? loan.students[0] : loan.students
      if (!s) return res.status(200).json({ loan: null })

      let enable_tracking = true
      const carts_data = dev.carts
      if (carts_data) {
        enable_tracking = Array.isArray(carts_data)
          ? (carts_data[0]?.enable_charge_tracking ?? true)
          : (carts_data.enable_charge_tracking ?? true)
      }

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
    if (targetRoute === 'heartbeat' || body.batteryLevel !== undefined || body.deviceId) {
      const { deviceId, batteryLevel, isCharging, status, loanId, eventType, payload } = body
      if (!deviceId) return res.status(400).json({ error: 'deviceId is required' })

      const now = new Date().toISOString()
      const updateData = { last_seen: now }
      if (batteryLevel !== undefined) updateData.last_battery_level = batteryLevel
      if (isCharging !== undefined) updateData.is_charging = isCharging
      if (status) updateData.status = status

      await supabaseAdmin.from('devices').update(updateData).eq('id', deviceId)

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
    if (targetRoute === 'verify_teacher' || targetRoute === 'verify_student' || body.nationalId) {
      const action = targetRoute || body.action
      const { nationalId } = body
      if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })

      if (action === 'verify_teacher') {
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

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API agent error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
