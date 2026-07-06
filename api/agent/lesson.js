import { supabaseAdmin, setCorsHeaders } from '../_supabase.js'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { action, lessonCode, lessonId, studentId, loanId, deviceId, nationalId } = req.body || {}

    // Action 1: Get active lesson by code
    if (action === 'get_by_code') {
      const { data: rows } = await supabaseAdmin
        .from('active_lessons')
        .select('*')
        .eq('lesson_code', lessonCode)

      if (!rows || rows.length === 0) return res.status(200).json({ lesson: null })
      const { data: serverNow } = await supabaseAdmin.rpc('get_server_time')
      return res.status(200).json({ lesson: rows[0], server_now: serverNow })
    }

    // Action 2: Get active lesson by ID
    if (action === 'get_by_id') {
      const { data: rows } = await supabaseAdmin
        .from('active_lessons')
        .select('*')
        .eq('id', lessonId)

      if (!rows || rows.length === 0) return res.status(200).json({ lesson: null })
      const { data: serverNow } = await supabaseAdmin.rpc('get_server_time')
      return res.status(200).json({ lesson: rows[0], server_now: serverNow })
    }

    // Action 3: Join lesson
    if (action === 'join') {
      const { data: lessonData } = await supabaseAdmin
        .from('lessons')
        .select('id, end_time, status, teacher_name')
        .eq('id', lessonId)
        .single()

      if (!lessonData || lessonData.status !== 'active') {
        return res.status(400).json({ error: 'Lesson is not active' })
      }

      await supabaseAdmin.from('lesson_participants').insert({
        lesson_id: lessonId,
        student_id: studentId,
        loan_id: loanId,
        device_id: deviceId
      })

      await supabaseAdmin
        .from('device_loans')
        .update({ lesson_id: lessonId })
        .eq('id', loanId)

      return res.status(200).json({ success: true, lesson: lessonData })
    }

    // Action 4: Disconnect from lesson
    if (action === 'disconnect') {
      await supabaseAdmin.rpc('disconnect_student_from_lesson', {
        p_lesson_id: lessonId,
        p_student_id: studentId,
        p_loan_id: loanId
      })
      return res.status(200).json({ success: true })
    }

    // Action 5: Check pre-assigned active lesson
    if (action === 'check_pre_assigned') {
      const { data: resRpc } = await supabaseAdmin.rpc('get_pre_assigned_active_lesson', {
        entered_id: nationalId
      })
      return res.status(200).json({ lesson: resRpc })
    }

    return res.status(400).json({ error: 'Invalid action parameter' })
  } catch (err) {
    console.error('API agent/lesson error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
