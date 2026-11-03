import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export function discoverThemes(directories: string[]) {
  return discoverJson(directories, "themes")
}

/** Skins live beside themes, in `skins/*.json` under the same config directories. */
export function discoverSkins(directories: string[]) {
  return discoverJson(directories, "skins")
}

async function discoverJson(directories: string[], folder: string) {
  const result: Record<string, unknown> = {}
  for (const directory of directories) {
    const target = path.join(directory, folder)
    const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
      return Promise.reject(error)
    })
    const files = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && path.extname(entry.name) === ".json")
      .map((entry) => path.join(target, entry.name))
      .sort()
    for (const file of files) {
      result[path.basename(file, ".json")] = JSON.parse(await readFile(file, "utf8")) as unknown
    }
  }
  return result
}
