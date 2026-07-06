import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, cartId, nationalId, deviceId, deviceNumber } = req.body || {}
    if (!cartId) return res.status(400).json({ error: 'cartId is required' })

    // Action 1: Lookup Student ID & Check Existing Loan
    if (action === 'confirm_id') {
      if (!nationalId || nationalId.length < 5) {
        return res.status(400).json({ error: 'תעודת זהות חייבת להכיל לפחות 5 ספרות' })
      }

      // Lookup student
      const { data: stu, error: stuErr } = await supabaseAdmin
        .from('students')
        .select('*')
        .eq('national_id', nationalId)
        .single()

      if (stuErr || !stu) {
        return res.status(404).json({ error: 'תעודת זהות לא נמצאה במערכת. פנה למורה.' })
      }

      // Check active loan
      const { data: existing } = await supabaseAdmin
        .from('device_loans')
        .select('id, devices(device_number, carts(name, display_name))')
        .eq('student_id', stu.id)
        .eq('status', 'active')
        .is('checkin_at', null)
        .single()

      if (existing) {
        const devNum = existing.devices?.device_number
        const cartName = existing.devices?.carts?.display_name || existing.devices?.carts?.name
        return res.status(400).json({
          error: `יש לך מחשב מס' ${devNum} מ${cartName} שלא הוחזר. יש להחזירו לפני לקיחת מחשב חדש.`
        })
      }

      return res.status(200).json({ student: stu })
    }

    // Action 2: Perform Device Checkout
    if (action === 'checkout') {
      const { studentId } = req.body || {}
      if (!studentId) return res.status(400).json({ error: 'studentId is required' })

      let targetDev = null
      if (deviceId) {
        const { data } = await supabaseAdmin
          .from('devices')
          .select('*')
          .eq('id', deviceId)
          .eq('cart_id', cartId)
          .is('deleted_at', null)
          .single()
        targetDev = data
      } else if (deviceNumber) {
        const { data } = await supabaseAdmin
          .from('devices')
          .select('*')
          .eq('cart_id', cartId)
          .eq('device_number', deviceNumber)
          .is('deleted_at', null)
          .single()
        targetDev = data
      }

      if (!targetDev) {
        return res.status(404).json({ error: 'מחשב לא נמצא במערכת.' })
      }

      // Check if device is taken
      const { data: takenLoan } = await supabaseAdmin
        .from('device_loans')
        .select('id')
        .eq('device_id', targetDev.id)
        .eq('status', 'active')
        .is('checkin_at', null)
        .single()

      if (takenLoan) {
        return res.status(400).json({ error: `מחשב מס' ${targetDev.device_number} כבר נלקח.` })
      }

      // Insert loan
      const { data: newLoan, error: insertErr } = await supabaseAdmin
        .from('device_loans')
        .insert({
          device_id: targetDev.id,
          student_id: studentId,
          checkout_method: 'cart_station',
          status: 'active'
        })
        .select()
        .single()

      if (insertErr) {
        return res.status(500).json({ error: 'שגיאה ברשת. נסה שנית.' })
      }

      return res.status(200).json({ success: true, device: targetDev, loan: newLoan })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API station/take-laptop error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
