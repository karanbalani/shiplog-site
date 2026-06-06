import { expect, test } from "bun:test";
import type { TargetRenderConfig } from "../generated/shiplog/types/config/render";
import {
  RENDER_STUDIO_OUTPUT_STORAGE_KEY,
  decodeRenderStudioOutput,
  encodeRenderStudioOutput,
  readStoredRenderStudioOutput,
  writeStoredRenderStudioOutput,
} from "./render-studio-storage";

const config: TargetRenderConfig = {
  version: 1,
  markdown: [{ type: "paragraph", text: "Olá {{ profile.displayName }}" }],
};

test("encodes render output as utf-8 safe base64", () => {
  const encoded = encodeRenderStudioOutput(config);

  expect(decodeRenderStudioOutput(encoded)).toEqual(config);
});

test("reads only valid stored render output", () => {
  const storage = new Map([[RENDER_STUDIO_OUTPUT_STORAGE_KEY, encodeRenderStudioOutput(config)]]);

  expect(
    readStoredRenderStudioOutput(
      {
        getItem: (key) => storage.get(key) ?? null,
      },
      (value): value is TargetRenderConfig =>
        Boolean(value && typeof value === "object" && (value as TargetRenderConfig).version === 1),
    ),
  ).toEqual(config);
});

test("ignores corrupt stored render output", () => {
  const storage = new Map([[RENDER_STUDIO_OUTPUT_STORAGE_KEY, "not base64 json"]]);

  expect(
    readStoredRenderStudioOutput(
      {
        getItem: (key) => storage.get(key) ?? null,
      },
      (): boolean => true,
    ),
  ).toBeNull();
});

test("writes stored render output with the expected key", () => {
  const writes = new Map<string, string>();
  writeStoredRenderStudioOutput(
    {
      setItem: (key, value) => writes.set(key, value),
    },
    config,
  );

  expect(decodeRenderStudioOutput(writes.get(RENDER_STUDIO_OUTPUT_STORAGE_KEY) ?? "")).toEqual(
    config,
  );
});
