import { useId } from 'react'
import type { Problem } from '../api-types'
import './topic-work.css'
import './TopicGraph.css'

export type GraphData = NonNullable<Problem['graph']>

/** The table contains the same supplied observations as the graph, never a derived answer. */
export function TopicGraph({ graph }: { graph: GraphData }) {
  const id = useId()
  const { points, xMin, xMax, yMin, yMax, xLabel, yLabel } = graph
  if (!points.length || xMax <= xMin || yMax <= yMin) return null
  const x = (value: number) => 64 + (value - xMin) / (xMax - xMin) * 416
  const y = (value: number) => 246 - (value - yMin) / (yMax - yMin) * 202
  // Label supplied observations at their actual proportional positions: artificial
  // quarter ticks obscure simple pairs such as 2 minutes / 120 metres.
  const ticks = (min: number, max: number, observations: number[]) => {
    const values = [...new Set([min, ...observations.filter(value => value >= min && value <= max), max])].sort((a, b) => a - b)
    if (values.length <= 8) return values
    return values.filter((_, index) => index === 0 || index === values.length - 1 || index % Math.ceil((values.length - 1) / 6) === 0)
  }
  const number = (value: number) => Number(value.toFixed(2)).toLocaleString('ru-RU')
  return <figure className="topic-graph">
    <p id={`${id}-scroll-hint`} className="topic-graph-scroll-hint">График можно прокрутить вбок. Те же значения есть в таблице ниже.</p>
    <div className="topic-graph-scroll" role="region" aria-label="График с горизонтальной прокруткой" aria-describedby={`${id}-scroll-hint`} tabIndex={0}>
    <svg viewBox="0 0 540 304" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{yLabel} в зависимости от {xLabel.toLocaleLowerCase('ru-RU')}</title>
      <desc id={`${id}-description`}>Точки соединены отрезками. Те же значения доступны в таблице под графиком.</desc>
      {ticks(yMin, yMax, points.map(point => point.y)).map(value => <g key={value}><line className="topic-graph-grid" x1={64} x2={480} y1={y(value)} y2={y(value)}/><text x={54} y={y(value) + 4} textAnchor="end">{number(value)}</text></g>)}
      {ticks(xMin, xMax, points.map(point => point.x)).map(value => <g key={value}><line className="topic-graph-grid" x1={x(value)} x2={x(value)} y1={44} y2={246}/><text x={x(value)} y={266} textAnchor="middle">{number(value)}</text></g>)}
      <path className="topic-graph-axis" d="M64 36 V246 H490"/>
      <text x={64} y={23}>{yLabel}</text><text x={480} y={294} textAnchor="end">{xLabel}</text>
      <polyline className="topic-graph-line" points={points.map(point => `${x(point.x)},${y(point.y)}`).join(' ')}/>
      {points.map((point, index) => <circle key={index} className="topic-graph-point" cx={x(point.x)} cy={y(point.y)} r={4}/>)}
    </svg>
    </div>
    <details><summary>Те же данные в таблице</summary><table><caption>Значения, показанные на графике</caption><thead><tr><th scope="col">{xLabel}</th><th scope="col">{yLabel}</th></tr></thead><tbody>{points.map((point, index) => <tr key={index}><td>{number(point.x)}</td><td>{number(point.y)}</td></tr>)}</tbody></table></details>
  </figure>
}
