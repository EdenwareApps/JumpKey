const {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync
} = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const rootDir = resolve('.');
const distDir = join(rootDir, 'dist');
const sourceDir = join(distDir, 'unpacked');
const outputZip = join(distDir, 'JumpKey.zip');
const allowedRootUnderscoreNames = new Set(['_locales']);

const defaultRootExcludes = new Set([
  '.git',
  '.github',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'scripts',
  '.gitignore',
  'package.json',
  'package-lock.json',
  'test-youtube-duration.html',
  'test-youtube-duration-server.js'
]);

function shouldExclude(sourcePath, baseName, isRootLevel) {
  if (baseName.endsWith('.log')) {
    return true;
  }

  if (isRootLevel && defaultRootExcludes.has(baseName)) {
    return true;
  }

  // Never copy nested VCS metadata into package.
  if (!isRootLevel && baseName === '.git') {
    return true;
  }

  return false;
}

function copyRecursive(srcPath, dstPath, isRootLevel = false) {
  const stat = lstatSync(srcPath);
  const baseName = srcPath.split(/[\\/]/).pop();

  if (shouldExclude(srcPath, baseName, isRootLevel)) {
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(dstPath, { recursive: true });
    const entries = readdirSync(srcPath);
    for (const entry of entries) {
      copyRecursive(join(srcPath, entry), join(dstPath, entry), false);
    }
    return;
  }

  copyFileSync(srcPath, dstPath);
}

function syncSourceFolder() {
  mkdirSync(distDir, { recursive: true });
  rmSync(sourceDir, { recursive: true, force: true });
  mkdirSync(sourceDir, { recursive: true });

  const rootEntries = readdirSync(rootDir);
  for (const entry of rootEntries) {
    copyRecursive(join(rootDir, entry), join(sourceDir, entry), true);
  }
}

function validateSyncedPackage() {
  const manifestPath = join(sourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json ausente em ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`manifest.json invalido: ${error.message}`);
  }

  const requiredFields = ['manifest_version', 'name', 'version'];
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      throw new Error(`manifest.json sem campo obrigatorio: ${field}`);
    }
  }

  if (manifest.manifest_version !== 3) {
    throw new Error(`manifest_version inesperado (${manifest.manifest_version}). Esperado: 3`);
  }

  const localesDir = join(sourceDir, '_locales');
  if (!existsSync(localesDir) || !lstatSync(localesDir).isDirectory()) {
    throw new Error(`Diretorio obrigatorio ausente: ${localesDir}`);
  }

  const rootEntries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.name.startsWith('_')) {
      continue;
    }

    if (!allowedRootUnderscoreNames.has(entry.name)) {
      throw new Error(`Entrada invalida no pacote: ${entry.name}. Apenas _locales e permitido na raiz com prefixo "_".`);
    }
  }

  const localeFolders = readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (localeFolders.length === 0) {
    throw new Error('Nenhum locale encontrado em _locales');
  }

  for (const locale of localeFolders) {
    const messagesPath = join(localesDir, locale, 'messages.json');
    if (!existsSync(messagesPath) || !lstatSync(messagesPath).isFile()) {
      throw new Error(`messages.json ausente para locale ${locale}`);
    }
  }
}

function validateZipEntries() {
  const inspectZipCommand = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [IO.Compression.ZipFile]::OpenRead('${resolve(outputZip)}')`,
    'try {',
    '  $entries = $zip.Entries | ForEach-Object { $_.FullName }',
    '  $invalid = $entries | Where-Object { $_ -match "^_locales@" -or $_ -match "^_[^/\\\\]+@" }',
    '  if ($invalid) { throw "ZIP contem entradas com flattening invalido: $($invalid -join ", ")" }',
    '  $messages = $entries | Where-Object { $_ -match "^_locales[/\\\\][^/\\\\]+[/\\\\]messages\\.json$" }',
    '  if (-not $messages) { throw "ZIP sem arquivos _locales/*/messages.json" }',
    '} finally {',
    '  $zip.Dispose()',
    '}'
  ].join('; ');

  const inspectResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', inspectZipCommand], { stdio: 'inherit' });

  if (inspectResult.error) {
    throw new Error(`Falha ao validar entradas do ZIP: ${inspectResult.error.message}`);
  }

  if (inspectResult.status !== 0) {
    process.exit(inspectResult.status);
  }
}

syncSourceFolder();
validateSyncedPackage();

if (existsSync(outputZip)) {
  unlinkSync(outputZip);
}

const zipCommandSafe = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.IO.Compression',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  `$sourceRoot = (Resolve-Path '${sourceDir}').Path`,
  `$output = '${resolve(outputZip)}'`,
  '$files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File',
  'if (-not $files) { throw "Nenhum arquivo encontrado para compactar." }',
  '$fileStream = [System.IO.File]::Open($output, [System.IO.FileMode]::Create)',
  'try {',
  '  $archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create)',
  '  try {',
  '    foreach ($file in $files) {',
  "      $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\\', '/').Replace('\\', '/')",
  '      if ([string]::IsNullOrWhiteSpace($relative)) { continue }',
  '      $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)',
  '      $entryStream = $entry.Open()',
  '      try {',
  '        $inputStream = [System.IO.File]::OpenRead($file.FullName)',
  '        try {',
  '          $inputStream.CopyTo($entryStream)',
  '        } finally {',
  '          $inputStream.Dispose()',
  '        }',
  '      } finally {',
  '        $entryStream.Dispose()',
  '      }',
  '    }',
  '  } finally {',
  '    $archive.Dispose()',
  '  }',
  '} finally {',
  '  $fileStream.Dispose()',
  '}'
].join('; ');

const args = ['-NoProfile', '-NonInteractive', '-Command', zipCommandSafe];

const result = spawnSync('powershell.exe', args, { stdio: 'inherit' });

if (result.error) {
  console.error('Falha ao executar o empacotamento:', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status);
}

validateZipEntries();

console.log(`Pasta sincronizada em ${resolve(sourceDir)}`);
console.log(`Zip gerado em ${resolve(outputZip)}`);
