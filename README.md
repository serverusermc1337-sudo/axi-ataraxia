# Axi für Ataraxia

Das ist der Discord-Bot zum Selberhosten, zum Beispiel auf einem Proxmox-Server. Er läuft dauerhaft, solange der Container läuft. Die Ansicht im Browser ist davon getrennt.

Boje, Kaje und Laterne gibt es hier nicht. Das waren Beispiele. Eigene Antworten legst du mit `/befehl` oder `/ki` an. Andere Bots auf dem Server kann Axi nicht fernsteuern und nicht deren Programm übernehmen.

## Was du brauchst

1. Eine Anwendung im [Discord Developer Portal](https://discord.com/developers/applications).
2. Unter **Bot** einen Token. Schalte **Message Content Intent** und **Server Members Intent** ein.
3. Die Application ID und die Server-ID von Ataraxia. Die Server-ID siehst du im Discord-Client, wenn der Entwicklermodus an ist.
4. Docker auf dem Proxmox-Rechner. In einem LXC muss Docker erlaubt sein (Nesting). Eine kleine virtuelle Maschine ist der einfachere Weg.

## Start

```bash
cp .env.example .env
# Token, Application ID und Server-ID eintragen. XAI_API_KEY nur, wenn /ki laufen soll.
docker compose up -d --build
docker compose logs -f
```

Axi lädt die Slash-Befehle nur auf die eingetragene Server-ID. Einladung, ohne Administrator-Recht für den ganzen Server:

`https://discord.com/oauth2/authorize?client_id=DEINE_APPLICATION_ID&scope=bot%20applications.commands&permissions=1099780156502`

Ersetze `DEINE_APPLICATION_ID`. Die Rechte decken Nachrichten, Kick, Bann, Timeout, Kanäle und Rollen ab.

## KI

`/ki`, `/anpassen` und das Aufräumen mit `/optimieren` gehen an xAI in die USA. Jede Person muss vorher `/akzeptieren` sagen. Ohne `XAI_API_KEY` bleibt der Rest des Bots nutzbar, nur die KI nicht.

Die Modellwahl steht in der `.env` als `AI_MODEL` (`grok-4.7`, `grok-4.5` oder `grok-4.3`) und lässt sich auf dem Server mit `/modell` ändern.

## Daten

Die Datenbank liegt im Docker-Volume `axi-data` als SQLite-Datei. Befehle, Fakten, Verwarnungen, Level und die KI-Zustimmung stehen dort. Es werden keine E-Mails oder Telefonnummern gespeichert.

## Befehle

Slash-Befehle wie `/hilfe` und dieselben Befehle mit `!`, zum Beispiel `!ping`. Ein unbekanntes `!tide` merkt sich Axi. Beim zweiten Mal kann `/anpassen` daraus einen eigenen Befehl machen, wenn die KI erlaubt ist.

`/optimieren` räumt nur das Gedächtnis auf und ändert nicht, was `/anpassen` aus der Nutzung baut.
