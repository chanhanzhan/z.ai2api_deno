import { config } from "../core/config.ts";
import { debugLog } from "./helpers.ts";
import type { ZAIModel } from "./model_fetcher.ts";

export interface ModelMapping {
  /** 对外展示的模型名称 */
  displayName: string;
  /** 上游实际调用的模型ID */
  upstreamModelId: string;
  /** 上游模型名称 */
  upstreamModelName: string;
  /** 模型特性配置 */
  features: {
    enable_thinking?: boolean;
    web_search?: boolean;
    auto_web_search?: boolean;
  };
  /** MCP服务器配置 */
  mcpServers?: string[];
  /** 模型所有者 */
  ownedBy?: string;
  /** 是否为内置模型 */
  isBuiltin: boolean;
  /** 模型描述 */
  description?: string;
}

/**
 * 内置模型映射配置
 */
const BUILTIN_MODEL_MAPPINGS: Record<string, ModelMapping> = {
  [config.PRIMARY_MODEL]: {
    displayName: config.PRIMARY_MODEL,
    upstreamModelId: "0727-360B-API",
    upstreamModelName: "GLM-4.5",
    features: {},
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.5 基础模型"
  },
  [config.THINKING_MODEL]: {
    displayName: config.THINKING_MODEL,
    upstreamModelId: "0727-360B-API",
    upstreamModelName: "GLM-4.5-Thinking",
    features: {
      enable_thinking: true
    },
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.5 思维链模型"
  },
  [config.SEARCH_MODEL]: {
    displayName: config.SEARCH_MODEL,
    upstreamModelId: "0727-360B-API",
    upstreamModelName: "GLM-4.5-Search",
    features: {
      web_search: true,
      auto_web_search: true
    },
    mcpServers: ["deep-web-search"],
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.5 搜索增强模型"
  },
  [config.AIR_MODEL]: {
    displayName: config.AIR_MODEL,
    upstreamModelId: "0727-106B-API",
    upstreamModelName: "GLM-4.5-Air",
    features: {},
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.5 轻量级模型"
  },
  [config.PRIMARY_MODEL_NEW]: {
    displayName: config.PRIMARY_MODEL_NEW,
    upstreamModelId: "GLM-4-6-API-V1",
    upstreamModelName: "GLM-4.6",
    features: {},
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.6 基础模型"
  },
  [config.THINKING_MODEL_NEW]: {
    displayName: config.THINKING_MODEL_NEW,
    upstreamModelId: "GLM-4-6-API-V1",
    upstreamModelName: "GLM-4.6-Thinking",
    features: {
      enable_thinking: true
    },
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.6 思维链模型"
  },
  [config.SEARCH_MODEL_NEW]: {
    displayName: config.SEARCH_MODEL_NEW,
    upstreamModelId: "GLM-4-6-API-V1",
    upstreamModelName: "GLM-4.6-Search",
    features: {
      web_search: true,
      auto_web_search: true
    },
    mcpServers: ["deep-web-search"],
    ownedBy: "z.ai",
    isBuiltin: true,
    description: "GLM-4.6 搜索增强模型"
  }
};


class ModelMappingManager {
  private dynamicMappings: Record<string, ModelMapping> = {};
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 5 * 60 * 1000; 
  getMappings(): Record<string, ModelMapping> {
    return {
      ...BUILTIN_MODEL_MAPPINGS,
      ...this.dynamicMappings
    };
  }

  /**
   * 获取内置模型映射
   */
  getBuiltinMappings(): Record<string, ModelMapping> {
    return { ...BUILTIN_MODEL_MAPPINGS };
  }

  /**
   * 获取动态模型映射
   */
  getDynamicMappings(): Record<string, ModelMapping> {
    return { ...this.dynamicMappings };
  }

  /**
   * 添加或更新动态模型映射
   */
  addDynamicMapping(modelId: string, mapping: Partial<ModelMapping>): void {
    const fullMapping: ModelMapping = {
      displayName: mapping.displayName || modelId,
      upstreamModelId: mapping.upstreamModelId || modelId,
      upstreamModelName: mapping.upstreamModelName || modelId,
      features: mapping.features || {},
      mcpServers: mapping.mcpServers || [],
      ownedBy: mapping.ownedBy || "z.ai",
      isBuiltin: false,
      description: mapping.description || `动态模型: ${modelId}`
    };

    this.dynamicMappings[modelId] = fullMapping;
  }

  updateFromZAIModels(zaiModels: ZAIModel[]): void {
    const now = Date.now();
    
    // 检查是否需要更新
    if (now - this.lastUpdateTime < this.UPDATE_INTERVAL) {
      return;
    }

    // 创建上游模型ID到模型信息的映射
    const upstreamModelMap = new Map<string, ZAIModel>();
    zaiModels.forEach(model => {
      upstreamModelMap.set(model.id, model);
    });
    
    // 获取所有已被映射的上游模型ID
    const mappedUpstreamIds = new Set<string>();
    Object.values(BUILTIN_MODEL_MAPPINGS).forEach(mapping => {
      mappedUpstreamIds.add(mapping.upstreamModelId);
    });
    
    // 清空现有动态映射
    this.dynamicMappings = {};
    
    // 只为未被内置映射占用的上游模型创建动态映射
    for (const model of zaiModels) {
      const modelId = model.id;
      
      // 跳过已经被内置模型映射的上游模型
      if (mappedUpstreamIds.has(modelId)) {
        continue;
      }
      
      // 跳过内置模型本身（如果API返回了同名模型）
      if (BUILTIN_MODEL_MAPPINGS[modelId]) {
        continue;
      }

      // 为未映射的模型创建动态映射（显示原模型名称）
      this.addDynamicMapping(modelId, {
        displayName: model.name || model.display_name || modelId,
        upstreamModelId: modelId, // 上游模型ID就是自己
        upstreamModelName: model.name || model.display_name || modelId,
        ownedBy: model.owned_by || "z.ai",
        description: `Z.AI模型: ${model.name || modelId}`
      });
    }

    this.lastUpdateTime = now;
    }

  /**
   * 根据模型ID获取映射信息
   */
  getMappingByModelId(modelId: string): ModelMapping | null {
    const allMappings = this.getMappings();
    return allMappings[modelId] || null;
  }

  /**
   * 检查模型是否存在
   */
  hasModel(modelId: string): boolean {
    return this.getMappingByModelId(modelId) !== null;
  }

  /**
   * 获取所有可用的模型ID列表
   */
  getAvailableModelIds(): string[] {
    return Object.keys(this.getMappings());
  }

  /**
   * 将映射转换为ZAI模型格式
   */
  mappingsToZAIModels(): ZAIModel[] {
    const allMappings = this.getMappings();
    const currentTime = Math.floor(Date.now() / 1000);

    return Object.entries(allMappings).map(([modelId, mapping]: [string, ModelMapping]) => ({
      id: modelId,
      name: mapping.displayName,
      display_name: mapping.displayName,
      created: currentTime,
      owned_by: mapping.ownedBy || "z.ai",
      info: {
        name: mapping.displayName,
        created_at: currentTime,
        user_id: mapping.ownedBy || "z.ai",
        description: mapping.description,
        isBuiltin: mapping.isBuiltin,
        upstreamModelId: mapping.upstreamModelId,
        upstreamModelName: mapping.upstreamModelName
      }
    }));
  }

  /**
   * 清除动态映射缓存
   */
  clearDynamicMappings(): void {
    this.dynamicMappings = {};
    this.lastUpdateTime = 0;
  }
}

// 全局模型映射管理器实例
export const modelMappingManager = new ModelMappingManager();

/**
 * 根据请求的模型ID获取上游请求配置
 */
export function getUpstreamConfig(requestedModelId: string): {
  upstreamModelId: string;
  upstreamModelName: string;
  features: ModelMapping['features'];
  mcpServers: string[];
} | null {
  const mapping = modelMappingManager.getMappingByModelId(requestedModelId);
  
  if (!mapping) {
    debugLog(`未找到模型映射: ${requestedModelId}`);
    return null;
  }

  debugLog(`模型映射: ${requestedModelId} -> ${mapping.upstreamModelId} (${mapping.upstreamModelName})`);
  
  return {
    upstreamModelId: mapping.upstreamModelId,
    upstreamModelName: mapping.upstreamModelName,
    features: mapping.features,
    mcpServers: mapping.mcpServers || []
  };
}

/**
 * 获取所有可用模型的详细信息
 */
export function getAllAvailableModels(): ZAIModel[] {
  return modelMappingManager.mappingsToZAIModels();
}

/**
 * 检查模型是否支持特定功能
 */
export function modelSupportsFeature(modelId: string, feature: keyof ModelMapping['features']): boolean {
  const mapping = modelMappingManager.getMappingByModelId(modelId);
  return mapping?.features[feature] === true;
}

/**
 * 获取模型的MCP服务器列表
 */
export function getModelMcpServers(modelId: string): string[] {
  const mapping = modelMappingManager.getMappingByModelId(modelId);
  return mapping?.mcpServers || [];
}