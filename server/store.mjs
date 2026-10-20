import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { blankDocument, getProblem } from './problems.mjs'
import { initialLearningSession } from './learning.mjs'
export class Store {
  constructor(path=resolve('.runtime/pole.sqlite')) {
    if(path!==':memory:')mkdirSync(resolve(path,'..'),{recursive:true})
    this.db=new DatabaseSync(path)
    this.owner='local'
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    // Existing rows belong exclusively to the original local notebook.
    for(const table of ['works','evidence'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='owner'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN owner TEXT NOT NULL DEFAULT 'local'`)
    for(const row of this.db.prepare('SELECT owner,data FROM works').all()) {
      const work=JSON.parse(row.data);let changed=false
      if(work.preparation&&!work.preparation.id){work.preparation.id=crypto.randomUUID();changed=true}
      work.messages=work.messages.map(m=>{if(m.status==='pending'){changed=true;return {...m,status:'failed',error:'Запрос прерван перезапуском сервера. Автоматического повтора не было.'}}return m})
      for(const submission of work.submissions){if(submission.reviewStatus==='pending'){changed=true;submission.reviewStatus='failed';submission.reviewVersion=(submission.reviewVersion??0)+1;submission.reviewError='Разбор прерван перезапуском сервера. Автоматического повтора не было.'}}
      if(changed)this.forVisitor(row.owner).put(work)
    }
  }
  // Views share one connection and have no lifecycle, cache or file of their own.
  forVisitor(owner){if(!/^(local|[a-f0-9-]{36})$/.test(owner))throw Error('Invalid visitor scope');const view=Object.create(Store.prototype);view.db=this.db;view.owner=owner;return view}
  key(key){return this.owner==='local'?key:`visitor:${this.owner}:${key}`}
  setting(key){return this.db.prepare('SELECT value FROM settings WHERE key=?').get(this.key(key))?.value}
  setSetting(key,value){this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(this.key(key),value)}
  get(id){const row=this.db.prepare('SELECT data FROM works WHERE id=? AND owner=?').get(id,this.owner);if(!row)throw Object.assign(Error('Работа не найдена'),{status:404});return JSON.parse(row.data)}
  put(work){
    const existing=this.db.prepare('SELECT owner FROM works WHERE id=?').get(work.id)
    if(existing&&existing.owner!==this.owner)throw Object.assign(Error('Работа не найдена'),{status:404})
    work.updatedAt=new Date().toISOString();const data=JSON.stringify(work)
    if(this.owner!=='local'){
      const total=this.db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes, COUNT(*) AS count FROM works WHERE owner=? AND id<>?').get(this.owner,work.id)
      if(total.count>=100||Buffer.byteLength(data)>1000000||total.bytes+Buffer.byteLength(data)>10000000)throw Object.assign(Error('Место для этого браузера заполнено. Сообщи владельцу тренажёра.'),{status:429})
    }
    this.db.prepare('INSERT OR REPLACE INTO works(id,data,owner) VALUES (?,?,?)').run(work.id,data,this.owner);return work
  }
  current(){const id=this.setting('current');return id?this.get(id):this.create('double-angle-cos','guided')}
  list(){return this.db.prepare('SELECT data FROM works WHERE owner=? ORDER BY rowid DESC').all(this.owner).map(r=>{const w=JSON.parse(r.data);return {id:w.id,problemId:w.problemId,mode:w.mode,updatedAt:w.updatedAt}})}
  open(id){const work=this.get(id);this.setSetting('current',id);return work}
  create(problemId,mode){const problem=getProblem(problemId);const old=this.list();const now=new Date().toISOString();const work={id:crypto.randomUUID(),problemId,mode,modeEpoch:0,revision:0,document:blankDocument(),finalAnswer:'',messages:[],submissions:[],createdAt:now,updatedAt:now,priorExposure:old.some(w=>w.problemId===problemId)};this.put(work);if(problem.generation)this.setSetting(`problem-instance:${work.id}`,JSON.stringify(problem));this.setSetting('current',work.id);return work}
  problem(work){this.get(work.id);const value=this.setting(`problem-instance:${work.id}`);return value?JSON.parse(value):getProblem(work.problemId)}
  memory(){return this.db.prepare('SELECT data FROM evidence WHERE owner=? ORDER BY rowid DESC LIMIT 30').all(this.owner).map(r=>JSON.parse(r.data))}
  learning(){const value=this.setting('learning');if(value){const session=JSON.parse(value);if(!Number.isSafeInteger(session.revision)||session.revision<0){session.revision=0;this.setSetting('learning',JSON.stringify(session))}return session}const session=initialLearningSession();this.setSetting('learning',JSON.stringify(session));return session}
  learningEvidence(){return this.db.prepare('SELECT value FROM settings WHERE key LIKE ? ORDER BY rowid DESC LIMIT 60').all(`${this.key('learning-event:')}%`).map(row=>JSON.parse(row.value))}
  trimLearning(){if(this.owner!=='local')this.db.prepare('DELETE FROM settings WHERE key IN (SELECT key FROM settings WHERE key LIKE ? ORDER BY rowid DESC LIMIT -1 OFFSET 300)').run(`${this.key('learning-event:')}%`)}
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
  evidence(submission,work){const preparationCount=work.preparationHistory?.length??0;const independent=!preparationCount&&submission.mode==='solo'&&submission.helpCount===0&&!work.priorExposure;const outcome=submission.result.status==='correct'?'Конечный набор корней верен':submission.result.status==='incorrect'?'В конечном наборе корней есть расхождение':'Конечный ответ не подтверждён';const event={id:submission.id,submissionId:submission.id,problemId:work.problemId,createdAt:submission.createdAt,independent,summary:`${outcome}. ${preparationCount?`В этой работе открывалась подготовка: ${preparationCount} упражн.`:independent?'Новая задача, подсказки в этой попытке не открывались':submission.helpCount?'В этой работе предоставлялась помощь':work.priorExposure?'Задача уже открывалась ранее':'Попытка в режиме с наставником'}. Шаги решения отдельно автоматически не доказаны.`};this.get(work.id);this.db.prepare('INSERT OR REPLACE INTO evidence(id,data,owner) VALUES (?,?,?)').run(event.id,JSON.stringify(event),this.owner);if(this.owner!=='local')this.db.prepare('DELETE FROM evidence WHERE owner=? AND id IN (SELECT id FROM evidence WHERE owner=? ORDER BY rowid DESC LIMIT -1 OFFSET 100)').run(this.owner,this.owner);return event}
  close(){this.db.close()}
}
