import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRoots,parsePiTerm } from './root-checker.mjs'
test('exact equivalent rational pi forms are accepted',()=>{
  for(const text of ['π/3','2*pi/6','\\frac{\\pi}{3}','(pi+pi)/6','π/3+0'])assert.equal(parsePiTerm(text),'1/3')
  assert.equal(parsePiTerm('-\\frac{3\\pi}{2}'),'-3/2')
  assert.equal(parsePiTerm('0'),'0')
})
test('full solution set is distinct from valid but incomplete roots',()=>{
  const expected=['-1','-1/3','0','1/3','1']
  assert.equal(checkRoots('-π; -π/3; 0; π/3; π',expected).status,'correct')
  assert.equal(checkRoots('π; 0; -π; -2*pi/6; 2*pi/6; 0',expected).status,'correct')
  const wrong=checkRoots('-π;0;π',expected);assert.equal(wrong.status,'incorrect');assert.deepEqual(wrong.missing,['-π/3','π/3'])
  assert.deepEqual(checkRoots('0;2pi',expected).extra,['2π'])
})
test('unsupported notation, zero division and unread tails never pass',()=>{
  for(const text of ['π/0','1','π;','π blah','process.exit()','1.2π','π+1','\\frac{π}{','(','','π^2'])assert.equal(checkRoots(text,['1']).status,'unknown',text)
})
test('last TeX fraction keeps its denominator brace with or without a set wrapper',()=>{
  const roots=String.raw`-\frac{\pi}{2};\frac{\pi}{6};\frac{\pi}{2};\frac{5\pi}{6};\frac{3\pi}{2}`
  const expected=['-1/2','1/6','1/2','5/6','3/2']
  for(const text of [roots,`{${roots}}`,String.raw`x \in \left\{${roots}\right\}`,`x = {${roots}}`])
    assert.equal(checkRoots(text,expected).status,'correct',text)
  assert.equal(checkRoots(String.raw`\frac{\pi}{3}`,['1/3']).status,'correct')
  assert.equal(checkRoots('{π};{π/3}',['1','1/3']).status,'correct')
})
test('unbalanced braces cannot become a correct root set by wrapper stripping',()=>{
  for(const text of [String.raw`\frac{\pi}{3`,String.raw`\frac{\pi}{3}}`,'{π','π}','{π;π/3','π;π/3}',String.raw`\left\{π`,String.raw`π\right\}`])
    assert.equal(checkRoots(text,['1','1/3']).status,'unknown',text)
})
