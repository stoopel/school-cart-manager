import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { deviceId, batteryLevel, isCharging, status, loanId, eventType, payload } = req.body || {}
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' })

    const now = new Date().toISOString()
    const updateData = { last_seen: now }
    if (batteryLevel !== undefined) updateData.last_battery_level = batteryLevel
    if (isCharging !== undefined) updateData.is_charging = isCharging
    if (status) updateData.status = status

    await supabaseAdmin.from('devices').update(updateData).eq('id', deviceId)

    if (eventType) {
      await supabaseAdmin.from('event_log').insert({
        device_id: deviceId,
        loan_id: loanId || null,
        source: 'agent',
        event_type: eventType,
        payload: payload || {}
      })
    }

    return res.status(200).json({ success: true, server_time: now })
  } catch (err) {
    console.error('API agent/heartbeat error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
