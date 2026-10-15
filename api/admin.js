import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // ─── בדיקת אימות והרשאת מנהל (ADMIN AUTH CHECK) ───────────
    const authHeader = req.headers.authorization || req.headers.Authorization
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'גישה נדחתה: חסרה הרשאת אימות מנהל (Missing authorization token)' })
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      return res.status(401).json({ error: 'גישה נדחתה: טוקן אימות ריק (Empty authorization token)' })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !authData?.user) {
      return res.status(401).json({ error: 'גישה נדחתה: טוקן אימות לא תקף או שפג תוקפו (Invalid or expired admin token)' })
    }

    const userEmail = (authData.user.email || '').trim().toLowerCase()
    if (!userEmail) {
      return res.status(403).json({ error: 'גישה נדחתה: למשתמש אין כתובת אימייל משויכת' })
    }

    // בדיקת הרשאה מול רשימת המנהלים המורשים (allowed_admins)
    const { data: isAllowed, error: allowErr } = await supabaseAdmin
      .from('allowed_admins')
      .select('email')
      .ilike('email', userEmail)
      .maybeSingle()

    if (allowErr || !isAllowed) {
      return res.status(403).json({ error: 'גישה נדחתה: חשבונך ממתין לאישור מנהל מערכת ראשי (Unauthorized: Account pending approval)' })
    }

    const body = req.body || {}
    const { scope, action, cart, cartId, device, deviceId, student, studentId, teacher, teacherId, loanId, type, records } = body

    // ─── CARTS SCOPE ───────────────────────────────────────────
    if (scope === 'carts' || action === 'list_carts' || action === 'save_cart' || action === 'delete_cart' || action === 'save_device' || action === 'delete_device') {
      if (action === 'list' || action === 'list_carts') {
        const { data: carts, error: cErr } = await supabaseAdmin.from('carts').select('*, devices(*)').is('deleted_at', null).order('name')
        const { data: statusList } = await supabaseAdmin.from('cart_status').select('*')
        if (cErr) return res.status(500).json({ error: cErr.message })
        return res.status(200).json({ carts: carts || [], statusList: statusList || [] })
      }
      if (action === 'save_cart') {
        const result = cart.id ? await supabaseAdmin.from('carts').update(cart).eq('id', cart.id).select().single() : await supabaseAdmin.from('carts').insert(cart).select().single()
        if (result.error) return res.status(500).json({ error: result.error.message })
        return res.status(200).json({ cart: result.data })
      }
      if (action === 'delete_cart') {
        // 1. חסימת מחיקת עגלה אם קיימות השאלות פעילות על מחשבים בעגלה זו
        const { data: activeCartLoans } = await supabaseAdmin
          .from('device_loans')
          .select('id, devices!inner(cart_id)')
          .eq('devices.cart_id', cartId)
          .eq('status', 'active')
          .is('checkin_at', null)
          .limit(1)

        if (activeCartLoans && activeCartLoans.length > 0) {
          return res.status(400).json({ error: 'לא ניתן למחוק עגלה כאשר ישנם מחשבים מושאלים פעילים בעגלה זו. יש להחזיר את כל המחשבים תחילה.' })
        }

        const { error } = await supabaseAdmin.from('carts').update({ deleted_at: new Date().toISOString() }).eq('id', cartId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
      if (action === 'save_device') {
        if (!device.id) {
          const { data: existingDeleted } = await supabaseAdmin
            .from('devices')
            .select('*')
            .eq('cart_id', device.cart_id)
            .eq('device_number', device.device_number)
            .not('deleted_at', 'is', null)
            .maybeSingle()

          if (existingDeleted) {
            const { data: restored, error: rErr } = await supabaseAdmin
              .from('devices')
              .update({
                deleted_at: null,
                asset_tag: device.asset_tag || null,
                status: 'locked'
              })
              .eq('id', existingDeleted.id)
              .select()
              .single()

            if (rErr) return res.status(500).json({ error: rErr.message })
            return res.status(200).json({ device: restored })
          }
        }

        const result = device.id
          ? await supabaseAdmin.from('devices').update(device).eq('id', device.id).select().single()
          : await supabaseAdmin.from('devices').insert(device).select().single()

        if (result.error) return res.status(500).json({ error: result.error.message })
        return res.status(200).json({ device: result.data })
      }
      if (action === 'delete_device') {
        // 1. חסימת מחיקת מחשב אם הוא מושאל כרגע
        const { data: activeDevLoans } = await supabaseAdmin
          .from('device_loans')
          .select('id')
          .eq('device_id', deviceId)
          .eq('status', 'active')
          .is('checkin_at', null)
          .limit(1)

        if (activeDevLoans && activeDevLoans.length > 0) {
          return res.status(400).json({ error: 'לא ניתן למחוק מחשב שמושאל כרגע לתלמיד או למורה. יש להחזירו תחילה לתחנת העגלה.' })
        }

        const { error } = await supabaseAdmin.from('devices').update({ deleted_at: new Date().toISOString() }).eq('id', deviceId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── STUDENTS SCOPE ────────────────────────────────────────
    if (scope === 'students' || action === 'list_students' || action === 'save_student' || action === 'delete_student' || action === 'restore_student' || action === 'reset_strikes') {
      if (action === 'list' || action === 'list_students') {
        const { data: students, error } = await supabaseAdmin.from('students').select('*').order('name')
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ students: students || [] })
      }
      if (action === 'save' || action === 'save_student') {
        if (student.id) {
          const result = await supabaseAdmin.from('students').update(student).eq('id', student.id).select().single()
          if (result.error) return res.status(500).json({ error: result.error.message })
          return res.status(200).json({ student: result.data })
        } else {
          const cleanId = (student.national_id || '').trim()
          const unpadded = cleanId.replace(/^0+/, '')
          const padded9 = cleanId.padStart(9, '0')

          // Teacher Shield: Disallow adding student if ID belongs to an active teacher
          const { data: teacherMatch } = await supabaseAdmin
            .from('teachers')
            .select('id, name')
            .or(`national_id.eq.${cleanId},national_id.eq.${unpadded},national_id.eq.${padded9}`)
            .eq('is_active', true)
            .limit(1)

          if (teacherMatch && teacherMatch.length > 0) {
            return res.status(400).json({ error: `תעודת זהות זו שייכת למורה (${teacherMatch[0].name}). לא ניתן להוסיף מורה כתלמיד.` })
          }

          const { data: existing } = await supabaseAdmin
            .from('students')
            .select('*')
            .eq('national_id', cleanId)
            .maybeSingle()

          if (existing) {
            if (existing.is_active === false) {
              const { data: reactivated, error: reactErr } = await supabaseAdmin
                .from('students')
                .update({
                  ...student,
                  is_active: true,
                  deleted_at: null
                })
                .eq('id', existing.id)
                .select()
                .single()

              if (reactErr) return res.status(500).json({ error: reactErr.message })
              return res.status(200).json({ student: reactivated, reactivated: true })
            } else {
              return res.status(400).json({ error: 'תלמיד עם תעודת זהות זו כבר קיים במערכת.' })
            }
          }

          const result = await supabaseAdmin.from('students').insert({ ...student, is_active: true }).select().single()
          if (result.error) return res.status(500).json({ error: result.error.message })
          return res.status(200).json({ student: result.data })
        }
      }
      if (action === 'restore' || action === 'restore_student') {
        const { data, error } = await supabaseAdmin
          .from('students')
          .update({ is_active: true, deleted_at: null })
          .eq('id', studentId)
          .select()
          .single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, student: data, restored: true })
      }
      if (action === 'delete' || action === 'delete_student') {
        // 1. חסימת מחיקה אם יש השאלה פעילה
        const { data: activeLoans } = await supabaseAdmin
          .from('device_loans')
          .select('id')
          .eq('student_id', studentId)
          .eq('status', 'active')
          .is('checkin_at', null)
          .limit(1)

        if (activeLoans && activeLoans.length > 0) {
          return res.status(400).json({ error: 'לא ניתן למחוק תלמיד שמחזיק כרגע מחשב מושאל. יש להחזיר תחילה את המחשב לתחנת העגלה.' })
        }

        // 2. השבתה רכה
        const { error } = await supabaseAdmin
          .from('students')
          .update({ is_active: false, deleted_at: new Date().toISOString() })
          .eq('id', studentId)

        if (error) return res.status(500).json({ error: error.message })

        // 3. ניקוי שיוכים מקבוצות לימוד פעילות
        try {
          await supabaseAdmin
            .from('student_group_members')
            .delete()
            .eq('student_id', studentId)
        } catch (e) {
          console.warn('Could not clean student group members:', e)
        }

        return res.status(200).json({ success: true, deactivated: true })
      }
      if (action === 'reset_strikes') {
        const { error } = await supabaseAdmin.from('students').update({ charge_strikes: 0, last_charged_at: new Date().toISOString() }).eq('id', studentId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── TEACHERS SCOPE ────────────────────────────────────────
    if (scope === 'teachers' || action === 'list_teachers' || action === 'save_teacher' || action === 'delete_teacher' || action === 'restore_teacher') {
      if (action === 'list' || action === 'list_teachers') {
        const { data: teachers, error } = await supabaseAdmin.from('teachers').select('*').order('name')
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ teachers: teachers || [] })
      }
      if (action === 'save' || action === 'save_teacher') {
        if (teacher.id) {
          const result = await supabaseAdmin.from('teachers').update(teacher).eq('id', teacher.id).select().single()
          if (result.error) return res.status(500).json({ error: result.error.message })
          return res.status(200).json({ teacher: result.data })
        } else {
          const cleanId = (teacher.national_id || '').trim()
          const { data: existing } = await supabaseAdmin
            .from('teachers')
            .select('*')
            .eq('national_id', cleanId)
            .maybeSingle()

          if (existing) {
            if (existing.is_active === false) {
              const { data: reactivated, error: reactErr } = await supabaseAdmin
                .from('teachers')
                .update({ ...teacher, is_active: true })
                .eq('id', existing.id)
                .select()
                .single()

              if (reactErr) return res.status(500).json({ error: reactErr.message })

              // Bidirectional Shield: Deactivate matching student records on reactivation
              const unpadded = cleanId.replace(/^0+/, '')
              const padded9 = cleanId.padStart(9, '0')
              const allVariantIds = [...new Set([cleanId, unpadded, padded9])]
              await supabaseAdmin
                .from('students')
                .update({ is_active: false, deleted_at: new Date().toISOString() })
                .in('national_id', allVariantIds)

              return res.status(200).json({ teacher: reactivated, reactivated: true })
            } else {
              return res.status(400).json({ error: 'מורה עם תעודת זהות זו כבר קיים במערכת.' })
            }
          }

          // Bidirectional Shield: Deactivate matching student records
          const unpadded = cleanId.replace(/^0+/, '')
          const padded9 = cleanId.padStart(9, '0')
          const allVariantIds = [...new Set([cleanId, unpadded, padded9])]
          await supabaseAdmin
            .from('students')
            .update({ is_active: false, deleted_at: new Date().toISOString() })
            .in('national_id', allVariantIds)

          const result = await supabaseAdmin.from('teachers').insert({ ...teacher, is_active: true }).select().single()
          if (result.error) return res.status(500).json({ error: result.error.message })
          return res.status(200).json({ teacher: result.data })
        }
      }
      if (action === 'restore' || action === 'restore_teacher') {
        const { data, error } = await supabaseAdmin.from('teachers').update({ is_active: true }).eq('id', teacherId).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, teacher: data, restored: true })
      }
      if (action === 'delete' || action === 'delete_teacher') {
        // 1. חסימת מחיקה אם יש השאלה פעילה
        const { data: activeLoans } = await supabaseAdmin
          .from('device_loans')
          .select('id')
          .eq('teacher_id', teacherId)
          .eq('status', 'active')
          .is('checkin_at', null)
          .limit(1)

        if (activeLoans && activeLoans.length > 0) {
          return res.status(400).json({ error: 'לא ניתן למחוק מורה שמחזיק כרגע מחשב מושאל. יש להחזיר תחילה את המחשב לתחנת העגלה.' })
        }

        const { error } = await supabaseAdmin.from('teachers').update({ is_active: false }).eq('id', teacherId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, deactivated: true })
      }
    }

    // ─── LOANS SCOPE ───────────────────────────────────────────
    if (scope === 'loans' || action === 'list_loans' || action === 'force_return') {
      if (action === 'list' || action === 'list_loans') {
        const { data: loans, error } = await supabaseAdmin.from('device_loans').select('*, students(name, national_id, class_name, grade), teachers(name, national_id), devices(device_number, asset_tag, cart_id, carts(name, display_name))').order('checkout_at', { ascending: false }).limit(100)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ loans: loans || [] })
      }
      if (action === 'force_return') {
        const { error } = await supabaseAdmin.from('device_loans').update({ checkin_at: new Date().toISOString(), status: 'returned', return_method: 'admin' }).eq('id', loanId).eq('status', 'active')
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── IMPORT SCOPE ──────────────────────────────────────────
    if (scope === 'import' || action === 'import') {
      if (!type || !Array.isArray(records)) return res.status(400).json({ error: 'type and records array are required' })

      if (type === 'students') {
        // Pre-fetch all teacher IDs to prevent any teacher from ever being inserted into students table
        const { data: teacherList } = await supabaseAdmin.from('teachers').select('national_id')
        const teacherNids = new Set()
        if (teacherList) {
          for (const t of teacherList) {
            if (t.national_id) {
              const raw = String(t.national_id).trim()
              teacherNids.add(raw)
              teacherNids.add(raw.replace(/^0+/, ''))
              teacherNids.add(raw.padStart(9, '0'))
            }
          }
        }

        let skippedTeachersCount = 0
        const uniqueRecords = Object.values(
          records.reduce((acc, r) => {
            if (r.national_id) {
              const cleanId = String(r.national_id).trim()
              const unpadded = cleanId.replace(/^0+/, '')
              const padded9 = cleanId.padStart(9, '0')

              const isTeacher = (
                r.class_name === 'מורה' ||
                (typeof r.class_name === 'string' && (r.class_name.includes('מורה') || r.class_name.includes('צוות'))) ||
                r.grade === 99 ||
                teacherNids.has(cleanId) ||
                teacherNids.has(unpadded) ||
                teacherNids.has(padded9)
              )

              if (isTeacher) {
                skippedTeachersCount++
              } else {
                acc[cleanId] = { ...acc[cleanId], ...r, national_id: cleanId, is_active: true, deleted_at: null }
              }
            }
            return acc
          }, {})
        )

        if (uniqueRecords.length === 0) {
          return res.status(200).json({ success: true, count: 0, unique_count: 0, skipped_teachers: skippedTeachersCount })
        }

        const { data, error } = await supabaseAdmin.from('students').upsert(uniqueRecords, { onConflict: 'national_id' }).select()
        if (error) return res.status(500).json({ error: error.message, unique_count: uniqueRecords.length })
        return res.status(200).json({ success: true, count: data?.length || 0, unique_count: uniqueRecords.length, skipped_teachers: skippedTeachersCount })
      }

      if (type === 'teachers') {
        const uniqueRecords = Object.values(
          records.reduce((acc, r) => {
            if (r.national_id) {
              const cleanId = String(r.national_id).trim()
              acc[cleanId] = { ...acc[cleanId], ...r, national_id: cleanId, is_active: true }
            }
            return acc
          }, {})
        )
        const { data, error } = await supabaseAdmin.from('teachers').upsert(uniqueRecords, { onConflict: 'national_id' }).select()
        if (error) return res.status(500).json({ error: error.message })

        // Bidirectional Shield: Clean up / deactivate any matching national IDs from students table
        const teacherIds = uniqueRecords.map(r => r.national_id).filter(Boolean)
        if (teacherIds.length > 0) {
          const unpaddedIds = teacherIds.map(id => id.replace(/^0+/, ''))
          const paddedIds = teacherIds.map(id => id.padStart(9, '0'))
          const allVariantIds = [...new Set([...teacherIds, ...unpaddedIds, ...paddedIds])]

          await supabaseAdmin
            .from('students')
            .update({ is_active: false, deleted_at: new Date().toISOString() })
            .in('national_id', allVariantIds)
        }

        return res.status(200).json({ success: true, count: data?.length || 0 })
      }
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API admin error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
