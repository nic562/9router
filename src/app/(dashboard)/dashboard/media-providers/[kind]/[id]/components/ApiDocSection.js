"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";

const PARAM_SPEC = {
  model: { type: "string", required: true, desc: "模型完整标识符 (格式: {provider_alias}/{model_id})" },
  prompt: { type: "string", required: true, desc: "生成文本描述、编辑指令或画面提示词" },
  input: { type: "string | string[]", required: true, desc: "需要处理的输入文本 (TTS 语音合成或 Embedding 向量生成)" },
  query: { type: "string", required: true, desc: "搜索关键词或查询短语" },
  url: { type: "string", required: true, desc: "需要抓取内容的网页公网 URL" },
  image: { type: "string | string[]", required: false, desc: "参考底图 (支持公网 HTTPS URL 或 data:image/...;base64,...)，用于图生图或多图合成" },
  mask_image: { type: "string", required: false, desc: "蒙版图片 URL 或 Base64 (用于 Inpainting 局部重绘，白色区域重绘，黑色区域保留)" },
  size: { type: "string", required: false, default: "1024x1024", desc: "分辨率尺寸 (如 1024x1024, 1024x768, 或档位 1K, 2K, 3K, 4K)" },
  ratio: { type: "string", required: false, default: "1:1", desc: "画面宽高比 (如 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9)" },
  response_format: { type: "string", required: false, default: "url", desc: "返回格式：'url' (图片直链) 或 'b64_json' (Base64 数据)。9Router 自动适配上游规范" },
  negative_prompt: { type: "string", required: false, desc: "负向提示词，过滤不希望出现的元素 (如 blurry, distorted, bad quality)" },
  strength: { type: "number", required: false, default: "0.75", desc: "图生图 / 重绘变化强度 (0.05 到 1.0)" },
  guidance: { type: "number", required: false, default: "7.5", desc: "CFG 提示词遵循度系数 (1.0 到 20.0)" },
  num_steps: { type: "number", required: false, default: "20", desc: "扩散生成步数 (1 到 50)" },
  seed: { type: "number", required: false, desc: "随机数种子，用于固定并复现画面" },
  duration: { type: "number", required: false, desc: "视频生成时长 (秒)" },
  aspect_ratio: { type: "string", required: false, default: "16:9", desc: "视频画面比例 ('16:9', '9:16', '1:1' 等)" },
  voice: { type: "string", required: false, desc: "发音人声音 ID (如 alloy, echo, fable, onyx, nova, shimmer 等)" },
  format: { type: "string", required: false, default: "markdown", desc: "网页抓取返回格式：'markdown' (推荐)、'text' 或 'html'" },
  max_characters: { type: "number", required: false, desc: "输出最大截断字符数 (0 表示不限制)" },
  search_type: { type: "string", required: false, default: "web", desc: "搜索类型：'web' 或 'news'" },
  max_results: { type: "number", required: false, default: "5", desc: "返回搜索结果的最大数量" },
  extra_body: { type: "object", required: false, desc: "可选高级透传字典" },
};

function generateDynamicMarkdownDoc(providerId, kind) {
  const provider = AI_PROVIDERS[providerId];
  if (!provider) return null;

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  if (!kindConfig) return null;

  const providerAlias = getProviderAlias(providerId);
  const allModels = getModelsByProviderId(providerId) || [];
  const kindModels = allModels.filter((m) => getModelKind(m) === kind);

  const endpointPath = kindConfig.endpoint.path;
  const httpMethod = kindConfig.endpoint.method;
  const providerName = provider.name || providerId;

  // 1. Gather all params needed for this kind and provider's models
  const paramKeys = new Set();

  if (kind === "image") {
    paramKeys.add("model");
    paramKeys.add("prompt");
    paramKeys.add("size");
    paramKeys.add("response_format");

    const hasEdit = kindModels.some((m) => m.capabilities?.includes("edit"));
    const hasMask = kindModels.some((m) => m.capabilities?.includes("mask"));
    if (hasEdit) paramKeys.add("image");
    if (hasMask) paramKeys.add("mask_image");

    for (const m of kindModels) {
      if (Array.isArray(m.params)) {
        for (const p of m.params) paramKeys.add(p);
      }
    }
  } else if (kind === "video") {
    paramKeys.add("model");
    paramKeys.add("prompt");
    paramKeys.add("image");
    paramKeys.add("duration");
    paramKeys.add("aspect_ratio");
  } else if (kind === "webSearch") {
    paramKeys.add("query");
    paramKeys.add("search_type");
    paramKeys.add("max_results");
  } else if (kind === "webFetch") {
    paramKeys.add("url");
    paramKeys.add("format");
    paramKeys.add("max_characters");
  } else if (kind === "embedding") {
    paramKeys.add("model");
    paramKeys.add("input");
  } else if (kind === "tts") {
    paramKeys.add("model");
    paramKeys.add("input");
    paramKeys.add("voice");
  } else {
    paramKeys.add("model");
    paramKeys.add("prompt");
  }

  // 2. Build Markdown lines
  const lines = [];

  lines.push(`# 9Router — ${providerName} ${kindConfig.label} API Reference`);
  lines.push("");
  lines.push(`- **Endpoint**: \`${httpMethod} ${endpointPath}\``);
  lines.push(`- **Auth**: \`Authorization: Bearer <9ROUTER_API_KEY>\``);
  lines.push(`- **Content-Type**: \`application/json\``);
  lines.push("");

  // Models Section
  if (kindModels.length > 0) {
    lines.push("## Supported Models (支持的模型列表)");
    for (const m of kindModels) {
      const caps = [];
      if (m.capabilities?.includes("mask")) caps.push("Inpainting");
      else if (m.capabilities?.includes("edit")) caps.push("Img2Img");
      if (m.capabilities?.includes("multi_image")) caps.push("Multi-Image");
      if (m.capabilities?.includes("text2img")) caps.push("Text2Img");
      if (m.capabilities?.includes("text2video")) caps.push("Text2Video");
      if (m.capabilities?.includes("image2video")) caps.push("Image2Video");

      const capBadge = caps.length > 0 ? ` *[${caps.join(", ")}]*` : "";
      lines.push(`- \`${providerAlias}/${m.id}\`${m.name && m.name !== m.id ? ` — ${m.name}` : ""}${capBadge}`);
    }
    lines.push("");
  }

  // Provider config metadata (workflows, sizes, ratios, pricingUrl)
  const cfg = provider.imageConfig || provider.videoConfig || provider.ttsConfig || provider.searchConfig || provider.fetchConfig || provider.embeddingConfig;
  if (cfg) {
    const metaItems = [];
    if (cfg.workflows && cfg.workflows.length) metaItems.push(`- **Workflows**: ${Array.isArray(cfg.workflows) ? cfg.workflows.join(", ") : cfg.workflows}`);
    if (cfg.sizes && cfg.sizes.length) metaItems.push(`- **Standard Sizes**: ${Array.isArray(cfg.sizes) ? cfg.sizes.join(", ") : cfg.sizes}`);
    if (cfg.ratios && cfg.ratios.length) metaItems.push(`- **Supported Ratios**: ${Array.isArray(cfg.ratios) ? cfg.ratios.join(", ") : cfg.ratios}`);
    if (cfg.pricingUrl) metaItems.push(`- **Pricing Docs**: [${cfg.pricingUrl}](${cfg.pricingUrl})`);
    if (metaItems.length > 0) {
      lines.push("## Provider Capabilities (能力规格)");
      lines.push(...metaItems);
      lines.push("");
    }
  }

  // Parameters Table
  lines.push("## Request Parameters (请求参数)");
  lines.push("| Parameter | Type | Required | Default | Description |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  for (const key of paramKeys) {
    const spec = PARAM_SPEC[key] || { type: "string", required: false, desc: key };
    const reqStr = spec.required ? "Yes" : "Optional";
    const defStr = spec.default ? `\`${spec.default}\`` : "—";
    lines.push(`| \`${key}\` | ${spec.type} | ${reqStr} | ${defStr} | ${spec.desc} |`);
  }
  lines.push("");

  // Primary Example
  const defaultModelObj = kindModels[0];
  const defaultModelFull = defaultModelObj ? `${providerAlias}/${defaultModelObj.id}` : `${providerAlias}/default`;

  lines.push("## Request Examples (调用示例)");

  if (kind === "image") {
    // 1. Text to image example
    lines.push("### 1. Text to Image (文生图)");
    lines.push("```json");
    lines.push(JSON.stringify({
      model: defaultModelFull,
      prompt: "A beautiful cinematic mountain landscape with golden sunset, 8k resolution",
      size: "1024x1024",
      response_format: "url"
    }, null, 2));
    lines.push("```");
    lines.push("");

    // 2. Image to Image example (if provider has edit models or multi_image)
    const editModel = kindModels.find((m) => m.capabilities?.includes("edit") || m.id.includes("img2img") || m.id.includes("flash"));
    if (editModel || providerId === "agnes-ai" || providerId === "cloudflare-ai") {
      const editModelFull = editModel ? `${providerAlias}/${editModel.id}` : defaultModelFull;
      lines.push("### 2. Image to Image / Edit (图生图 / 图像编辑)");
      lines.push("```json");
      lines.push(JSON.stringify({
        model: editModelFull,
        prompt: "Transform this image into a cyberpunk neon night style, keeping composition",
        image: "https://example.com/input.png",
        size: "1024x1024",
        response_format: "url"
      }, null, 2));
      lines.push("```");
      lines.push("");
    }

    // 3. Inpainting example (if provider has mask models)
    const maskModel = kindModels.find((m) => m.capabilities?.includes("mask") || m.id.includes("inpainting"));
    if (maskModel) {
      lines.push("### 3. Inpainting (蒙版局部重绘)");
      lines.push("```json");
      lines.push(JSON.stringify({
        model: `${providerAlias}/${maskModel.id}`,
        prompt: "A yellow rubber duck in the water",
        image: "https://example.com/input.png",
        mask_image: "https://example.com/mask.png",
        strength: 0.8
      }, null, 2));
      lines.push("```");
      lines.push("");
    }
  } else if (kind === "video") {
    lines.push("### Text to Video (文生视频)");
    lines.push("```json");
    lines.push(JSON.stringify({
      model: defaultModelFull,
      prompt: "A serene lake at dawn with misty mountains in background",
      aspect_ratio: "16:9"
    }, null, 2));
    lines.push("```");
    lines.push("");
  } else if (kind === "webSearch") {
    lines.push("### Web Search Query (网页搜索)");
    lines.push("```json");
    lines.push(JSON.stringify({
      model: providerAlias,
      query: "What is the latest progress in AI multimodal agents?",
      search_type: "web",
      max_results: 5
    }, null, 2));
    lines.push("```");
    lines.push("");
  } else if (kind === "webFetch") {
    lines.push("### Web Fetch to Markdown (URL 提取为 Markdown)");
    lines.push("```json");
    lines.push(JSON.stringify({
      model: providerAlias,
      url: "https://example.com/article",
      format: "markdown"
    }, null, 2));
    lines.push("```");
    lines.push("");
  }

  // Response format section
  lines.push("## Standard Response (标准响应格式)");
  lines.push("```json");
  if (kind === "image") {
    lines.push(JSON.stringify({
      created: 1780000000,
      data: [
        {
          url: "https://example.com/generated-image.png",
          b64_json: null,
          revised_prompt: null
        }
      ]
    }, null, 2));
  } else if (kind === "video") {
    lines.push(JSON.stringify({
      request_id: "req_video_123456",
      status: "processing"
    }, null, 2));
  } else {
    lines.push(JSON.stringify({
      status: "success",
      data: {}
    }, null, 2));
  }
  lines.push("```");

  return lines.join("\n");
}

export default function ApiDocSection({ providerId, kind }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const markdownContent = generateDynamicMarkdownDoc(providerId, kind);
  if (!markdownContent) return null;

  const provider = AI_PROVIDERS[providerId];
  const providerName = provider?.name || providerId;

  return (
    <Card className="border border-border/80 bg-surface/50">
      {/* Header Toggle */}
      <div
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-1 hover:opacity-90 transition-opacity cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">description</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-text-main">
                {providerName} 接口文档与参数规范 (Markdown)
              </h3>
              <Badge variant="primary" size="sm">
                Markdown
              </Badge>
            </div>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {isExpanded ? "点击收起 Markdown 文档" : "点击展开查看或复制供 Agent / 开发者使用的 Markdown 格式接口规范文档"}
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

      {/* Expanded Markdown Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Markdown Documentation
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copy(markdownContent, "md-doc");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied === "md-doc" ? "check" : "content_copy"}
              </span>
              {copied === "md-doc" ? "已复制 Markdown" : "一键复制 Markdown 文档"}
            </button>
          </div>

          <pre className="bg-sidebar rounded-lg p-4 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all border border-border leading-relaxed selection:bg-primary/20">
            {markdownContent}
          </pre>
        </div>
      )}
    </Card>
  );
}

ApiDocSection.propTypes = {
  providerId: PropTypes.string.isRequired,
  kind: PropTypes.string.isRequired,
};
