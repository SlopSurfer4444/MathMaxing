import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSeries,enumerateSeries } from './series.mjs'

const sine=[{a:'1/6',d:'2'},{a:'5/6',d:'2'}]
test('series equality ignores parameter names, shifts, order and duplicate branches',()=>{
  for(const answer of ['x=π/6+2πk; x=5π/6+2πn','5π/6-2πm;13π/6+2πk','π/6+2πk;5π/6+2πk;π/6+2πk']){
    assert.equal(checkSeries(answer,sine).status,'correct',answer)
  }
  assert.equal(checkSeries('π/6+2πk',sine).status,'incorrect')
  assert.equal(checkSeries('π/6+πk',sine).status,'incorrect')
  assert.equal(checkSeries('\\frac{\\pi}6+2πk;\\frac{5\\pi}6+2πn',sine).status,'correct')
})
test('splitting and merging arithmetic progressions are compared exactly',()=>{
  assert.equal(checkSeries('2πk;π+2πk',[{a:'0',d:'1'}]).status,'correct')
  assert.equal(checkSeries('πk/3',[{a:'0',d:'1/3'}]).status,'correct')
  assert.equal(checkSeries('π/6+2πk;5π/6+2πk;π+2πk',sine).status,'incorrect')
})
test('alternating parameter expression expands even and odd branches',()=>{
  for(const answer of ['(-1)^kπ/6+πk',String.raw`x=(-1)^{n}\frac{\pi}{6}+\pi n,n\in\mathbb{Z}`]){
    assert.equal(checkSeries(answer,sine).status,'correct',answer)
  }
  assert.equal(checkSeries('(-1)^kπ/6+πn',sine).status,'unknown')
  assert.equal(checkSeries('(-1)^k5π/6+πk',sine).status,'correct')
  assert.equal(checkSeries('(-1)^k5π/6+πk',[{a:'1/6',d:'2'},{a:'1/2',d:'2'}]).status,'incorrect')
})
test('unsupported, malformed and adversarial expressions never pass',()=>{
  for(const answer of ['', 'π/6', 'π/6+0πk', 'π/6+2πk;', 'π/k', 'πk^2', 'π/(k+1)', 'πk+πn', 'πk,hello','process.exit()', 'π/0+πk']){
    assert.equal(checkSeries(answer,sine).status,'unknown',answer)
  }
  assert.equal(checkSeries('πk',[{a:'0',d:'999999999999'}]).status,'unknown')
})
test('enumeration includes both bounds, handles negatives, deduplicates and sorts exactly',()=>{
  assert.deepEqual(enumerateSeries(sine,'-2','2'),['-11/6','-7/6','1/6','5/6'])
  assert.deepEqual(enumerateSeries([{a:'0',d:'-1/3'},{a:'1/3',d:'2/3'}],'-1','1'),['-1','-2/3','-1/3','0','1/3','2/3','1'])
  assert.deepEqual(enumerateSeries(sine,'1/6','1/6'),['1/6'])
  assert.deepEqual(enumerateSeries(sine,'1/7','1/7'),[])
  assert.deepEqual(enumerateSeries([{a:'0',d:'1/3'}],'100000000000000000000/3','100000000000000000001/3'),['100000000000000000000/3','100000000000000000001/3'])
})
test('enumeration fails explicitly on invalid bounds and excessive cardinality',()=>{
  for(const args of [[sine,'2','-2'],[[{a:'0',d:'0'}],'0','1'],[[{a:'0',d:'1/100000'}],'0','1']]){
    assert.throws(()=>enumerateSeries(...args),RangeError)
  }
})

test('general series for a double-angle problem equal the different-argument representation',()=>{
 const expected=[{a:'0',d:'1'},{a:'1/3',d:'2'},{a:'-1/3',d:'2'}]
 assert.equal(checkSeries('2πk; π/3+2πk/3',expected).status,'correct')
 assert.equal(checkSeries('π/3+2πk; -π/3+2πk',expected).status,'incorrect')
})

test('standalone final integer declaration is accepted but arbitrary trailing text is not',()=>{
 assert.equal(checkSeries('π/6+2πk;5π/6+2πk; k ∈ ℤ',sine).status,'correct')
 assert.equal(checkSeries('π/6+2πk;5π/6+2πk; k ∈ R',sine).status,'unknown')
})

test('linear MathLive numerator parameters equal the same fractional period outside the fraction',()=>{
 const expected=[{a:'1/2',d:'1'},{a:'1/6',d:'2'},{a:'5/6',d:'2'}]
 for(const period of [String.raw`\frac{2\pi k}{3}`,String.raw`\frac{2\pi}{3}k`,String.raw`\frac{2k\pi}{3}`,String.raw`\dfrac{2\pi\cdot k}{3}`]){
  assert.equal(checkSeries(`π/6+${period};π/2+2πn`,expected).status,'correct',period)
 }
 for(const period of [String.raw`\frac{\pi}{k}`,String.raw`\frac{2\pi k^2}{3}`,String.raw`\frac{2\pi k}{3k}`,String.raw`\frac{2\pi k}{0}`,String.raw`\frac{2\pi(k+1)}{3}`,String.raw`\frac{2\pi kn}{3}`]){
  assert.equal(checkSeries(`π/6+${period};π/2+2πn`,expected).status,'unknown',period)
 }
})
