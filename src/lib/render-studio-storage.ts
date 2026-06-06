import type { TargetRenderConfig } from "../generated/shiplog/types/config/render";

export const RENDER_STUDIO_OUTPUT_STORAGE_KEY = "shiplog-render-studio-output-json";

export function encodeRenderStudioOutput(config: TargetRenderConfig): string {
  const json = JSON.stringify(config);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeRenderStudioOutput(encoded: string): unknown {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function readStoredRenderStudioOutput(
  storage: Pick<Storage, "getItem">,
  validate: (value: unknown) => value is TargetRenderConfig,
): TargetRenderConfig | null {
  const encoded = storage.getItem(RENDER_STUDIO_OUTPUT_STORAGE_KEY);
  if (!encoded) return null;

  try {
    const decoded = decodeRenderStudioOutput(encoded);
    return validate(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function writeStoredRenderStudioOutput(
  storage: Pick<Storage, "setItem">,
  config: TargetRenderConfig,
): void {
  storage.setItem(RENDER_STUDIO_OUTPUT_STORAGE_KEY, encodeRenderStudioOutput(config));
}
