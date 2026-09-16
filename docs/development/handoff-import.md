# Importing the PI Coffee handoff attachment

Use this only while the remote `main` branch is still empty. The attachment is a source snapshot without `.git`, `node_modules`, `dist`, or credentials.

```bash
mkdir pi-coffee-handoff
cd pi-coffee-handoff
SOURCE_URL='paste the latest source tar.gz URL shown in Issue #6'
curl -fL "$SOURCE_URL" -o source.tar.gz
tar -xzf source.tar.gz
npm install
npm run check
git init -b main
git add .
git -c user.name='<your name>' -c user.email='<your email>' commit -m 'chore: import PI Coffee handoff baseline'
git remote add origin http://testpc:3000/awangs/pi-coffee.git
git push -u origin main
```

If the owner has already pushed `main`, clone normally and do not overwrite it with an attachment. The handoff Issue is [#6](http://testpc:3000/awangs/pi-coffee/issues/6); choose the attachment marked “latest” there, then post the resulting commit and `npm run check` output before starting 0.1 work.
