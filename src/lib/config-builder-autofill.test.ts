import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { configBuilderNoAutofillProps } from "./config-builder-autofill";

test("marks config builder inputs as non-autofill fields", () => {
  expect(configBuilderNoAutofillProps).toEqual({
    autoCapitalize: "none",
    autoComplete: "new-password",
    autoCorrect: "off",
    "data-1password-ignore": "true",
    "data-1p-ignore": "true",
    "data-bwignore": "true",
    "data-dashlane-ignore": "true",
    "data-form-type": "other",
    "data-keeper-ignore": "true",
    "data-lpignore": "true",
    "data-protonpass-ignore": "true",
    spellCheck: false,
  });
});

test("rendor studio uses the shared no-autofill input contract", () => {
  const rendorStudio = readFileSync(
    new URL("../components/RendorStudio.tsx", import.meta.url),
    "utf8",
  );

  expect(rendorStudio).toContain("configBuilderNoAutofillProps");
  expect(rendorStudio).not.toContain("function textInputProps");
  expect(rendorStudio).not.toContain('type="password"');
});
