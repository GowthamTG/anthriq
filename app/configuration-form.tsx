import type { Settings } from '../core/contracts';
import type { RuntimeInfo } from '../core/contracts';

export type ConfigurationDraft = Record<
  | 'channels'
  | 'sampleRate'
  | 'seed'
  | 'seconds'
  | 'displayName'
  | 'bufferBytes'
  | 'stallAfterSeconds'
  | 'stallForMs',
  string
>;

export function draftFrom(settings: Settings): ConfigurationDraft {
  return {
    channels: String(settings.channels),
    sampleRate: String(settings.sampleRate),
    seed: String(settings.seed),
    seconds: String(settings.seconds),
    displayName: settings.displayName || '',
    bufferBytes: String(settings.bufferBytes),
    stallAfterSeconds: String(settings.stallAfterSeconds ?? 0),
    stallForMs: String(settings.stallForMs ?? 0),
  };
}

const numericFields = [
  { key: 'channels', label: 'Channels', hint: '1–256 channels', step: '1' },
  { key: 'sampleRate', label: 'Sample rate', hint: 'Hz per channel · 1–100,000', step: '1' },
  { key: 'seed', label: 'Seed', hint: '0–2,147,483,647', step: '1' },
  { key: 'seconds', label: 'Duration', hint: 'Seconds · 0 means until stopped', step: 'any' },
] as const;

export function ConfigurationForm({
  draft,
  fields,
  disabled,
  onChange,
  onStart,
  runtime,
}: {
  draft: ConfigurationDraft;
  fields: Record<string, string>;
  disabled: boolean;
  onChange: (key: keyof ConfigurationDraft, value: string) => void;
  onStart: () => void;
  runtime?: RuntimeInfo | null;
}) {
  const publicDemo = runtime?.mode === 'public-demo' ? runtime.limits : null;
  const showDiagnostics = runtime === undefined || runtime?.mode === 'local';
  const aggregate = Number(draft.channels) * Number(draft.sampleRate);
  const inputClass =
    'w-full border border-line bg-background px-3 py-2.5 font-mono text-sm text-[#f0f0eb] focus:border-accent disabled:opacity-60 aria-invalid:border-[#ff9c89]';
  return (
    <form
      id="acquisition-setup"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onStart();
      }}
      className="mt-5 mb-6"
    >
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-x-4 gap-y-4">
        <div className="col-span-2">
          <label htmlFor="displayName" className="mb-2 block text-xs text-muted">
            Recording name
          </label>
          <input
            id="displayName"
            value={draft.displayName}
            onChange={(event) => onChange('displayName', event.target.value)}
            placeholder="Untitled recording"
            maxLength={120}
            aria-invalid={Boolean(fields.displayName)}
            aria-describedby={fields.displayName ? 'displayName-error' : undefined}
            className={inputClass}
          />
          {fields.displayName && (
            <p id="displayName-error" className="mt-2 text-xs text-[#ff9c89]">
              {fields.displayName}
            </p>
          )}
        </div>
        {numericFields.map(({ key, label, hint, step }) => (
          <div key={key}>
            <label htmlFor={key} className="mb-2 block text-xs text-muted">
              {label}
            </label>
            <input
              id={key}
              type="number"
              step={step}
              value={draft[key]}
              onChange={(event) => onChange(key, event.target.value)}
              aria-invalid={Boolean(fields[key])}
              aria-describedby={`${key}-hint${fields[key] ? ` ${key}-error` : ''}`}
              className={inputClass}
              min={key === 'seconds' && publicDemo ? publicDemo.minimumDurationSeconds : undefined}
              max={
                publicDemo
                  ? key === 'channels'
                    ? publicDemo.maximumChannels
                    : key === 'sampleRate'
                      ? publicDemo.maximumSampleRate
                      : key === 'seconds'
                        ? publicDemo.maximumDurationSeconds
                        : undefined
                  : undefined
              }
            />
            <p id={`${key}-hint`} className="mt-2 text-[10px] leading-relaxed text-muted">
              {publicDemo && key === 'channels'
                ? `1–${publicDemo.maximumChannels} channels · hosted limit`
                : publicDemo && key === 'sampleRate'
                  ? `Hz per channel · 1–${publicDemo.maximumSampleRate.toLocaleString('en-US')} hosted limit`
                  : publicDemo && key === 'seconds'
                    ? `${publicDemo.minimumDurationSeconds}–${publicDemo.maximumDurationSeconds} seconds · hosted limit`
                    : hint}
            </p>
            {fields[key] && (
              <p id={`${key}-error`} className="mt-2 text-xs leading-relaxed text-[#ff9c89]">
                {fields[key]}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      {showDiagnostics && (
        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer text-xs text-muted">Overload diagnostics</summary>
          <p className="my-3 text-xs leading-relaxed text-muted">
            Off by default. A temporary stall pauses disk writes once, then resumes automatically.
            The source keeps running; a small buffer makes loss visible.
          </p>
          <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
            {(
              [
                ['bufferBytes', 'Buffer budget', 'Bytes · 4,096–67,108,864'],
                ['stallAfterSeconds', 'Stall after', 'Seconds after source start'],
                ['stallForMs', 'Temporary stall', 'Milliseconds · 0 disables · max 5,000'],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className={key === 'bufferBytes' ? 'col-span-2' : ''}>
                <label htmlFor={key} className="mb-2 block text-xs text-muted">
                  {label}
                </label>
                <input
                  id={key}
                  type="number"
                  step={key === 'stallAfterSeconds' ? 'any' : '1'}
                  value={draft[key]}
                  onChange={(event) => onChange(key, event.target.value)}
                  aria-invalid={Boolean(fields[key])}
                  aria-describedby={`${key}-hint${fields[key] ? ` ${key}-error` : ''}`}
                  className={inputClass}
                />
                <p id={`${key}-hint`} className="mt-2 text-[10px] leading-relaxed text-muted">
                  {hint}
                </p>
                {fields[key] && (
                  <p id={`${key}-error`} className="mt-2 text-xs text-[#ff9c89]">
                    {fields[key]}
                  </p>
                )}
              </div>
            ))}
          </fieldset>
        </details>
      )}
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
        <span>Aggregate sample rate</span>
        <span>
          <output data-testid="aggregate-rate" className="font-mono text-sm text-[#f0f0eb]">
            {Number.isSafeInteger(aggregate) && aggregate > 0
              ? aggregate.toLocaleString('en-US')
              : '—'}
          </output>{' '}
          values/s
        </span>
      </div>
    </form>
  );
}
