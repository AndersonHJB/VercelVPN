import { readdir, readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(path.join(tmpdir(), "vercel-vpn-tests-"));

async function compileDirectory(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      tests.push(...await compileDirectory(relative));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      const source = await readFile(path.join(root, relative), "utf8");
      const compiled = ts.transpileModule(source, {
        fileName: relative,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true
        }
      }).outputText.replace(/require\("@\/([^"\n]+)"\)/g, (_, modulePath) =>
        `require(${JSON.stringify(path.join(output, modulePath))})`
      );
      const destination = path.join(output, relative.replace(/\.ts$/, ".js"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, compiled);
      if (directory === "tests" && entry.name.endsWith(".test.ts")) tests.push(destination);
    }
  }
  return tests;
}

try {
  await compileDirectory("lib");
  await compileDirectory("app/api");
  const tests = await compileDirectory("tests");
  if (!tests.length) throw new Error("No test files found.");
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: path.join(root, "node_modules") }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
