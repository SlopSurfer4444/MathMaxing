// MathLive emits both \frac{1}{4} and legal TeX shorthand \frac14.
// Expand only simple literal atoms; preserve unknown commands/placeholders.
export function normalizeSimpleFractions(value: string): string {
  return value.replace(/\\(?:dfrac|tfrac)\b/g, '\\frac')
    .replace(/\\frac\s*(\{[^{}]*\}|\\pi(?![A-Za-z])|[0-9])\s*(\{[^{}]*\}|\\pi(?![A-Za-z])|[0-9])/g,
      (_, numerator: string, denominator: string) => {
        const wrap = (atom: string) => atom.startsWith('{') ? atom : `{${atom}}`
        return `\\frac${wrap(numerator)}${wrap(denominator)}`
      })
}
