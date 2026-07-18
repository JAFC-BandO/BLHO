Sæt en Raspberry Pi op som butiksskærm
Hardware: Raspberry Pi 3 Model B v1.2, microSD-kort (8GB+), rigtig 5V/2,5A strømforsyning, HDMI-skærm, netværk.

1. Klargør SD-kortet
Download Raspberry Pi Imager fra raspberrypi.com/software.

Choose Device → Raspberry Pi 3
Choose OS → Raspberry Pi OS (64-bit) (ikke Lite — vi skal bruge skrivebordet til Chromium)
Choose Storage → dit SD-kort
Tryk på tandhjulet (⚙ / Ctrl+Shift+X) før du skriver kortet:

Hostname: fx skaerm-horsens
Enable SSH (adgangskode-login, vælg et rigtigt password)
Username/password til Pi'en
Wifi SSID/password, og Wireless LAN country = DK
Locale: tidszone Europe/Copenhagen, tastatur dk
Med det udfyldt behøver du aldrig skærm/tastatur/mus på selve Pi'en — den forbinder sig selv og har SSH klar med det samme.

Pi 3 v1.2-detalje: kun 2,4 GHz wifi (intet 5 GHz), og kræver en ordentlig 5V/2,5A oplader — en almindelig telefonoplader giver ofte for lidt strøm (ses som et lynikon øverst i hjørnet + ustabil skærm).

2. Første boot og opdatering

ssh dit-brugernavn@skaerm-horsens.local
Virker .local ikke fra Windows (mangler ofte mDNS), find Pi'ens IP i routerens enhedsliste i stedet.


sudo apt update && sudo apt full-upgrade -y
sudo reboot
3. Tidszone/wifi-land (hvis sprunget over i trin 1)

sudo raspi-config
Under Localisation Options: Timezone → Europe/Copenhagen, WLAN Country → DK.

4. Slå skærm-dvale fra
Stadig i raspi-config: Display Options → Screen Blanking → Disable. Ellers går skærmen i sort efter nogle minutter, da en kiosk-skærm jo aldrig bliver "brugt".

5. Installér Chromium + unclutter

sudo apt install -y chromium-browser unclutter || sudo apt install -y chromium unclutter
which chromium-browser || which chromium
Pakkenavnet er skiftet mellem OS-udgaver — noter hvilket der virker, du skal bruge det i trin 7. unclutter skjuler musemarkøren.

6. Byg URL'en til Horsens-skærmen
skaerm.html logger selv ind ud fra ?email= og &password= — det er den samme "skærm"-konto (rolle skaerm) du oprettede til Horsens dengang. Slå den op i Supabase Dashboard → Authentication hvis du er i tvivl.


https://jafc-bando.github.io/BLHO/skaerm.html?email=SKAERM-EMAIL&password=SKAERM-PASSWORD
Adgangskoden ligger i klartekst i et script på SD-kortet — det er OK ud fra samme sikkerhedsmodel som resten af projektet (kontoen kan kun læse én butiks indhold), men et stjålet SD-kort/Pi bør udløse et password-skifte for den butiks skærm-konto. Del aldrig denne URL i chat/mail.

7. Opstartsscript + autostart
~/start-skaerm.sh:


#!/bin/bash
xset s off
xset -dpms
xset s noblank
unclutter -idle 0.5 -root &

# genstarter Chromium automatisk hvis den crasher
while true; do
  chromium-browser --kiosk --incognito \
    --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble \
    "https://jafc-bando.github.io/BLHO/skaerm.html?email=SKAERM-EMAIL&password=SKAERM-PASSWORD"
  sleep 5
done

chmod +x ~/start-skaerm.sh
Autostart:


mkdir -p ~/.config/autostart
cat > ~/.config/autostart/skaerm-kiosk.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Skaerm Kiosk
Exec=/home/dit-brugernavn/start-skaerm.sh
X-GNOME-Autostart-enabled=true
EOF
Og sæt autologin: sudo raspi-config → System Options → Boot / Auto Login → Desktop Autologin.

8. Genstart og bekræft

sudo reboot
Pi'en skal nu selv boote lige ind i fuldskærms Horsens-indhold. Den holder sig selv opdateret bagefter (poller hvert 10. sekund, genindlæser hele siden hvert 10. minut) — I skal ikke selv genstarte den, når vi pusher en ændring.

9. Ny butik
Gentag trin 1-8 med kun to ændringer: nyt hostname i trin 1, og den butiks egen skærm-konto i URL'en. Alt andet er identisk. Ved mange Pi'er: lav et diskimage af den første færdige (fx Win32DiskImager) og skriv det direkte til de næste kort — så skal du kun rette URL+hostname bagefter.

Fejlfinding
Symptom	Tjek
Sort skærm efter boot	Autologin sat? Kør ~/start-skaerm.sh manuelt, se fejlen.
"Denne konto er ikke koblet til en butik"	Email/password matcher ikke en skaerm-konto, eller rolle er ikke præcis skaerm.
Chromium starter ikke	Forkert pakkenavn — se trin 5.
Forkert klokkeslæt	Timezone → Europe/Copenhagen.
Wifi forbinder ikke	WLAN Country = DK? Kun 2,4 GHz på dette board.
Skærmen "blinker"/lynikon	For svag strømforsyning.
Indhold opdaterer ikke	Vent op til 10 min, ellers tjek om det rent faktisk blev gemt i redigeringssiden.
