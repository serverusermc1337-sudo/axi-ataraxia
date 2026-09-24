# Axi für Ataraxia

Das ist die volle Fassung zum Selberhosten. Sie läuft auf deinem Rechner, die Daten bleiben dort. Die Browser-Ansicht ist davon getrennt und wird nicht gebraucht.

Andere Discord-Bots kann Axi nicht fernsteuern. Eigene Antworten legst du mit `/befehl` an und nimmst sie mit `/entfernen` wieder runter.

## Start

```bash
git clone https://github.com/serverusermc1337-sudo/axi-ataraxia.git
cd axi-ataraxia
cp .env.example .env
docker compose up -d --build
```

In `.env` gehören `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` und `DISCORD_GUILD_ID`. `XAI_API_KEY` nur, wenn die KI laufen soll.

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
