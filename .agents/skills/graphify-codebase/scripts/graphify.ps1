[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("status", "build", "update", "view", "query", "explain", "affected", "path", "god-nodes", "diagnose", "benchmark")]
    [string]$Action = "status",

    [Parameter(Position = 1)]
    [string]$Text,

    [Parameter(Position = 2)]
    [string]$To,

    [ValidateRange(1, 4)]
    [int]$Depth = 2,

    [ValidateRange(250, 10000)]
    [int]$Budget = 2000,

    [ValidateRange(1, 100)]
    [int]$Top = 15,

    [switch]$Force,

    [switch]$NoOpen
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GraphifyVersion = "0.9.31"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$repoIdentityHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $repoIdentityBytes = [System.Text.Encoding]::UTF8.GetBytes($RepoRoot.ToLowerInvariant())
    $repoIdentityHash = [System.BitConverter]::ToString($repoIdentityHasher.ComputeHash($repoIdentityBytes)).Replace("-", "").ToLowerInvariant()
}
finally {
    $repoIdentityHasher.Dispose()
}
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw "A local application-data directory is required for Graphify state."
}
$StateRoot = Join-Path $localAppData "Codex\graphify\market-diagnostic-dashboard-$($repoIdentityHash.Substring(0, 12))"
$ToolRoot = Join-Path $StateRoot "tool\$GraphifyVersion"
$VenvRoot = Join-Path $ToolRoot "venv"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$GraphifyExe = Join-Path $VenvRoot "Scripts\graphify.exe"
$OutputRoot = Join-Path $StateRoot "state\$GraphifyVersion"
$GraphPath = Join-Path $OutputRoot "graphify-out\graph.json"
$ReceiptPath = Join-Path $OutputRoot "graphify-out\codex-receipt.json"
$ViewerBuilder = Join-Path $PSScriptRoot "build-constellation-viewer.mjs"
$ViewerPath = Join-Path $OutputRoot "graphify-out\ARCHITECTURE_CONSTELLATION.html"

# Graphify v0.9.31 is opt-in for query logs. Force the setting off so a caller's
# user-level environment cannot record proprietary questions outside the repo.
$env:GRAPHIFY_QUERY_LOG_DISABLE = "1"

function Get-BootstrapPython {
    $repoPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $repoPython) {
        return $repoPython
    }

    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return $pythonCommand.Source
    }

    throw "Python 3.10 or newer is required to bootstrap Graphify."
}

function Get-TextSha256 {
    param([AllowEmptyString()][string]$Value)

    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return [System.BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $hasher.Dispose()
    }
}

function Get-WorkspaceFingerprint {
    $LASTEXITCODE = 0
    $head = (& git -C $RepoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($head)) {
        throw "Unable to read the repository HEAD for the Graphify receipt."
    }

    $branch = (& git -C $RepoRoot branch --show-current 2>$null | Select-Object -First 1)
    $statusLines = @(& git -C $RepoRoot status --porcelain=v1 --untracked-files=all)
    $dirtyPaths = @(
        @(
            & git -C $RepoRoot -c core.quotepath=false diff --name-only HEAD -- 2>$null
            & git -C $RepoRoot -c core.quotepath=false ls-files --others --exclude-standard 2>$null
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique
    )
    $pathFingerprints = foreach ($relativePath in $dirtyPaths) {
        $fullPath = Join-Path $RepoRoot $relativePath
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            "$relativePath`:$((Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant())"
        }
        else {
            "$relativePath`:<deleted-or-non-file>"
        }
    }
    $diffSummary = @(& git -C $RepoRoot -c core.quotepath=false diff --summary HEAD -- 2>$null)
    $fingerprintPayload = @(
        ($statusLines | Sort-Object) -join "`n"
        $pathFingerprints -join "`n"
        $diffSummary -join "`n"
    ) -join "`n--`n"

    return [PSCustomObject]@{
        Head = $head.Trim()
        Branch = if ([string]::IsNullOrWhiteSpace($branch)) { "(detached)" } else { $branch.Trim() }
        WorktreeHash = Get-TextSha256 -Value $fingerprintPayload
        DirtyPathCount = $dirtyPaths.Count
    }
}

function Write-Receipt {
    $fingerprint = Get-WorkspaceFingerprint
    $receiptDirectory = Split-Path -Parent $ReceiptPath
    New-Item -ItemType Directory -Force -Path $receiptDirectory | Out-Null
    [ordered]@{
        schema_version = 2
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        graphify_version = $GraphifyVersion
        repo_root = $RepoRoot
        git_branch = $fingerprint.Branch
        git_head = $fingerprint.Head
        worktree_status_sha256 = $fingerprint.WorktreeHash
        dirty_path_count = $fingerprint.DirtyPathCount
    } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptPath -Encoding utf8
}

function Ensure-Graphify {
    if ((Test-Path -LiteralPath $GraphifyExe) -and (Test-Path -LiteralPath $VenvPython)) {
        $LASTEXITCODE = 0
        $reportedVersion = (& $GraphifyExe --version 2>$null | Select-Object -First 1)
        $versionIsCurrent = $LASTEXITCODE -eq 0 -and $reportedVersion -eq "graphify $GraphifyVersion"
        $LASTEXITCODE = 0
        & $VenvPython -c "import tree_sitter_sql" 2>$null
        $sqlParserIsInstalled = $LASTEXITCODE -eq 0
        if ($versionIsCurrent -and $sqlParserIsInstalled) {
            return
        }
    }

    $bootstrapPython = Get-BootstrapPython
    $pythonVersion = (& $bootstrapPython -c "import sys; print('.'.join(map(str, sys.version_info[:3])))").Trim()
    if ([version]$pythonVersion -lt [version]"3.10") {
        throw "Python $pythonVersion is too old; Graphify requires Python 3.10 or newer."
    }

    New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
    $LASTEXITCODE = 0
    & $bootstrapPython -m venv $VenvRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the isolated Graphify environment."
    }

    $LASTEXITCODE = 0
    & $VenvPython -m pip install --disable-pip-version-check --no-input "graphifyy[sql]==$GraphifyVersion"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install graphifyy==$GraphifyVersion."
    }
}

function Invoke-Graphify {
    param([string[]]$CommandArguments)

    $LASTEXITCODE = 0
    & $GraphifyExe @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Graphify exited with code $LASTEXITCODE."
    }
}

function Remove-WorkspaceStatIndexScratch {
    # v0.9.31 writes a small target-root stat index during incremental scans even
    # when --out points elsewhere. Remove only that exact one-file scratch tree;
    # preserve any fuller graphify-out directory a person may have created.
    $scratchRoot = Join-Path $RepoRoot "graphify-out"
    if (-not (Test-Path -LiteralPath $scratchRoot)) {
        return
    }

    $resolvedScratch = (Resolve-Path -LiteralPath $scratchRoot).Path
    if (-not $resolvedScratch.StartsWith($RepoRoot + [IO.Path]::DirectorySeparatorChar)) {
        throw "Refusing to clean out-of-repository Graphify scratch state: $resolvedScratch"
    }

    $scratchFiles = @(Get-ChildItem -LiteralPath $resolvedScratch -Recurse -File)
    $expectedFile = Join-Path $resolvedScratch "cache\stat-index.json"
    if ($scratchFiles.Count -eq 1 -and $scratchFiles[0].FullName -eq $expectedFile) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}

function Require-Graph {
    if (-not (Test-Path -LiteralPath $GraphPath)) {
        throw "No local graph exists. Run '.\.agents\skills\graphify-codebase\scripts\graphify.ps1 build' first."
    }
}

function Get-NodeExecutable {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw "Node.js is required to generate the local architecture constellation."
    }
    return $nodeCommand.Source
}

function Require-Text {
    param([string]$Value, [string]$Name)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "-$Name is required for '$Action'."
    }
}

function Write-Status {
    $installed = "not installed"
    if (Test-Path -LiteralPath $GraphifyExe) {
        $installed = (& $GraphifyExe --version 2>$null | Select-Object -First 1)
    }

    Write-Output "Tool:  $installed"
    Write-Output "Pin:   graphifyy[sql]==$GraphifyVersion"
    Write-Output "Mode:  local code-only AST; no clustering or query logging"
    Write-Output "State: $StateRoot"

    if (Test-Path -LiteralPath $GraphPath) {
        $graphFile = Get-Item -LiteralPath $GraphPath
        $sizeMiB = [math]::Round($graphFile.Length / 1MB, 2)
        Write-Output "Graph: $GraphPath"
        Write-Output "Built: $($graphFile.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
        Write-Output "Size:  $sizeMiB MiB"

        if (Test-Path -LiteralPath $ReceiptPath) {
            try {
                $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
                $current = Get-WorkspaceFingerprint
                $headMatches = $receipt.git_head -eq $current.Head
                $worktreeMatches = $receipt.worktree_status_sha256 -eq $current.WorktreeHash
                $versionMatches = $receipt.graphify_version -eq $GraphifyVersion
                $schemaMatches = $receipt.schema_version -eq 2
                Write-Output "Branch: $($current.Branch)"
                Write-Output "HEAD:   $($current.Head.Substring(0, 12))"
                if ($headMatches -and $worktreeMatches -and $versionMatches -and $schemaMatches) {
                    Write-Output "Fresh:  yes (HEAD and working-tree fingerprint match)"
                }
                else {
                    Write-Output "Fresh:  no - run the update action before relying on the graph"
                }
            }
            catch {
                Write-Output "Fresh:  unknown - receipt is unreadable; run the update action"
            }
        }
        else {
            Write-Output "Fresh:  unknown - no receipt; run the update action"
        }
    }
    else {
        Write-Output "Graph: not built"
    }
}

switch ($Action) {
    "status" {
        Write-Status
    }
    "build" {
        Ensure-Graphify
        New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
        $arguments = @("extract", $RepoRoot, "--code-only", "--no-cluster", "--out", $OutputRoot)
        if ($Force) {
            $arguments += "--force"
        }
        Invoke-Graphify $arguments
        Remove-WorkspaceStatIndexScratch
        Write-Receipt
        Write-Status
    }
    "update" {
        Ensure-Graphify
        Require-Graph
        # Reuse the same privacy and output flags as the initial build. `extract`
        # is manifest-incremental once graphify-out exists; this avoids drift
        # between the full-extract and separate update code paths.
        $arguments = @("extract", $RepoRoot, "--code-only", "--no-cluster", "--out", $OutputRoot)
        if ($Force) {
            $arguments += "--force"
        }
        Invoke-Graphify $arguments
        Remove-WorkspaceStatIndexScratch
        Write-Receipt
        Write-Status
    }
    "view" {
        Require-Graph
        if (-not (Test-Path -LiteralPath $ViewerBuilder)) {
            throw "Constellation viewer builder is missing: $ViewerBuilder"
        }
        $viewerNeedsRefresh = -not (Test-Path -LiteralPath $ViewerPath)
        if (-not $viewerNeedsRefresh) {
            $viewerModified = (Get-Item -LiteralPath $ViewerPath).LastWriteTimeUtc
            $viewerNeedsRefresh = (Get-Item -LiteralPath $GraphPath).LastWriteTimeUtc -gt $viewerModified -or
                (Get-Item -LiteralPath $ViewerBuilder).LastWriteTimeUtc -gt $viewerModified
        }
        if ($viewerNeedsRefresh) {
            $nodeExecutable = Get-NodeExecutable
            $LASTEXITCODE = 0
            & $nodeExecutable $ViewerBuilder `
                --graph $GraphPath `
                --output $ViewerPath `
                --repo $RepoRoot `
                --label "Market Diagnostic Dashboard"
            if ($LASTEXITCODE -ne 0) {
                throw "Architecture constellation generation exited with code $LASTEXITCODE."
            }
        }
        Write-Output "Viewer: $ViewerPath"
        if (-not $NoOpen) {
            Start-Process -FilePath $ViewerPath
        }
    }
    "query" {
        Ensure-Graphify
        Require-Graph
        Require-Text -Value $Text -Name "Text"
        Invoke-Graphify @("query", $Text, "--budget", "$Budget", "--graph", $GraphPath)
    }
    "explain" {
        Ensure-Graphify
        Require-Graph
        Require-Text -Value $Text -Name "Text"
        Invoke-Graphify @("explain", $Text, "--graph", $GraphPath)
    }
    "affected" {
        Ensure-Graphify
        Require-Graph
        Require-Text -Value $Text -Name "Text"
        Invoke-Graphify @("affected", $Text, "--depth", "$Depth", "--graph", $GraphPath)
    }
    "path" {
        Ensure-Graphify
        Require-Graph
        Require-Text -Value $Text -Name "Text"
        Require-Text -Value $To -Name "To"
        Invoke-Graphify @("path", $Text, $To, "--graph", $GraphPath)
    }
    "god-nodes" {
        Ensure-Graphify
        Require-Graph
        Invoke-Graphify @("god-nodes", "--top", "$Top", "--graph", $GraphPath)
    }
    "diagnose" {
        Ensure-Graphify
        Require-Graph
        Invoke-Graphify @("diagnose", "multigraph", "--graph", $GraphPath, "--json")
    }
    "benchmark" {
        Ensure-Graphify
        Require-Graph
        Invoke-Graphify @("benchmark", $GraphPath)
    }
}
