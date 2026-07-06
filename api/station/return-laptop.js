import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { cartId, deviceIdOrNumber, loanId } = req.body || {}
    if (!cartId) return res.status(400).json({ error: 'cartId is required' })

    // If confirmReturn: update loan
    if (loanId) {
      const { error: updateErr } = await supabaseAdmin
        .from('device_loans')
        .update({
          checkin_at: new Date().toISOString(),
          status: 'returned',
          return_method: 'cart_station'
        })
        .eq('id', loanId)

      if (updateErr) {
        return res.status(500).json({ error: 'שגיאה בהחזרת המחשב. נסה שוב.' })
      }

      return res.status(200).json({ success: true })
    }

    // Otherwise: lookup device & active loan
    if (!deviceIdOrNumber) {
      return res.status(400).json({ error: 'deviceIdOrNumber or loanId is required' })
    }

    const isUUID = /^[0-9a-f-]{36}$/i.test(deviceIdOrNumber)
    let dev = null

    if (isUUID) {
      const { data } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('id', deviceIdOrNumber)
        .eq('cart_id', cartId)
        .is('deleted_at', null)
        .single()
      dev = data
    } else {
      const { data } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('cart_id', cartId)
        .eq('device_number', deviceIdOrNumber)
        .is('deleted_at', null)
        .single()
      dev = data
    }

    if (!dev) {
      return res.status(404).json({ error: 'מחשב לא נמצא במערכת.' })
    }

    // Find active loan
    const { data: activeLoan } = await supabaseAdmin
      .from('device_loans')
      .select('*, students(name, class_name)')
      .eq('device_id', dev.id)
      .eq('status', 'active')
      .is('checkin_at', null)
      .single()

    if (!activeLoan) {
      return res.status(400).json({ error: `מחשב מס' ${dev.device_number} אינו מוגדר כמשואל כעת.` })
    }

    return res.status(200).json({ device: dev, loan: activeLoan })
  } catch (err) {
    console.error('API station/return-laptop error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
