import { Client, Events, GatewayIntentBits } from "discord.js";
import { askMind } from "./ai.js";
import { prefixArgs, runCommand, allSlashCommands } from "./commands.js";
import { addXp, dueReminders, flag, granted, memoryRows, noteUse, setting } from "./db.js";
import { infiltration } from "./guard.js";
import { register } from "./register.js";

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (ready) => {
  await register(token, clientId, guildId, allSlashCommands());
  ready.user.setPresence({ activities: [{ name: setting("status", "Ataraxia") }], status: "online" });
  console.log(`Axi ist online als ${ready.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
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
  if (message.author.bot || message.guildId !== guildId) return;
  const content = message.content ?? "";
  if (flag("automod") && /discord\.gg\/|discord\.com\/invite\//i.test(content) && !message.member?.permissions.has("ManageMessages")) {
    await message.delete().catch(() => undefined);
    return;
  }
  const parsed = prefixArgs(content);
  if (!parsed) {
    if (flag("levels")) addXp(message.author.id, 12);
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
    if (result === null && custom) await message.reply({ content: custom.body });
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

function known(name) {
  return [
    "hilfe", "ping", "server", "zeit", "rechnen", "user", "avatar", "level", "rangliste", "umfrage", "erinnerung",
    "wuerfel", "muenze", "achtball", "witz", "ticket", "schliessen", "warn", "verwarnungen", "timeout", "kick", "ban",
    "clear", "slowmode", "sagen", "sicherheit", "hierarchie", "rolle", "kanal", "ueberblick", "einladen", "bots", "adaptieren", "steuern", "modul", "modell",
    "befehl", "entfernen", "wissen", "ki", "anpassen", "optimieren", "regeln", "akzeptieren", "freigabe",
  ].includes(name);
}

function gate(name, userId) {
  const open = new Set(["hilfe", "regeln", "akzeptieren", "freigabe", "sicherheit", "ping"]);
  if (!open.has(name) && !granted(userId, "rules")) return "Erst /regeln lesen und /akzeptieren. Damit liegt die Speicherung auf deinem Server.";
  if (["ki", "anpassen", "optimieren"].includes(name) && !granted(userId, "ai")) return "Die KI ist extra. Erst /freigabe. Texte gehen an xAI in die USA.";
  return null;
}

client.login(token);
