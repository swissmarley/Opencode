import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test("the source self command loads TUI config when started outside packages/cli", async () => {
  await using root = await tmpdir()
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture", "self-command.ts"), root.path], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root.path),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect(stderr).not.toContain("jsx-dev-runtime")
  expect(stdout.trim()).toBe("loaded")
  expect(exitCode).toBe(0)
})
