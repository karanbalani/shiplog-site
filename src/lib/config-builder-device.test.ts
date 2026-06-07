import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONFIG_BUILDER_MIN_WIDTH,
  getConfigBuilderDeviceBlockReason,
  shouldBlockConfigBuilderDevice,
} from "./config-builder-device";

test("allows a wide desktop browser", () => {
  expect(
    shouldBlockConfigBuilderDevice({
      pointerCoarse: false,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      userAgentDataMobile: false,
      width: 1440,
    }),
  ).toBe(false);
});

test("blocks narrow screens even with a desktop user agent", () => {
  const narrowDesktop = {
    pointerCoarse: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    userAgentDataMobile: false,
    width: 820,
  };

  expect(shouldBlockConfigBuilderDevice(narrowDesktop)).toBe(true);
  expect(getConfigBuilderDeviceBlockReason(narrowDesktop)).toBe("narrow");
});

test("uses the shared minimum desktop width as the narrow boundary", () => {
  const desktopBrowser = {
    pointerCoarse: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    userAgentDataMobile: false,
  };

  expect(
    getConfigBuilderDeviceBlockReason({
      ...desktopBrowser,
      width: CONFIG_BUILDER_MIN_WIDTH - 1,
    }),
  ).toBe("narrow");
  expect(
    getConfigBuilderDeviceBlockReason({
      ...desktopBrowser,
      width: CONFIG_BUILDER_MIN_WIDTH,
    }),
  ).toBeNull();
});

test("blocks mobile and tablet browsers when they report coarse pointer input", () => {
  const mobileBrowser = {
    pointerCoarse: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    userAgentDataMobile: true,
    width: 820,
  };

  expect(shouldBlockConfigBuilderDevice(mobileBrowser)).toBe(true);
  expect(getConfigBuilderDeviceBlockReason(mobileBrowser)).toBe("device");

  const tabletBrowser = {
    platform: "MacIntel",
    pointerCoarse: true,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148",
    userAgentDataMobile: false,
    width: 1180,
  };

  expect(shouldBlockConfigBuilderDevice(tabletBrowser)).toBe(true);
  expect(getConfigBuilderDeviceBlockReason(tabletBrowser)).toBe("device");
});

test("ships a CSS fallback gate before React hydration", () => {
  const configBuilder = readFileSync(
    new URL("../components/ConfigBuilder.tsx", import.meta.url),
    "utf8",
  );
  const rendorStudio = readFileSync(
    new URL("../components/RendorStudio.tsx", import.meta.url),
    "utf8",
  );
  const gate = readFileSync(new URL("../components/DeviceGate.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/device-gate.css", import.meta.url), "utf8");

  expect(configBuilder).toContain("builder-device-fallback");
  expect(configBuilder).toContain("builder-shell-interactive");
  expect(rendorStudio).toContain("builder-device-fallback");
  expect(rendorStudio).toContain("builder-shell-interactive");
  expect(gate).toContain("builder-device-gate");
  expect(gate).toContain("builder-device-gate__eyebrow");
  expect(css).toContain(".builder-device-fallback");
  expect(css).toContain(".builder-shell-interactive");
  expect(css).toContain(".builder-device-gate__eyebrow");
  expect(css).toContain(`@media (max-width: ${CONFIG_BUILDER_MIN_WIDTH - 1}px)`);
});

test("hydrates device gates from the same server-compatible shell", () => {
  const configBuilder = readFileSync(
    new URL("../components/ConfigBuilder.tsx", import.meta.url),
    "utf8",
  );
  const rendorStudio = readFileSync(
    new URL("../components/RendorStudio.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../styles/device-gate.css", import.meta.url), "utf8");

  expect(configBuilder).toMatch(/useState<ConfigBuilderDeviceBlockReason \| null>\(\s*null,?\s*\)/);
  expect(rendorStudio).toMatch(/useState<ConfigBuilderDeviceBlockReason \| null>\(\s*null,?\s*\)/);
  expect(configBuilder).not.toMatch(
    /useState<ConfigBuilderDeviceBlockReason \| null>\(\(\) =>[\s\S]*?readConfigBuilderDevice\(\)/,
  );
  expect(rendorStudio).not.toMatch(
    /useState<ConfigBuilderDeviceBlockReason \| null>\(\(\) =>[\s\S]*?readConfigBuilderDevice\(\)/,
  );
  expect(css).toContain(".builder-shell.builder-device-fallback.is-runtime-active");
});
