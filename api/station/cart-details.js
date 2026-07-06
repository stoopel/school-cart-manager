import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { cartId } = req.body || {}
    if (!cartId) {
      return res.status(400).json({ error: 'cartId is required' })
    }

    // Fetch cart settings
    const { data: cart, error: cartError } = await supabaseAdmin
      .from('carts')
      .select('id, name, display_name, location, allow_manual_entry, enable_charge_tracking')
      .eq('id', cartId)
      .is('deleted_at', null)
      .single()

    if (cartError || !cart) {
      return res.status(444).json({ error: 'Cart not found' })
    }

    // Fetch cart stats
    const { data: statusData } = await supabaseAdmin
      .from('cart_status')
      .select('available_devices, active_loans')
      .eq('id', cartId)
      .single()

    const stats = {
      available: statusData?.available_devices ?? 0,
      taken: statusData?.active_loans ?? 0
    }

    return res.status(200).json({ cart, stats })
  } catch (err) {
    console.error('API station/cart-details error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
