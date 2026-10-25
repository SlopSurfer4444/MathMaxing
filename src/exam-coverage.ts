/** Numbering is explicitly pinned to the approved 2026 format, not the 2027 draft. */
export const examCoverageReference = {
  year: 2026,
  verifiedAt: '2026-10-21',
  title: 'Профильный ЕГЭ · формат 2026',
  source: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2026/ma_11_2026.zip',
  catalogSource: 'https://fipi.ru/ege/demoversii-specifikacii-kodifikatory',
  nextYearNote: 'ФИПИ публикует формат 2027 как проект. Его нумерация отличается; эта карта относится к 2026 году.',
  disclaimer: 'Это карта доступных материалов, а не оценка твоей готовности. Полного пробника пока нет.',
} as const

export type CoverageStatus = 'limited' | 'foundation' | 'unavailable'
export type CoveragePackage = 'percentages' | 'trigonometry' | 'graphs' | 'inequalities'
export type ExamCoverageEntry = {
  position: number
  title: string
  status: CoverageStatus
  packageIds: CoveragePackage[]
  detail: string
}
export const coverageStatusLabels: Record<CoverageStatus, string> = {
  limited: 'Часть темы', foundation: 'Подготовительные упражнения', unavailable: 'Пока нет',
}

// These are human-readable topic summaries of the demo positions, not an
// exhaustive official syllabus. A linked foundation does not cover the task.
export const examCoverage: readonly ExamCoverageEntry[] = [
  { position: 1, title: 'Планиметрия: вычисления', status: 'unavailable', packageIds: [], detail: 'Нет отдельного набора геометрических задач и проверки.' },
  { position: 2, title: 'Векторы', status: 'unavailable', packageIds: [], detail: 'Координаты, длины и скалярное произведение ещё не представлены.' },
  { position: 3, title: 'Стереометрия: вычисления', status: 'unavailable', packageIds: [], detail: 'Нет набора задач на объёмы и пространственные фигуры.' },
  { position: 4, title: 'Вероятности: простые модели', status: 'unavailable', packageIds: [], detail: 'Нет отдельного учебного маршрута по вероятностям.' },
  { position: 5, title: 'Вероятности: события и сочетания', status: 'unavailable', packageIds: [], detail: 'Нет задач на независимость, объединение событий и выбор объектов.' },
  { position: 6, title: 'Уравнения с кратким ответом', status: 'unavailable', packageIds: [], detail: 'Тригонометрический пакет не заменяет набор этих уравнений.' },
  { position: 7, title: 'Вычисления и преобразования выражений', status: 'foundation', packageIds: ['trigonometry'], detail: 'Есть объяснения отдельных тригонометрических преобразований. Нет полного набора выражений, степеней и логарифмов.' },
  { position: 8, title: 'Производная и её графический смысл', status: 'unavailable', packageIds: [], detail: 'Чтение обычного графика не заменяет понимание производной; такого маршрута ещё нет.' },
  { position: 9, title: 'Прикладные задачи с формулами', status: 'unavailable', packageIds: [], detail: 'Нет отдельного набора задач на заданные зависимости и единицы измерения.' },
  { position: 10, title: 'Текстовые задачи', status: 'foundation', packageIds: ['percentages', 'graphs'], detail: 'Есть основы процентов и равномерного изменения. Сложные модели движения, работы и смесей ещё не покрыты.' },
  { position: 11, title: 'Функции и графики', status: 'foundation', packageIds: ['graphs'], detail: 'Есть чтение линейного графика и таблицы. Нет полного набора функций, восстановления формул и пересечений.' },
  { position: 12, title: 'Исследование функций и экстремумы', status: 'unavailable', packageIds: [], detail: 'Нет маршрута по производным и исследованию функций.' },
  { position: 13, title: 'Уравнения с развёрнутым решением', status: 'limited', packageIds: ['trigonometry'], detail: 'Есть выбранные тригонометрические семейства и отбор корней. Это не все варианты задания; проверка ответа не подтверждает полноту доказательства.' },
  { position: 14, title: 'Стереометрия: доказательство и вычисления', status: 'unavailable', packageIds: [], detail: 'Нет законченного пакета пространственных доказательств и вычислений.' },
  { position: 15, title: 'Неравенства с развёрнутым решением', status: 'foundation', packageIds: ['inequalities'], detail: 'Есть линейные, произведение и рациональная дробь. Показательные и логарифмические неравенства экзаменационного уровня ещё не покрыты.' },
  { position: 16, title: 'Экономические задачи', status: 'foundation', packageIds: ['percentages'], detail: 'Есть изменение цены и выбор процентной базы. Нет полноценного маршрута по кредитам и платежам.' },
  { position: 17, title: 'Планиметрия: доказательство и вычисления', status: 'unavailable', packageIds: [], detail: 'Нет законченного пакета геометрических доказательств и вычислений.' },
  { position: 18, title: 'Задачи с параметром', status: 'unavailable', packageIds: [], detail: 'Нет маршрута по случаям, границам и числу решений в зависимости от параметра.' },
  { position: 19, title: 'Числа и логические рассуждения', status: 'unavailable', packageIds: [], detail: 'Нет набора задач на целые числа, примеры, невозможность и обоснование оптимальности.' },
]
