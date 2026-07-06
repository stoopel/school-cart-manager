import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { cartId, code } = req.body || {}
    if (!cartId || !code) {
      return res.status(400).json({ error: 'cartId and code are required' })
    }

    const { data: isValid, error } = await supabaseAdmin.rpc('verify_kiosk_code', {
      p_cart_id: cartId,
      p_code: code
    })

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({ isValid: !!isValid })
  } catch (err) {
    console.error('API station/verify-kiosk-code error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
