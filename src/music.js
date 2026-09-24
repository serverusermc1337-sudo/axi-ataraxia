import { spawn } from "node:child_process";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
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
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
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
    ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-user_agent", "axi/1.0", "-i", item.url, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "128k", "-f", "ogg", "pipe:1"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  ffmpeg.stderr?.on("data", (chunk) => console.error(String(chunk).slice(0, 300)));
  ffmpeg.on("error", (error) => console.error(error));
  state.ffmpeg = ffmpeg;
  state.player.play(createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus }));
}

async function resolveTrack(raw) {
  const direct = playable(raw);
  if (direct) return { url: direct, label: direct };
  const query = String(raw ?? "").trim().slice(0, 120);
  if (query.length < 2) return null;
  const search = new URL("https://discoveryprovider.audius.co/v1/tracks/search");
  search.searchParams.set("query", query);
  search.searchParams.set("app_name", "axi");
  const response = await fetch(search, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  const track = payload?.data?.find((item) => item?.id && !item.is_delete);
  if (!track) return null;
  return {
    url: `https://discoveryprovider.audius.co/v1/tracks/${track.id}/stream?app_name=axi`,
    label: `${track.title} — ${track.user?.name ?? "Audius"}`,
  };
}

const stations = ["1LIVE", "SWR3", "Bayern 3", "Deutschlandfunk", "Fritz", "WDR 2", "BBC Radio 1", "France Inter"];
const radioServers = ["https://de1.api.radio-browser.info", "https://nl1.api.radio-browser.info", "https://at1.api.radio-browser.info"];

async function playFound(member, found) {
  const channel = member?.voice?.channel;
  if (!channel) return "Du musst in einem Sprachkanal sein.";
  const state = room(member.guild);
  const same = state.connection?.joinConfig?.channelId === channel.id;
  if (!same) {
    state.connection?.destroy();
    let closed = "";
    state.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    state.connection.on("stateChange", (_, next) => {
      if (next.status === VoiceConnectionStatus.Disconnected) closed = String(next.closeCode ?? next.reason ?? "");
    });
    state.connection.subscribe(state.player);
    try {
      await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      state.connection.destroy();
      state.connection = null;
      console.error(generateDependencyReport());
      if (closed === "4014") return "Axi darf in diesen Sprachkanal nicht. Kanal bearbeiten, Berechtigungen, Axi: Verbinden und Sprechen erlauben.";
      if (closed === "4016" || closed === "4022") return "Die Sprachverschlüsselung von Discord hat Axi abgelehnt.";
      return `Axi kommt nicht in den Sprachkanal${closed ? ` (${closed})` : ""}. Im Kanal bei Axi Verbinden und Sprechen erlauben.`;
    }
  }
  state.queue.push(found);
  if (state.player.state.status === AudioPlayerStatus.Idle && !state.current) advance(member.guild.id);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const audible = state.player.state.status === AudioPlayerStatus.Playing || state.player.state.status === AudioPlayerStatus.Buffering;
  if (!audible) return "Axi ist im Kanal, aber es kommt kein Ton. FFmpeg fehlt im Container oder der Sender antwortet nicht.";
  return state.current?.url === found.url ? `Spielt: ${found.label}` : `In der Warteschlange: ${found.label}`;
}

export async function searchStations(query) {
  const path = `/json/stations/search?name=${encodeURIComponent(query)}&limit=5&hidebroken=true&order=votes&reverse=true`;
  for (const base of radioServers) {
    const response = await fetch(base + path, { headers: { "User-Agent": "axi/1.0" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!response?.ok) continue;
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) continue;
    return rows.filter((item) => playable(item.url_resolved || item.url));
  }
  return [];
}

export async function tune(member, query) {
  const name = String(query ?? "").trim().slice(0, 80);
  if (!name) return `Bekannte Sender: ${stations.map((item) => item).join(", ")}\nZum Abspielen /radio und den Namen. Die Suche nimmt auch andere Sender.`;
  const rows = await searchStations(name);
  if (!rows.length) return `Keinen Sender für „${name}“ gefunden.`;
  const best = rows[0];
  const text = await playFound(member, {
    url: playable(best.url_resolved || best.url),
    label: `${best.name}${best.country ? ` · ${best.country}` : ""}`,
  });
  const more = [...new Set(rows.slice(1).map((item) => item.name).filter((item) => item && item.toLowerCase() !== best.name.toLowerCase()))].slice(0, 3);
  return more.length ? `${text}\nAndere Treffer: ${more.join(", ")}` : text;
}

export async function enqueue(member, raw) {
  const found = await resolveTrack(raw);
  if (!found) return "Dazu gibt es keine frei spielbare Aufnahme. YouTube, Spotify und Apple Music durchsucht Axi nicht.";
  return playFound(member, found);
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
  const lines = [`Jetzt: ${state.current.label ?? state.current.url}`, ...state.queue.map((item, index) => `${index + 1}. ${item.label ?? item.url}`)];
  return lines.join("\n").slice(0, 1900);
}
