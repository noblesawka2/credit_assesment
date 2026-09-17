import { mkdir, cp } from "node:fs/promises";
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await cp(new URL("../public/", import.meta.url), new URL("../dist/public/", import.meta.url), { recursive: true });
process.stdout.write("Static shell copied; server runs TypeScript with Node 24.\n");
