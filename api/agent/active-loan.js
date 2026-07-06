import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { assetTag } = req.body || {}
    if (!assetTag) return res.status(400).json({ error: 'assetTag is required' })

    const { data: devs, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, device_number, cart_id, carts(enable_charge_tracking), device_loans(id, student_id, checkout_at, digital_login_at, lesson_id, students(id, national_id, name, class_name, grade, charge_strikes))')
      .eq('asset_tag', assetTag)
      .eq('device_loans.status', 'active')
      .is('device_loans.checkin_at', null)

    if (devErr) {
      console.error('Error fetching active loan for assetTag:', assetTag, devErr)
      return res.status(500).json({ error: devErr.message })
    }

    if (!devs || devs.length === 0) {
      return res.status(200).json({ loan: null })
    }

    const dev = devs[0]
    const loans = dev.device_loans
    if (!loans || !Array.isArray(loans) || loans.length === 0) {
      return res.status(200).json({ loan: null })
    }

    const loan = loans[0]
    const s = Array.isArray(loan.students) ? loan.students[0] : loan.students
    if (!s) {
      return res.status(200).json({ loan: null })
    }

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
  } catch (err) {
    console.error('API agent/active-loan error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
