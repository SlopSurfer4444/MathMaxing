import { useId, useState } from 'react'
import { MathText } from './MathContent'

/** Exact authored example. Positions illustrate the numbers; grading never uses pixels. */
export function RootSelectionDiagram() {
  const [index, setIndex] = useState(0)
  const id = useId()
  const values = [{ k: -2, value: -5 / 3, latex: '-\\frac{5\\pi}{3}' }, { k: -1, value: -2 / 3, latex: '-\\frac{2\\pi}{3}' }, { k: 0, value: 1 / 3, latex: '\\frac{\\pi}{3}' }]
  const x = (coefficient: number) => 35 + (coefficient + 2) / 2.5 * 350
  return <figure style={{ margin: '24px 0' }}>
    <svg viewBox="0 0 420 116" role="img" aria-labelledby={`${id}-title ${id}-description`} style={{ width: '100%', maxWidth: 600 }}>
      <title id={`${id}-title`}>Корни на числовой оси</title>
      <desc id={`${id}-description`}>На отрезке от минус двух пи до пи пополам лежат минус пять пи третьих, минус две пи третьих и пи третьих. Выбран параметр k = {values[index].k}.</desc>
      <line x1="20" y1="49" x2="400" y2="49" stroke="#b8c0b3" strokeWidth="2" />
      <line x1="35" y1="49" x2="385" y2="49" stroke="#536b44" strokeWidth="4" />
      {[-2, 0, 0.5].map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1="40" y2="58" stroke="#536b44" /><text x={x(v)} y="94" textAnchor="middle" fontSize="14" fill="currentColor">{v === -2 ? '−2π' : v === 0 ? '0' : 'π/2'}</text></g>)}
      {values.map((v, i) => <g key={v.k}><circle cx={x(v.value)} cy="49" r={i === index ? 8 : 5} fill={i === index ? '#bc683c' : '#536b44'} /><text x={x(v.value)} y="24" textAnchor="middle" fontSize="14" fill="currentColor">k = {v.k}</text></g>)}
    </svg>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Посмотреть корень для параметра">{values.map((v, i) => <button type="button" className="outline-button" aria-pressed={index === i} key={v.k} onClick={() => setIndex(i)}>k = {v.k}</button>)}</div>
    <figcaption style={{ marginTop: 12 }}>При k = {values[index].k}: <MathText value={`x=${values[index].latex}`} />. Все три числа лежат внутри отрезка.</figcaption>
  </figure>
}
