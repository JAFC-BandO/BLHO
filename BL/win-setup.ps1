# BLHO - opsaetning af en Windows signage-boks
#
# Koeres paa boksen, i PowerShell SOM ADMINISTRATOR (typisk over SSH):
#
#     irm https://jfclabs.dk/BL/win-setup.ps1 | iex
#
# eller fra USB-noeglen via START-HER.bat.
#
# Alt herunder er afproevet paa Amager-boksen (Flytech KPC2-F38, Windows 11 IoT
# Enterprise LTSC) 1.-2. september 2026, inklusive genstart, fjernkommandoer og
# faldgruberne der er dokumenteret undervejs.
#
# INDEHOLDER INGEN HEMMELIGHEDER. Skaerm-kontoen indtastes naar scriptet koerer og
# skrives kun ned lokalt i C:\blho, som laases til administratorer og SYSTEM.

$ErrorActionPreference = 'Stop'
function Sig($t, $f = 'Gray') { Write-Host $t -ForegroundColor $f }

# Gruppenavne er OVERSAT paa et dansk Windows - "Administrators" findes ikke, den hedder
# "Administratorer", og icacls fejler med "ingen afbildning mellem kontonavne og
# sikkerheds-id". Velkendte SID'er er sprogneutrale og virker overalt.
$SID_ADMINS = '*S-1-5-32-544'
$SID_SYSTEM = '*S-1-5-18'

$mig = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $mig.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Sig ''
  Sig 'STOP: Denne session er ikke administrator.' 'Red'
  Sig 'Over SSH: log ind som en bruger der er lokal administrator paa boksen.' 'Yellow'
  return
}

Sig ''
Sig '=== BLHO: opsaetning af Windows signage-boks ===' 'Cyan'
Sig ''

# ---------- Skabeloner ----------
# Ligger ved siden af scriptet (USB), ellers hentes de. $PSScriptRoot er tom naar
# scriptet koeres via "irm | iex".
$mappe = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function HentSkabelon($navn) {
  $lokal = Join-Path $mappe $navn
  if (Test-Path $lokal) { return Get-Content $lokal -Raw }
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri "https://jfclabs.dk/BL/$navn").Content
  } catch {
    Sig "STOP: kunne hverken finde $navn lokalt eller hente den: $($_.Exception.Message)" 'Red'
    return $null
  }
}

$skabCheckin = HentSkabelon 'checkin-skabelon.ps1'
$skabKiosk   = HentSkabelon 'kiosk-skabelon.ps1'
if (-not $skabCheckin -or -not $skabKiosk) { return }

# ---------- Indtastning ----------
Sig 'Hent vaerdierne i Supabase Dashboard og i "Enheder"-panelet.' 'Gray'
Sig ''
$EMAIL = Read-Host 'Skaerm-kontoens email  (fx skaerm-amager@intern.blho)'
if (-not $EMAIL) { Sig 'Ingen email - afbryder.' 'Red'; return }

$hemmelig = Read-Host 'Skaerm-kontoens adgangskode' -AsSecureString
$PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hemmelig))
if (-not $PASSWORD) { Sig 'Ingen adgangskode - afbryder.' 'Red'; return }

$ENHED_ID = Read-Host 'Enheds-ID fra "Enheder"-panelet'
if ($ENHED_ID -notmatch '^[0-9a-fA-F-]{36}$') {
  Sig 'Det ligner ikke et enheds-ID (36 tegn) - afbryder.' 'Red'; return
}
Sig ''
Sig "  Email     : $EMAIL"
Sig "  Enheds-ID : $ENHED_ID"
Sig ''

# ---------- 1. Mappe ----------
Sig '[1/8] Opretter C:\blho og laaser rettighederne...'
New-Item -ItemType Directory -Path 'C:\blho\state' -Force | Out-Null
New-Item -ItemType Directory -Path 'C:\blho\browserprofil' -Force | Out-Null
& icacls.exe 'C:\blho' /inheritance:r /grant "${SID_ADMINS}:(OI)(CI)F" /grant "${SID_SYSTEM}:(OI)(CI)F" | Out-Null
Sig '      Klar.' 'Green'

# ---------- 2. Scripts ----------
Sig '[2/8] Skriver checkin.ps1 og start-kiosk.ps1...'
$skabCheckin.Replace('__EMAIL__', $EMAIL).Replace('__PASSWORD__', $PASSWORD).Replace('__ENHED_ID__', $ENHED_ID) |
  Set-Content -Path 'C:\blho\checkin.ps1' -Encoding utf8
$skabKiosk.Replace('__EMAIL__', $EMAIL).Replace('__PASSWORD__', $PASSWORD) |
  Set-Content -Path 'C:\blho\start-kiosk.ps1' -Encoding utf8
Sig '      Skrevet.' 'Green'

# ---------- 3. Planlagte opgaver ----------
# schtasks i stedet for Register-ScheduledTask: sidstnaevnte fejlede TAVST paa Amager naar
# .Repetition blev sat paa en AtStartup-udloeser. schtasks /SC MINUTE goer det samme i ét
# kald og er langt mere robust.
Sig '[3/8] Registrerer opgaverne...'
& schtasks.exe /Delete /TN 'BLHO-Checkin' /F 2>&1 | Out-Null
& schtasks.exe /Create /TN 'BLHO-Checkin' /SC MINUTE /MO 1 /RU 'SYSTEM' /RL HIGHEST /F `
  /TR 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\blho\checkin.ps1' 2>&1 |
  ForEach-Object { Sig "      $_" 'DarkGray' }

& schtasks.exe /Delete /TN 'BLHO-Kiosk' /F 2>&1 | Out-Null
& schtasks.exe /Create /TN 'BLHO-Kiosk' /SC ONLOGON /RL HIGHEST /F `
  /TR 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\blho\start-kiosk.ps1' 2>&1 |
  ForEach-Object { Sig "      $_" 'DarkGray' }

# ---------- 4. Genvej i Startup ----------
# Ekstra sikkerhed ved siden af den planlagte opgave. Samme mekanisme som fabrikkens eget
# signage brugte, og den virker for enhver bruger der logger ind.
Sig '[4/8] Laegger genvej i Startup-mappen...'
$startup = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup'
$sh = New-Object -ComObject WScript.Shell
$g = $sh.CreateShortcut((Join-Path $startup 'BLHO Skaerm.lnk'))
$g.TargetPath = 'powershell.exe'
$g.Arguments  = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\blho\start-kiosk.ps1'
$g.WorkingDirectory = 'C:\blho'
$g.Save()
Sig '      Lagt.' 'Green'

# ---------- 5. Fabrikkens opstart ----------
# KPC2-bokse kommer med "Pro Signage" (chrome --kiosk mod leverandoerens egen tjeneste) og
# to opgaver "Restart 1"/"Restart 2" der koerer "shutdown /r /f" kl. 03:00 og 03:30. De
# sidste ville konkurrere med den natlige genstart fra Enheder-panelet.
Sig '[5/8] Deaktiverer fabrikkens opstart...'
New-Item -ItemType Directory 'C:\blho\deaktiveret' -Force | Out-Null
foreach ($n in @('Pro Signage.lnk')) {
  $sti = Join-Path $startup $n
  if (Test-Path $sti) { Move-Item $sti "C:\blho\deaktiveret\$n" -Force; Sig "      Flyttet: $n" 'Green' }
}
foreach ($n in @('Restart 1', 'Restart 2')) {
  if (Get-ScheduledTask -TaskName $n -EA 0) {
    Disable-ScheduledTask -TaskName $n -EA 0 | Out-Null
    Sig "      Deaktiveret: $n" 'Green'
  }
}

# ---------- 6. Skaerm og proceslinje ----------
Sig '[6/8] Slaar skaermslukning fra og skjuler proceslinjen...'
& powercfg /change monitor-timeout-ac 0
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /hibernate off 2>$null
# Byte 8 i StuckRects3 er en bitmaske - bit 0 er "skjul automatisk". Sammen med at
# kiosk-scriptet traekker vinduet i forgrunden er det to uafhaengige lag mod at
# proceslinjen bliver liggende ovenpaa visningen.
$sr = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3'
if (Test-Path $sr) {
  $v = (Get-ItemProperty $sr -Name Settings).Settings
  if (($v[8] -band 1) -ne 1) { $v[8] = $v[8] -bor 1; Set-ItemProperty $sr -Name Settings -Value $v }
}
Sig '      Sat.' 'Green'

# ---------- 7. Tailscale ----------
Sig '[7/8] Tailscale...'
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
  Sig '      Allerede installeret.'
} else {
  try {
    # Versionsnummeret er en del af filnavnet - den versionsloese URL giver 404.
    $j = Invoke-RestMethod -UseBasicParsing -Uri 'https://pkgs.tailscale.com/stable/?mode=json'
    $fil = $j.MSIs.amd64
    $ud = "$env:TEMP\$fil"
    Invoke-WebRequest -UseBasicParsing -Uri "https://pkgs.tailscale.com/stable/$fil" -OutFile $ud
    # TS_UNATTENDEDMODE=always er kritisk: uden den koerer Tailscale KUN mens en bruger er
    # logget ind, og boksen falder af nettet efter hver genstart.
    Start-Process msiexec.exe -Wait -ArgumentList @('/i', "`"$ud`"", '/quiet', '/norestart', 'TS_UNATTENDEDMODE=always', 'TS_NOLAUNCH=1')
    Sig "      Installeret ($fil)." 'Green'
  } catch {
    Sig "      Kunne ikke installere: $($_.Exception.Message)" 'Yellow'
  }
}

# ---------- 8. Test ----------
Sig '[8/8] Koerer et check-in for at teste forbindelsen...'
Start-ScheduledTask -TaskName 'BLHO-Checkin'
Start-Sleep -Seconds 12
if (Test-Path 'C:\blho\checkin.log') {
  Sig '      Log (tomt er GODT - der logges kun fejl):' 'Gray'
  Get-Content 'C:\blho\checkin.log' -Tail 8 | ForEach-Object { Sig "        $_" 'Yellow' }
} else {
  Sig '      Ingen fejl logget.' 'Green'
}
Start-ScheduledTask -TaskName 'BLHO-Kiosk'

Sig ''
Sig '=== Faerdig ===' 'Cyan'
Sig ''
Sig '  Tjek "Enheder"-panelet - butikken skal skifte til en groen prik.' 'White'
Sig ''
Sig '  Mangler kun Tailscale-login. Koer denne, og klik paa linket den skriver ud:' 'Yellow'
Sig '    & "C:\Program Files\Tailscale\tailscale.exe" up --hostname=BUTIK-skaerm --unattended'
Sig ''
Sig '  Genstart derefter boksen og lad den vaere i 2 minutter. Skaermen skal selv ende' 'Gray'
Sig '  i fuldskaerm med butikkens indhold.' 'Gray'
Sig ''
