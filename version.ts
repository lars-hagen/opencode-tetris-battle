// Naive semver comparison used by the in-plugin update flow.
// Plugin versions follow plain `MAJOR.MINOR.PATCH` (no prerelease tags),
// so a strict numeric compare is sufficient. Non-numeric segments coerce
// to 0 to keep the function total instead of throwing on garbage input.
export const isOlder = (a: string, b: string): boolean => {
  const parse = (s: string) =>
    s.split(".").map((n) => parseInt(n, 10) || 0);
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
};
