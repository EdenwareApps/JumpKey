const { existsSync, statSync, unlinkSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const candidates = ['dist', 'build'];
const sourceSubdir = 'unpacked';
const sourceDir = candidates
  .map((dir) => join(dir, sourceSubdir))
  .find((dir) => existsSync(dir) && statSync(dir).isDirectory());

if (!sourceDir) {
  console.error('Nenhum diretório de empacotamento encontrado. Crie "dist/unpacked/" ou "build/unpacked/" com os arquivos da extensão.');
  process.exit(1);
}

const outputZip = join(sourceDir, '..', 'JumpKey.zip');

if (existsSync(outputZip)) {
  unlinkSync(outputZip);
}

const args = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -Path (Join-Path -Path (Resolve-Path '${sourceDir}') -ChildPath '*') -DestinationPath '${outputZip}' -Force`
];

const result = spawnSync('powershell.exe', args, { stdio: 'inherit' });

if (result.error) {
  console.error('Falha ao executar o empacotamento:', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status);
}

console.log(`Zip gerado em ${outputZip}`);
