import { enumerateSeries } from './series.mjs'
const gcd=(a,b)=>b?gcd(b,a%b):Math.abs(a)||1
function q(n,d=1){if(d<0){n=-n;d=-d}const g=gcd(n,d);return [n/g,d/g]}
const read=x=>{const [n,d=1]=String(x).split('/').map(Number);return q(n,d)}
const add=(a,b)=>q(a[0]*b[1]+b[0]*a[1],a[1]*b[1])
const mul=(a,b)=>q(a[0]*b[0],a[1]*b[1])
const neg=a=>[-a[0],a[1]]
const key=a=>a[1]===1?String(a[0]):`${a[0]}/${a[1]}`
const tex=a=>a[1]===1?String(a[0]):`${a[0]<0?'-':''}\\frac{${Math.abs(a[0])}}{${a[1]}}`
const pi=a=>a[0]===0?'0':a[1]===1?`${a[0]===1?'':a[0]===-1?'-':a[0]}\\pi`:`${a[0]<0?'-':''}\\frac{${Math.abs(a[0])===1?'':Math.abs(a[0])}\\pi}{${a[1]}}`
const signed=a=>a[0]<0?tex(a):`+${tex(a)}`
function rng(seed){let s=(seed^0x9e3779b9)>>>0;s=Math.imul(s^(s>>>16),0x21f0aaad)>>>0;s=Math.imul(s^(s>>>15),0x735a2d97)>>>0;s=(s^(s>>>15))>>>0;return n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n)}}
function argument(m,phi){return `${m===1?'':m}x${phi[0]===0?'':phi[0]>0?'+'+pi(phi):pi(phi)}`}
const sine={ '-1':['-1/2'], '-1/2':['-1/6','7/6'], '0':['0','1'], '1/2':['1/6','5/6'], '1':['1/2'] }
const cosine={ '-1':['1'], '-1/2':['2/3','4/3'], '0':['1/2','3/2'], '1/2':['1/3','5/3'], '1':['0'] }
function branches(fn,value,m,phi){return ( (fn==='sin'?sine:cosine)[key(value)]??[]).map(a=>({a:key(mul(add(read(a),neg(phi)),q(1,m))),d:key(q(2,m))}))}
function seriesText(series){return series.map(s=>`x=${pi(read(s.a))}+${pi(read(s.d))} k`).join('; ')+'; k ∈ ℤ'}
/** Versioned finite-family generator. All roots follow exact trigonometric identities. */
export function generateProblem(family,seed){
  if(!['G1','G2','G3'].includes(family)||!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Неизвестные параметры генератора')
  const pick=rng(seed),m=1+pick(2),phi=read(['0','1/6','-1/6','1/4','-1/4'][pick(5)])
  let equation,series,parameters,rules
  if(family==='G1'){
    const fn=pick(2)?'sin':'cos',a=pick(2)?1:-1,u=argument(m,phi)
    equation=u==='x'?`\\sin 2x=${a<0?'-':''}\\${fn} x`:`\\sin\\left(2(${u})\\right)=${a<0?'-':''}\\${fn}\\left(${u}\\right)`
    series=[...branches(fn,[0,1],m,phi),...branches(fn==='sin'?'cos':'sin',q(a,2),m,phi)]
    parameters={m,phi:key(phi),fn,a};rules=['sin(2u)=2 sin(u) cos(u)','zero-product','elementary-trigonometric-equations']
  }else if(family==='G2'){
    const pairs=[['1/2','-1'],['-1/2','1'],['1/2','2'],['-1/2','-2'],['0','1'],['0','-1'],['1/2','-1/2']]
    const [r,s]=pairs[pick(pairs.length)].map(read),b=mul(q(-2),add(r,s)),c=add(q(1),mul(q(2),mul(r,s))),u=argument(m,phi)
    equation=`\\cos\\left(2(${u})\\right)=${tex(b)}\\sin\\left(${u}\\right)${signed(c)}`
    series=[...branches('sin',r,m,phi),...branches('sin',s,m,phi)]
    parameters={m,phi:key(phi),r:key(r),s:key(s),b:key(b),c:key(c)};rules=['cos(2u)=1-2sin²(u)','quadratic-factorization','sine-range','elementary-trigonometric-equations']
  }else{
    const p=2+pick(2),other=p===2?1:1+pick(2),alpha=phi,beta=read(['0','1/6','-1/4','1/2'][pick(4)])
    equation=`\\sin\\left(${argument(p,alpha)}\\right)=\\sin\\left(${argument(other,beta)}\\right)`
    series=[{a:key(mul(add(beta,neg(alpha)),q(1,p-other))),d:key(q(2,p-other))},{a:key(mul(add(q(1),neg(add(alpha,beta))),q(1,p+other))),d:key(q(2,p+other))}]
    parameters={p,q:other,alpha:key(alpha),beta:key(beta)};rules=['sin(A)=sin(B): A=B+2πk or A=π-B+2πk']
  }
  // Windows are inclusive and narrow enough for the initial readable pool.
  const lower=q(pick(37)-24,6),upper=add(lower,family==='G2'?q(2,m):q(1))
  const roots=enumerateSeries(series,key(lower),key(upper))
  if(roots.length<1||roots.length>8)throw Error('Генератор вышел за ограничения учебного пула')
  return {id:`gen-v1-${family}-${seed}`,title:'Уравнения · Новый вариант',equation,interval:`x\\in\\left[${pi(lower)};${pi(upper)}\\right]`,description:'Реши уравнение и отбери корни на отрезке.',skills:[],roots,series,solution:seriesText(series),generation:{packageVersion:1,generatorVersion:1,family,seed,parameters,lower:key(lower),upper:key(upper),rules}}
}
export function problemFromGeneratedId(id){const match=/^gen-v1-(G[123])-(0|[1-9]\d{0,9})$/.exec(id??'');if(!match)return null;return generateProblem(match[1],Number(match[2]))}
/** G4: authored-format interval practice derived from an exact series object. */
export function generateSelectionExercise(seed){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Неизвестный вариант упражнения')
  const pick=rng(seed),a=read(['1/3','1/6','-1/4','1/2'][pick(4)]),d=read(['1','2','2/3'][pick(3)])
  const series=[{a:key(a),d:key(d)}]
  if(pick(2))series.push({a:key(add(a,q(1,2))),d:key(d)})
  const lower=q(pick(13)-12,6),upper=add(lower,q(2))
  const roots=enumerateSeries(series,key(lower),key(upper)),interval=`x\\in\\left[${pi(lower)};${pi(upper)}\\right]`
  const selectionSteps=series.map(s=>{
    const start=read(s.a),step=read(s.d),inverse=q(step[1],step[0])
    const min=mul(add(lower,neg(start)),inverse),max=mul(add(upper,neg(start)),inverse)
    const first=Math.ceil(min[0]/min[1]),last=Math.floor(max[0]/max[1])
    const integers=Array.from({length:Math.max(0,last-first+1)},(_,i)=>first+i)
    const values=integers.map(k=>key(add(start,mul(step,q(k)))))
    return {seriesMath:`x=${pi(start)}+${pi(step)} k`,boundsMath:`${tex(min)}\\le k\\le ${tex(max)}`,
      integers,roots:values,rootsMath:values.map(r=>pi(read(r))).join('; '),
      substitutionMath:integers.length?`${pi(start)}+${pi(step)}\\cdot(${integers[0]})=${pi(read(values[0]))}`:null}
  })
  const equations=selectionSteps.map(s=>s.seriesMath).join('\\quad\\text{или}\\quad ')
  return {id:`selection-v1-${seed}`,title:'Отбор корней',kind:'roots',prompt:'Каждая формула описывает целую цепочку подходящих углов. Оставь только углы внутри указанных границ и выпиши их без повторов.',math:`${equations},\\quad k\\in\\mathbb Z,\\quad ${interval}`,answerFormat:'Корни через точку с запятой, например: -π; 0; π/3',series,interval,roots,
    selectionSteps,
    explanation:`Нужно выяснить, какие целые числа шагов k держат угол внутри границ. Сначала убираем начальный сдвиг, затем считаем шаги. В каждой серии вычти начальный угол из обеих границ и раздели на положительный шаг. ${selectionSteps.map(s=>`Для $${s.seriesMath}$ получаем $${s.boundsMath}$; целые значения: ${s.integers.length?s.integers.join(', '):'нет'}.`).join(' ')} ${selectionSteps[0].substitutionMath?`Например, $${selectionSteps[0].substitutionMath}$. `:''}Объедини корни и убери повторы. Получается: $${roots.map(r=>pi(read(r))).join('; ')}$.`,materialIds:['interval'],
    generation:{packageVersion:1,generatorVersion:1,family:'G4',seed,parameters:{series,lower:key(lower),upper:key(upper)},rules:['integer-parameter-bounds','inclusive-endpoints','union-deduplication']}}
}
