import React from 'react'
import ReactDOM from 'react-dom/client'
// Both lazy routes render static MathLive notation. Load its layout eagerly.
import 'mathlive/static.css'
import 'mathlive/fonts.css'
import './styles.css'
import './lesson.css'
import './wave-layout.css'
import './workspace-design.css'
import './product-palette.css'
import { initializeVisitor } from './visitor-session'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const App = React.lazy(() => import('./App'))
const ExamTrainer = React.lazy(() => import('./components/ExamTrainer').then(module => ({ default: module.ExamTrainer })))
function TrainerRouter() {
  const [exam, setExam] = React.useState(() => (!window.location.hash || window.location.hash.startsWith('#exam')))
  React.useEffect(() => {
    const update = () => setExam((!window.location.hash || window.location.hash.startsWith('#exam')))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return <React.Suspense fallback={<main className="learning-home" aria-busy="true"><p>Открываем занятие…</p></main>}>
    {exam ? <ExamTrainer onExit={() => { window.location.hash = 'home' }} /> : <App />}
  </React.Suspense>
}
async function start() {
  root.render(<main className="learning-home"><h1>Открываем твою тетрадь…</h1></main>)
  try {
    await initializeVisitor()
    root.render(<React.StrictMode><TrainerRouter /></React.StrictMode>)
  } catch (error) {
    root.render(<main className="learning-home"><h1>Пока не удалось открыть занятие</h1><p role="alert">{error instanceof Error ? error.message : 'Проверь соединение и попробуй ещё раз.'}</p><button className="primary-button" onClick={() => void start()}>Попробовать ещё раз</button></main>)
  }
}
void start()
