// Ordinary flow tests act on the latest state. Concurrency/validation tests call
// app.route directly with the exact version observed by their simulated tab.
export function versionedRoute(app,method,path,body){
  const work=app.store.get(body.workId)
  const expectedRevision=path.startsWith('/api/preparation/')?work.preparation?.revision:work.revision
  return app.route(method,path,{expectedRevision,expectedModeEpoch:work.modeEpoch,...(path==='/api/work/mode'?{requestId:crypto.randomUUID()}:{}),...body})
}
