import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './lesson.css'
import { initializeVisitor } from './visitor-session'

const root = ReactDOM.createRoot(document.getElementById('root')!)
async function start() {
  root.render(<main className="learning-home"><h1>Открываем твою тетрадь…</h1></main>)
  try {
    await initializeVisitor()
    root.render(<React.StrictMode><App /></React.StrictMode>)
  } catch (error) {
    root.render(<main className="learning-home"><h1>Пока не удалось открыть занятие</h1><p role="alert">{error instanceof Error ? error.message : 'Проверь соединение и попробуй ещё раз.'}</p><button className="primary-button" onClick={() => void start()}>Попробовать ещё раз</button></main>)
  }
}
void start()
