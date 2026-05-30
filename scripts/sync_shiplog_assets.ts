import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const repoPath = process.env.SHIPLOG_REPO_PATH
  ? resolve(process.env.SHIPLOG_REPO_PATH)
  : resolve("../shiplog");
const shiplogRef = process.env.SHIPLOG_REF ?? "main";
const remoteBase = `https://raw.githubusercontent.com/karanbalani/shiplog/${shiplogRef}`;

const files = [
  {
    from: "schemas/shiplog.config.schema.json",
    to: "src/generated/shiplog/shiplog.config.schema.json",
  },
  {
    from: "shiplog.config.example.json",
    to: "src/generated/shiplog/shiplog.config.example.json",
  },
];

async function readCanonicalFile(path: string): Promise<string> {
  const source = resolve(repoPath, path);
  if (existsSync(source)) return readFile(source, "utf8");

  const response = await fetch(`${remoteBase}/${path}`);
  if (!response.ok) {
    throw new Error(`failed to fetch ${path} from shiplog@${shiplogRef}: ${response.status}`);
  }

  return response.text();
}

for (const file of files) {
  const target = resolve(file.to);
  const body = await readCanonicalFile(file.from);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${body.trimEnd()}\n`);
  console.log(`synced ${file.from} -> ${file.to}`);
}
