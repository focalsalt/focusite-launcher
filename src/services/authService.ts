//! Real Microsoft Device Code authentication service communicating with Tauri backend.

import { invoke } from "@tauri-apps/api/core";
import { UserAccount } from "@/types/navigation";

export interface DeviceCodeInfo {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string;
}

export interface DevicePollResult {
  status: "pending" | "slow_down" | "success" | "expired" | "error";
  account?: UserAccount;
  error_message?: string;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const LOCAL_STORAGE_ACCOUNTS_KEY = "focusite_accounts_v26";

export const authService = {
  /**
   * Checks whether MICROSOFT_CLIENT_ID is properly configured in .env.
   */
  async checkClientIdConfigured(): Promise<boolean> {
    if (isTauri()) {
      try {
        return await invoke<boolean>("auth_check_client_id");
      } catch {
        return false;
      }
    }
    return false;
  },

  /**
   * Starts Microsoft Device Authorization flow.
   */
  async startDeviceCode(): Promise<DeviceCodeInfo> {
    if (isTauri()) {
      return await invoke<DeviceCodeInfo>("auth_start_device_code");
    }
    throw new Error(
      "未於 .env 設定 MICROSOFT_CLIENT_ID。請在專案根目錄建立 .env 檔案並設定 Azure Client ID。"
    );
  },

  /**
   * Polls token endpoint with device_code.
   */
  async pollDeviceCode(deviceCode: string): Promise<DevicePollResult> {
    if (isTauri()) {
      return await invoke<DevicePollResult>("auth_poll_device_code", {
        deviceCode,
      });
    }
    return {
      status: "error",
      error_message: "非 Tauri 環境無法執行真實 Microsoft 認證",
    };
  },

  /**
   * Lists all stored accounts.
   */
  async listAccounts(): Promise<UserAccount[]> {
    if (isTauri()) {
      try {
        return await invoke<UserAccount[]>("auth_list_accounts");
      } catch (err) {
        console.error("Tauri auth_list_accounts failed:", err);
      }
    }

    const saved = localStorage.getItem(LOCAL_STORAGE_ACCOUNTS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse local accounts:", e);
      }
    }
    return [];
  },

  /**
   * Removes an account.
   */
  async removeAccount(id: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("auth_remove_account", { id });
        return;
      } catch (err) {
        console.error("Tauri auth_remove_account failed:", err);
      }
    }

    const current = await this.listAccounts();
    const updated = current.filter((a) => a.id !== id);
    localStorage.setItem(LOCAL_STORAGE_ACCOUNTS_KEY, JSON.stringify(updated));
  },

  /**
   * Sets the active account.
   */
  async setActiveAccount(id: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("auth_set_active_account", { id });
        return;
      } catch (err) {
        console.error("Tauri auth_set_active_account failed:", err);
      }
    }

    const current = await this.listAccounts();
    const updated = current.map((a) => ({ ...a, isActive: a.id === id }));
    localStorage.setItem(LOCAL_STORAGE_ACCOUNTS_KEY, JSON.stringify(updated));
  },

  /**
   * Verifies offline entitlement against native Keyring and account store.
   */
  async verifyOfflineLaunch(id: string): Promise<boolean> {
    if (isTauri()) {
      try {
        return await invoke<boolean>("auth_verify_offline_launch", { id });
      } catch (err) {
        console.error("Tauri auth_verify_offline_launch failed:", err);
        return false;
      }
    }
    return false;
  },

  /**
   * Refreshes account profile and owned capes from Mojang services.
   */
  async refreshProfile(id: string): Promise<UserAccount | null> {
    if (isTauri()) {
      try {
        return await invoke<UserAccount>("auth_refresh_profile", { id });
      } catch (err) {
        console.warn("Tauri auth_refresh_profile:", err);
        return null;
      }
    }
    return null;
  },

  /**
   * Updates an account's skin and cape URLs.
   */
  async updateAccountSkin(
    id: string,
    skinUrl?: string,
    capeUrl?: string
  ): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("auth_update_account_skin", {
          id,
          skinUrl,
          capeUrl,
        });
        return;
      } catch (err) {
        console.error("Tauri auth_update_account_skin failed:", err);
      }
    }

    const current = await this.listAccounts();
    const updated = current.map((a) =>
      a.id === id ? { ...a, skinUrl: skinUrl ?? a.skinUrl, capeUrl: capeUrl ?? a.capeUrl } : a
    );
    localStorage.setItem(LOCAL_STORAGE_ACCOUNTS_KEY, JSON.stringify(updated));
  },
};
