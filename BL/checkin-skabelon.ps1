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
# Kl. 04:00 UTC (to timer EFTER serverens egen genstart) og kun hvis maskinen reelt har
# vaeret oppe laenge. Har serveren allerede genstartet den kl. 02:00, er oppetiden ca. to
# timer, og saa springes dette over - ellers faar man to genstarter i traek.
$oppetimer = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalHours
if ($nuUtc.Hour -eq 4 -and $oppetimer -gt 6 -and (Get-Content $rebootFil -ErrorAction SilentlyContinue) -ne $idagUtc) {
  Set-Content -Path $rebootFil -Value $idagUtc
  Log ("Lokalt sikkerhedsnet udloeser genstart (oppe i {0:N1} timer, ingen server-genstart)" -f $oppetimer)
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


