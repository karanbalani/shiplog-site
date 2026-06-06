import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const repoPath = process.env.SHIPLOG_REPO_PATH
  ? resolve(process.env.SHIPLOG_REPO_PATH)
  : resolve("../shiplog");
const shiplogRef = process.env.SHIPLOG_REF ?? "main";
const remoteBase = `https://raw.githubusercontent.com/karanbalani/shiplog/${shiplogRef}`;

type SyncFile = {
  from: string;
  to: string;
  transform?: (body: string) => string;
};

const files: SyncFile[] = [
  {
    from: "schemas/shiplog.config.schema.json",
    to: "src/generated/shiplog/shiplog.config.schema.json",
  },
  {
    from: "shiplog.config.example.json",
    to: "src/generated/shiplog/shiplog.config.example.json",
  },
  {
    from: "schemas/render.config.schema.json",
    to: "src/generated/shiplog/render.config.schema.json",
  },
  {
    from: ".shiplog/render.json",
    to: "src/generated/shiplog/render.default.json",
  },
  {
    from: "lib/types/config/render.ts",
    to: "src/generated/shiplog/types/config/render.ts",
  },
  {
    from: "lib/target_render.ts",
    to: "src/generated/shiplog/target_render.ts",
    transform: (body: string) =>
      body.replace("from './types/index.ts'", "from './types/config/render.ts'"),
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
  const raw = await readCanonicalFile(file.from);
  const body = file.transform ? file.transform(raw) : raw;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${body.trimEnd()}\n`);
  console.log(`synced ${file.from} -> ${file.to}`);
}
