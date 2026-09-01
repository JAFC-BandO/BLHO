# BLHO - opsaetning af SSH paa en Windows signage-boks
#
# Koeres paa selve boksen, i en Terminal/PowerShell startet SOM ADMINISTRATOR:
#
#     irm https://jfclabs.dk/BL/win-ssh.ps1 | iex
#
# Scriptet installerer og starter Windows' indbyggede OpenSSH-server, aabner porten i
# firewall'en, saetter PowerShell som standard-shell for indkommende SSH-sessioner, og
# skriver til sidst praecis den kommando du skal bruge fra din egen pc.
#
# Det er sikkert at koere flere gange - hvert trin tjekker foerst om det allerede er gjort.
#
# INDEHOLDER INGEN HEMMELIGHEDER. Det er derfor filen roligt kan ligge i det offentlige
# repo og hentes over HTTPS. Check-in-scriptet, der indeholder skaerm-kontoens adgangskode,
# maa ALDRIG laegges her - det skrives paa boksen eller kopieres ind over SSH.
#
# Se WINDOWS-KIOSK-SETUP.md for resten af opsaetningen.

$ErrorActionPreference = 'Stop'

function Sig($tekst, $farve = 'Gray') { Write-Host $tekst -ForegroundColor $farve }

# ---------- Administrator-tjek ----------
# Uden dette fejler installationen halvvejs inde med en uklar rettighedsfejl.
$mig = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $mig.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Sig ''
  Sig 'STOP: Dette vindue er ikke administrator.' 'Red'
  Sig 'Luk det, hoejreklik paa Start-knappen, vaelg "Terminal (Administrator)", og proev igen.' 'Yellow'
  Sig ''
  return
}

Sig ''
Sig '=== BLHO: saetter SSH op paa denne boks ===' 'Cyan'
Sig ''

# ---------- 1. OpenSSH Server ----------
$kapacitet = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if ($kapacitet.State -eq 'Installed') {
  Sig '[1/4] OpenSSH Server er allerede installeret.'
} else {
  Sig '[1/4] Installerer OpenSSH Server (kan tage et minut)...'
  $kapacitet | Add-WindowsCapability -Online | Out-Null
  Sig '      Installeret.' 'Green'
}

# ---------- 2. Tjenesten ----------
Sig '[2/4] Starter tjenesten og saetter den til automatisk opstart...'
Set-Service -Name sshd -StartupType Automatic
if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
Sig "      sshd: $((Get-Service sshd).Status)" 'Green'

# ---------- 3. Firewall ----------
# Installationen opretter normalt selv reglen, men ikke paalideligt paa alle udgaver -
# og en manglende regel giver en timeout uden nogen forklaring i den anden ende.
$harRegel = Get-NetFirewallRule -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like '*OpenSSH*' -and $_.Enabled -eq 'True' }
if ($harRegel) {
  Sig '[3/4] Firewall-regel findes allerede.'
} else {
  Sig '[3/4] Opretter firewall-regel for port 22...'
  New-NetFirewallRule -Name 'sshd' -DisplayName 'OpenSSH Server (sshd)' `
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  Sig '      Oprettet.' 'Green'
}

# ---------- 4. PowerShell som standard-shell ----------
# Uden dette lander man i cmd.exe, hvor alle kommandoerne i opsaetningsguiden er ubrugelige.
Sig '[4/4] Saetter PowerShell som standard-shell for SSH...'
if (-not (Test-Path 'HKLM:\SOFTWARE\OpenSSH')) {
  New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
}
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell `
  -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -PropertyType String -Force | Out-Null
Sig '      Sat.' 'Green'

# ---------- Opsamling ----------
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
       Select-Object -First 1).IPv4Address.IPAddress
$bruger  = $env:USERNAME
$maskine = $env:COMPUTERNAME
$windows = (Get-CimInstance Win32_OperatingSystem).Caption
$bygning = (Get-CimInstance Win32_OperatingSystem).Version

Sig ''
Sig '=== Faerdig ===' 'Cyan'
Sig ''
Sig "  Brugernavn : $bruger"
Sig "  Maskine    : $maskine"
Sig "  IP         : $ip"
Sig "  Windows    : $windows"
Sig "  Version    : $bygning"
Sig "  sshd       : $((Get-Service sshd).Status)"
Sig ''
Sig '  Fra din egen pc:' 'Yellow'
Sig "      ssh $bruger@$ip" 'White'
Sig ''
Sig '  Send de seks linjer ovenfor videre, saa er resten klar til at blive sat op over SSH.'
Sig ''
