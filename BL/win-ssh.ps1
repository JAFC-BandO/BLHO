# BLHO - opsaetning af SSH paa en Windows signage-boks
#
# Koeres paa selve boksen SOM ADMINISTRATOR - enten fra USB via START-HER.bat, eller:
#
#     irm https://jfclabs.dk/BL/win-ssh.ps1 | iex
#
# INDEHOLDER INGEN HEMMELIGHEDER.
#
# Se WINDOWS-KIOSK-SETUP.md for resten af opsaetningen.
#
# TO FALDGRUBER, begge ramt paa Amager-boksen 1. september 2026:
#
#  1. Windows' indbyggede "Feature on Demand" (Add-WindowsCapability) bruges IKKE. Den
#     henter OpenSSH gennem Windows Update, og er den tjeneste slaaet fra - hvilket
#     signage-bokse tit leveres med - HAENGER kaldet i det uendelige uden fejlbesked.
#     TiWorker.exe laa paa 0% CPU i mange minutter uden at der skete noget. Vi bruger
#     Microsofts egen MSI i stedet: hurtig, og uafhaengig af Windows Update.
#
#  2. MSI'en installerer filerne, men opretter ikke altid selve tjenesten. Og fordi
#     produktet derefter staar som installeret (ProductState=5), gaar msiexec i
#     "maintenance mode" og goer INGENTING naar man koerer den igen - alle komponenter
#     rapporteres som "Installed: Local, Action: Null". Man kan koere installationen i
#     det uendelige uden at det hjaelper. Derfor oprettes tjenesten om noedvendigt
#     DIREKTE fra binaerfilen med New-Service.

$ErrorActionPreference = 'Continue'
function Sig($t, $f = 'Gray') { Write-Host $t -ForegroundColor $f }

$SID_ADMINS = '*S-1-5-32-544'
$SID_SYSTEM = '*S-1-5-18'
$sshMappe   = 'C:\Program Files\OpenSSH'
$dataMappe  = 'C:\ProgramData\ssh'

$mig = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $mig.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Sig ''
  Sig 'STOP: Dette vindue er ikke administrator.' 'Red'
  Sig 'Hoejreklik paa Start-knappen, vaelg "Terminal (Administrator)", og proev igen.' 'Yellow'
  return
}

Sig ''
Sig '=== BLHO: saetter SSH op paa denne boks ===' 'Cyan'
Sig ''
Sig "Windows : $((Get-CimInstance Win32_OperatingSystem).Caption)"
Sig "Maskine : $env:COMPUTERNAME   Bruger: $env:USERNAME"
Sig ''

# ---------- 1. Binaerfiler ----------
Sig '[1/5] OpenSSH-filer...'
if (-not (Test-Path "$sshMappe\sshd.exe")) {
  $mappe = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
  $msi = Join-Path $mappe 'OpenSSH-Win64.msi'
  if (Test-Path $msi) {
    Sig '      Installerer fra den lokale MSI (ingen internetforbindelse noedvendig)...'
  } else {
    Sig '      Ingen lokal MSI - henter fra Microsofts udgivelse...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $msi = "$env:TEMP\OpenSSH-Win64.msi"
    try {
      Invoke-WebRequest -UseBasicParsing -OutFile $msi -Uri 'https://github.com/PowerShell/Win32-OpenSSH/releases/download/10.0.0.0p2-Preview/OpenSSH-Win64-v10.0.0.0.msi'
    } catch {
      Sig "      Kunne ikke hente: $($_.Exception.Message)" 'Red'
      Sig '      Laeg OpenSSH-Win64.msi ved siden af dette script og proev igen.' 'Yellow'
      return
    }
  }
  $p = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart')
  if ($p.ExitCode -notin 0, 3010) { Sig "      msiexec fejlede med kode $($p.ExitCode)." 'Red'; return }
  Start-Sleep -Seconds 3
}
if (-not (Test-Path "$sshMappe\sshd.exe")) { Sig '      sshd.exe mangler stadig. Stopper.' 'Red'; return }
Sig '      OK.' 'Green'

# ---------- 2. Konfiguration og vaertsnoegler ----------
# sshd naegter at starte uden sshd_config og vaertsnoegler. MSI'en lagde kun
# "sshd_config_default" - den skal kopieres paa plads foerste gang.
Sig '[2/5] Konfiguration og vaertsnoegler...'
New-Item -ItemType Directory -Path $dataMappe -Force | Out-Null
if (-not (Test-Path "$dataMappe\sshd_config") -and (Test-Path "$sshMappe\sshd_config_default")) {
  Copy-Item "$sshMappe\sshd_config_default" "$dataMappe\sshd_config"
}
if (@(Get-ChildItem $dataMappe -Filter 'ssh_host_*_key' -EA 0).Count -eq 0) {
  & "$sshMappe\ssh-keygen.exe" -A 2>&1 | Out-Null
}
Sig "      Vaertsnoegler: $(@(Get-ChildItem $dataMappe -Filter 'ssh_host_*_key' -EA 0).Count) stk." 'Green'

# ---------- 3. Tjenesten ----------
Sig '[3/5] Tjenesten sshd...'
if (-not (Get-Service sshd -EA 0)) {
  # Se faldgrube 2 i toppen: msiexec goer det ikke naar produktet allerede er registreret.
  New-Service -Name 'sshd' -BinaryPathName "`"$sshMappe\sshd.exe`"" -DisplayName 'OpenSSH SSH Server' -StartupType Automatic -EA Stop | Out-Null
  & sc.exe privs sshd SeAssignPrimaryTokenPrivilege/SeTcbPrivilege/SeBackupPrivilege/SeRestorePrivilege/SeImpersonatePrivilege | Out-Null
  & sc.exe failure sshd reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
  Sig '      Oprettet.' 'Green'
}
if (-not (Get-Service ssh-agent -EA 0)) {
  New-Service -Name 'ssh-agent' -BinaryPathName "`"$sshMappe\ssh-agent.exe`"" -DisplayName 'OpenSSH Authentication Agent' -StartupType Manual -EA 0 | Out-Null
}
Set-Service -Name sshd -StartupType Automatic
if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
Sig "      sshd: $((Get-Service sshd).Status)" 'Green'

# ---------- 4. Firewall ----------
# profile=any er noedvendigt: et nyt netvaerk klassificeres som Offentligt, og de fleste
# regler gaelder kun Privat/Domaene. Paa Amager afviste firewall'en ALT indgaaende - ikke
# kun SSH - indtil denne regel kom paa plads.
Sig '[4/5] Firewall...'
& netsh advfirewall firewall delete rule name="BLHO SSH" 2>&1 | Out-Null
& netsh advfirewall firewall add rule name="BLHO SSH" dir=in action=allow protocol=TCP localport=22 profile=any 2>&1 | Out-Null
foreach ($p in (Get-NetConnectionProfile -EA 0)) {
  if ($p.NetworkCategory -eq 'Public') {
    Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private -EA 0
  }
}
Sig '      Port 22 aaben paa alle profiler.' 'Green'

# ---------- 5. PowerShell som standard-shell ----------
Sig '[5/5] PowerShell som standard-shell for SSH...'
if (-not (Test-Path 'HKLM:\SOFTWARE\OpenSSH')) { New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null }
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null
Sig '      Sat.' 'Green'

# ---------- Opsamling ----------
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
$lytter = @(Get-NetTCPConnection -LocalPort 22 -State Listen -EA 0).Count

Sig ''
if ($lytter -gt 0) { Sig '=== SSH ER KLAR ===' 'Green' } else { Sig '=== SSH LYTTER IKKE ===' 'Red' }
Sig ''
Sig "  Brugernavn : $env:USERNAME"
Sig "  IP         : $ip"
Sig "  sshd       : $((Get-Service sshd).Status)  ($lytter socket(s) paa port 22)"
Sig ''
Sig '  Fra din egen pc:' 'Yellow'
Sig "      ssh $env:USERNAME@$ip" 'White'
Sig ''
