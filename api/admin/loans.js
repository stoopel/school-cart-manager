import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, loanId } = req.body || {}

    // List active and past loans
    if (action === 'list') {
      const { data: loans, error } = await supabaseAdmin
        .from('device_loans')
        .select('*, students(name, national_id, class_name, grade), devices(device_number, asset_tag, cart_id, carts(name, display_name))')
        .order('checkout_at', { ascending: false })
        .limit(100)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ loans: loans || [] })
    }

    // Force return loan
    if (action === 'force_return') {
      const { error } = await supabaseAdmin
        .from('device_loans')
        .update({
          checkin_at: new Date().toISOString(),
          status: 'returned',
          return_method: 'admin_forced'
        })
        .eq('id', loanId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API admin/loans error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
