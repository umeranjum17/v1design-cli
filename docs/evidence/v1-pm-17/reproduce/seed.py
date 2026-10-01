import os, subprocess, pathlib
root=pathlib.Path.cwd()
env={'PATH':os.environ['PATH'],'HOME':str(root/'scratchpad/demo-home'),'NODE_ENV':'development'}
r=subprocess.run(['node','--import','tsx','scripts/seed-library.mts','library/pulse','--force-list'],cwd=root/'scratchpad/engine',env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
(root/'data/v1-pm-17/evidence/seed.txt').write_text(r.stdout)
print('seed exit',r.returncode)
