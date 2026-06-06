import { expect, test } from "bun:test";
import {
  createInitialRenderConfig,
  createQueryName,
  normalizeSchemaTables,
} from "./render-studio-model";

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

test("groups schema columns by table", () => {
  const tables = normalizeSchemaTables([
    {
      schema: "public",
      table: "repositories",
      type: "table",
      name: "full_name",
      dataType: "text",
      nullable: false,
    },
    {
      schema: "public",
      table: "repositories",
      type: "table",
      name: "web_url",
      dataType: "text",
      nullable: true,
    },
  ]);

  expect(tables).toEqual([
    {
      schema: "public",
      name: "repositories",
      type: "table",
      columns: [
        {
          schema: "public",
          table: "repositories",
          type: "table",
          name: "full_name",
          dataType: "text",
          nullable: false,
        },
        {
          schema: "public",
          table: "repositories",
          type: "table",
          name: "web_url",
          dataType: "text",
          nullable: true,
        },
      ],
    },
  ]);
});
