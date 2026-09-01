# BLHO - opsaetning af en Windows signage-boks
#
# Koeres paa boksen, i PowerShell SOM ADMINISTRATOR (typisk over SSH):
#
#     irm https://jfclabs.dk/BL/win-setup.ps1 | iex
#
# Scriptet spoerger om butikkens skaerm-konto og enheds-ID, og saetter derefter alt op:
# check-in mod Supabase hvert minut, kiosk-visningen i fuldskaerm, de planlagte opgaver
# der holder begge dele koerende, og stroemindstillingerne saa skaermen aldrig slukker.
#
# Sikkert at koere flere gange - den overskriver bare det den lavede sidst.
#
# INDEHOLDER INGEN HEMMELIGHEDER. Adgangskoden indtastes af dig naar scriptet koerer, og
# skrives kun ned lokalt paa boksen i C:\blho, som laases til Administrators og SYSTEM.
#
# Se WINDOWS-KIOSK-SETUP.md for det fulde forloeb, inkl. Tailscale og automatisk login.

$ErrorActionPreference = 'Stop'
function Sig($t, $f = 'Gray') { Write-Host $t -ForegroundColor $f }

# ---------- Administrator-tjek ----------
$mig = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $mig.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Sig ''
  Sig 'STOP: Denne session er ikke administrator.' 'Red'
  Sig 'Over SSH: log ind som en bruger der er lokal administrator paa boksen.' 'Yellow'
  Sig ''
  return
}

Sig ''
Sig '=== BLHO: opsaetning af Windows signage-boks ===' 'Cyan'
Sig ''
Sig 'Hent vaerdierne i Supabase Dashboard og i "Enheder"-panelet.' 'Gray'
Sig ''

# ---------- Indtastning ----------
$EMAIL = Read-Host 'Skaerm-kontoens email  (fx skaerm-amager@intern.blho)'
if (-not $EMAIL) { Sig 'Ingen email angivet - afbryder.' 'Red'; return }

$hemmelig = Read-Host 'Skaerm-kontoens adgangskode' -AsSecureString
$PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hemmelig))
if (-not $PASSWORD) { Sig 'Ingen adgangskode angivet - afbryder.' 'Red'; return }

$ENHED_ID = Read-Host 'Enheds-ID fra "Enheder"-panelet'
if ($ENHED_ID -notmatch '^[0-9a-fA-F-]{36}$') {
  Sig 'Det ligner ikke et enheds-ID (36 tegn, fx 0dbcfaa3-d636-4103-b8d4-74596ee4990e) - afbryder.' 'Red'
  return
}

Sig ''
Sig "  Email     : $EMAIL"
Sig "  Enheds-ID : $ENHED_ID"
Sig ''

# ---------- Mappe, laast ned ----------
# checkin.ps1 kommer til at indeholde adgangskoden i klartekst, praecis som
# start-checkin.sh goer paa Android-boksene. Mappen laases derfor til Administrators og
# SYSTEM, saa en almindelig bruger paa maskinen ikke kan laese den.
Sig '[1/6] Opretter C:\blho og laaser rettighederne...'
New-Item -ItemType Directory -Path 'C:\blho\state' -Force | Out-Null
& icacls.exe 'C:\blho' /inheritance:r /grant 'Administrators:(OI)(CI)F' /grant 'SYSTEM:(OI)(CI)F' | Out-Null
Sig '      Klar.' 'Green'

# ---------- checkin.ps1 ----------
Sig '[2/6] Skriver checkin.ps1...'
$checkin = @'
# BLHO check-in. Koeres hvert minut af den planlagte opgave BLHO-Checkin, som SYSTEM.
# Genereret af win-setup.ps1 - ret hellere der, og koer scriptet igen.
$ErrorActionPreference = 'Stop'

# PowerShell 5.1 forhandler ikke noedvendigvis TLS 1.2 selv, og saa fejler ALLE kald mod
# Supabase med en intetsigende "underliggende forbindelse blev lukket".
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SUPABASE_URL = 'https://irijatnmgvutrqngwpaa.supabase.co'
$SUPABASE_KEY = 'sb_publishable_taPyJFcINrPL5JiB-ay4CQ_iscnTyy3'
$EMAIL        = '__EMAIL__'
$PASSWORD     = '__PASSWORD__'
$ENHED_ID     = '__ENHED_ID__'

$LOG      = 'C:\blho\checkin.log'
$TS       = 'C:\Program Files\Tailscale\tailscale.exe'
$STATEDIR = 'C:\blho\state'

function Log($b) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $b" | Add-Content -Path $LOG -Encoding utf8
  if ((Get-Item $LOG -ErrorAction SilentlyContinue).Length -gt 200KB) {
    Get-Content $LOG -Tail 1000 | Set-Content "$LOG.tmp" -Encoding utf8
    Move-Item "$LOG.tmp" $LOG -Force
  }
}

# Lokalt 02:00 UTC-sikkerhedsnet. Den serverstyrede natlige genstart virker KUN hvis
# enheden kan naa Supabase - men naar en genstart er mest paakraevet, er det ofte praecis
# det der er i stykker. Dette tjek bruger UDELUKKENDE maskinens eget ur.
$nuUtc     = (Get-Date).ToUniversalTime()
$rebootFil = Join-Path $STATEDIR 'sidste_lokale_reboot.txt'
$idagUtc   = $nuUtc.ToString('yyyyMMdd')
if ($nuUtc.Hour -eq 2 -and (Get-Content $rebootFil -ErrorAction SilentlyContinue) -ne $idagUtc) {
  Set-Content -Path $rebootFil -Value $idagUtc
  Log 'Lokalt 02:00 UTC-sikkerhedsnet udloeser genstart'
  Restart-Computer -Force
  exit
}

try {
  $svar = Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/auth/v1/token?grant_type=password" -Headers @{ apikey = $SUPABASE_KEY } -ContentType 'application/json' -Body (@{ email = $EMAIL; password = $PASSWORD } | ConvertTo-Json)
  $TOKEN = $svar.access_token
} catch {
  Log "Login fejlede: $($_.Exception.Message)"
  exit 1
}
if (-not $TOKEN) { Log 'Intet access_token i svaret'; exit 1 }
$headers = @{ apikey = $SUPABASE_KEY; Authorization = "Bearer $TOKEN" }

$lokalIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress

# netsh's tekst er oversat paa dansk Windows, saa vi leder efter det foerste procent-tal
# i stedet for efter ordet "Signal". Paa kabel findes intet -> null.
$wifiRssi = $null
$netshUd = & netsh wlan show interfaces 2>$null | Out-String
if ($netshUd -match '(\d{1,3})\s*%') { $wifiRssi = [int]([int]$Matches[1] / 2 - 100) }

$video = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
$skaermBredde = if ($video) { [int]$video.CurrentHorizontalResolution } else { $null }
$skaermHoejde = if ($video) { [int]$video.CurrentVerticalResolution } else { $null }

$os = Get-CimInstance Win32_OperatingSystem
$memAvailableMb = [int]($os.FreePhysicalMemory / 1024)

# Tjek Tailscales FAKTISKE funktion (kan vi hente en IP?), ikke om en proces med det
# rigtige navn findes. Et navnebaseret tjek gav falsk "alt er fint" paa Android.
$tailscaleIp = $null
$tailscaleOk = $false
if (Test-Path $TS) {
  $tailscaleIp = (& $TS ip -4 2>$null | Select-Object -First 1)
  if ($tailscaleIp) {
    $tailscaleOk = $true
  } else {
    Log 'tailscale svarer ikke - genstarter tjenesten'
    Restart-Service Tailscale -Force -ErrorAction SilentlyContinue
  }
}

# enhed_checkin laeser OG rydder en ventende kommando atomisk i samme kald.
$payload = @{
  p_enhed_id         = $ENHED_ID
  p_lokal_ip         = $lokalIp
  p_tailscale_ip     = $tailscaleIp
  p_wifi_rssi        = $wifiRssi
  p_skaerm_bredde    = $skaermBredde
  p_skaerm_hoejde    = $skaermHoejde
  p_tailscale_ok     = $tailscaleOk
  p_mem_available_mb = $memAvailableMb
} | ConvertTo-Json

try {
  $res = Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/rest/v1/rpc/enhed_checkin" -Headers $headers -ContentType 'application/json' -Body $payload
} catch {
  Log "Check-in fejlede: $($_.Exception.Message)"
  exit 1
}

$kommando       = $res[0].kommando
$customKommando = $res[0].custom_kommando

if ($kommando -eq 'reboot') {
  Log 'Fjernkommando: reboot'
  Restart-Computer -Force
  exit
} elseif ($kommando -eq 'genstart_kiosk') {
  Log 'Fjernkommando: genstart_kiosk'
  Stop-Process -Name chrome, msedge -Force -ErrorAction SilentlyContinue
}

if ($customKommando) {
  Log "Fritekstkommando: $customKommando"
  try { $ud = (Invoke-Expression $customKommando 2>&1 | Out-String) }
  catch { $ud = "FEJL: $($_.Exception.Message)" }
  if ($ud.Length -gt 4000) { $ud = $ud.Substring(0, 4000) }
  # ConvertTo-Json - ALDRIG haandrullet strenginterpolation. Citationstegn og linjeskift
  # i output ville ellers oedelaegge JSON'en.
  $svarPayload = @{ p_enhed_id = $ENHED_ID; p_svar = $ud } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/rest/v1/rpc/enhed_custom_kommando_svar" -Headers $headers -ContentType 'application/json' -Body $svarPayload | Out-Null
  } catch { Log "Kunne ikke sende svar: $($_.Exception.Message)" }
}
'@

$checkin = $checkin.Replace('__EMAIL__', $EMAIL).Replace('__PASSWORD__', $PASSWORD).Replace('__ENHED_ID__', $ENHED_ID)
Set-Content -Path 'C:\blho\checkin.ps1' -Value $checkin -Encoding utf8
Sig '      Skrevet.' 'Green'

# ---------- start-kiosk.ps1 ----------
Sig '[3/6] Skriver start-kiosk.ps1...'
$kiosk = @'
# BLHO kiosk-visning. Starter browseren i fuldskaerm og genaabner den hvis den doer.
# Genereret af win-setup.ps1.
$ErrorActionPreference = 'SilentlyContinue'

$EMAIL    = '__EMAIL__'
$PASSWORD = '__PASSWORD__'
$URL      = "https://jfclabs.dk/BL/skaerm.html?email=$EMAIL&password=$PASSWORD"

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
  '--check-for-update-interval=31536000'
)

while ($true) {
  if (-not (Get-Process -Name $procNavn -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $browser -ArgumentList $argumenter
    Start-Sleep -Seconds 30
  }
  Start-Sleep -Seconds 15
}
'@

$kiosk = $kiosk.Replace('__EMAIL__', $EMAIL).Replace('__PASSWORD__', $PASSWORD)
Set-Content -Path 'C:\blho\start-kiosk.ps1' -Value $kiosk -Encoding utf8
Sig '      Skrevet.' 'Green'

# ---------- Planlagte opgaver ----------
Sig '[4/6] Registrerer de planlagte opgaver...'

# Check-in: hvert minut, som SYSTEM. Modsat Android-versionen er scriptet IKKE et evigt
# loop - opgaveplanlaeggeren kalder det forfra. Doer eller haenger det, starter Windows
# det bare igen. Det er den selvhelbredelse Android skulle bruge en runsv-service for.
$h1 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\blho\checkin.ps1'
$u1 = New-ScheduledTaskTrigger -AtStartup
$u1.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition
# IgnoreNew: haenger ét gennemloeb, springes det naeste over i stedet for at stable
# parallelle kopier. ExecutionTimeLimit draeber et haengende gennemloeb efter 5 minutter.
$v1 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'BLHO-Checkin' -Action $h1 -Trigger $u1 -Settings $v1 -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

# Kiosk: ved logon, som den bruger der er logget ind (browseren skal have et skrivebord).
$h2 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\blho\start-kiosk.ps1'
$u2 = New-ScheduledTaskTrigger -AtLogOn
$v2 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'BLHO-Kiosk' -Action $h2 -Trigger $u2 -Settings $v2 -RunLevel Highest -Force | Out-Null
Sig '      BLHO-Checkin og BLHO-Kiosk registreret.' 'Green'

# ---------- Stroem ----------
Sig '[5/6] Slaar skaermslukning og dvale fra...'
& powercfg /change monitor-timeout-ac 0
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /hibernate off 2>$null
Sig '      Sat.' 'Green'

# ---------- Test ----------
Sig '[6/6] Koerer et check-in nu for at teste forbindelsen...'
Start-ScheduledTask -TaskName 'BLHO-Checkin'
Start-Sleep -Seconds 12
if (Test-Path 'C:\blho\checkin.log') {
  Sig '      Log-linjer (tomt er GODT - der logges kun fejl):' 'Gray'
  Get-Content 'C:\blho\checkin.log' -Tail 10 | ForEach-Object { Sig "        $_" 'Yellow' }
} else {
  Sig '      Ingen fejl logget.' 'Green'
}

Sig ''
Sig '=== Faerdig ===' 'Cyan'
Sig ''
Sig '  Tjek "Enheder"-panelet nu - butikken skal have skiftet til en groen prik.' 'White'
Sig ''
Sig '  Mangler stadig, og kraever hver sin ting:' 'Yellow'
Sig '    1. Tailscale (SSH udefra):'
Sig '         winget install --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements'
Sig '         & "C:\Program Files\Tailscale\tailscale.exe" up --hostname "BUTIK-skaerm"'
Sig '       Loginnet aabner en browser - kraever skaerm og mus paa boksen én gang.'
Sig ''
Sig '    2. Automatisk login, saa kiosk-visningen starter efter en genstart.'
Sig '       Kraever ogsaa skaerm og mus. Se WINDOWS-KIOSK-SETUP.md, Trin 3.'
Sig ''
Sig '    3. Naar begge er gjort: genstart boksen og lad den vaere i 2 minutter.'
Sig '       Skaermen skal selv ende i fuldskaerm med butikkens indhold.'
Sig ''
