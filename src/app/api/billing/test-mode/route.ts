import { NextResponse } from 'next/server'
import { isTestMode } from '@/lib/payssam'
import { requireAdminSession } from '@/lib/auth'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  return NextResponse.json({ testMode: isTestMode() })
}
