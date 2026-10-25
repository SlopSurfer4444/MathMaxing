import { createHash, randomBytes, randomUUID } from 'node:crypto'

const cookieName='__Host-pole-visitor'
const lifetime=180*24*60*60
const changed=()=>Object.assign(Error('Сессия браузера изменилась. Обнови страницу перед продолжением.'),{status:409})
const hash=value=>createHash('sha256').update(value).digest('hex')

/** An opaque bearer cookie identifies a browser; the public id is only a draft namespace. */
export function createVisitorSessions(config,store,{now=Date.now,findRecoveredSession=()=>undefined}={}){
  if(!config.hosted)return ()=>({store,session:{id:'local',persistent:true}})
  const db=store.db
  db.exec('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)')
  return (req,res,path)=>{
    const cookies=typeof req.headers.cookie==='string'?req.headers.cookie.split(';').map(item=>item.trim()).filter(item=>item.startsWith(`${cookieName}=`)):[]
    const token=cookies.length===1?cookies[0].slice(cookieName.length+1):''
    let visitor=/^[A-Za-z0-9_-]{43}$/.test(token)?(db.prepare('SELECT id,expires_at FROM visitors WHERE token_hash=?').get(hash(token))??findRecoveredSession(hash(token))):undefined
    if(visitor&&visitor.expires_at<=now())visitor=undefined
    if(path!=='/api/session'){
      // Never rotate identity while an old tab may be sending unsaved work.
      if(!visitor||req.headers['x-pole-session']!==visitor.id)throw changed()
    }else if(!visitor){
      if(db.prepare('SELECT COUNT(*) AS count FROM visitors').get().count>=(config.maxVisitors??50))throw Object.assign(Error('Все места тренажёра заняты. Сообщи владельцу.'),{status:503})
      const secret=randomBytes(32).toString('base64url')
      visitor={id:randomUUID(),expires_at:now()+lifetime*1000}
      db.prepare('INSERT INTO visitors(id,token_hash,created_at,expires_at) VALUES(?,?,?,?)').run(visitor.id,hash(secret),now(),visitor.expires_at)
      res.setHeader('Set-Cookie',`${cookieName}=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${lifetime}`)
    }
    return {store:store.forVisitor(visitor.id),session:{id:visitor.id,persistent:true}}
  }
}
