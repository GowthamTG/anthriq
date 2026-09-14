export function channelWindowLabel(channels: readonly number[]) {
  return channels.length > 1 && channels.every((channel, index) => channel === channels[0] + index)
    ? `Ch ${channels[0]}–Ch ${channels.at(-1)}`
    : channels.map((channel) => `Ch ${channel}`).join(', ');
}
