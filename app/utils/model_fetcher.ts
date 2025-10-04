/**
 * Model fetcher utility to automatically get latest models from Z.AI API
 */

import { config } from "../core/config.ts";
import { debugLog, getBrowserHeaders, getAnonymousToken } from "./helpers.ts";

export interface ZAIModelInfo {
  name?: string;
  created_at?: number;
  user_id?: string;
  [key: string]: unknown;
}

export interface ZAIModel {
  id: string;
  name?: string;
  display_name?: string;
  created?: number;
  owned_by?: string;
  info?: ZAIModelInfo;
  [key: string]: unknown;
}

export interface ZAIModelsResponse {
  data: ZAIModel[];
}

/**
 * 获取最新的模型列表
 */
export async function fetchLatestModels(): Promise<ZAIModel[]> {
  try {
    // 首先获取匿名 token
    let authToken: string;
    try {
      authToken = await getAnonymousToken();
      debugLog(`成功获取匿名token用于模型获取: ${authToken.substring(0, 10)}...`);
    } catch (tokenError) {
      debugLog(`获取匿名token失败: ${tokenError}`);
      return [];
    }

    const headers = getBrowserHeaders();
    headers["Accept"] = "application/json";
    headers["Authorization"] = `Bearer ${authToken}`;
    headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

    const response = await fetch("https://chat.z.ai/api/models", {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      debugLog(`获取模型列表失败: ${response.status}`);
      return [];
    }

    const data: ZAIModelsResponse = await response.json();
    debugLog(`成功获取到 ${data.data?.length || 0} 个模型`);
    
    return data.data || [];
  } catch (error) {
    debugLog(`获取模型列表异常: ${error}`);
    return [];
  }
}

/**
 * 获取默认模型配置
 */
export function getDefaultModels(): ZAIModel[] {
  const currentTime = Math.floor(Date.now() / 1000);
  return [
    {
      id: config.PRIMARY_MODEL,
      name: config.PRIMARY_MODEL,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.THINKING_MODEL,
      name: config.THINKING_MODEL,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.SEARCH_MODEL,
      name: config.SEARCH_MODEL,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.AIR_MODEL,
      name: config.AIR_MODEL,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.PRIMARY_MODEL_NEW,
      name: config.PRIMARY_MODEL_NEW,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.THINKING_MODEL_NEW,
      name: config.THINKING_MODEL_NEW,
      created: currentTime,
      owned_by: "z.ai"
    },
    {
      id: config.SEARCH_MODEL_NEW,
      name: config.SEARCH_MODEL_NEW,
      created: currentTime,
      owned_by: "z.ai"
    },
  ];
}

/**
 * 合并默认模型和最新模型，使用新的模型映射管理器
 */
export async function getAvailableModels(): Promise<ZAIModel[]> {
  // 导入模型映射管理器
  const { modelMappingManager } = await import("./model_mapper.ts");
  
  try {
    const latestModels = await fetchLatestModels();
    
    if (latestModels.length > 0) {
      // 更新动态模型映射
      modelMappingManager.updateFromZAIModels(latestModels);
    }
    
    // 返回所有可用模型（内置 + 动态）
    return modelMappingManager.mappingsToZAIModels();
  } catch (error) {
    debugLog(`获取最新模型失败，使用内置模型: ${error}`);
    
    // 回退到内置模型
    return modelMappingManager.mappingsToZAIModels();
  }
}