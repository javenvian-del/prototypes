// Sequential batches reuse the verified single-row adapters and write safeguards.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Sheet} from './lib/sheet.mjs';
import {Platform} from './lib/platform.mjs';
import {validateConfig,processRow,fingerprint,shouldSkipRecorded} from './lib/core.mjs';
import {checkSessions} from './lib/session.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);if(args[0]!=='--config'||args.length!==2)throw Error('用法：node batch.mjs --config 配置文件');
const config=JSON.parse(await fs.readFile(path.resolve(args[1]),'utf8'));validateConfig(config);
const local=path.resolve(config.stateDir||path.join(root,'.local')),key=createHash('sha256').update(config.sheetUrl.split('?')[0]+'\n'+config.sheetName).digest('hex').slice(0,16),dir=path.join(local,key);
await fs.mkdir(dir,{recursive:true,mode:0o700});
const lockPath=path.join(local,'run.lock'),lock=await fs.open(lockPath,'wx',0o600);
const atomic=async(file,obj)=>{await fs.writeFile(file+'.tmp',JSON.stringify(obj,null,2),{mode:0o600});await fs.rename(file+'.tmp',file)};
const read=async(file)=>JSON.parse(await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e}));
const journalPath=path.join(dir,'journal.json'),planPath=path.join(dir,'checked.json'),resultsPath=path.join(dir,`batch-${config.rows[0]}-${config.rows.at(-1)}.json`);
let c,activeRow;
const results=[],state=await read(journalPath),checked=await read(planPath);
try{
 await atomic(resultsPath,{status:'running',rows:config.rows,results,startedAt:new Date().toISOString()});
 let pw;try{pw=await import('playwright')}catch{pw=await import(pathToFileURL(path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href)}
 c=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:true,acceptDownloads:false,viewport:{width:1440,height:1000}});
 const sp=await c.newPage(),pp=await c.newPage();await sp.goto(config.sheetUrl,{waitUntil:'domcontentloaded'});await pp.goto(config.platformUrl,{waitUntil:'domcontentloaded'});
 await checkSessions(sp,pp);
 const sheet=new Sheet(sp,config,path.join(dir,'images')),platform=new Platform(pp);await sheet.ready();
 const seen=new Set();
 for(const n of config.rows){
  activeRow=n;console.log(`第${n}行：开始读取与检查`);
  const recorded={eventName:await sheet.read(`${config.columns.eventName}${n}`),eventId:await sheet.read(`${config.columns.eventId}${n}`)};
  if(shouldSkipRecorded(recorded,state[n])){
    results.push({row:n,status:'skipped_recorded',record:recorded});
    await atomic(resultsPath,{status:'running',rows:config.rows,results});
    console.log(JSON.stringify({row:n,status:'skipped_recorded',...recorded,completed:results.length,total:config.rows.length}));
    continue;
  }
  const row=await sheet.row(n);row.imagePath=await sheet.image(row);row.imageHash=createHash('sha256').update(await fs.readFile(row.imagePath)).digest('hex');row.hash=fingerprint(row)+':'+row.imageHash;
  if(row.sourceElement)console.log(JSON.stringify({row:n,sourceElement:row.sourceElement,submittedElement:row.element}));
  if(state[n]&&state[n].hash!==row.hash)throw Error(`第${n}行输入与已有执行记录冲突`);
  const identity=row.app+'\n'+row.expectedName;if(seen.has(identity))throw Error('本批次出现同名事件，停止核查');seen.add(identity);
  const journal=async update=>{state[n]={...state[n],...update,hash:row.hash,time:new Date().toISOString()};await atomic(journalPath,state)};
  const check=await processRow({row,mode:'check',platform,sheet,journal,entry:state[n]});checked[n]={hash:row.hash,time:new Date().toISOString(),status:check.status};await atomic(planPath,checked);
  console.log(`第${n}行：${row.expectedName}；${check.status==='existing'?(['submitting','verified'].includes(state[n]?.phase)?'已创建，恢复待完成回写':'平台已存在，直接跳过'):'检查通过，准备创建'}`);
  const result=await processRow({row,mode:'create',platform,sheet,journal,entry:state[n]});
  if(result.status==='skipped_existing'){results.push({row:n,...result});await atomic(resultsPath,{status:'running',rows:config.rows,results});console.log(JSON.stringify({row:n,...result,completed:results.length,total:config.rows.length}));continue;}
  const name=await sheet.read(`${config.columns.eventName}${n}`),id=await sheet.read(`${config.columns.eventId}${n}`);
  if(name!==result.record.eventName||id!==result.record.eventId)throw Error('最终回写核验失败');
  results.push({row:n,...result});await atomic(resultsPath,{status:'running',rows:config.rows,results});
  console.log(JSON.stringify({row:n,status:result.status,eventName:name,eventId:id,completed:results.length,total:config.rows.length}));
 }
 await atomic(resultsPath,{status:'done',rows:config.rows,results});console.log(`批次完成：${results.length}/${config.rows.length}`);
}catch(e){await atomic(resultsPath,{status:'stopped',rows:config.rows,results,failedRow:activeRow,error:e.message});console.error(`第${activeRow??'?'}行停止：${e.message}`);if(c){for(const [i,p]of c.pages().entries())await p.screenshot({path:path.join(dir,`batch-failure-${i}.png`)}).catch(()=>{});}process.exitCode=1;
}finally{await c?.close();await lock.close();await fs.unlink(lockPath);}
