import { NextResponse } from "next/server"
import { ApiError, route, safeId } from "../../../../../lib/api.ts"
import { getJob, startBuild, subscribe, type Job } from "../../../../../lib/jobs.ts"
import { loadProject } from "../../../../../lib/store.ts"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  loadProject(id)
  if (getJob(id)?.status === "running") throw new ApiError("already rendering", 409)
  startBuild(id)
  return NextResponse.json({ status: "running" }, { status: 202 })
})

const state = (j?: Job) => ({ status: j?.status ?? "idle", error: j?.error })

// Server-sent events: the log so far, then each new line, then the final state.
export const GET = route(async (req: Request, { params }: Ctx) => {
  const id = safeId((await params).id)
  loadProject(id)
  const enc = new TextEncoder()
  let unsubscribe = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          unsubscribe()
        }
      }
      const job = getJob(id)
      job?.lines.forEach((l) => send("line", l))
      send("state", state(job))
      if (!job || job.status !== "running") return controller.close()
      unsubscribe = subscribe(id, (j, line) => {
        if (line) send("line", line)
        else {
          send("state", state(j))
          if (j.status !== "running") {
            unsubscribe()
            controller.close()
          }
        }
      })
      req.signal.addEventListener("abort", () => unsubscribe())
    },
    cancel: () => unsubscribe(),
  })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } })
})
