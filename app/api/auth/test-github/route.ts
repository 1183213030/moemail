import { NextResponse } from "next/server"
import { getRequestContext } from "@cloudflare/next-on-pages"

export const runtime = "edge"

export async function GET() {
  let env: any = {}
  try {
    env = getRequestContext()?.env || {}
  } catch (e: any) {
    env = { error: e?.message }
  }

  const githubId = env.AUTH_GITHUB_ID || process.env.AUTH_GITHUB_ID || ""
  const githubSecret = env.AUTH_GITHUB_SECRET || process.env.AUTH_GITHUB_SECRET || ""
  const authSecret = env.AUTH_SECRET || process.env.AUTH_SECRET || ""
  const trustHost = env.AUTH_TRUST_HOST || process.env.AUTH_TRUST_HOST || ""

  const directGithubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${githubId}&redirect_uri=${encodeURIComponent("https://moemail-ot0.pages.dev/api/auth/callback/github")}&scope=read:user%20user:email`

  return NextResponse.json({
    diagnostics: {
      githubId_length: githubId.length,
      githubId_raw: githubId,
      githubSecret_length: githubSecret.length,
      authSecret_length: authSecret.length,
      trustHost: trustHost,
      directGithubAuthUrl: directGithubAuthUrl,
    }
  })
}
