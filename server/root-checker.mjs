import { normalizeSimpleFractions } from '../src/math-notation.ts'
// Narrow exact parser: rational multiples of pi and zero. No eval or executable input.
const gcd = (a,b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while(b) [a,b]=[b,a%b]; return a || 1n }
const rational = (n,d=1n) => { if(!d) throw Error('Деление на ноль'); if(d<0n){n=-n;d=-d} const g=gcd(n,d); return [n/g,d/g] }
const key = ([n,d]) => d===1n ? `${n}` : `${n}/${d}`

export function parsePiTerm(input) {
  let source = normalizeSimpleFractions(input).replaceAll('π','pi').replaceAll('\\pi','pi').replace(/[−–]/g,'-').replace(/\\(?:left|right|,|;|!|quad|cdot)/g, m=>m==='\\cdot'?'*':'').replace(/\s/g,'')
  if(source.length>200) throw Error('Слишком длинное выражение')
  // Normalize only well-formed simple TeX fractions, inside-out.
  for(let i=0;i<10 && source.includes('\\frac');i++) {
    const next = source.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,'(($1)/($2))')
    if(next===source) throw Error('Не удалось прочитать дробь'); source=next
  }
  source=source.replace(/[{}]/g,m=>m==='{'?'(':')')
  const tokens=source.match(/pi|\d+|[()+\-*/]/g)??[]
  if(tokens.join('')!==source || !tokens.length) throw Error('Используйте числа, π, дроби и точку с запятой между корнями')
  let pos=0,depth=0
  function atom(){if(++depth>30)throw Error('Слишком глубокие скобки');let v;const t=tokens[pos++];if(t==='+'||t==='-'){v=atom();if(t==='-')v={...v,r:[-v.r[0],v.r[1]]}}else if(t==='pi')v={r:[1n,1n],p:1};else if(/^\d+$/.test(t??'')){if(t.length>12)throw Error('Слишком большое число');v={r:[BigInt(t),1n],p:0}}else if(t==='('){v=add();if(tokens[pos++]!==')')throw Error('Проверьте скобки')}else throw Error('Незавершённое выражение');depth--;return v}
  function mul(){let a=atom();while(pos<tokens.length){let op=tokens[pos];if(op!=='*'&&op!=='/'&&!/^(pi|\d+|\()$/.test(op))break;if(op==='*'||op==='/')pos++;else op='*';const b=atom();a={r:op==='*'?rational(a.r[0]*b.r[0],a.r[1]*b.r[1]):rational(a.r[0]*b.r[1],a.r[1]*b.r[0]),p:op==='*'?a.p+b.p:a.p-b.p}}return a}
  function add(){let a=mul();while(tokens[pos]==='+'||tokens[pos]==='-'){const op=tokens[pos++],b=mul();if(a.r[0]===0n)a={r:a.r,p:b.p};if(b.r[0]!==0n && a.p!==b.p)throw Error('Ожидается число, кратное π');a={r:rational(a.r[0]*b.r[1]+(op==='+'?1n:-1n)*b.r[0]*a.r[1],a.r[1]*b.r[1]),p:a.p}}return a}
  const out=add();if(pos!==tokens.length)throw Error('В ответе остался непрочитанный фрагмент');if(out.r[0]===0n)return '0';if(out.p!==1)throw Error('В этом примере запишите ненулевые корни как дроби с π');return key(out.r)
}
export function formatRoot(k){ if(k==='0')return '0';if(k==='1')return 'π';if(k==='-1')return '-π';const [n,d]=k.split('/');return `${n==='1'?'':n==='-1'?'-':n}π${d?'/'+d:''}` }
export function checkRoots(answer, expected) {
  if(typeof answer!=='string'||!answer.trim())return {status:'unknown',summary:'Конечный ответ пока не указан. Рассуждение можно обсудить с наставником.'}
  if(answer.length>2000)return {status:'unknown',summary:'Слишком длинный ответ для проверки набора корней.'}
  try {
    let text=answer.trim().replace(/^x\s*(?:=|∈|\\in)\s*/,'').replace(/^\\left\\\{/,'{').replace(/\\right\\\}$/,'}')
    // Remove a set wrapper only when its opening brace matches the very last
    // brace. A trailing brace alone belongs to e.g. the denominator of \frac.
    if(text.startsWith('{')) {
      let depth=0,closing=-1
      for(let i=0;i<text.length;i++) {
        if(text[i]==='{')depth++
        else if(text[i]==='}'&&--depth===0){closing=i;break}
      }
      if(closing===text.length-1)text=text.slice(1,-1)
    }
    const terms=text.split(/[;,\n]/).map(s=>s.trim())
    if(terms.some(s=>!s)||terms.length>50)throw Error('Разделяйте корни точкой с запятой, без пустых значений')
    const found=new Set(terms.map(parsePiTerm)),wanted=new Set(expected)
    const missing=[...wanted].filter(x=>!found.has(x)).map(formatRoot),extra=[...found].filter(x=>!wanted.has(x)).map(formatRoot)
    return {status:missing.length||extra.length?'incorrect':'correct',summary:missing.length||extra.length?'Набор корней отличается от полного ответа.':'Набор корней совпадает с полным ответом на заданном отрезке. Это проверка ответа, не всех шагов доказательства.',missing,extra}
  }catch(e){return {status:'unknown',summary:`Не удалось однозначно прочитать ответ: ${e.message}. Например: -π; 0; π/3.`}}
}

export { checkSeries } from './series.mjs'
