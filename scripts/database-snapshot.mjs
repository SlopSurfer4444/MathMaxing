import { DatabaseSync, backup } from 'node:sqlite'
import { mkdir, stat, chmod, unlink, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Online SQLite backup includes committed WAL content; restore always creates a new destination. */
export async function snapshotDatabase(source, target) {
  const from = resolve(source), to = resolve(target)
  if (from === to) throw Error('Source and destination must differ')
  await stat(from)
  await mkdir(dirname(to), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(from, { readOnly: true })
  let created = false
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Source integrity check failed')
    // Claim the new path atomically; two concurrent backup jobs cannot overwrite each other.
    let reservation
    try { reservation = await open(to, 'wx', 0o600) } catch (error) {
      if (error.code === 'EEXIST') throw Error('Destination already exists; choose a new path')
      throw error
    }
    created = true
    await reservation.close()
    await backup(db, to)
    await chmod(to, 0o600)
    const check = new DatabaseSync(to, { readOnly: true })
    try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Snapshot integrity check failed') } finally { check.close() }
    return to
  } catch (error) {
    if (created) await unlink(to).catch(() => {})
    throw error
  } finally { db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, source, target, ...extra] = process.argv.slice(2)
  if (!['backup', 'restore'].includes(action) || !source || !target || extra.length) {
    console.error('Usage: node scripts/database-snapshot.mjs backup|restore SOURCE.sqlite NEW_DESTINATION.sqlite')
    process.exitCode = 1
  } else {
    try { console.log(await snapshotDatabase(source, target)) } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
