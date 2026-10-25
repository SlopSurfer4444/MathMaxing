// A local consequence of one proposed payment, not a grade for the solution.
// Amounts have at most 12 decimal places; calculations retain those decimals.
const scale = 10n ** 12n
const percentScale = 100n * scale
const maxPrincipal = 1_000_000_000
const maxPayment = 1_000_000_000_000
const scope = 'Только остатки при двух одинаковых платежах: проценты начисляют перед каждым платежом. Запись решения и понимание не оценивались.'
const display = amount => String(amount).replace('.', ',')
const amount = (numerator, denominator = scale) => Number(numerator / denominator) + Number(numerator % denominator) / Number(denominator)
const result = (status, outcome, summary, steps = [], finalBalance) => ({ status, summary, scope, mastery: false, steps, outcome, ...(finalBalance === undefined ? {} : { finalBalance }) })

function units(text) {
  // Scientific notation is used only for finite numeric facts converted to text.
  const match = /^([+-]?)(\d*)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
  if (!match || (!match[2] && !match[3])) return null
  const shift = 12 + Number(match[4] ?? 0) - (match[3]?.length ?? 0)
  if (shift < 0 || shift > 30) return null
  const value = BigInt((match[2] || '0') + (match[3] ?? '')) * 10n ** BigInt(shift)
  return match[1] === '-' ? -value : value
}

/** rate is a percentage per period: 10 means 10%, not 0.1. */
export function evaluateDebtModel(facts, input) {
  if (!facts || typeof facts !== 'object' || !Number.isFinite(facts.principal) || !Number.isFinite(facts.rate)
    || facts.principal <= 0 || facts.principal > maxPrincipal || facts.rate < 0 || facts.rate > 100) {
    return result('unknown', 'invalid', 'Не удалось прочитать условия этой модели долга.')
  }
  const principal = units(String(facts.principal)), rate = units(String(facts.rate))
  if (principal === null || rate === null) return result('unknown', 'invalid', 'Условия модели требуют больше точности, чем поддерживает этот разбор.')
  if (typeof input !== 'string' || input.length > 80) return result('unknown', 'invalid', 'Запиши один платёж числом, например 12100 или 12100,5.')
  const text = input.trim().replace(',', '.')
  if (!/^[+-]?(?:\d+(?:\.\d{1,12})?|\.\d{1,12})$/.test(text)) {
    return result('unknown', 'invalid', 'Не удалось прочитать платёж. Нужен один размер платежа, до 12 знаков после запятой, без формулы и единиц.')
  }
  const numericPayment = Number(text)
  if (!Number.isFinite(numericPayment) || Math.abs(numericPayment) > maxPayment) {
    return result('unknown', 'invalid', 'Для этой модели запиши платёж не больше 1 000 000 000 000 рублей.')
  }
  const payment = units(text)
  if (payment === null) return result('unknown', 'invalid', 'Не удалось прочитать точную сумму платежа.')
  if (payment <= 0n) return result('incorrect', 'invalid', 'Платёж должен быть положительным: ноль и отрицательная сумма не уменьшают долг.')

  // Rational decimal arithmetic: no rounding of the supplied payment or interest.
  const growth = percentScale + rate
  const firstDenominator = scale * percentScale
  const firstAccrued = principal * growth
  const firstBalance = firstAccrued - payment * percentScale
  const steps = [
    { id: 'initial', label: 'Взятый кредит', amount: amount(principal) },
    { id: 'interest-1', label: `После первого начисления ${display(facts.rate)}%`, amount: amount(firstAccrued, firstDenominator) },
    { id: 'payment-1', label: `После первого платежа ${display(numericPayment)} руб.`, amount: amount(firstBalance, firstDenominator) },
  ]
  if (firstBalance <= 0n) {
    const finalBalance = amount(firstBalance, firstDenominator)
    return result('incorrect', 'early', firstBalance === 0n
      ? 'Первый платёж уже погасил весь долг. Для модели двух платежей должен остаться положительный долг после первого; второго начисления здесь нет.'
      : `Первый платёж уже превышает долг после начисления. Переплата ${display(-finalBalance)} руб.; вторые проценты на неё не начисляем. Для этой модели первый платёж должен быть меньше ${display(steps[1].amount)} руб.`, steps, finalBalance)
  }

  const secondDenominator = firstDenominator * percentScale
  const secondAccrued = firstBalance * growth
  const secondBalance = secondAccrued - payment * percentScale * percentScale
  const finalBalance = amount(secondBalance, secondDenominator)
  steps.push(
    { id: 'interest-2', label: `После второго начисления ${display(facts.rate)}% на оставшийся долг`, amount: amount(secondAccrued, secondDenominator) },
    { id: 'payment-2', label: `После второго такого же платежа ${display(numericPayment)} руб.`, amount: finalBalance },
  )
  if (secondBalance === 0n) return result('correct', 'settled', 'После второго такого же платежа долг стал нулевым. Проверена эта подстановка; обоснование размера платежа остаётся в твоём решении.', steps, finalBalance)
  if (secondBalance > 0n) return result('incorrect', 'remaining', `После двух таких платежей осталось ${display(finalBalance)} руб. долга. Во второй раз проценты считали от остатка после первого платежа.`, steps, finalBalance)
  return result('incorrect', 'overpaid', `Второй платёж превышает оставшийся долг: переплата ${display(-finalBalance)} руб. Одинаковый платёж здесь слишком велик.`, steps, finalBalance)
}
