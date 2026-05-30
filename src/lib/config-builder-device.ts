export const CONFIG_BUILDER_MIN_WIDTH = 960;

export type ConfigBuilderDevice = {
  platform?: string;
  pointerCoarse: boolean;
  userAgent: string;
  userAgentDataMobile?: boolean;
  width: number;
};

export type ConfigBuilderDeviceBlockReason = "device" | "narrow";

export function getConfigBuilderDeviceBlockReason(
  device: ConfigBuilderDevice,
): ConfigBuilderDeviceBlockReason | null {
  const mobileUserAgent =
    device.userAgentDataMobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.pointerCoarse);

  if (device.pointerCoarse && mobileUserAgent) return "device";
  if (device.width < CONFIG_BUILDER_MIN_WIDTH) return "narrow";

  return null;
}

export function shouldBlockConfigBuilderDevice(device: ConfigBuilderDevice): boolean {
  return getConfigBuilderDeviceBlockReason(device) !== null;
}

export function readConfigBuilderDevice(): ConfigBuilderDevice {
  const navigatorUserAgentData = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };

  return {
    platform: navigator.platform,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    userAgent: navigator.userAgent,
    userAgentDataMobile: navigatorUserAgentData.userAgentData?.mobile,
    width: window.innerWidth,
  };
}
