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
  const component = readFileSync(
    new URL("../components/ConfigBuilder.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../styles/config-builder.css", import.meta.url), "utf8");

  expect(component).toContain("builder-device-fallback");
  expect(component).toContain("builder-shell-interactive");
  expect(css).toContain(".builder-device-fallback");
  expect(css).toContain(".builder-shell-interactive");
  expect(css).toContain(`@media (max-width: ${CONFIG_BUILDER_MIN_WIDTH - 1}px)`);
});
