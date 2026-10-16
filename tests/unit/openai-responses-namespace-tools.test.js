import { describe, expect, it } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Codex Responses API namespace unpacking & namespace restoring", () => {
  it("unpacks namespace tools into flat functions and records mapping", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [
        {
          type: "namespace",
          name: "multi_agent_v1",
          description: "Sub-agent tools",
          tools: [
            {
              type: "function",
              name: "spawn_agent",
              description: "Spawn subagent",
              parameters: { type: "object", properties: { prompt: { type: "string" } } }
            },
            {
              type: "function",
              name: "wait_agent",
              description: "Wait for subagent",
              inputSchema: { type: "object", properties: { target: { type: "string" } } }
            }
          ]
        },
        {
          type: "function",
          name: "exec_command",
          description: "Run shell command",
          parameters: { type: "object", properties: { cmd: { type: "string" } } }
        }
      ]
    };

    const req = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", body, true, null);
    expect(req.tools).toHaveLength(3);
    const names = req.tools.map(t => t.function.name);
    expect(names).toEqual(["spawn_agent", "wait_agent", "exec_command"]);
    expect(req._toolNamespaceMap.get("spawn_agent")).toBe("multi_agent_v1");
    expect(req._toolNamespaceMap.get("wait_agent")).toBe("multi_agent_v1");
    expect(req._toolNamespaceMap.get("exec_command")).toBeUndefined();
  });

  it("strips encrypted keyword from namespace and flat tools", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [
        {
          type: "namespace",
          name: "collaboration",
          description: "Sub-agent tools",
          tools: [
            {
              type: "function",
              name: "followup_task",
              description: "Send follow up task",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", description: "text", encrypted: true },
                  target: { type: "string" }
                },
                required: ["message", "target"]
              }
            }
          ]
        },
        {
          type: "function",
          function: {
            name: "regular_tool",
            description: "A regular tool",
            parameters: {
              type: "object",
              properties: {
                secret: { type: "string", encrypted: true }
              }
            }
          }
        }
      ]
    };

    const req = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", body, true, null);
    const followup = req.tools.find(t => t.function.name === "followup_task");
    expect(followup.function.parameters.properties.message).not.toHaveProperty("encrypted");
    expect(followup.function.parameters.properties.message.type).toBe("string");

    const regular = req.tools.find(t => t.function.name === "regular_tool");
    expect(regular.function.parameters.properties.secret).not.toHaveProperty("encrypted");
    expect(regular.function.parameters.properties.secret.type).toBe("string");
  });

  it("restores namespace in output_item.added and output_item.done events", () => {
    const toolNamespaceMap = new Map([["spawn_agent", "multi_agent_v1"]]);
    const state = {
      ...initState(FORMATS.OPENAI_RESPONSES),
      toolNamespaceMap
    };

    const chunk1 = {
      id: "chat_123",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_spawn_1",
                function: {
                  name: "spawn_agent",
                  arguments: ""
                }
              }
            ]
          }
        }
      ]
    };

    const events1 = openaiToOpenAIResponsesResponse(chunk1, state);
    const addedEvent = events1.find(e => e.event === "response.output_item.added");
    expect(addedEvent).toBeDefined();
    expect(addedEvent.data.item.name).toBe("spawn_agent");
    expect(addedEvent.data.item.namespace).toBe("multi_agent_v1");

    const chunk2 = {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: '{"prompt":"open browser"}'
                }
              }
            ]
          }
        }
      ]
    };
    openaiToOpenAIResponsesResponse(chunk2, state);

    // Terminal flush
    const flushEvents = openaiToOpenAIResponsesResponse(null, state);
    const doneEvent = flushEvents.find(e => e.event === "response.output_item.done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.data.item.name).toBe("spawn_agent");
    expect(doneEvent.data.item.namespace).toBe("multi_agent_v1");
  });
});
