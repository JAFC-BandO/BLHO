# BLHO kiosk-visning. Starter browseren i fuldskaerm og genaabner den hvis den doer.
# Koeres ved logon af den planlagte opgave BLHO-Kiosk og af genvejen i Startup-mappen.
#
# VIGTIGT om fokus: et vindue startet fra en planlagt opgave / startup-genvej faar ikke
# automatisk forgrunden. Chrome koerer saa i kiosk-tilstand, men proceslinjen bliver
# liggende OVENPAA indtil nogen klikker paa skaermen - ubrugeligt paa en skaerm ingen
# roerer. Derfor traekkes vinduet aktivt i forgrunden efter start, og igen i loekken hvis
# noget andet har stjaalet fokus.

$ErrorActionPreference = 'SilentlyContinue'

$EMAIL    = '__EMAIL__'
$PASSWORD = '__PASSWORD__'
$URL      = "https://jfclabs.dk/BL/skaerm.html?email=$EMAIL&password=$PASSWORD"

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Vindue {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr efter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool LockSetForegroundWindow(uint n);
  public static readonly IntPtr HWND_TOP = new IntPtr(0);
  public static void Frem(IntPtr h) {
    LockSetForegroundWindow(2);            // LSFW_UNLOCK - ophaev en evt. spaerring
    ShowWindow(h, 3);                      // SW_MAXIMIZE
    BringWindowToTop(h);
    SetForegroundWindow(h);
    // SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW - loeft over proceslinjen uden at flytte/skalere
    SetWindowPos(h, HWND_TOP, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
  }
}
'@

$browser = if (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe") {
  "C:\Program Files\Google\Chrome\Application\chrome.exe"
} else {
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
}
$procNavn = [System.IO.Path]::GetFileNameWithoutExtension($browser)

$argumenter = @(
  '--kiosk'
  $URL
  '--user-data-dir=C:\blho\browserprofil'
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-session-crashed-bubble'
  '--disable-infobars'
  '--disable-features=Translate,TranslateUI'
  '--autoplay-policy=no-user-gesture-required'
  '--noerrdialogs'
  '--start-fullscreen'
  '--check-for-update-interval=31536000'
)

function KioskVindue {
  Get-Process -Name $procNavn -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
}

function TraekFrem {
  $p = KioskVindue
  if ($p) { [Vindue]::Frem($p.MainWindowHandle); return $true }
  return $false
}

# Ved logon er skrivebordet ikke noedvendigvis faerdigt endnu. Et kort ophold foer foerste
# start giver proceslinjen og Explorer tid til at komme op, saa vores vindue laegger sig
# ovenpaa dem i stedet for omvendt.
Start-Sleep -Seconds 8

while ($true) {
  if (-not (Get-Process -Name $procNavn -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $browser -ArgumentList $argumenter
    # Vent paa at vinduet findes, og traek det frem saa snart det goer.
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      if (TraekFrem) { break }
    }
    Start-Sleep -Seconds 5
    TraekFrem | Out-Null      # en gang til naar siden er indlaest
  } else {
    # Har noget andet stjaalet forgrunden (en opdateringsdialog, Explorer efter en
    # genstart af skallen), tages den tilbage. Er vi allerede forrest, sker der intet.
    $p = KioskVindue
    if ($p -and [Vindue]::GetForegroundWindow() -ne $p.MainWindowHandle) {
      [Vindue]::Frem($p.MainWindowHandle)
    }
  }
  Start-Sleep -Seconds 15
}


