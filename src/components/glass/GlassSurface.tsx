import { useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import { getDisplacementMap } from './displacement'
import './glass-surface.css'

export type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  material?: 'frost' | 'clear' | 'lens'
}

type LensMap = { width: number; height: number; radius: number; url: string }

/** Parse support is insufficient: WebKit/Gecko may accept url() but never render it. */
function supportsBackdropRefraction() {
  const ua = navigator.userAgent
  return /\b(?:Chrome|Chromium|Edg)\//.test(ua) && !/iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS/.test(ua)
}

/** A material behind crisp DOM children. Only the lens material allocates an SVG map. */
export function GlassSurface({ children, className = '', material = 'frost', ...props }: GlassSurfaceProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<LensMap | null>(null)
  const id = `glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const element = elementRef.current
    if (!element || material !== 'lens' || !supportsBackdropRefraction()) {
      setMap(null)
      return
    }
    const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')
    const contrast = matchMedia('(prefers-contrast: more)')
    const forcedColors = matchMedia('(forced-colors: active)')
    let previousShape = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const measure = () => {
      if (stopped) return
      if (reducedTransparency.matches || contrast.matches || forcedColors.matches) {
        previousShape = ''
        setMap(null)
        return
      }
      // offset dimensions ignore hover/entrance transforms, unlike getBoundingClientRect.
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (width < 1 || height < 1) return
      const radiusValue = getComputedStyle(element).borderTopLeftRadius
      const radiusNumber = Number.parseFloat(radiusValue) || 0
      const radius = Math.min(radiusValue.includes('%') ? Math.min(width, height) * radiusNumber / 100 : radiusNumber, width / 2, height / 2)
      const shape = `${width}:${height}:${radius}`
      if (shape === previousShape) return
      previousShape = shape
      try {
        const url = getDisplacementMap(width, height, radius)
        setMap(url ? { width, height, radius, url } : null)
      } catch {
        // A denied/unavailable canvas keeps the independently styled frosted fallback.
        setMap(null)
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(measure, 70)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(element)
    window.addEventListener('resize', schedule)
    reducedTransparency.addEventListener('change', schedule)
    contrast.addEventListener('change', schedule)
    forcedColors.addEventListener('change', schedule)
    measure()
    return () => {
      stopped = true
      clearTimeout(timer)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      reducedTransparency.removeEventListener('change', schedule)
      contrast.removeEventListener('change', schedule)
      forcedColors.removeEventListener('change', schedule)
    }
  }, [material])

  // Change the filter identity with geometry instead of mutating a cached raster.
  const filterId = `${id}-${map?.width ?? 0}-${map?.height ?? 0}-${map?.radius ?? 0}`
  const refractionStyle: CSSProperties | undefined = map && material === 'lens'
    ? { backdropFilter: `url(#${filterId})`, WebkitBackdropFilter: `url(#${filterId})` }
    : undefined

  return <div {...props} ref={elementRef} className={`glass-surface glass-surface--${material} ${className}`} data-glass-refraction={map && material === 'lens' ? 'svg' : 'fallback'}>
    {map && material === 'lens' && <svg className="glass-surface__definitions" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* RGB rim-split pipeline adapted from kucukkanat; MIT notice alongside. */}
        <filter id={filterId} colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" x="-32" y="-32" width={map.width + 64} height={map.height + 64}>
          <feImage href={map.url} x="0" y="0" width={map.width} height={map.height} preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G" result="redDisplaced" />
          <feColorMatrix in="redDisplaced" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="21" xChannelSelector="R" yChannelSelector="G" result="greenDisplaced" />
          <feColorMatrix in="greenDisplaced" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="20" xChannelSelector="R" yChannelSelector="G" result="blueDisplaced" />
          <feColorMatrix in="blueDisplaced" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feBlend in="red" in2="green" mode="screen" result="redGreen" />
          <feBlend in="redGreen" in2="blue" mode="screen" />
        </filter>
      </defs>
    </svg>}
    <span className="glass-surface__material" style={refractionStyle} aria-hidden="true" />
    <span className="glass-surface__edge" aria-hidden="true" />
    {children}
  </div>
}
