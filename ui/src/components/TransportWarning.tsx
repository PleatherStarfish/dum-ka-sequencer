export const TRANSPORT_WARNING_ID = "transport-playback-warning";
export const TRANSPORT_WARNING_LABEL = "Playback blocked";

export interface TransportWarningProps {
  message: string | null;
}

/** Compact, transport-adjacent explanation for a terminal playback rejection. */
export function TransportWarning({ message }: TransportWarningProps) {
  if (message === null) {
    return null;
  }

  const title = `${TRANSPORT_WARNING_LABEL}: ${message}`;
  return (
    <div
      id={TRANSPORT_WARNING_ID}
      className="transport-warning"
      role="status"
      aria-atomic="true"
      title={title}
    >
      <span className="transport-warning-icon" aria-hidden="true">
        !
      </span>
      <span className="transport-warning-copy">
        <strong>{TRANSPORT_WARNING_LABEL}</strong>
        <span>{message}</span>
      </span>
    </div>
  );
}
