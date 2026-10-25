import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentDraftExport } from './draft-export.ts'
import { freshNotebook } from './notebook-state.ts'
import type { Work } from './api-types.ts'

test('export contains visible unsaved document and both answers without mutating server base', () => {
  const notebook = freshNotebook()
  notebook.document = { type: 'doc', content: [{ type: 'paragraph', content: [{type:'text',text:'new reasoning'}] }] }
  const base = { id:'w', revision:4, document:{type:'doc',content:[]}, finalAnswer:'old b', generalAnswer:'old a' } as unknown as Work
  const exported = currentDraftExport(notebook, base, 'new b', 'new a')
  assert.equal(exported.work?.generalAnswer, 'new a')
  assert.equal(exported.work?.finalAnswer, 'new b')
  assert.deepEqual(exported.work?.document, notebook.document)
  assert.equal(exported.serverVersion?.generalAnswer, 'old a')
  assert.equal(base.finalAnswer, 'old b')
  assert.equal(exported.baseRevision, 4)
})
