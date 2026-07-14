#!/usr/bin/env node
/**
 * setup.mjs — one-command deploy / health-check for the New Ithkuil 2023 converter.
 *
 *   node scripts/setup.mjs              provision everything needed to run (idempotent)
 *   node scripts/setup.mjs --check      verify readiness only; exit 1 if not ready (doctor/CI)
 *   node scripts/setup.mjs --with-models also TRAIN the optional CNNs afterwards (long — hours)
 *   node scripts/setup.mjs --help
 *
 * The DEFAULT (core) deploy makes both paths work: forward (text → script) and the
 * template-based reverse (script → text). The four CNNs are *accuracy upgrades* — the
 * decoder falls back to template matching when a model is absent — so they're opt-in.
 *
 * Every step is idempotent and guarded by a check, so this is safe to re-run and doubles
 * as a health report. Uses only Node built-ins (it runs before anything is guaranteed).
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const ROOT = fileURLToPath(new URL("..", import.meta.url)) // new-ithkuil-2023/
const flags = new Set(process.argv.slice(2))
if (flags.has("--help") || flags.has("-h")) {
  printHelp()
  process.exit(0)
}
const CHECK = flags.has("--check") || flags.has("doctor")
const WITH_MODELS = flags.has("--with-models")

// ── tiny console styling (degrades to plain text when not a TTY) ────────────────
const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (n, s) => (color ? `\x1b[${n}m${s}\x1b[0m` : s)
const green = (s) => paint("32", s)
const red = (s) => paint("31", s)
const yellow = (s) => paint("33", s)
const bold = (s) => paint("1", s)
const dim = (s) => paint("2", s)
const ok = (m) => console.log(`  ${green("✓")} ${m}`)
const info = (m) => console.log(`  ${yellow("•")} ${m}`)
const bad = (m) => console.log(`  ${red("✗")} ${m}`)
const head = (m) => console.log(`\n${bold(m)}`)

let problems = 0
const fail = (m) => {
  bad(m)
  problems++
}

// ── spawn helpers ───────────────────────────────────────────────────────────────
const winShell = process.platform === "win32"
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: winShell, ...opts })
  return r.status === 0
}
const npm = (args) => run("npm", args)
const tsx = (script, args = []) => run("npx", ["tsx", script, ...args])

// ── environment / artifact probes ───────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0])
const hasDeps = () => existsSync(join(ROOT, "node_modules", "@zsnout", "ithkuil"))
const hasDataset = () => existsSync(join(ROOT, "dataset", "manifest.json"))
const hasAlphaCache = () => existsSync(join(ROOT, "models", "alphabetic-base.json"))
const hasSecondaryCache = () => existsSync(join(ROOT, "models", "secondary-ext.json"))
const hasModel = (dir) => existsSync(join(ROOT, "models", dir, "model.json"))

/** Whether the native tfjs-node addon actually loads (Windows error-126 territory). It's
 * a hard requirement: the decode pipeline statically imports the CNN loaders. */
function tfjsLoads() {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('@tensorflow/tfjs-node').then(()=>process.exit(0),()=>process.exit(3))"],
    { cwd: ROOT, stdio: "ignore" },
  )
  return r.status === 0
}

const MODELS = [
  ["consonant-cnn", "consonant-core CNN — near-identical pairs + noise robustness", "npm run cnn"],
  ["primary-cnn", "primary CNN — decodes Vr/Vv (function, context, stem)", "npm run cnn-primary"],
  ["top-cnn", "top-extension CNN — 3-consonant clusters", "npm run cnn-top"],
  ["alpha-cnn", "alphabetic-base CNN — n↔ż / d↔ļ / p↔v + stress + gemination", "npm run cnn-alpha"],
]

// ── DOCTOR: read-only readiness report ───────────────────────────────────────────
function doctor() {
  console.log(bold("\nNew Ithkuil 2023 — readiness check\n"))

  head("Environment")
  if (nodeMajor >= 18) ok(`Node ${process.versions.node}`)
  else fail(`Node ${process.versions.node} — need ≥ 18 (20 or 22 recommended)`)
  if (hasDeps()) ok("dependencies installed")
  else fail(`dependencies missing — run: ${bold("npm install")}`)
  if (!hasDeps()) info("skipping tfjs-node check (install deps first)")
  else if (tfjsLoads()) ok("tfjs-node native backend loads")
  else fail(`tfjs-node fails to load — run: ${bold("npm run fix-tfjs-node")} (or reinstall)`)

  head("Reverse-decode data (required to decode script → text)")
  if (hasDataset()) ok("glyph template dataset present (dataset/)")
  else fail(`template dataset missing — run: ${bold("npm run dataset")}`)
  if (hasAlphaCache()) ok("alphabetic base-template cache built")
  else info("alphabetic cache not built — auto-builds on first decode (~5 min, one-time)")
  if (hasSecondaryCache()) ok("secondary-extension cache built")
  else info("secondary-ext cache not built — auto-builds on first decode (~4 min, one-time)")

  head("Optional CNN models (decode falls back to templates without these)")
  for (const [dir, desc, cmd] of MODELS) {
    if (hasModel(dir)) ok(desc)
    else info(`${desc} — not trained (${dim(cmd)})`)
  }

  const ready = problems === 0
  console.log(
    "\n" +
      (ready
        ? green(bold("READY")) + " — forward + reverse pipelines can run. Start with: " + bold("npm run serve")
        : red(bold(`NOT READY`)) + ` — ${problems} required item(s) missing above. Run: ` + bold("npm run setup")),
  )
  process.exit(ready ? 0 : 1)
}

// ── SETUP: provision everything (idempotent) ─────────────────────────────────────
function setup() {
  console.log(bold("\nNew Ithkuil 2023 — automated setup\n"))
  if (nodeMajor < 18) {
    bad(`Node ${process.versions.node} is too old — install Node ≥ 18 (20 or 22 recommended) and re-run.`)
    process.exit(1)
  }

  head("1/5  Dependencies")
  if (hasDeps()) ok("already installed")
  else if (!npm(["install"])) die("npm install failed")
  // Always (re)run the native-addon repair — it's a no-op when nothing needs fixing.
  npm(["run", "fix-tfjs-node"])

  head("2/5  Native backend (tfjs-node)")
  if (tfjsLoads()) ok("tfjs-node loads")
  else
    die(
      "tfjs-node still won't load after the repair.\n" +
        "     Try a clean reinstall: rm -rf node_modules && npm install\n" +
        "     (On Windows the addon needs its sibling tensorflow.dll — fix-tfjs-node copies it.)",
    )

  head("3/5  Glyph template dataset  (required for reverse decode)")
  if (hasDataset()) ok("dataset/ present")
  else {
    info("generating dataset/ — a few minutes…")
    if (!tsx("src/generate-dataset.ts")) die("dataset generation failed")
    ok("dataset/ generated")
  }

  head("4/5  Reverse-decode template caches  (so the first request isn't slow)")
  if (hasAlphaCache()) ok("alphabetic cache present")
  else {
    info("building alphabetic base-template cache (~1200 renders, several minutes)…")
    if (!tsx("src/build-alphabetic-cache.ts")) die("alphabetic cache build failed")
    ok("alphabetic cache built")
  }
  // The secondary-extension cache has no standalone builder — the verify step below
  // decodes real secondaries, which builds models/secondary-ext.json as a side effect.

  head("5/5  Verify end-to-end  (also builds the secondary-ext cache)")
  info("decoding a batch of composed words — several minutes on first run…")
  const verified = npm(["run", "word-test"])
  if (verified && hasSecondaryCache()) ok("reverse pipeline works; secondary-ext cache built")
  else if (verified) info("reverse pipeline ran (check the round-trip line above)")
  else die("verification (word round-trip) failed to run — see output above")

  if (WITH_MODELS) trainModels()

  head("Done")
  const trained = MODELS.filter(([d]) => hasModel(d)).length
  ok(`core deploy complete — ${trained}/${MODELS.length} optional CNNs present`)
  if (trained < MODELS.length && !WITH_MODELS) {
    console.log(
      dim(
        `     Decode uses template fallback for the ${MODELS.length - trained} untrained CNN(s). ` +
          `Train them any time with ${bold("npm run setup -- --with-models")}\n` +
          `     or individually (${MODELS.map(([, , c]) => c.replace("npm run ", "")).join(", ")}).`,
      ),
    )
  }
  console.log("\n" + green(bold("READY")) + " — start the local web tool with:  " + bold("npm run serve"))
  console.log(dim("            then open http://localhost:3939  (encode + decode + data/model job panel)"))
}

/** Optional, long: train the four CNNs. Each is idempotent (skipped if already present). */
function trainModels() {
  head("CNN training (optional — this can take a couple of hours total)")
  info("Each model is skipped if already trained. Ctrl-C is safe between models.")

  // The consonant CNN trains on a separately-generated, augmentation-heavy dataset.
  if (!hasModel("consonant-cnn")) {
    if (!existsSync(join(ROOT, "cnn-dataset", "manifest.json"))) {
      info("generating cnn-dataset/ (augmented, for the consonant CNN)…")
      tsx("src/generate-dataset.ts", ["--out", "cnn-dataset", "--per-class", "60"])
    }
    info("training consonant-core CNN…")
    npm(["run", "cnn"])
  } else ok("consonant-cnn already trained")

  // The other three render + cache their own data.
  for (const [dir, desc, cmd] of MODELS.slice(1)) {
    if (hasModel(dir)) {
      ok(`${dir} already trained`)
      continue
    }
    info(`training ${dir} — ${desc}…`)
    npm(["run", cmd.replace("npm run ", "")]) // cmd is e.g. "npm run cnn-primary"
  }
}

function die(msg) {
  console.log("\n" + red(bold("SETUP FAILED")) + "  " + msg)
  process.exit(1)
}

function printHelp() {
  console.log(`New Ithkuil 2023 converter — setup / deploy helper

Usage:
  node scripts/setup.mjs              Provision everything to run (idempotent). Aliased as: npm run setup
  node scripts/setup.mjs --check      Health check only; exits 1 if not ready. Aliased as: npm run doctor
  node scripts/setup.mjs --with-models  Also train the four optional CNNs afterwards (long — hours)
  node scripts/setup.mjs --help

Core setup provisions: npm deps + native tfjs-node repair, the glyph template dataset,
the reverse-decode template caches, and an end-to-end verification. The four CNNs are
optional accuracy upgrades (decode falls back to template matching without them).`)
}

// ── entry ────────────────────────────────────────────────────────────────────────
if (CHECK) doctor()
else setup()
