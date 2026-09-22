# Builds a source-only deploy zip of twk-db-agent for EasyPanel.
# Uses $PSScriptRoot so accented paths ("Área") don't mojibake under PS 5.1.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $PSScriptRoot 'twk-db-agent'
$out = Join-Path $PSScriptRoot 'twk-db-agent-deploy.zip'

# Directories (any depth) and file patterns to exclude from the deploy bundle.
$excludeDirs = @('node_modules', '.next', '.git', '.claude', 'audit-output')
$excludeFile = {
    param($rel, $name)
    if ($name -like '.env*') { return $true }
    if ($name -like '*.log') { return $true }
    if ($name -like '*.tsbuildinfo') { return $true }
    if ($name -like '*.zip') { return $true }
    return $false
}

if (Test-Path $out) { Remove-Item $out -Force }

$srcFull = (Resolve-Path $src).Path
$prefixLen = $srcFull.Length + 1

$files = Get-ChildItem -Path $srcFull -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($prefixLen)
    $parts = $rel -split '[\\/]'
    $inExcludedDir = $false
    foreach ($p in $parts[0..($parts.Length - 2)]) {
        if ($excludeDirs -contains $p) { $inExcludedDir = $true; break }
    }
    if ($inExcludedDir) { return $false }
    if (& $excludeFile $rel $_.Name) { return $false }
    return $true
}

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $files) {
        $entryName = $f.FullName.Substring($prefixLen) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

$sizeKB = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output ("OK: {0} arquivos -> {1} ({2} KB)" -f $files.Count, $out, $sizeKB)
