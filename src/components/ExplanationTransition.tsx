import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { GlassSurface } from './glass/GlassSurface'
import './explanation-transition.css'

type Props = { children: ReactNode; changing: boolean; contentKey: string }

/** Only the explanation changes material; its DOM and the surrounding workspace stay put. */
export function ExplanationTransition({ children, changing, contentKey }: Props) {
  const measureRef = useRef<HTMLDivElement>(null)
  const previousKey = useRef(contentKey)
  const [height, setHeight] = useState<number | null>(null)
  const [morph, setMorph] = useState<0 | 1 | 2>(0)

  useLayoutEffect(() => {
    if (previousKey.current === contentKey) return
    previousKey.current = contentKey
    // Alternating names restart a finite CSS effect, without replacing children.
    setMorph(previous => previous === 1 ? 2 : 1)
  }, [contentKey])

  useLayoutEffect(() => {
    const content = measureRef.current
    if (!content) return
    let disposed = false
    const measure = () => {
      if (disposed) return
      const measured = content.getBoundingClientRect().height
      // Keep subpixel measurement stable without clipping rounded glyph bounds.
      const next = Math.ceil(measured * 100) / 100
      setHeight(previous => previous === next ? previous : next)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(content)
    if (!observer) window.addEventListener('resize', measure)
    measure()
    return () => {
      disposed = true
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', measure)
    }
  }, [contentKey])

  return <div className={`explanation-transition${morph ? ` explanation-transition--morph-${morph}` : ''}`} style={height === null ? undefined : { height }}>
    <div className="explanation-transition__measure" ref={measureRef}>
      <div className="explanation-transition__scene">
        <div className="explanation-transition__content">{children}</div>
        <div className="explanation-transition__veil" aria-hidden="true">
          <GlassSurface material="lens" className="explanation-transition__glass"/>
        </div>
      </div>
      <p className="explanation-transition__status" role="status" aria-live="polite" aria-atomic="true">{changing ? 'Готовим другое объяснение…' : ''}</p>
    </div>
  </div>
}
