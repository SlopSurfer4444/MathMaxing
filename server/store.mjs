import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { blankDocument, getProblem } from './problems.mjs'
import { initialLearningSession } from './learning.mjs'
// Ten weekly 20-task variants leave room for ordinary practice. The unchanged
// byte budget still bounds large records; neither cap evicts historical evidence.
export const PROFILE_LIMITS=Object.freeze({works:1000,workBytes:1000000,bytes:10000000,editReserveBytes:2000000,warningBytes:8000000})
const fail=(message,status=429)=>Object.assign(Error(message),{status})
export class Store {
  constructor(path=resolve('.runtime/pole.sqlite')) {
    if(path!==':memory:')mkdirSync(resolve(path,'..'),{recursive:true})
    this.db=new DatabaseSync(path)
    this.owner='local'
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    // Existing rows belong exclusively to the original local notebook.
    for(const table of ['works','evidence'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='owner'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'`)
    if(!this.db.prepare('PRAGMA table_info(works)').all().some(column=>column.name==='pending_recovery')){
      this.db.exec(`ALTER TABLE works ADD COLUMN pending_recovery INTEGER NOT NULL DEFAULT 0;
        UPDATE works SET pending_recovery=1 WHERE EXISTS (SELECT 1 FROM json_tree(works.data) WHERE key IN ('status','reviewStatus') AND value='pending')`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS works_pending_recovery ON works(pending_recovery);
      CREATE INDEX IF NOT EXISTS works_owner ON works(owner); CREATE INDEX IF NOT EXISTS evidence_owner ON evidence(owner);
      CREATE TABLE IF NOT EXISTS learning_event_archive (key TEXT PRIMARY KEY,owner TEXT NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS learning_archive_owner ON learning_event_archive(owner);
      CREATE INDEX IF NOT EXISTS works_owner_problem ON works(owner,json_extract(data,'$.problemId'))`)
    // Only interrupted jobs are deserialized. Ordinary historical JSON stays on disk.
    for(;;){const rows=this.db.prepare('SELECT owner,data FROM works WHERE pending_recovery=1 LIMIT 100').all();if(!rows.length)break
    for(const row of rows) {
      const work=JSON.parse(row.data);let changed=false
      if(work.preparation&&!work.preparation.id){work.preparation.id=crypto.randomUUID();changed=true}
      for(const preparation of [work.preparation,...(work.preparationHistory??[])])if(preparation&&(!Number.isSafeInteger(preparation.revision)||preparation.revision<0)){preparation.revision=0;changed=true}
      work.messages=work.messages.map(m=>{if(m.status==='pending'){changed=true;return {...m,status:'failed',error:'Запрос прерван перезапуском сервера. Автоматического повтора не было.'}}return m})
      for(const submission of work.submissions){if(submission.reviewStatus==='pending'){changed=true;submission.reviewStatus='failed';submission.reviewVersion=(submission.reviewVersion??0)+1;submission.reviewError='Разбор прерван перезапуском сервера. Автоматического повтора не было.'}}
      for(const submission of work.submissions)for(const finding of submission.findings??[])for(const objection of finding.objections??[])if(objection.status==='pending'){
        changed=true;objection.status='failed';objection.error='Пересмотр прерван перезапуском сервера. Отправь возражение снова.';submission.reviewVersion=(submission.reviewVersion??0)+1
      }
      this.db.prepare('UPDATE works SET data=?,pending_recovery=0 WHERE id=? AND owner=?').run(changed?JSON.stringify(work):row.data,work.id,row.owner)
    }}
  }
  // Views share one connection and have no lifecycle, cache or file of their own.
  forVisitor(owner){if(!/^(local|[a-f0-9-]{36})$/.test(owner))throw Error('Invalid visitor scope');const view=Object.create(Store.prototype);view.db=this.db;view.owner=owner;return view}
  key(key){return this.owner==='local'?key:`visitor:${this.owner}:${key}`}
  setting(key){return this.db.prepare('SELECT value FROM settings WHERE key=?').get(this.key(key))?.value}
  setSetting(key,value){
    if(this.owner!=='local'){
      const previous=this.setting(key),delta=Buffer.byteLength(String(value??''))-Buffer.byteLength(String(previous??''))
      if(delta>0&&this.profileBudget().bytes+delta>PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes)throw fail('Резерв сохранения заполнен. Сохрани полный архив; прежние записи сохранены.')
    }
    this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(this.key(key),value)
  }
  get(id){const row=this.db.prepare('SELECT data FROM works WHERE id=? AND owner=?').get(id,this.owner);if(!row)throw Object.assign(Error('Работа не найдена'),{status:404});const work=JSON.parse(row.data);let changed=false;if(work.preparation&&!work.preparation.id){work.preparation.id=crypto.randomUUID();changed=true}for(const preparation of [work.preparation,...(work.preparationHistory??[])])if(preparation&&(!Number.isSafeInteger(preparation.revision)||preparation.revision<0)){preparation.revision=0;changed=true}if(changed)this.put(work);return work}
  transaction(callback){
    const name=`store_${crypto.randomUUID().replaceAll('-','')}`
    this.db.exec(`SAVEPOINT ${name}`)
    try{const result=callback();this.db.exec(`RELEASE ${name}`);return result}catch(error){this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);throw error}
  }
  profileBudget(){
    let bytes=0,count=0
    for(const table of this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name IN ('works','evidence','learning_event_archive','photo_inputs') OR name LIKE 'exam_%')").all()){
      if(!/^[a-z_]+$/.test(table.name))continue
      const columns=this.db.prepare(`PRAGMA table_info(${table.name})`).all().map(c=>c.name)
      if(!columns.includes('owner'))continue
      const payload=columns.includes('data')?'length(CAST(data AS BLOB))':columns.includes('value')?'length(CAST(value AS BLOB))':columns.filter(c=>c!=='owner').map(c=>`length(CAST(${c} AS BLOB))`).join('+')||'0'
      const total=this.db.prepare(`SELECT COALESCE(SUM(${payload}),0) AS bytes,COUNT(*) AS count FROM ${table.name} WHERE owner=?`).get(this.owner)
      bytes+=total.bytes;if(['works','exam_works'].includes(table.name))count+=total.count
    }
    const prefix=this.owner==='local'?'visitor:':this.key('')
    const settings=this.owner==='local'?this.db.prepare("SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM settings WHERE key NOT LIKE 'visitor:%'").get():this.db.prepare('SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM settings WHERE substr(key,1,?)=?').get(prefix.length,prefix)
    bytes+=settings.bytes
    const warning=bytes>=PROFILE_LIMITS.warningBytes||count>=Math.ceil(PROFILE_LIMITS.works*.9)
    return {bytes,count,limits:PROFILE_LIMITS,warning,full:bytes>=PROFILE_LIMITS.bytes||count>=PROFILE_LIMITS.works,archiveRecommended:warning}
  }
  assertCanStore(extraBytes=0){if(!Number.isFinite(extraBytes))throw fail('Неверный размер записи',400);const budget=this.profileBudget();if(extraBytes>0&&budget.bytes+extraBytes>PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes)throw fail('Резерв сохранения заполнен. Сохрани полный архив; прежние записи сохранены.');return budget}
  assertCanCreate(extraBytes=0){const budget=this.profileBudget();if(budget.count>=PROFILE_LIMITS.works||budget.bytes+extraBytes>PROFILE_LIMITS.bytes)throw fail('Место профиля заполнено. Сохрани полный архив перед созданием новых работ. Существующие записи сохранены.');return budget}
  put(work){
    const existing=this.db.prepare('SELECT owner,data FROM works WHERE id=?').get(work.id)
    if(existing&&existing.owner!==this.owner)throw fail('Работа не найдена',404)
    const updated={...work,updatedAt:new Date().toISOString()},data=JSON.stringify(updated)
    if(this.owner!=='local'){
      if(Buffer.byteLength(data)>PROFILE_LIMITS.workBytes)throw fail('Запись слишком велика. Последняя сохранённая версия осталась в профиле.')
      const budget=this.profileBudget(),delta=Buffer.byteLength(data)-(existing?Buffer.byteLength(existing.data):0)
      if(!existing)this.assertCanCreate(Buffer.byteLength(data))
      else if(delta>0&&budget.bytes+delta>PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes)throw fail('Резерв сохранения заполнен. Сохрани полный архив; последняя версия записи остаётся доступна.')
    }
    this.db.prepare('INSERT OR REPLACE INTO works(id,data,owner,pending_recovery) VALUES (?,?,?,?)').run(work.id,data,this.owner,Number((work.messages??[]).some(message=>message.status==='pending')||(work.submissions??[]).some(submission=>submission.reviewStatus==='pending'||(submission.findings??[]).some(finding=>(finding.objections??[]).some(objection=>objection.status==='pending')))));Object.assign(work,updated);return work
  }
  current(){const id=this.setting('current');return id?this.get(id):this.create('double-angle-cos','guided')}
  listPage({limit=50,offset=0}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw fail('Неверная страница истории',400)
    return this.summaries(' LIMIT ? OFFSET ?',[limit,offset])
  }
  summaries(suffix='',args=[]){return this.db.prepare(`SELECT id,json_extract(data,'$.problemId') AS problemId,json_extract(data,'$.mode') AS mode,json_extract(data,'$.updatedAt') AS updatedAt,json_extract(data,'$.packageId') AS packageId,json_extract(data,'$.kind') AS kind FROM works WHERE owner=? ORDER BY rowid DESC${suffix}`).all(this.owner,...args).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null?undefined:value])))}
  // Internal legacy routes require complete exposure history. Public history uses listPage.
  list(){return this.summaries()}
  open(id){const work=this.get(id);this.setSetting('current',id);return work}
  create(problemId,mode,frozenProblem){
    if(frozenProblem&&frozenProblem.id!==problemId)throw Error('Frozen problem identity mismatch')
    const problem=structuredClone(frozenProblem??getProblem(problemId)),now=new Date().toISOString()
    const priorExposure=Boolean(this.db.prepare("SELECT 1 FROM works WHERE owner=? AND json_extract(data,'$.problemId')=? LIMIT 1").get(this.owner,problemId))
    const work={id:crypto.randomUUID(),problemId,packageId:problem.packageId??'trigonometry',kind:problem.kind??'trig',contentVersion:problem.contentVersion??1,mode,modeEpoch:0,revision:0,document:blankDocument(),finalAnswer:'',messages:[],submissions:[],createdAt:now,updatedAt:now,priorExposure}
    return this.transaction(()=>{if(this.owner!=='local')this.assertCanCreate(Buffer.byteLength(JSON.stringify(problem))+Buffer.byteLength(JSON.stringify(work))+Math.max(0,36-Buffer.byteLength(this.setting('current')??'')));this.put(work);this.setSetting(`problem-instance:${work.id}`,JSON.stringify(problem));this.setSetting('current',work.id);return work})
  }
  problem(work){const saved=this.get(work.id);const value=this.setting(`problem-instance:${saved.id}`);if(value)return JSON.parse(value);return getProblem(saved.problemId)}
  memory(){return this.db.prepare('SELECT data FROM evidence WHERE owner=? ORDER BY rowid DESC LIMIT 30').all(this.owner).map(r=>JSON.parse(r.data))}
  learning(){const value=this.setting('learning');if(value){const session=JSON.parse(value);if(!Number.isSafeInteger(session.revision)||session.revision<0){session.revision=0;this.setSetting('learning',JSON.stringify(session))}return session}const session=initialLearningSession();this.setSetting('learning',JSON.stringify(session));return session}
  learningEvidence(){return this.db.prepare('SELECT value FROM settings WHERE key LIKE ? ORDER BY rowid DESC LIMIT 60').all(`${this.key('learning-event:')}%`).map(row=>JSON.parse(row.value))}
  trimLearning(){if(this.owner!=='local')this.transaction(()=>{
    const rows=this.db.prepare('SELECT key,value FROM settings WHERE key LIKE ? ORDER BY rowid DESC LIMIT -1 OFFSET 300').all(`${this.key('learning-event:')}%`)
    for(const row of rows){this.db.prepare('INSERT OR IGNORE INTO learning_event_archive(key,owner,value) VALUES(?,?,?)').run(row.key,this.owner,row.value);this.db.prepare('DELETE FROM settings WHERE key=?').run(row.key)}
  })}
  learningChecked(event){this.get(event.workId);const saved={...event,id:crypto.randomUUID(),createdAt:new Date().toISOString(),source:'deterministic_check'};this.setSetting(`learning-event:${saved.id}`,JSON.stringify(saved));this.trimLearning();return saved}
  putLearning(session,previous,workId){
    this.get(workId)
    const changed=Object.keys(session.progress).filter(id=>JSON.stringify(session.progress[id])!==JSON.stringify(previous.progress[id]))
    const event={id:crypto.randomUUID(),createdAt:session.updatedAt,workId,entry:session.entry,episodeId:session.episodeId,view:session.view,changedEpisodes:changed,source:'client_reported',kind:'learning_activity',summary:'Сохранены действия в учебном маршруте; освоение навыка не установлено.'}
    this.db.exec('BEGIN')
    try{
      this.setSetting('learning',JSON.stringify(session))
      this.setSetting(`learning-event:${event.id}`,JSON.stringify(event));this.trimLearning()
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
    return session
  }
  evidence(submission,work){const preparationCount=work.preparationHistory?.length??0;const independent=!work.numericHelpSeen&&!preparationCount&&submission.mode==='solo'&&submission.helpCount===0&&!work.priorExposure;const numeric=['numeric','interval'].includes(this.problem(work).kind);const outcome=submission.result.status==='correct'?(numeric?'Ответ верен':'Конечный набор корней верен'):submission.result.status==='incorrect'?(numeric?'Ответ не совпал':'В конечном наборе корней есть расхождение'):'Конечный ответ не подтверждён';const event={id:submission.id,submissionId:submission.id,problemId:work.problemId,createdAt:submission.createdAt,independent,summary:`${outcome}. ${work.numericHelpSeen?'В этой работе открывалось объяснение':preparationCount?`В этой работе открывалась подготовка: ${preparationCount} упражн.`:independent?'Новая задача, подсказки в этой попытке не открывались':submission.helpCount?'В этой работе предоставлялась помощь':work.priorExposure?'Задача уже открывалась ранее':'Попытка в режиме с наставником'}. Шаги решения отдельно автоматически не доказаны.`};this.get(work.id);const previous=this.db.prepare('SELECT owner,data FROM evidence WHERE id=?').get(event.id);if(previous&&previous.owner!==this.owner)throw fail('Наблюдение не найдено',404);if(this.owner!=='local')this.assertCanStore(Buffer.byteLength(JSON.stringify(event))-(previous?Buffer.byteLength(previous.data):0));this.db.prepare('INSERT OR REPLACE INTO evidence(id,data,owner) VALUES (?,?,?)').run(event.id,JSON.stringify(event),this.owner);return event}
  close(){this.db.close()}
}
