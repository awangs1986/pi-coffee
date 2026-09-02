# Importing the PI Coffee handoff attachment

Use this only while the remote `main` branch is still empty. The attachment is a source snapshot without `.git`, `node_modules`, `dist`, or credentials.

```bash
mkdir pi-coffee-handoff
cd pi-coffee-handoff
curl -fLO http://testpc:3000/attachments/c69c6dc6-0a26-47f9-ad8a-60342f131e7d
tar -xzf pi-coffee-source-67f7d8c.tar.gz
npm install
npm run check
git init -b main
git add .
git -c user.name='<your name>' -c user.email='<your email>' commit -m 'chore: import PI Coffee handoff baseline'
git remote add origin http://testpc:3000/awangs/pi-coffee.git
git push -u origin main
```

If the owner has already pushed `main`, clone normally and do not overwrite it with the attachment. The handoff Issue is [#6](http://testpc:3000/awangs/pi-coffee/issues/6); post the resulting commit and `npm run check` output there before starting 0.1 work.
