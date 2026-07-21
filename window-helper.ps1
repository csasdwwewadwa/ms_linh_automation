param(
  [Parameter(Mandatory = $true)]
  [int]$Port,

  [Parameter(Mandatory = $true)]
  [string]$Token
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeWindowHelper {
  public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxLength);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr handle);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr handle, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr handle, int command);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr handle);

  public static readonly IntPtr Topmost = new IntPtr(-1);
  public static readonly IntPtr NoTopmost = new IntPtr(-2);
  public const int Restore = 9;
  public const uint NoActivate = 0x0010;
  public const uint Show = 0x0040;
}
"@

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
$targetHandle = [IntPtr]::Zero
$restoreRect = $null
$isHidden = $false

function Find-WindowByTitle([string]$expectedTitle) {
  $script:matchingHandle = [IntPtr]::Zero
  $script:expectedWindowTitle = $expectedTitle
  $callback = [NativeWindowHelper+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$parameter)

    $title = [System.Text.StringBuilder]::new(512)
    [NativeWindowHelper]::GetWindowText($handle, $title, $title.Capacity) | Out-Null
    if ($title.ToString().StartsWith([string]$script:expectedWindowTitle)) {
      $script:matchingHandle = $handle
      return $false
    }
    return $true
  }
  [NativeWindowHelper]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $script:matchingHandle
}

function Send-Response($stream, [int]$statusCode, [hashtable]$payload) {
  $json = $payload | ConvertTo-Json -Compress
  $body = [System.Text.Encoding]::UTF8.GetBytes($json)
  $statusText = if ($statusCode -eq 200) { "OK" } else { "Error" }
  $headers = "HTTP/1.1 $statusCode $statusText`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`nAccess-Control-Allow-Private-Network: true`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while ($reader.ReadLine()) { }

      if ($requestLine -match '^OPTIONS\s+') {
        Send-Response $stream 200 @{ success = $true }
        continue
      }

      if (-not $requestLine -or $requestLine -notmatch '^GET\s+(\S+)\s+HTTP/') {
        Send-Response $stream 400 @{ success = $false; message = "Invalid request." }
        continue
      }

      $uri = [System.Uri]::new("http://127.0.0.1$($Matches[1])")
      $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
      if ($query["token"] -ne $Token) {
        Send-Response $stream 403 @{ success = $false; message = "Invalid helper token." }
        continue
      }

      switch ($uri.AbsolutePath) {
        "/register" {
          $title = [string]$query["title"]
          $targetHandle = Find-WindowByTitle $title
          if ($targetHandle -eq [IntPtr]::Zero) {
            Send-Response $stream 404 @{ success = $false; message = "Launched Chrome window was not found." }
            continue
          }
          Send-Response $stream 200 @{ success = $true }
        }
        "/hide" {
          if ($targetHandle -eq [IntPtr]::Zero -or -not [NativeWindowHelper]::IsWindow($targetHandle)) {
            Send-Response $stream 409 @{ success = $false; message = "The registered Chrome window is unavailable." }
            continue
          }
          $rect = [NativeWindowHelper+Rect]::new()
          if (-not [NativeWindowHelper]::GetWindowRect($targetHandle, [ref]$rect)) {
            Send-Response $stream 500 @{ success = $false; message = "Could not read Chrome window bounds." }
            continue
          }
          $restoreRect = $rect
          $width = $rect.Right - $rect.Left
          $height = $rect.Bottom - $rect.Top
          $moved = [NativeWindowHelper]::SetWindowPos($targetHandle, [NativeWindowHelper]::Topmost, -1000, 100, 1009, 900, [NativeWindowHelper]::NoActivate -bor [NativeWindowHelper]::Show)
          if (-not $moved) {
            Send-Response $stream 500 @{ success = $false; message = "Win32 could not move the Chrome window." }
            continue
          }
          $isHidden = $true
          Send-Response $stream 200 @{ success = $true; hidden = $true }
        }
        "/show" {
          if ($targetHandle -eq [IntPtr]::Zero -or -not [NativeWindowHelper]::IsWindow($targetHandle) -or -not $restoreRect) {
            Send-Response $stream 409 @{ success = $false; message = "No hidden Chrome window is available to restore." }
            continue
          }
          [NativeWindowHelper]::ShowWindowAsync($targetHandle, [NativeWindowHelper]::Restore) | Out-Null
          $width = $restoreRect.Right - $restoreRect.Left
          $height = $restoreRect.Bottom - $restoreRect.Top
          $moved = [NativeWindowHelper]::SetWindowPos($targetHandle, [NativeWindowHelper]::NoTopmost, $restoreRect.Left, $restoreRect.Top, $width, $height, [NativeWindowHelper]::Show)
          if (-not $moved) {
            Send-Response $stream 500 @{ success = $false; message = "Win32 could not restore the Chrome window." }
            continue
          }
          [NativeWindowHelper]::SetForegroundWindow($targetHandle) | Out-Null
          $isHidden = $false
          Send-Response $stream 200 @{ success = $true; hidden = $false }
        }
        "/status" {
          Send-Response $stream 200 @{ success = $true; registered = ($targetHandle -ne [IntPtr]::Zero -and [NativeWindowHelper]::IsWindow($targetHandle)); hidden = $isHidden }
        }
        default {
          Send-Response $stream 404 @{ success = $false; message = "Unknown helper action." }
        }
      }
    } catch {
      if ($stream) {
        Send-Response $stream 500 @{ success = $false; message = $_.Exception.Message }
      }
    } finally {
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
