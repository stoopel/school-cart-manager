import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { nationalId } = req.body || {}
    if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })

    const { data: resRpc, error } = await supabaseAdmin.rpc('verify_teacher_id', {
      entered_id: nationalId
    })

    if (error) return res.status(500).json({ error: error.message })

    if (resRpc && resRpc.is_valid) {
      return res.status(200).json({
        isValid: true,
        teacher: { id: resRpc.teacher_id, name: resRpc.teacher_name }
      })
    }

    return res.status(200).json({ isValid: false, error: 'תעודת זהות אינה שייכת למורה מורשה' })
  } catch (err) {
    console.error('API teacher/verify error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
