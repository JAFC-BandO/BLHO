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

# ---------- Skaermtilstand ----------
# Sikrer 1920x1080 @ 60 Hz - det format indholdet er lavet til, og det Android-boksene koerer.
#
# Amager var koblet paa en 4K-skaerm og koerte 3840x2160 @ 30 Hz. Boksens HDMI kan ikke
# levere 4K ved 60 Hz, saa 4K betyder uundgaaeligt 30 billeder i sekundet - og samtidig
# fire gange saa mange pixels at komponere ved hvert crossfade. Det foeltes som lag,
# saerligt ved skift fra en video til et stillbillede.
#
# Ligger HER og ikke i check-in-scriptet, fordi det skal ske i konsol-sessionen. En
# SYSTEM-opgave eller en SSH-session har sit eget skrivebord uden skaerm, og et kald
# derfra aendrer ingenting.
#
# Hele logikken er i C#. Foerste forsoeg fyldte DEVMODE-structen fra PowerShell, og
# EnumDisplaySettings fejlede - marshalling derfra er for skroebelig, dmSize og
# feltjusteringen skal passe paa byten.
#
# Springes over hvis skaermen allerede er 1080p eller lavere med mindst 50 Hz, saa en
# boks der er sat rigtigt op i forvejen ikke roeres.
try {
  if (-not ('BlhoDisplay' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BlhoDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  private struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public ushort dmSpecVersion; public ushort dmDriverVersion; public ushort dmSize; public ushort dmDriverExtra;
    public uint dmFields; public int dmPositionX; public int dmPositionY;
    public uint dmDisplayOrientation; public uint dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public ushort dmLogPixels;
    public uint dmBitsPerPel; public uint dmPelsWidth; public uint dmPelsHeight;
    public uint dmDisplayFlags; public uint dmDisplayFrequency;
    public uint dmICMMethod; public uint dmICMIntent; public uint dmMediaType; public uint dmDitherType;
    public uint dmReserved1; public uint dmReserved2; public uint dmPanningWidth; public uint dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] private static extern int EnumDisplaySettings(string d, int i, ref DEVMODE m);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] private static extern int ChangeDisplaySettings(ref DEVMODE m, uint f);
  private static DEVMODE Ny() {
    DEVMODE d = new DEVMODE();
    d.dmDeviceName = new string('\0', 32); d.dmFormName = new string('\0', 32);
    d.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
    return d;
  }
  public static int[] Nu() {
    DEVMODE d = Ny();
    if (EnumDisplaySettings(null, -1, ref d) == 0) return new int[] { 0, 0, 0 };
    return new int[] { (int)d.dmPelsWidth, (int)d.dmPelsHeight, (int)d.dmDisplayFrequency };
  }
  public static int Saet(int w, int h, int hz) {
    DEVMODE d = Ny();
    if (EnumDisplaySettings(null, -1, ref d) == 0) return -99;
    d.dmPelsWidth = (uint)w; d.dmPelsHeight = (uint)h; d.dmDisplayFrequency = (uint)hz;
    d.dmFields = 0x00080000 | 0x00100000 | 0x00400000;   // width | height | frequency
    return ChangeDisplaySettings(ref d, 0x00000001);      // CDS_UPDATEREGISTRY: overlever genstart
  }
}
'@
  }
  $nu = [BlhoDisplay]::Nu()
  if ($nu[0] -gt 0) {
    $forStor = $nu[0] -gt 1920 -or $nu[1] -gt 1080
    $forLangsom = $nu[2] -lt 50
    if ($forStor -or $forLangsom) {
      [void][BlhoDisplay]::Saet(1920, 1080, 60)
      Start-Sleep -Seconds 3
    }
  }
} catch { }
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


