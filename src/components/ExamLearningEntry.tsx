import { ArrowRight } from 'lucide-react'

/** A choice of where to begin, never an assessment of what the learner knows. */
export function ExamLearningEntry({ disabled, onWrite, onWhy, onStart }: {
  disabled: boolean; onWrite(): void; onWhy(): void; onStart(): void
}) {
  return <section className="exam-learning-entry" aria-label="С чего начать">
    <p>Как тебе удобнее начать?</p>
    <button type="button" disabled={disabled} onClick={onWrite}>Запишу свой способ<ArrowRight size={14}/></button>
    <button type="button" disabled={disabled} onClick={onWhy}>Хочу понять, почему это работает<ArrowRight size={14}/></button>
    <button type="button" disabled={disabled} onClick={onStart}>Напомни с начала<ArrowRight size={14}/></button>
  </section>
}
