import { getRequestContext } from "@cloudflare/next-on-pages"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"

export const createDb = (customD1?: D1Database) => {
  try {
    const d1 = customD1 || getRequestContext()?.env?.DB
    if (!d1) {
      return drizzle({} as any, { schema })
    }
    return drizzle(d1, { schema })
  } catch {
    return drizzle({} as any, { schema })
  }
}

export type Db = ReturnType<typeof createDb>
