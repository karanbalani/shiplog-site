import { expect, test } from "bun:test";
import Ajv, { type Schema } from "ajv";
import renderSchema from "../generated/shiplog/render.config.schema.json";
import { createBlock, createInitialRenderConfig, createQueryName } from "./render-studio-model";

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

test("creates repeat blocks for arbitrary row markdown", () => {
  expect(createBlock("repeat")).toEqual({
    type: "repeat",
    query: "",
    template: "{{ value }}",
  });
});

test("generated render schema accepts repeat blocks and visibility conditions", () => {
  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
  const validate = ajv.compile(renderSchema as Schema);

  const valid = validate({
    version: 1,
    queries: {
      languages: {
        mode: "many",
        sql: "SELECT language FROM language_stats",
      },
    },
    markdown: [
      {
        type: "heading",
        level: 2,
        text: "Top Languages",
        visibleWhen: {
          query: "languages",
          hasRows: true,
        },
      },
      {
        type: "repeat",
        query: "languages",
        template: "{{ language }}",
        separator: " ",
      },
    ],
  });

  expect(validate.errors).toBeNull();
  expect(valid).toBe(true);
});
