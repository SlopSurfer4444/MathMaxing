// A read-only projection of saved checker decisions. Never rerun a checker or
// rewrite historical observations when their evaluation authority changes.
export function learnerObservations(db, owner) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('exam_observations','exam_works')").all()
  if (tables.length !== 2) return []
  const rows = db.prepare(`WITH ranked AS (
    SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.family_id ORDER BY o.created_at DESC,o.id DESC) AS family_rank
    FROM exam_observations o WHERE o.owner=?
  ) SELECT o.id,o.work_id,o.family_id,o.attempt_id,o.created_at,o.data,
    (SELECT json_object('revision',json_extract(a.value,'$.revision'),'digest',json_extract(a.value,'$.digest'),'provenance',json_extract(a.value,'$.provenance'))
      FROM json_each(w.data,'$.attempts') a WHERE json_extract(a.value,'$.id')=o.attempt_id LIMIT 1) AS attempt,
    (SELECT json_group_array(json_object(
      'id',json_extract(e.value,'$.id'),'partId',json_extract(e.value,'$.partId'),'status',json_extract(e.value,'$.status'),
      'targetRevision',json_extract(e.value,'$.targetRevision'),'targetDigest',json_extract(e.value,'$.targetDigest'),
      'checker',json_extract(e.value,'$.checker'),'checkerVersion',json_extract(e.value,'$.checkerVersion'),
      'supersedes',json_extract(e.value,'$.supersedes'),'provenance',json_extract(e.value,'$.provenance'),
      'withdrawn',CASE WHEN json_extract(e.value,'$.active')=0 OR EXISTS(SELECT 1 FROM json_each(w.data,'$.retractions') r WHERE json_extract(r.value,'$.evaluationId')=json_extract(e.value,'$.id')) THEN 1 ELSE 0 END))
      FROM json_each(w.data,'$.evaluations') e WHERE json_extract(e.value,'$.attemptId')=o.attempt_id) AS evaluations
    FROM ranked o LEFT JOIN exam_works w ON w.id=o.work_id AND w.owner=o.owner
    WHERE o.family_rank<=12 ORDER BY o.created_at DESC,o.id DESC`).all(owner)
  return rows.map(row => derive({ ...JSON.parse(row.data), id: row.id, workId: row.work_id, familyId: row.family_id, attemptId: row.attempt_id, createdAt: row.created_at }, row.attempt ? JSON.parse(row.attempt) : null, JSON.parse(row.evaluations)))
}

function derive(source, attempt, evaluations) {
  const sourceEvaluationIds = [...new Set(Array.isArray(source.evaluationIds) ? source.evaluationIds.filter(id => typeof id === 'string') : [])]
  const byId = new Map(evaluations.filter(evaluation => typeof evaluation.id === 'string').map(evaluation => [evaluation.id, evaluation]))
  const imported = source.provenance === 'imported-unverified' || attempt?.provenance === 'imported-unverified'
  const sameSnapshot = evaluation => attempt && Number.isSafeInteger(attempt.revision) && typeof attempt.digest === 'string' && evaluation.targetRevision === attempt.revision && evaluation.targetDigest === attempt.digest
  const belongs = (evaluation, root) => {
    const visited = new Set()
    while (evaluation && !visited.has(evaluation.id)) {
      if (evaluation.id === root.id) return true
      visited.add(evaluation.id)
      evaluation = byId.get(evaluation.supersedes)
      if (evaluation && evaluation.partId !== root.partId) return false
    }
    return false
  }
  const parts = sourceEvaluationIds.map(id => {
    const root = byId.get(id)
    const active = root && typeof root.partId === 'string' ? evaluations.filter(evaluation => evaluation.partId === root.partId && !evaluation.withdrawn && belongs(evaluation, root)) : []
    const current = active.length === 1 ? active[0] : null
    const trusted = current && sameSnapshot(current) && current.provenance !== 'imported-unverified' && !imported
    return { ...(root?.partId ? { partId: root.partId } : {}), sourceEvaluationId: id,
      status: trusted && ['correct', 'incorrect', 'unknown'].includes(current.status) ? current.status : 'unknown',
      ...(current ? { evaluationId: current.id, checker: current.checker, checkerVersion: current.checkerVersion, evaluationProvenance: current.provenance ?? 'saved-checker' } : {}) }
  })
  const status = source.skipped || imported ? 'unknown' : parts.some(part => part.status === 'incorrect') ? 'incorrect' : parts.length && parts.every(part => part.status === 'correct') ? 'correct' : 'unknown'
  return { ...source, sourceStatus: source.status, sourceEvaluationIds, evaluationIds: parts.map(part => part.evaluationId).filter(Boolean), parts, status,
    independent: source.independent === true && !imported,
    ...(source.provenance ? { sourceProvenance: source.provenance } : {}), provenance: imported ? 'imported-unverified' : 'current-saved-evaluations',
    summary: source.skipped ? source.summary : imported ? 'Импортированная неподтверждённая запись. Сохранённые проверки не подтверждают результат импорта.' : status === 'correct' ? 'Текущие сохранённые проверки ответов совпали; рассуждение и освоение отдельно не установлены.' : status === 'incorrect' ? 'В действующей сохранённой проверке ответа есть расхождение; причина пока не установлена.' : 'Действующих сохранённых проверок недостаточно для подтверждения ответа. Прежняя попытка и история проверок сохранены.' }
}
