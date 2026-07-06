import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, cart, cartId, device, deviceId } = req.body || {}

    // List all carts & status
    if (action === 'list') {
      const { data: carts, error: cErr } = await supabaseAdmin
        .from('carts')
        .select('*, devices(*)')
        .is('deleted_at', null)
        .order('name')

      const { data: statusList } = await supabaseAdmin.from('cart_status').select('*')

      if (cErr) return res.status(500).json({ error: cErr.message })
      return res.status(200).json({ carts: carts || [], statusList: statusList || [] })
    }

    // Save cart (insert/update)
    if (action === 'save_cart') {
      let result
      if (cart.id) {
        result = await supabaseAdmin.from('carts').update(cart).eq('id', cart.id).select().single()
      } else {
        result = await supabaseAdmin.from('carts').insert(cart).select().single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ cart: result.data })
    }

    // Delete cart (soft delete)
    if (action === 'delete_cart') {
      const { error } = await supabaseAdmin
        .from('carts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', cartId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    // Save device (insert/update)
    if (action === 'save_device') {
      let result
      if (device.id) {
        result = await supabaseAdmin.from('devices').update(device).eq('id', device.id).select().single()
      } else {
        result = await supabaseAdmin.from('devices').insert(device).select().single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ device: result.data })
    }

    // Delete device
    if (action === 'delete_device') {
      const { error } = await supabaseAdmin
        .from('devices')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deviceId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API admin/carts error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
