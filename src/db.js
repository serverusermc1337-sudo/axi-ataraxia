import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const dir = process.env.DATA_DIR || "./data";
mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(join(dir, "axi.sqlite"));
db.exec(`
  create table if not exists settings (key text primary key, value text not null);
  create table if not exists members (
    user_id text primary key,
    xp integer not null default 0,
    warns text not null default '[]'
  );
  create table if not exists consent (
    user_id text primary key,
    version text not null,
    at integer not null
  );
  create table if not exists memory (
    kind text not null,
    item_key text not null,
    body text not null,
    primary key (kind, item_key)
  );
  create table if not exists usage (
    kind text not null,
    item_key text not null,
    hits integer not null default 1,
    sample text not null default '',
    primary key (kind, item_key)
  );
  create table if not exists reminders (
    id integer primary key,
    due integer not null,
    channel_id text not null,
    text text not null,
    user_name text not null
  );
  create table if not exists ai_log (at integer not null);
`);

const getSetting = db.prepare("select value from settings where key = ?");
const putSetting = db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value");

export function setting(key, fallback) {
  const row = getSetting.get(key);
  return row?.value ?? fallback;
}

export function setSetting(key, value) {
  putSetting.run(key, value);
}

export function flag(key) {
  return setting(key, "an") !== "aus";
}

export function accepted(userId) {
  return Boolean(db.prepare("select 1 as ok from consent where user_id = ?").get(userId));
}

export function accept(userId) {
  db.prepare("insert into consent (user_id, version, at) values (?, '1', ?) on conflict(user_id) do update set at = excluded.at").run(userId, Date.now());
}

export function addXp(userId, amount) {
  db.prepare("insert into members (user_id, xp) values (?, ?) on conflict(user_id) do update set xp = xp + excluded.xp").run(userId, amount);
  return db.prepare("select xp from members where user_id = ?").get(userId).xp;
}

export function xpOf(userId) {
  return db.prepare("select xp from members where user_id = ?").get(userId)?.xp ?? 0;
}

export function topMembers(limit = 5) {
  return db.prepare("select user_id, xp from members order by xp desc limit ?").all(limit);
}

export function warnsOf(userId) {
  const row = db.prepare("select warns from members where user_id = ?").get(userId);
  try {
    const value = JSON.parse(row?.warns ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function addWarn(userId, reason) {
  const warns = [...warnsOf(userId), { reason: reason.slice(0, 140), at: Date.now() }].slice(-20);
  db.prepare("insert into members (user_id, warns) values (?, ?) on conflict(user_id) do update set warns = excluded.warns").run(userId, JSON.stringify(warns));
  return warns;
}

export function memoryRows(kind) {
  return db.prepare("select item_key, body from memory where kind = ? order by item_key").all(kind);
}

export function memoryMap() {
  const rows = db.prepare("select kind, item_key, body from memory order by item_key").all();
  return rows;
}

export function putMemory(kind, key, body) {
  db.prepare("insert into memory (kind, item_key, body) values (?, ?, ?) on conflict(kind, item_key) do update set body = excluded.body").run(kind, key, body);
}

export function dropMemory(kind, key) {
  db.prepare("delete from memory where kind = ? and item_key = ?").run(kind, key);
}

export function noteUse(kind, key, sample = "") {
  db.prepare(`
    insert into usage (kind, item_key, hits, sample) values (?, ?, 1, ?)
    on conflict(kind, item_key) do update set
      hits = hits + 1,
      sample = case when excluded.sample = '' then usage.sample else excluded.sample end
  `).run(kind, key, sample.slice(0, 80));
  return db.prepare("select hits from usage where kind = ? and item_key = ?").get(kind, key).hits;
}

export function usageBrief() {
  return db.prepare("select kind, item_key, hits, sample from usage order by hits desc limit 12").all();
}

export function forgetMiss(key) {
  db.prepare("delete from usage where kind = 'miss' and item_key = ?").run(key);
}

export function addReminder(due, channelId, text, userName) {
  db.prepare("insert into reminders (due, channel_id, text, user_name) values (?, ?, ?, ?)").run(due, channelId, text.slice(0, 200), userName);
}

export function dueReminders(now) {
  const rows = db.prepare("select id, due, channel_id, text, user_name from reminders where due <= ?").all(now);
  if (rows.length) db.prepare(`delete from reminders where id in (${rows.map(() => "?").join(",")})`).run(...rows.map((row) => row.id));
  return rows;
}

export function noteAi(at = Date.now()) {
  db.prepare("insert into ai_log (at) values (?)").run(at);
  db.prepare("delete from ai_log where at < ?").run(at - 60 * 60 * 1000);
}

export function aiCount(since) {
  return db.prepare("select count(*) as n from ai_log where at > ?").get(since).n;
}
