const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

async function main() {
  const rootDir = path.join(__dirname, '..');
  const tempDir = path.join(os.tmpdir(), 'pad-pro-build');
  const targetDist = path.join(rootDir, 'dist');

  console.log(`\n========================================`);
  console.log(`  🔨 COMPILANDO INSTALADOR OFICIAL PAD PRO`);
  console.log(`========================================\n`);

  console.log(`1. Preparando diretório limpo no disco local C: (${tempDir})...`);
  if (fs.existsSync(tempDir)) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(tempDir, { recursive: true });

  console.log('2. Copiando arquivos do projeto...');
  const filesToCopy = ['package.json', 'main.js', 'preload.js', 'preload-hud.js'];
  for (const f of filesToCopy) {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tempDir, f));
  }

  const cpOpts = {
    recursive: true,
    filter: (src) => !path.basename(src).toLowerCase().startsWith('desktop.ini')
  };

  const dirsToCopy = ['src', 'locales', 'scripts', 'build'];
  for (const d of dirsToCopy) {
    const src = path.join(rootDir, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tempDir, d), cpOpts);
  }

  console.log('\n3. Instalando dependências limpas no SSD local...');
  execSync('npm install --no-audit', { cwd: tempDir, stdio: 'inherit' });

  console.log('\n4. Executando electron-builder (gerando instalador NSIS para Windows)...');
  execSync('npx electron-builder --win', { cwd: tempDir, stdio: 'inherit' });

  console.log('\n5. Copiando instalador gerado para a pasta dist do projeto...');
  const builtDist = path.join(tempDir, 'dist');
  if (fs.existsSync(builtDist)) {
    if (!fs.existsSync(targetDist)) fs.mkdirSync(targetDist, { recursive: true });
    
    const entries = fs.readdirSync(builtDist, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && (entry.name.endsWith('.exe') || entry.name.endsWith('.yml'))) {
        const srcFile = path.join(builtDist, entry.name);
        const destFile = path.join(targetDist, entry.name);
        console.log(`-> Copiando: ${entry.name}`);
        fs.copyFileSync(srcFile, destFile);
      }
    }

    // Copy win-unpacked as well
    const winUnpacked = path.join(builtDist, 'win-unpacked');
    if (fs.existsSync(winUnpacked)) {
      console.log('-> Atualizando win-unpacked...');
      fs.cpSync(winUnpacked, path.join(targetDist, 'win-unpacked'), cpOpts);
    }
  }

  console.log(`\n========================================`);
  console.log(`  ✅ COMPILAÇÃO CONCLUÍDA COM SUCESSO!`);
  console.log(`  Arquivos salvos em: ${targetDist}`);
  console.log(`========================================\n`);
}

main().catch(err => {
  console.error('\n❌ Erro na compilação:', err);
  process.exit(1);
});
