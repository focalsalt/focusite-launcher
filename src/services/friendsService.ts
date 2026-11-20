import { invoke } from "@tauri-apps/api/core";

export const friendsService = {
  /** XUIDs on the account's Xbox people list. Names and presence need other Xbox service calls (not wired yet). */
  listXuids: (accountId: string): Promise<string[]> => invoke<string[]>("friends_list_xuids", { accountId }),
};
