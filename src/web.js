import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { PERM_IDS, permMatrix, setPerm } from "./access.js";
import { dropMemory, dropRepertoire, flag, memoryRows, putMemory, repertoireRows, setSetting, setting } from "./db.js";
import { knownModel } from "./ai.js";
import { refreshCommands, takeBot } from "./commands.js";

let liveClient = null;

function hash(value) {
  return createHash("sha256").update(String(value)).digest();
}

function same(left, right) {
  const a = hash(left);
  const b = hash(right);
  return timingSafeEqual(a, b);
}

function snapshot() {
  return {
    modules: {
      automod: flag("automod"),
      levels: flag("levels"),
      welcome: flag("welcome"),
      tickets: flag("tickets"),
    },
    perms: permMatrix(),
    about: setting("about", "Privater Server Ataraxia."),
    welcome: memoryRows("welcome")[0]?.body ?? "Willkommen auf Ataraxia, {name}.",
    status: setting("status", "Ataraxia"),
    model: knownModel(setting("model", process.env.AI_MODEL || "grok-4.5")),
    caps: Number(setting("caps", "0")) || 0,
    blockLinks: setting("block_links", "aus") === "an",
    words: memoryRows("word").map((row) => row.item_key),
    repertoire: repertoireRows().map((row) => ({
      trigger: row.trigger,
      botName: row.bot_name,
      alias: row.alias || "",
      body: memoryRows("command").find((command) => command.item_key === row.trigger)?.body ?? "",
    })),
    logChannel: setting("log_channel", ""),
  };
}

function apply(body) {
  for (const key of ["automod", "levels", "welcome", "tickets"]) {
    if (key in (body.modules ?? {})) setSetting(key, body.modules[key] ? "an" : "aus");
  }
  for (const role of ["mod", "member"]) {
    for (const id of PERM_IDS) {
      if (body.perms?.[role] && id in body.perms[role]) setPerm(role, id, body.perms[role][id]);
    }
  }
  if (typeof body.about === "string") setSetting("about", body.about.slice(0, 240));
  if (typeof body.welcome === "string" && body.welcome.trim()) putMemory("welcome", "text", body.welcome.slice(0, 240));
  if (typeof body.status === "string" && body.status.trim()) {
    const text = body.status.slice(0, 60);
    setSetting("status", text);
    const presence = liveClient?.user?.setPresence?.({ activities: [{ name: text }], status: "online" });
    if (presence?.catch) presence.catch(() => undefined);
  }
  if (typeof body.model === "string") setSetting("model", knownModel(body.model));
  if (body.caps != null) setSetting("caps", String(Math.max(0, Math.min(100, Number(body.caps) || 0))));
  if (typeof body.blockLinks === "boolean") setSetting("block_links", body.blockLinks ? "an" : "aus");
  if (typeof body.logChannel === "string") setSetting("log_channel", body.logChannel.replace(/\D/g, "").slice(0, 22));
  if (Array.isArray(body.remove)) {
    for (const trigger of body.remove) {
      dropMemory("command", String(trigger));
      dropRepertoire(String(trigger));
    }
    refreshCommands().catch(() => undefined);
  }
}

export function startWeb(client) {
  liveClient = client;
  const password = process.env.WEB_PASSWORD;
  const port = Number(process.env.WEB_PORT || 8787);
  if (!password || password.length < 8) {
    console.log("Web-Einstellung aus. WEB_PASSWORD mit mindestens 8 Zeichen setzen.");
    return;
  }
  const session = createHash("sha256").update(`axi:${password}`).digest("hex");
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const cookie = req.headers.cookie ?? "";
    const ok = cookie.split(";").some((part) => part.trim() === `axi_web=${session}`);
    if (url.pathname === "/login" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 4000) req.destroy();
      });
      req.on("end", () => {
        const sent = new URLSearchParams(raw).get("password") ?? "";
        if (!same(sent, password)) {
          res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          res.end(page("Passwort falsch."));
          return;
        }
        res.writeHead(302, { Location: "/", "Set-Cookie": `axi_web=${session}; HttpOnly; SameSite=Strict; Path=/` });
        res.end();
      });
      return;
    }
    if (!ok) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(""));
      return;
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      guildLists().then((lists) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ...snapshot(), ...lists }));
      });
      return;
    }
    if (url.pathname === "/api/remove" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 4000) req.destroy();
      });
      req.on("end", () => {
        try {
          const body = JSON.parse(raw);
          const trigger = String(body.trigger || "");
          if (trigger) {
            dropMemory("command", trigger);
            dropRepertoire(trigger);
            refreshCommands().catch(() => undefined);
          }
          guildLists().then((lists) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ...snapshot(), ...lists }));
          });
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ text: "Entfernen hat nicht geklappt." }));
        }
      });
      return;
    }
    if (url.pathname === "/api/eat" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 4000) req.destroy();
      });
      req.on("end", async () => {
        try {
          const body = JSON.parse(raw);
          const guild = liveClient?.guilds?.cache?.get(process.env.DISCORD_GUILD_ID);
          const channel = await guild?.channels?.fetch(String(body.channelId || "")).catch(() => null);
          const member = await guild?.members?.fetch(String(body.botId || "")).catch(() => null);
          if (!channel?.isTextBased?.() || !member?.user?.bot) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, text: "Bot und Kanal wählen." }));
            return;
          }
          const result = await takeBot(channel, member.user, "");
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, text: "Das hat nicht geklappt." }));
        }
      });
      return;
    }
    if (url.pathname === "/api/state" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 20000) req.destroy();
      });
      req.on("end", () => {
        try {
          apply(JSON.parse(raw));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(snapshot()));
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Ungültig");
        }
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(panel());
  });
  server.listen(port, "0.0.0.0", () => console.log(`Web-Einstellung auf Port ${port}`));
}

async function guildLists() {
  const guild = liveClient?.guilds?.cache?.get(process.env.DISCORD_GUILD_ID);
  if (!guild) return { bots: [], channels: [] };
  if (!guild.members.cache.some((item) => item.user.bot && item.id !== liveClient.user?.id)) await guild.members.fetch().catch(() => undefined);
  const bots = [...guild.members.cache.values()]
    .filter((item) => item.user.bot && item.id !== liveClient.user?.id)
    .map((item) => ({ id: item.id, name: item.user.username }));
  const channels = [...guild.channels.cache.values()]
    .filter((item) => item.isTextBased?.() && !item.isThread?.())
    .map((item) => ({ id: item.id, name: item.name }));
  return { bots, channels };
}

function page(error) {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Axi</title>
<body style="margin:0;background:#1e1f22;color:#f2f3f5;font:16px/1.4 sans-serif;display:grid;place-items:center;min-height:100vh">
<form method="post" action="/login" style="display:grid;gap:12px;width:min(360px,92vw)">
<h1 style="margin:0;font-size:22px">Axi</h1>
<p style="margin:0;color:#b5bac1">Einstellung für Ataraxia. Nur auf deinem Server.</p>
<input name="password" type="password" required minlength="8" style="padding:10px;border-radius:8px;border:0;background:#111214;color:inherit">
<button style="padding:10px;border:0;border-radius:8px;background:#5865f2;color:white">Öffnen</button>
${error ? `<p style="color:#faa">${error}</p>` : ""}
</form></body></html>`;
}

function panel() {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Axi</title>
<body style="margin:0;background:#1e1f22;color:#f2f3f5;font:15px/1.45 sans-serif">
<main style="max-width:880px;margin:auto;padding:24px;display:grid;gap:18px">
<h1 style="margin:0">Axi einstellen</h1>
<p id="note" style="margin:0;color:#b5bac1">Dieselben Schalter wie in Discord. Speichern übernimmt sie sofort.</p>
<section id="app"></section>
</main>
<script>
const perms = ${JSON.stringify(PERM_IDS)};
const labels = {kick:"Kicken",ban:"Sperren",timeout:"Timeout",warn:"Verwarnen",clear:"Nachrichten löschen",slowmode:"Slowmode",sagen:"Als Axi sagen",modul:"Module",einladen:"Einladen",rollen:"Rollen",bots:"Andere Bots"};
async function load(){ const state = await (await fetch("/api/state")).json(); draw(state); }
function draw(state){
  const app = document.getElementById("app");
  app.innerHTML = "";
  const box = (title, node) => { const s = document.createElement("section"); s.style.cssText="background:#2b2d31;border-radius:12px;padding:14px;display:grid;gap:8px"; s.innerHTML = "<h2 style='margin:0;font-size:16px'>"+title+"</h2>"; s.append(node); app.append(s); };
  const mods = document.createElement("div");
  for (const key of ["automod","levels","welcome","tickets"]) {
    const label = document.createElement("label");
    label.innerHTML = "<input type=checkbox "+(state.modules[key]?"checked":"")+"> "+key;
    label.querySelector("input").onchange = (e) => save({modules:{...state.modules,[key]:e.target.checked}});
    mods.append(label);
  }
  box("Module", mods);
  const matrix = document.createElement("div");
  for (const role of ["mod","member"]) {
    const row = document.createElement("div");
    row.innerHTML = "<strong>"+(role==="mod"?"Mod":"Mitglied")+"</strong>";
    for (const id of perms) {
      const label = document.createElement("label");
      label.style.marginRight = "10px";
      label.innerHTML = "<input type=checkbox "+(state.perms[role][id]?"checked":"")+"> "+labels[id];
      label.querySelector("input").onchange = (e) => { state.perms[role][id] = e.target.checked; save({perms: state.perms}); };
      row.append(label);
    }
    matrix.append(row);
  }
  box("Rechte nach Rolle", matrix);
  const texts = document.createElement("div");
  texts.style.display = "grid";
  texts.style.gap = "8px";
  for (const [key, label] of [["about","Beschreibung"],["welcome","Willkommen, {name}"],["status","Status"],["model","KI-Modell grok-4.7, grok-4.5 oder grok-4.3"],["logChannel","Mod-Log Kanal-ID"],["caps","Großschrift ab Prozent, 0 aus"]]) {
    const input = document.createElement("input");
    input.value = state[key] ?? "";
    input.placeholder = label;
    input.dataset.key = key;
    input.style.cssText = "padding:8px;border-radius:8px;border:0;background:#111214;color:inherit";
    texts.append(label, input);
  }
  const links = document.createElement("label");
  links.innerHTML = "<input type=checkbox "+(state.blockLinks?"checked":"")+"> Alle Links sperren";
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Speichern und in Discord übernehmen";
  saveBtn.style.cssText = "padding:10px;border:0;border-radius:8px;background:#5865f2;color:white";
  saveBtn.onclick = async () => {
    const patch = { blockLinks: links.querySelector("input").checked };
    texts.querySelectorAll("input[data-key]").forEach((input) => {
      patch[input.dataset.key] = input.dataset.key === "caps" ? Number(input.value) : input.value;
    });
    await save(patch);
    document.getElementById("note").textContent = "Gespeichert. Der Status von Axi in Discord ist aktualisiert.";
  };
  texts.append(links, saveBtn);
  box("Texte und Filter", texts);
  const eat = document.createElement("div");
  eat.style.display = "grid";
  eat.style.gap = "8px";
  const botSel = document.createElement("select");
  const chanSel = document.createElement("select");
  for (const node of [botSel, chanSel]) node.style.cssText = "padding:8px;border-radius:8px;border:0;background:#111214;color:inherit";
  for (const bot of state.bots || []) {
    const option = document.createElement("option");
    option.value = bot.id;
    option.textContent = bot.name;
    botSel.append(option);
  }
  for (const channel of state.channels || []) {
    const option = document.createElement("option");
    option.value = channel.id;
    option.textContent = "#"+channel.name;
    chanSel.append(option);
  }
  const button = document.createElement("button");
  button.textContent = "Übernehmen";
  button.style.cssText = "padding:10px;border:0;border-radius:8px;background:#5865f2;color:white";
  const result = document.createElement("p");
  result.style.margin = "0";
  button.onclick = async () => {
    button.disabled = true;
    result.textContent = "Axi liest den Kanal.";
    const answer = await (await fetch("/api/eat", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({botId: botSel.value, channelId: chanSel.value})})).json();
    result.textContent = answer.text || "Nichts erkannt.";
    button.disabled = false;
    load();
  };
  if (!(state.bots || []).length) eat.textContent = "Keine anderen Bots im Cache. Discord muss online sein.";
  else eat.append("Bot", botSel, "Kanal", chanSel, button, result);
  box("Übernehmen", eat);
  const reps = document.createElement("div");
  if (!state.repertoire.length) reps.textContent = "Noch nichts von anderen Bots übernommen.";
  for (const row of state.repertoire) {
    const line = document.createElement("div");
    line.textContent = row.botName + " " + (row.alias || "/" + row.trigger) + " — " + row.body + " ";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Entfernen";
    button.style.cssText = "margin-left:8px;padding:6px 10px;border:0;border-radius:8px;background:#da373c;color:white";
    button.onclick = async () => {
      button.disabled = true;
      const saved = await (await fetch("/api/remove", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({trigger: row.trigger})})).json();
      document.getElementById("note").textContent = "Entfernt.";
      draw(saved);
    };
    line.append(button);
    reps.append(line);
  }
  box("Übernommene Funktionen", reps);
}
async function save(patch){
  const state = await (await fetch("/api/state")).json();
  const next = {...state, ...patch, modules:{...state.modules, ...(patch.modules||{})}, perms: patch.perms || state.perms};
  const saved = await (await fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)})).json();
  draw(saved);
}
load();
</script></body></html>`;
}
