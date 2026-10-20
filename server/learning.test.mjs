import { test } from 'node:test'
import assert from 'node:assert/strict'
import { familiarFamilies, learningContext, initialLearningSession } from './learning.mjs'
import { learningEpisodes } from '../src/learning-content.ts'
import { nextProblem } from './problems.mjs'

test('opening or skipping a method does not silently add it to independent practice', () => {
  const session=initialLearningSession()
  session.progress.M2={step:0,answers:{},outcomes:{},attempts:{},skipped:true}
  assert.deepEqual(familiarFamilies(session),['G1'])
  const method=learningEpisodes.find(item=>item.id==='M2')
  session.progress.M2={step:method.checks.length+1,answers:{},outcomes:Object.fromEntries(method.checks.map(c=>[c.id,'correct'])),attempts:{}}
  assert.deepEqual(familiarFamilies(session),['G1','G2'])
  session.progress.M2.skipped=true
  assert.deepEqual(familiarFamilies(session),['G1','G2'])
})

test('beginner full variants vary without requiring untaught affine argument inversion', () => {
  const history=[]
  for(let i=0;i<15;i++){
    const problem=nextProblem(history.at(-1),history)
    assert.equal(problem.generation.parameters.m,1)
    assert.equal(problem.generation.parameters.phi,'0')
    history.push({problemId:problem.id})
  }
  assert.equal(new Set(history.map(w=>w.problemId)).size,15)
})

test('tutor receives the active authored explanation and current action, not only an opaque id', () => {
  const session=initialLearningSession()
  session.view='episode';session.episodeId='K1';session.progress.K1={step:1}
  const context=learningContext(session,[])
  assert.equal(context.activeEpisode.currentCheck.id,'K1-a-v2')
  assert.ok(context.activeEpisode.explanation.some(text=>text.includes('угол')))
  session.view='work'
  assert.equal(learningContext(session,[]).activeEpisode,null)
})
