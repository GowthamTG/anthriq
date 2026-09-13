'use client';

import { useState } from 'react';
import type { RangePreview, RecordingInspection } from '../core/contracts';

export function RangeInspector({ details }: { details: RecordingInspection }) {
  const [mode, setMode] = useState<'index' | 'time'>('index');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [channels, setChannels] = useState('');
  const [prefix, setPrefix] = useState(false);
  const [result, setResult] = useState<RangePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsPrefix = details.status !== 'completed' || details.expectedFrames === null;
  async function inspect() {
    setBusy(true); setError(''); setResult(null);
    const params = new URLSearchParams();
    if (channels.trim()) params.set('channels', channels.trim());
    if (start.trim()) params.set(mode === 'index' ? 'start' : 'startSeconds', start.trim());
    if (end.trim()) params.set(mode === 'index' ? 'end' : 'endSeconds', end.trim());
    if (prefix) params.set('prefix', 'true');
    try {
      const response = await fetch(`/api/recordings/${encodeURIComponent(details.id)}/range-preview?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Range retrieval failed');
      setResult(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function changed(action: () => void) { action(); setResult(null); setError(''); }
  const download = result ? (() => {
    const params = new URLSearchParams({ format: 'csv', start: String(result.start), end: String(result.end), channels: result.channels.join(',') });
    if (result.prefix) params.set('prefix', 'true');
    return `/api/recordings/${encodeURIComponent(details.id)}/export?${params}`;
  })() : null;
  return <section className="mt-8 border-t border-line pt-6" aria-label="Exact range inspection">
    <p className="micro">EXACT RANGE INSPECTION</p>
    <p className="mt-2 text-xs leading-relaxed text-muted">Intervals are half-open. Values are raw stored observations: gaps remain absent and duplicate indices remain visible.</p>
    <div className="mt-4 flex flex-wrap gap-4 text-xs"><label><input type="radio" checked={mode === 'index'} onChange={() => changed(() => setMode('index'))} /> Original index</label><label><input type="radio" checked={mode === 'time'} onChange={() => changed(() => setMode('time'))} /> Time (seconds)</label></div>
    <div className="mt-4 grid grid-cols-3 gap-3 max-[760px]:grid-cols-1"><label className="text-xs">Start<input aria-label="Range start" className="mt-1 block w-full border border-line bg-[#171917] p-2 text-sm" value={start} onChange={event => changed(() => setStart(event.target.value))} /></label><label className="text-xs">End (exclusive)<input aria-label="Range end" className="mt-1 block w-full border border-line bg-[#171917] p-2 text-sm" value={end} onChange={event => changed(() => setEnd(event.target.value))} placeholder="Available end" /></label><label className="text-xs">Channels<input aria-label="Channels" className="mt-1 block w-full border border-line bg-[#171917] p-2 text-sm" value={channels} onChange={event => changed(() => setChannels(event.target.value))} placeholder="All, e.g. 3,0" /></label></div>
    {needsPrefix && <label className="mt-4 block border border-[#7a6c42] bg-[#25231a] p-3 text-xs text-[#e4d6ad]"><input aria-label="Inspect readable intact prefix" type="checkbox" checked={prefix} onChange={event => changed(() => setPrefix(event.target.checked))} /> I understand this is only the readable intact prefix; final duration/completeness is unknown.</label>}
    <button className="inspect-button mt-4" onClick={inspect} disabled={busy || (needsPrefix && !prefix)}>{busy ? 'Reading range…' : 'Inspect exact range'}</button>
    {error && <p role="alert" className="notice error mt-4">{error}</p>}
    {result && <div className="mt-5 overflow-x-auto" data-testid="range-result"><p className="mb-2 text-xs text-muted">[{result.start}, {result.end}) of available [0, {result.availableEnd}) · channels {result.channels.join(', ')}{result.truncated ? ' · showing first 200 observations' : ''}</p><p className="mb-3 text-xs text-muted">Frame-major data reads all {details.channels} channel values in matching records: approximately {(details.channels / result.channels.length).toFixed(1)}× value-byte amplification, plus frame indices.</p>{download && <a className="inspect-button mb-4 inline-block" href={download}>Download CSV</a>}<table className="w-full text-left text-xs"><thead><tr><th className="p-2">Original index</th>{result.channels.map(channel => <th className="p-2" key={channel}>Channel {channel}</th>)}</tr></thead><tbody>{result.observations.map((frame, ordinal) => <tr key={`${frame.index}-${ordinal}`}><td className="border-t border-line p-2 font-mono">{frame.index}</td>{frame.values.map((value, index) => <td className="border-t border-line p-2 font-mono" key={index}>{value}</td>)}</tr>)}</tbody></table>{!result.observations.length && <p className="p-3 text-sm text-muted">No stored observations fall in this interval.</p>}</div>}
  </section>;
}
