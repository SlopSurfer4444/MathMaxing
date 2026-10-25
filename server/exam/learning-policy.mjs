// Explainable scheduling from revisable observations, not a mastery percentage.
// The caller removes revoked evaluations before passing observations here.
export function summarizeLearnerEvidence(observations = [], now = Date.now()) {
  const grouped = new Map()
  for (const event of [...observations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    if (!grouped.has(event.familyId)) grouped.set(event.familyId, [])
    const values = grouped.get(event.familyId)
    if (values.length < 12 && !values.some(value => value.id === event.id)) values.push(event)
  }
  return [...grouped.entries()].map(([familyId, values]) => {
    const latest = values[0], lastByWork = new Map()
    for (const value of values) if (!lastByWork.has(value.workId)) lastByWork.set(value.workId, value)
    const lastIndependent = values.find(value => value.status === 'correct' && value.independent && !value.skipped)
    const difficulties = [...lastByWork.values()].filter(value => value.status === 'incorrect' && !value.skipped)
    const interpretation = latest.status === 'correct'
      ? latest.independent ? 'Последний ответ получился без подсказок. Проверим перенос на другую задачу.' : 'Ответ получился с помощью. Следующий вариант стоит попробовать самому.'
      : latest.status === 'incorrect' ? 'Ответ пока не совпал. Причину можно уточнить по своей записи.' : 'Часть решения ещё не проверена; к обсуждению можно вернуться.'
    return { familyId, lastObservedAt: latest.createdAt, status: latest.status, independent: Boolean(latest.independent), observationId: latest.id, interpretation,
      evidenceWindowLimit: 12, distinctWorkCount: lastByWork.size,
      independentCorrectCount: values.filter(value => value.status === 'correct' && value.independent && !value.skipped).length,
      assistedCorrectCount: values.filter(value => value.status === 'correct' && !value.independent && !value.skipped).length,
      incorrectCount: values.filter(value => value.status === 'incorrect' && !value.skipped).length,
      unverifiedCount: values.filter(value => value.status === 'unknown' && !value.skipped).length,
      lastIndependentAt: lastIndependent?.createdAt ?? null,
      daysSinceIndependent: lastIndependent ? Math.max(0, Math.floor((now - Date.parse(lastIndependent.createdAt)) / 86400000)) : null,
      recentEvidence: values.slice(0, 6).map(({ id, workId, attemptId, createdAt, status, independent, practiceKind }) => ({ id, workId, attemptId, createdAt, status, independent: Boolean(independent), ...(practiceKind ? { practiceKind } : {}) })),
      supportHypothesis: latest.status === 'incorrect' && difficulties.length >= 2 ? {
        kind: 'check-repeated-difficulty', summary: 'В разных задачах этой темы ответы не совпали. Возможно, стоит разобрать общий шаг; это может быть и ошибка записи.', observationIds: difficulties.slice(0, 3).map(value => value.id),
      } : null,
    }
  })
}

export function selectLearningRoute({ observations = [], families = [], workSummaries = [], dismissed = [], now = Date.now() }) {
  const familyMap = new Map(families.map(f => [f.id, f]))
  const latest = new Map()
  const ordered = [...observations].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  for (const event of ordered) if (familyMap.has(event.familyId) && !latest.has(event.familyId)) latest.set(event.familyId, event)
  const completed = new Set(workSummaries.filter(w => w.completed).map(w => w.id))
  const cooling = new Set(dismissed.filter(d => Date.parse(d.until) > now).map(d => d.familyId))
  const candidates = []
  for (const family of families) {
    if (cooling.has(family.id)) continue
    const event = latest.get(family.id)
    let goal = 'try', priority = 10, reason = 'Попробуй задачу и реши, нужна ли опора.', mode = 'guided'
    if (event) {
      const days = Math.max(0, (now - Date.parse(event.createdAt)) / 86400000)
      if (event.status === 'incorrect' && !completed.has(event.workId)) {
        goal = 'repair'; priority = 100; mode = 'guided'
        reason = 'Ответ в последней попытке не совпал. Разберём, на каком шаге получилось иначе.'
      } else if (event.status === 'unknown' && !completed.has(event.workId)) {
        goal = 'review'; priority = 70
        reason = 'Часть ответа осталась непроверенной. Можно обсудить основание или завершить занятие без оценки.'
      } else if (event.status === 'correct' && !event.independent) {
        goal = 'independent'; priority = 80; mode = 'solo'
        reason = 'После помощи ответы совпали. Следующий шаг — другой вариант без подсказок.'
      } else if (event.status === 'correct' && event.independent && days >= 7) {
        goal = 'recall'; priority = 90; mode = 'solo'
        reason = 'После самостоятельной попытки прошла неделя. Короткая новая задача покажет, что сохранилось.'
      } else if (event.status === 'correct' && event.independent) {
        goal = 'transfer'; priority = 50; mode = 'solo'
        reason = 'Получилось без подсказок. Попробуй выбрать способ в задачах вперемешку.'
      } else {
        goal = 'new-structure'; priority = 30; mode = 'solo'
        reason = 'Занятие завершено. Попробуй задачу с другим условием; к разбору можно вернуться позже.'
      }
    }
    candidates.push({ familyId: family.id, title: family.title, goal, mode, reason, priority, ...(event ? { source: { observationId: event.id, attemptId: event.attemptId, workId: event.workId, createdAt: event.createdAt } } : {}) })
  }
  candidates.sort((a, b) => b.priority - a.priority || families.findIndex(f => f.id === a.familyId) - families.findIndex(f => f.id === b.familyId))
  const chosen = candidates.slice(0, 3).map(({ priority, ...rest }) => rest)
  // A route is a suggestion for several visits, never a forced prerequisite chain.
  return { recommendations: chosen, plannedSessions: chosen.map((item, index) => ({ ...item, order: index + 1 })), observations: ordered.slice(0, 40), learnerMemory: summarizeLearnerEvidence(ordered.filter(event => familyMap.has(event.familyId)), now), generatedAt: new Date(now).toISOString() }
}
