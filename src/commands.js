import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { askMind, knownModel } from "./ai.js";
import {
  accept,
  accepted,
  addReminder,
  addWarn,
  addXp,
  dropMemory,
  flag,
  memoryRows,
  noteUse,
  putMemory,
  setSetting,
  setting,
  topMembers,
  warnsOf,
  xpOf,
} from "./db.js";
import { KEY, cleanKey, infiltration, personalData } from "./guard.js";

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

function staff(member, bit) {
  return Boolean(member?.permissions?.has(bit));
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
  ["modul", "Schaltet ein Modul an oder aus", "Server"],
  ["modell", "Wählt die KI", "Server"],
  ["befehl", "Legt einen eigenen Befehl fest", "Lernen"],
  ["wissen", "Zeigt das Gedächtnis", "Lernen"],
  ["ki", "Antwortet und speichert ein Feature, wenn es passt", "Lernen"],
  ["anpassen", "Ändert Befehle aus Nutzung und Anfragen", "Lernen"],
  ["optimieren", "Räumt das Gedächtnis auf", "Lernen"],
  ["akzeptieren", "Erlaubt die KI für dich", "Lernen"],
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
    wissen: (b) => b,
    ki: (b) => b.addStringOption((o) => o.setName("wunsch").setDescription("Was Axi können oder wissen soll").setRequired(true)),
    anpassen: (b) => b,
    optimieren: (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    akzeptieren: (b) => b,
  };
  return catalog.map(([name, description]) => {
    const builder = new SlashCommandBuilder().setName(name).setDescription(description);
    return (opt[name]?.(builder) ?? builder).toJSON();
  });
}

export function helpText() {
  const groups = ["Orientierung", "Leute", "Gespräch", "Anliegen", "Moderation", "Server", "Lernen"];
  return groups
    .map((group) => {
      const rows = catalog.filter((item) => item[2] === group).map(([name, description]) => `/${name} — ${description}`);
      const own = group === "Lernen" ? memoryRows("command").map((row) => `!${row.item_key} — ${row.body}`) : [];
      return [`**${group}**`, ...rows, ...own].join("\n");
    })
    .join("\n\n");
}

export async function runCommand(name, ctx) {
  const member = ctx.member;
  const target = ctx.userOf?.("mitglied") ?? ctx.user;
  switch (name) {
    case "hilfe":
      return ctx.reply({ content: `Axi auf **${ctx.guild?.name ?? "Ataraxia"}**.\n\n${helpText()}`.slice(0, 1900) });
    case "ping":
      return ctx.reply({ content: "Pong. Axi ist wach." });
    case "server":
      return ctx.reply({ content: `**${ctx.guild.name}** · ${ctx.guild.memberCount} Mitglieder · ${setting("status", "hält Ataraxia ruhig")}` });
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
        topic,
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
      await ctx.reply({ content: "Ich mache das Ticket zu." });
      await ctx.channel.delete("Ticket geschlossen");
      return;
    }
    case "warn": {
      if (!staff(member, PermissionFlagsBits.ModerateMembers)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const who = ctx.userOf("mitglied");
      if (!who) return ctx.reply({ content: "Nenn ein Mitglied." });
      const warns = addWarn(who.id, ctx.text("grund") || "Kein Grund");
      if (warns.length >= 3) {
        const person = await ctx.guild.members.fetch(who.id).catch(() => null);
        await person?.timeout(10 * 60_000, "drei Verwarnungen").catch(() => undefined);
      }
      return ctx.reply({ content: `${who} verwarnt (${warns.length}/3).` });
    }
    case "verwarnungen": {
      const who = ctx.userOf("mitglied") ?? ctx.user;
      const lines = warnsOf(who.id).map((warn, index) => `${index + 1}. ${warn.reason}`);
      return ctx.reply({ content: lines.join("\n") || "Keine Verwarnungen." });
    }
    case "timeout": {
      if (!staff(member, PermissionFlagsBits.ModerateMembers)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const picked = ctx.userOf("mitglied");
      if (!picked) return ctx.reply({ content: "Nenn ein Mitglied." });
      const who = await ctx.guild.members.fetch(picked.id);
      const minutes = ctx.int("minuten");
      await who.timeout(minutes ? minutes * 60_000 : null, ctx.text("grund") || "Timeout");
      return ctx.reply({ content: minutes ? `${who} ist ${minutes} Minuten still.` : `Timeout von ${who} aufgehoben.` });
    }
    case "kick":
    case "ban": {
      const bit = name === "ban" ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.KickMembers;
      if (!staff(member, bit)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const picked = ctx.userOf("mitglied");
      if (!picked) return ctx.reply({ content: "Nenn ein Mitglied." });
      const who = await ctx.guild.members.fetch(picked.id);
      const reason = ctx.text("grund") || "Kein Grund";
      if (name === "ban") await who.ban({ reason });
      else await who.kick(reason);
      return ctx.reply({ content: name === "ban" ? `${who.user.username} ist gesperrt.` : `${who.user.username} wurde entfernt.` });
    }
    case "clear": {
      if (!staff(member, PermissionFlagsBits.ManageMessages)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const count = Math.min(100, Math.max(2, ctx.int("anzahl") || 2));
      const deleted = await ctx.channel.bulkDelete(count, true);
      return ctx.reply({ content: `${deleted.size} Nachrichten weg.`, ephemeral: true });
    }
    case "slowmode": {
      if (!staff(member, PermissionFlagsBits.ManageChannels)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const seconds = ctx.int("sekunden") || 0;
      await ctx.channel.setRateLimitPerUser(seconds);
      return ctx.reply({ content: seconds ? `Slowmode ${seconds}s.` : "Slowmode aus." });
    }
    case "sagen": {
      if (!staff(member, PermissionFlagsBits.ManageMessages)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const text = ctx.text("text").slice(0, 500);
      if (personalData(text) || infiltration(text)) return ctx.reply({ content: "Den Text sage ich nicht." });
      await ctx.channel.send({ content: text });
      return ctx.reply({ content: "Gesagt.", ephemeral: true });
    }
    case "sicherheit":
      return ctx.reply({
        content:
          "Axi nutzt die Discord-Rechte des Servers. Moderation geht nur, wenn die Rolle das darf und Axi darüber steht.\n" +
          "Die KI schreibt keinen Code um. E-Mails und Nummern werden nicht gespeichert. Unbekannte !Befehle zählen für /anpassen.\n" +
          "Andere Bots kann Axi nicht fernsteuern. Eigene Antworten legst du mit /befehl oder /ki an.",
      });
    case "modul": {
      if (!staff(member, PermissionFlagsBits.ManageGuild)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      setSetting(ctx.text("name"), ctx.text("stand"));
      return ctx.reply({ content: `${ctx.text("name")} ist ${ctx.text("stand")}.` });
    }
    case "modell": {
      if (!staff(member, PermissionFlagsBits.ManageGuild)) return ctx.reply({ content: "Dafür fehlt das Recht." });
      const model = knownModel(ctx.text("name"));
      setSetting("model", model);
      return ctx.reply({ content: `KI ist ${model}. /ki, /anpassen und /optimieren nutzen sie.` });
    }
    case "befehl": {
      if (!staff(member, PermissionFlagsBits.ManageGuild)) return ctx.reply({ content: "Dafür fehlt das Recht." });
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
    case "wissen": {
      const lines = [
        ...memoryRows("command").map((row) => `!${row.item_key} — ${row.body}`),
        ...memoryRows("fact").map((row) => `${row.item_key}: ${row.body}`),
      ];
      return ctx.reply({ content: lines.join("\n").slice(0, 1900) || "Noch nichts gelernt." });
    }
    case "akzeptieren":
      accept(ctx.user.id);
      return ctx.reply({
        content: "Du erlaubst die KI. Frage und Gedächtnis gehen dann an xAI in die USA. Ohne diesen Schritt bleiben /ki und /anpassen aus.",
        ephemeral: true,
      });
    case "ki":
    case "anpassen":
    case "optimieren": {
      if (!accepted(ctx.user.id)) return ctx.reply({ content: "Erst /akzeptieren. Die KI ist freiwillig und geht an xAI in die USA." });
      if (name === "optimieren" && !staff(member, PermissionFlagsBits.ManageGuild)) return ctx.reply({ content: "Aufräumen darf nur die Serververwaltung." });
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
  const match = /^!([a-z0-9äöüß]{2,16})(?:\s+([\s\S]*))?$/i.exec(content.trim());
  if (!match) return null;
  return { name: cleanKey(match[1]), rest: (match[2] ?? "").trim() };
}

export function isCustom(name) {
  return Boolean(customReply(name));
}

export { addXp, flag, noteUse, customReply };
