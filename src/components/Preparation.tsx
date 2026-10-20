import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, LoaderCircle } from 'lucide-react'
import { MathContent, MathText } from './MathContent'
import { materials } from '../materials'
import { RootSelectionDiagram } from './RootSelectionDiagram'
import { MathAnswer } from './MathAnswer'
import type { PreparationExercise, Work } from '../api-types'

export function Preparation({ exercise, preparation, saveStatus, busy, onDraft, onAnswer, onReturn, onMaterial }: { exercise: PreparationExercise; preparation: NonNullable<Work['preparation']>; saveStatus: string; busy: boolean; onDraft(answer: string): void; onAnswer(answer: string): void; onReturn(): void; onMaterial(id: string): void }) {
  const [answer, setAnswer] = useState(preparation.answer ?? '')
  const changeAnswer = (value: string) => { setAnswer(value); onDraft(value) }
  return <section className="preparation-scene" aria-label="Подготовительное упражнение">
    <div className="preparation-context"><span>Короткая подготовка</span><button onClick={onReturn} disabled={busy}><ArrowLeft size={15}/> К моему решению</button></div>
    <h1>{exercise.title}</h1><p className="preparation-purpose">Потренируем один шаг. Твой лист сохранён — вернёмся в то же место.</p>
    <div className="preparation-question"><MathContent text={exercise.prompt}/>{exercise.math && <MathText value={exercise.math}/>}</div>
    <form onSubmit={event => { event.preventDefault(); onAnswer(answer) }}>
      {exercise.kind === 'choice' ? <fieldset className="preparation-choices"><legend>Выбери ответ</legend>{exercise.choices?.map(choice => <label key={choice.id} className={answer === choice.id ? 'is-selected' : ''}><input type="radio" name="exercise-answer" aria-label={choice.label} value={choice.id} checked={answer === choice.id} onChange={() => changeAnswer(choice.id)} disabled={busy}/><span>{choice.math ? <MathText value={choice.math}/> : choice.label}</span></label>)}</fieldset> : <MathAnswer label="Твой ответ" multiple value={answer} onChange={changeAnswer} disabled={busy}/>}
      <button className="primary-button" disabled={busy || !answer.trim()} type="submit">{busy ? <LoaderCircle size={16} className="is-spinning"/> : <Check size={16}/>}Проверить</button>
    </form><p className="preparation-save" role="status">{saveStatus}</p>
    {preparation.result && answer === preparation.answer && <div className={`preparation-feedback is-${preparation.result.status}`} role="status"><strong>{preparation.result.status === 'correct' ? 'Получилось!' : preparation.result.status === 'incorrect' ? 'Попробуем ещё раз' : 'Уточни запись'}</strong><p>{preparation.result.summary}</p>{preparation.result.status === 'correct' && <button className="primary-button" disabled={busy} onClick={onReturn}>Продолжить своё решение <ArrowUpRight size={16}/></button>}</div>}
    <details className="preparation-explanation"><summary>Разобраться, как это работает</summary><MathContent text={exercise.explanation} onOpenMaterial={onMaterial}/>{exercise.id === 'root-selection' && !exercise.selectionSteps?.length && <RootSelectionDiagram/>}{!!exercise.selectionSteps?.length && <div className="selection-table-scroll"><table className="selection-steps"><caption>Отбор для этого задания</caption><thead><tr><th scope="col">Серия</th><th scope="col">Границы параметра</th><th scope="col">Целые k</th><th scope="col">Подстановка и корни</th></tr></thead><tbody>{exercise.selectionSteps.map((step, index) => <tr key={index}><td><MathText value={step.seriesMath}/></td><td><MathText value={step.boundsMath}/></td><td>{step.integers.join('; ') || 'Нет'}</td><td><MathText value={step.substitutionMath}/><MathText value={step.rootsMath}/></td></tr>)}</tbody></table><p>Объедини корни всех серий. Совпадающие значения запиши один раз.</p></div>}{exercise.materialIds.map(id => <button key={id} className="outline-button" onClick={() => onMaterial(id)}>{materials.find(material => material.id === id)?.title ?? 'Объяснение'} <ArrowUpRight size={14}/></button>)}</details>
  </section>
}

export function PreparationChooser({ exercises, busy, onChoose, onBasics, onClose }: { exercises: PreparationExercise[]; busy: boolean; onChoose(id: string): void; onBasics(): void; onClose(): void }) {
  return <section className="preparation-chooser" aria-label="Выбор подготовки"><div className="section-heading"><div><h2>На каком шаге нужна практика?</h2><p>Выбери короткое упражнение. Полную задачу можно продолжить в любой момент.</p></div><button aria-label="Закрыть подготовку" onClick={onClose}>×</button></div><div className="preparation-options">{exercises.map(exercise => <button key={exercise.id} disabled={busy} onClick={() => onChoose(exercise.id)}><span>{exercise.title}</span><ArrowUpRight size={17}/></button>)}</div><button className="basics-link" onClick={onBasics}>Пока не знаю, что такое синус — начать с основ <ArrowUpRight size={15}/></button></section>
}
