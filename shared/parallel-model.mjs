// Version 1 applies only to the authored configuration: ABC is nondegenerate,
// D is inside AB and E is inside AC. Lengths come from its frozen descriptor,
// never from measurements of a drawing or from a model's reading of a proof.
const MAX_LENGTH = 1_000_000_000
const scope = 'Проверено только выбранное основание при условиях: ABC невырожден, D внутри AB, E внутри AC. Полнота доказательства и освоение темы не проверены.'

export function evaluateParallelModel(facts, choice) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) ||
      !['ad', 'db', 'ae', 'ec'].every(key => Number.isSafeInteger(facts[key]) && facts[key] > 0 && facts[key] <= MAX_LENGTH)) {
    throw new RangeError('Для этой модели нужны четыре положительные целые длины не больше 1000000000.')
  }
  const { ad, db, ae, ec } = facts
  const sides = { ab: ad + db, ac: ae + ec }
  const ratios = { left: ad / sides.ab, right: ae / sides.ac }
  // A quotient is useful for display, but rounded Number quotients can coincide
  // for unequal fractions. Compare the full-side proportions exactly instead.
  const parallel = BigInt(ad) * BigInt(sides.ac) === BigInt(ae) * BigInt(sides.ab)
  const result = (status, summary) => ({ status, summary, scope, mastery: false, ratios, sides, parallel })

  if (choice === 'sides-angle') {
    return parallel
      ? result('correct', 'Отношения AD/AB и AE/AC равны. Вместе с общим углом A это даёт основание для подобия; затем равенство соответствующих углов позволяет вывести параллельность.')
      : result('incorrect', 'Отношения AD/AB и AE/AC не равны. Общий угол A сохранился, но для подобия по двум сторонам и углу между ними нужны ещё пропорциональные стороны.')
  }
  if (choice === 'parallel-angles') {
    return result('incorrect', 'Параллельность DE и BC требуется доказать. Получать из неё равные углы для обоснования этого же вывода — круг в рассуждении.')
  }
  if (choice === 'other') {
    return result('unknown', 'Другой способ здесь не проверяется. Обратная теорема Фалеса или векторное доказательство тоже могут быть верными; продолжи своё обоснование.')
  }
  return result('unknown', 'Основание пока не выбрано или не распознано. Можно выбрать предложенное основание либо продолжить другим способом.')
}
