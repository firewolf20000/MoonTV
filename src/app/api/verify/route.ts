// MoonTV/src/app/api/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

// 验证码验证API
const VERIFY_URL = "https://fc-mp-ae2d32e9-36f6-4046-8883-65a6c1860f4e.next.bspapp.com/checkVerificationCode?code=";

// 验证验证码
export async function POST(request: NextRequest) {
    const { code } = await request.json();

    if (!code || code.length !== 8) {
        return NextResponse.json({ success: false, message: '请输入8位验证码' });
    }

    // 调用验证API
    const url = VERIFY_URL + code;

    return new Promise((resolve) => {
        https.get(url, { rejectUnauthorized: false }, (apiRes) => {
            let data = '';

            apiRes.on('data', (chunk) => {
                data += chunk;
            });

            apiRes.on('end', () => {
                try {
                    const result = JSON.parse(data);

                    if (result.success && result.exists) {
                        resolve(NextResponse.json({ success: true, message: '验证成功，可以继续观看', createTime: result.createTime }));
                    } else {
                        resolve(NextResponse.json({ success: false, message: result.message || '验证码无效' }));
                    }
                } catch (error) {
                    console.error('解析API响应失败:', error);
                    resolve(NextResponse.json({ success: false, message: '验证服务响应异常' }));
                }
            });
        }).on('error', (error) => {
            console.error('验证API请求失败:', error);
            resolve(NextResponse.json({ success: false, message: '验证服务连接失败' }));
        });
    });
}
