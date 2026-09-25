# Axi für Ataraxia

Das ist die volle Fassung zum Selberhosten. Sie läuft auf deinem Rechner, die Daten bleiben dort. Die Browser-Ansicht ist davon getrennt und wird nicht gebraucht.

`/recht` stellt dieselben Rechte wie die Web-Seite ein: Mod und Mitglied, jeweils Kicken, Sperren, Timeout, Verwarnen, Löschen, Slowmode, Sagen, Module, Einladen, Rollen, andere Bots. Der Eigner darf immer. `/filter` sperrt Wörter, Links und Großschrift. `/willkommen`, `/status` und `/log` stellen Texte und das Mod-Log ein. `/widerruf` löscht die eigenen Level, Verwarnungen und Freigaben.

Die Web-Seite läuft mit, wenn `WEB_PASSWORD` in der `.env` mindestens 8 Zeichen hat. Danach im Browser der VM `http://IP-DER-VM:8787` öffnen. Dort sind Module, Rechte, Texte, Filter und übernommene Funktionen.

## Start

```bash
git clone https://github.com/serverusermc1337-sudo/axi-ataraxia.git
cd axi-ataraxia
cp .env.example .env
docker compose up -d --build
```

In `.env` gehören `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` und `DISCORD_GUILD_ID`. Für die KI `LOCAL_AI_URL` (LM Studio), `GEMINI_API_KEY` oder `XAI_API_KEY`. Die KI ist aus, bis `/modul ki an`.

Im [Discord Developer Portal](https://discord.com/developers/applications) unter **Bot** die Intents **Server Members** und **Message Content** einschalten.

Einladung, `DEINE_APPLICATION_ID` ersetzen:

`https://discord.com/oauth2/authorize?client_id=DEINE_APPLICATION_ID&scope=bot%20applications.commands&permissions=1099780156502`

## Auf dem Server

`/regeln` und `/akzeptieren` gelten vor den übrigen Befehlen. `/freigabe` schaltet die KI extra frei, sie geht an xAI in die USA.

`/hierarchie` zeigt die Rollen. `/rolle` vergibt die Discord-Rolle **Mod**, die musst du anlegen und unter Axi ziehen. `/kanal` setzt Sehen und Schreiben für alle oder für Mod. `/ueberblick` ändert Name und Beschreibung.

`/hilfe` listet den Rest: Moderation, Tickets, Level, Umfragen, `/ki`, `/anpassen`, `/optimieren`.

Neue Fassung holen:

```bash
cd ~/axi-ataraxia
git pull
sudo docker compose up -d --build
```
