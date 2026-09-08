import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { createDb, Db } from "./db"
import { accounts, users, roles, userRoles } from "./schema"
import { eq } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { Permission, hasPermission, ROLES, Role } from "./permissions"
import CredentialsProvider from "next-auth/providers/credentials"
import { hashPassword, comparePassword } from "@/lib/utils"
import { authSchema, AuthSchema } from "@/lib/validation"
import { generateAvatarUrl } from "./avatar"
import { getUserId } from "./apiKey"
import { verifyTurnstileToken } from "./turnstile"

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [ROLES.EMPEROR]: "皇帝（网站所有者）",
  [ROLES.DUKE]: "公爵（超级用户）",
  [ROLES.KNIGHT]: "骑士（高级用户）",
  [ROLES.CIVILIAN]: "平民（普通用户）",
}

const getDefaultRole = async (): Promise<Role> => {
  let defaultRole: string | null = null
  try {
    defaultRole = await getRequestContext()?.env?.SITE_CONFIG?.get("DEFAULT_ROLE")
  } catch {
    // fallback
  }

  if (
    defaultRole === ROLES.DUKE ||
    defaultRole === ROLES.KNIGHT ||
    defaultRole === ROLES.CIVILIAN
  ) {
    return defaultRole as Role
  }

  return ROLES.CIVILIAN
}

async function findOrCreateRole(db: Db, roleName: Role) {
  let role = await db.query.roles.findFirst({
    where: eq(roles.name, roleName),
  })

  if (!role) {
    const [newRole] = await db.insert(roles)
      .values({
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
      })
      .returning()
    role = newRole
  }

  return role
}

export async function assignRoleToUser(db: Db, userId: string, roleId: string) {
  await db.delete(userRoles)
    .where(eq(userRoles.userId, userId))

  await db.insert(userRoles)
    .values({
      userId,
      roleId,
    })
}

export async function getUserRole(userId: string) {
  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })
  return userRoleRecords[0].role.name
}

export async function checkPermission(permission: Permission) {
  const userId = await getUserId()

  if (!userId) return false

  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })

  const userRoleNames = userRoleRecords.map(ur => ur.role.name)
  return hasPermission(userRoleNames as Role[], permission)
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut
// eslint-disable-next-line @typescript-eslint/no-unused-vars
} = NextAuth((_req) => {
  let env: any = {}
  try {
    env = getRequestContext()?.env || {}
  } catch {
    // 本地开发环境降级兼容
  }

  const authSecret = env.AUTH_SECRET || process.env.AUTH_SECRET || "moemail-secret-random-fallback-key"
  const githubId = env.AUTH_GITHUB_ID || process.env.AUTH_GITHUB_ID || ""
  const githubSecret = env.AUTH_GITHUB_SECRET || process.env.AUTH_GITHUB_SECRET || ""

  return {
    trustHost: true,
    debug: true,
    secret: authSecret,
    adapter: DrizzleAdapter(createDb(), {
      usersTable: users,
      accountsTable: accounts,
    }),
    providers: [
      GitHub({
        clientId: githubId || process.env.AUTH_GITHUB_ID || "",
        clientSecret: githubSecret || process.env.AUTH_GITHUB_SECRET || "",
        allowDangerousEmailAccountLinking: true,
      }),
      CredentialsProvider({
        name: "Credentials",
        credentials: {
          username: { label: "用户名", type: "text", placeholder: "请输入用户名" },
          password: { label: "密码", type: "password", placeholder: "请输入密码" },
        },
        async authorize(credentials) {
          if (!credentials) {
            throw new Error("请输入用户名和密码")
          }

          const { username, password, turnstileToken } = credentials as Record<string, string | undefined>

          let parsedCredentials: AuthSchema
          try {
            parsedCredentials = authSchema.parse({ username, password, turnstileToken })
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (error) {
            throw new Error("输入格式不正确")
          }

          const verification = await verifyTurnstileToken(parsedCredentials.turnstileToken)
          if (!verification.success) {
            if (verification.reason === "missing-token") {
              throw new Error("请先完成安全验证")
            }
            throw new Error("安全验证未通过")
          }

          const db = createDb()

          const user = await db.query.users.findFirst({
            where: eq(users.username, parsedCredentials.username),
          })

          if (!user) {
            throw new Error("用户名或密码错误")
          }

          const isValid = await comparePassword(parsedCredentials.password, user.password as string)
          if (!isValid) {
            throw new Error("用户名或密码错误")
          }

          return {
            ...user,
            password: undefined,
          }
        },
      }),
    ],
    logger: {
      error(error: any) {
        console.error("[AUTH_ERROR]", error)
        try {
          const env = getRequestContext()?.env
          if (env?.SITE_CONFIG) {
            const errPayload = {
              name: error?.name || "UnknownError",
              message: error?.message || String(error),
              stack: error?.stack || "",
              cause: error?.cause ? {
                message: error.cause?.message || error.cause?.err?.message,
                stack: error.cause?.stack || error.cause?.err?.stack,
                ...((typeof error.cause === 'object') ? error.cause : {})
              } : null,
              time: new Date().toISOString()
            }
            env.SITE_CONFIG.put("LAST_AUTH_ERROR", JSON.stringify(errPayload))
          }
        } catch (e) {
          console.error("Failed to log auth error to KV", e)
        }
      },
      warn(code) {
        console.warn("[AUTH_WARN]", code)
      },
      debug(message, metadata) {
        console.log("[AUTH_DEBUG]", message, metadata)
      }
    },
    events: {
      async signIn({ user }) {
        if (!user.id) return

        try {
          const db = createDb()
          const existingRole = await db.query.userRoles.findFirst({
            where: eq(userRoles.userId, user.id),
          })

          if (existingRole) return

          const defaultRole = await getDefaultRole()
          const role = await findOrCreateRole(db, defaultRole)
          await assignRoleToUser(db, user.id, role.id)
        } catch (error) {
          console.error('Error assigning role in signIn event:', error)
        }
      },
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id
          token.name = user.name || user.username || "User"
          token.username = user.username || user.name || "User"
          token.image = user.image || generateAvatarUrl((token.name as string) || "User")
        }
        return token
      },
      async session({ session, token }) {
        if (token && session.user) {
          session.user.id = token.id as string
          session.user.name = token.name as string
          session.user.username = token.username as string
          session.user.image = token.image as string

          try {
            const db = createDb()
            let userRoleRecords = await db.query.userRoles.findMany({
              where: eq(userRoles.userId, session.user.id),
              with: { role: true },
            })

            if (!userRoleRecords.length) {
              const defaultRole = await getDefaultRole()
              const role = await findOrCreateRole(db, defaultRole)
              await assignRoleToUser(db, session.user.id, role.id)
              userRoleRecords = [{
                userId: session.user.id,
                roleId: role.id,
                createdAt: new Date(),
                role: role
              }]
            }

            session.user.roles = userRoleRecords.map(ur => ({
              name: ur.role.name,
            }))

            const userAccounts = await db.query.accounts.findMany({
              where: eq(accounts.userId, session.user.id),
            })

            session.user.providers = userAccounts.map(account => account.provider)
          } catch (error) {
            console.error('Error populating session roles/providers:', error)
            session.user.roles = [{ name: ROLES.CIVILIAN }]
            session.user.providers = []
          }
        }

        return session
      },
    },
    session: {
      strategy: "jwt",
    },
  }
})

export async function register(username: string, password: string) {
  const db = createDb()

  const existing = await db.query.users.findFirst({
    where: eq(users.username, username)
  })

  if (existing) {
    throw new Error("用户名已存在")
  }

  const hashedPassword = await hashPassword(password)

  const [user] = await db.insert(users)
    .values({
      username,
      password: hashedPassword,
    })
    .returning()

  return user
}
