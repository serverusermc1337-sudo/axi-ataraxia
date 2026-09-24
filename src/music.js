import { spawn } from "node:child_process";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";

const rooms = new Map();
const blocked = /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|spotify\.com|scdn\.co|music\.apple\.com|apple\.com|deezer\.com|dzcdn\.net|soundcloud\.com|sndcdn\.com|tidal\.com|music\.amazon\..*|tiktok\.com)$/i;

export function playable(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|0\.|::1|fc|fd|fe80)/.test(host)) return null;
  if (blocked.test(host)) return null;
  return url.href;
}

function room(guild) {
  let state = rooms.get(guild.id);
  if (state) return state;
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  state = { player, connection: null, queue: [], current: null, ffmpeg: null };
  player.on(AudioPlayerStatus.Idle, () => advance(guild.id));
  player.on("error", () => advance(guild.id));
  rooms.set(guild.id, state);
  return state;
}

function advance(guildId) {
  const state = rooms.get(guildId);
  if (!state) return;
  state.ffmpeg?.kill("SIGKILL");
  state.ffmpeg = null;
  const item = state.queue.shift();
  state.current = item ?? null;
  if (!item) return;
  const ffmpeg = spawn(
    "ffmpeg",
    ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-i", item.url, "-analyzeduration", "0", "-loglevel", "0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  state.ffmpeg = ffmpeg;
  state.player.play(createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw }));
}

export async function enqueue(member, raw) {
  const channel = member?.voice?.channel;
  if (!channel) return "Du musst in einem Sprachkanal sein.";
  const link = playable(raw);
  if (!link) return "Nur eine direkte http- oder https-Adresse. YouTube, Spotify und Apple Music spielt Axi nicht ab, auch nicht mit einem Login.";
  const state = room(member.guild);
  const same = state.connection?.joinConfig?.channelId === channel.id;
  if (!same) {
    state.connection?.destroy();
    state.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    state.connection.subscribe(state.player);
    try {
      await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      state.connection.destroy();
      state.connection = null;
      return "Axi kommt nicht in den Sprachkanal. Er braucht dort Verbinden und Sprechen.";
    }
  }
  state.queue.push({ url: link });
  if (state.player.state.status === AudioPlayerStatus.Idle && !state.current) advance(member.guild.id);
  return state.current?.url === link ? `Spielt: ${link}` : `In der Warteschlange: ${link}`;
}

export function skip(guild) {
  const state = rooms.get(guild.id);
  if (!state?.current) return "Es läuft nichts.";
  state.player.stop(true);
  return "Übersprungen.";
}

export function leave(guild) {
  const state = rooms.get(guild.id);
  if (!state) return "Axi ist in keinem Sprachkanal.";
  state.queue.length = 0;
  rooms.delete(guild.id);
  state.ffmpeg?.kill("SIGKILL");
  state.player.stop(true);
  state.connection?.destroy();
  return "Axi hat den Sprachkanal verlassen.";
}

export function queueText(guild) {
  const state = rooms.get(guild.id);
  if (!state?.current) return "Es läuft nichts.";
  const lines = [`Jetzt: ${state.current.url}`, ...state.queue.map((item, index) => `${index + 1}. ${item.url}`)];
  return lines.join("\n").slice(0, 1900);
}
