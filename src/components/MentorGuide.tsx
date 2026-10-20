import { visitorHeaders } from '../visitor-session'
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Work, PreparationExercise } from '../api-types'
import { MathContent } from './MathContent'
import './mentor-guide.css'

type Guidance = { text: string; revision: number; exerciseId?: string }
export function MentorGuide({ work, saved, connected, busy, exercises, onExercise, onDiscuss, enabled, onEnabled }: {
  work: Work; saved: boolean; connected: boolean; busy: boolean; exercises: PreparationExercise[];
  onExercise(id: string): void; onDiscuss(text: string): void;
  enabled: boolean; onEnabled(value: boolean): void;
}) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; guidance: Guidance } | null>(null)
  const [status, setStatus] = useState<'idle' | 'thinking' | 'error'>('idle')
  const key = `${work.id}:${work.modeEpoch}:${work.revision}`
  const eligible = enabled && saved && connected && !busy
  useEffect(() => {
    setStatus('idle')
    if (!eligible || result?.key === key) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setStatus('thinking')
      try {
        const response = await fetch('/api/guidance', {
          method: 'POST', signal: controller.signal,
          headers: { ...visitorHeaders(), 'Content-Type': 'application/json', 'X-Pole-Client': 'notebook-v1' },
          body: JSON.stringify({ workId: work.id, expectedRevision: work.revision }),
        })
        if (!response.ok) throw new Error('Guidance unavailable')
        const data = await response.json() as { workId: string; guidance: Guidance }
        if (!controller.signal.aborted && data.workId === work.id && data.guidance.revision === work.revision) {
          setResult({ key, guidance: data.guidance }); setStatus('idle')
        }
      } catch {
        if (!controller.signal.aborted) setStatus('error')
      }
    }, 8000)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, eligible, retry, work.id, work.revision, result?.key])
  const current = saved && result?.key === key ? result.guidance : null
  const exercise = exercises.find(item => item.id === current?.exerciseId)
  return <section className="mentor-guide" aria-label="Следующий шаг с наставником">
    <div className="mentor-guide-heading"><span><Sparkles size={15} />Наставник рядом</span><button onClick={() => onEnabled(!enabled)} aria-pressed={enabled}>{enabled ? 'Пока сам' : 'Предлагать помощь'}</button></div>
    {!enabled ? <p>Продолжай в своём темпе. Подсказки на паузе.</p> : !connected ? <p>Подключи наставника в чате, чтобы он помогал по ходу решения.</p> : current ? <>
      <div aria-live="polite"><MathContent text={current.text} /></div>
      <div className="mentor-guide-actions">{exercise && <button className="outline-button" disabled={busy} onClick={() => onExercise(exercise.id)}>Потренировать: {exercise.title}</button>}<button disabled={busy} onClick={() => onDiscuss(current.text)}>Обсудить с наставником</button></div>
    </> : <p role="status">{status === 'thinking' ? 'Смотрю на твой ход мысли…' : status === 'error' ? 'Сейчас не удалось получить подсказку. Можно продолжать решать.' : 'Пиши, как рассуждаешь. После паузы предложу следующий шаг.'}{status === 'error' && <button onClick={() => setRetry(value => value + 1)}>Повторить</button>}</p>}
  </section>
}
