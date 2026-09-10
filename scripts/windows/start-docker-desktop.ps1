param([switch]$PrepareOnly, [switch]$ShowError)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DockerStartupProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq 'Docker Desktop' -or $_.ProcessName -eq 'com.docker.backend'
    })
}

function Assert-DockerDirectoryChain {
    param([Parameter(Mandatory = $true)][string]$Path)
    $cursor = [System.IO.Path]::GetFullPath($Path)
    while ($cursor) {
        try {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (-not $item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw 'Docker startup refused a runtime directory with a file, junction or symbolic-link ancestor.'
            }
        }
        catch [System.Management.Automation.ItemNotFoundException] {
            # Missing runtime directories are created only after all guards pass.
        }
        $parent = [System.IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-DockerRuntimePlan {
    param([string]$LocalData)
    $specifications = @(
        @{ Relative = 'Docker\run'; Pattern = '^(dockerInference|userAnalyticsOtlpHttp\.sock|sailor-ingest\.sock|dockerEthernetVfkit)(?:\.stale(?:[-.][A-Za-z0-9_-]+)?)?$' },
        @{ Relative = 'docker-secrets-engine'; Pattern = '^engine\.sock(?:\.stale(?:[-.][A-Za-z0-9_-]+)?)?$' }
    )
    foreach ($specification in $specifications) {
        $runtimePath = [System.IO.Path]::GetFullPath((Join-Path $LocalData $specification.Relative))
        if (-not $runtimePath.StartsWith($LocalData + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Docker startup refused a runtime path outside LocalAppData.'
        }
        Assert-DockerDirectoryChain -Path $runtimePath
        $contents = @()
        if (Test-Path -LiteralPath $runtimePath) {
            $contents = @(Get-ChildItem -LiteralPath $runtimePath -Force -ErrorAction Stop)
            foreach ($entry in $contents) {
                if ($entry.PSIsContainer -or $entry.Name -cnotmatch $specification.Pattern -or $entry.Length -ne 0) {
                    throw 'Docker startup found unexpected data in a runtime directory. Nothing was moved. Quit Docker Desktop and inspect its runtime folders manually; do not reset Docker data.'
                }
            }
        }
        [PSCustomObject]@{ Path = $runtimePath; HasSockets = $contents.Count -gt 0 }
    }
}

function Get-DockerDesktopExecutable {
    $locations = @()
    if ($env:ProgramFiles) { $locations += Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe' }
    if ($env:LOCALAPPDATA) { $locations += Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe' }
    foreach ($location in $locations) {
        if (Test-Path -LiteralPath $location -PathType Leaf) { return $location }
    }
    throw 'Docker Desktop was not found. Start your installed Docker Desktop manually or install it, then retry local startup.'
}

function Invoke-DockerDesktopStartup {
    param([switch]$PrepareOnly)
    if (-not $env:LOCALAPPDATA -or $env:LOCALAPPDATA -notmatch '^[A-Za-z]:\\') {
        throw 'Docker startup requires an absolute local-drive LocalAppData path.'
    }
    $localData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
    if (-not $localData.Equals($env:LOCALAPPDATA.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Docker startup refused a non-canonical LocalAppData path.'
    }
    Assert-DockerDirectoryChain -Path $localData
    if (-not (Test-Path -LiteralPath $localData -PathType Container)) {
        throw 'Docker startup requires an existing LocalAppData directory.'
    }
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $rootKey = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($localData.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) }
    finally { $hash.Dispose() }
    $mutex = [System.Threading.Mutex]::new($false, "Local\LiftLogDockerStartup-$sid-$rootKey")
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(3000) }
        catch [System.Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Another Docker startup is in progress. Wait for it to finish and retry.' }
        if (@(Get-DockerStartupProcesses).Count -gt 0) {
            return [PSCustomObject]@{ Status = 'AlreadyRunning'; QuarantinedDirectories = 0 }
        }
        $executable = if ($PrepareOnly) { $null } else { Get-DockerDesktopExecutable }
        # Validate both locations before moving either. Database disks, settings
        # and unknown files can never enter a quarantine plan.
        $plans = @(Get-DockerRuntimePlan -LocalData $localData)
        $quarantined = 0
        foreach ($plan in $plans) {
            if (@(Get-DockerStartupProcesses).Count -gt 0) {
                throw 'Docker started while preparing its runtime. No further folders were moved; wait for startup or quit Docker Desktop before retrying.'
            }
            Assert-DockerDirectoryChain -Path $plan.Path
            # Revalidate all contents immediately before moving a directory.
            $currentPlan = @(Get-DockerRuntimePlan -LocalData $localData | Where-Object { $_.Path -eq $plan.Path })[0]
            if ($currentPlan.HasSockets) {
                $parent = [System.IO.Path]::GetDirectoryName($plan.Path)
                $name = [System.IO.Path]::GetFileName($plan.Path) + '.stale-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
                $destination = [System.IO.Path]::GetFullPath((Join-Path $parent $name))
                if (-not ([System.IO.Path]::GetDirectoryName($destination)).Equals($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw 'Docker startup refused a quarantine path outside the runtime parent.'
                }
                if (@(Get-DockerStartupProcesses).Count -gt 0) {
                    throw 'Docker started before runtime preparation. Quit Docker Desktop and retry; nothing else was moved.'
                }
                Rename-Item -LiteralPath $plan.Path -NewName $name -ErrorAction Stop
                $quarantined++
            }
            if (-not (Test-Path -LiteralPath $plan.Path)) {
                if (@(Get-DockerStartupProcesses).Count -gt 0) {
                    throw 'Docker started while preparing its runtime. No further folders were changed; wait for startup before retrying.'
                }
                New-Item -ItemType Directory -Path $plan.Path -Force -ErrorAction Stop | Out-Null
            }
        }
        if (-not $PrepareOnly) {
            if (@(Get-DockerStartupProcesses).Count -eq 0) {
                Start-Process -FilePath $executable -WindowStyle Hidden -ErrorAction Stop
            }
        }
        [PSCustomObject]@{ Status = $(if ($PrepareOnly) { 'Prepared' } else { 'Started' }); QuarantinedDirectories = $quarantined }
    }
    finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $result = Invoke-DockerDesktopStartup -PrepareOnly:$PrepareOnly
        Write-Output ("Docker startup: {0}; preserved runtime folders: {1}." -f $result.Status, $result.QuarantinedDirectories)
    }
    catch {
        $failure = $_.Exception.Message
        if ($ShowError) {
            try {
                Add-Type -AssemblyName PresentationFramework
                [System.Windows.MessageBox]::Show($failure, 'Docker Desktop startup', 'OK', 'Error') | Out-Null
            }
            catch { }
        }
        Write-Error -Message $failure -ErrorAction Continue
        exit 1
    }
}
