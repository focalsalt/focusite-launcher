import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";

export interface WorkshopProjectSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads: number;
  follows: number;
  project_type: string;
  categories: string[];
}

export interface WorkshopSearchFilters {
  categories: string[];
  environment?: "client" | "server";
  sort?: "relevance" | "downloads" | "follows" | "newest" | "updated";
}

export interface WorkshopCategory {
  name: string;
  header: string;
}

export interface WorkshopProjectDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  downloads: number;
  follows: number;
  categories: string[];
  client_side: string;
  server_side: string;
  license?: string;
  updated: string;
}

export interface WorkshopVersionItem {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  filename: string;
  size: number;
  version_type: "release" | "beta" | "alpha";
  date_published: string;
}

export interface InstallPlanItem {
  project_id: string;
  version_id: string;
  name: string;
  filename: string;
  download_url: string;
  sha1: string;
  size: u64Number;
  is_primary: boolean;
  is_required_dep: boolean;
  is_optional_dep: boolean;
  already_installed: boolean;
}

type u64Number = number;

export interface InstallPlan {
  primary_items: InstallPlanItem[];
  required_dependencies: InstallPlanItem[];
  optional_dependencies: InstallPlanItem[];
  conflict_warnings: string[];
  total_download_size: number;
}

export interface MigrationUpdateItem {
  original_filename: string;
  mod_name: string;
  new_filename: string;
  download_url: string;
  sha1: string;
  size: number;
}

export interface MigrationPlan {
  current_version: string;
  current_loader: string;
  target_version: string;
  target_loader: string;
  upgradable: MigrationUpdateItem[];
  incompatible: string[];
  compatible_unchanged: string[];
}

export const workshopService = {
  async openWorkshopWindow(instanceId: string, projectType: "mod" | "resourcepack" | "shader"): Promise<void> {
    try {
      await invoke("open_instance_workshop_window", { instanceId, projectType });
    } catch (err) {
      console.error("open_instance_workshop_window failed:", err);
      toast(toUserMessage(err, "無法開啟工作坊視窗"), "error");
    }
  },

  async searchProjects(
    query: string,
    projectType: string,
    gameVersion?: string,
    loader?: string,
    offset: number = 0,
    limit: number = 20,
    filters?: WorkshopSearchFilters
  ): Promise<WorkshopProjectSummary[]> {
    return await invoke<WorkshopProjectSummary[]>("workshop_search_projects", {
      query,
      projectType,
      gameVersion,
      loader,
      filters,
      offset,
      limit,
    });
  },

  async listCategories(projectType: string): Promise<WorkshopCategory[]> {
    return await invoke<WorkshopCategory[]>("workshop_list_categories", { projectType });
  },

  async getProject(projectId: string): Promise<WorkshopProjectDetail> {
    return await invoke<WorkshopProjectDetail>("workshop_get_project", { projectId });
  },

  async listVersions(
    projectId: string,
    gameVersion?: string,
    loader?: string
  ): Promise<WorkshopVersionItem[]> {
    return await invoke<WorkshopVersionItem[]>("workshop_list_versions", {
      projectId,
      gameVersion,
      loader,
    });
  },

  async resolveInstallPlan(
    instanceId: string,
    selectedItems: [string, string][]
  ): Promise<InstallPlan> {
    return await invoke<InstallPlan>("workshop_resolve_install_plan", {
      instanceId,
      selectedItems,
    });
  },

  async executeInstallPlan(
    instanceId: string,
    projectType: string,
    itemsToDownload: InstallPlanItem[]
  ): Promise<number> {
    return await invoke<number>("workshop_execute_install_plan", {
      instanceId,
      projectType,
      itemsToDownload,
    });
  },

  async planStackMigration(
    instanceId: string,
    targetVersion: string,
    targetLoader: string
  ): Promise<MigrationPlan> {
    return await invoke<MigrationPlan>("instance_plan_stack_migration", {
      instanceId,
      targetVersion,
      targetLoader,
    });
  },

  async executeStackMigration(
    instanceId: string,
    targetVersion: string,
    targetLoader: string,
    targetLoaderVersion: string | null,
    plan: MigrationPlan
  ): Promise<unknown> {
    return await invoke("instance_execute_stack_migration", {
      instanceId,
      targetVersion,
      targetLoader,
      targetLoaderVersion,
      plan,
    });
  },
};
