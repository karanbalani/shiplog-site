import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./RendorStudio.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/rendor-studio.css", import.meta.url), "utf8");

test("keeps guided Rendor Studio centered on markdown blocks", () => {
  expect(source).toContain("Markdown blocks");
  expect(source).toContain("BlockQueryEditor");
  expect(source).toContain("BlockPreview");
  expect(source).toContain("blockPreviewState");
  expect(source).toContain("block-query-panel");
  expect(source).not.toContain("function QuerySelect");
  expect(source).not.toContain("Preview display name");
});

test("keeps schema and navigation affordances out of the main tabs", () => {
  expect(source).toContain("schemaDocsUrl");
  expect(source).toContain("https://github.com/karanbalani/shiplog/blob/main/docs/SCHEMA.md");
  expect(source).toContain("Schema docs");
  expect(source).toContain("navigation-guard-modal");
  expect(source).not.toContain("schema-floating-button");
  expect(source).not.toContain("SchemaDrawer");
  expect(source).not.toContain("schema-toggle");
});

test("keeps complete markdown preview behind a focused floating action", () => {
  expect(source).toContain("fullPreviewOpen");
  expect(source).toContain("full-preview-floating-button");
  expect(source).toContain("Full preview");
  expect(source).toContain("Rendered markdown");
  expect(source).toContain("<MarkdownPreview markdown={preview.markdown} />");
  expect(styles).toContain(".full-preview-floating-button");
  expect(styles).toContain(".full-preview-modal");
  expect(styles).toContain(".full-preview-content .markdown-preview");
  expect(styles).not.toContain(".schema-floating-button");
});

test("keeps author header spacing intentional", () => {
  expect(source).toContain("studio-author-heading");
  expect(source).toContain("studio-title-row");
  expect(source).toContain("studio-connection-beacon");
  expect(source).toContain("studio-connection-beacon-dot");
  expect(source).toContain("<code>.shiplog/render.json</code>");
  expect(source).not.toContain("Create `.shiplog/render.json`");
  expect(source).toContain("Reset");
  expect(source).not.toContain("Reset output");
  expect(styles).toContain(".studio-author-heading");
  expect(styles).toContain(".studio-title-row");
  expect(styles).toContain(".studio-title-copy code");
  expect(styles).toContain("white-space: nowrap");
  expect(styles).toContain(".studio-connection-beacon.is-connected .studio-connection-beacon-dot");
  expect(styles).toContain("@keyframes studio-connection-pulse");
  expect(styles).toContain("margin-bottom: 22px");
});

test("keeps Rendor Studio toolbar focused on render.json actions", () => {
  expect(source).toContain("BookOpen");
  expect(source).toContain("Schema docs");
  expect(source).toContain("Copy JSON");
  expect(source).toContain("Copied");
  expect(source).toContain("copiedAction");
  expect(source).toContain("showCopiedAction");
  expect(source).toContain("is-copied");
  expect(styles).toContain(".studio-actions .tool-button.is-copied");
  expect(source).toContain("Download");
  expect(source).not.toContain("Copy Base64");
  expect(source).not.toContain("encodeRenderStudioOutput");
  expect(styles).not.toContain(".schema-floating-button");
  expect(styles).not.toContain(".schema-drawer");
});

test("keeps markdown blocks scannable with local previews", () => {
  expect(styles).toContain(".studio-section-heading h3");
  expect(styles).toContain("font-size: 1.18rem");
  expect(source).toContain("studio-block-pair");
  expect(source).toContain('closest<HTMLElement>(".studio-block-pair")');
  expect(source).toContain("setDragImage");
  expect(source).toContain("<BlockPreview preview={blockPreviewState(block, preview.context)} />");
  expect(source).not.toContain('className="studio-panel studio-preview"');
  expect(styles).toContain(".studio-block-pair");
  expect(styles).toContain(".block-preview-panel");
  expect(styles).not.toContain(".block-card-grid");
});

test("supports repeat blocks and block visibility in guided mode", () => {
  expect(source).toContain('"repeat"');
  expect(source).toContain('block.type === "repeat"');
  expect(source).toContain("BlockVisibilityEditor");
  expect(source).toContain("Conditional visibility");
  expect(source).toContain("when query has rows");
  expect(source).toContain("when query is empty");
  expect(source).toContain("block.visibleWhen?.query === queryName");
  expect(source).toContain("isQueryBackedBlock");
  expect(source).toContain('placeholder="Markdown line break by default"');
  expect(styles).toContain(".studio-field.inline-field");
});

test("keeps Rendor Studio as an internal-scroll tool surface", () => {
  expect(styles).toContain(".studio-root");
  expect(styles).toContain("height: 100svh");
  expect(styles).toContain("overflow: hidden");
  expect(styles).toContain(".studio-field.studio-json-field textarea");
  expect(styles).toContain("resize: none");
});

test("keeps Rendor Studio outer panels visually unframed like Config Builder", () => {
  const panelRule = styles.match(/\.studio-panel \{([\s\S]*?)\n\}/);

  expect(panelRule?.[1]).toContain("border-radius: 0");
  expect(panelRule?.[1]).toContain("background: transparent");
  expect(panelRule?.[1]).toContain("box-shadow: none");
});

test("prevents same-page Rendor Studio header clicks from reloading an active session", () => {
  const sameUrlGuard = source.match(
    /if \(nextUrl\.href === currentUrl\.href\) \{([\s\S]*?)\n    \}/,
  );

  expect(sameUrlGuard?.[1]).toContain("event.preventDefault()");
});

test("masks the Neon connection string without using a password input", () => {
  expect(source).toContain("connection-string-input");
  expect(source).not.toContain('type="password"');
  expect(styles).toContain(".connection-string-input");
  expect(styles).toContain("-webkit-text-security: disc");
});

test("keeps connection modal navigation in the bottom action row", () => {
  expect(source).toContain("studio-connection-actions");
  expect(source).toContain("studio-modal-primary-actions");
  expect(source).toContain("Go back");
  expect(styles).toContain(".studio-connection-actions");
  expect(styles).toContain("justify-content: space-between");
  expect(styles).toContain(".studio-modal-primary-actions");
  expect(source).not.toContain("studio-modal-nav-row");
  expect(source).not.toContain("studio-modal-home-link");
});

test("keeps Rendor Studio modals aligned with the standard heading hierarchy", () => {
  expect(source).toContain("studio-modal-eyebrow");
  expect(source).toContain("Database provider");
  expect(source).toContain("Connection setup");
  expect(source).toContain("Navigation");
  expect(styles).toContain(".studio-modal-eyebrow");
  expect(styles).toContain(".studio-modal-title-copy");
  expect(styles).toContain("gap: 8px");
  expect(styles).toContain(".studio-modal-title-copy > p:not(.studio-modal-eyebrow)");
  expect(styles).toContain("line-height: 1.5");
});

test("keeps onboarding plain until the user starts building", () => {
  expect(source).toContain("studio-onboarding");
  expect(source).toContain("{hasStarted && (");
  expect(source).not.toContain("aria-hidden={!hasStarted}");
  expect(styles).toContain(".studio-onboarding");
  expect(styles).not.toContain("backdrop-filter");
});

test("keeps connection test copy stable and validates the field", () => {
  expect(source).toContain("connectionFieldError");
  expect(source).toContain("handleConnectionKeyDown");
  expect(source).toContain("connectionInputClassName");
  expect(source).toContain("connectionIsLocked");
  expect(source).toContain("readOnly={connectionIsLocked}");
  expect(source).toContain('if (event.key !== "Enter") return;');
  expect(source).toContain("event.preventDefault()");
  expect(source).toContain('connectionStatus === "connected" || connectionStatus === "testing"');
  expect(source).toContain("void testConnection()");
  expect(source).toContain("onKeyDown={handleConnectionKeyDown}");
  expect(source).toContain("Test connection");
  expect(source).toContain("Connection ready");
  expect(source).toContain("connectionTestButtonText");
  expect(source).toContain('connectionStatus === "testing" ? "is-testing" : ""');
  expect(source).toContain('connectionStatus === "error" || connectionStatus === "stale"');
  expect(source).not.toContain("connectionTestLabel");
  expect(source).not.toContain("Enter connection string");
  expect(styles).toContain(".connection-string-input.is-error");
  expect(styles).toContain(".connection-string-input.is-locked");
  expect(styles).toContain(".connection-test-button.is-testing svg");
  expect(styles).toContain("@keyframes studio-spin");
  expect(styles).toContain(".connection-test-button.is-verified:disabled");
});

test("keeps markdown preview theme-aware instead of terminal black", () => {
  expect(styles).toContain(".markdown-preview");
  expect(styles).toContain("background: var(--surface-raised)");
  expect(styles).toContain("color: var(--ink)");
  expect(styles).not.toContain("background: #0b0b0b");
  expect(styles).not.toContain("color: #f6f6f6");
});
