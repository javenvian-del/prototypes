import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {Sheet} from './lib/sheet.mjs';
import {Platform} from './lib/platform.mjs';
import {validateConfig,processRow,fingerprint,shouldSkipRecorded} from './lib/core.mjs';
import {checkSessions} from './lib/session.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),mode=args.includes('--create')?'create':args.includes('--login')?'login':'check';
if(args.includes('--help')) {console.log('node run.mjs [--check | --create | --login] [--config config.json]\n默认只检查。--create 会创建事件并回写表格；需先完成 --check。');process.exit(0);}
if(args.filter(a=>['--create','--check','--login'].includes(a)).length>1) throw Error('运行模式不能同时指定');
const ci=args.indexOf('--config'),cfgPath=path.resolve(ci<0?path.join(root,'config.json'):args[ci+1]??'');
const config=JSON.parse(await fs.readFile(cfgPath,'utf8').catch(()=>{throw Error('请先将config.example.json复制为config.json');}));
validateConfig(config);
const local=path.resolve(config.stateDir||path.join(root,'.local'));await fs.mkdir(local,{recursive:true,mode:0o700});
const key=createHash('sha256').update(config.sheetUrl.split('?')[0]+'\n'+config.sheetName).digest('hex').slice(0,16);
const dir=path.join(local,key);await fs.mkdir(dir,{recursive:true,mode:0o700});
const lock=path.join(local,'run.lock');
let lockHandle;
try {lockHandle=await fs.open(lock,'wx',0o600);} catch {throw Error('已有助手运行或上次异常中断。确认所有助手窗口关闭后再删除.local/run.lock');}
let context;
const atomic=async(file,obj)=>{await fs.writeFile(file+'.tmp',JSON.stringify(obj,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);};
const json=async(file,fallback)=>JSON.parse(await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT') return JSON.stringify(fallback);throw e;}));
try {
  let pw;
  try {pw=await import('playwright');} catch {
    const bundled=path.join(process.env.HOME,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
    pw=await import(pathToFileURL(bundled).href);
  }
  context=await pw.chromium.launchPersistentContext(path.join(local,'browser-profile'),{channel:config.channel||'chrome',headless:mode!=='login',acceptDownloads:false,viewport:{width:1440,height:1000}});
  const sheetPage=await context.newPage(),platformPage=await context.newPage();
  await sheetPage.goto(config.sheetUrl,{waitUntil:'domcontentloaded'});
  await platformPage.goto(config.platformUrl,{waitUntil:'domcontentloaded'});
  if(mode==='login') {
    console.log('请在新开的浏览器中登录飞书和埋点平台；不要在这个步骤创建事件。');
    const rl=createInterface({input:stdin,output:stdout});await rl.question('两个页面均登录完成后，在这里按回车保存会话。');rl.close();
    await checkSessions(sheetPage,platformPage);
  } else {
    await checkSessions(sheetPage,platformPage);
    const sheet=new Sheet(sheetPage,config,path.join(dir,'images')),platform=new Platform(platformPage);
    await sheet.ready();
    const journalPath=path.join(dir,'journal.json'),planPath=path.join(dir,'checked.json');
    const state=await json(journalPath,{}),checked=await json(planPath,{}),results=[];
    const rows=[];
    // Preflight all rows, result columns and pictures before any platform submission.
    for(const n of config.rows) {
      const recorded={eventName:await sheet.read(`${config.columns.eventName}${n}`),eventId:await sheet.read(`${config.columns.eventId}${n}`)};
      if(shouldSkipRecorded(recorded,state[n])){results.push({row:n,status:'skipped_recorded',record:recorded});console.log(`第${n}行：表格已有结果，跳过`);continue;}
      const row=await sheet.row(n);row.imagePath=await sheet.image(row);
      row.imageHash=createHash('sha256').update(await fs.readFile(row.imagePath)).digest('hex');
      row.hash=fingerprint(row)+':'+row.imageHash;
      if(state[n]&&state[n].hash!==row.hash) throw Error(`第${n}行已执行过但输入或图片变了；需先核查历史结果`);
      if(mode==='create'&&checked[n]?.hash!==row.hash) throw Error(`第${n}行尚未检查或内容有变化，请先运行检查模式`);
      if(rows.some(r=>r.app===row.app&&r.expectedName===row.expectedName)) throw Error(`表格内有重复事件：${row.expectedName}`);
      rows.push(row);
    }
    for(const row of rows) {
      console.log(`第${row.row}行：${row.expectedName}`);
      const journal=async update=>{state[row.row]={...state[row.row],...update,hash:row.hash,time:new Date().toISOString()};await atomic(journalPath,state);};
      try {
        const result=await processRow({row,mode,platform,sheet,journal,entry:state[row.row]});
        if(mode==='check'&&args.includes('--inspect-form')) await platform.inspectOptions(row);
        results.push({row:row.row,...result});
        if(mode==='check') checked[row.row]={hash:row.hash,time:new Date().toISOString(),status:result.status};
        console.log(result.status==='skipped_existing'?'平台已有事件，跳过':result.status==='ready'?'检查通过，待创建':result.status==='existing'?'平台已有匹配事件':result.status==='reused'?'已创建事件的中断回写已恢复':'创建成功，结果已回写');
      } catch(e) {
        results.push({row:row.row,status:'failed',error:e.message});
        await atomic(path.join(dir,'last-results.json'),results);
        await platformPage.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});
        throw e;
      }
    }
    if(mode==='check') await atomic(planPath,checked);
    await atomic(path.join(dir,'last-results.json'),results);
    console.log(mode==='check'?'检查完成，没有创建事件或回写表格。':'完成。');
  }
} finally {if(context) await context.close();await lockHandle.close();await fs.unlink(lock);}
