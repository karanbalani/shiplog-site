import defaultRenderConfig from "../generated/shiplog/render.default.json";
import type {
  RenderQueryMode,
  TargetRenderBlock,
  TargetRenderConfig,
  TargetRenderQueryConfig,
  TargetRenderTableColumn,
} from "../generated/shiplog/types/config/render";

export type StudioMode = "guided" | "json";
export type ConnectionStatus = "idle" | "testing" | "connected" | "error" | "stale";

export type SchemaColumn = {
  schema: string;
  table: string;
  type: "table" | "view";
  name: string;
  dataType: string;
  nullable: boolean;
};

export type SchemaTable = {
  schema: string;
  name: string;
  type: "table" | "view";
  columns: SchemaColumn[];
};

export function createInitialRenderConfig(savedConfig?: TargetRenderConfig | null) {
  return cloneRenderConfig(savedConfig ?? (defaultRenderConfig as TargetRenderConfig));
}

export function cloneRenderConfig(config: TargetRenderConfig): TargetRenderConfig {
  return JSON.parse(JSON.stringify(config)) as TargetRenderConfig;
}

export function formatRenderConfig(config: TargetRenderConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createQueryName(existingNames: string[]): string {
  const names = new Set(existingNames);
  let index = names.size + 1;
  let name = `query_${index}`;
  while (names.has(name)) {
    index += 1;
    name = `query_${index}`;
  }
  return name;
}

export function createQueryConfig(mode: RenderQueryMode = "many"): TargetRenderQueryConfig {
  return {
    mode,
    sql: "SELECT *\nFROM repositories\nLIMIT 10",
  };
}

export function createBlock(type: TargetRenderBlock["type"]): TargetRenderBlock {
  if (type === "heading") return { type, level: 2, text: "Section" };
  if (type === "paragraph")
    return { type, text: "Write something with {{ profile.displayName }}." };
  if (type === "table")
    return {
      type,
      query: "",
      columns: [{ label: "Column", value: "{{ column }}" }],
    };
  if (type === "list") return { type, query: "", value: "{{ value }}" };
  if (type === "rawMarkdown") return { type, content: "<!-- raw markdown -->" };
  return { type: "divider" };
}

export function createTableColumn(): TargetRenderTableColumn {
  return { label: "Column", value: "{{ value }}" };
}

export function normalizeSchemaTables(columns: SchemaColumn[]): SchemaTable[] {
  const tables = new Map<string, SchemaTable>();

  for (const column of columns) {
    const key = `${column.schema}.${column.table}`;
    const table =
      tables.get(key) ??
      ({
        schema: column.schema,
        name: column.table,
        type: column.type,
        columns: [],
      } satisfies SchemaTable);
    table.columns.push(column);
    tables.set(key, table);
  }

  return [...tables.values()].sort((a, b) =>
    `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
  );
}
