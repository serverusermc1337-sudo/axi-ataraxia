import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import { askMind, knownModel } from "./ai.js";
import {
  addReminder,
  addWarn,
  addXp,
  dropMemory,
  dropRepertoire,
  flag,
  forgetUser,
  grant,
  granted,
  listOverwrites,
  memoryRows,
  noteUse,
  putMemory,
  repertoireRows,
  saveOverwrite,
  saveRepertoire,
  setSetting,
  setting,
  topMembers,
  warnsOf,
  xpOf,
} from "./db.js";
import { allows, deny, PERM_IDS, setPerm } from "./access.js";
import { KEY, cleanKey, infiltration, personalData } from "./guard.js";
import { register } from "./register.js";

const jokes = [
  "Treffen sich zwei Magnete. Sagt der eine: Was soll ich heute bloß anziehen?",
  "Warum war der Kompass beim Meeting? Er hat immer eine Richtung vorgegeben.",
  "Wie nennt man einen Bot im Urlaub? Offline.",
];
const eight = ["Eher ja.", "Frag nochmal, wenn es ruhig ist.", "Sieht dünn aus.", "Nein. Nicht so.", "Mach es, aber schreib den Grund dazu."];

function level(xp) {
  return Math.floor(xp / 100) + 1;
}

function math(input) {
  const expr = String(input ?? "").replace(/\s/g, "");
  if (!expr || expr.length > 80 || !/^[\d.+\-*/()]+$/.test(expr)) return null;
  try {
    const value = Function(`"use strict"; return (${expr})`)();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function delay(token) {
  const match = /^(\d{1,5})(s|m|h)?$/.exec(token ?? "");
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2] ?? "s";
  const ms = unit === "h" ? n * 3_600_000 : unit === "m" ? n * 60_000 : n * 1000;
  if (ms < 5_000 || ms > 7 * 86_400_000) return null;
  return ms;
}

async function modLog(guild, text) {
  const id = setting("log_channel", "");
  if (!id) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ content: text.slice(0, 1800) }).catch(() => undefined);
}

function hierarchyBlock(guild, actor, target) {
  const me = guild.members.me;
  if (!actor || !target) return "Mitglied nicht gefunden.";
  if (target.id === actor.id) return "Dich selbst nicht.";
  if (target.id === me?.id) return "Axi nicht.";
  const owner = guild.ownerId;
  if (actor.id !== owner && actor.roles.highest.position <= target.roles.highest.position) return "Deine Rolle steht nicht darüber.";
  if (me && me.roles.highest.position <= target.roles.highest.position) return "Axi steht in der Hierarchie unter dieser Rolle.";
  return null;
}

async function resolveBot(ctx) {
  const raw = ctx.text("bot").trim();
  if (!/^\d{17,20}$/.test(raw)) return null;
  const user = await ctx.client.users.fetch(raw).catch(() => null);
  if (!user?.bot || user.id === ctx.client.user.id) return null;
  return user;
}

function modRole(guild) {
  return guild.roles.cache.find((role) => role.name.toLowerCase() === "mod") ?? null;
}

const RULES_TEXT = [
  "Axi ist für den privaten Server Ataraxia. Kein Vertrag mit Discord, keine Garantie auf Dauerbetrieb.",
  "Mit /akzeptieren willigst du in die Speicherung auf diesem Server ein: Befehle, Fakten, Level, Verwarnungen. Keine E-Mails, keine Telefonnummern.",
  "Rechtsgrundlage ist deine Einwilligung. Eine ladungsfähige Anschrift ist nicht hinterlegt. Das ist keine anwaltliche Prüfung.",
  "Die KI ist davon getrennt. Erst /freigabe schickt Frage und Gedächtnis an xAI in die USA. Ohne Freigabe bleibt /ki aus.",
].join("\n");

function splitToken(token) {
  const raw = String(token ?? "").trim();
  const slash = /^\/([a-z0-9-]{2,32})$/i.exec(raw);
  if (slash) return { key: cleanKey(slash[1]), alias: "" };
  const prefixed = /^([a-z0-9]{0,8}[!?.^~])([a-z0-9-]{2,32})$/i.exec(raw);
  if (prefixed) {
    const mark = prefixed[1].toLowerCase();
    const name = cleanKey(prefixed[2]);
    const key = mark.length === 1 ? name : `${cleanKey(mark.replace(/[^a-z0-9]/g, ""))}-${name}`;
    return { key, alias: `${mark}${name}` };
  }
  const bare = /^([a-z0-9-]{2,32})$/i.exec(raw);
  if (bare) return { key: cleanKey(bare[1]), alias: "" };
  return null;
}

const COMMAND_TOKEN = "(?:\\/[a-z0-9-]{2,32}|[a-z0-9]{0,8}[!?.^~][a-z0-9-]{2,32})";

function remember(found, token, bodyRaw) {
  const parts = splitToken(token);
  if (!parts) return;
  const body = String(bodyRaw ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!SLASH_NAME.test(parts.key) || parts.key.length < 2 || catalog.some((item) => item[0] === parts.key)) return;
  if (body.length < 2 || personalData(`${parts.key} ${body}`) || infiltration(`${parts.key} ${body}`)) return;
  if (found.some((item) => item.key === parts.key)) return;
  found.push({ key: parts.key, body, alias: parts.alias });
}

function normalizeMentions(text) {
  return String(text ?? "").replace(/<\/([a-z0-9_-]+(?:\s+[a-z0-9_-]+)*):\d+>/gi, (_, name) => `\n/${name.trim().toLowerCase().replace(/\s+/g, "-")}\n`);
}

function eatenLines(text) {
  const found = [];
  let pending = "";
  const only = new RegExp(`^(${COMMAND_TOKEN})$`, "i");
  const withBody = new RegExp(`^(${COMMAND_TOKEN})\\s+(?:[-–:—|]+\\s*)?(.{2,200})$`, "i");
  for (const raw of normalizeMentions(text).split("\n")) {
    const line = raw.replace(/[*_`~|]/g, "").trim();
    if (!line) continue;
    const alone = only.exec(line);
    if (alone) {
      pending = alone[1];
      continue;
    }
    const paired = withBody.exec(line);
    if (paired) {
      remember(found, paired[1], paired[2]);
      pending = "";
      continue;
    }
    const bareBody = /^([a-z0-9-]{2,32})\s+(?:[-–:—|]+\s*)?(.{2,200})$/.exec(line);
    if (bareBody && !pending) {
      remember(found, bareBody[1], bareBody[2]);
      continue;
    }
    if (pending) {
      remember(found, pending, line);
      pending = "";
    }
  }
  return found.slice(0, 25);
}

function pushLines(lines, value) {
  for (const raw of normalizeMentions(value).split("\n")) {
    const clean = raw.replace(/[*_`~>|]/g, "").trim();
    if (clean) lines.push(clean);
  }
}

function messageText(message) {
  const lines = [];
  pushLines(lines, message.content);
  for (const embed of message.embeds ?? []) {
    pushLines(lines, embed.description);
    pushLines(lines, embed.footer?.text);
    for (const field of embed.fields ?? []) {
      pushLines(lines, field.name);
      pushLines(lines, field.value);
    }
  }
  return lines.join("\n");
}

function menuPages(message) {
  const pages = [];
  for (const row of message.components ?? []) {
    for (const component of row.components ?? []) {
      for (const option of component.options ?? []) {
        if (option.label) pages.push(option.label);
      }
    }
  }
  return pages;
}

function customReply(name) {
  return memoryRows("command").find((row) => row.item_key === name)?.body ?? null;
}

export const catalog = [
  ["hilfe", "Alle Befehle nach Aufgabe", "Orientierung"],
  ["ping", "Prüft, ob Axi wach ist", "Orientierung"],
  ["server", "Steckbrief des Servers", "Orientierung"],
  ["zeit", "Uhrzeit in Berlin", "Orientierung"],
  ["rechnen", "Rechnet plus, minus, mal, geteilt", "Orientierung"],
  ["user", "Profil eines Mitglieds", "Leute"],
  ["avatar", "Bild eines Mitglieds", "Leute"],
  ["level", "Level und Erfahrung", "Leute"],
  ["rangliste", "Die fünf Aktivsten", "Leute"],
  ["umfrage", "Abstimmung", "Gespräch"],
  ["erinnerung", "Erinnert nach Sekunden, Minuten oder Stunden", "Gespräch"],
  ["wuerfel", "Würfelt", "Gespräch"],
  ["muenze", "Kopf oder Zahl", "Gespräch"],
  ["achtball", "Eine trockene Antwort", "Gespräch"],
  ["witz", "Ein kurzer Witz", "Gespräch"],
  ["ticket", "Öffnet einen privaten Kanal", "Anliegen"],
  ["schliessen", "Schließt dieses Ticket", "Anliegen"],
  ["warn", "Verwarnung", "Moderation"],
  ["verwarnungen", "Liste der Verwarnungen", "Moderation"],
  ["timeout", "Stummschalten in Minuten", "Moderation"],
  ["kick", "Entfernt ein Mitglied", "Moderation"],
  ["ban", "Sperrt ein Mitglied", "Moderation"],
  ["clear", "Löscht die letzten Nachrichten", "Moderation"],
  ["slowmode", "Pause zwischen Nachrichten", "Moderation"],
  ["sagen", "Axi sagt den Text", "Moderation"],
  ["sicherheit", "Rechte und Grenzen von Axi", "Server"],
  ["hierarchie", "Rollen von oben nach unten", "Server"],
  ["rolle", "Setzt Mitglied oder Mod", "Server"],
  ["kanal", "Sehen und Schreiben für einen Kanal", "Server"],
  ["ueberblick", "Name und Beschreibung des Servers", "Server"],
  ["einladen", "Erstellt einen Einladungslink", "Server"],
  ["bots", "Bots auf diesem Server", "Andere Bots"],
  ["adaptieren", "Übernimmt eine Funktion eines Bots", "Andere Bots"],
  ["eatbot", "Übernimmt alle sichtbaren Funktionen eines Bots", "Andere Bots"],
  ["steuern", "Führt eine übernommene Funktion aus", "Andere Bots"],
  ["recht", "Schaltet ein Rollenrecht an oder aus", "Server"],
  ["filter", "Wortfilter, Links und Großschrift", "Server"],
  ["willkommen", "Text für neue Mitglieder", "Server"],
  ["status", "Statustext von Axi", "Server"],
  ["log", "Kanal für das Mod-Log", "Server"],
  ["widerruf", "Zieht die Einwilligung zurück und löscht eigene Daten", "Lernen"],
  ["modul", "Schaltet ein Modul an oder aus", "Server"],
  ["modell", "Wählt die KI", "Server"],
  ["befehl", "Legt einen eigenen Befehl fest", "Lernen"],
  ["entfernen", "Nimmt einen eigenen Befehl wieder runter", "Lernen"],
  ["wissen", "Zeigt das Gedächtnis", "Lernen"],
  ["ki", "Antwortet und speichert ein Feature, wenn es passt", "Lernen"],
  ["anpassen", "Ändert Befehle aus Nutzung und Anfragen", "Lernen"],
  ["optimieren", "Räumt das Gedächtnis auf", "Lernen"],
  ["regeln", "AGB, Speicherung und Datenschutz", "Lernen"],
  ["akzeptieren", "Willigt in die Speicherung ein", "Lernen"],
  ["freigabe", "Erlaubt die KI extra", "Lernen"],
];

export function slashCommands() {
  const opt = {
    hilfe: (b) => b,
    ping: (b) => b,
    server: (b) => b,
    zeit: (b) => b,
    rechnen: (b) => b.addStringOption((o) => o.setName("aufgabe").setDescription("Zum Beispiel (2+3)*4").setRequired(true)),
    user: (b) => b.addUserOption((o) => o.setName("mitglied").setDescription("Wer")),
    avatar: (b) => b.addUserOption((o) => o.setName("mitglied").setDescription("Wer")),
    level: (b) => b.addUserOption((o) => o.setName("mitglied").setDescription("Wer")),
    rangliste: (b) => b,
    umfrage: (b) => b.addStringOption((o) => o.setName("frage").setDescription("Frage | Ja | Nein").setRequired(true)),
    erinnerung: (b) =>
      b
        .addStringOption((o) => o.setName("wann").setDescription("Zum Beispiel 20s, 5m, 1h").setRequired(true))
        .addStringOption((o) => o.setName("text").setDescription("Woran").setRequired(true)),
    wuerfel: (b) => b.addIntegerOption((o) => o.setName("seiten").setDescription("Standard 6").setMinValue(2).setMaxValue(1000)),
    muenze: (b) => b,
    achtball: (b) => b.addStringOption((o) => o.setName("frage").setDescription("Frage").setRequired(true)),
    witz: (b) => b,
    ticket: (b) => b.addStringOption((o) => o.setName("thema").setDescription("Worum es geht").setRequired(true)),
    schliessen: (b) => b,
    warn: (b) =>
      b
        .addUserOption((o) => o.setName("mitglied").setDescription("Wer").setRequired(true))
        .addStringOption((o) => o.setName("grund").setDescription("Grund").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    verwarnungen: (b) => b.addUserOption((o) => o.setName("mitglied").setDescription("Wer")),
    timeout: (b) =>
      b
        .addUserOption((o) => o.setName("mitglied").setDescription("Wer").setRequired(true))
        .addIntegerOption((o) => o.setName("minuten").setDescription("0 hebt auf").setRequired(true).setMinValue(0).setMaxValue(10080))
        .addStringOption((o) => o.setName("grund").setDescription("Grund"))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    kick: (b) =>
      b
        .addUserOption((o) => o.setName("mitglied").setDescription("Wer").setRequired(true))
        .addStringOption((o) => o.setName("grund").setDescription("Grund"))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    ban: (b) =>
      b
        .addUserOption((o) => o.setName("mitglied").setDescription("Wer").setRequired(true))
        .addStringOption((o) => o.setName("grund").setDescription("Grund"))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    clear: (b) =>
      b
        .addIntegerOption((o) => o.setName("anzahl").setDescription("2 bis 100").setRequired(true).setMinValue(2).setMaxValue(100))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    slowmode: (b) =>
      b
        .addIntegerOption((o) => o.setName("sekunden").setDescription("0 aus, höchstens 21600").setRequired(true).setMinValue(0).setMaxValue(21600))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    sagen: (b) =>
      b
        .addStringOption((o) => o.setName("text").setDescription("Was Axi sagen soll").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    sicherheit: (b) => b,
    hierarchie: (b) => b,
    rolle: (b) =>
      b
        .addUserOption((o) => o.setName("mitglied").setDescription("Wer").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("stand")
            .setDescription("mod oder mitglied")
            .setRequired(true)
            .addChoices({ name: "mod", value: "mod" }, { name: "mitglied", value: "mitglied" }),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    kanal: (b) =>
      b
        .addChannelOption((o) => o.setName("kanal").setDescription("Welcher Kanal").addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) =>
          o.setName("ziel").setDescription("Für wen").addChoices({ name: "alle", value: "alle" }, { name: "mod", value: "mod" }),
        )
        .addStringOption((o) =>
          o.setName("recht").setDescription("sehen oder schreiben").addChoices({ name: "sehen", value: "sehen" }, { name: "schreiben", value: "schreiben" }),
        )
        .addStringOption((o) =>
          o
            .setName("stand")
            .setDescription("an, aus oder erben")
            .addChoices({ name: "an", value: "an" }, { name: "aus", value: "aus" }, { name: "erben", value: "erben" }),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    ueberblick: (b) =>
      b
        .addStringOption((o) => o.setName("name").setDescription("Neuer Servername"))
        .addStringOption((o) => o.setName("text").setDescription("Kurze Beschreibung"))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    einladen: (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.CreateInstantInvite),
    bots: (b) => b,
    adaptieren: (b) =>
      b
        .addStringOption((o) => o.setName("bot").setDescription("Bot auf diesem Server").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("befehl").setDescription("Befehlsname").setRequired(true))
        .addStringOption((o) => o.setName("antwort").setDescription("Was Axi darauf antwortet").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    eatbot: (b) =>
      b
        .addStringOption((o) => o.setName("bot").setDescription("Bot auf diesem Server").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("liste").setDescription("Optional: eine Zeile pro Befehl, Name und Antwort")),
    steuern: (b) =>
      b
        .addStringOption((o) => o.setName("bot").setDescription("Bot auf diesem Server").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("befehl").setDescription("Übernommene Funktion, sonst nur die Liste")),
    recht: (b) =>
      b
        .addStringOption((o) =>
          o.setName("rolle").setDescription("mod oder mitglied").setRequired(true).addChoices({ name: "mod", value: "mod" }, { name: "mitglied", value: "member" }),
        )
        .addStringOption((o) =>
          o
            .setName("recht")
            .setDescription("Welches Recht")
            .setRequired(true)
            .addChoices(...PERM_IDS.map((id) => ({ name: id, value: id }))),
        )
        .addStringOption((o) =>
          o.setName("stand").setDescription("an oder aus").setRequired(true).addChoices({ name: "an", value: "an" }, { name: "aus", value: "aus" }),
        ),
    filter: (b) =>
      b
        .addStringOption((o) =>
          o
            .setName("art")
            .setDescription("Was der Filter tun soll")
            .setRequired(true)
            .addChoices(
              { name: "wort", value: "wort" },
              { name: "weg", value: "weg" },
              { name: "links", value: "links" },
              { name: "caps", value: "caps" },
            ),
        )
        .addStringOption((o) => o.setName("wert").setDescription("Wort, an/aus oder Prozent")),
    willkommen: (b) => b.addStringOption((o) => o.setName("text").setDescription("Text, {name} wird ersetzt").setRequired(true)),
    status: (b) => b.addStringOption((o) => o.setName("text").setDescription("Kurzer Status").setRequired(true)),
    log: (b) => b.addChannelOption((o) => o.setName("kanal").setDescription("Mod-Log").addChannelTypes(ChannelType.GuildText)),
    widerruf: (b) => b,
    modul: (b) =>
      b
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Modul")
            .setRequired(true)
            .addChoices(
              { name: "automod", value: "automod" },
              { name: "levels", value: "levels" },
              { name: "welcome", value: "welcome" },
              { name: "tickets", value: "tickets" },
            ),
        )
        .addStringOption((o) =>
          o.setName("stand").setDescription("an oder aus").setRequired(true).addChoices({ name: "an", value: "an" }, { name: "aus", value: "aus" }),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    modell: (b) =>
      b
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Grok-Modell")
            .setRequired(true)
            .addChoices(
              { name: "Grok 4.7", value: "grok-4.7" },
              { name: "Grok 4.5", value: "grok-4.5" },
              { name: "Grok 4.3", value: "grok-4.3" },
            ),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    befehl: (b) =>
      b
        .addStringOption((o) => o.setName("name").setDescription("Befehlsname, ohne Zeichen").setRequired(true))
        .addStringOption((o) => o.setName("antwort").setDescription("Leer löscht den Befehl"))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    entfernen: (b) =>
      b
        .addStringOption((o) => o.setName("name").setDescription("Welcher eigene Befehl").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    wissen: (b) => b,
    ki: (b) => b.addStringOption((o) => o.setName("wunsch").setDescription("Was Axi können oder wissen soll").setRequired(true)),
    anpassen: (b) => b,
    optimieren: (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    akzeptieren: (b) => b,
    freigabe: (b) => b,
    regeln: (b) => b,
  };
  return catalog.map(([name, description]) => {
    const builder = new SlashCommandBuilder().setName(name).setDescription(description);
    return (opt[name]?.(builder) ?? builder).toJSON();
  });
}

const SLASH_NAME = /^[a-z0-9-]{1,32}$/;

export function allSlashCommands() {
  const taken = repertoireRows().filter((row) => SLASH_NAME.test(row.trigger) && !catalog.some((item) => item[0] === row.trigger));
  const extra = taken.map((row) => new SlashCommandBuilder().setName(row.trigger).setDescription(`Von ${row.bot_name}`.slice(0, 100)).toJSON());
  const seen = new Set();
  return [...slashCommands(), ...extra].filter((command) => {
    if (seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });
}

async function refreshSlash() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) return;
  await register(token, clientId, guildId, allSlashCommands());
}

function chunks(text) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > 1900) {
    let cut = rest.lastIndexOf("\n", 1900);
    if (cut < 400) cut = 1900;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function helpPages(serverName) {
  const groups = ["Orientierung", "Leute", "Gespräch", "Anliegen", "Moderation", "Server", "Andere Bots", "Lernen"];
  const owned = new Set(repertoireRows().map((row) => row.trigger));
  const base = groups
    .map((group) => {
      const rows = catalog.filter((item) => item[2] === group).map(([name, description]) => `/${name} — ${description}`);
      const own = group === "Lernen" ? memoryRows("command").filter((row) => !owned.has(row.item_key)).map((row) => `/${row.item_key} — ${row.body}`) : [];
      return [`**${group}**`, ...rows, ...own].join("\n");
    })
    .join("\n\n");
  const byBot = new Map();
  for (const row of repertoireRows()) {
    const body = memoryRows("command").find((command) => command.item_key === row.trigger)?.body ?? "";
    const bucket = byBot.get(row.bot_id) ?? { name: row.bot_name, id: row.bot_id, rows: [] };
    bucket.rows.push(`${row.alias || `/${row.trigger}`} — ${body}`);
    byBot.set(row.bot_id, bucket);
  }
  const blocks = [...byBot.values()].map((bucket) => `**${bucket.name}**\n<@${bucket.id}>\n${bucket.rows.join("\n")}`);
  const pages = chunks(`Axi auf **${serverName}**.\n\n${base}`);
  if (blocks.length) pages.push(...chunks(`**Übernommen**\n\n${blocks.join("\n\n")}`));
  else pages.push("**Übernommen**\nNoch keine Funktionen von anderen Bots.");
  return pages;
}

export async function runCommand(name, ctx) {
  const member = ctx.member;
  const target = ctx.userOf?.("mitglied") ?? ctx.user;
  switch (name) {
    case "hilfe": {
      await ctx.defer();
      const pages = helpPages(ctx.guild?.name ?? "Ataraxia");
      await ctx.edit({ content: pages[0] });
      for (const page of pages.slice(1)) await ctx.more({ content: page });
      return;
    }
    case "ping":
      return ctx.reply({ content: "Pong. Axi ist wach." });
    case "server":
      return ctx.reply({ content: `**${ctx.guild.name}** · ${ctx.guild.memberCount} Mitglieder\n${setting("about", setting("status", "Privater Server Ataraxia."))}` });
    case "zeit":
      return ctx.reply({
        content: `In Berlin ist es ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date())}.`,
      });
    case "rechnen": {
      const value = math(ctx.text("aufgabe"));
      return ctx.reply({ content: value === null ? "Nur Zahlen und + - * / ( )." : `= ${value}` });
    }
    case "user":
    case "level": {
      const xp = xpOf(target.id);
      return ctx.reply({ content: `**${target.username}** · Level ${level(xp)} · ${xp} XP · ${warnsOf(target.id).length} Verwarnungen` });
    }
    case "avatar":
      return ctx.reply({ content: target.displayAvatarURL({ size: 256 }) });
    case "rangliste": {
      const lines = topMembers().map((row, index) => `${index + 1}. <@${row.user_id}> · Level ${level(row.xp)} · ${row.xp} XP`);
      return ctx.reply({ content: lines.join("\n") || "Noch niemand." });
    }
    case "umfrage": {
      const parts = ctx.text("frage").split("|").map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return ctx.reply({ content: "So: Frage | Ja | Nein" });
      const message = await ctx.channel.send({ content: `**${parts[0]}**\n${parts.slice(1).map((part, index) => `${index + 1}. ${part}`).join("\n")}` });
      for (const emoji of ["1️⃣", "2️⃣", "3️⃣", "4️⃣"].slice(0, parts.length - 1)) await message.react(emoji);
      return ctx.reply({ content: "Umfrage steht.", ephemeral: true });
    }
    case "erinnerung": {
      const wait = delay(ctx.text("wann"));
      if (!wait) return ctx.reply({ content: "Zum Beispiel 20s, 5m oder 1h." });
      addReminder(Date.now() + wait, ctx.channel.id, ctx.text("text"), ctx.user.username);
      return ctx.reply({ content: "Ich merke es mir." });
    }
    case "wuerfel": {
      const sides = ctx.int("seiten") || 6;
      return ctx.reply({ content: `Würfel (${sides}): **${1 + Math.floor(Math.random() * sides)}**` });
    }
    case "muenze":
      return ctx.reply({ content: Math.random() < 0.5 ? "Kopf." : "Zahl." });
    case "achtball":
      return ctx.reply({ content: eight[Math.floor(Math.random() * eight.length)] });
    case "witz":
      return ctx.reply({ content: jokes[Math.floor(Math.random() * jokes.length)] });
    case "ticket": {
      if (!flag("tickets")) return ctx.reply({ content: "Tickets sind aus." });
      const topic = ctx.text("thema").slice(0, 80);
      const channel = await ctx.guild.channels.create({
        name: `ticket-${ctx.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "ticket",
        type: ChannelType.GuildText,
        topic: `axi:${ctx.user.id} ${topic}`,
        permissionOverwrites: [
          { id: ctx.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: ctx.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: ctx.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
        ],
      });
      await channel.send({ content: `<@${ctx.user.id}> · ${topic}\nZumachen mit /schliessen` });
      return ctx.reply({ content: `Ticket: ${channel}` });
    }
    case "schliessen": {
      if (!ctx.channel.name?.startsWith("ticket-")) return ctx.reply({ content: "Das ist kein Ticket." });
      const ownerId = /^axi:(\d+)/.exec(ctx.channel.topic ?? "")?.[1];
      const isMod = member?.roles?.cache?.some((role) => role.name.toLowerCase() === "mod") || member?.id === ctx.guild.ownerId;
      if (ownerId && ctx.user.id !== ownerId && !isMod) return ctx.reply({ content: "Nur die Person, die es öffnete, oder Mod." });
      await ctx.reply({ content: "Ich mache das Ticket zu." });
      await ctx.channel.delete("Ticket geschlossen");
      return;
    }
    case "warn": {
      if (!allows(member, "warn")) return ctx.reply({ content: deny("warn") });
      const who = ctx.userOf("mitglied");
      if (!who) return ctx.reply({ content: "Nenn ein Mitglied." });
      const person = await ctx.guild.members.fetch(who.id).catch(() => null);
      const blocked = hierarchyBlock(ctx.guild, member, person);
      if (blocked) return ctx.reply({ content: blocked });
      const warns = addWarn(who.id, ctx.text("grund") || "Kein Grund");
      if (warns.length >= 3) await person?.timeout(10 * 60_000, "drei Verwarnungen").catch(() => undefined);
      await modLog(ctx.guild, `Verwarnung ${who.username} (${warns.length}/3)`);
      return ctx.reply({ content: `${who} verwarnt (${warns.length}/3).` });
    }
    case "verwarnungen": {
      const who = ctx.userOf("mitglied") ?? ctx.user;
      const lines = warnsOf(who.id).map((warn, index) => `${index + 1}. ${warn.reason}`);
      return ctx.reply({ content: lines.join("\n") || "Keine Verwarnungen." });
    }
    case "timeout": {
      if (!allows(member, "timeout")) return ctx.reply({ content: deny("timeout") });
      const picked = ctx.userOf("mitglied");
      if (!picked) return ctx.reply({ content: "Nenn ein Mitglied." });
      const who = await ctx.guild.members.fetch(picked.id);
      const blocked = hierarchyBlock(ctx.guild, member, who);
      if (blocked) return ctx.reply({ content: blocked });
      const minutes = ctx.int("minuten");
      await who.timeout(minutes ? minutes * 60_000 : null, ctx.text("grund") || "Timeout");
      await modLog(ctx.guild, minutes ? `Timeout ${who.user.username} ${minutes} Minuten` : `Timeout aufgehoben ${who.user.username}`);
      return ctx.reply({ content: minutes ? `${who} ist ${minutes} Minuten still.` : `Timeout von ${who} aufgehoben.` });
    }
    case "kick":
    case "ban": {
      const bit = name === "ban" ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.KickMembers;
      if (!allows(member, name)) return ctx.reply({ content: deny(name) });
      const picked = ctx.userOf("mitglied");
      if (!picked) return ctx.reply({ content: "Nenn ein Mitglied." });
      const who = await ctx.guild.members.fetch(picked.id);
      const blocked = hierarchyBlock(ctx.guild, member, who);
      if (blocked) return ctx.reply({ content: blocked });
      const reason = ctx.text("grund") || "Kein Grund";
      if (name === "ban") await who.ban({ reason });
      else await who.kick(reason);
      await modLog(ctx.guild, `${name} ${who.user.username}: ${reason}`);
      return ctx.reply({ content: name === "ban" ? `${who.user.username} ist gesperrt.` : `${who.user.username} wurde entfernt.` });
    }
    case "clear": {
      if (!allows(member, "clear")) return ctx.reply({ content: deny("clear") });
      const count = Math.min(100, Math.max(2, ctx.int("anzahl") || 2));
      const deleted = await ctx.channel.bulkDelete(count, true);
      return ctx.reply({ content: `${deleted.size} Nachrichten weg.`, ephemeral: true });
    }
    case "slowmode": {
      if (!allows(member, "slowmode")) return ctx.reply({ content: deny("slowmode") });
      const seconds = ctx.int("sekunden") || 0;
      await ctx.channel.setRateLimitPerUser(seconds);
      return ctx.reply({ content: seconds ? `Slowmode ${seconds}s.` : "Slowmode aus." });
    }
    case "sagen": {
      if (!allows(member, "sagen")) return ctx.reply({ content: deny("sagen") });
      const text = ctx.text("text").slice(0, 500);
      if (personalData(text) || infiltration(text)) return ctx.reply({ content: "Den Text sage ich nicht." });
      await ctx.channel.send({ content: text });
      return ctx.reply({ content: "Gesagt.", ephemeral: true });
    }
    case "sicherheit":
      return ctx.reply({
        content:
          "Axi nutzt die Discord-Rollen. Eine Aktion geht nur, wenn du und Axi über der Zielrolle steht.\n" +
          "/kanal setzt Sehen und Schreiben pro Kanal. /rolle vergibt die Rolle Mod.\n" +
          "Erst /akzeptieren speichert Daten. Die KI braucht zusätzlich /freigabe und geht an xAI in die USA.\n" +
          "Axi steuert keine anderen Bots. Eigene Antworten: /befehl und /entfernen.",
      });
    case "hierarchie": {
      const lines = [...ctx.guild.roles.cache.values()]
        .filter((role) => role.id !== ctx.guild.id)
        .sort((a, b) => b.position - a.position)
        .slice(0, 30)
        .map((role, index) => `${index + 1}. ${role.name}`);
      return ctx.reply({ content: lines.join("\n") || "Keine Rollen." });
    }
    case "rolle": {
      if (!allows(member, "rollen")) return ctx.reply({ content: deny("rollen") });
      const picked = ctx.userOf("mitglied");
      if (!picked) return ctx.reply({ content: "Nenn ein Mitglied." });
      const who = await ctx.guild.members.fetch(picked.id);
      const blocked = hierarchyBlock(ctx.guild, member, who);
      if (blocked) return ctx.reply({ content: blocked });
      const role = modRole(ctx.guild);
      if (!role) return ctx.reply({ content: "Lege in Discord eine Rolle namens Mod an und zieh sie unter Axi." });
      if (ctx.text("stand") === "mod") await who.roles.add(role);
      else await who.roles.remove(role);
      return ctx.reply({ content: ctx.text("stand") === "mod" ? `${who} ist Mod.` : `${who} ist Mitglied.` });
    }
    case "kanal": {
      if (!allows(member, "rollen")) return ctx.reply({ content: deny("rollen") });
      const channel = ctx.channelOf?.("kanal") ?? ctx.channel;
      const ziel = ctx.text("ziel");
      const recht = ctx.text("recht");
      const stand = ctx.text("stand");
      if (!ziel || !recht || !stand) {
        const rows = listOverwrites(channel.id).map((row) => `${row.role_key} · ${row.perm} · ${row.stand}`);
        return ctx.reply({ content: rows.join("\n") || "Keine eigenen Kanalrechte. /kanal mit Ziel, Recht und Stand." });
      }
      const role = ziel === "mod" ? modRole(ctx.guild) : ctx.guild.roles.everyone;
      if (!role) return ctx.reply({ content: "Lege eine Rolle namens Mod an." });
      const bit = recht === "sehen" ? "ViewChannel" : "SendMessages";
      await channel.permissionOverwrites.edit(role, { [bit]: stand === "erben" ? null : stand === "an" });
      saveOverwrite(channel.id, ziel, recht, stand);
      return ctx.reply({ content: `${channel} · ${ziel} · ${recht} · ${stand}.` });
    }
    case "ueberblick": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const name = ctx.text("name").trim();
      const text = ctx.text("text").trim();
      if (!name && !text) {
        return ctx.reply({ content: `**${ctx.guild.name}**\n${setting("about", "Privater Server Ataraxia.")}` });
      }
      if (name.length >= 2) await ctx.guild.setName(name.slice(0, 100));
      if (text) setSetting("about", text.slice(0, 240));
      return ctx.reply({ content: `**${ctx.guild.name}**\n${setting("about", "Privater Server Ataraxia.")}` });
    }
    case "einladen": {
      if (!allows(member, "einladen")) return ctx.reply({ content: deny("einladen") });
      const invite = await ctx.channel.createInvite({ maxAge: 60 * 60 * 24, maxUses: 1, unique: true });
      return ctx.reply({ content: invite.url, ephemeral: true });
    }
    case "bots": {
      await ctx.guild.members.fetch();
      const bots = ctx.guild.members.cache.filter((item) => item.user.bot && item.id !== ctx.client.user.id);
      if (!bots.size) return ctx.reply({ content: "Keine anderen Bots auf dem Server." });
      const taken = repertoireRows();
      const lines = [...bots.values()].map((item) => {
        const count = taken.filter((row) => row.bot_id === item.id).length;
        return `${item} · ${count ? `${count} bei Axi` : "noch nichts übernommen"}`;
      });
      return ctx.reply({ content: lines.join("\n").slice(0, 1900) });
    }
    case "adaptieren": {
      if (!allows(member, "bots")) return ctx.reply({ content: deny("bots") });
      const botUser = await resolveBot(ctx);
      if (!botUser) return ctx.reply({ content: "Nenn einen anderen Bot. Im Feld nur die Vorschläge nehmen, keine normalen Mitglieder." });
      const key = cleanKey(ctx.text("befehl"));
      const body = ctx.text("antwort").trim().slice(0, 200);
      if (!KEY.test(key) || catalog.some((item) => item[0] === key)) return ctx.reply({ content: "Der Name geht nicht. 2–16 Buchstaben, kein fester Befehl." });
      if (!SLASH_NAME.test(key)) return ctx.reply({ content: "Nur Kleinbuchstaben, Zahlen und Bindestrich. So wird es ein Slash-Befehl." });
      if (!body || personalData(`${key} ${body}`) || infiltration(`${key} ${body}`)) return ctx.reply({ content: "Die Antwort speichere ich nicht." });
      putMemory("command", key, body);
      saveRepertoire(key, botUser.id, botUser.username);
      await refreshSlash();
      return ctx.reply({ content: `/${key} gehört jetzt Axi, Kategorie ${botUser.username}. ${botUser} führt sie nicht aus.` });
    }
    case "eatbot": {
      if (!allows(member, "bots")) return ctx.reply({ content: deny("bots") });
      await ctx.defer();
      const botUser = await resolveBot(ctx);
      if (!botUser) return ctx.edit({ content: "Nenn einen Bot aus den Vorschlägen." });
      let source = ctx.text("liste").trim();
      let pages = [];
      if (!source && ctx.channel?.messages) {
        const fetched = await ctx.channel.messages.fetch({ limit: 100 }).catch(() => null);
        const fromBot = [...(fetched?.values() ?? [])].filter((item) => item.author.id === botUser.id);
        source = fromBot.map((item) => messageText(item)).join("\n");
        pages = [...new Set(fromBot.flatMap((item) => menuPages(item)))];
        if (!fromBot.length) {
          return ctx.edit({ content: "Von diesem Bot sind hier keine Nachrichten, auch keine Embeds. Seine Hilfe muss in diesem Kanal stehen, oder du fügst die Liste ein." });
        }
      }
      const rows = eatenLines(source);
      if (!rows.length) {
        return ctx.edit({
          content: source
            ? "Nachrichten und Embeds gesehen, aber keine Befehle erkannt. Im Embed soll der Feldname der Befehl sein, oder eine Zeile: tide Die Tide dreht."
            : "Discord gibt die Befehlsliste eines anderen Bots nicht heraus. Seine Hilfe muss in diesem Kanal stehen, oder du fügst sie unter liste ein.",
        });
      }
      for (const row of rows) {
        putMemory("command", row.key, row.body);
        saveRepertoire(row.key, botUser.id, botUser.username, row.alias || "");
      }
      await refreshSlash();
      const label = (row) => (row.alias && !row.alias.startsWith("/") ? row.alias : `/${row.key}`);
      const extra = pages.length > 1 ? ` Offen ist nur eine Seite. Im Menü stehen noch: ${pages.join(", ")}. Jede Seite einmal aufklappen, danach /eatbot wieder.` : "";
      return ctx.edit({ content: `${rows.length} Funktionen von ${botUser.username} liegen jetzt bei Axi: ${rows.map(label).join(", ")}. ${botUser} selbst bleibt unverändert.${extra}`.slice(0, 1900) });
    }
    case "steuern": {
      const botUser = await resolveBot(ctx);
      if (!botUser) return ctx.reply({ content: "Nenn den Bot aus den Vorschlägen." });
      const rows = repertoireRows().filter((row) => row.bot_id === botUser.id);
      const wanted = cleanKey(ctx.text("befehl"));
      if (wanted) {
        const hit = rows.find((row) => row.trigger === wanted);
        const body = memoryRows("command").find((command) => command.item_key === wanted)?.body;
        if (!hit || !body) return ctx.reply({ content: `/${wanted} liegt nicht bei Axi für ${botUser}.` });
        return ctx.reply({ content: body });
      }
      if (!rows.length) return ctx.reply({ content: `${botUser} kann ich nicht fernsteuern. /adaptieren übernimmt eine Funktion, /steuern führt sie dann aus.` });
      return ctx.reply({ content: `${botUser} bleibt selbstständig. Bei Axi liegen: ${rows.map((row) => `/${row.trigger}`).join(", ")}.` });
    }
    case "recht": {
      if (!allows(member, "rollen") && member?.id !== ctx.guild.ownerId) return ctx.reply({ content: deny("rollen") });
      const role = ctx.text("rolle") === "mod" ? "mod" : "member";
      const perm = ctx.text("recht");
      if (!setPerm(role, perm, ctx.text("stand") === "an")) return ctx.reply({ content: "Das Recht gibt es nicht." });
      return ctx.reply({ content: `${role === "mod" ? "Mod" : "Mitglied"} · ${perm} ist ${ctx.text("stand")}.` });
    }
    case "filter": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const art = ctx.text("art");
      const wert = ctx.text("wert").trim().toLowerCase();
      if (art === "links") {
        setSetting("block_links", wert === "aus" ? "aus" : "an");
        return ctx.reply({ content: `Links sind ${wert === "aus" ? "aus" : "an"}.` });
      }
      if (art === "caps") {
        const percent = Math.max(0, Math.min(100, Number(wert) || 0));
        setSetting("caps", String(percent));
        return ctx.reply({ content: percent ? `Großschrift ab ${percent} Prozent.` : "Großschrift-Filter aus." });
      }
      const key = cleanKey(wert);
      if (!KEY.test(key)) return ctx.reply({ content: "Wort: 2–16 Buchstaben." });
      if (art === "weg") {
        dropMemory("word", key);
        return ctx.reply({ content: `${key} ist aus dem Filter.` });
      }
      putMemory("word", key, key);
      return ctx.reply({ content: `${key} steht im Filter.` });
    }
    case "willkommen": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const text = ctx.text("text").trim().slice(0, 240);
      if (personalData(text)) return ctx.reply({ content: "Keine E-Mails oder Nummern." });
      putMemory("welcome", "text", text);
      return ctx.reply({ content: "Willkommenstext gespeichert. {name} wird ersetzt." });
    }
    case "status": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const text = ctx.text("text").trim().slice(0, 60);
      setSetting("status", text);
      await ctx.client.user.setPresence({ activities: [{ name: text }], status: "online" });
      return ctx.reply({ content: `Status: ${text}` });
    }
    case "log": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const channel = ctx.channelOf?.("kanal") ?? ctx.channel;
      setSetting("log_channel", channel.id);
      return ctx.reply({ content: `Mod-Log ist ${channel}.` });
    }
    case "widerruf": {
      forgetUser(ctx.user.id);
      return ctx.reply({ content: "Einwilligung zurückgezogen. Deine Level, Verwarnungen und Freigaben auf diesem Server sind gelöscht. Gemeinsame Befehle bleiben.", ephemeral: true });
    }
    case "modul": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      setSetting(ctx.text("name"), ctx.text("stand"));
      return ctx.reply({ content: `${ctx.text("name")} ist ${ctx.text("stand")}.` });
    }
    case "modell": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const model = knownModel(ctx.text("name"));
      setSetting("model", model);
      return ctx.reply({ content: `KI ist ${model}. /ki, /anpassen und /optimieren nutzen sie.` });
    }
    case "befehl": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const key = cleanKey(ctx.text("name"));
      const body = (ctx.text("antwort") ?? "").trim().slice(0, 200);
      if (!KEY.test(key) || catalog.some((item) => item[0] === key)) return ctx.reply({ content: "Der Name geht nicht. 2–16 Buchstaben, kein fester Befehl." });
      if (personalData(`${key} ${body}`) || infiltration(`${key} ${body}`)) return ctx.reply({ content: "Den Befehl speichere ich nicht." });
      if (!body) {
        dropMemory("command", key);
        return ctx.reply({ content: `!${key} ist weg.` });
      }
      putMemory("command", key, body);
      return ctx.reply({ content: `!${key} gehört jetzt Axi.` });
    }
    case "entfernen": {
      if (!allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const key = cleanKey(ctx.text("name"));
      if (!KEY.test(key)) return ctx.reply({ content: "Den Befehl gibt es nicht." });
      dropMemory("command", key);
      dropRepertoire(key);
      await refreshSlash();
      return ctx.reply({ content: `/${key} ist aus dem Repertoire.` });
    }
    case "wissen": {
      const taken = repertoireRows();
      const lines = [
        ...memoryRows("command").map((row) => {
          const owned = taken.find((item) => item.trigger === row.item_key);
          return `${owned?.alias || `/${row.item_key}`} — ${row.body}`;
        }),
        ...memoryRows("fact").map((row) => `${row.item_key}: ${row.body}`),
      ];
      return ctx.reply({ content: lines.join("\n").slice(0, 1900) || "Noch nichts gelernt." });
    }
    case "akzeptieren":
      grant(ctx.user.id, "rules");
      return ctx.reply({
        content: "Speicherung ist erlaubt: Befehle, Fakten, Level, Verwarnungen auf diesem Server. Die KI bleibt aus, bis du /freigabe sagst.",
        ephemeral: true,
      });
    case "freigabe":
      if (!granted(ctx.user.id, "rules")) return ctx.reply({ content: "Erst /akzeptieren." });
      grant(ctx.user.id, "ai");
      return ctx.reply({
        content: "KI ist für dich an. Frage und Gedächtnis gehen an xAI in die USA. /ki, /anpassen und /optimieren nutzen das.",
        ephemeral: true,
      });
    case "regeln":
      return ctx.reply({ content: RULES_TEXT });
    case "ki":
    case "anpassen":
    case "optimieren": {
      if (!granted(ctx.user.id, "ai")) return ctx.reply({ content: "Erst /freigabe. Die KI ist freiwillig und geht an xAI in die USA." });
      if (name === "optimieren" && !allows(member, "modul")) return ctx.reply({ content: deny("modul") });
      const prompt = name === "ki" ? ctx.text("wunsch") : "";
      if (name === "ki" && prompt.length < 3) return ctx.reply({ content: "Sag genauer, was ich können soll." });
      await ctx.defer();
      const result = await askMind(name === "ki" ? "ask" : name === "anpassen" ? "improve" : "optimize", prompt);
      if (!result.ok) return ctx.edit({ content: result.error });
      const extra = result.learned?.length ? `\nGeändert: ${result.learned.join(", ")}` : "";
      return ctx.edit({ content: `${result.reply}${extra}`.slice(0, 1900) });
    }
    default: {
      const custom = customReply(name);
      if (custom) return ctx.reply({ content: custom });
      return null;
    }
  }
}

export function prefixArgs(content) {
  const text = content.trim();
  const aliases = repertoireRows()
    .filter((row) => row.alias && !row.alias.startsWith("/"))
    .sort((a, b) => b.alias.length - a.alias.length);
  const hit = aliases.find((row) => text.toLowerCase() === row.alias.toLowerCase() || text.toLowerCase().startsWith(`${row.alias.toLowerCase()} `));
  if (hit) return { name: hit.trigger, rest: text.slice(hit.alias.length).trim() };
  const match = /^!([a-z0-9äöüß]{2,16})(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) return null;
  return { name: cleanKey(match[1]), rest: (match[2] ?? "").trim() };
}

export function isCustom(name) {
  return Boolean(customReply(name));
}

export { addXp, flag, noteUse, customReply };
