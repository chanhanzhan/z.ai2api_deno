/**
 * OpenAI API endpoints
 */

import { Router } from "oak/mod.ts";
import { config } from "./config.ts";
import type { 
  Message, UpstreamRequest,
  ModelsResponse
} from "../models/schemas.ts";
import { OpenAIRequestSchema } from "../models/schemas.ts";
import { debugLog, generateRequestIds, getAuthToken, callUpstreamApi } from "../utils/helpers.ts";
import { processMessagesWithThinking, contentToString } from "../utils/tools.ts";
import { NonStreamResponseHandler } from "./response_handlers.ts";
import { getAvailableModels } from "../utils/model_fetcher.ts";
import { getUpstreamConfig } from "../utils/model_mapper.ts";

export const openaiRouter = new Router();

openaiRouter.get("/models", async (ctx) => {
  /**List available models with automatic fetching*/
  try {
    const availableModels = await getAvailableModels();
    
    const response: ModelsResponse = {
      object: "list",
      data: availableModels.map(model => ({
        id: model.id,
        object: "model",
        created: model.created || Math.floor(Date.now() / 1000),
        owned_by: model.owned_by || "z.ai"  
      }))
    };
    
    debugLog(`返回 ${availableModels.length} 个可用模型`);
    ctx.response.body = response;
  } catch (error) {
    debugLog(`获取模型列表失败: ${error}`);
    
    // 回退到默认模型列表
    const currentTime = Math.floor(Date.now() / 1000);
    const response: ModelsResponse = {
      object: "list",
      data: [
        {
          id: config.PRIMARY_MODEL,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.THINKING_MODEL,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.SEARCH_MODEL,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.AIR_MODEL,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.PRIMARY_MODEL_NEW,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.THINKING_MODEL_NEW,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
        {
          id: config.SEARCH_MODEL_NEW,
          object: "model",
          created: currentTime,
          owned_by: "z.ai"
        },
      ]
    };
    ctx.response.body = response;
  }
});

openaiRouter.post("/chat/completions", async (ctx) => {
  /**Handle chat completion requests*/
  debugLog("收到chat completions请求");
  
  try {
    // Get authorization header
    const authorization = ctx.request.headers.get("authorization");
    
    // Validate API key (skip if SKIP_AUTH_TOKEN is enabled)
    if (!config.SKIP_AUTH_TOKEN) {
      if (!authorization || !authorization.startsWith("Bearer ")) {
        debugLog("缺少或无效的Authorization头");
        ctx.response.status = 401;
        ctx.response.body = { error: "Missing or invalid Authorization header" };
        return;
      }
      
      const apiKey = authorization.substring(7);
      if (apiKey !== config.AUTH_TOKEN) {
        debugLog(`无效的API key: ${apiKey}`);
        ctx.response.status = 401;
        ctx.response.body = { error: "Invalid API key" };
        return;
      }
      
      debugLog(`API key验证通过，AUTH_TOKEN=${apiKey.substring(0, 8)}......`);
    } else {
      debugLog("SKIP_AUTH_TOKEN已启用，跳过API key验证");
    }
    
    // Parse and validate request body
    const requestBody = await ctx.request.body().value;
    const request = OpenAIRequestSchema.parse(requestBody);
    
    debugLog(`请求解析成功 - 模型: ${request.model}, 流式: ${request.stream}, 消息数: ${request.messages.length}`);
    
    // Generate IDs
    const [chatId, msgId] = generateRequestIds();
    
    // Process messages with tools and thinking
    const processedMessages = processMessagesWithThinking(
      request.messages.map(m => ({ ...m })),
      request.tools,
      request.tool_choice,
      true // 为所有请求启用思考功能
    );
    
    // Convert back to Message objects
    const upstreamMessages: Message[] = [];
    for (const msg of processedMessages) {
      const content = contentToString(msg.content);
      
      upstreamMessages.push({
        role: msg.role,
        content: content,
        reasoning_content: msg.reasoning_content
      });
    }
    
    // 使用新的模型映射系统获取上游配置
    const upstreamConfig = getUpstreamConfig(request.model);
    
    if (!upstreamConfig) {
      debugLog(`不支持的模型: ${request.model}`);
      ctx.response.status = 400;
      ctx.response.body = { error: `Unsupported model: ${request.model}` };
      return;
    }
    
    const { upstreamModelId, upstreamModelName, features, mcpServers } = upstreamConfig;
    
    debugLog(`模型映射: ${request.model} -> ${upstreamModelId} (${upstreamModelName})`);
    debugLog(`模型特性: ${JSON.stringify(features)}`);
    debugLog(`MCP服务器: ${JSON.stringify(mcpServers)}`);
    
    // Build upstream request
    const upstreamReq: UpstreamRequest = {
      stream: true, // Always use streaming from upstream
      chat_id: chatId,
      id: msgId,
      model: upstreamModelId, // Dynamic upstream model ID
      messages: upstreamMessages,
      params: {},
      features: {
        enable_thinking: true, // 为所有请求都启用思考功能
        web_search: features.web_search || false,
        auto_web_search: features.auto_web_search || false,
      },
      background_tasks: {
        title_generation: false,
        tags_generation: false,
      },
      mcp_servers: mcpServers,
      model_item: {
        id: upstreamModelId,
        name: upstreamModelName,
        owned_by: "openai"
      },
      tool_servers: [],
      variables: {
        "{{USER_NAME}}": "User",
        "{{USER_LOCATION}}": "Unknown",
        "{{CURRENT_DATETIME}}": new Date().toISOString().replace('T', ' ').substring(0, 19),
      }
    };
    
    // Get authentication token
    const authToken = await getAuthToken();
    
    // Check if tools are enabled and present
    const hasTools = (config.TOOL_SUPPORT && 
                    request.tools && 
                    request.tools.length > 0 && 
                    request.tool_choice !== "none");
    
    // Handle response based on stream flag
    if (request.stream) {
      debugLog("客户端请求流式响应，直接透传上游流");
      
      // Set SSE headers
      ctx.response.headers.set("Content-Type", "text/event-stream");
      ctx.response.headers.set("Cache-Control", "no-cache");
      ctx.response.headers.set("Connection", "keep-alive");
      ctx.response.headers.set("Access-Control-Allow-Origin", "*");
      
      // Direct stream passthrough - call upstream and pipe response directly
      try {
        const upstreamResponse = await callUpstreamApi(upstreamReq, chatId, authToken);
        
        if (!upstreamResponse.ok) {
          debugLog(`上游响应错误: ${upstreamResponse.status}`);
          ctx.response.status = upstreamResponse.status;
          ctx.response.body = await upstreamResponse.text();
          return;
        }
        
        // Check if upstream response is actually a stream
        if (upstreamResponse.body) {
          debugLog("直接透传上游流式响应");
          ctx.response.body = upstreamResponse.body;
        } else {
          debugLog("上游响应没有body，返回错误");
          ctx.response.status = 500;
          ctx.response.body = { error: "Upstream response has no body" };
        }
      } catch (error) {
        debugLog(`调用上游API失败: ${error}`);
        ctx.response.status = 500;
        ctx.response.body = { error: `Upstream API call failed: ${error}` };
      }
    } else {
      try {
        const handler = new NonStreamResponseHandler(upstreamReq, chatId, authToken, hasTools);
        const response = await handler.handle();
        
        // Copy response properties
        ctx.response.status = response.status;
        ctx.response.headers = response.headers;
        ctx.response.body = await response.text();
      } catch (nonStreamError) {
        debugLog(`非流式响应处理错误: ${nonStreamError}`);
        ctx.response.status = 500;
        ctx.response.body = { error: `Non-stream processing error: ${nonStreamError}` };
      }
    }
        
  } catch (error) {
    debugLog(`外层请求处理错误: ${error}`);
    console.error("Error stack:", error);
    
    // 只有在响应还没有开始时才设置错误响应
    if (!ctx.response.body) {
      ctx.response.status = 500;
      ctx.response.body = { error: `Internal server error: ${error}` };
    } else {
      debugLog("响应已开始，无法设置错误状态");
    }
  }
});
