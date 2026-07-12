// Repair the @tensorflow/tfjs-node native install.
//
// On Windows + Node 22 (N-API v10) the pre-gyp install splits the native addon: the
// binding pre-gyp loads (lib/napi-v8/tfjs_binding.node) ends up WITHOUT its dependent
// tensorflow.dll, which lands in a sibling folder, so the binding fails to load with
// Windows error 126 ("module could not be found").
//
// Fix: ensure every lib/napi-v*/ folder that has the binding also has the shared
// libraries from deps/lib/ next to it. Idempotent, guarded, no-op if tfjs-node isn't
// installed. Safe to run from postinstall.
import { existsSync, readdirSync, copyFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../node_modules/@tensorflow/tfjs-node", import.meta.url))
if (!existsSync(root)) process.exit(0)

const libDir = join(root, "lib")
const depsLib = join(root, "deps", "lib")
if (!existsSync(libDir) || !existsSync(depsLib)) process.exit(0)

const sharedLibs = readdirSync(depsLib).filter((f) => /\.(dll|so|dylib)(\.\d+)*$/.test(f))
if (!sharedLibs.length) process.exit(0)

let fixed = 0
for (const napi of readdirSync(libDir)) {
  const folder = join(libDir, napi)
  if (!statSync(folder).isDirectory()) continue
  if (!existsSync(join(folder, "tfjs_binding.node"))) continue
  for (const lib of sharedLibs) {
    const dest = join(folder, lib)
    if (!existsSync(dest)) {
      copyFileSync(join(depsLib, lib), dest)
      fixed++
      console.log("fix-tfjs-node: placed " + lib + " in lib/" + napi)
    }
  }
}
if (!fixed) console.log("fix-tfjs-node: nothing to fix")
