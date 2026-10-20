import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createTutor} from './tutor-provider.mjs'
import {loadServerConfig} from './config.mjs'
import {OpenAITutor} from './openai-adapter.mjs'

test('explicit CLIProxy provider sends bounded tool-free Responses only to loopback',async()=>{
  const config=loadServerConfig({POLE_MODE:'hosted',POLE_TUTOR_PROVIDER:'cliproxy',POLE_DB_PATH:':memory:',POLE_ALLOWED_ORIGINS:'https://trainer.example.com',CLIPROXY_API_KEY:'test-only-local-key',OPENAI_MODEL:'gpt-6-astra'})
  const db=new DatabaseSync(':memory:')
  let calls=0
  const tutor=createTutor(config,{db,fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'http://127.0.0.1:8317/v1/responses')
    assert.equal(init.headers.Authorization,'Bearer test-only-local-key')
    const body=JSON.parse(init.body)
    assert.equal(body.model,'gpt-6-astra');assert.deepEqual(body.reasoning,{effort:'low'})
    assert.equal(body.store,false);assert.deepEqual(body.tools,[])
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Синус — высота точки.'}]}]}))
  }})
  try {
    assert.equal((await tutor.status()).connected,false)
    assert.match((await tutor.respond({system:'Наставник',prompt:'Что такое синус?'})).text,/высота/)
    assert.equal((await tutor.status()).provider,'Codex · CLIProxyAPI')
    assert.equal((await tutor.status()).connected,true);assert.equal(calls,1)
    const ipv6 = new OpenAITutor({db,apiKey:'test',model:'test',proxyBaseUrl:'http://[::1]:8317/v1'})
    assert.equal(ipv6.endpoint,'http://[::1]:8317/v1/responses')
    await ipv6.close()
    for(const url of ['https://example.com/v1','http://127.0.0.1:8317/v1?key=x','http://user:pass@127.0.0.1:8317/v1']) {
      assert.throws(()=>new OpenAITutor({db,apiKey:'test',model:'test',proxyBaseUrl:url}))
    }
  } finally {await tutor.close();db.close()}
})
