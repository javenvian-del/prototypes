import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateConfig} from './lib/core.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),command=args[0];
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const data=path.resolve(process.env.LI_AUTO_TRACKING_DATA||path.join(os.homedir(),'Documents','Codex','li-auto-event-tracking-data'));
const configFile=path.join(data,'config.json');
const child=(file,cfg,stdio='inherit')=>new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,[path.join(root,file),...(file==='run.mjs'?['--login']:[]),'--config',cfg],{stdio});
 p.once('error',reject);p.once('exit',(code,signal)=>resolve({code,signal}));
});
export function parseRows(spec){
 if(!spec)throw Error('必须指定已确认的行区间，例如 --rows 6-18');
 const rows=[];
 for(const part of spec.split(',')){
  const m=part.trim().match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error('行区间格式错误');
  const a=Number(m[1]),b=Number(m[2]||m[1]);
  if(a<2||b<a||b>100000||b-a>10000)throw Error('行区间无效');
  for(let n=a;n<=b;n++)rows.push(n);
 }
 return [...new Set(rows)].sort((a,b)=>a-b);
}
const summary=x=>({status:x.status,total:x.rows?.length??0,completed:x.results?.length??0,counts:(x.results??[]).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),...(x.error?{failedRow:x.failedRow,error:x.error}:{})});
async function main(){
 if(command==='init'){
  const sheetUrl=option('--sheet-url');if(!sheetUrl)throw Error('需要 --sheet-url 飞书链接');
  const c={sheetUrl,sheetName:option('--sheet-name')||'Sheet1',platformUrl:option('--platform-url'),rows:[2],columns:{app:'A',page:'B',element:'C',action:'D',developer:'E',tester:'F',description:'G',image:'H',eventName:'I',eventId:'J'},images:{},channel:'chrome',stateDir:option('--state-dir')?path.resolve(option('--state-dir')):path.join(data,'state')};
  validateConfig(c);await fs.mkdir(data,{recursive:true,mode:0o700});
  // Explicit init changes the selected sheet, never copies credentials into the skill.
  await fs.writeFile(configFile,JSON.stringify(c,null,2),{mode:0o600});console.log(JSON.stringify({status:'configured',configFile}));return;
 }
 if(!['check-login','login','run','status'].includes(command))throw Error('用法：control.mjs init --sheet-url URL | check-login | login | run --rows 6-18 --confirmed [--exclude 10-12] | status');
 const c=JSON.parse(await fs.readFile(configFile,'utf8').catch(()=>{throw Error('先运行 init --sheet-url URL')}));
 if(command==='check-login'||command==='login'){
  const result=await child(command==='login'?'run.mjs':'session.mjs',configFile);process.exitCode=result.code??1;return;
 }
 if(command==='status'){
  const latest=JSON.parse(await fs.readFile(path.join(data,'last-run.json'),'utf8'));
  const x=JSON.parse(await fs.readFile(latest.resultsPath,'utf8'));console.log(JSON.stringify(summary(x)));return;
 }
 if(!args.includes('--confirmed'))throw Error('执行前先询问用户行区间；已有明确范围时使用 --confirmed');
 const excluded=new Set(option('--exclude')?parseRows(option('--exclude')):[]);
 c.rows=parseRows(option('--rows')).filter(n=>!excluded.has(n));validateConfig(c);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),runDir=path.join(data,'runs',stamp);
 await fs.mkdir(runDir,{recursive:true,mode:0o700});
 const cfg=path.join(runDir,'config.json'),logPath=path.join(runDir,'execution.log');
 await fs.writeFile(cfg,JSON.stringify(c,null,2),{mode:0o600});
 const key=createHash('sha256').update(c.sheetUrl.split('?')[0]+'\n'+c.sheetName).digest('hex').slice(0,16);
 const resultsPath=path.join(c.stateDir,key,`batch-${c.rows[0]}-${c.rows.at(-1)}.json`);
 await fs.writeFile(path.join(data,'last-run.json'),JSON.stringify({resultsPath,logPath,cfg}),{mode:0o600});
 const log=await fs.open(logPath,'wx',0o600);
 let result;
 try{result=await child('batch.mjs',cfg,['ignore',log.fd,log.fd]);}finally{await log.close();}
 if(result.code!==0){console.error(JSON.stringify({status:'stopped',logPath,message:'批次停止，读取本次日志末尾定位异常；不得自动重跑提交。'}));process.exitCode=1;return;}
 const x=JSON.parse(await fs.readFile(resultsPath,'utf8'));console.log(JSON.stringify({...summary(x),resultsPath}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(e=>{console.error(e.message);process.exitCode=1});
