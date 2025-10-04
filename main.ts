/**
 * Main application entry point
 */

// 导入
import { Application, Router } from "oak/mod.ts";
import { config } from "./app/core/config.ts";
import { openaiRouter } from "./app/core/openai.ts";
const app = new Application();
app.use(async (ctx, next) => {
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  ctx.response.headers.set("Access-Control-Allow-Credentials", "true");
  
  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 200;
    return;
  }
  
  await next();
});
const router = new Router();
router.use("/v1", openaiRouter.routes());
router.use("/v1", openaiRouter.allowedMethods());
router.get("/", (ctx) => {
  ctx.response.body = { message: "OpenAI Compatible API Server" };
});
router.options("/", (ctx) => {
  ctx.response.status = 200;
});

// 使用路由
app.use(router.routes());
app.use(router.allowedMethods());

// 错误处理中间件
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Unhandled error:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

// 启动服务器
const port = config.LISTEN_PORT;
console.log(`📖 API docs available at http://localhost:${port}/v1/models`);
await app.listen({ port });
