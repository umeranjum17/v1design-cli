import os,pathlib,subprocess,secrets,signal,time
root=pathlib.Path.cwd(); scratch=root/'scratchpad'
env={'PATH':os.environ['PATH'],'HOME':str(scratch/'demo-home'),'NODE_ENV':'development','ENGINE_SERVICE_TOKEN':secrets.token_hex(32)}
children=[]
try:
 for folder,cmd,extra in [('engine',['node','--import','tsx','bin/engine.mjs'],{'PORT':'18917'}),('web',['node','node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','18918'],{'ENGINE_URL':'http://localhost:18917','NEXT_PUBLIC_ENGINE_PUBLIC_URL':'http://localhost:18917','NEXT_PUBLIC_LIBRARY_ENABLED':'1'})]:
  log=open(scratch/(folder+'-server.log'),'w'); children.append(subprocess.Popen(cmd,cwd=scratch/folder,env=env|extra,stdout=log,stderr=log))
 print('isolated localhost engine 18917 / development website 18918',flush=True)
 while all(p.poll() is None for p in children): time.sleep(1)
finally:
 for p in children:
  if p.poll() is None: p.terminate()
 for p in children:
  try: p.wait(timeout=8)
  except subprocess.TimeoutExpired: p.kill()
