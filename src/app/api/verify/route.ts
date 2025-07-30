import { NextResponse } from 'next/server';
import { getCacheTime } from '@/lib/config';

// 验证码验证API
const VERIFY_URL = "https://fc-mp-ae2d32e9-36f6-4046-8883-65a6c1860f4e.next.bspapp.com/checkVerificationCode?code=";

export const runtime = 'edge';

export async function POST(request: Request) {
  const { code } = await request.json();

  if (!code || code.length !== 8) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { success: false, message: '请输入8位验证码' },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }

  const url = VERIFY_URL + code;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const cacheTime = await getCacheTime();

    if (data.success && data.exists) {
      return NextResponse.json(
        { 
          success: true, 
          message: '验证成功，可以继续观看', 
          createTime: data.createTime 
        },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          },
        }
      );
    } else {
      return NextResponse.json(
        { 
          success: false, 
          message: data.message || '验证码无效' 
        },
        {
          headers: {
            'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
            'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
            'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          },
        }
      );
    }
  } catch (error) {
    console.error('验证API请求或解析响应失败:', error);
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { error: '验证服务响应异常' },
      { 
        status: 500,
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  }
}
