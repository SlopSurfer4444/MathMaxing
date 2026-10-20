import { checkRoots } from './root-checker.mjs'
import { generateSelectionExercise } from './generators.mjs'

const exercises = [
  { id:'root-selection', title:'Отбор корней', kind:'roots', prompt:'Из этой серии выпиши все корни на указанном отрезке. Можно начать с целых значений k.', math:'x=\\frac{\\pi}{3}+\\pi k,\\quad k\\in\\mathbb Z,\\quad x\\in[-2\\pi;\\frac{\\pi}{2}]', answerFormat:'Корни через точку с запятой, например: -π; 0; π/3', explanation:'Раздели границы на π: −2 ≤ 1/3 + k ≤ 1/2. Тогда −7/3 ≤ k ≤ 1/6, то есть k = −2, −1, 0. Подстановка даёт −5π/3, −2π/3, π/3.', materialIds:['interval','unit-circle'], roots:['-5/3','-2/3','1/3'] },
  { id:'lost-branch', title:'Сохранить все случаи', kind:'choice', prompt:'Ученик разделил обе части на cos x и оставил только sin x = 1/2. Какой случай нужно проверить отдельно?', math:'\\cos x(2\\sin x-1)=0', answerFormat:'Выбери один вариант', choices:[{id:'cos-zero',label:'cos x = 0',math:'\\cos x=0'},{id:'sin-zero',label:'sin x = 0',math:'\\sin x=0'},{id:'none',label:'Никакой, деление всегда допустимо'}], correct:'cos-zero', explanation:'Деление на cos x допустимо только при cos x ≠ 0. Поэтому сначала сохраняем случай cos x = 0, а при cos x ≠ 0 получаем sin x = 1/2. У произведения нулём может быть любой множитель.', materialIds:['zero-product'] },
  { id:'sine-basics', title:'Что означает синус', kind:'choice', prompt:'Точка на единичной окружности имеет координаты (√3/2; 1/2). Чему равен синус угла от положительного направления горизонтальной оси до этой точки?', math:'P=(\\frac{\\sqrt3}{2};\\frac12)', answerFormat:'Выбери один вариант', choices:[{id:'half',label:'1/2',math:'\\frac12'},{id:'sqrt-half',label:'√3/2',math:'\\frac{\\sqrt3}{2}'},{id:'one',label:'1',math:'1'}], correct:'half', explanation:'На единичной окружности синус — вертикальная координата точки, а косинус — горизонтальная. Здесь вертикальная координата равна 1/2.', materialIds:['sine','unit-circle'] },
]
export function publicExercise(exerciseOrId) {
  const exercise=typeof exerciseOrId==='string'?getExercise(exerciseOrId):exerciseOrId
  const {id,title,kind,prompt,math,answerFormat,explanation,materialIds,choices}=exercise
  return {id,title,kind,prompt,math,answerFormat,explanation,materialIds,...(choices?{choices}:{})}
}
export const publicExercises=exercises.map(publicExercise)
export function getExercise(id){
  const match=/^selection-v1-(0|[1-9]\d{0,9})$/.exec(id??'')
  if(match) return generateSelectionExercise(Number(match[1]))
  const exercise=exercises.find(e=>e.id===id)
  if(!exercise)throw Object.assign(Error('Неизвестное упражнение'),{status:404})
  return exercise
}
export function checkExercise(id,answer){
  const exercise=getExercise(id)
  if(exercise.kind==='roots')return checkRoots(answer,exercise.roots)
  if(!exercise.choices.some(choice=>choice.id===answer))return {status:'unknown',summary:'Выбери один из предложенных вариантов. Нераспознанный ответ не считается ошибкой.'}
  return answer===exercise.correct?{status:'correct',summary:'Верно. Теперь можно вернуться к своему решению.'}:{status:'incorrect',summary:'Пока не совпало. Можно попробовать ещё раз или открыть объяснение.'}
}
