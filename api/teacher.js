import crypto from 'crypto'
import { supabaseAdmin, setCorsHeaders, normalizeAndHashId } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const { action, nationalId, teacherId, subject, minutes, isLocked, lessonId, status, token } = body

    // Route 1: Teacher Verify (Standard ID Login)
    if (action === 'verify' || (!action && nationalId)) {
      if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })
      const idHash = normalizeAndHashId(nationalId) || nationalId
      const { data: resRpc, error } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: idHash })
      if (error) return res.status(500).json({ error: error.message })
      if (resRpc && resRpc.is_valid) {
        return res.status(200).json({
          isValid: true,
          teacher: {
            id: resRpc.teacher_id,
            name: resRpc.teacher_name,
            id_last4: resRpc.id_last4,
            id_hash: resRpc.id_hash
          }
        })
      }
      return res.status(200).json({ isValid: false, error: 'תעודת זהות אינה מזוהה כאיש צוות פעיל' })
    }

    // Route 1.5: List Students for Teacher (Active, safe, no plaintext national_id)
    if (action === 'list_students') {
      const { data: stus, error: stuErr } = await supabaseAdmin.rpc('get_teacher_student_list')
      if (stuErr) {
        const { data: fallbackStus, error: fbErr } = await supabaseAdmin
          .from('students')
          .select('id, name, class_name, id_last4')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name')
        if (fbErr) return res.status(500).json({ error: fbErr.message })
        return res.status(200).json({ students: fallbackStus || [] })
      }
      return res.status(200).json({ students: stus || [] })
    }

    // Route 2: List Lessons
    if (action === 'list') {
      const { data, error } = await supabaseAdmin
        .from('lessons')
        .select('*, carts(id, name, total_devices), lesson_participants(id, student_id, loan_id, device_id, students(name, class_name), devices(device_number, last_seen))')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) return res.status(500).json({ error: error.message })
      const now = new Date()

      // סגירה אוטומטית שקטה של שיעורים שזמנם עבר במסד הנתונים
      await supabaseAdmin
        .from('lessons')
        .update({ status: 'ended' })
        .eq('status', 'active')
        .lte('end_time', now.toISOString())

      const lessons = (data || []).map(l => {
        if (l.status === 'active' && new Date(l.end_time) <= now) {
          return { ...l, status: 'ended' }
        }
        return l
      })
      return res.status(200).json({ lessons })
    }

    // Route 3: Create Lesson (with cart reservation & collision check)
    if (action === 'create') {
      if (!teacherId) return res.status(400).json({ error: 'teacherId is required' })

      const durationMins = parseInt(minutes, 10) || 45
      const now = new Date()

      let startDt = (body.startTime || body.start_time) ? new Date(body.startTime || body.start_time) : now
      let endDt = (body.endTime || body.end_time) ? new Date(body.endTime || body.end_time) : new Date(startDt.getTime() + durationMins * 60000)
      const lessonStatus = body.status || (startDt > now ? 'scheduled' : 'active')
      const cartId = body.cartId || body.cart_id || null

      // Guard: If cart is specified, check prerequisites and conflicts
      if (cartId) {
        // 1. Check if school_periods exist (strict prerequisite for cart reservation)
        const { count: periodCount, error: periodErr } = await supabaseAdmin
          .from('school_periods')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)

        if (periodErr || !periodCount || periodCount === 0) {
          return res.status(400).json({
            error: 'לא ניתן לשריין עגלה לפני שמערכת השעות (לוח צלצולים) הוגדרה במערכת ע"י מנהל'
          })
        }

        // 2. Verify cart exists and is active
        const { data: cartObj, error: cartErr } = await supabaseAdmin
          .from('carts')
          .select('id, name, is_active')
          .eq('id', cartId)
          .is('deleted_at', null)
          .maybeSingle()

        if (cartErr || !cartObj) {
          return res.status(400).json({ error: 'העגלה שנבחרה אינה קיימת או נמחקה' })
        }

        // 3. Collision check: No overlapping active or scheduled lesson for this cart
        const { data: cartConflicts, error: conflictErr } = await supabaseAdmin
          .from('lessons')
          .select('id, subject, lesson_code, start_time, end_time, teacher_id, teachers(name)')
          .eq('cart_id', cartId)
          .in('status', ['active', 'scheduled'])
          .lt('start_time', endDt.toISOString())
          .gt('end_time', startDt.toISOString())

        if (cartConflicts && cartConflicts.length > 0) {
          const conf = cartConflicts[0]
          const teacherName = conf.teachers?.name ? ` (המורה ${conf.teachers.name})` : ''
          return res.status(400).json({
            error: `העגלה תפוסה לשיעור אחר${teacherName} בשעות אלו`,
            conflict: conf
          })
        }
      }

      // Guard: Check if teacher already has an active lesson (if starting 'active')
      if (lessonStatus === 'active') {
        const { data: activeLessons, error: activeErr } = await supabaseAdmin
          .from('lessons')
          .select('id, subject, lesson_code, start_time, end_time')
          .eq('teacher_id', teacherId)
          .eq('status', 'active')
          .gt('end_time', now.toISOString())

        if (activeLessons && activeLessons.length > 0) {
          return res.status(400).json({
            error: 'לא ניתן לפתוח שיעור: קיים כבר שיעור פעיל עבור מורה זה',
            activeLesson: activeLessons[0]
          })
        }
      }

      let lessonCode
      const { data: generatedCode, error: codeErr } = await supabaseAdmin.rpc('generate_lesson_code')
      if (!codeErr && generatedCode) {
        lessonCode = String(generatedCode)
      } else {
        lessonCode = Math.floor(1000 + Math.random() * 9000).toString()
      }

      const { data: newLesson, error } = await supabaseAdmin
        .from('lessons')
        .insert({
          teacher_id: teacherId,
          subject: subject || 'שיעור',
          duration_minutes: durationMins,
          lesson_code: lessonCode,
          start_time: startDt.toISOString(),
          end_time: endDt.toISOString(),
          status: lessonStatus,
          cart_id: cartId,
          is_locked: !!isLocked
        })
        .select('*, teachers(name), carts(id, name, total_devices)')
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ lesson: newLesson })
    }

    // Route 4: Update Status / Lock / Extension
    if (action === 'update_status' || action === 'update_lesson') {
      const updatePayload = {}
      if (body.cartId !== undefined || body.cart_id !== undefined) {
        updatePayload.cart_id = body.cartId !== undefined ? body.cartId : body.cart_id
      }
      if (status) {
        updatePayload.status = status
        if (status === 'ended') updatePayload.end_time = new Date().toISOString()
      }
      if (isLocked !== undefined || body.is_locked !== undefined) {
        updatePayload.is_locked = isLocked !== undefined ? isLocked : body.is_locked
      }
      if (body.endTime || body.end_time) {
        updatePayload.end_time = body.endTime || body.end_time
      }
      if (body.durationMinutes || body.duration_minutes) {
        updatePayload.duration_minutes = body.durationMinutes || body.duration_minutes
      }

      const { data, error } = await supabaseAdmin.from('lessons').update(updatePayload).eq('id', lessonId).select().maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ lesson: data })
    }

    // Route 5: Generate Secure One-Time Auto-Login Token (60s TTL)
    if (action === 'generate_token') {
      if (!teacherId) return res.status(400).json({ error: 'teacherId is required' })
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cart-manager-secret'
      const exp = Date.now() + 60000 // 60 seconds
      const nonce = crypto.randomBytes(8).toString('hex')
      const payloadStr = JSON.stringify({ teacherId, exp, nonce })
      const payloadB64 = Buffer.from(payloadStr).toString('base64url')
      const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
      const oneTimeToken = `${payloadB64}.${sig}`
      return res.status(200).json({ token: oneTimeToken })
    }

    // Route 6: Redeem Secure One-Time Auto-Login Token
    if (action === 'redeem_token') {
      if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token is required' })
      const parts = token.split('.')
      if (parts.length !== 2) return res.status(400).json({ error: 'Invalid token format' })
      const [payloadB64, sig] = parts
      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cart-manager-secret'
      const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
      if (sig !== expectedSig) {
        return res.status(401).json({ error: 'Invalid token signature' })
      }
      try {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
        if (Date.now() > payload.exp) {
          return res.status(401).json({ error: 'Token expired' })
        }
        const { data: teacher, error } = await supabaseAdmin.from('teachers').select('id, name, id_last4, id_hash, is_active').eq('id', payload.teacherId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!teacher || teacher.is_active === false) {
          return res.status(404).json({ error: 'Teacher not found or inactive' })
        }
        return res.status(200).json({ isValid: true, teacher: { id: teacher.id, name: teacher.name, id_last4: teacher.id_last4, id_hash: teacher.id_hash } })
      } catch (err) {
        return res.status(400).json({ error: 'Malformed token payload' })
      }
    }

        // Route 7: Recurring Rules (List for Teacher)
    if (action === 'get_recurring_rules') {
      let query = supabaseAdmin
        .from('recurring_lessons_overview')
        .select('*')
        .eq('is_active', true)
        .order('day_of_week')
        .order('period_number')

      if (teacherId) {
        query = query.eq('teacher_id', teacherId)
      }

      const { data: rules, error: rErr } = await query
      if (rErr) return res.status(500).json({ error: rErr.message })
      return res.status(200).json({ rules: rules || [] })
    }

    // Route 8: Request Recurring Weekly Lesson & Cart Booking
    if (action === 'request_recurring_rule') {
      const { dayOfWeek, periodId, subject: recSubject, className: recClassName, cartId } = body
      if (!teacherId) return res.status(400).json({ error: 'teacherId is required' })
      if (dayOfWeek === undefined || dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) {
        return res.status(400).json({ error: 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)' })
      }
      if (!periodId) return res.status(400).json({ error: 'periodId is required' })
      if (!recSubject || !String(recSubject).trim()) return res.status(400).json({ error: 'subject is required' })

      // Verify teacher is active
      const { data: teacherData, error: teachErr } = await supabaseAdmin
        .from('teachers')
        .select('id, name, is_active')
        .eq('id', teacherId)
        .maybeSingle()
      if (teachErr || !teacherData || teacherData.is_active === false) {
        return res.status(403).json({ error: 'Teacher not found or inactive' })
      }

      // If cartId is provided, check for collision with approved recurring rules
      if (cartId) {
        const { data: existingApproved } = await supabaseAdmin
          .from('recurring_lesson_rules')
          .select('id, subject, teacher_id, teachers(name)')
          .eq('cart_id', cartId)
          .eq('day_of_week', dayOfWeek)
          .eq('period_id', periodId)
          .eq('status', 'approved')
          .eq('is_active', true)
          .limit(1)

        if (existingApproved && existingApproved.length > 0) {
          const owner = existingApproved[0]
          const teacherName = owner.teachers?.name ? ` (מורה: ${owner.teachers.name})` : ''
          return res.status(409).json({
            error: `העגלה כבר משוריינת בקביעות ביום ובשעה שנבחרו עבור "${owner.subject}"${teacherName}. לא ניתן להגיש בקשה כפולה.`,
            collision: true
          })
        }
      }

      // Insert recurring rule with status 'pending' and pre-allocated lesson code
      const { data: gCode } = await supabaseAdmin.rpc('generate_lesson_code')
      const { data: newRule, error: insErr } = await supabaseAdmin
        .from('recurring_lesson_rules')
        .insert({
          teacher_id: teacherId,
          cart_id: cartId || null,
          day_of_week: dayOfWeek,
          period_id: periodId,
          subject: String(recSubject).trim(),
          class_name: recClassName ? String(recClassName).trim() : null,
          status: 'pending',
          lesson_code: gCode,
          is_active: true
        })
        .select()
        .single()

      if (insErr) return res.status(500).json({ error: insErr.message })
      return res.status(200).json({ success: true, rule: newRule })
    }

    // Route 9: Delete/Cancel Recurring Rule (Teacher can cancel their own rule)
    if (action === 'delete_recurring_rule') {
      const { ruleId } = body
      if (!ruleId) return res.status(400).json({ error: 'ruleId is required' })
      if (!teacherId) return res.status(400).json({ error: 'teacherId is required' })

      const { data: rule, error: getErr } = await supabaseAdmin
        .from('recurring_lesson_rules')
        .select('id, teacher_id')
        .eq('id', ruleId)
        .maybeSingle()

      if (getErr || !rule) return res.status(404).json({ error: 'Rule not found' })
      if (rule.teacher_id !== teacherId) {
        return res.status(403).json({ error: 'אינך מורשה לבטל שיעור קבוע שאינו שייך לך' })
      }

      const { error: delErr } = await supabaseAdmin
        .from('recurring_lesson_rules')
        .delete()
        .eq('id', ruleId)

      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API teacher error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
