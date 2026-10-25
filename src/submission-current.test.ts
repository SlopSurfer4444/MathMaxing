import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCurrentSubmission } from './submission-current.ts'
import type { Submission } from './api-types.ts'

test('a checked result applies only to the exact writing and both bound answers', () => {
  const document = { type:'doc', content:[{type:'paragraph', content:[{type:'text',text:'Мой способ'}]}] }
  const attempt = {document,finalAnswer:'750',generalAnswer:'x=1'} as Submission
  assert.equal(isCurrentSubmission(attempt,structuredClone(document),'750','x=1'),true)
  assert.equal(isCurrentSubmission(attempt,document,'75','x=1'),false)
  assert.equal(isCurrentSubmission(attempt,document,'750',''),false)
  assert.equal(isCurrentSubmission(attempt,{type:'doc',content:[]},'750','x=1'),false)
  assert.equal(isCurrentSubmission(undefined,document,'750','x=1'),false)
  assert.equal(attempt.document.content?.[0].content?.[0].text,'Мой способ')
})
