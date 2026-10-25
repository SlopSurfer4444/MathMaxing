import { percentageProblems } from './percentages.mjs'

const version = 1
const families = {
  discount: 'percent-discount-v1',
  successive: 'percent-successive-v1',
  reverse: 'percent-reverse-v1',
  comparison: 'percent-transfer-v1',
}
const grammar = /^percent-practice-v1-(discount|successive|reverse|comparison)-(0|[1-9]\d{0,9})$/
const validSeed = seed => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff
const authored = family => percentageProblems.find(problem => problem.id === families[family])

// Two-change prices are multiples of 400; discounts alone use multiples of 100.
// Percentages are multiples of five, so the constructed prices stay integral.
function generate(family, seed) {
  const source = authored(family)
  const percent = [10, 15, 20, 25, 30, 35, 40][seed % 7]
  const initial = (seed + 10) * (family === 'discount' ? 100 : 400)
  const decreased = initial * (100 - percent) / 100
  const increased = initial * (100 + percent) / 100
  const final = family === 'reverse'
    ? increased * (100 - percent) / 100
    : decreased * (100 + percent) / 100
  let prompt, answer, solution
  if (family === 'discount') {
    prompt = `Рюкзак стоил ${initial} рублей. На него сделали скидку ${percent}%. Сколько рублей стоит рюкзак после скидки?`
    answer = String(decreased)
    solution = `Прежняя цена ${initial} рублей — это 100%. Один процент стоит ${initial} / 100 = ${initial / 100} рублей. После скидки осталось 100 − ${percent} = ${100 - percent} процентов. Покупатель платит ${initial} · ${100 - percent}/100 = ${decreased} рублей. Проверка: скидка ${initial - decreased} рублей и оплата ${decreased} рублей вместе дают ${initial} рублей.`
  } else if (family === 'successive') {
    prompt = `Куртка стоила ${initial} рублей. Сначала цену снизили на ${percent}%, затем новую цену повысили на ${percent}%. Сколько рублей стоит куртка теперь?`
    answer = String(final)
    solution = `После скидки цена равна ${initial} · ${100 - percent}/100 = ${decreased} рублей. Второй процент считаем от новой цены ${decreased}, поэтому повышение равно ${decreased} · ${percent}/100 = ${final - decreased} рублей. Итог: ${decreased} + ${final - decreased} = ${final} рублей. Скидка составила ${initial - decreased} рублей, а повышение — ${final - decreased} рублей: одинаковые проценты от разных цен не отменили друг друга.`
  } else if (family === 'reverse') {
    prompt = `После повышения цены на ${percent}% и последующей скидки ${percent}% стол стал стоить ${final} рублей. Сколько рублей стоил стол до обоих изменений?`
    answer = String(initial)
    solution = `Отменяем изменения с последнего. После скидки осталось ${100 - percent}% цены перед скидкой. Значит, перед ней стол стоил ${final} / ${100 - percent} · 100 = ${increased} рублей. Эта сумма составляет ${100 + percent}% первоначальной цены. Первоначальная цена: ${increased} / ${100 + percent} · 100 = ${initial} рублей. Проверка вперёд: ${initial} · ${100 + percent}/100 = ${increased}; ${increased} · ${100 - percent}/100 = ${final}.`
  } else {
    const reduction = percent * percent / 100
    prompt = `Цена абонемента составляла ${initial} рублей. Она выросла на ${percent}%, затем снизилась на ${percent}% от новой цены. На сколько процентов итоговая цена ниже первоначальной?`
    answer = String(reduction)
    solution = `После повышения цена равна ${initial} · ${100 + percent}/100 = ${increased} рублей. После скидки от новой цены получаем ${increased} · ${100 - percent}/100 = ${final} рублей. Потеря относительно начала — ${initial} − ${final} = ${initial - final} рублей. Один процент первоначальной цены — ${initial / 100} рублей. Снижение составляет ${initial - final} / ${initial / 100} = ${reduction}% именно от первоначальной цены.`
  }
  const help = structuredClone(source.help)
  // The authored successive example originally states two changes without
  // explicitly asking its final-price question. Keep the reused example clear.
  if (family === 'successive') help.example.prompt += ' Сколько рублей стоит билет теперь?'
  return {
    id: `percent-practice-v1-${family}-${seed}`, title: source.title,
    kind: 'numeric', packageId: 'percentages', contentVersion: version,
    percentageFamily: family, prompt, description: prompt,
    answerUnit: source.answerUnit, answer, solution,
    skills: [...source.skills], help,
    generation: {
      packageVersion: version, generatorVersion: version, family, seed,
      sourceProblemId: source.id, sourceContentVersion: source.contentVersion,
      parameters: { initial, percent, decreased, increased, final },
      rules: family === 'discount' ? ['remaining-percentage']
        : family === 'reverse' ? ['successive-percentages', 'inverse-percentages']
          : family === 'comparison' ? ['successive-percentages', 'percentage-comparison']
            : ['successive-percentages', 'new-percentage-base'],
    },
  }
}

/** Reconstruct only canonical, versioned IDs with a uint32 seed. */
export function percentageVariantFromId(id) {
  if (typeof id !== 'string') return null
  const match = grammar.exec(id)
  if (!match || !validSeed(Number(match[2]))) return null
  return generate(match[1], Number(match[2]))
}

function sourceIdentity(problem) {
  if (!problem || problem.packageId !== 'percentages' || problem.kind !== 'numeric') return null
  const generated = percentageVariantFromId(problem.id)
  const knownFamily = generated?.percentageFamily ?? Object.keys(families).find(key => families[key] === problem.id)
  const metadata = problem.generation
  if (metadata != null && (metadata.packageVersion !== version || metadata.generatorVersion !== version
    || !Object.hasOwn(families, metadata.family) || !validSeed(metadata.seed))) return null
  if (metadata && knownFamily && (metadata.family !== knownFamily
    || (generated && metadata.seed !== generated.generation.seed))) return null
  const family = knownFamily ?? metadata?.family
  if (!family || (problem.percentageFamily != null && problem.percentageFamily !== family)) return null
  return { family, seed: generated?.generation.seed ?? metadata?.seed }
}

/** A retry stays in the source family and skips every known ID and prompt. */
export function nextPercentageVariant(problem, history = []) {
  const identity = sourceIdentity(problem)
  if (!identity) return null
  const { family } = identity
  const seenIds = new Set(), seenPrompts = new Set()
  function remember(entry) {
    const id = typeof entry === 'string' ? entry : entry?.problemId ?? entry?.id
    if (typeof id === 'string') {
      seenIds.add(id)
      const known = percentageVariantFromId(id) ?? percentageProblems.find(value => value.id === id)
      if (known) seenPrompts.add(known.prompt)
    }
    const storedIdentity = sourceIdentity(entry)
    if (storedIdentity?.seed != null) {
      const known = generate(storedIdentity.family, storedIdentity.seed)
      seenIds.add(known.id)
      seenPrompts.add(known.prompt)
    }
    if (typeof entry?.prompt === 'string') seenPrompts.add(entry.prompt)
    if (entry?.problem && typeof entry.problem === 'object') remember(entry.problem)
  }
  remember(problem)
  for (const entry of Array.isArray(history) ? history : []) remember(entry)
  // Frozen metadata also identifies variants whose old ID is no longer known.
  let seed = identity.seed
  seed = seed == null ? 0 : (seed + 1) >>> 0
  // Each percentage has an injective price sequence. A reverse prompt can
  // collide across at most seven percentages, so this bound also covers it.
  const limit = seenIds.size + 7 * seenPrompts.size + 1
  for (let attempt = 0; attempt < limit; attempt++, seed = (seed + 1) >>> 0) {
    const candidate = generate(family, seed)
    if (!seenIds.has(candidate.id) && !seenPrompts.has(candidate.prompt)) return candidate
  }
  return null
}
