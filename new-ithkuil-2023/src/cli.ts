/**
 * CLI: romanized New Ithkuil text → script SVG (and optional PNG).
 *
 *   tsx src/cli.ts "Wattunkí ruyün"                 # SVG to stdout
 *   tsx src/cli.ts "Wattunkí ruyün" -o word.svg     # SVG to file
 *   tsx src/cli.ts "Wattunkí ruyün" --png word.png -w 1000
 */
import { parseArgs } from "node:util"
import { writeFileSync } from "node:fs"
import { encode } from "./forward.js"
import { svgToPng } from "./raster.js"

const HELP = `Usage: encode "<ithkuil text>" [options]

  -o, --out <file.svg>   write SVG to a file (default: print to stdout)
      --png <file.png>   also render a PNG
  -w, --width <px>       PNG width (default: 800)
  -m, --margin <px>      viewBox margin (default: 20)
      --compact          compact layout (NOTE: not supported under Node yet)
  -h, --help             show this help`

function main(): number {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      png: { type: "string" },
      width: { type: "string", short: "w" },
      margin: { type: "string", short: "m" },
      compact: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  })

  if (values.help || positionals.length === 0) {
    console.log(HELP)
    return positionals.length === 0 && !values.help ? 1 : 0
  }

  const text = positionals[0]!
  const result = encode(text, {
    compact: values.compact ?? false,
    margin: values.margin != null ? Number(values.margin) : undefined,
  })

  if (!result.ok) {
    console.error(`✗ ${result.reason}`)
    return 1
  }

  // Diagnostics go to stderr so stdout stays clean for piping the SVG.
  if (values.out) {
    writeFileSync(values.out, result.svg)
    console.error(`wrote ${values.out}  (${result.pathCount} paths, viewBox ${result.viewBox})`)
  }
  if (values.png) {
    const png = svgToPng(result.svg, { width: values.width != null ? Number(values.width) : 800 })
    writeFileSync(values.png, png)
    console.error(`wrote ${values.png}  (${png.length} bytes)`)
  }
  if (!values.out && !values.png) {
    process.stdout.write(result.svg + "\n")
  }
  return 0
}

process.exit(main())
