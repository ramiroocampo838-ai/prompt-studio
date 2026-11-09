import { NextResponse } from "next/server"

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-_]*$/i

// Project ids end up in file paths, so they are validated at every entry point.
export function safeId(id: string): string {
  if (!ID_RE.test(id)) throw new ApiError("invalid project id")
  return id
}

export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args)
    } catch (e) {
      const status = e instanceof ApiError ? e.status : /not found/i.test((e as Error).message) ? 404 : 500
      return NextResponse.json({ error: (e as Error).message }, { status })
    }
  }
}
