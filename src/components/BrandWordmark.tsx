import './brand-wordmark.css'

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-wordmark${compact ? ' is-compact' : ''}`} role="img" aria-label="$m+a·t÷h%Maxing"><span className="brand-wordmark-formula" aria-hidden="true"><span className="brand-wordmark-dollar">$</span><span>m</span><span className="brand-wordmark-plus">+</span><span>a</span><span className="brand-wordmark-dot">·</span><span>t</span><span className="brand-wordmark-divide">÷</span><span>h</span><span className="brand-wordmark-percent">%</span></span><span className="brand-wordmark-name" aria-hidden="true">Maxing</span></span>
}
