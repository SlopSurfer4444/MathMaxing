import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store.mjs'
import { createPhotoRoutes, validatePhotoImages, validatePhotoLines, PHOTO_UPLOAD_BODY_LIMIT } from './photo.mjs'
import { createPhotoRecognizer, transcriptionInstruction } from './photo-provider.mjs'
import { makeApp } from './index.mjs'
import { inspectPhotoDimensions, pngHeaderCrc } from './photo-dimensions.mjs'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/k3sAAAAASUVORK5CYII=','base64')
const image={name:'solution.png',type:'image/png',data:png.toString('base64')}
// 1x1 JPEG generated locally by System.Drawing; 1x1 WebP static VP8 fixture.
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==','base64')
const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')
function paddedPng(size){const payload=Buffer.alloc(size-png.length-12),chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length);chunk.write('raNd',4);payload.copy(chunk,8);chunk.writeUInt32BE(pngHeaderCrc(chunk.subarray(4,-4)),chunk.length-4);return Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)])}
const line=(value='x=2',extra={})=>({kind:'math',value,uncertain:false,note:'',answer:null,...extra})
function fixture(options={}){
  const directory=mkdtempSync(join(tmpdir(),'pole-photo-')),store=new Store(':memory:'),work=store.current()
  const config={dbPath:':memory:',photoDir:directory,provider:'codex',...options.config}
  const checkWorkVersion=(work,b)=>{if(b.expectedRevision!==work.revision||b.expectedModeEpoch!==work.modeEpoch)throw Object.assign(Error('stale work'),{status:409})}
  const photos=createPhotoRoutes({config,store,checkWorkVersion,...options})
  const call=(action,body={},view=store)=>photos.route('POST',`/api/photo/${action}`,{workId:work.id,...body},view)
  const upload=()=>call('upload',{expectedRevision:0,expectedModeEpoch:0,images:[image]})
  return {store,work,config,photos,call,upload,directory,close(){photos.close();store.close();rmSync(directory,{recursive:true,force:true})}}
}
test('validates signatures, strict base64, formats and bounded file/count/total limits',()=>{
  assert.equal(validatePhotoImages([image])[0].size,png.length)
  for(const images of [[],[image,image,image,image],[{...image,type:'image/svg+xml'}],[{...image,data:'abc!'}],[{...image,type:'image/jpeg'}]])assert.throws(()=>validatePhotoImages(images))
  const big=paddedPng(10*1024*1024)
  assert.throws(()=>validatePhotoImages([{...image,data:Buffer.concat([big,Buffer.from([1])]).toString('base64')}]),/10 МБ/)
  assert.throws(()=>validatePhotoImages(Array(3).fill({...image,data:big.toString('base64')})),/25 МБ/)
  assert.ok(PHOTO_UPLOAD_BODY_LIMIT>25*1024*1024*4/3)
})
test('checks header dimensions, PNG IHDR CRC, zero sizes, truncation and 40MP bounds',()=>{
  assert.deepEqual(inspectPhotoDimensions(png,'image/png'),{width:1,height:1})
  const changed=(width,height)=>{const b=Buffer.from(png);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);b.writeUInt32BE(pngHeaderCrc(b.subarray(12,29)),29);return b}
  assert.deepEqual(inspectPhotoDimensions(changed(8000,5000),'image/png'),{width:8000,height:5000})
  for(const bytes of [png.subarray(0,20),png.subarray(0,-3),changed(0,10),Buffer.concat([png,Buffer.from([0])])])assert.throws(()=>inspectPhotoDimensions(bytes,'image/png'),{status:400})
  const badCrc=changed(1,1);badCrc[16]^=1;assert.throws(()=>inspectPhotoDimensions(badCrc,'image/png'),{status:400})
  assert.throws(()=>inspectPhotoDimensions(changed(8001,5000),'image/png'),{status:413})
  assert.throws(()=>inspectPhotoDimensions(changed(20001,1),'image/png'),{status:413})
})
test('recognition strips only matching literal answer labels and keeps wrong math untouched',()=>{
  const parsed=validatePhotoLines([line('а) 2+2=5',{answer:'a'}),line('b) 0;\\pi',{answer:'b'}),line('a) x=1',{answer:null}),line('b) x=2',{answer:'a'})],{fromModel:true})
  assert.deepEqual(parsed.map(l=>l.value),['2+2=5','0;\\pi','a) x=1','b) x=2'])
  assert.match(transcriptionInstruction,/не дублируй её в value/)
})
test('JPEG SOF and WebP VP8/VP8L/VP8X dimensions reject malformed/truncated headers',()=>{
  assert.deepEqual(inspectPhotoDimensions(jpeg,'image/jpeg'),{width:1,height:1})
  assert.deepEqual(inspectPhotoDimensions(webp,'image/webp'),{width:1,height:1})
  const huge=Buffer.from(jpeg),sof=huge.indexOf(Buffer.from([255,192]));assert.ok(sof>0);huge.writeUInt16BE(8001,sof+7);huge.writeUInt16BE(5000,sof+5)
  assert.throws(()=>inspectPhotoDimensions(huge,'image/jpeg'),{status:413})
  const badSegment=Buffer.from(jpeg);badSegment.writeUInt16BE(65535,4)
  for(const bytes of [jpeg.subarray(0,10),jpeg.subarray(0,-1),badSegment])assert.throws(()=>inspectPhotoDimensions(bytes,'image/jpeg'),{status:400})
  const extended=Buffer.alloc(webp.length+18);webp.copy(extended,0,0,12);extended.writeUInt32LE(extended.length-8,4);extended.write('VP8X',12);extended.writeUInt32LE(10,16);webp.copy(extended,30,12)
  assert.deepEqual(inspectPhotoDimensions(extended,'image/webp'),{width:1,height:1})
  const animated=Buffer.from(extended);animated[20]=2;assert.throws(()=>inspectPhotoDimensions(animated,'image/webp'),{status:400})
  const giantCanvas=Buffer.from(extended);giantCanvas.writeUIntLE(8000,24,3);giantCanvas.writeUIntLE(4999,27,3);assert.throws(()=>inspectPhotoDimensions(giantCanvas,'image/webp'),{status:413})
  const lossless=Buffer.alloc(26);lossless.write('RIFF');lossless.writeUInt32LE(18,4);lossless.write('WEBPVP8L',8);lossless.writeUInt32LE(6,16);lossless[20]=47
  assert.deepEqual(inspectPhotoDimensions(lossless,'image/webp'),{width:1,height:1})
  const badVersion=Buffer.from(lossless);badVersion[24]=0x20
  for(const bytes of [webp.subarray(0,20),webp.subarray(0,-1),badVersion])assert.throws(()=>inspectPhotoDimensions(bytes,'image/webp'),{status:400})
})
test('private originals persist by owner; another visitor cannot list/read/delete them',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload();assert.equal(readdirSync(f.directory).length,1)
    assert.equal(photo.images[0].file,undefined);assert.equal(photo.owner,undefined)
    assert.equal((await f.call('original',{photoId:photo.id,imageId:photo.images[0].id})).dataUrl,`data:image/png;base64,${image.data}`)
    const other=f.store.forVisitor(crypto.randomUUID())
    for(const action of ['list','original','remove'])await assert.rejects(f.call(action,{photoId:photo.id,imageId:photo.images[0].id,expectedPhotoRevision:0},other),{status:404})
    await f.call('remove',{photoId:photo.id,expectedPhotoRevision:0});assert.deepEqual(readdirSync(f.directory),[])
  }finally{f.close()}
})
test('recognition retains literal wrong math and suggested a/b; cannot confirm ambiguity unseen',async()=>{
  const f=fixture({recognize:async()=>({lines:[line('1+1=3',{uncertain:true,note:'Плохо виден знак',answer:'a'}),line('3',{answer:'b'})]})});try{
    let {photo}=await f.upload();({photo}=await f.call('recognize',{photoId:photo.id,expectedPhotoRevision:photo.revision}))
    assert.equal(photo.lines[0].value,'1+1=3');assert.equal(f.store.current().revision,0)
    await assert.rejects(f.call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,expectedRevision:0,expectedModeEpoch:0,confirmed:true,lines:photo.lines}),/неясные/)
    const {work}=await f.call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,expectedRevision:0,expectedModeEpoch:0,confirmed:true,lines:photo.lines.map(l=>({...l,checked:true}))})
    assert.equal(work.generalAnswer,'1+1=3');assert.equal(work.finalAnswer,'3');assert.equal(work.revision,1);assert.equal(work.submissions.length,0)
  }finally{f.close()}
})
test('correction replaces unchanged imported nodes after TipTap attr roundtrip; preserves other writing',async()=>{
  const f=fixture();try{
    let {photo}=await f.upload();let result=await f.call('confirm',{photoId:photo.id,expectedPhotoRevision:0,expectedRevision:0,expectedModeEpoch:0,confirmed:true,lines:[line('x=1',{answer:'a'}),line('1',{answer:'b'})]});photo=result.photo
    const work=f.store.current();work.document.content.push({type:'paragraph',attrs:{id:'own'},content:[{type:'text',text:'Мой метод'}]});for(const node of work.document.content)if(node.type==='mathBlock')node.attrs={photoSource:null,latex:node.attrs.latex,answerParts:node.attrs.answerParts,id:node.attrs.id};work.revision++;f.store.put(work)
    result=await f.call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,expectedRevision:2,expectedModeEpoch:0,confirmed:true,lines:photo.lines.map(l=>({...l,value:l.answer==='b'?'2':'x=2'}))})
    assert.equal(result.work.finalAnswer,'2');assert.equal(result.work.document.content.filter(n=>n.type==='mathBlock').length,2);assert.ok(JSON.stringify(result.work.document).includes('Мой метод'))
  }finally{f.close()}
})
test('concurrent notebook edit and stale photo edit are fenced without replacing text',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload();await f.call('save',{photoId:photo.id,expectedPhotoRevision:0,lines:[line('1+1=3')]})
    await assert.rejects(f.call('save',{photoId:photo.id,expectedPhotoRevision:0,lines:[line('wrong replacement')]}),{status:409})
    const work=f.store.current();work.revision++;f.store.put(work)
    await assert.rejects(f.call('confirm',{photoId:photo.id,expectedPhotoRevision:1,expectedRevision:0,expectedModeEpoch:0,confirmed:true,lines:[line('replacement')]}),{status:409})
    assert.equal((await f.call('list')).photo.lines[0].value,'1+1=3')
  }finally{f.close()}
})
test('lost confirmation acknowledgement replays same action without duplicate lines',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload(),body={photoId:photo.id,expectedPhotoRevision:0,expectedRevision:0,expectedModeEpoch:0,confirmed:true,requestId:'stable-action',lines:[line('1',{answer:'b'})]}
    const first=await f.call('confirm',body),again=await f.call('confirm',body)
    assert.equal(again.work.revision,first.work.revision);assert.equal(again.work.document.content.length,first.work.document.content.length)
    await assert.rejects(f.call('confirm',{...body,lines:[line('2',{answer:'b'})]}),{status:409})
  }finally{f.close()}
})
test('late OCR cannot overwrite a saved manual correction even if provider ignores abort',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r)
  const f=fixture({recognize:async()=>pending});try{
    const {photo}=await f.upload(),recognition=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0})
    const during=(await f.call('list')).photo
    await f.call('save',{photoId:photo.id,expectedPhotoRevision:during.revision,lines:[line('Мой исправленный знак')]})
    resolve({lines:[line('late wrong text')]});await assert.rejects(recognition,/Позднее/)
    assert.equal((await f.call('list')).photo.lines[0].value,'Мой исправленный знак')
  }finally{f.close()}
})
test('OCR has one global in-flight slot across works, including cancellation until upstream settles',async()=>{
  let resolve,calls=0;const pending=new Promise(r=>resolve=r)
  const f=fixture({recognize:async()=>{calls++;return pending}});try{
    const {photo}=await f.upload(),secondWork=f.store.create('double-angle-cos','guided')
    const second=(await f.call('upload',{workId:secondWork.id,expectedRevision:0,expectedModeEpoch:0,images:[image]})).photo
    const running=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0})
    const another=()=>f.call('recognize',{workId:secondWork.id,photoId:second.id,expectedPhotoRevision:0})
    await assert.rejects(another(),{status:429});assert.equal(calls,1)
    await f.call('save',{photoId:photo.id,expectedPhotoRevision:1,lines:[line('manual')]})
    await assert.rejects(another(),{status:429});assert.equal(calls,1)
    resolve({lines:[line('2+2=5')]});await assert.rejects(running,{status:409})
    assert.equal((await another()).photo.status,'ready');assert.equal(calls,2)
  }finally{f.close()}
})
test('provider failure keeps originals and manual transcription available, without fake result',async()=>{
  const f=fixture();try{const {photo}=await f.upload();await assert.rejects(f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0}),{status:503});const current=(await f.call('list')).photo;assert.equal(current.status,'failed');assert.equal(readdirSync(f.directory).length,1);assert.equal(f.store.current().submissions.length,0)}finally{f.close()}
})
test('recognizer uses Responses images and shared persistent budget; rejects malformed upstream',async()=>{
  const store=new Store(':memory:');try{
    let payload;const config={provider:'openai',apiKey:'test-only',model:'vision-test',modelRequestsPerDay:1,timeoutMs:1000}
    const recognize=createPhotoRecognizer({config,db:store.db,fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({lines:[line('1+1=3')]})}]}]}))}})
    assert.equal((await recognize([image])).lines[0].value,'1+1=3');assert.ok(payload.input[0].content[1].image_url.startsWith('data:image/png;base64,'));assert.equal(payload.store,false);assert.deepEqual(payload.tools,[]);assert.ok(transcriptionInstruction.includes('Не исправляй'))
    await assert.rejects(recognize([image]),{status:429})
    const bad=createPhotoRecognizer({config:{...config,modelRequestsPerDay:3},db:store.db,fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{type:'function_call'}]}))});await assert.rejects(bad([image]),/незавершённое/)
  }finally{store.close()}
})
test('HTTP uploads above ordinary JSON limit work only on protected upload route',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'pole-photo-http-')),store=new Store(':memory:')
  const config={dbPath:':memory:',photoDir:directory,hosted:false,provider:'codex',origins:['http://127.0.0.1:5173'],maxBodyBytes:1024,maxHttpConcurrent:12,requestsPerMinute:240,maxVisitors:50}
  const app=makeApp({config,store,tutor:{status:async()=>({connected:false}),close:async()=>{}}})
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`,work=store.current()
  const larger=paddedPng(1800)
  const body={workId:work.id,expectedRevision:0,expectedModeEpoch:0,images:[{...image,data:larger.toString('base64')}]}
  try{
    const headers={'Content-Type':'application/json','X-Pole-Client':'notebook-v1',Origin:'http://127.0.0.1:5173'}
    assert.equal((await fetch(`${base}/api/photo/upload`,{method:'POST',headers,body:JSON.stringify(body)})).status,200)
    assert.equal((await fetch(`${base}/api/work/save`,{method:'POST',headers,body:JSON.stringify(body)})).status,413)
    assert.equal((await fetch(`${base}/api/photo/list`,{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:JSON.stringify({workId:work.id})})).status,403)
  }finally{await app.close();rmSync(directory,{recursive:true,force:true})}
})
