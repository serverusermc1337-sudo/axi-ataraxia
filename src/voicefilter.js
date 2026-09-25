import { createRequire } from "node:module";
import { once } from "node:events";
import { EndBehaviorType } from "@discordjs/voice";
import { PermissionFlagsBits } from "discord.js";
import { memoryRows, setting } from "./db.js";
import { aiEnabled } from "./ai.js";

const require = createRequire(import.meta.url);
const prism = require("prism-media");

const armed = new WeakSet();
const busy = new Set();
const timers = new Map();
const told = new WeakSet();
const insults = ["arschloch", "hurensohn", "fotze", "wichser", "missgeburt", "schlampe", "nutte", "ficker", "bastard", "idiot", "fresse", "spasti", "behinder"];

function insulted(text) {
  const lowered = text.toLowerCase();
  const words = [...insults, ...memoryRows("word").map((row) => row.item_key)];
  return words.some((raw) => {
    const word = String(raw ?? "").trim().toLowerCase();
    if (word.length < 3) return false;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(lowered);
  });
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function transcript(audio) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: "Enthält die Aufnahme eine Beleidigung oder Beschimpfung? Antworte nur mit ja oder nein, dann einen Strich und den Wortlaut." },
            { inlineData: { mimeType: "audio/wav", data: audio.toString("base64") } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  }).catch((error) => {
    console.error(error);
    return null;
  });
  if (!response?.ok) {
    console.error("sprachfilter", response?.status);
    return "";
  }
  const payload = await response.json().catch(() => null);
  return (payload?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join(" ");
}

async function muteForFive(member, channel) {
  clearTimeout(timers.get(member.id));
  try {
    await member.voice.setMute(true, "Sprachfilter");
  } catch {
    return;
  }
  await channel?.send({ content: `${member} wurde wegen Beleidigung für 5 Sekunden stummgeschaltet.` }).catch(() => undefined);
  timers.set(
    member.id,
    setTimeout(() => {
      timers.delete(member.id);
      member.voice.setMute(false, "Sprachfilter").catch(() => undefined);
    }, 5000),
  );
}

async function hear(connection, guild, userId) {
  if (!aiEnabled() || setting("voice_filter", "aus") !== "an" || busy.has(userId) || userId === guild.client.user?.id) return;
  busy.add(userId);
  try {
    const opus = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 900 } });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const chunks = [];
    let size = 0;
    decoder.on("data", (chunk) => {
      if (size > 48000 * 4 * 8) return;
      chunks.push(chunk);
      size += chunk.length;
    });
    opus.pipe(decoder);
    await Promise.race([once(opus, "end"), new Promise((resolve) => setTimeout(resolve, 4000))]);
    opus.destroy();
    decoder.end();
    await once(decoder, "finish").catch(() => undefined);
    const channelId = connection.joinConfig?.channelId;
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (size < 8000) {
      if (!told.has(connection)) {
        told.add(connection);
        await channel?.send({ content: "Sprachfilter ist an, hört aber noch keine Sprache. Sprich direkt ins Mikrofon, nicht nur über den Lautsprecher." }).catch(() => undefined);
      }
      return;
    }
    const text = await transcript(wav(Buffer.concat(chunks)));
    const rude = /^ja\b/i.test(text.trim()) || insulted(text);
    if (!rude) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot || member.voice?.channelId !== channelId) return;
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
      await channel?.send({ content: "Axi darf niemanden stummschalten. Recht: Mitglieder stummschalten." }).catch(() => undefined);
      return;
    }
    muteForFive(member, channel);
  } catch (error) {
    console.error(error);
  } finally {
    busy.delete(userId);
  }
}

export function armVoiceFilter(connection, guild) {
  if (!connection || armed.has(connection) || setting("voice_filter", "aus") !== "an") return;
  armed.add(connection);
  connection.receiver.speaking.on("start", (userId) => {
    hear(connection, guild, userId).catch(() => undefined);
  });
}
