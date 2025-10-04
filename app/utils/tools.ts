/**
 * Tool processing utilities
 */

import { config } from "../core/config.ts";
import type { Message } from "../models/schemas.ts";

// Tool-related interfaces
interface ToolFunction {
  name: string;
  description?: string;
  parameters?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface Tool {
  type: string;
  function?: ToolFunction;
}

// Additional message types for tool handling
interface ToolMessage extends Message {
  name?: string;
}

export function contentToString(content: unknown): string {
  /**Convert content from various formats to string*/
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (typeof p === "object" && p !== null && p.type === "text") {
        parts.push(p.text || "");
      } else if (typeof p === "string") {
        parts.push(p);
      }
    }
    return parts.join(" ");
  }
  return "";
}

export function generateToolPrompt(tools: Tool[]): string {
  /**Generate tool injection prompt with enhanced formatting*/
  if (!tools || tools.length === 0) {
    return "";
  }

  const toolDefinitions: string[] = [];
  for (const tool of tools) {
    if (tool.type !== "function") {
      continue;
    }

    const functionSpec = tool.function;
    if (!functionSpec) continue;
    
    const functionName = functionSpec.name || "unknown";
    const functionDescription = functionSpec.description || "";
    const parameters = functionSpec.parameters;

    // Create structured tool definition
    const toolInfo = [`## ${functionName}`, `**Purpose**: ${functionDescription}`];

    // Add parameter details
    if (parameters && parameters.properties) {
      const parameterProperties = parameters.properties;
      const requiredParameters = new Set(parameters.required || []);

      if (Object.keys(parameterProperties).length > 0) {
        toolInfo.push("**Parameters**:");
        for (const [paramName, paramDetails] of Object.entries(parameterProperties)) {
          const paramType = (paramDetails as Record<string, unknown>)?.type || "unknown";
          const paramDesc = (paramDetails as Record<string, unknown>)?.description || "";
          const requirementFlag = requiredParameters.has(paramName) ? "**Required**" : "*Optional*";
          toolInfo.push(`- \`${paramName}\` (${paramType}) - ${requirementFlag}: ${paramDesc}`);
        }
      }
    }

    toolDefinitions.push(toolInfo.join("\n"));
  }

  if (toolDefinitions.length === 0) {
    return "";
  }

  // Build comprehensive tool prompt
  const promptTemplate = (
    "\n\n# AVAILABLE FUNCTIONS\n" + toolDefinitions.join("\n\n---\n") + "\n\n# USAGE INSTRUCTIONS\n" +
    "When you need to execute a function, respond ONLY with a JSON object containing tool_calls:\n" +
    "```json\n" +
    "{\n" +
    '  "tool_calls": [\n' +
    "    {\n" +
    '      "id": "call_xxx",\n' +
    '      "type": "function",\n' +
    '      "function": {\n' +
    '        "name": "function_name",\n' +
    '        "arguments": "{\\"param1\\": \\"value1\\"}"\n' +
    "      }\n" +
    "    }\n" +
    "  ]\n" +
    "}\n" +
    "```\n" +
    "Important: No explanatory text before or after the JSON. The 'arguments' field must be a JSON string, not an object.\n"
  );

  return promptTemplate;
}

export function processMessagesWithTools(
  messages: Message[],
  tools?: Tool[],
  toolChoice?: unknown
): Message[] {
  /**Process messages and inject tool prompts*/
  const processed: Message[] = [];

  if (tools && config.TOOL_SUPPORT && (toolChoice !== "none")) {
    const toolsPrompt = generateToolPrompt(tools);
    const hasSystem = messages.some((m: Message) => m.role === "system");

    if (hasSystem) {
      for (const m of messages) {
        if (m.role === "system") {
          const mm = { ...m };
          const content = contentToString(mm.content || "");
          mm.content = content + toolsPrompt;
          processed.push(mm);
        } else {
          processed.push(m);
        }
      }
    } else {
      processed.push({ role: "system", content: "你是一个有用的助手。" + toolsPrompt }, ...messages);
    }

    // Add tool choice hints
    if (toolChoice === "required" || toolChoice === "auto") {
      if (processed.length > 0 && processed[processed.length - 1].role === "user") {
        const last = { ...processed[processed.length - 1] };
        const content = contentToString(last.content || "");
        last.content = content + "\n\n请根据需要使用提供的工具函数。";
        processed[processed.length - 1] = last;
      }
    } else if (typeof toolChoice === "object" && toolChoice && 
               (toolChoice as Record<string, unknown>).type === "function") {
      const toolChoiceObj = toolChoice as Record<string, unknown>;
      const fname = (toolChoiceObj.function as Record<string, unknown>)?.name;
      if (fname && processed.length > 0 && processed[processed.length - 1].role === "user") {
        const last = { ...processed[processed.length - 1] };
        const content = contentToString(last.content || "");
        last.content = content + `\n\n请使用 ${fname} 函数来处理这个请求。`;
        processed[processed.length - 1] = last;
      }
    }
  } else {
    processed.push(...messages);
  }

  // Handle tool/function messages
  const finalMsgs: Message[] = [];
  for (const m of processed) {
    const role = m.role;
    if (role === "tool" || role === "function") {
      const toolName = (m as ToolMessage).name || "unknown";
      let toolContent = contentToString(m.content || "");
      if (typeof toolContent === "object") {
        toolContent = JSON.stringify(toolContent, null, 2);
      }

      // 确保内容不为空且不包含 None
      let content = `工具 ${toolName} 返回结果:\n\`\`\`json\n${toolContent}\n\`\`\``;
      if (!content.trim()) {
        content = `工具 ${toolName} 执行完成`;
      }

      finalMsgs.push({
        role: "assistant",
        content: content,
      });
    } else {
      // For regular messages, ensure content is string format
      const finalMsg = { ...m };
      const content = contentToString(finalMsg.content || "");
      finalMsg.content = content;
      finalMsgs.push(finalMsg);
    }
  }

  return finalMsgs;
}

// Tool Extraction Patterns
const TOOL_CALL_FENCE_PATTERN = /```json\s*(\{.*?\})\s*```/gs;
const FUNCTION_CALL_PATTERN = /调用函数\s*[：:]\s*([\w\-\.]+)\s*(?:参数|arguments)[：:]\s*(\{.*?\})/gs;

export function extractToolInvocations(text: string): unknown[] | null {
  /**Extract tool invocations from response text*/
  if (!text) {
    return null;
  }

  // Limit scan size for performance
  const scannableText = text.substring(0, config.SCAN_LIMIT);

  // Attempt 1: Extract from JSON code blocks
  const jsonBlocks = [...scannableText.matchAll(TOOL_CALL_FENCE_PATTERN)];
  for (const match of jsonBlocks) {
    try {
      const parsedData = JSON.parse(match[1]);
      const toolCalls = parsedData.tool_calls;
      if (toolCalls && Array.isArray(toolCalls)) {
        // Ensure arguments field is a string
        for (const tc of toolCalls) {
          if (tc.function) {
            const func = tc.function;
            if (func.arguments) {
              if (typeof func.arguments === "object") {
                // Convert dict to JSON string
                func.arguments = JSON.stringify(func.arguments);
              } else if (typeof func.arguments !== "string") {
                func.arguments = JSON.stringify(func.arguments);
              }
            }
          }
        }
        return toolCalls;
      }
    } catch {
      continue;
    }
  }

  // Attempt 2: Extract inline JSON objects using bracket balance method
  // 查找包含 "tool_calls" 的 JSON 对象
  let i = 0;
  while (i < scannableText.length) {
    if (scannableText[i] === '{') {
      // 尝试找到匹配的右括号
      let braceCount = 1;
      let j = i + 1;
      let inString = false;
      let escapeNext = false;
      
      while (j < scannableText.length && braceCount > 0) {
        if (escapeNext) {
          escapeNext = false;
        } else if (scannableText[j] === '\\') {
          escapeNext = true;
        } else if (scannableText[j] === '"' && !escapeNext) {
          inString = !inString;
        } else if (!inString) {
          if (scannableText[j] === '{') {
            braceCount++;
          } else if (scannableText[j] === '}') {
            braceCount--;
          }
        }
        j++;
      }
      
      if (braceCount === 0) {
        // 找到了完整的 JSON 对象
        const jsonStr = scannableText.substring(i, j);
        try {
          const parsedData = JSON.parse(jsonStr);
          const toolCalls = parsedData.tool_calls;
          if (toolCalls && Array.isArray(toolCalls)) {
            // Ensure arguments field is a string
            for (const tc of toolCalls) {
              if (tc.function) {
                const func = tc.function;
                if (func.arguments) {
                  if (typeof func.arguments === "object") {
                    // Convert dict to JSON string
                    func.arguments = JSON.stringify(func.arguments);
                  } else if (typeof func.arguments !== "string") {
                    func.arguments = JSON.stringify(func.arguments);
                  }
                }
              }
            }
            return toolCalls;
          }
        } catch {
          // 忽略解析错误
        }
      }
      
      i++;
    } else {
      i++;
    }
  }

  // Attempt 3: Parse natural language function calls
  const naturalLangMatch = scannableText.match(FUNCTION_CALL_PATTERN);
  if (naturalLangMatch) {
    const functionName = naturalLangMatch[1].trim();
    const argumentsStr = naturalLangMatch[2].trim();
    try {
      // Validate JSON format
      JSON.parse(argumentsStr);
      return [
        {
          id: `call_${Date.now() * 1000000}`,
          type: "function",
          function: { name: functionName, arguments: argumentsStr },
        },
      ];
    } catch {
      return null;
    }
  }

  return null;
}

export function removeToolJsonContent(text: string): string {
  /**Remove tool JSON content from response text - using bracket balance method*/
  
  function removeToolCallBlock(match: string, jsonContent: string): string {
    try {
      const parsedData = JSON.parse(jsonContent);
      if ("tool_calls" in parsedData) {
        return "";
      }
    } catch {
      // 忽略解析错误
    }
    return match;
  }
  
  // Step 1: Remove fenced tool JSON blocks
  const cleanedText = text.replace(TOOL_CALL_FENCE_PATTERN, removeToolCallBlock);
  
  // Step 2: Remove inline tool JSON - 使用基于括号平衡的智能方法
  // 查找所有可能的 JSON 对象并精确删除包含 tool_calls 的对象
  const result: string[] = [];
  let i = 0;
  while (i < cleanedText.length) {
    if (cleanedText[i] === '{') {
      // 尝试找到匹配的右括号
      let braceCount = 1;
      let j = i + 1;
      let inString = false;
      let escapeNext = false;
      
      while (j < cleanedText.length && braceCount > 0) {
        if (escapeNext) {
          escapeNext = false;
        } else if (cleanedText[j] === '\\') {
          escapeNext = true;
        } else if (cleanedText[j] === '"' && !escapeNext) {
          inString = !inString;
        } else if (!inString) {
          if (cleanedText[j] === '{') {
            braceCount++;
          } else if (cleanedText[j] === '}') {
            braceCount--;
          }
        }
        j++;
      }
      
      if (braceCount === 0) {
        // 找到了完整的 JSON 对象
        const jsonStr = cleanedText.substring(i, j);
        try {
          const parsed = JSON.parse(jsonStr);
          if ("tool_calls" in parsed) {
            // 这是一个工具调用，跳过它
            i = j;
            continue;
          }
        } catch {
          // 忽略解析错误
        }
      }
      
      // 不是工具调用或无法解析，保留这个字符
      result.push(cleanedText[i]);
      i++;
    } else {
      result.push(cleanedText[i]);
      i++;
    }
  }
  
  return result.join('').trim();
}

/**
 * 为消息添加思考提示，启用模型的思考能力
 */
export function addThinkingPromptToMessages(messages: Message[]): Message[] {
  const processedMessages = [...messages];
  
  // 思考指令模板
  const thinkingInstruction = `

在回答之前，请在 <thinking> 标签中进行思考分析：
- 仔细分析用户的问题和需求
- 考虑可能的解决方案和方法
- 评估答案的准确性和完整性
- 组织回答的结构和逻辑

然后给出你的最终回答。请确保你的思考过程清晰且有条理。`;

  // 查找系统消息或创建一个新的
  let hasSystemMessage = false;
  for (let i = 0; i < processedMessages.length; i++) {
    if (processedMessages[i].role === "system") {
      hasSystemMessage = true;
      const existingContent = contentToString(processedMessages[i].content || "");
      // 检查是否已经包含思考指令
      if (!existingContent.includes("<thinking>")) {
        processedMessages[i] = {
          ...processedMessages[i],
          content: existingContent + thinkingInstruction
        };
      }
      break;
    }
  }
  
  // 如果没有系统消息，创建一个新的
  if (!hasSystemMessage) {
    processedMessages.unshift({
      role: "system",
      content: "你是一个有用的AI助手。" + thinkingInstruction
    });
  }
  
  return processedMessages;
}

/**
 * 为所有请求启用思考功能的消息处理器
 */
export function processMessagesWithThinking(
  messages: Message[],
  tools?: unknown[],
  toolChoice?: unknown,
  enableThinking = true
): Message[] {
  // 首先处理工具相关的消息
  let processedMessages = processMessagesWithTools(messages, tools as Tool[], toolChoice);
  
  // 如果启用思考功能，添加思考提示
  if (enableThinking) {
    processedMessages = addThinkingPromptToMessages(processedMessages);
  }
  
  return processedMessages;
}
