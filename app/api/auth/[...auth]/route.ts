import { GET as authGET, POST as authPOST, latestAuthError } from "@/lib/auth"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { NextRequest, NextResponse } from "next/server"

export const runtime = 'edge'

async function handleAuthGet(req: NextRequest) {
  try {
    const res = await authGET(req)
    const location = res.headers.get("location")
    if (location && (location.includes("error=Configuration") || location.includes("error="))) {
      console.error("[AUTH_REDIRECT_ERROR]", { url: req.url, location, latestAuthError })
      const reqCtx = getRequestContext()
      if (reqCtx?.env?.SITE_CONFIG && latestAuthError) {
        const p = reqCtx.env.SITE_CONFIG.put("LAST_AUTH_ERROR", JSON.stringify(latestAuthError))
        if (reqCtx?.ctx?.waitUntil) reqCtx.ctx.waitUntil(p)
      }
    }
    return res
  } catch (err: any) {
    console.error("[AUTH_HANDLER_ERROR]", err)
    const errObj = {
      message: err?.message || String(err),
      stack: err?.stack,
      cause: err?.cause,
      time: new Date().toISOString()
    }
    const reqCtx = getRequestContext()
    if (reqCtx?.env?.SITE_CONFIG) {
      await reqCtx.env.SITE_CONFIG.put("LAST_AUTH_ERROR", JSON.stringify(errObj))
    }
    throw err
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  if (url.pathname.endsWith("/error")) {
    const errorParam = url.searchParams.get("error") || "default"
    const reqCtx = getRequestContext()
    let kvError = null
    try {
      if (reqCtx?.env?.SITE_CONFIG) {
        const raw = await reqCtx.env.SITE_CONFIG.get("LAST_AUTH_ERROR")
        if (raw) kvError = JSON.parse(raw)
      }
    } catch {}

    const detailedError = latestAuthError || kvError

    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>认证错误诊断 - MoeMail</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; line-height: 1.5; }
    .card { max-width: 800px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 2rem; border: 1px solid #334155; }
    h1 { color: #f87171; font-size: 1.5rem; margin-top: 0; }
    pre { background: #090d16; padding: 1rem; border-radius: 8px; overflow-x: auto; color: #38bdf8; font-size: 0.9rem; border: 1px solid #1e293b; }
    .btn { display: inline-block; background: #3b82f6; color: white; padding: 0.5rem 1rem; border-radius: 6px; text-decoration: none; margin-top: 1rem; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h1>认证失败 (Error Code: ${errorParam})</h1>
    <p>底层捕获的具体错误详情如下：</p>
    <pre>${JSON.stringify(detailedError || { error: errorParam, message: "No error details captured yet." }, null, 2)}</pre>
    <div>
      <a href="/login" class="btn">返回登录页</a>
      <a href="/api/auth/debug" class="btn" style="background:#475569;margin-left:8px;">查看完整环境诊断 (/api/auth/debug)</a>
    </div>
  </div>
</body>
</html>`

    return new NextResponse(html, {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  // If this is an OAuth callback with an iss query parameter, strip iss so oauth4webapi validation doesn't mismatch
  if (url.pathname.includes("/callback/") && url.searchParams.has("iss")) {
    const cleanUrl = new URL(req.url)
    cleanUrl.searchParams.delete("iss")
    const cleanReq = new NextRequest(cleanUrl.toString(), req)
    return await handleAuthGet(cleanReq)
  }

  return await handleAuthGet(req)
}

export async function POST(req: NextRequest) {
  try {
    return await authPOST(req)
  } catch (err: any) {
    console.error("[AUTH_POST_ERROR]", err)
    const errObj = {
      message: err?.message || String(err),
      stack: err?.stack,
      cause: err?.cause,
      time: new Date().toISOString()
    }
    const reqCtx = getRequestContext()
    if (reqCtx?.env?.SITE_CONFIG) {
      await reqCtx.env.SITE_CONFIG.put("LAST_AUTH_ERROR", JSON.stringify(errObj))
    }
    throw err
  }
}