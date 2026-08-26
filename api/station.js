import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { route } = req.query || {}
    const body = req.body || {}
    const targetRoute = body.route || body.endpoint || body.action || req.query?.route

    // Route 1: Cart Details & Stats
    if (targetRoute === 'cart-details') {
      const { cartId } = body
      if (!cartId) return res.status(400).json({ error: 'cartId is required' })

      const { data: cart, error: cartError } = await supabaseAdmin
        .from('carts')
        .select('id, name, display_name, location, allow_manual_entry, enable_charge_tracking')
        .eq('id', cartId)
        .is('deleted_at', null)
        .single()

      if (cartError || !cart) return res.status(444).json({ error: 'Cart not found' })

      const { data: statusData } = await supabaseAdmin
        .from('cart_status')
        .select('available_devices, active_loans')
        .eq('id', cartId)
        .single()

      return res.status(200).json({
        cart,
        stats: {
          available: statusData?.available_devices ?? 0,
          taken: statusData?.active_loans ?? 0
        }
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
    if (targetRoute === 'take-laptop' || targetRoute === 'confirm_id' || targetRoute === 'checkout') {
      const action = body.action || targetRoute
      const { cartId, nationalId, deviceId, deviceNumber, studentId, checkoutMethod } = body
      if (!cartId) return res.status(400).json({ error: 'cartId is required' })

      if (action === 'confirm_id') {
        if (!nationalId || nationalId.length < 5) {
          return res.status(400).json({ error: 'תעודת זהות חייבת להכיל לפחות 5 ספרות' })
        }
        const cleanId = String(nationalId).trim()
        const unpadded = cleanId.replace(/^0+/, '')
        const padded9 = cleanId.padStart(9, '0')

        // 1. Search in students table
        const { data: stus, error: stuErr } = await supabaseAdmin
          .from('students')
          .select('*')
          .or(`national_id.eq.${cleanId},national_id.eq.${unpadded},national_id.eq.${padded9}`)
          .limit(1)

        let stu = stus && stus.length > 0 ? stus[0] : null
        let isTeacher = false

        // 2. If not found in students, search in teachers table
        if (!stu) {
          const { data: teachers, error: tErr } = await supabaseAdmin
            .from('teachers')
            .select('*')
            .or(`national_id.eq.${cleanId},national_id.eq.${unpadded},national_id.eq.${padded9}`)
            .eq('is_active', true)
            .limit(1)

          if (teachers && teachers.length > 0) {
            const t = teachers[0]
            isTeacher = true
            stu = {
              id: t.id,
              national_id: t.national_id,
              name: t.name,
              class_name: 'מורה',
              grade: 0,
              is_teacher: true
            }
          }
        }

        if (!stu) return res.status(444).json({ error: 'תעודת זהות לא נמצאה במערכת. פנה למורה.' })

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

        return res.status(200).json({ student: stu, isTeacher })
      }

      if (action === 'checkout') {
        if (!studentId) return res.status(400).json({ error: 'studentId is required' })

        let targetDev = null
        if (deviceId) {
          const { data } = await supabaseAdmin.from('devices').select('*').eq('id', deviceId).eq('cart_id', cartId).is('deleted_at', null).single()
          targetDev = data
        } else if (deviceNumber) {
          const { data } = await supabaseAdmin.from('devices').select('*').eq('cart_id', cartId).eq('device_number', deviceNumber).is('deleted_at', null).single()
          targetDev = data
        }

        if (!targetDev) return res.status(444).json({ error: 'מחשב לא נמצא במערכת.' })

        const { data: takenLoan } = await supabaseAdmin.from('device_loans').select('id').eq('device_id', targetDev.id).eq('status', 'active').is('checkin_at', null).maybeSingle()
        if (takenLoan) return res.status(400).json({ error: `מחשב מס' ${targetDev.device_number} כבר נלקח.` })

        const validMethod = (checkoutMethod === 'qr_scan' || checkoutMethod === 'manual_number') ? checkoutMethod : 'manual_number'

        // Check if studentId is a teacher ID
        const { data: teacherRecord } = await supabaseAdmin.from('teachers').select('id, name, national_id').eq('id', studentId).eq('is_active', true).maybeSingle()

        const insertPayload = {
          device_id: targetDev.id,
          student_id: teacherRecord ? null : studentId,
          notes: teacherRecord ? JSON.stringify({ isTeacher: true, teacherId: teacherRecord.id, teacherName: teacherRecord.name, nationalId: teacherRecord.national_id }) : null,
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

        if (updateErr) return res.status(500).json({ error: 'שגיאה בהחזרת המחשב. נסה שוב.' })
        return res.status(200).json({ success: true })
      }

      if (!deviceIdOrNumber) return res.status(400).json({ error: 'deviceIdOrNumber or loanId is required' })

      const isUUID = /^[0-9a-f-]{36}$/i.test(deviceIdOrNumber)
      let dev = null
      if (isUUID) {
        const { data } = await supabaseAdmin.from('devices').select('*').eq('id', deviceIdOrNumber).eq('cart_id', cartId).is('deleted_at', null).single()
        dev = data
      } else {
        const { data } = await supabaseAdmin.from('devices').select('*').eq('cart_id', cartId).eq('device_number', deviceIdOrNumber).is('deleted_at', null).single()
        dev = data
      }

      if (!dev) return res.status(444).json({ error: 'מחשב לא נמצא במערכת.' })

      const { data: activeLoan } = await supabaseAdmin.from('device_loans').select('*, students(name, class_name)').eq('device_id', dev.id).eq('status', 'active').is('checkin_at', null).single()
      if (!activeLoan) return res.status(400).json({ error: `מחשב מס' ${dev.device_number} אינו מוגדר כמשואל כעת.` })

      return res.status(200).json({ device: dev, loan: activeLoan })
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API station error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
