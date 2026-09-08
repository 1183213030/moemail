import { NextResponse } from "next/server"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { createDb } from "@/lib/db"
import { users, accounts, roles } from "@/lib/schema"

export const runtime = "edge"

export async function GET(request: Request) {
  let env: any = {}
  try {
    env = getRequestContext()?.env || {}
  } catch (e: any) {
    env = { error: e?.message }
  }

  const url = new URL(request.url)
  const shouldClear = url.searchParams.get("clear") === "1"

  let lastAuthError = null
  try {
    if (env?.SITE_CONFIG) {
      if (shouldClear) {
        await env.SITE_CONFIG.delete("LAST_AUTH_ERROR")
      } else {
        const raw = await env.SITE_CONFIG.get("LAST_AUTH_ERROR")
        if (raw) {
          try {
            lastAuthError = JSON.parse(raw)
          } catch {
            lastAuthError = raw
          }
        }
      }
    }
  } catch (e: any) {
    lastAuthError = { read_error: e?.message }
  }

  let d1Diagnostics: any = { status: "unknown" }
  try {
    const db = createDb()
    const userCount = await db.select().from(users).all()
    const accountCount = await db.select().from(accounts).all()
    const roleCount = await db.select().from(roles).all()
    d1Diagnostics = {
      status: "ok",
      userCount: userCount.length,
      accountCount: accountCount.length,
      roleCount: roleCount.length,
    }
  } catch (e: any) {
    d1Diagnostics = {
      status: "error",
      message: e?.message,
      stack: e?.stack,
    }
  }

  const githubId = env.AUTH_GITHUB_ID || process.env.AUTH_GITHUB_ID || ""
  const githubSecret = env.AUTH_GITHUB_SECRET || process.env.AUTH_GITHUB_SECRET || ""
  const authSecret = env.AUTH_SECRET || process.env.AUTH_SECRET || ""

  return NextResponse.json({
    env_keys: Object.keys(env),
    has_AUTH_GITHUB_ID: Boolean(githubId),
    githubId_preview: githubId ? `${githubId.slice(0, 4)}...${githubId.slice(-4)}` : "empty",
    has_AUTH_GITHUB_SECRET: Boolean(githubSecret),
    githubSecret_length: githubSecret.length,
    has_AUTH_SECRET: Boolean(authSecret),
    authSecret_length: authSecret.length,
    d1_diagnostics: d1Diagnostics,
    last_auth_error: lastAuthError,
  })
}
