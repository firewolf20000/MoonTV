import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

// 验证码验证API
const VERIFY_URL = "https://fc-mp-ae2d32e9-36f6-4046-8883-65a6c1860f4e.next.bspapp.com/checkVerificationCode?code=";

// 明确返回类型为 Promise<NextResponse>
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { code } = await request.json();

  if (!code || code.length !== 8) {
    // 直接返回 NextResponse，类型明确
    return NextResponse.json({ success: false, message: '请输入8位验证码' });
  }

  const url = VERIFY_URL + code;

  // 使用 Promise 封装 HTTP 请求，确保返回 NextResponse
  return new Promise<NextResponse>((resolve) => {
    https.get(url, { rejectUnauthorized: false }, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => data += chunk);
      apiRes.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success && result.exists) {
            resolve(
              NextResponse.json({ 
                success: true, 
                message: '验证成功，可以继续观看', 
                createTime: result.createTime 
              })
            );
          } else {
            resolve(
              NextResponse.json({ 
                success: false, 
                message: result.message || '验证码无效' 
              })
            );
          }
        } catch (error) {
          console.error('解析API响应失败:', error);
          resolve(
            NextResponse.json({ 
              success: false, 
              message: '验证服务响应异常' 
            })
          );
        }
      });
    }).on('error', (error) => {
      console.error('验证API请求失败:', error);
      resolve(
        NextResponse.json({ 
          success: false, 
          message: '验证服务连接失败' 
        })
      );
    });
  });
}
