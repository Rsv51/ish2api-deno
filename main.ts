// main.ts - Deno 版本的 ish2api 服务 (v1.0.2 - With Sponsor Adblock)

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";

// 加载环境变量
const env = await load();

// --- 类型定义 ---
interface ChatMessage {
  role: string;
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

// --- 配置 ---
const POLLINATIONS_HEADERS = {
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'Origin': 'https://ish.junioralive.in',
  'Referer': 'https://ish.junioralive.in/',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
};

const TARGET_URL = env.TARGET_URL || Deno.env.get("TARGET_URL") || "https://text.pollinations.ai/openai";

// --- 核心：流式代理函数 ---
async function* streamProxy(requestBody: OpenAIChatRequest): AsyncGenerator<Uint8Array> {
  try {
    const response = await fetch(TARGET_URL, {
      method: "POST",
      headers: POLLINATIONS_HEADERS,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorDetails = {
        error: {
          message: `Upstream API error: ${response.status}`,
          type: "upstream_error",
          details: errorText
        }
      };
      const errorMessage = `data: ${JSON.stringify(errorDetails)}\n\n`;
      yield new TextEncoder().encode(errorMessage);
      console.error(`Error from upstream API: ${response.status} - ${errorText}`);
      return;
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        // =================== 广告过滤逻辑开始 ===================
        // 将二进制块解码为字符串以便检查内容
        const chunkStr = textDecoder.decode(value, { stream: true });

        // 检查解码后的字符串是否包含 "Sponsor" 关键词
        if (chunkStr.includes("Sponsor")) {
          console.log("Sponsor content detected. Stopping the stream to the client.");
          // 发现广告，立即中断循环，不再向客户端发送任何数据
          break;
        }
        
        // 如果没有广告，将原始的二进制块转发给客户端
        yield value;
        // =================== 广告过滤逻辑结束 ===================
      }
    } finally {
      reader.releaseLock();
    }

  } catch (error) {
    const errorDetails = {
      error: {
        message: `An unexpected error occurred: ${error.message}`,
        type: "proxy_error"
      }
    };
    const errorMessage = `data: ${JSON.stringify(errorDetails)}\n\n`;
    yield new TextEncoder().encode(errorMessage);
    console.error(`An unexpected error occurred: ${error}`);
  }
}

// --- 路由处理 ---
async function handleChatCompletions(request: Request): Promise<Response> {
  try {
    const payload = await request.json() as OpenAIChatRequest;
    
    // 强制启用流式传输
    const requestBody = {
      ...payload,
      stream: true
    };

    console.log(`Forwarding request for model '${payload.model}' to ${TARGET_URL}`);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamProxy(requestBody)) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

  } catch (error) {
    console.error('Error parsing request:', error);
    return new Response(JSON.stringify({
      error: {
        message: 'Invalid request format',
        type: 'request_error'
      }
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// --- 主处理函数 ---
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, method } = { pathname: url.pathname, method: request.method };

  // 处理 CORS 预检请求
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // 路由分发
  if (pathname === '/v1/chat/completions' && method === 'POST') {
    return handleChatCompletions(request);
  }

  if (pathname === '/' && method === 'GET') {
    return new Response(JSON.stringify({
      message: "Pollinations OpenAI-Compatible Proxy is running. Use the /v1/chat/completions endpoint.",
      version: "1.0.2",
      target_url: TARGET_URL
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 404 处理
  return new Response(JSON.stringify({
    error: {
      message: 'Not Found',
      type: 'not_found'
    }
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

// --- 启动服务器 ---
const port = parseInt(Deno.env.get("PORT") || "8000");

console.log("Starting Deno server...");
console.log(`Forwarding requests to: ${TARGET_URL}`);
console.log(`OpenAI compatible endpoint available at: http://127.0.0.1:${port}/v1/chat/completions`);

await serve(handler, { port });
