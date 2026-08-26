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
        title: "Agnes-AI Image API Reference",
        description: "Standard OpenAI-compatible JSON interface. 9Router automatically transforms top-level parameters into Agnes-AI's upstream structure (e.g. extra_body.image and extra_body.response_format) to ensure 100% reliable calls without 422 errors.",
        endpoint: "/v1/images/generations",
        method: "POST",
        parameters: [
          {
            name: "model",
            type: "string",
            required: true,
            default: selectedModelId || "agnes-ai/agnes-image-2.0-flash",
            desc: "Model name, e.g. agnes-ai/agnes-image-2.0-flash or agnes-ai/agnes-image-2.1-flash",
          },
          {
            name: "prompt",
            type: "string",
            required: true,
            desc: "Text description of the desired image or image editing instruction.",
          },
          {
            name: "image",
            type: "string | string[]",
            required: false,
            desc: "Reference image(s) for Image-to-Image or Multi-Image composition. Supports public HTTPS URLs or Data URI Base64 ('data:image/png;base64,...'). 9Router automatically bundles these into extra_body.image.",
          },
          {
            name: "size",
            type: "string",
            required: false,
            default: "1024x1024",
            desc: is21
              ? "Output resolution. Recommended tier: '1K', '2K', '3K', '4K' (paired with ratio), or exact dimensions like '1024x1024', '1024x768', '768x1024'."
              : "Output resolution dimensions, e.g. '1024x1024', '1024x768', '768x1024'.",
          },
          ...(is21 ? [
            {
              name: "ratio",
              type: "string",
              required: false,
              default: "1:1",
              desc: "Aspect ratio (supported by 2.1-flash): '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'.",
            }
          ] : []),
          {
            name: "response_format",
            type: "string",
            required: false,
            default: "url",
            desc: "Output format: 'url' (returns downloadable image URL) or 'b64_json' (returns Base64 encoded string). 9Router safely relocates this into extra_body and adds return_base64 when needed.",
          },
          {
            name: "extra_body",
            type: "object",
            required: false,
            desc: "Optional pass-through dictionary for custom upstream parameters (e.g. { response_format: 'url', image: [...] }).",
          },
        ],
        examples: [
          {
            title: "Text to Image (文生图)",
            body: {
              model: `agnes-ai/${selectedModelId || "agnes-image-2.0-flash"}`,
              prompt: "A clean product photo of a wireless headphone on a white studio background, soft shadows, 8k resolution",
              size: is21 ? "2K" : "1024x1024",
              ...(is21 ? { ratio: "16:9" } : {}),
              response_format: "url",
            },
          },
          {
            title: "Image to Image / Edit (图生图 / 风格迁移)",
            body: {
              model: `agnes-ai/${selectedModelId || "agnes-image-2.0-flash"}`,
              prompt: "Transform this daytime photo into a cyberpunk city at night with neon lights, keeping the building geometry unchanged",
              image: "https://example.com/source.png",
              size: is21 ? "2K" : "1024x1024",
              response_format: "url",
            },
          },
          {
            title: "Multi-Image Composition (多图合成 / 角色融合)",
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
        title: "Cloudflare Workers AI Image API Reference",
        description: "Direct standard REST interface for Cloudflare Workers AI image generation, img2img, and inpainting models.",
        endpoint: "/v1/images/generations",
        method: "POST",
        parameters: [
          {
            name: "model",
            type: "string",
            required: true,
            default: selectedModelId || "cloudflare-ai/@cf/black-forest-labs/flux-1-schnell",
            desc: "Model identifier, e.g. cloudflare-ai/@cf/black-forest-labs/flux-1-schnell or cloudflare-ai/@cf/runwayml/stable-diffusion-v1-5-inpainting",
          },
          {
            name: "prompt",
            type: "string",
            required: true,
            desc: "Text description of the desired image or inpainting instruction.",
          },
          ...(isImg2Img || isInpainting ? [
            {
              name: "image",
              type: "string",
              required: true,
              desc: "Reference input image URL or Data URI Base64.",
            }
          ] : []),
          ...(isInpainting ? [
            {
              name: "mask_image",
              type: "string",
              required: true,
              desc: "Mask image URL or Data URI Base64 (white areas will be repainted, black areas preserved).",
            }
          ] : []),
          {
            name: "size",
            type: "string",
            required: false,
            default: "1024x1024",
            desc: "Dimensions: '1024x1024', '1024x768', '768x1024', '512x512', etc.",
          },
          {
            name: "negative_prompt",
            type: "string",
            required: false,
            desc: "Elements to avoid in generated image (e.g. 'blurry, low quality, distorted, bad anatomy').",
          },
          {
            name: "strength",
            type: "number",
            required: false,
            default: "0.75",
            desc: "Transformation strength for img2img / inpainting (0.05 to 1.0). Lower values stay closer to the original image.",
          },
          {
            name: "guidance",
            type: "number",
            required: false,
            default: "7.5",
            desc: "Classifier-Free Guidance (CFG) scale (1.0 to 20.0). Higher values adhere closer to prompt.",
          },
          {
            name: "num_steps",
            type: "number",
            required: false,
            default: "20",
            desc: "Number of diffusion sampling steps (1 to 50).",
          },
          {
            name: "seed",
            type: "number",
            required: false,
            desc: "Random seed for reproducible results.",
          },
        ],
        examples: [
          {
            title: isInpainting ? "Inpainting (蒙版局部重绘)" : isImg2Img ? "Image to Image (图生图)" : "Text to Image (文生图)",
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

    // Generic image provider doc
    return {
      title: `${providerId.toUpperCase()} Image API Reference`,
      description: "OpenAI-compatible image generation endpoint.",
      endpoint: "/v1/images/generations",
      method: "POST",
      parameters: [
        { name: "model", type: "string", required: true, desc: "Model identifier" },
        { name: "prompt", type: "string", required: true, desc: "Text prompt" },
        { name: "size", type: "string", required: false, default: "1024x1024", desc: "Image resolution" },
        { name: "image", type: "string | string[]", required: false, desc: "Reference image(s) for img2img (if supported)" },
        { name: "response_format", type: "string", required: false, default: "url", desc: "'url' | 'b64_json'" },
      ],
      examples: [
        {
          title: "Standard Request",
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
      title: `${providerId.toUpperCase()} Video API Reference`,
      description: "Asynchronous video generation endpoint.",
      endpoint: "/v1/videos/generations",
      method: "POST",
      parameters: [
        { name: "model", type: "string", required: true, desc: "Video model identifier (e.g. agnes-ai/agnes-video-v2.0)" },
        { name: "prompt", type: "string", required: true, desc: "Video description prompt" },
        { name: "image", type: "string", required: false, desc: "Optional starting image URL / Base64 for Image-to-Video" },
        { name: "duration", type: "number", required: false, desc: "Video duration in seconds" },
        { name: "aspect_ratio", type: "string", required: false, default: "16:9", desc: "'16:9', '9:16', '1:1', etc." },
      ],
      examples: [
        {
          title: "Create Video Task (创建视频任务)",
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
    <Card className="overflow-hidden border border-border/80 bg-surface/50">
      {/* Header Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-1 hover:opacity-80 transition-opacity text-left cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[18px]">menu_book</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-text-main">
                API Reference & Parameters
              </h3>
              <Badge variant="primary" size="sm">
                {doc.method} {doc.endpoint}
              </Badge>
            </div>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {isExpanded ? "Click to collapse documentation" : "Click to view full parameter specifications, types, and sample payloads"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted shrink-0 pl-2">
          <span>{isExpanded ? "Collapse" : "Expand"}</span>
          <span
            className={`material-symbols-outlined text-[20px] transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          >
            expand_more
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4 animate-in fade-in duration-150">
          {/* Overview notice */}
          <div className="rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-border/60 p-3 text-xs leading-relaxed text-text-muted">
            {doc.description}
          </div>

          {/* Sub tabs */}
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("params")}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === "params"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              Parameters Table ({doc.parameters.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("examples")}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === "examples"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              Request Examples ({doc.examples.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("curl")}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                activeTab === "curl"
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              cURL Sample
            </button>
          </div>

          {/* Tab 1: Parameters Table */}
          {activeTab === "params" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-border text-text-muted font-medium bg-black/[0.02] dark:bg-white/[0.02]">
                    <th className="py-2 px-3 font-semibold">Parameter</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Requirement</th>
                    <th className="py-2 px-3 font-semibold">Default / Options</th>
                    <th className="py-2 px-3 font-semibold">Description & 9Router Behavior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {doc.parameters.map((p) => (
                    <tr key={p.name} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                      <td className="py-2 px-3 font-mono font-medium text-primary whitespace-nowrap">
                        {p.name}
                      </td>
                      <td className="py-2 px-3 font-mono text-text-muted whitespace-nowrap">
                        {p.type}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {p.required ? (
                          <Badge variant="error" size="sm">Required</Badge>
                        ) : (
                          <Badge variant="default" size="sm">Optional</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-text-muted text-[11px] whitespace-nowrap">
                        {p.default || "—"}
                      </td>
                      <td className="py-2 px-3 text-text-main leading-relaxed min-w-[240px]">
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
                  <div key={idx} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-main">{ex.title}</span>
                      <button
                        type="button"
                        onClick={() => copy(exJson, `ex-${idx}`)}
                        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-primary transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === `ex-${idx}` ? "check" : "content_copy"}
                        </span>
                        {copied === `ex-${idx}` ? "Copied" : "Copy Payload"}
                      </button>
                    </div>
                    <pre className="bg-sidebar rounded-lg p-3 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
                      {exJson}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: cURL Command */}
          {activeTab === "curl" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">cURL Command</span>
                <button
                  type="button"
                  onClick={() => copy(sampleCurl, "curl-doc")}
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-primary transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === "curl-doc" ? "check" : "content_copy"}
                  </span>
                  {copied === "curl-doc" ? "Copied" : "Copy Command"}
                </button>
              </div>
              <pre className="bg-sidebar rounded-lg p-3 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
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
