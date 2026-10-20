import { useId, useState } from 'react'

const coordinate = (value: number) => (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3).replace('.', ',')

export function KnowledgeDiagram({ kind }: { kind: 'triangle' | 'circle' }) {
  const [degrees, setDegrees] = useState(30)
  const id = useId()
  if (kind === 'triangle') return <figure className="knowledge-diagram">
    <svg viewBox="0 0 390 245" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>Прямоугольный треугольник со сторонами 3, 4 и 5</title>
      <desc id={`${id}-desc`}>Угол α внизу слева. Противолежащий катет справа равен 3, прилежащий внизу равен 4, гипотенуза равна 5. Прямой угол внизу справа.</desc>
      <path d="M55 195 L295 195 L295 15 Z" fill="#eef3e7" stroke="#89977c" strokeWidth="2" />
      <path d="M55 195 L295 195" stroke="#6581a4" strokeWidth="4" />
      <path d="M295 195 L295 15" stroke="#ba8154" strokeWidth="4" />
      <path d="M279 195 L279 179 L295 179" fill="none" stroke="#89977c" strokeWidth="1.5" />
      <path d="M91 195 A36 36 0 0 0 84 173" fill="none" stroke="#6b8157" strokeWidth="1.5" />
      <text x="99" y="183" className="diagram-angle">α</text>
      <text x="164" y="219" fill="#557293">4 · прилежащий</text>
      <text x="310" y="104" fill="#9f683e">3</text>
      <text x="310" y="123" fill="#9f683e" fontSize="10">напротив α</text>
      <text x="145" y="92" transform="rotate(-37 145 92)">5 · гипотенуза</text>
    </svg>
    <figcaption>Для угла α: sin α = 3/5, cos α = 4/5. Цветные стороны — катеты.</figcaption>
  </figure>

  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const px = 180 + 103 * cosine
  const py = 132 - 103 * sine
  const arcX = 180 + 27 * cosine
  const arcY = 132 - 27 * sine
  return <figure className="knowledge-diagram knowledge-circle">
    <svg viewBox="0 0 360 270" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>Синус и косинус на единичной окружности</title>
      <desc id={`${id}-desc`}>Угол {degrees} градусов. Горизонтальная координата, косинус, равна {coordinate(cosine)}. Вертикальная координата, синус, равна {coordinate(sine)}. Радиус равен 1.</desc>
      <line x1="40" y1="132" x2="322" y2="132" stroke="#c2cbb6" />
      <line x1="180" y1="9" x2="180" y2="258" stroke="#c2cbb6" />
      <path d="M316 128 L323 132 L316 136 M176 16 L180 9 L184 16" stroke="#a8b49b" fill="none" />
      <circle cx="180" cy="132" r="103" fill="none" stroke="#bdc9b0" strokeWidth="1.5" />
      <line x1="180" y1="132" x2={px} y2="132" stroke="#6581a4" strokeWidth="4" />
      <line x1={px} y1="132" x2={px} y2={py} stroke="#ba8154" strokeWidth="4" />
      <line x1="180" y1="132" x2={px} y2={py} stroke="#6b8157" strokeWidth="2" />
      {degrees !== 0 && Math.abs(degrees) !== 360 && <path d={`M207 132 A27 27 0 ${Math.abs(degrees) > 180 ? 1 : 0} ${degrees > 0 ? 0 : 1} ${arcX} ${arcY}`} fill="none" stroke="#6b8157" strokeWidth="1.3" />}
      <circle cx={px} cy={py} r="4.5" fill="#526d40" />
      <text x={px + (cosine > 0.8 ? -16 : 10)} y={py + (sine > 0.8 ? 18 : -10)} fill="#526d40">P</text>
      <text x="327" y="137">x</text><text x="190" y="15">y</text>
      <text x="166" y="150">0</text><text x="287" y="150">1</text><text x="62" y="150">−1</text>
      <text x="163" y="32">1</text><text x="155" y="241">−1</text>
    </svg>
    <label className="circle-angle-control" htmlFor={`${id}-angle`}><span>Поверни точку P</span><output>{degrees}° · {coordinate(radians)} рад</output></label>
    <input id={`${id}-angle`} aria-label="Угол поворота точки на единичной окружности в градусах" type="range" min="-180" max="360" step="1" value={degrees} onChange={event => setDegrees(Number(event.target.value))} />
    <div className="circle-coordinates" aria-live="polite"><span>cos α · x = <strong>{coordinate(cosine)}</strong></span><span>sin α · y = <strong>{coordinate(sine)}</strong></span></div>
    <figcaption>Радиус OP = 1. Положительное направление — против часовой стрелки. Значения округлены до тысячных.</figcaption>
  </figure>
}
