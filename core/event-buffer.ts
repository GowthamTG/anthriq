export const MAX_CLIENT_BUFFER_BYTES = 64 * 1024;

export function eventFitsClientBuffer(currentBytes: number, eventBytes: number) {
  return (
    Number.isSafeInteger(currentBytes) &&
    Number.isSafeInteger(eventBytes) &&
    currentBytes >= 0 &&
    eventBytes >= 0 &&
    eventBytes <= MAX_CLIENT_BUFFER_BYTES &&
    currentBytes <= MAX_CLIENT_BUFFER_BYTES - eventBytes
  );
}
