/**
 * Background-job manager for the local tool's data/model control panel (M8 v2).
 *
 * Runs the project's own scripts (dataset generation, CNN training, round-trip/eval
 * harnesses) as tracked child processes and captures their output for the UI to poll.
 *
 * Process lifecycle is the whole point here — an earlier iteration left orphaned
 * training workers because it killed only the top of an `npm → tsx → worker` chain.
 * We avoid that two ways:
 *   1. spawn each script as a SINGLE process — `node --import tsx <script>` — with no
 *      npm/shell wrapper, so there's one PID to own;
 *   2. cancel and shutdown kill the whole PROCESS TREE (`taskkill /T` on Windows,
 *      negative-pid group kill on POSIX), and the server kills every running job on exit.
 *
 * Only whitelisted scripts run, and each job's argv is built server-side from a typed
 * args object — the client can't name an arbitrary path or flag.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url)) // new-ithkuil-2023/
const LOG_CAP = 800 // ring-buffer line cap per job

/** Whitelisted job kinds → their script + whether they're a heavy (one-at-a-time) job. */
interface JobKind {
  label: string
  script: string // relative to src/
  heavy?: boolean // dataset/train: CPU-bound, only one at a time
  /** Build argv from a validated args object (never trust raw client argv). */
  argv?: (a: Record<string, unknown>) => string[]
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}
/** Safe directory basename: letters, digits, dash, underscore only (no traversal). */
const safeName = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null
const token = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null

export const JOB_KINDS: Record<string, JobKind> = {
  dataset: {
    label: "Generate dataset",
    script: "generate-dataset.ts",
    heavy: true,
    argv: (a) => {
      const out = safeName(a.out) ?? "dataset"
      const args = ["--out", out]
      const perClass = num(a.perClass, 1, 500)
      if (perClass) args.push("--per-class", String(perClass))
      const size = num(a.size, 16, 512)
      if (size) args.push("--size", String(size))
      const seed = num(a.seed, 0, 1e9)
      if (seed != null) args.push("--seed", String(seed))
      const family = token(a.family)
      if (family) args.push("--family", family)
      const noise = num(a.noise, 0, 255)
      if (noise) args.push("--noise", String(noise))
      const blur = num(a.blur, 0, 10)
      if (blur) args.push("--blur", String(blur))
      if (a.clean === true) args.push("--clean")
      return args
    },
  },
  train: {
    label: "Train CNN",
    script: "cnn.ts",
    heavy: true,
    argv: (a) => {
      // positional: [dataset-dir] [epochs] [trainPerClass]
      const dir = safeName(a.dir) ?? "cnn-dataset"
      const epochs = num(a.epochs, 1, 200) ?? 12
      const perClass = num(a.trainPerClass, 1, 500) ?? 16
      return [dir, String(epochs), String(perClass)]
    },
  },
  "cache:alphabetic": {
    label: "Build alphabetic cache",
    script: "build-alphabetic-cache.ts",
    heavy: true,
    argv: (a) => (a.force === true ? ["--force"] : []),
  },
  "test:word": { label: "Word round-trip", script: "word-roundtrip.ts" },
  "test:phrase": { label: "Phrase round-trip", script: "phrase-roundtrip.ts" },
  "test:alphabetic": { label: "Alphabetic round-trip", script: "alphabetic-test.ts" },
  "test:quaternary": { label: "Quaternary round-trip", script: "quaternary-roundtrip.ts" },
  "test:tertiary": { label: "Tertiary round-trip", script: "tertiary-roundtrip.ts" },
  "test:primary": { label: "Primary round-trip", script: "primary-roundtrip.ts" },
  "test:secondary": { label: "Secondary round-trip", script: "secondary-roundtrip.ts" },
  eval: { label: "Classifier eval", script: "eval-classifier.ts" },
}

export type JobStatus = "running" | "done" | "error" | "cancelled"

interface JobState {
  id: string
  kind: string
  label: string
  status: JobStatus
  code: number | null
  startedAt: number
  endedAt: number | null
  log: string[]
  partial: string // incomplete trailing line buffer
  child: ChildProcess | null
}

const jobs = new Map<string, JobState>()
let counter = 0

function pushLine(job: JobState, line: string): void {
  job.log.push(line)
  if (job.log.length > LOG_CAP) job.log.splice(0, job.log.length - LOG_CAP)
}
function feed(job: JobState, chunk: Buffer): void {
  job.partial += chunk.toString("utf8")
  const parts = job.partial.split(/\r?\n/)
  job.partial = parts.pop() ?? ""
  for (const l of parts) pushLine(job, l)
}

/** True while a heavy (dataset/train) job is running — used to reject a second one. */
export function heavyRunning(): boolean {
  for (const j of jobs.values()) if (j.status === "running" && JOB_KINDS[j.kind]?.heavy) return true
  return false
}

export interface StartResult {
  ok: boolean
  id?: string
  error?: string
}

export function startJob(kind: string, args: Record<string, unknown> = {}): StartResult {
  const def = JOB_KINDS[kind]
  if (!def) return { ok: false, error: `unknown job "${kind}"` }
  if (def.heavy && heavyRunning()) return { ok: false, error: "a dataset/train job is already running" }

  const id = `${kind.replace(/[^a-z]/g, "")}-${Date.now()}-${++counter}`
  const scriptPath = resolve(PROJECT_ROOT, "src", def.script)
  const argv = ["--import", "tsx", scriptPath, ...(def.argv ? def.argv(args) : [])]

  const child = spawn(process.execPath, argv, {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  })
  const job: JobState = {
    id,
    kind,
    label: def.label,
    status: "running",
    code: null,
    startedAt: Date.now(),
    endedAt: null,
    log: [],
    partial: "",
    child,
  }
  jobs.set(id, job)
  pushLine(job, `$ node --import tsx src/${def.script} ${(def.argv ? def.argv(args) : []).join(" ")}`)

  child.stdout?.on("data", (c: Buffer) => feed(job, c))
  child.stderr?.on("data", (c: Buffer) => feed(job, c))
  child.on("error", (e) => pushLine(job, `[spawn error] ${e.message}`))
  child.on("close", (code) => {
    if (job.partial) {
      pushLine(job, job.partial)
      job.partial = ""
    }
    job.endedAt = Date.now()
    job.child = null
    if (job.status !== "cancelled") job.status = code === 0 ? "done" : "error"
    job.code = code
  })
  return { ok: true, id }
}

/** Kill an OS process tree (so no child of the spawned script survives). */
function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true })
  } else {
    try {
      process.kill(-pid, "SIGKILL") // negative = process group
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
  }
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job || job.status !== "running" || !job.child?.pid) return false
  job.status = "cancelled"
  pushLine(job, "[cancelled by user]")
  killTree(job.child.pid)
  return true
}

interface PublicJob {
  id: string
  kind: string
  label: string
  status: JobStatus
  code: number | null
  startedAt: number
  endedAt: number | null
  logTail: string[]
}

/** Job summaries (newest first) with a short log tail — for the polling UI. */
export function listJobs(tail = 4): PublicJob[] {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((j) => ({
      id: j.id,
      kind: j.kind,
      label: j.label,
      status: j.status,
      code: j.code,
      startedAt: j.startedAt,
      endedAt: j.endedAt,
      logTail: j.log.slice(-tail),
    }))
}

/** Full current log for one job. */
export function jobLog(id: string): string[] | null {
  const j = jobs.get(id)
  return j ? j.log.slice() : null
}

/** Kill every running job — call on server shutdown so nothing is orphaned. */
export function shutdownAllJobs(): void {
  for (const j of jobs.values()) {
    if (j.status === "running" && j.child?.pid) {
      j.status = "cancelled"
      killTree(j.child.pid)
    }
  }
}

let hooked = false
/** Install process-exit handlers once so jobs never outlive the server. */
export function installJobShutdownHooks(): void {
  if (hooked) return
  hooked = true
  const bye = () => {
    shutdownAllJobs()
    process.exit(0)
  }
  process.on("SIGINT", bye)
  process.on("SIGTERM", bye)
  process.on("exit", shutdownAllJobs)
}
