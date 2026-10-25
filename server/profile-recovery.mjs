import { createHash, randomBytes } from 'node:crypto'

const hash=value=>createHash('sha256').update(value).digest('hex')
const fail=(message,status=400)=>Object.assign(Error(message),{status})
const lifetime=180*24*60*60
export function createProfileRecovery(config,store,{now=Date.now}={}) {
  const db=store.db
  db.exec(`CREATE TABLE IF NOT EXISTS profile_recovery (owner TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS visitor_recovery_sessions (token_hash TEXT PRIMARY KEY, id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_recovery_limits (scope TEXT PRIMARY KEY, started_at INTEGER NOT NULL, attempts INTEGER NOT NULL)`)
  function supported(owner){if(!config.hosted||owner==='local')throw fail('Перенос доступен на опубликованном сайте. Локальная тетрадь остаётся на этом компьютере.',400)}
  function hasCode(owner){return Boolean(db.prepare('SELECT owner FROM profile_recovery WHERE owner=?').get(owner))}
  function status(owner){return {available:Boolean(config.hosted&&owner!=='local'),hasCode:hasCode(owner)}}
  function create(owner){
    supported(owner)
    if(!db.prepare('SELECT id FROM visitors WHERE id=?').get(owner))throw fail('Сессия не найдена.',409)
    const raw=randomBytes(32).toString('hex')
    db.prepare('INSERT OR REPLACE INTO profile_recovery(owner,code_hash,created_at) VALUES(?,?,?)').run(owner,hash(raw),now())
    return {code:raw.match(/.{8}/g).join('-')}
  }
  function limit(scope,max){
    const previous=db.prepare('SELECT * FROM profile_recovery_limits WHERE scope=?').get(scope)
    if(previous&&now()-previous.started_at<15*60*1000&&previous.attempts>=max)throw fail('Слишком много попыток. Попробуй через 15 минут.',429)
    if(!previous||now()-previous.started_at>=15*60*1000)db.prepare('INSERT OR REPLACE INTO profile_recovery_limits VALUES(?,?,1)').run(scope,now())
    else db.prepare('UPDATE profile_recovery_limits SET attempts=attempts+1 WHERE scope=?').run(scope)
  }
  function restore(owner,body){
    supported(owner)
    if(body?.confirmSwitch!==true||body?.savedCurrentCode!==true||!hasCode(owner))throw fail('Сначала сохрани код текущего профиля и подтверди переключение. Его работы останутся отдельно.',409)
    limit('all',60);limit(owner,6)
    const raw=typeof body.code==='string'&&body.code.length<=100?body.code.replace(/[-\s]/g,'').toLowerCase():''
    const target=/^[a-f0-9]{64}$/.test(raw)?db.prepare('SELECT owner FROM profile_recovery WHERE code_hash=?').get(hash(raw)):undefined
    if(!target||target.owner==='local'||!db.prepare('SELECT id FROM visitors WHERE id=?').get(target.owner))throw fail('Код не найден или заменён новым. Проверь запись.',400)
    const token=randomBytes(32).toString('base64url')
    db.exec('BEGIN IMMEDIATE')
    try{
      db.prepare('DELETE FROM visitor_recovery_sessions WHERE expires_at<=?').run(now())
      db.prepare('INSERT INTO visitor_recovery_sessions(token_hash,id,expires_at) VALUES(?,?,?)').run(hash(token),target.owner,now()+lifetime*1000)
      db.exec('COMMIT')
    }catch(error){db.exec('ROLLBACK');throw error}
    return {id:target.owner,persistent:true,cookie:`__Host-pole-visitor=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${lifetime}`}
  }
  // Session tokens are random bearer secrets, authenticated by a server-side hash lookup.
  function findSession(tokenHash){return db.prepare('SELECT id,expires_at FROM visitor_recovery_sessions WHERE token_hash=?').get(tokenHash)}
  return {status,create,restore,findSession}
}
