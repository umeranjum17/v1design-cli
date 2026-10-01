import pathlib,os,subprocess,time,re,json,threading,queue,fcntl,hashlib
root=pathlib.Path.cwd(); ev=root/'data/v1-pm-17/evidence'; demo=root/'scratchpad/repos/umer-demo'
env={'PATH':str(root/'scratchpad/bin')+':'+os.environ['PATH'],'HOME':str(root/'scratchpad/demo-home'),'V1_DESIGN_API_URL':'http://localhost:18917','V1_DESIGN_WEB_URL':'http://127.0.0.1:18918'}
benv=os.environ.copy(); benv['CHROME_DEVTOOLS_AXI_SESSION']='v1-pm-17'
def clean(s):
 return re.sub(r'http://127\.0\.0\.1:18918/authorize\?\S+', 'http://127.0.0.1:18918/authorize?<session-and-PKCE-redacted>',s).replace(str(root),'<task-worktree>')
log=open(ev/'01-connect-authorize.txt','w'); log.write('REAL localhost / DEVELOPMENT MODE / synthetic member Umer (uid umer)\nCodex coding agent drove CLI and chrome-devtools-axi; no provider generation.\n')
def browser(args):
 p=subprocess.run(['chrome-devtools-axi']+args,env=benv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20)
 if p.returncode: raise RuntimeError(clean(p.stdout))
 return p.stdout
with open('/tmp/fm-desktop.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 cmd=['node',str(root/'bin/cli.mjs'),'connect','--client','codex','--allow-project-write']
 start=time.monotonic(); startutc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 log.write('$ v1design connect --client codex --allow-project-write\n'); log.flush()
 p=subprocess.Popen(cmd,cwd=demo,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 q=queue.Queue(); lines=[]
 def reader():
  for line in p.stdout: lines.append(line); q.put(line)
 threading.Thread(target=reader,daemon=True).start()
 code=url=None
 while not url:
  line=q.get(timeout=20)
  if 'Verification code:' in line: code=line.split(':',1)[1].strip()
  if line.startswith('http://'): url=line.strip()
 browser(['open',url])
 snap=browser(['snapshot']); (ev/'02-authorize-before.txt').write_text(clean(snap))
 browser(['screenshot',str(ev/'02-authorize-before.png')])
 inputuid=re.search(r'uid=(\S+) textbox',snap).group(1)
 browser(['fill','@'+inputuid,code])
 snap=browser(['snapshot']); button=re.search(r'uid=(\S+) button "AUTHORIZE AGENT"',snap).group(1)
 clickstart=time.monotonic(); browser(['click','@'+button]); clicked=time.monotonic()
 exitcode=p.wait(timeout=20); elapsed=time.monotonic()-start
 log.write(clean(''.join(lines))); log.write(f'[exit {exitcode}]\nconnect elapsed: {elapsed:.3f} seconds\n'); log.close()
 snap=browser(['snapshot']); (ev/'03-authorize-connected.txt').write_text(clean(snap))
 browser(['screenshot',str(ev/'03-authorize-connected.png')])
 (ev/'timing.json').write_text(json.dumps({'startedUtc':startutc,'connectToCliExitSeconds':round(elapsed,3),'connectToAuthorizeClickStartSeconds':round(clickstart-start,3),'connectToAuthorizeClickReturnSeconds':round(clicked-start,3),'cliExitCode':exitcode,'under30Seconds':elapsed<30,'environment':'localhost development, synthetic Umer','warmup':'website page, BFF routes and browser warmed before timing; automated code entry'},indent=2)+'\n')
 if exitcode: raise RuntimeError('connect failed')
print('Real authorization finished; seconds',round(elapsed,3))
with open(ev/'04-search-pull-files.txt','w') as out:
 out.write('REAL localhost engine / synthetic Umer development authorization / fresh git repo\n')
 for args in [['status'],['search','analytics','--surface','web','--json'],['pull','pulse-5f8a2c10','--allow-project-write'],['pull','pulse-5f8a2c10','--allow-project-write']]:
  out.write('$ v1design '+' '.join(args)+'\n')
  r=subprocess.run(['node',str(root/'bin/cli.mjs')]+args,cwd=demo,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=30)
  out.write(clean(r.stdout)+f'[exit {r.returncode}]\n\n')
  if r.returncode: raise RuntimeError('CLI command failed: '+str(args))
 r=subprocess.run(['git','status','--short'],cwd=demo,stdout=subprocess.PIPE,text=True); out.write('$ git status --short\n'+r.stdout)
 files=[]
 for f in sorted(demo.rglob('*')):
  if f.is_file() and '.git' not in f.relative_to(demo).parts:
   files.append({'path':str(f.relative_to(demo)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
 (ev/'files-written.json').write_text(json.dumps(files,indent=2)+'\n')
print('Recorded search, pull, re-pull and',len(files),'real files')
