import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, student, studentId } = req.body || {}

    // List all students
    if (action === 'list') {
      const { data: students, error } = await supabaseAdmin
        .from('students')
        .select('*')
        .is('deleted_at', null)
        .order('name')

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ students: students || [] })
    }

    // Save student (insert/update)
    if (action === 'save') {
      let result
      if (student.id) {
        result = await supabaseAdmin.from('students').update(student).eq('id', student.id).select().single()
      } else {
        result = await supabaseAdmin.from('students').insert(student).select().single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ student: result.data })
    }

    // Delete student (soft delete)
    if (action === 'delete') {
      const { error } = await supabaseAdmin
        .from('students')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', studentId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    // Reset strikes
    if (action === 'reset_strikes') {
      const { error } = await supabaseAdmin
        .from('students')
        .update({ charge_strikes: 0, last_charged_at: new Date().toISOString() })
        .eq('id', studentId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API admin/students error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
