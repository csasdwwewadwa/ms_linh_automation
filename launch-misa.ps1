param(
  [switch]$StartAutomation
)

$ErrorActionPreference = "Stop"

$targetUrl = "https://actasp.misa.vn/app/IP/IPOutputInvoice/IPOutputInvoiceAutomaticList"
$extensionName = "MISA Automation Extension"
$userDataDirectory = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
$localStatePath = Join-Path $userDataDirectory "Local State"
$workspaceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$windowHelperPath = Join-Path $workspaceDirectory "window-helper.ps1"

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Find-ChromePath {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )

  $chromePath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $chromePath) {
    throw "Could not find chrome.exe."
  }
  return $chromePath
}

function Get-RecentProfileName {
  if (-not (Test-Path $localStatePath)) {
    throw "Chrome Local State was not found at $localStatePath."
  }

  $localState = Get-Content -Raw $localStatePath | ConvertFrom-Json
  $lastUsed = [string]$localState.profile.last_used
  if ($lastUsed -and (Test-Path (Join-Path $userDataDirectory $lastUsed))) {
    return $lastUsed
  }

  $profileEntries = @()
  if ($localState.profile.info_cache) {
    $profileEntries = @($localState.profile.info_cache.PSObject.Properties | ForEach-Object {
      [PSCustomObject]@{
        Name = $_.Name
        ActiveTime = [double]$_.Value.active_time
      }
    })
  }

  $recentProfile = $profileEntries |
    Where-Object { Test-Path (Join-Path $userDataDirectory $_.Name) } |
    Sort-Object ActiveTime -Descending |
    Select-Object -First 1

  if ($recentProfile) {
    return $recentProfile.Name
  }

  $fallbackProfile = Get-ChildItem $userDataDirectory -Directory |
    Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $fallbackProfile) {
    throw "Could not identify a Chrome profile."
  }
  return $fallbackProfile.Name
}

function Get-InstalledExtensionId([string]$profileName) {
  $workspacePath = [System.IO.Path]::GetFullPath($workspaceDirectory).TrimEnd("\")
  $preferenceFiles = @("Preferences", "Secure Preferences")
  $extension = $null

  foreach ($fileName in $preferenceFiles) {
    $preferencesPath = Join-Path $userDataDirectory "$profileName\$fileName"
    if (-not (Test-Path $preferencesPath)) {
      continue
    }

    $preferences = Get-Content -Raw $preferencesPath | ConvertFrom-Json
    if (-not $preferences.extensions.settings) {
      continue
    }

    $extension = @($preferences.extensions.settings.PSObject.Properties |
      Where-Object {
        $extensionPath = if ($_.Value.path) { [System.IO.Path]::GetFullPath([string]$_.Value.path).TrimEnd("\") } else { "" }
        $_.Value.manifest.name -eq $extensionName -or $extensionPath -eq $workspacePath
      } |
      Select-Object -First 1)

    if ($extension) {
      break
    }
  }

  if (-not $extension) {
    throw "The installed extension '$extensionName' was not found in Chrome profile '$profileName'. Load this workspace as an unpacked extension first."
  }
  return $extension.Name
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowTools {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr handle, int command);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr handle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  public static readonly IntPtr Topmost = new IntPtr(-1);
  public const int Restore = 9;
  public const uint NoMove = 0x0002;
  public const uint NoSize = 0x0001;
  public const uint Show = 0x0040;
}
"@

function Restore-ChromeWindows {
  Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.MainWindowHandle -ne [IntPtr]::Zero) {
      [WindowTools]::ShowWindowAsync($_.MainWindowHandle, [WindowTools]::Restore) | Out-Null
    }
  }
}

function Set-DashboardTopmost {
  param([int]$TimeoutSeconds = 30)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $dashboardProcess = Get-Process chrome -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowTitle -like "MISA Auto Controller*" } |
      Select-Object -First 1

    if ($dashboardProcess -and $dashboardProcess.MainWindowHandle -ne [IntPtr]::Zero) {
      [WindowTools]::ShowWindowAsync($dashboardProcess.MainWindowHandle, [WindowTools]::Restore) | Out-Null
      [WindowTools]::SetWindowPos(
        $dashboardProcess.MainWindowHandle,
        [WindowTools]::Topmost,
        0,
        0,
        0,
        0,
        [WindowTools]::NoMove -bor [WindowTools]::NoSize -bor [WindowTools]::Show
      ) | Out-Null
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  Write-Warning "Dashboard window was not found. Open the extension dashboard once, then run this launcher again."
}

$chromePath = Find-ChromePath
$profileName = Get-RecentProfileName
$extensionId = Get-InstalledExtensionId $profileName
$helperPort = Get-FreeLoopbackPort
$helperToken = [Guid]::NewGuid().ToString("N")
$windowMarker = "MISA-Automation-$([Guid]::NewGuid().ToString('N'))"
$dashboardLauncherUrl = "chrome-extension://$extensionId/launch.html?helperPort=$helperPort&helperToken=$helperToken&windowMarker=$windowMarker"

if (-not (Test-Path $windowHelperPath)) {
  throw "Native window helper was not found at $windowHelperPath."
}

Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$windowHelperPath`"",
  "-Port", $helperPort,
  "-Token", $helperToken
)

Restore-ChromeWindows

$chromeArguments = @(
  "--profile-directory=$profileName",
  "--new-window",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--start-maximized",
  $targetUrl,
  $dashboardLauncherUrl
)

Start-Process -FilePath $chromePath -ArgumentList $chromeArguments
Start-Sleep -Milliseconds 750
Restore-ChromeWindows
Set-DashboardTopmost -TimeoutSeconds 5

if ($StartAutomation) {
  Write-Output "Dashboard launched. Start automation from the dashboard window."
} else {
  Write-Output "Chrome launched with profile '$profileName'."
}