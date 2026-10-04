const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function main() {
  const asarPath = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
  const installedAsarPath = 'C:\\Users\\bruno\\AppData\\Local\\Programs\\PAD Pro\\resources\\app.asar';
  const tempExtract = path.join(__dirname, '..', 'dist', 'temp-asar');

  if (!fs.existsSync(path.join(tempExtract, 'node_modules', 'electron-updater'))) {
    console.log('Extracting fresh asar from:', asarPath);
    if (fs.existsSync(tempExtract)) {
      try { fs.rmSync(tempExtract, { recursive: true, force: true }); } catch {}
    }
    execSync(`npx --yes @electron/asar extract "${asarPath}" "${tempExtract}"`, { stdio: 'inherit' });
  } else {
    console.log('Reusing existing node_modules in tempExtract...');
  }

  console.log('Copying modified files into extracted asar directory...');
  // Copy main.js & preload.js
  fs.copyFileSync(path.join(__dirname, '..', 'main.js'), path.join(tempExtract, 'main.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'preload.js'), path.join(tempExtract, 'preload.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'preload-hud.js'), path.join(tempExtract, 'preload-hud.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(tempExtract, 'package.json'));

  const cpOptions = {
    recursive: true,
    filter: (src) => !path.basename(src).toLowerCase().startsWith('desktop.ini')
  };

  // Copy src/ recursively (including services, components, etc.)
  const srcDir = path.join(__dirname, '..', 'src');
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(tempExtract, 'src'), cpOptions);
  }

  // Copy locales/
  const localesDir = path.join(__dirname, '..', 'locales');
  if (fs.existsSync(localesDir)) {
    fs.cpSync(localesDir, path.join(tempExtract, 'locales'), cpOptions);
  }

  // Copy scripts/ (includes code.py for firmware sync)
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  if (fs.existsSync(scriptsDir)) {
    fs.cpSync(scriptsDir, path.join(tempExtract, 'scripts'), cpOptions);
  }

  // Copy build/ (icons, assets)
  const buildDir = path.join(__dirname, '..', 'build');
  if (fs.existsSync(buildDir)) {
    fs.cpSync(buildDir, path.join(tempExtract, 'build'), cpOptions);
  }

  // Ensure no desktop.ini remains in tempExtract
  function cleanDesktopIni(dir) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          cleanDesktopIni(p);
        } else if (entry.name.toLowerCase() === 'desktop.ini') {
          try { fs.rmSync(p, { force: true }); } catch {}
        }
      }
    } catch {}
  }
  cleanDesktopIni(tempExtract);

  console.log('Repacking asar to:', asarPath);
  execSync(`npx --yes @electron/asar pack "${tempExtract}" "${asarPath}"`, { stdio: 'inherit' });

  if (fs.existsSync(installedAsarPath)) {
    console.log('Updating installed app asar at:', installedAsarPath);
    try {
      fs.copyFileSync(asarPath, installedAsarPath);
      console.log('Installed app asar updated successfully!');
    } catch (err) {
      console.warn('Could not copy directly to installed app (process running?):', err.message);
    }
  }

  console.log('SUCCESS: app.asar updated successfully!');
}

main().catch(err => {
  console.error('ERROR in pack-app:', err);
  process.exit(1);
});
