import type { ServiceConnection } from './use-service-events';

export type WorkspaceSection = 'acquire' | 'recordings' | 'verify';

const destinations: { id: WorkspaceSection; label: string; href: string }[] = [
  { id: 'acquire', label: 'Acquire', href: '/' },
  { id: 'recordings', label: 'Recordings', href: '/recordings' },
  { id: 'verify', label: 'Verify', href: '/verify' },
];

const connectionLabels: Record<ServiceConnection, string> = {
  connecting: 'Connecting',
  live: 'Local connection',
  reconnecting: 'Reconnecting',
  offline: 'Disconnected',
};

const hostedLiveLabel = 'Live · hosted demo';

export function WorkbenchHeader({
  current,
  connection,
  sessionId,
  runtimeMode,
}: {
  current: WorkspaceSection;
  connection?: ServiceConnection;
  sessionId?: string | null;
  runtimeMode?: 'local' | 'public-demo';
}) {
  const liveLabel = runtimeMode === 'public-demo' ? hostedLiveLabel : connectionLabels.live;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="workspace-header topbar border-b border-line">
        <a href="/" className="workspace-brand brand" aria-label="SCOPE home">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SCOPE</span>
          <span className="brand-caption">SIGNAL INSTRUMENTS</span>
        </a>
        <nav aria-label="Workspace" className="workspace-nav">
          {destinations.map((destination) => (
            <a
              key={destination.id}
              href={destination.href}
              aria-current={current === destination.id ? 'page' : undefined}
            >
              {destination.label}
            </a>
          ))}
        </nav>
        {connection && (
          <div
            className="connection workspace-connection"
            data-browser-session={sessionId || undefined}
            role="status"
            aria-live="polite"
          >
            <span className={connection === 'live' ? 'connection-dot online' : 'connection-dot'} />
            <span>{connection === 'live' ? liveLabel : connectionLabels[connection]}</span>
          </div>
        )}
      </header>
    </>
  );
}
