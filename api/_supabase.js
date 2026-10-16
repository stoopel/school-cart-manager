import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Auto-load .env for local Node execution if not already in process.env
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const idx = line.indexOf('=')
        if (idx > 0) {
          const k = line.slice(0, idx).trim()
          const v = line.slice(idx + 1).trim()
          if (!process.env[k]) process.env[k] = v
        }
      }
    }
  } catch (e) {}
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://zxggjorfknageseqlway.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[SERVER CONFIG WARNING] SUPABASE_SERVICE_ROLE_KEY is not defined. Serverless functions in api/ are running in degraded anonymous mode. RLS bypass will NOT be active.');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

export const PEPPER = process.env.SUPABASE_SERVICE_ROLE_KEY || 'cart-manager-secret'

export function normalizeId(rawId) {
  if (!rawId) return ''
  const digits = String(rawId).replace(/\D/g, '')
  return digits ? digits.padStart(9, '0') : ''
}

export function normalizeAndHashId(rawId) {
  const norm = normalizeId(rawId)
  if (!norm) return null
  return crypto.createHmac('sha256', PEPPER).update(norm).digest('hex')
}

export function getIdLast4(rawId) {
  const norm = normalizeId(rawId)
  return norm ? norm.slice(-4) : ''
}

export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  )
}
