"use client";

import { useState, useMemo } from "react";
import { cn } from "@/shared/utils/cn";

function JsonNode({ name, value, isLast = true, depth = 0, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);

  const entries = useMemo(() => {
    if (!isObject) return [];
    if (isArray) return value.map((v, i) => [i, v]);
    return Object.entries(value);
  }, [value, isObject, isArray]);

  const count = entries.length;

  if (!isObject) {
    let renderedVal = String(value);
    let valColor = "text-text-main";

    if (value === null) {
      renderedVal = "null";
      valColor = "text-amber-500 font-semibold";
    } else if (typeof value === "boolean") {
      renderedVal = value ? "true" : "false";
      valColor = "text-purple-500 font-semibold";
    } else if (typeof value === "number") {
      renderedVal = String(value);
      valColor = "text-blue-500 font-mono";
    } else if (typeof value === "string") {
      // If string is exceptionally long, truncate for tree node to prevent freezing the UI DOM
      const isLongString = value.length > 500;
      const displayString = isLongString && !expanded ? `${value.slice(0, 300)}... (${value.length} chars)` : value;
      renderedVal = JSON.stringify(displayString);
      valColor = "text-emerald-600 dark:text-emerald-400 break-all";

      if (isLongString) {
        return (
          <div className="font-mono text-xs leading-5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded px-1">
            {name !== undefined && (
              <span className="text-text-muted select-none">
                {typeof name === "number" ? name : `"${name}"`}:{" "}
              </span>
            )}
            <span className={valColor}>{renderedVal}</span>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="ml-2 text-[10px] text-blue-500 hover:underline select-none"
            >
              {expanded ? "收起" : "展开全文"}
            </button>
            {!isLast && <span className="text-text-muted select-none">,</span>}
          </div>
        );
      }
    }

    return (
      <div className="font-mono text-xs leading-5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded px-1">
        {name !== undefined && (
          <span className="text-text-muted select-none">
            {typeof name === "number" ? name : `"${name}"`}:{" "}
          </span>
        )}
        <span className={valColor}>{renderedVal}</span>
        {!isLast && <span className="text-text-muted select-none">,</span>}
      </div>
    );
  }

  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  return (
    <div className="font-mono text-xs leading-5">
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded px-1 select-none text-text-main py-0.5"
      >
        <span className={cn(
          "material-symbols-outlined text-[14px] text-text-muted transition-transform duration-150 inline-block",
          expanded ? "rotate-90" : ""
        )}>
          arrow_right
        </span>

        {name !== undefined && (
          <span className="text-purple-600 dark:text-purple-400 font-semibold">
            {typeof name === "number" ? name : `"${name}"`}:{" "}
          </span>
        )}

        <span>{openBrace}</span>
        
        {!expanded && (
          <span className="text-text-muted text-[11px] bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.2 mx-1">
            {count} {isArray ? "items" : "keys"}
          </span>
        )}

        {!expanded && <span>{closeBrace}</span>}
        {!expanded && !isLast && <span className="text-text-muted">,</span>}
      </div>

      {expanded && (
        <div className="pl-4 border-l border-black/10 dark:border-white/10 ml-2 my-0.5 space-y-0.5">
          {entries.map(([k, v], idx) => (
            <JsonNode
              key={k}
              name={k}
              value={v}
              isLast={idx === count - 1}
              depth={depth + 1}
              defaultExpanded={false}
            />
          ))}
        </div>
      )}

      {expanded && (
        <div className="pl-1 text-text-main select-none">
          <span>{closeBrace}</span>
          {!isLast && <span className="text-text-muted">,</span>}
        </div>
      )}
    </div>
  );
}

export default function JsonViewer({ data, title = "JSON", maxHeight = "500px" }) {
  const [copied, setCopied] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);

  const jsonString = useMemo(() => {
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return data;
      }
    }
    return JSON.stringify(data, null, 2);
  }, [data]);

  const parsedData = useMemo(() => {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    return data;
  }, [data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInNewTab = () => {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const isTreeCompatible = parsedData !== null && typeof parsedData === "object";

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden bg-black/[0.02] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border-b border-black/5 dark:border-white/5 text-xs">
        <span className="font-semibold text-text-muted text-[11px] uppercase tracking-wider">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {isTreeCompatible && (
            <button
              type="button"
              onClick={() => setViewRaw(!viewRaw)}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-text-main transition-colors"
            >
              {viewRaw ? "树状视图" : "文本视图"}
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenInNewTab}
            title="在新标签页中打开（支持浏览器 JSON 格式化插件）"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-[13px]">open_in_new</span>
            新窗口
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="复制到剪贴板"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-[13px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>

      <div 
        style={{ maxHeight }} 
        className="p-3 overflow-auto font-mono text-xs select-text"
      >
        {viewRaw || !isTreeCompatible ? (
          <pre className="whitespace-pre font-mono text-xs text-text-main">
            {jsonString}
          </pre>
        ) : (
          <JsonNode value={parsedData} defaultExpanded={false} />
        )}
      </div>
    </div>
  );
}
