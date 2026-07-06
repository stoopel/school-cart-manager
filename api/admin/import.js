import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { type, records } = req.body || {}
    if (!type || !Array.isArray(records)) {
      return res.status(400).json({ error: 'type and records array are required' })
    }

    if (type === 'students') {
      const { data, error } = await supabaseAdmin
        .from('students')
        .upsert(records, { onConflict: 'national_id' })
        .select()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true, count: data?.length || 0 })
    }

    if (type === 'teachers') {
      const { data, error } = await supabaseAdmin
        .from('teachers')
        .upsert(records, { onConflict: 'national_id' })
        .select()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true, count: data?.length || 0 })
    }

    return res.status(400).json({ error: 'Invalid import type' })
  } catch (err) {
    console.error('API admin/import error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
