const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Determine git command with git-dir if needed
const gitDir = path.join(process.env.USERPROFILE || 'C:\\Users\\bruno', '.git-repos', 'pad-pro.git');
const hasExternalGit = fs.existsSync(gitDir);
const gitCmd = hasExternalGit ? `git --git-dir="${gitDir}"` : 'git';

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

function main() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = 'v' + pkg.version;

  console.log(`\n========================================`);
  console.log(`  🚀 INICIANDO DEPLOY DO PAD PRO (${version})`);
  console.log(`========================================\n`);

  // 1. Stage and commit any outstanding changes
  try {
    run(`${gitCmd} add .`);
    run(`${gitCmd} commit -m "chore(release): ${version}"`);
  } catch {
    console.log('Nenhuma alteração pendente para commit.');
  }

  // 2. Push main to origin
  console.log('\nEnviando commits para o GitHub...');
  run(`${gitCmd} push origin main`);

  // 3. Create or update git tag
  console.log(`\nCriando tag de versão: ${version}...`);
  try {
    run(`${gitCmd} tag -a ${version} -m "Release ${version}"`);
  } catch {
    console.log(`Tag ${version} já existe localmente, atualizando...`);
  }

  // 4. Push tag to GitHub (Triggers GitHub Actions CI/CD to build .exe and publish Release)
  console.log('\nDisparando GitHub Actions na nuvem (push tag)...');
  run(`${gitCmd} push origin ${version}`);

  console.log(`\n========================================`);
  console.log(`  ✅ DEPLOY CONCLUÍDO COM SUCESSO!`);
  console.log(`  Acompanhe o build do executável em:`);
  console.log(`  https://github.com/brunogbrl/pad-pro/actions`);
  console.log(`========================================\n`);
}

main();
