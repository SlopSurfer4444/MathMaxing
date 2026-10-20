import test from 'node:test'
import assert from 'node:assert/strict'
import {generateProblem,generateSelectionExercise,problemFromGeneratedId} from './generators.mjs'
import {getProblem,nextProblem,publicProblem,problemFingerprint} from './problems.mjs'
import {convertLatexToMarkup} from 'mathlive/ssr'
const val=s=>{const [n,d=1]=s.split('/').map(Number);return n/d}
test('versioned generators reproduce complete materialized problems and reject unknown versions',()=>{
 for(const family of ['G1','G2','G3'])for(const seed of [0,1,42,4294967295]){
  const p=generateProblem(family,seed);assert.deepEqual(getProblem(p.id),p);assert.deepEqual(generateProblem(family,seed),p)
  assert.equal(p.generation.generatorVersion,1);assert.ok(p.roots.length>=1&&p.roots.length<=8)
 }
 assert.equal(problemFromGeneratedId('gen-v2-G1-1'),null)
 assert.throws(()=>getProblem('gen-v1-G1-4294967296'))
})
test('each generated root satisfies independently evaluated original equation and inclusive interval',()=>{
 for(const family of ['G1','G2','G3'])for(let seed=0;seed<300;seed++){
  const p=generateProblem(family,seed),v=p.generation.parameters
  for(const root of p.roots){
   const coefficient=val(root),x=coefficient*Math.PI
   assert.ok(coefficient>=val(p.generation.lower)-1e-12&&coefficient<=val(p.generation.upper)+1e-12)
   let residual
   if(family==='G1'){const u=v.m*x+val(v.phi)*Math.PI;residual=Math.sin(2*u)-v.a*Math[v.fn](u)}
   if(family==='G2'){const u=v.m*x+val(v.phi)*Math.PI;residual=Math.cos(2*u)-val(v.b)*Math.sin(u)-val(v.c)}
   if(family==='G3')residual=Math.sin(v.p*x+val(v.alpha)*Math.PI)-Math.sin(v.q*x+val(v.beta)*Math.PI)
   assert.ok(Math.abs(residual)<1e-10,`${p.id}: ${root}`)
  }
 }
})
test('public tasks leak neither family nor exact answer or method metadata',()=>{
 const p=generateProblem('G2',17),visible=publicProblem(p)
 assert.deepEqual(Object.keys(visible).sort(),['id','title','equation','interval','description','skills'].sort())
 assert.deepEqual(visible.skills,[]);assert.ok(!visible.title.includes('квадрат'))
 assert.equal(getProblem('double-angle-cos').roots.length,5)
})
test('next task avoids previous conditions and G4 preserves inclusive exact selection',()=>{
 const history=[];let work={problemId:'double-angle-cos'}
 for(let i=0;i<30;i++){const p=nextProblem(work,history);assert.ok(!history.some(w=>getProblem(w.problemId).equation===p.equation&&getProblem(w.problemId).interval===p.interval));work={problemId:p.id};history.push(work)}
 const exercise=generateSelectionExercise(44),p=generateSelectionExercise(44)
 assert.deepEqual(exercise.roots,p.roots);assert.deepEqual(exercise.series,p.series)
})

test('expert examples retain zero branch, discard out-of-range substitution, and accept alternate equal-sine solution',()=>{
 assert.deepEqual(generateProblem('G1',3).roots,['1/6','1/2','5/6'])
 assert.deepEqual(generateProblem('G2',41).roots,['-11/6','-7/6'])
 assert.deepEqual(generateProblem('G3',15).roots,['-1/3','0'])
 const first=nextProblem(null,[],['G1']);assert.equal(first.generation.family,'G1')
 assert.equal(nextProblem({problemId:first.id},[],['G1','G2']).generation.family,'G2')
})

test('G4 seed 5 explains independently computed parameter bounds and four roots in valid TeX',()=>{
 const exercise=generateSelectionExercise(5)
 assert.deepEqual(exercise.series,[{a:'-1/4',d:'1'},{a:'1/4',d:'1'}])
 assert.deepEqual(exercise.roots,['-5/4','-3/4','-1/4','1/4'])
 assert.deepEqual(exercise.selectionSteps.map(s=>({bounds:s.boundsMath,integers:s.integers,roots:s.roots})),[
  {bounds:String.raw`-\frac{17}{12}\le k\le \frac{7}{12}`,integers:[-1,0],roots:['-5/4','-1/4']},
  {bounds:String.raw`-\frac{23}{12}\le k\le \frac{1}{12}`,integers:[-1,0],roots:['-3/4','1/4']},
 ])
 assert.equal(exercise.selectionSteps[0].substitutionMath,String.raw`-\frac{\pi}{4}+\pi\cdot(-1)=-\frac{5\pi}{4}`)
 assert.ok(!exercise.math.includes(String.raw`\quadx`))
 assert.ok(!exercise.materialIds.includes('unit-circle'))
 const formulas=[exercise.math,...exercise.explanation.matchAll(/\$([^$]+)\$/g)].map(s=>typeof s==='string'?s:s[1])
 assert.ok(formulas.length>3)
 assert.ok(!exercise.explanation.replace(/\$[^$]+\$/g,'').includes('\\'))
 for(const formula of formulas)assert.ok(!convertLatexToMarkup(formula).includes('ML__error'),formula)
})

test('review seed 41 G2 discards sin(x)=2 and seed 35 G3 deduplicates nested series',()=>{
 const quadratic=generateProblem('G2',41)
 assert.deepEqual(quadratic.generation.parameters,{m:1,phi:'0',r:'1/2',s:'2',b:'-5',c:'3'})
 assert.deepEqual([quadratic.generation.lower,quadratic.generation.upper],['-13/6','-1/6'])
 assert.deepEqual(quadratic.roots,['-11/6','-7/6'])
 assert.equal(quadratic.series.length,2)
 const equalSines=generateProblem('G3',35)
 assert.deepEqual(equalSines.generation.parameters,{p:2,q:1,alpha:'-1/6',beta:'1/6'})
 assert.deepEqual([equalSines.generation.lower,equalSines.generation.upper],['1/6','7/6'])
 assert.deepEqual(equalSines.roots,['1/3','1'])
})

test('own-template identity removes redundant display syntax without merging different intervals or equations',()=>{
 const authored=getProblem('cos-double-sin'),generated=generateProblem('G2',5681)
 assert.notEqual(authored.equation,generated.equation)
 assert.equal(problemFingerprint(authored),problemFingerprint(generated))
 const shiftedInterval=structuredClone(generated);shiftedInterval.generation.lower='-1'
 assert.notEqual(problemFingerprint(authored),problemFingerprint(shiftedInterval))
 const otherEquation=structuredClone(generated);otherEquation.generation.parameters.c='1'
 // Keep the old roots deliberately: equation identity must not use their equality.
 assert.notEqual(problemFingerprint(generated),problemFingerprint(otherEquation))
 const equivalent={id:'test-own-template',generation:{family:'G3',parameters:{p:2,q:1,alpha:'0',beta:'1/2'},lower:'-1/2',upper:'3/2'}}
 assert.equal(problemFingerprint(getProblem('double-angle-cos')),problemFingerprint(equivalent))
 const history=[];let work={problemId:'double-angle-cos'}
 const seen=new Set([problemFingerprint(getProblem(work.problemId))])
 for(let i=0;i<30;i++){
  const p=nextProblem(work,history,['G1','G2','G3']),key=problemFingerprint(p)
  assert.ok(!seen.has(key),p.id);seen.add(key);work={problemId:p.id};history.push(work)
 }
})
