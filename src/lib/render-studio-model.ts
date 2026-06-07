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
  if (type === "repeat") return { type, query: "", template: "{{ value }}" };
  if (type === "rawMarkdown") return { type, content: "<!-- raw markdown -->" };
  return { type: "divider" };
}

export function createTableColumn(): TargetRenderTableColumn {
  return { label: "Column", value: "{{ value }}" };
}
