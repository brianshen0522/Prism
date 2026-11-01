// Quote a value as a single POSIX shell word. Captured traffic is attacker-controlled,
// so anything placed in a copy-paste command has to go through this.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
