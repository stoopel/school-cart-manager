import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
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
        const { error } = await supabaseAdmin.from('devices').update({ deleted_at: new Date().toISOString() }).eq('id', deviceId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── STUDENTS SCOPE ────────────────────────────────────────
    if (scope === 'students' || action === 'list_students' || action === 'save_student' || action === 'delete_student' || action === 'reset_strikes') {
      if (action === 'list' || action === 'list_students') {
        const { data: students, error } = await supabaseAdmin.from('students').select('*').order('name')
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ students: students || [] })
      }
      if (action === 'save' || action === 'save_student') {
        const result = student.id ? await supabaseAdmin.from('students').update(student).eq('id', student.id).select().single() : await supabaseAdmin.from('students').insert(student).select().single()
        if (result.error) return res.status(500).json({ error: result.error.message })
        return res.status(200).json({ student: result.data })
      }
      if (action === 'delete' || action === 'delete_student') {
        const { error } = await supabaseAdmin.from('students').delete().eq('id', studentId)
        if (error) {
          if (error.code === '23503') return res.status(400).json({ error: 'לא ניתן למחוק תלמיד שיש לו היסטוריית השאלות במערכת.' })
          return res.status(500).json({ error: error.message })
        }
        return res.status(200).json({ success: true })
      }
      if (action === 'reset_strikes') {
        const { error } = await supabaseAdmin.from('students').update({ charge_strikes: 0, last_charged_at: new Date().toISOString() }).eq('id', studentId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── TEACHERS SCOPE ────────────────────────────────────────
    if (scope === 'teachers' || action === 'list_teachers' || action === 'save_teacher' || action === 'delete_teacher') {
      if (action === 'list' || action === 'list_teachers') {
        const { data: teachers, error } = await supabaseAdmin.from('teachers').select('*').order('name')
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ teachers: teachers || [] })
      }
      if (action === 'save' || action === 'save_teacher') {
        const result = teacher.id ? await supabaseAdmin.from('teachers').update(teacher).eq('id', teacher.id).select().single() : await supabaseAdmin.from('teachers').insert(teacher).select().single()
        if (result.error) return res.status(500).json({ error: result.error.message })
        return res.status(200).json({ teacher: result.data })
      }
      if (action === 'delete' || action === 'delete_teacher') {
        const { error } = await supabaseAdmin.from('teachers').delete().eq('id', teacherId)
        if (error) {
          if (error.code === '23503') {
            await supabaseAdmin.from('teachers').update({ is_active: false }).eq('id', teacherId)
            return res.status(200).json({ success: true, deactivated: true })
          }
          return res.status(500).json({ error: error.message })
        }
        return res.status(200).json({ success: true })
      }
    }

    // ─── LOANS SCOPE ───────────────────────────────────────────
    if (scope === 'loans' || action === 'list_loans' || action === 'force_return') {
      if (action === 'list' || action === 'list_loans') {
        const { data: loans, error } = await supabaseAdmin.from('device_loans').select('*, students(name, national_id, class_name, grade), devices(device_number, asset_tag, cart_id, carts(name, display_name))').order('checkout_at', { ascending: false }).limit(100)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ loans: loans || [] })
      }
      if (action === 'force_return') {
        const { error } = await supabaseAdmin.from('device_loans').update({ checkin_at: new Date().toISOString(), status: 'returned', return_method: 'admin' }).eq('id', loanId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true })
      }
    }

    // ─── IMPORT SCOPE ──────────────────────────────────────────
    if (scope === 'import' || action === 'import') {
      if (!type || !Array.isArray(records)) return res.status(400).json({ error: 'type and records array are required' })

      if (type === 'students') {
        const uniqueRecords = Object.values(
          records.reduce((acc, r) => {
            if (r.national_id) {
              const cleanId = String(r.national_id).trim().padStart(9, '0')
              acc[cleanId] = { ...acc[cleanId], ...r, national_id: cleanId }
            }
            return acc
          }, {})
        )
        const { data, error } = await supabaseAdmin.from('students').upsert(uniqueRecords, { onConflict: 'national_id' }).select()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, count: data?.length || 0 })
      }

      if (type === 'teachers') {
        const uniqueRecords = Object.values(
          records.reduce((acc, r) => {
            if (r.national_id) {
              const cleanId = String(r.national_id).trim().padStart(9, '0')
              acc[cleanId] = { ...acc[cleanId], ...r, national_id: cleanId }
            }
            return acc
          }, {})
        )
        const { data, error } = await supabaseAdmin.from('teachers').upsert(uniqueRecords, { onConflict: 'national_id' }).select()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(200).json({ success: true, count: data?.length || 0 })
      }
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API admin error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
