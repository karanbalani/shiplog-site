import { expect, test } from "bun:test";
import { configBuilderNoAutofillProps } from "./config-builder-autofill";

test("marks config builder inputs as non-autofill fields", () => {
  expect(configBuilderNoAutofillProps).toEqual({
    autoCapitalize: "none",
    autoComplete: "off",
    autoCorrect: "off",
    "data-1p-ignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
    "data-lpignore": "true",
    spellCheck: false,
  });
});
