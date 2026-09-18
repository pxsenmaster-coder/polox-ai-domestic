import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
 const module = { exports: {} }
 const defaultLlmProviders = {
  LLM_PROVIDER_PRESETS: {
   openrouter: {label:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-v4-flash-vision-exp'},
   deepseek: {label:'DeepSeek 直连',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash-vision-exp'},
   mimo: {label:'小米 MiMo 直连',baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.5-pro'},
   glm: {label:'智谱 GLM 直连',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'},
  },
  normalizeLlmProvider: value => value === 'deepseek' || value === 'mimo' || value === 'glm' || value === 'openrouter' ? value : 'openrouter',
  llmProviderPreset: provider => defaultLlmProviders.LLM_PROVIDER_PRESETS[provider],
  llmChatCompletionsUrl: (_provider, baseUrl) => `${baseUrl.replace(/\/$/, '')}/chat/completions`,
  llmAuthHeaders: (provider, key) => provider === 'mimo' ? {'api-key':key} : {Authorization:`Bearer ${key}`},
 }
 const code = ts.transpileModule(readFileSync(new URL(`../server/utils/${file}.ts`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(code, { module, exports:module.exports, require:id => id in mocks ? mocks[id] : id === './llmProviders' || id === '../../shared/utils/llmProviders' ? defaultLlmProviders : require(id), File, atob, AbortSignal, URL, setTimeout, clearTimeout, ...globals })
 return module.exports
}
function harness() {
 const db = new DatabaseSync(':memory:')
 const llmProviders = {
  LLM_PROVIDER_PRESETS: {
   openrouter: {label:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1',model:'deepseek/deepseek-v4-flash-vision-exp'},
   deepseek: {label:'DeepSeek 直连',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-flash-vision-exp'},
   mimo: {label:'小米 MiMo 直连',baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.5-pro'},
   glm: {label:'智谱 GLM 直连',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'},
  },
  normalizeLlmProvider: value => value === 'deepseek' || value === 'mimo' || value === 'glm' || value === 'openrouter' ? value : 'openrouter',
  llmProviderPreset: provider => llmProviders.LLM_PROVIDER_PRESETS[provider],
 }
 const settings = load('serviceSettings', {
  './sqlite': {connectDatabase:()=>db},
  './llmProviders': llmProviders,
  '../../shared/utils/arkSeedream': {DEFAULT_ARK_BASE_URL:'https://ark.cn-beijing.volces.com/api/v3', DEFAULT_ARK_SEEDREAM_MODEL:'doubao-seedream-5-0-pro-260628'},
 })
 return {db, settings}
}
test('settings are local, omitted passwords preserve saved keys, and public status never exposes secrets', () => {
 const {db,settings:s}=harness()
 const first=s.updateServiceSettings({openRouterKey:'private-openrouter',falKey:'private-fal',openRouterModel:'provider/model'})
 assert.equal(s.readServiceSettings().falKey,'private-fal')
 const next=s.updateServiceSettings({openRouterModel:'provider/new'})
 assert.equal(next.openRouterKey,first.openRouterKey)
 assert.notEqual(next.revision,first.revision)
 assert.equal(s.publicServiceStatus().connected,false)
 assert.ok(!JSON.stringify(s.publicServiceStatus()).includes('private-'))
 db.close()
})
test('green requires both successful tests and resets when settings change', () => {
 const {db,settings:s}=harness()
 const base=s.updateServiceSettings({openRouterKey:'a',falKey:'b'})
 assert.equal(s.publicServiceStatus({...base,openRouterOk:true,falOk:false,checkedAt:new Date().toISOString()}).connected,false)
 assert.equal(s.publicServiceStatus({...base,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()}).connected,true)
 s.writeServiceSettings({...base,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({openRouterModel:'another/model'})
 assert.equal(s.publicServiceStatus().connected,false)
 db.close()
})
test('a real model response and authenticated file upload are both required', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'a',falKey:'b',openRouterModel:'provider/model'})
 let uploads=0
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{createFalClient:()=>({storage:{upload:async()=>{uploads++;return 'https://cdn.fal.media/test.png'}}})}}, {fetch:async(url,init)=>{
  if(url.includes('openrouter')) {assert.equal(JSON.parse(init.body).model,'provider/model');return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}}
  if(url.includes('queue.fal.run'))return {status:404}
  return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,true)
 assert.equal(uploads,1)
 assert.equal(s.publicServiceStatus().connected,true)
 db.close()
})
test('invalid credentials and failed model requests cannot produce green', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'a',falKey:'b'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{createFalClient:()=>({})}}, {fetch:async()=>({ok:false,status:401,json:async()=>({error:{message:'invalid'}})})})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.connected,false)
 assert.equal(result.openRouter.ok,false)
 assert.equal(result.fal.ok,false)
 db.close()
})
test('an old connection test cannot overwrite newer settings', async () => {
 const {db,settings:s}=harness()
 const old=s.updateServiceSettings({openRouterKey:'',falKey:''})
 const newer=s.updateServiceSettings({openRouterModel:'new/model'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {})
 const result=await api.testServiceConnections(old)
 assert.equal(result.superseded,true)
 assert.equal(s.readServiceSettings().revision,newer.revision)
 db.close()
})

test('clearing a saved key deletes it and invalidates connection approval', () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'secret-a',falKey:'secret-b'})
 s.writeServiceSettings({...saved,openRouterOk:true,falOk:true,checkedAt:new Date().toISOString()})
 s.updateServiceSettings({falKey:''})
 assert.equal(s.readServiceSettings().falKey,'')
 assert.equal(s.readServiceSettings().openRouterKey,'secret-a')
 assert.equal(s.publicServiceStatus().connected,false)
 assert.equal(s.publicServiceStatus().falConfigured,false)
 s.updateServiceSettings({openRouterKey:'  '})
 assert.equal(s.readServiceSettings().openRouterKey,'')
 db.close()
})

test('Ark can be the only image provider and is checked without a generation request', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'openrouter-key',openRouterModel:'provider/model',arkApiKey:'ark-key',arkModel:'seedream-5-pro'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{createFalClient:()=>({})}}, {fetch:async(url,init)=>{
  if(url.includes('openrouter')) return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  if(url.endsWith('/models')) { assert.equal(init.headers.Authorization,'Bearer ark-key'); return {ok:true,status:200} }
  throw new Error(`unexpected request: ${url}`)
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.ark.ok,true)
 assert.equal(result.connected,true)
 assert.equal(result.fal.ok,false)
 db.close()
})

test('Ark primary provider skips the fal authentication probe', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({openRouterKey:'openrouter-key',openRouterModel:'provider/model',falKey:'stale-fal-key',arkApiKey:'ark-key',arkModel:'seedream-5-pro'})
 let falCalls=0
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {fetch:async(url,init)=>{
  if(url.includes('openrouter')) return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  if(url.includes('queue.fal.run')) { falCalls++; throw new Error('fal should not be called when Ark is primary') }
  if(url.endsWith('/models')) return {ok:true,status:200}
  throw new Error(`unexpected request: ${url}`)
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(falCalls,0)
 assert.equal(result.fal.skipped,true)
 assert.equal(result.ark.ok,true)
 assert.equal(result.connected,true)
 db.close()
})

test('DeepSeek direct provider uses its OpenAI-compatible endpoint', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({llmProvider:'deepseek',llmApiKey:'deepseek-key',llmModel:'deepseek-v4-flash-vision-exp',arkApiKey:'ark-key'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {fetch:async(url,init)=>{
  if(url.includes('api.deepseek.com')) {
   assert.equal(init.headers.Authorization,'Bearer deepseek-key')
   assert.equal(JSON.parse(init.body).model,'deepseek-v4-flash-vision-exp')
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  }
  if(url.endsWith('/models')) return {ok:true,status:200}
  throw new Error(`unexpected request: ${url}`)
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.llm.ok,true)
 assert.equal(result.connected,true)
 db.close()
})

test('MiMo direct provider uses api-key authentication and completion token field', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({llmProvider:'mimo',llmApiKey:'mimo-key',llmModel:'mimo-v2.5-pro',arkApiKey:'ark-key'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {fetch:async(url,init)=>{
  if(url.includes('xiaomimimo.com')) {
   assert.equal(init.headers['api-key'],'mimo-key')
   const body=JSON.parse(init.body)
   assert.equal(body.model,'mimo-v2.5-pro')
   assert.equal(body.max_completion_tokens,8)
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  }
  if(url.endsWith('/models')) return {ok:true,status:200}
  throw new Error(`unexpected request: ${url}`)
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.llm.ok,true)
 assert.equal(result.connected,true)
 db.close()
})

test('GLM direct provider uses bearer authentication and official endpoint', async () => {
 const {db,settings:s}=harness()
 const saved=s.updateServiceSettings({llmProvider:'glm',llmApiKey:'glm-key',llmModel:'glm-5.3-flash',arkApiKey:'ark-key'})
 const api=load('serviceConnection',{'./serviceSettings':s,'@fal-ai/client':{}}, {fetch:async(url,init)=>{
  if(url.includes('open.bigmodel.cn')) {
   assert.equal(init.headers.Authorization,'Bearer glm-key')
   const body=JSON.parse(init.body)
   assert.equal(body.model,'glm-5.3-flash')
   assert.equal(body.max_tokens,8)
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:'OK'}}]})}
  }
  if(url.endsWith('/models')) return {ok:true,status:200}
  throw new Error(`unexpected request: ${url}`)
 }})
 const result=await api.testServiceConnections(saved)
 assert.equal(result.llm.ok,true)
 assert.equal(result.connected,true)
 db.close()
})
