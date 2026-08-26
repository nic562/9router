"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

function getProviderDocConfig(providerId, selectedModelId, kind) {
  if (kind === "image") {
    if (providerId === "agnes-ai") {
      const is21 = selectedModelId === "agnes-image-2.1-flash";
      return {
        title: "Agnes-AI 图像生成接口文档 (API Reference)",
        subtitle: "POST /v1/images/generations",
        description: "标准 OpenAI 兼容生图接口。9Router 会自动将顶层的图片、格式等参数规范化为 Agnes-AI 上游要求的 extra_body 结构（如 extra_body.image 和 extra_body.response_format），防止 422 报错，确保任何客户端都能开箱即用。",
        endpoint: "/v1/images/generations",
        method: "POST",
        parameters: [
          {
            name: "model",
            type: "string",
            required: true,
            default: selectedModelId || "agnes-ai/agnes-image-2.0-flash",
            desc: "模型名称。例如 agnes-ai/agnes-image-2.0-flash 或 agnes-ai/agnes-image-2.1-flash",
          },
          {
            name: "prompt",
            type: "string",
            required: true,
            desc: "生图提示词或图像编辑指令。",
          },
          {
            name: "image",
            type: "string | string[]",
            required: false,
            desc: "图生图 / 多图合成参考底图。支持公网 HTTPS URL 或 Data URI Base64（data:image/png;base64,...）。可传单张或数组，9Router 会自动将其封装为 extra_body.image 发送给上游。",
          },
          {
            name: "size",
            type: "string",
            required: false,
            default: "1024x1024",
            desc: is21
              ? "输出图像尺寸。2.1-flash 推荐使用分辨率档位：'1K'、'2K'、'3K'、'4K'（配合 ratio 使用），也兼容 '1024x1024'、'1024x768'、'768x1024' 等精确像素。"
              : "输出图像尺寸，例如 '1024x1024'、'1024x768'、'768x1024'。",
          },
          ...(is21 ? [
            {
              name: "ratio",
              type: "string",
              required: false,
              default: "1:1",
              desc: "宽高比（2.1-flash 支持）：'1:1'、'16:9'、'9:16'、'4:3'、'3:4'、'3:2'、'2:3'、'21:9'。",
            }
          ] : []),
          {
            name: "response_format",
            type: "string",
            required: false,
            default: "url",
            desc: "输出格式：'url'（返回公网下载图片链接）或 'b64_json'（返回 Base64 数据）。9Router 会自动将其移至 extra_body.response_format，避免顶层参数导致上游 422 报错。",
          },
          {
            name: "extra_body",
            type: "object",
            required: false,
            desc: "可选高级参数字典（例如直接传 { response_format: 'url', image: [...] }）。",
          },
        ],
        examples: [
          {
            title: "1. 文生图 (Text to Image)",
            body: {
              model: `agnes-ai/${selectedModelId || "agnes-image-2.0-flash"}`,
              prompt: "A clean product photo of a wireless headphone on a white studio background, soft shadows, 8k resolution",
              size: is21 ? "2K" : "1024x1024",
              ...(is21 ? { ratio: "16:9" } : {}),
              response_format: "url",
            },
          },
          {
            title: "2. 单图图生图 / 风格迁移 (Image to Image)",
            body: {
              model: `agnes-ai/${selectedModelId || "agnes-image-2.0-flash"}`,
              prompt: "Transform this daytime photo into a cyberpunk city at night with neon lights, keeping the building geometry unchanged",
              image: "https://example.com/source.png",
              size: is21 ? "2K" : "1024x1024",
              response_format: "url",
            },
          },
          {
            title: "3. 多图合成 / 角色融合 (Multi-Image Composition)",
            body: {
              model: `agnes-ai/${selectedModelId || "agnes-image-2.1-flash"}`,
              prompt: "Place the character from the first image beside the product from the second image in a modern showroom",
              image: [
                "https://example.com/character.png",
                "https://example.com/product.png",
              ],
              size: "2K",
              ratio: "16:9",
              response_format: "url",
            },
          },
        ],
      };
    }

    if (providerId === "cloudflare-ai") {
      const isImg2Img = selectedModelId?.includes("img2img");
      const isInpainting = selectedModelId?.includes("inpainting");
      return {
        title: "Cloudflare Workers AI 图像接口文档 (API Reference)",
        subtitle: "POST /v1/images/generations",
        description: "Cloudflare Workers AI 图像生成、图生图与蒙版局部重绘接口。",
        endpoint: "/v1/images/generations",
        method: "POST",
        parameters: [
          {
            name: "model",
            type: "string",
            required: true,
            default: selectedModelId || "cloudflare-ai/@cf/black-forest-labs/flux-1-schnell",
            desc: "模型标识符，例如 cloudflare-ai/@cf/black-forest-labs/flux-1-schnell 或 cloudflare-ai/@cf/runwayml/stable-diffusion-v1-5-inpainting",
          },
          {
            name: "prompt",
            type: "string",
            required: true,
            desc: "图像描述提示词或重绘指令。",
          },
          ...(isImg2Img || isInpainting ? [
            {
              name: "image",
              type: "string",
              required: true,
              desc: "参考底图 URL 或 Base64。",
            }
          ] : []),
          ...(isInpainting ? [
            {
              name: "mask_image",
              type: "string",
              required: true,
              desc: "蒙版图片 URL 或 Base64（白色区域重绘，黑色区域保留）。",
            }
          ] : []),
          {
            name: "size",
            type: "string",
            required: false,
            default: "1024x1024",
            desc: "尺寸：'1024x1024'、'1024x768'、'768x1024'、'512x512' 等。",
          },
          {
            name: "negative_prompt",
            type: "string",
            required: false,
            desc: "负向提示词（过滤模糊、变形、低质元素）。",
          },
          {
            name: "strength",
            type: "number",
            required: false,
            default: "0.75",
            desc: "图生图 / 重绘变化强度（0.05 到 1.0）。",
          },
          {
            name: "guidance",
            type: "number",
            required: false,
            default: "7.5",
            desc: "CFG 提示词遵循度（1.0 到 20.0）。",
          },
          {
            name: "num_steps",
            type: "number",
            required: false,
            default: "20",
            desc: "扩散步数（1 到 50）。",
          },
          {
            name: "seed",
            type: "number",
            required: false,
            desc: "随机种子，用于复现生成效果。",
          },
        ],
        examples: [
          {
            title: isInpainting ? "蒙版局部重绘 (Inpainting)" : isImg2Img ? "图生图 (Image to Image)" : "文生图 (Text to Image)",
            body: isInpainting ? {
              model: `cloudflare-ai/${selectedModelId || "@cf/runwayml/stable-diffusion-v1-5-inpainting"}`,
              prompt: "A yellow rubber duck floating in the pool",
              image: "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png",
              mask_image: "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog-mask.png",
              strength: 0.8,
              guidance: 7.5,
              num_steps: 20,
            } : isImg2Img ? {
              model: `cloudflare-ai/${selectedModelId || "@cf/runwayml/stable-diffusion-v1-5-img2img"}`,
              prompt: "Convert to oil painting style with vibrant brush strokes",
              image: "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png",
              strength: 0.75,
              guidance: 7.5,
              num_steps: 20,
            } : {
              model: `cloudflare-ai/${selectedModelId || "@cf/black-forest-labs/flux-1-schnell"}`,
              prompt: "A beautiful mountain lake during sunset, cinematic photography",
              num_steps: 4,
            },
          },
        ],
      };
    }

    return {
      title: `${providerId.toUpperCase()} 图像接口文档 (API Reference)`,
      subtitle: "POST /v1/images/generations",
      description: "标准 OpenAI 兼容图像生成接口。",
      endpoint: "/v1/images/generations",
      method: "POST",
      parameters: [
        { name: "model", type: "string", required: true, desc: "模型名称" },
        { name: "prompt", type: "string", required: true, desc: "提示词文本" },
        { name: "size", type: "string", required: false, default: "1024x1024", desc: "图像分辨率" },
        { name: "image", type: "string | string[]", required: false, desc: "参考底图（图生图支持）" },
        { name: "response_format", type: "string", required: false, default: "url", desc: "'url' 或 'b64_json'" },
      ],
      examples: [
        {
          title: "标准文生图请求",
          body: {
            model: `${providerId}/${selectedModelId || "default"}`,
            prompt: "A majestic lion standing on a cliff",
            size: "1024x1024",
            response_format: "url",
          },
        },
      ],
    };
  }

  if (kind === "video") {
    return {
      title: `${providerId.toUpperCase()} 视频生成接口文档 (API Reference)`,
      subtitle: "POST /v1/videos/generations",
      description: "异步视频生成与任务创建接口。",
      endpoint: "/v1/videos/generations",
      method: "POST",
      parameters: [
        { name: "model", type: "string", required: true, desc: "视频模型名称 (例如 agnes-ai/agnes-video-v2.0)" },
        { name: "prompt", type: "string", required: true, desc: "视频画面与动作描述提示词" },
        { name: "image", type: "string", required: false, desc: "首帧或参考底图 URL / Base64（图生视频）" },
        { name: "duration", type: "number", required: false, desc: "视频时长（秒）" },
        { name: "aspect_ratio", type: "string", required: false, default: "16:9", desc: "画面比例，如 '16:9'、'9:16'、'1:1'" },
      ],
      examples: [
        {
          title: "创建视频生成任务",
          body: {
            model: `${providerId}/${selectedModelId || "agnes-video-v2.0"}`,
            prompt: "A cinematic aerial shot of misty pine mountains at dawn",
          },
        },
      ],
    };
  }

  return null;
}

export default function ApiDocSection({ providerId, selectedModelId, kind, endpoint = "" }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("params"); // "params" | "examples" | "curl"
  const { copied, copy } = useCopyToClipboard();

  const doc = getProviderDocConfig(providerId, selectedModelId, kind);
  if (!doc) return null;

  const sampleReqJson = JSON.stringify(doc.examples[0]?.body || {}, null, 2);
  const sampleCurl = `curl -X ${doc.method} ${endpoint || "http://localhost:20128"}${doc.endpoint} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${sampleReqJson}'`;

  return (
    <Card className="border border-primary/20 bg-primary/[0.02] shadow-sm">
      {/* Header Toggle */}
      <div
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-1 hover:opacity-90 transition-opacity cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-lg bg-primary text-white flex items-center justify-center shrink-0 shadow-sm">
            <span className="material-symbols-outlined text-[20px]">description</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-text-main">
                {doc.title}
              </h3>
              <Badge variant="primary" size="sm">
                {doc.method} {doc.endpoint}
              </Badge>
            </div>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {isExpanded ? "点击收起参数规格表与调用示例" : "点击展开查看支持的参数、类型说明、9Router 自动转换规则及代码示例"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-primary font-medium shrink-0 pl-3">
          <span>{isExpanded ? "收起文档" : "展开文档"}</span>
          <span
            className={`material-symbols-outlined text-[22px] transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4 animate-in fade-in duration-150">
          {/* Overview notice */}
          <div className="rounded-lg bg-black/[0.03] dark:bg-white/[0.03] border border-border/80 p-3 text-xs leading-relaxed text-text-muted">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-0.5">info</span>
              <div>{doc.description}</div>
            </div>
          </div>

          {/* Sub tabs */}
          <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("params")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                activeTab === "params"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              参数规格表 ({doc.parameters.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("examples")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                activeTab === "examples"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              场景请求示例 ({doc.examples.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("curl")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                activeTab === "curl"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              cURL 示例
            </button>
          </div>

          {/* Tab 1: Parameters Table */}
          {activeTab === "params" && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-border text-text-muted font-medium bg-black/[0.02] dark:bg-white/[0.02]">
                    <th className="py-2.5 px-3 font-semibold">参数名</th>
                    <th className="py-2.5 px-3 font-semibold">类型</th>
                    <th className="py-2.5 px-3 font-semibold">必填/选填</th>
                    <th className="py-2.5 px-3 font-semibold">默认值 / 选项</th>
                    <th className="py-2.5 px-3 font-semibold min-w-[280px]">说明及 9Router 网关行为</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {doc.parameters.map((p) => (
                    <tr key={p.name} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                      <td className="py-2.5 px-3 font-mono font-medium text-primary whitespace-nowrap">
                        {p.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-text-muted whitespace-nowrap">
                        {p.type}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {p.required ? (
                          <Badge variant="error" size="sm">必填</Badge>
                        ) : (
                          <Badge variant="default" size="sm">选填</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-text-muted text-[11px] whitespace-nowrap">
                        {p.default || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-text-main leading-relaxed">
                        {p.desc}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Workflow JSON Examples */}
          {activeTab === "examples" && (
            <div className="flex flex-col gap-4">
              {doc.examples.map((ex, idx) => {
                const exJson = JSON.stringify(ex.body, null, 2);
                return (
                  <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-border p-3 bg-sidebar/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-main">{ex.title}</span>
                      <button
                        type="button"
                        onClick={() => copy(exJson, `ex-${idx}`)}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline transition-colors cursor-pointer font-medium"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === `ex-${idx}` ? "check" : "content_copy"}
                        </span>
                        {copied === `ex-${idx}` ? "已复制 Payload" : "复制 Payload"}
                      </button>
                    </div>
                    <pre className="bg-background rounded-lg p-3 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all border border-border">
                      {exJson}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: cURL Command */}
          {activeTab === "curl" && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 bg-sidebar/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">cURL 命令行</span>
                <button
                  type="button"
                  onClick={() => copy(sampleCurl, "curl-doc")}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline transition-colors cursor-pointer font-medium"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === "curl-doc" ? "check" : "content_copy"}
                  </span>
                  {copied === "curl-doc" ? "已复制 cURL" : "复制 cURL 命令"}
                </button>
              </div>
              <pre className="bg-background rounded-lg p-3 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all border border-border">
                {sampleCurl}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

ApiDocSection.propTypes = {
  providerId: PropTypes.string.isRequired,
  selectedModelId: PropTypes.string,
  kind: PropTypes.string.isRequired,
  endpoint: PropTypes.string,
};
