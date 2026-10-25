import assert from 'node:assert/strict'
import test from 'node:test'
import { workPackage } from './work-package.ts'

test('generated scalar work absent from catalogue does not become trigonometry', () => {
  assert.equal(workPackage({problemId:'generated-percent-unknown',packageId:'percentages',kind:'numeric'}, []), 'percentages')
  assert.equal(workPackage({problemId:'generated-graph-unknown',packageId:'graphs',kind:'numeric'}, []), 'graphs')
  assert.equal(workPackage({problemId:'generated-percent-unknown',kind:'numeric'}, []), 'percentages')
  assert.equal(workPackage({problemId:'unknown'}, []), null)
})

test('explicit work metadata wins and legacy trig catalogue stays navigable', () => {
  assert.equal(workPackage({problemId:'old-trig'}, [{id:'old-trig'}]), 'trigonometry')
  assert.equal(workPackage({problemId:'generated-trig',kind:'trig'}, []), 'trigonometry')
  assert.equal(workPackage({problemId:'same',packageId:'graphs',kind:'numeric'}, [{id:'same',packageId:'percentages'}]), 'graphs')
  assert.equal(workPackage({problemId:'interval',kind:'interval'}, []), 'inequalities')
})
