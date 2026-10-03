const fs = require('fs');
const path = require('path');

const cfgPathPadPro = path.join(process.env.APPDATA, 'pad-pro', 'config', 'padpro-config.json');
const cfgPathLegacy = path.join(process.env.APPDATA, 'pad-pro', 'config', 'sharkropad-config.json');
const cfgPath = fs.existsSync(cfgPathPadPro) ? cfgPathPadPro : cfgPathLegacy;
const splPath = path.join(process.env.APPDATA, 'Leppsoft', 'soundlist.spl');

const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

// Parse soundlist.spl
const soundMap = {};
if (fs.existsSync(splPath)) {
  const content = fs.readFileSync(splPath, 'utf8');
  const tagRegex = /<Sound\b([^>]*)\/?>/g;
  let m;
  while ((m = tagRegex.exec(content)) !== null) {
    const attrs = m[1];
    const titleM = attrs.match(/title="([^"]*)"/);
    const keyM = attrs.match(/key="(\d+)"/);
    const modM = attrs.match(/keyModifiers="(\d+)"/);
    if (titleM && keyM) {
      const vk = parseInt(keyM[1]);
      const mod = modM ? parseInt(modM[1]) : 0;
      let keyName = '';
      if (vk >= 124 && vk <= 135) keyName = 'F' + (vk - 111);

      let parts = [];
      if (mod & 2) parts.push('Ctrl');
      if (mod & 4) parts.push('Shift');
      if (mod & 1) parts.push('Alt');
      if (keyName) parts.push(keyName);

      const fullKey = parts.join(' + ');
      const cleanTitle = titleM[1].replace(/y2meta\.com\s*-\s*/i, '').trim();
      if (fullKey) soundMap[fullKey] = cleanTitle;
      if (keyName && !soundMap[keyName]) soundMap[keyName] = cleanTitle;
    }
  }
}

config.soundpad_sounds = soundMap;

// Write to D:\config.json
if (fs.existsSync('D:\\code.py')) {
  fs.writeFileSync('D:\\config.json', JSON.stringify(config, null, 2), 'utf8');
  console.log('Gravado em D:\\config.json com sucesso!');
  console.log('Mapeamento de sons:', soundMap);
} else {
  console.log('D:\\code.py nao encontrado!');
}
