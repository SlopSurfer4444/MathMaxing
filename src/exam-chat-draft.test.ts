import test from 'node:test'
import assert from 'node:assert/strict'
import {readExamChatDraft,writeExamChatDraft} from './exam-chat-draft.ts'
import {captureExamQuote,examQuoteFieldDigest,locateExamQuote} from './exam-quote-selection.ts'
test('a question and two literal sources survive a reload as one draft',()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const draft={text:'Почему здесь так?',contexts:[{quote:'x=2',partId:'a',source:{workId:'w1',revision:3,field:'reasoning' as const,text:'Из равенства получаю x=2.'}},{quote:'Подобие по двум сторонам',partId:'b'}]}
  writeExamChatDraft(storage,'w1',draft)
  assert.deepEqual(readExamChatDraft(storage,'w1'),draft)
  assert.deepEqual(readExamChatDraft(storage,'w2'),{text:'',contexts:[]})
  writeExamChatDraft(storage,'w1',{text:'',contexts:[]})
  assert.equal(values.size,0)
})
test('legacy text is readable and a foreign source never becomes a navigation target',()=>{
  const storage={getItem:()=> 'Прежний вопрос',setItem(){},removeItem(){}}
  assert.equal(readExamChatDraft(storage,'w').text,'Прежний вопрос')
  storage.getItem=()=>JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'Цитата',source:{workId:'foreign',revision:1,field:'reasoning',text:'Чужой источник'}}]})
  assert.deepEqual(readExamChatDraft(storage,'w').contexts,[{quote:'Цитата'}])
})
test('source snapshots use a bounded allowlist on both read and write',()=>{
  let raw=''
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value},removeItem(){raw=''}}
  const source={workId:'w',revision:2,attemptId:'attempt-one',field:'answer' as const,partId:'a',text:'Сохранённая строка',extra:{arbitrary:'payload'}}
  raw=JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'строка',partId:'a',source,extra:'drop'}]})
  const clean={quote:'строка',partId:'a',source:{workId:'w',revision:2,field:'answer' as const,text:source.text,partId:'a',attemptId:'attempt-one'}}
  assert.deepEqual(readExamChatDraft(storage,'w').contexts,[clean])
  writeExamChatDraft(storage,'w',{text:'Вопрос',contexts:[{quote:'строка',partId:'a',source}]})
  assert.deepEqual(JSON.parse(raw).contexts,[clean])
  for(const invalid of [{partId:{}},{attemptId:[]},{partId:'a'.repeat(101)},{attemptId:'a'.repeat(101)},{revision:-1},{revision:2.5},{field:'current'},{text:'x'.repeat(4301)},{workId:'foreign'}]){
    raw=JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'строка',source:{...source,...invalid}}]})
    assert.deepEqual(readExamChatDraft(storage,'w').contexts,[{quote:'строка'}])
  }
})
test('oversized records are refused before parsing and malformed versioned records never become legacy text',()=>{
  let raw='x'.repeat(40001),calls=0
  const storage={getItem:()=>raw,setItem(){},removeItem(){}}
  const originalParse=JSON.parse
  try{
    JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{calls++;return originalParse(...args)}
    assert.deepEqual(readExamChatDraft(storage,'w'),{text:'',contexts:[]})
    assert.equal(calls,0)
  }finally{JSON.parse=originalParse}
  for(const invalid of ['{"version":1,"text":"broken', '{"version":2,"text":"future","contexts":[]}', '{"version":1,"text":42,"contexts":[]}', '[{"version":1}]']){
    raw=invalid
    assert.deepEqual(readExamChatDraft(storage,'w'),{text:'',contexts:[]})
  }
  for(const legacy of ['42','Почему 1/6?', '{x>0; y<2}']){
    raw=legacy
    assert.deepEqual(readExamChatDraft(storage,'w'),{text:legacy,contexts:[]})
  }
})
test('quote origin intent survives read and write only through its bounded allowlist',()=>{
  let raw=''
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value},removeItem(){raw=''}}
  const contexts=[
    {quote:'x=1',partId:'a',origin:'answer' as const},
    {quote:'x=1',partId:'a',origin:'reasoning' as const},
    {quote:'x=1',origin:'excerpt' as const},
    {quote:'legacy'},
  ]
  writeExamChatDraft(storage,'w',{text:'Вопрос',contexts})
  assert.deepEqual(JSON.parse(raw).contexts,contexts)
  assert.deepEqual(readExamChatDraft(storage,'w').contexts,contexts)
  for(const origin of ['current','answer'.repeat(1000),{},null]){
    raw=JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'x=1',origin}]})
    const draft=readExamChatDraft(storage,'w')
    assert.deepEqual(draft.contexts,[{quote:'x=1'}])
    writeExamChatDraft(storage,'w',{text:'Вопрос',contexts:[{quote:'x=1',origin} as never]})
    assert.deepEqual(JSON.parse(raw).contexts,[{quote:'x=1'}])
  }
})

test('an unsent second-occurrence citation and validated source survive reload without copying the field',async()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const field='Первое x>0. '+'a'.repeat(1000)+' Второе x>0.',start=field.lastIndexOf('x>0')
  const captured=captureExamQuote(field,start,start+3)!,selection={start:captured.start,end:captured.end,fieldDigest:await examQuoteFieldDigest(field)}
  const context={quote:captured.quote,partId:'a',origin:'reasoning' as const,selection,source:{workId:'w',revision:3,field:'reasoning' as const,text:'Второе x>0.',...selection}}
  writeExamChatDraft(storage,'w',{text:'Почему второй переход?',contexts:[context]})
  const restored=readExamChatDraft(storage,'w')
  assert.deepEqual(restored,{text:'Почему второй переход?',contexts:[context]})
  assert.deepEqual(await locateExamQuote(field,restored.contexts[0].quote,restored.contexts[0].source!),{start,end:start+3})
  assert.ok(values.get('exam.chat.w')!.length<1000)
  writeExamChatDraft(storage,'w',{text:'Шесть фрагментов',contexts:Array.from({length:7},()=>context)})
  assert.equal(readExamChatDraft(storage,'w').contexts.length,6)
})

test('malformed persisted ranges become excerpts and cannot be silently upgraded to legacy anchors',()=>{
  let raw=''
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value},removeItem(){}}
  for(const selection of [{start:-1,end:3,fieldDigest:'a'.repeat(64)},{start:0,end:80001,fieldDigest:'a'.repeat(64)},{start:0,end:3},{start:0,end:3,fieldDigest:'fake'},{start:2,end:2,fieldDigest:'a'.repeat(64)}]){
    raw=JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'x>0',origin:'reasoning',selection}]})
    assert.deepEqual(readExamChatDraft(storage,'w').contexts,[{quote:'x>0',origin:'excerpt'}])
  }
  raw=JSON.stringify({version:1,text:'Вопрос',contexts:[{quote:'x>0',source:{workId:'w',revision:1,field:'reasoning',text:'x>0',start:0,end:3,fieldDigest:'fake'}}]})
  assert.deepEqual(readExamChatDraft(storage,'w').contexts,[{quote:'x>0'}])
})
