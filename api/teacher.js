import { supabaseAdmin, setCorsHeaders } from './_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = req.body || {}
    const { action, nationalId, teacherId, subject, minutes, isLocked, lessonId, status } = body

    // Route 1: Teacher Verify
    if (action === 'verify' || nationalId) {
      if (!nationalId) return res.status(400).json({ error: 'nationalId is required' })
      const { data: resRpc, error } = await supabaseAdmin.rpc('verify_teacher_id', { entered_id: nationalId })
      if (error) return res.status(500).json({ error: error.message })
      if (resRpc && resRpc.is_valid) {
        return res.status(200).json({ isValid: true, teacher: { id: resRpc.teacher_id, name: resRpc.teacher_name } })
      }
      return res.status(200).json({ isValid: false, error: 'תעודת זהות אינה שייכת למורה מורשה' })
    }

    // Route 2: List Lessons
    if (action === 'list') {
      const { data, error } = await supabaseAdmin
        .from('lessons')
        .select('*, lesson_participants(id, student_id, loan_id, device_id, students(name, class_name), devices(device_number))')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ lessons: data || [] })
    }

    // Route 3: Create Lesson
    if (action === 'create') {
      const durationMins = parseInt(minutes, 10) || 45
      const now = new Date()
      const endTime = new Date(now.getTime() + durationMins * 60000)
      const lessonCode = Math.floor(1000 + Math.random() * 9000).toString()

      const { data: tData } = await supabaseAdmin.from('teachers').select('name').eq('id', teacherId).single()

      const { data: newLesson, error } = await supabaseAdmin
        .from('lessons')
        .insert({
          teacher_id: teacherId,
          teacher_name: tData?.name || 'מורה',
          subject: subject || 'שיעור',
          duration_minutes: durationMins,
          lesson_code: lessonCode,
          start_time: now.toISOString(),
          end_time: endTime.toISOString(),
          status: 'active',
          is_locked: !!isLocked
        })
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ lesson: newLesson })
    }

    // Route 4: Update Status
    if (action === 'update_status') {
      const updatePayload = { status }
      if (status === 'ended') updatePayload.end_time = new Date().toISOString()

      const { data, error } = await supabaseAdmin.from('lessons').update(updatePayload).eq('id', lessonId).select().single()
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ lesson: data })
    }

    return res.status(400).json({ error: 'Unknown route' })
  } catch (err) {
    console.error('API teacher error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
