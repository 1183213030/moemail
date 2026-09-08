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

  return NextResponse.json({
    env_keys: Object.keys(env),
    has_AUTH_GITHUB_ID: Boolean(githubId),
    githubId_preview: githubId ? `${githubId.slice(0, 4)}...${githubId.slice(-4)}` : "empty",
    has_AUTH_GITHUB_SECRET: Boolean(githubSecret),
    has_AUTH_SECRET: Boolean(authSecret),
  })
}
