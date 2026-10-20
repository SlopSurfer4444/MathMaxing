import { generateProblem, problemFromGeneratedId } from './generators.mjs'
export const problems = [
  { id: 'double-angle-cos', title: 'Уравнения · Вариант 1', equation: '\\sin 2x=\\cos x', interval: 'x\\in\\left[-\\frac{\\pi}{2};\\frac{3\\pi}{2}\\right]', description: 'Реши уравнение и отбери корни на отрезке.', skills: ['Формула двойного угла', 'Нулевое произведение', 'Отбор корней'], roots: ['-1/2','1/6','1/2','5/6','3/2'], solution: 'sin 2x=2 sin x cos x. cos x(2 sin x-1)=0. cos x=0 или sin x=1/2. На отрезке корни -π/2, π/6, π/2, 5π/6, 3π/2.' },
  { id: 'double-angle-sin', title: 'Уравнения · Вариант 2', equation: '\\sin 2x=\\sin x', interval: 'x\\in[-\\pi;\\pi]', description: 'Реши уравнение и отбери корни на отрезке.', skills: ['Формула двойного угла', 'Нулевое произведение', 'Отбор корней'], roots: ['-1','-1/3','0','1/3','1'], solution: 'sin x(2 cos x-1)=0. sin x=0 или cos x=1/2. На отрезке корни -π, -π/3, 0, π/3, π.' },
  { id: 'cos-double-sin', title: 'Уравнения · Вариант 3', equation: '\\cos 2x=\\sin x', interval: 'x\\in[0;2\\pi]', description: 'Реши уравнение и найди все корни на отрезке.', skills: ['Формула косинуса двойного угла', 'Отбор корней'], roots: ['1/6','5/6','3/2'], solution: '1-2sin²x=sin x. (2sin x-1)(sin x+1)=0. sin x=1/2 или sin x=-1. На отрезке π/6, 5π/6, 3π/2.' },
  { id: 'double-angle-negative-cos', title: 'Уравнения · Вариант 4', equation: '\\sin 2x=-\\cos x', interval: 'x\\in[-\\pi;\\pi]', description: 'Реши уравнение и отбери корни на отрезке.', skills: ['Формула двойного угла', 'Нулевое произведение', 'Отбор корней'], roots: ['-5/6','-1/2','-1/6','1/2'], solution: 'cos x(2 sin x+1)=0. cos x=0 или sin x=-1/2. На отрезке -5π/6, -π/2, -π/6, π/2.' },
  { id: 'double-angle-negative-sin', title: 'Уравнения · Вариант 5', equation: '\\sin 2x=-\\sin x', interval: 'x\\in[-\\pi;\\pi]', description: 'Реши уравнение и отбери корни на отрезке.', skills: ['Формула двойного угла', 'Нулевое произведение', 'Отбор корней'], roots: ['-1','-2/3','0','2/3','1'], solution: 'sin x(2 cos x+1)=0. sin x=0 или cos x=-1/2. На отрезке -π, -2π/3, 0, 2π/3, π.' },
  { id: 'cos-double-negative-sin', title: 'Уравнения · Вариант 6', equation: '\\cos 2x=-\\sin x', interval: 'x\\in[0;2\\pi]', description: 'Реши уравнение и отбери корни на отрезке.', skills: ['Формула косинуса двойного угла', 'Отбор корней'], roots: ['1/2','7/6','11/6'], solution: '1-2sin²x=-sin x. (2sin x+1)(sin x-1)=0. sin x=-1/2 или sin x=1. На отрезке π/2, 7π/6, 11π/6.' },
]
const authoredSeries = {
  'double-angle-cos':[{a:'1/2',d:'1'},{a:'1/6',d:'2'},{a:'5/6',d:'2'}],
  'double-angle-sin':[{a:'0',d:'1'},{a:'1/3',d:'2'},{a:'-1/3',d:'2'}],
  'cos-double-sin':[{a:'1/6',d:'2'},{a:'5/6',d:'2'},{a:'-1/2',d:'2'}],
  'double-angle-negative-cos':[{a:'1/2',d:'1'},{a:'-1/6',d:'2'},{a:'7/6',d:'2'}],
  'double-angle-negative-sin':[{a:'0',d:'1'},{a:'2/3',d:'2'},{a:'-2/3',d:'2'}],
  'cos-double-negative-sin':[{a:'1/2',d:'2'},{a:'-1/6',d:'2'},{a:'7/6',d:'2'}],
}
for(const problem of problems)problem.series=authoredSeries[problem.id]
export function publicProblem(value) { const p=typeof value==='string'?getProblem(value):value; return {id:p.id,title:p.title,equation:p.equation,interval:p.interval,description:p.description,skills:[]} }
export const publicProblems = problems.map(publicProblem)
export function getProblem(id) { const p = problems.find(p => p.id === id) ?? problemFromGeneratedId(id); if (!p) throw new Error('Неизвестная задача'); return p }
export function blankDocument() { return { type:'doc', content:[{type:'paragraph', attrs:{id:crypto.randomUUID()}}] } }

// Canonicalize only our finite templates, using their exact construction data.
// Equal solution sets alone would also merge different equations, so the key
// describes the equation's trig terms and interval, not its list of roots.
const authoredTemplates={
  'double-angle-cos':['G1',{m:1,phi:'0',fn:'cos',a:1},'-1/2','3/2'],
  'double-angle-sin':['G1',{m:1,phi:'0',fn:'sin',a:1},'-1','1'],
  'cos-double-sin':['G2',{m:1,phi:'0',b:'1',c:'0'},'0','2'],
  'double-angle-negative-cos':['G1',{m:1,phi:'0',fn:'cos',a:-1},'-1','1'],
  'double-angle-negative-sin':['G1',{m:1,phi:'0',fn:'sin',a:-1},'-1','1'],
  'cos-double-negative-sin':['G2',{m:1,phi:'0',b:'-1',c:'0'},'0','2'],
}
const gcd=(a,b)=>b?gcd(b,a%b):Math.abs(a)||1
const fraction=(n,d=1)=>{if(d<0){n=-n;d=-d}const g=gcd(n,d);return [n/g,d/g]}
const rational=value=>{const [n,d=1]=String(value).split('/').map(Number);return fraction(n,d)}
const rationalKey=([n,d])=>d===1?String(n):`${n}/${d}`
const plus=(a,b)=>fraction(a[0]*b[1]+b[0]*a[1],a[1]*b[1])
const times=(a,b)=>fraction(a[0]*b[0],a[1]*b[1])
export function problemFingerprint(problem){
  const data=authoredTemplates[problem.id]??(problem.generation&&[
    problem.generation.family,problem.generation.parameters,problem.generation.lower,problem.generation.upper])
  if(!data||!['G1','G2','G3'].includes(data[0]))return problem.equation+'|'+problem.interval
  const [family,p,lower,upper]=data,atoms=new Map()
  const term=(fn,frequency,phase,coefficient)=>{
    let value=rational(coefficient),shift=rational(phase)
    if(fn==='cos')shift=plus(shift,[1,2])
    // sin(u+π)=-sin(u); canonical phases are rational multiples of π in [0,1).
    const turns=Math.floor(shift[0]/shift[1])
    shift=plus(shift,[-turns,1]);if(Math.abs(turns%2)===1)value=times(value,[-1,1])
    const atom=fn==='constant'?'constant':`${frequency}:${rationalKey(shift)}`
    atoms.set(atom,plus(atoms.get(atom)??[0,1],value))
  }
  if(family==='G1'){
    term('sin',2*p.m,rationalKey(times(rational(p.phi),[2,1])),1)
    term(p.fn,p.m,p.phi,-p.a)
  }else if(family==='G2'){
    term('cos',2*p.m,rationalKey(times(rational(p.phi),[2,1])),1)
    term('sin',p.m,p.phi,rationalKey(times(rational(p.b),[-1,1])))
    term('constant',0,'0',rationalKey(times(rational(p.c),[-1,1])))
  }else{
    term('sin',p.p,p.alpha,1);term('sin',p.q,p.beta,-1)
  }
  const nonzero=[...atoms].filter(([,value])=>value[0]).sort(([a],[b])=>a.localeCompare(b))
  const scale=nonzero.length?[nonzero[0][1][1],nonzero[0][1][0]]:[1,1]
  return JSON.stringify([nonzero.map(([atom,value])=>[atom,rationalKey(times(value,scale))]),rationalKey(rational(lower)),rationalKey(rational(upper))])
}

export function nextProblem(work, history=[], allowedFamilies=['G1']) {
  const entries=Array.isArray(history)?history:[]
  const seen=new Set(entries.map(w=>typeof w==='string'?w:w.problemId))
  if(work?.problemId)seen.add(work.problemId)
  const current=/^gen-v1-G([123])-/.exec(work?.problemId??'')
  const allowed=allowedFamilies.filter(f=>['G1','G2','G3'].includes(f))
  if(!allowed.length)throw Error('Нет доступных семейств задач')
  const previous=current?`G${current[1]}`:null
  const family=allowed[(allowed.indexOf(previous)+1)%allowed.length]
  const fingerprints=new Set([...seen].map(id=>{try{return problemFingerprint(getProblem(id))}catch{return id}}))
  for(let offset=0;offset<10000;offset++){
    const candidate=generateProblem(family,entries.length+offset)
    // Opening the first method does not teach inversion of an affine argument.
    // Keep the beginner/refresh pool on u=x; advanced instances remain versioned
    // and testable but are not silently introduced as familiar-method practice.
    if (family !== 'G3' && (candidate.generation.parameters.m !== 1 || candidate.generation.parameters.phi !== '0')) continue
    if(!seen.has(candidate.id)&&!fingerprints.has(problemFingerprint(candidate)))return candidate
  }
  throw Error('Новые варианты этого набора закончились. Можно повторить прежний вариант.')
}
