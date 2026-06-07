import { expect, test } from "bun:test";
import { createInitialRenderConfig, createQueryName } from "./render-studio-model";

test("starts from the synced default render config", () => {
  const config = createInitialRenderConfig();

  expect(config.version).toBe(1);
  expect(config.markdown.length).toBeGreaterThan(0);
  expect(config.queries?.profile_stats?.mode).toBe("many");
});

test("creates the next query name without colliding", () => {
  expect(createQueryName(["query_1", "query_2"])).toBe("query_3");
  expect(createQueryName(["query_2", "query_3"])).toBe("query_4");
});
