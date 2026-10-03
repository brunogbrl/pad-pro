const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const gitDir = path.join(process.env.USERPROFILE || 'C:\\Users\\bruno', '.git-repos', 'pad-pro.git');

function getCredentials() {
  try {
    const input = 'protocol=https\nhost=github.com\n\n';
    const out = execSync(`git --git-dir="${gitDir}" credential fill`, { input }).toString();
    const tokenMatch = out.match(/password=(.+)/);
    const userMatch = out.match(/username=(.+)/);
    return {
      token: tokenMatch ? tokenMatch[1].trim() : null,
      username: userMatch ? userMatch[1].trim() : null
    };
  } catch (e) {
    console.error('Erro ao ler credenciais do Git:', e.message);
    return { token: null, username: null };
  }
}

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: parsed });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'object' ? JSON.stringify(parsed) : parsed}`));
        }
      });
    });
    req.on('error', reject);
    if (data) {
      if (Buffer.isBuffer(data)) {
        req.write(data);
      } else if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function main() {
  console.log('1. Obtendo credenciais do GitHub...');
  const { token, username } = getCredentials();
  if (!token) {
    throw new Error('Não foi possível obter o token de acesso do GitHub via Git Credential Manager.');
  }
  console.log(`Autenticado como: ${username}`);

  const owner = 'brunogbrl';
  const repo = 'pad-pro';
  const tag = 'v1.0.4';

  console.log(`2. Criando / Verificando Release no repositório ${owner}/${repo} para tag ${tag}...`);

  let release = null;
  try {
    const createRes = await request({
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases`,
      method: 'POST',
      headers: {
        'User-Agent': 'PAD-Pro-Deployer',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    }, {
      tag_name: tag,
      target_commitish: 'main',
      name: `PAD Pro ${tag}`,
      body: `## 🚀 PAD Pro ${tag}\n\nInstalador executável oficial do PAD Pro para Windows com suporte à nova Central de Atualizações, personalização visual e integrações completas.\n\n### 📦 Download:\nBaixe o arquivo **PAD Pro 1.0.4.exe** abaixo e execute diretamente no seu Windows.`,
      draft: false,
      prerelease: false
    });
    release = createRes.data;
    console.log(`Release criada com sucesso! ID: ${release.id}`);
  } catch (err) {
    if (err.message.includes('already_exists')) {
      console.log('Release já existe. Obtendo dados da release existente...');
      const getRes = await request({
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases/tags/${tag}`,
        method: 'GET',
        headers: {
          'User-Agent': 'PAD-Pro-Deployer',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      release = getRes.data;
    } else {
      throw err;
    }
  }

  // 3. Upload binary asset
  const exePath = path.join(__dirname, '..', 'dist', 'PAD Pro 1.0.4.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error(`Arquivo executável não encontrado em: ${exePath}`);
  }

  const stat = fs.statSync(exePath);
  const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(1);
  console.log(`\n3. Fazendo upload do executável (${fileSizeMB} MB)...`);
  console.log(`Origem: ${exePath}`);

  // Delete asset if already exists in release
  if (release.assets && release.assets.length > 0) {
    const existing = release.assets.find(a => a.name === 'PAD Pro 1.0.4.exe');
    if (existing) {
      console.log(`Removendo asset anterior (ID ${existing.id})...`);
      await request({
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases/assets/${existing.id}`,
        method: 'DELETE',
        headers: {
          'User-Agent': 'PAD-Pro-Deployer',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
    }
  }

  const uploadUrl = new URL(release.upload_url.replace('{?name,label}', ''));
  uploadUrl.searchParams.set('name', 'PAD Pro 1.0.4.exe');

  const fileBuffer = fs.readFileSync(exePath);

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrl.hostname,
      path: uploadUrl.pathname + uploadUrl.search,
      method: 'POST',
      headers: {
        'User-Agent': 'PAD-Pro-Deployer',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`\n🎉 Upload concluído com sucesso! (HTTP ${res.statusCode})`);
          resolve();
        } else {
          reject(new Error(`Erro no upload: HTTP ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });

  console.log(`\n======================================================`);
  console.log(`  ✅ RELEASE PUBLICADA COM SUCESSO NO GITHUB!`);
  console.log(`  Acesse agora: https://github.com/${owner}/${repo}/releases`);
  console.log(`======================================================\n`);
}

main().catch(err => {
  console.error('\n❌ Falha ao publicar release:', err.message);
  process.exit(1);
});
