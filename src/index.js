import { Client, Events, GatewayIntentBits } from "discord.js";
import { askMind } from "./ai.js";
import { isStub, learnReply, prefixArgs, runCommand, allSlashCommands } from "./commands.js";
import { addXp, dueReminders, flag, granted, memoryRows, noteUse, repertoireByAlias, setting } from "./db.js";
import { infiltration } from "./guard.js";
import { register } from "./register.js";
import { startWeb } from "./web.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !clientId || !guildId) {
  console.error("DISCORD_TOKEN, DISCORD_CLIENT_ID und DISCORD_GUILD_ID müssen gesetzt sein.");
  process.exit(1);
}

const alias = {
  würfel: "wuerfel",
  wurfel: "wuerfel",
  dice: "wuerfel",
  münze: "muenze",
  munze: "muenze",
  coin: "muenze",
  "8ball": "achtball",
  schließen: "schliessen",
  schliessen: "schliessen",
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (ready) => {
  try {
    await register(token, clientId, guildId, allSlashCommands());
  } catch (error) {
    console.error(error);
  }
  ready.user.setPresence({ activities: [{ name: setting("status", "Ataraxia") }], status: "online" });
  startWeb(client);
  console.log(`Axi ist online als ${ready.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete() && interaction.guildId === guildId && interaction.options.getFocused(true).name === "bot") {
    let answered = false;
    const reply = async (choices) => {
      if (answered) return;
      answered = true;
      await interaction.respond(choices).catch(() => undefined);
    };
    const timer = setTimeout(() => reply([]), 2000);
    try {
      await Promise.race([interaction.guild.members.fetch(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    } catch {
      /* Cache reicht */
    }
    clearTimeout(timer);
    const query = String(interaction.options.getFocused()).toLowerCase();
    const choices = interaction.guild.members.cache
      .filter((item) => item.user.bot && item.id !== interaction.client.user.id)
      .filter((item) => !query || item.user.username.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query))
      .map((item) => ({ name: item.user.username.slice(0, 100), value: item.id }))
      .slice(0, 25);
    await reply(choices);
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.guildId !== guildId) return;
  const denied = gate(interaction.commandName, interaction.user.id);
  if (denied) {
    await interaction.reply({ content: denied, ephemeral: true });
    return;
  }
  const ctx = {
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    user: interaction.user,
    client,
    text: (name) => interaction.options.getString(name) ?? "",
    int: (name) => interaction.options.getInteger(name) ?? 0,
    userOf: (name) => interaction.options.getUser(name),
    channelOf: (name) => interaction.options.getChannel(name),
    reply: (payload) => interaction.reply(typeof payload === "string" ? { content: payload } : payload),
    more: (payload) => interaction.followUp(typeof payload === "string" ? { content: payload } : payload),
    defer: () => interaction.deferReply(),
    edit: (payload) => interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
  };
  try {
    await runCommand(interaction.commandName, ctx);
  } catch (error) {
    console.error(error);
    const payload = { content: "Das hat nicht geklappt.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => undefined);
    else await interaction.reply(payload).catch(() => undefined);
  }
});

client.on("messageCreate", async (message) => {
  if (message.guildId !== guildId) return;
  if (message.author.bot) {
    if (message.author.id !== client.user?.id) await learnReply(message).catch(() => undefined);
    return;
  }
  const content = message.content ?? "";
  const reason = automodReason(content, message.member);
  if (reason) {
    await message.delete().catch(() => undefined);
    return;
  }
  const adopted = repertoireByAlias((content.trim().match(/^([a-z0-9]{0,8}[!?.^~][a-z0-9-]{2,32})\b/i) ?? [])[1] ?? "");
  if (adopted) return;
  const parsed = prefixArgs(content);
  if (!parsed) {
    if (flag("levels")) {
      const xp = addXp(message.author.id, 12);
      const before = Math.floor((xp - 12) / 100) + 1;
      const after = Math.floor(xp / 100) + 1;
      if (after > before) await message.channel.send({ content: `${message.author} ist Level ${after}.` }).catch(() => undefined);
    }
    return;
  }
  const name = alias[parsed.name] ?? parsed.name;
  const denied = gate(name, message.author.id);
  if (denied) {
    await message.reply({ content: denied });
    return;
  }
  const custom = memoryRows("command").find((row) => row.item_key === name);
  if (!custom && !known(name)) {
    const hits = noteUse("miss", name, "");
    await message.reply({ content: `!${name} kenne ich nicht. Beim zweiten Mal kann /anpassen daraus einen Befehl machen.` });
    if (hits >= 2 && granted(message.author.id, "ai") && process.env.XAI_API_KEY) void maybeAdapt(message.channel);
    return;
  }
  if (infiltration(content)) {
    await message.reply({ content: "Abgewiesen." });
    return;
  }
  const parts = parsed.rest.split(/\s+/).filter(Boolean);
  const number = parts.map((part) => Number(part)).find((value) => Number.isInteger(value));
  let pending = null;
  const ctx = {
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    client,
    text: (key) => {
      if (key === "wann") return parts[0] ?? "";
      if (key === "name") return parts[0] ?? "";
      if (key === "stand") return parts[1] ?? "";
      if (key === "antwort") return parts.slice(1).join(" ");
      if (key === "text" && name === "erinnerung") return parts.slice(1).join(" ");
      if (key === "grund") return parts.filter((part) => Number.isNaN(Number(part)) && !part.startsWith("<@")).join(" ");
      return parsed.rest;
    },
    int: () => number ?? 0,
    userOf: () => message.mentions.users.first() ?? null,
    channelOf: () => message.mentions.channels.first() ?? message.channel,
    reply: async (payload) => {
      const body = typeof payload === "string" ? { content: payload } : payload;
      if (body.ephemeral) body.ephemeral = undefined;
      return message.reply(body);
    },
    more: async (payload) => {
      const body = typeof payload === "string" ? { content: payload } : payload;
      if (body.ephemeral) body.ephemeral = undefined;
      return message.channel.send(body);
    },
    defer: async () => {
      pending = await message.reply({ content: "Axi denkt nach." });
    },
    edit: async (payload) => {
      const content = typeof payload === "string" ? payload : payload.content;
      if (pending) return pending.edit({ content });
      return message.reply({ content });
    },
  };
  try {
    const result = await runCommand(name, ctx);
    if (result === null && custom && !isStub(custom.body)) await message.reply({ content: custom.body });
  } catch (error) {
    console.error(error);
    await message.reply({ content: "Das hat nicht geklappt." }).catch(() => undefined);
  }
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== guildId || !flag("welcome")) return;
  const channel = member.guild.channels.cache.find((item) => item.name === "willkommen") ?? member.guild.systemChannel;
  const text = memoryRows("welcome")[0]?.body ?? "Willkommen auf Ataraxia, {name}.";
  await channel?.send({ content: text.replaceAll("{name}", member.displayName) }).catch(() => undefined);
});

setInterval(async () => {
  for (const reminder of dueReminders(Date.now())) {
    const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
    await channel?.send({ content: `Erinnerung für ${reminder.user_name}: ${reminder.text}` }).catch(() => undefined);
  }
}, 15_000);

let adaptAt = 0;
async function maybeAdapt(channel) {
  const now = Date.now();
  if (now - adaptAt < 90_000) return;
  adaptAt = now;
  const result = await askMind("improve", "");
  if (!result.ok) return;
  const extra = result.learned?.length ? ` ${result.learned.join(", ")}` : "";
  await channel.send({ content: `Ich habe mich angepasst.${extra}`.slice(0, 1900) }).catch(() => undefined);
}

function automodReason(text, member) {
  if (!flag("automod")) return null;
  if (member?.permissions?.has("ManageMessages")) return null;
  if (/discord\.gg\/|discord\.com\/invite\//i.test(text)) return "Einladung";
  if (setting("block_links", "aus") === "an" && /https?:\/\/\S+/i.test(text)) return "Link";
  const letters = text.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  const caps = Number(setting("caps", "0")) || 0;
  if (caps > 0 && letters.length >= 8) {
    const upper = letters.replace(/[^A-ZÄÖÜ]/g, "").length;
    if (upper / letters.length >= caps / 100) return "Großschrift";
  }
  const lowered = text.toLowerCase();
  const hit = memoryRows("word").find((row) => {
    const word = row.item_key.trim().toLowerCase();
    if (word.length < 2) return false;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(lowered);
  });
  return hit ? "Wortfilter" : null;
}

function known(name) {
  return [
    "hilfe", "ping", "server", "zeit", "rechnen", "user", "avatar", "level", "rangliste", "umfrage", "erinnerung",
    "wuerfel", "muenze", "achtball", "witz", "play", "skip", "stop", "warteschlange", "aktuell", "radio", "ticket", "schliessen", "warn", "verwarnungen", "timeout", "kick", "ban",
    "clear", "slowmode", "sagen", "sicherheit", "hierarchie", "rolle", "kanal", "ueberblick", "einladen", "bots", "adaptieren", "eatbot", "steuern", "recht", "filter", "willkommen", "status", "log", "modul", "modell",
    "befehl", "entfernen", "wissen", "ki", "anpassen", "optimieren", "regeln", "akzeptieren", "freigabe", "widerruf",
  ].includes(name);
}

function gate(name, userId) {
  const open = new Set(["hilfe", "regeln", "akzeptieren", "freigabe", "sicherheit", "ping", "widerruf"]);
  if (!open.has(name) && !granted(userId, "rules")) return "Erst /regeln lesen und /akzeptieren. Damit liegt die Speicherung auf deinem Server.";
  if (["ki", "anpassen", "optimieren"].includes(name) && !granted(userId, "ai")) return "Die KI ist extra. Erst /freigabe. Texte gehen an xAI in die USA.";
  return null;
}

client.login(token);
