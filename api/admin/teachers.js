import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, teacher, teacherId } = req.body || {}

    // List all teachers
    if (action === 'list') {
      const { data: teachers, error } = await supabaseAdmin
        .from('teachers')
        .select('*')
        .is('deleted_at', null)
        .order('name')

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ teachers: teachers || [] })
    }

    // Save teacher (insert/update)
    if (action === 'save') {
      let result
      if (teacher.id) {
        result = await supabaseAdmin.from('teachers').update(teacher).eq('id', teacher.id).select().single()
      } else {
        result = await supabaseAdmin.from('teachers').insert(teacher).select().single()
      }
      if (result.error) return res.status(500).json({ error: result.error.message })
      return res.status(200).json({ teacher: result.data })
    }

    // Delete teacher (soft delete)
    if (action === 'delete') {
      const { error } = await supabaseAdmin
        .from('teachers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', teacherId)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API admin/teachers error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
