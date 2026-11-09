import { NextResponse } from "next/server"
import { route } from "../../../lib/api.ts"
import { filterVoices, loadVoices } from "../../../lib/voices.ts"

export const dynamic = "force-dynamic"

export const GET = route(async (req: Request) => {
  const lang = new URL(req.url).searchParams.get("lang") ?? undefined
  return NextResponse.json(filterVoices(loadVoices(), lang))
})
