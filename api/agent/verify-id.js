import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, nationalId } = req.body || {}
    if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })

    if (action === 'verify_teacher') {
      const { data: resRpc, error } = await supabaseAdmin.rpc('verify_teacher_id', {
        entered_id: nationalId
      })
      if (error) return res.status(500).json({ error: error.message })

      if (resRpc && resRpc.is_valid) {
        return res.status(200).json({
          isTeacher: true,
          teacher: { id: resRpc.teacher_id, name: resRpc.teacher_name }
        })
      }
      return res.status(200).json({ isTeacher: false, teacher: null })
    }

    if (action === 'verify_student') {
      const { data: stu, error } = await supabaseAdmin
        .from('students')
        .select('id, national_id, name, class_name, charge_strikes')
        .eq('national_id', nationalId)
        .single()

      if (error || !stu) {
        return res.status(404).json({ error: 'Student not found' })
      }
      return res.status(200).json({ student: stu })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API agent/verify-id error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
