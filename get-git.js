const fs = require('fs');
const cp = require('child_process');

try {
  const diffStatus = cp.execSync('git status').toString();
  const diff = cp.execSync('git diff').toString();
  fs.writeFileSync('git-output.txt', diffStatus + '\n\n---\n\n' + diff);
} catch (e) {
  fs.writeFileSync('git-output.txt', 'Error: ' + e.toString() + ' \n stdout: ' + e.stdout + ' \n stderr: ' + e.stderr);
}
