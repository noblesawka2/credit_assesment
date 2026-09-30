import { mkdir, cp, rm, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = path.resolve(root, "dist");
if (path.dirname(output) !== root || path.basename(output) !== "dist") throw new Error("INVALID_BUILD_DIRECTORY");
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const entry of ["src", "public", "package.json", "package-lock.json"]) {
  await cp(path.join(root, entry), path.join(output, entry), {
    recursive: true,
    filter: async source => {
      const name = path.basename(source);
      const information = await lstat(source);
      if (information.isSymbolicLink()) throw new Error("BUILD_SYMLINK_FORBIDDEN");
      return !name.startsWith(".") && !["certs", "node_modules"].includes(name) && !/\.(pem|crt|key|log)$/i.test(name);
    }
  });
}
process.stdout.write("Node 24 backend and public assets packaged in dist; environment files and certificates excluded.\n");
