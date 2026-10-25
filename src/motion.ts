/** Explicit JS scrolling must honour the same policy as CSS transitions. */
export function preferredScrollBehavior(): ScrollBehavior {
  return document.documentElement.dataset.quietEffects === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}
