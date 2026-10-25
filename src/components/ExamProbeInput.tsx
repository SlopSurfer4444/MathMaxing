import { lazy, useId } from 'react'
import type { ExamFamilyLesson } from '../exam-ui-types'

const MathAnswer = lazy(() => import('./MathAnswer').then(module => ({ default: module.MathAnswer })))
const MathContent = lazy(() => import('./MathContent').then(module => ({ default: module.MathContent })))

export function ExamProbeInput({ probe, value, onChange, disabled }: {
  probe: ExamFamilyLesson['probe']; value: string; onChange(value: string): void; disabled: boolean
}) {
  const groupId = useId()
  if (probe.kind !== 'choice' || !probe.choices?.length) {
    return <MathAnswer label="Твой ответ" value={value} onChange={onChange} mode={probe.kind === 'number' ? 'number' : 'math'} disabled={disabled}/>
  }
  return <fieldset className="exam-probe-choices" disabled={disabled}>
    <legend>Выбери переход</legend>
    {probe.choices.map((choice, index) => {
      const answer = typeof choice === 'string' ? String(index + 1) : choice.value ?? choice.id ?? String(index + 1)
      const label = typeof choice === 'string' ? choice : choice.label ?? answer
      return <label key={answer} className={value === answer ? 'is-selected' : undefined}>
        <input type="radio" name={groupId} value={answer} checked={value === answer} onChange={() => onChange(answer)}/>
        <MathContent text={label}/>
      </label>
    })}
  </fieldset>
}
