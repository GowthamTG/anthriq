import type { VerificationStatus } from '../core/contracts';

const labels: Record<VerificationStatus, string> = {
  unverified: 'Integrity not verified',
  verified: 'Integrity verified',
  'integrity-failed': 'Integrity failed',
  stale: 'Verification stale',
};

export function verificationStatusLabel(status: VerificationStatus) {
  return labels[status];
}

export function VerificationStatusText({ status }: { status: VerificationStatus }) {
  return (
    <span
      data-testid="recording-verification-status"
      className={
        status === 'verified'
          ? 'text-[#c1cfb2]'
          : status === 'integrity-failed' || status === 'stale'
            ? 'text-[#ffba89]'
            : 'text-muted'
      }
    >
      {labels[status]}
    </span>
  );
}
