/** Post-login destination: only same-site paths are accepted (no `//host`, `/\\host` or absolute URLs). */
export function safeNextPath(next: unknown): string {
  const v = typeof next === 'string' ? next : '';
  return /^\/(?![/\\])\S*$/.test(v) ? v : '/dashboard';
}
