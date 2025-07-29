import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

// 验证码验证API地址
const VERIFY_URL = "https://fc-mp-ae2d32e9-36f6-4046-8883-65a6c1860f4e.next.bspapp.com/checkVerificationCode?code=";

export async function POST(request: NextRequest) {
  const { code } = await request.json();

  // 校验验证码格式
  if (!code || code.length !== 8) {
    return NextResponse.json({ success: false, message: '请输入8位验证码' });
  }

  // 调用外部验证接口
  return new Promise((resolve) => {
    https.get(VERIFY_URL + code, { rejectUnauthorized: false }, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => data += chunk);
      
      apiRes.on('end', () => {
        try {
          const result = JSON.parse(data);
          // 仅需验证success字段（无需校验exists，按实际接口返回调整）
          if (result.success) {
            resolve(NextResponse.json({ success: true, message: '验证成功' }));
          } else {
            resolve(NextResponse.json({ 
              success: false, 
              message: result.message || '验证码无效' 
            }));
          }
        } catch (error) {
          resolve(NextResponse.json({ 
            success: false, 
            message: '验证服务响应异常' 
          }));
        }
      });
    }).on('error', () => {
      resolve(NextResponse.json({ 
        success: false, 
        message: '验证服务连接失败' 
      }));
    });
  });
}
