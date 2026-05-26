/**
 * Production build:
 *   - Vite builds the client → client/dist/
 *   - esbuild bundles the server → dist/server.cjs (one CJS file)
 *   - client/dist/ is copied to dist/public/ so the bundled server can
 *     serve it via `serveStatic(app)` (which resolves `./public` next to
 *     the bundle).
 *
 * `npm start` then runs `node dist/server.cjs`. No tsx, no TypeScript at
 * runtime — small image, fast cold start on Render.
 */

import { build as esbuild } from "esbuild";
import { cp, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// Server runtime dependencies we DO want bundled into dist/server.cjs.
// Anything else gets marked external (left as a require at runtime) — that
// keeps the bundle small. drizzle-kit and supertest are devDeps and don't
// belong here.
const BUNDLE = new Set([
  "bcryptjs",
  "connect-pg-simple",
  "cors",
  "dotenv",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "openai",
  "pg",
  "zod",
]);

async function main() {
  const repoRoot = resolve(import.meta.dirname, "..");

  console.log("[build] cleaning dist…");
  await rm(resolve(repoRoot, "dist"), { recursive: true, force: true });
  await rm(resolve(repoRoot, "client/dist"), { recursive: true, force: true });

  console.log("[build] building client (vite)…");
  // Use the workspace's own `build` script so vite/postcss/tailwind all
  // resolve their configs the same way they do during `npm run dev` — going
  // through Vite's programmatic API here picks up the wrong tailwind config
  // and fails on missing classes.
  await runNpm(["run", "build", "--workspace", "client"], repoRoot);

  console.log("[build] copying client → dist/public…");
  await cp(resolve(repoRoot, "client/dist"), resolve(repoRoot, "dist/public"), {
    recursive: true,
  });

  console.log("[build] bundling server (esbuild)…");
  const rootPkg = JSON.parse(
    await readFile(resolve(repoRoot, "package.json"), "utf-8"),
  );
  const serverPkg = JSON.parse(
    await readFile(resolve(repoRoot, "server/package.json"), "utf-8"),
  );
  const allDeps = [
    ...Object.keys(rootPkg.dependencies ?? {}),
    ...Object.keys(rootPkg.devDependencies ?? {}),
    ...Object.keys(serverPkg.dependencies ?? {}),
    ...Object.keys(serverPkg.devDependencies ?? {}),
  ];
  const externals = Array.from(new Set(allDeps.filter((d) => !BUNDLE.has(d))));

  await esbuild({
    entryPoints: [resolve(repoRoot, "server/index.ts")],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "cjs",
    outfile: resolve(repoRoot, "dist/server.cjs"),
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    sourcemap: false,
    logLevel: "info",
    // Resolve @shared/* (the path alias) to ../shared at build time.
    alias: {
      "@shared": resolve(repoRoot, "shared"),
    },
  });

  console.log("[build] done.");
}

function runNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    const proc = spawn("npm", args, { cwd, stdio: "inherit", shell: false });
    proc.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`npm ${args.join(" ")} exited with ${code}`)),
    );
    proc.on("error", rej);
  });
}

main().catch((err) => {
  console.error("[build] FAILED:", err);
  process.exit(1);
});
