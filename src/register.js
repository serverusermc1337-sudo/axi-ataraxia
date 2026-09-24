import { REST, Routes } from "discord.js";

export async function register(token, clientId, guildId, body) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
}
