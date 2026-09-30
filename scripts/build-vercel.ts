import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const parent = path.join(root, ".vercel");
const output = path.join(parent, "output");
for (const directory of [parent, output]) {
  try { if ((await lstat(directory)).isSymbolicLink()) throw new Error("BUILD_SYMLINK_FORBIDDEN"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
if (path.dirname(output) !== parent || path.dirname(parent) !== root) throw new Error("INVALID_BUILD_DIRECTORY");
await mkdir(parent, { recursive: true });
await rm(output, { recursive: true, force: true });
const target = path.join(output, "functions", "index.func");
await mkdir(target, { recursive: true });
const safe = async (source: string) => {
  const name = path.basename(source);
  if ((await lstat(source)).isSymbolicLink()) throw new Error("BUILD_SYMLINK_FORBIDDEN");
  return !name.startsWith(".") && !["certs", "test", "tests"].includes(name) && !/\.(pem|crt|key|log|map)$/i.test(name);
};
async function compile(directory: string) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (!await safe(path.join(root, relative))) continue;
    if (entry.isDirectory()) { await compile(relative); continue; }
    if (!entry.name.endsWith(".ts")) throw new Error("UNEXPECTED_SERVER_ASSET");
    const destination = path.join(target, relative.replace(/\.ts$/, ".js"));
    const compiled = ts.transpileModule(await readFile(path.join(root, relative), "utf8"), {
      fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true }
    });
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, compiled.outputText);
  }
}
await compile("src");
await cp(path.join(root, "public"), path.join(target, "public"), { recursive: true, filter: safe });
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
for (const [relative, metadata] of Object.entries(lock.packages) as Array<[string, { dev?: boolean; link?: boolean }]>) {
  if (!relative || metadata.dev) continue;
  if (metadata.link || !/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(relative)) throw new Error("UNSUPPORTED_RUNTIME_DEPENDENCY_LAYOUT");
  await cp(path.join(root, relative), path.join(target, relative), { recursive: true, filter: safe });
}
await writeFile(path.join(target, "package.json"), JSON.stringify({ private: true, type: "module" }));
await writeFile(path.join(target, ".vc-config.json"), JSON.stringify({ runtime: "nodejs24.x", handler: "src/server/vercel.js", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 30 }));
await writeFile(path.join(output, "config.json"), JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }));
process.stdout.write("Private Vercel Node 24 function packaged; all routes use the existing backend. No public source, environment or certificate files.\n");
