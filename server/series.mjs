import { parsePiTerm } from './root-checker.mjs'
import { normalizeSimpleFractions } from '../src/math-notation.ts'

// All values are coefficients of π. No floating point or expression evaluation.
const LIMIT = 10000n
const abs = n => n < 0n ? -n : n
const gcd = (a,b) => { a=abs(a);b=abs(b);while(b)[a,b]=[b,a%b];return a }
const lcm = (a,b) => a/gcd(a,b)*b
const rat = (n,d=1n) => {
  if(!d)throw new RangeError('Нулевой знаменатель')
  if(d<0n){n=-n;d=-d}
  const g=gcd(n,d);return [n/g,d/g]
}
const read = value => {
  if(typeof value!=='string'||!/^[-+]?\d{1,40}(\/\d{1,40})?$/.test(value))throw new RangeError('Ожидается рациональный коэффициент π')
  const [n,d='1']=value.split('/');return rat(BigInt(n),BigInt(d))
}
const key = ([n,d]) => d===1n?String(n):`${n}/${d}`
const add = (a,b) => rat(a[0]*b[1]+b[0]*a[1],a[1]*b[1])
const sub = (a,b) => add(a,[-b[0],b[1]])
const mul = (a,b) => rat(a[0]*b[0],a[1]*b[1])
const div = (a,b) => rat(a[0]*b[1],a[1]*b[0])
const cmp = (a,b) => {const n=a[0]*b[1]-b[0]*a[1];return n<0n?-1:n>0n?1:0}
const floor = ([n,d]) => n>=0n?n/d:-((-n+d-1n)/d)
const ceil = r => -floor([-r[0],r[1]])
const normalize = series => {
  if(!Array.isArray(series)||!series.length||series.length>50)throw new RangeError('Нужно от 1 до 50 серий')
  return series.map(({a,d})=>{
    const start=read(a),step=read(d)
    if(!step[0])throw new RangeError('Шаг серии не может быть нулевым')
    step[0]=abs(step[0])
    return {a:start,d:step}
  })
}

/** Enumerate inclusive interval roots. Bounds and results are rational π coefficients. */
export function enumerateSeries(series,lower,upper) {
  const normalized=normalize(series),lo=read(lower),hi=read(upper)
  if(cmp(lo,hi)>0)throw new RangeError('Границы отрезка перепутаны')
  const result=new Map()
  let budget=LIMIT
  for(const {a,d} of normalized){
    const first=ceil(div(sub(lo,a),d)),last=floor(div(sub(hi,a),d))
    const count=last>=first?last-first+1n:0n
    if(count>budget)throw new RangeError('Слишком много корней для точного перебора')
    budget-=count
    for(let k=first;k<=last;k++){
      const value=add(a,mul(d,[k,1n]));result.set(key(value),value)
    }
  }
  return [...result.values()].sort(cmp).map(key)
}

function terms(source){
  const result=[];let depth=0,start=0
  for(let i=0;i<source.length;i++){
    if(source[i]==='('||source[i]==='{')depth++
    if(source[i]===')'||source[i]==='}')depth--
    if(depth<0)throw Error('Проверьте скобки')
    if(depth===0&&i>start&&/[+-]/.test(source[i])){result.push(source.slice(start,i));start=i}
  }
  if(depth)throw Error('Проверьте скобки')
  result.push(source.slice(start));return result
}

function parseSeries(answer){
  if(typeof answer!=='string'||!answer.trim()||answer.length>4000)throw Error('Запишите серии корней')
  const rows=answer.replace(/[−–]/g,'-').split(/[;\n]/).map(s=>s.trim())
  if(rows.length>1&&/^[knm]\s*(?:∈\s*[Zℤ]|\\in\s*(?:Z|\\mathbb\{Z\}))$/.test(rows.at(-1)))rows.pop()
  if(rows.length>50||rows.some(s=>!s))throw Error('Разделяйте серии точкой с запятой')
  return rows.flatMap(row=>{
    let source=normalizeSimpleFractions(row).replace(/^x\s*=\s*/,'').replaceAll('\\pi','π').replaceAll('\\cdot','*').replace(/\s/g,'').replace(/\\(?:left|right)/g,'')
    // Parameter declarations are allowed only in these explicit integer forms.
    source=source.replace(/,([knm])(?:∈Z|∈ℤ|\\in\\mathbb\{Z\}|\\inZ)$/,'')
    // MathLive naturally puts the linear parameter in the numerator. Move only
    // a single multiplicative parameter out of a simple numeric fraction;
    // powers, sums and parameters in denominators stay outside this grammar.
    source=source.replace(/\\frac\{([^{}]+)\}\{(\d+)\}/g,(fraction,numerator,denominator)=>{
      if(!/^[+-]?(?:\d+\*?)?(?:π\*?[knm]|[knm]\*?π)$/.test(numerator))return fraction
      const variable=numerator.match(/[knm]/)[0]
      const coefficient=numerator.replace(new RegExp(`\\*?${variable}\\*?`),'')
      return `\\frac{${coefficient}}{${denominator}}${variable}`
    })
    let parityVariable=null
    source=source.replace(/\(-1\)\^(?:\{([knm])\}|([knm]))/g,(_,a,b)=>{
      if(parityVariable)throw Error('Поддерживается один знак (-1)^k')
      parityVariable=a??b;return '@'
    })
    let even=[0n,1n],odd=[0n,1n],step=null,variable=null
    for(const term of terms(source)){
      // Strip known LaTeX command letters before looking for a parameter.
      const bare=term.replace(/\\[A-Za-z]+/g,'')
      const variables=bare.match(/[knm]/g)??[]
      if(variables.length){
        if(variables.length!==1||step)throw Error('Ожидается одна линейная часть с целым параметром')
        variable=variables[0]
        const at=term.indexOf(variable)
        // A parameter inside a fraction or brackets is outside this narrow grammar.
        let depth=0
        for(let i=0;i<at;i++){if('({'.includes(term[i]))depth++;if(')}'.includes(term[i]))depth--}
        if(depth||term.includes('@')||term[at-1]==='/')throw Error('Запишите шаг в виде 2πk')
        const coefficient=term.replace(new RegExp(`(?:\\\\cdot|\\*)?${variable}`),'')
        step=read(parsePiTerm(coefficient))
      }else{
        const hasParity=term.includes('@')
        const positive=term.replace('@','(1)')
        const negative=term.replace('@','(-1)')
        even=add(even,read(parsePiTerm(positive)))
        odd=add(odd,read(parsePiTerm(hasParity?negative:positive)))
      }
    }
    if(!step||!step[0]||(parityVariable&&parityVariable!==variable))throw Error('Нужен ненулевой шаг и один целый параметр')
    if(parityVariable){
      const doubled=key(mul(step,[2n,1n]))
      return [{a:key(even),d:doubled},{a:key(add(odd,step)),d:doubled}]
    }
    return [{a:key(even),d:key(step)}]
  })
}

function residues(series,period){
  const result=new Set()
  let budget=LIMIT
  for(const {a,d} of series){
    const count=div(period,d)
    if(count[1]!==1n||count[0]>budget)throw Error('Период слишком велик для точного сравнения')
    budget-=count[0]
    for(let k=0n;k<count[0];k++){
      const value=add(a,mul(d,[k,1n]))
      const residue=sub(value,mul(period,[floor(div(value,period)),1n]))
      result.add(key(residue))
    }
  }
  return result
}

/** Exact equality of unions of arithmetic series; unsupported syntax is unknown. */
export function checkSeries(answer,expected){
  try{
    const found=normalize(parseSeries(answer)),wanted=normalize(expected)
    // Rational LCM: LCM of reduced numerators / GCD of denominators.
    const all=[...found,...wanted]
    let numerator=1n,denominator=all[0].d[1]
    for(const {d} of all){
      numerator=lcm(numerator,d[0]);denominator=gcd(denominator,d[1])
      if(numerator.toString().length>100)throw Error('Общий период слишком велик')
    }
    const period=rat(numerator,denominator)
    const left=residues(found,period),right=residues(wanted,period)
    const equal=left.size===right.size&&[...left].every(value=>right.has(value))
    return {status:equal?'correct':'incorrect',summary:equal
      ?'Серии задают полный набор корней. Это проверка ответа, а не доказательства.'
      :'Серии не совпадают с полным набором корней.'}
  }catch(error){
    return {status:'unknown',summary:`Не удалось точно сравнить серии: ${error.message}. Например: x=π/6+2πk; x=5π/6+2πn.`}
  }
}
