import { getRequestContext } from "@cloudflare/next-on-pages"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

export const createDb = (customD1?: D1Database) => {
  if (customD1) {
    return drizzle(customD1, { schema })
  }

  const d1Proxy = new Proxy({} as D1Database, {
    get(_target, prop) {
      let activeD1: D1Database | undefined
      try {
        activeD1 = (getRequestContext() as any)?.env?.DB
      } catch {
        // outside of request context
      }

      if (!activeD1) {
        throw new Error("D1 Database not available in current request context")
      }

      const value = (activeD1 as any)[prop]
      if (typeof value === "function") {
        return value.bind(activeD1)
      }
      return value
    }
  })

  return drizzle(d1Proxy, { schema })
}

export type Db = ReturnType<typeof createDb>
