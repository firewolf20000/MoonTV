/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

// 直接放行所有请求，不进行任何认证检查
export async function middleware(request: NextRequest) {
  return NextResponse.next();
}

// 保留原有匹配规则（不影响，因为中间件已直接放行）
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config).*)',
  ],
};
