import type { ConfigBuilderDeviceBlockReason } from "../lib/config-builder-device";

type DeviceGateCopy = {
  deviceBody: string;
  deviceTitle: string;
  narrowBody: string;
  narrowTitle: string;
};

type DeviceGateProps = {
  className?: string;
  copy: DeviceGateCopy;
  reason?: ConfigBuilderDeviceBlockReason;
};

export function DeviceGate({ className = "", copy, reason }: DeviceGateProps) {
  const shellClassName = ["builder-shell", "builder-shell-blocked", className]
    .filter(Boolean)
    .join(" ");
  const gateMode = reason ?? "responsive";

  return (
    <section className={shellClassName}>
      <div className={`builder-device-gate is-${gateMode}`}>
        <p className="builder-device-gate__eyebrow">
          <span className="narrow-message">Window too narrow</span>
          <span className="device-message">Desktop required</span>
        </p>
        <h2>
          <span className="narrow-message">{copy.narrowTitle}</span>
          <span className="device-message">{copy.deviceTitle}</span>
        </h2>
        <p>
          <span className="narrow-message">{copy.narrowBody}</span>
          <span className="device-message">{copy.deviceBody}</span>
        </p>
        <div className="action-row">
          <a className="button button-primary" href="https://github.com/karanbalani/shiplog">
            Open GitHub
          </a>
          <a className="button button-secondary" href="/">
            Back home
          </a>
        </div>
      </div>
    </section>
  );
}
