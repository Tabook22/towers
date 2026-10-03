import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/api/visitEntry.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function harness(api) {
  const cells=[],effects=[],storage=new Map();let cursor=0,visit=1,user='crew';
  const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>v!==b[i]);
  const memo=(fn,deps)=>{const i=cursor++;if(!cells[i]||changed(cells[i].deps,deps))cells[i]={deps,value:fn()};return cells[i].value;};
  const react={
    useState(initial){const i=cursor++;if(!cells[i])cells[i]={value:typeof initial==='function'?initial():initial};return [cells[i].value,v=>{cells[i].value=typeof v==='function'?v(cells[i].value):v;}];},
    useRef(initial){return memo(()=>({current:initial}),[]);},useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),
    useEffect(fn,deps){const i=cursor++;if(!cells[i]||changed(cells[i].deps,deps)){const previous=cells[i];cells[i]={deps};effects.push(()=>{previous?.cleanup?.();cells[i].cleanup=fn();});}},
  };
  const empty=()=>({drafts:{},additions:[],excludedImages:[],saveTemplate:false});
  const qc={invalidateQueries:async()=>{},setQueryData:()=>{}};
  const imports={react,'@tanstack/react-query':{useQueryClient:()=>qc},'./client':{apiClient:api},'./hooks':{requireConfirmedPositionWrite:async()=>{}},
    '../utils/visitEntry':{emptyEntry:empty,entryHasChanges:e=>JSON.stringify(e)!==JSON.stringify(empty()),compareLatestEntry:e=>e},
    '../utils/positionChanges':{positionError:(e,fallback)=>e.message||fallback},'../utils/visitWorkflow':{restorePositionDrafts:()=>({})},
    '../utils/reconcileDraft':{reconcileDraft:(local,remote,base)=>{assert.deepEqual(local,base);return remote;}},
  };
  const exports={};vm.runInNewContext(code,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null,removeItem:()=>{}},
    window:{setTimeout:()=>1,addEventListener:()=>{},removeEventListener:()=>{}},clearTimeout:()=>{},FormData,crypto});
  const render=(id=visit,account=user)=>{visit=id;user=account;cursor=0;const result=exports.useVisitEntry(visit,user);while(effects.length)effects.shift()();return result;};
  return {render,storage};
}
test('late visit-A load cannot become visit-B draft or write payload with equal revisions',async()=>{
  const a=deferred(),b=deferred(),puts=[];
  const h=harness({get:url=>url.includes('/1/')?a.promise:b.promise,put:async(url,body)=>{puts.push({url,body});return {data:{revision:1,payload:body.payload,images:[]}};}});
  h.render(1);h.render(2);
  b.resolve({data:{revision:0,payload:{headerDraft:{inspector_name:'B'}},images:[]}});await tick();
  a.resolve({data:{revision:0,payload:{headerDraft:{inspector_name:'A'}},images:[{id:99}]}});await tick();
  const current=h.render(2);assert.equal(current.entry.headerDraft.inspector_name,'B');assert.equal(current.images.length,0);
  current.change({...current.entry,headerDraft:{inspector_name:'B edited'}});await current.flush();
  assert.equal(puts.length,1);assert.match(puts[0].url,/\/2\/entry$/);assert.equal(puts[0].body.payload.headerDraft.inspector_name,'B edited');
});
test('pending visit-A save cannot inject evidence or revisions into another account/visit',async()=>{
  const pending=deferred(),puts=[];
  const h=harness({get:async()=>({data:{revision:0,payload:{},images:[]}}),put:(url,body)=>{puts.push({url,body});return puts.length===1?pending.promise:Promise.resolve({data:{revision:1,payload:body.payload,images:[]}});}});
  h.render(1);await tick();const old=h.render(1);old.change({...old.entry,headerDraft:{inspector_name:'A'}});const save=old.flush();
  h.render(2,'other');await tick();const next=h.render(2,'other');
  pending.resolve({data:{revision:1,payload:{headerDraft:{inspector_name:'A'}},images:[{id:99}]}});await save;await tick();
  assert.equal(h.render(2,'other').images.length,0);
  next.change({...next.entry,headerDraft:{inspector_name:'B'}});await next.flush();
  assert.equal(puts[1].body.revision,0);assert.equal(puts[1].body.payload.headerDraft.inspector_name,'B');
  await assert.rejects(old.flush(),/loading/);
});
