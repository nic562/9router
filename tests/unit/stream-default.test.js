import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock('../../open-sse/executors/index.js', () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../open-sse/utils/requestLogger.js', () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock('../../open-sse/utils/clientDetector.js', () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock('../../open-sse/utils/bypassHandler.js', () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock('../../open-sse/utils/streamHandler.js', () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock('../../open-sse/services/tokenRefresh.js', () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock('../../open-sse/utils/proxyFetch.js', () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock('../../open-sse/translator/formats/claude.js', () => ({
  normalizeClaudePassthrough: vi.fn(),
}));

vi.mock('../../open-sse/utils/toolDeduper.js', () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock('../../open-sse/rtk/caveman.js', () => ({
  injectCaveman: vi.fn(),
}));

vi.mock('../../open-sse/rtk/ponytail.js', () => ({
  injectPonytail: vi.fn(),
}));

vi.mock('../../open-sse/rtk/index.js', () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ''),
}));

vi.mock('../../open-sse/rtk/headroom.js', () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ''),
  formatHeadroomSizeLog: vi.fn(() => ''),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock('../../open-sse/providers/capabilities.js', () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));

vi.mock('../../open-sse/translator/concerns/modality.js', () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock('../../open-sse/translator/concerns/prefetch.js', () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock('../../open-sse/handlers/chatCore/requestDetail.js', () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock('../../open-sse/utils/error.js', () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));

vi.mock('@/lib/usageDb.js', () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

function makeOptions(bodyStream, provider = 'gemini') {
  const body = {
    model: 'gemini-3.1-flash-lite',
    messages: [{ role: 'user', content: 'hello' }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider, model: 'gemini-3.1-flash-lite' },
    credentials: { apiKey: 'sk-test' },
    clientRawRequest: {
      endpoint: '/v1/chat/completions',
      body,
      headers: {},
    },
    connectionId: 'test-connection',
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('stream defaults follow OpenAI specification', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error('test exit'));
  });

  it('stream defaults to false when body.stream is omitted', async () => {
    const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');

    await handleChatCore(makeOptions(undefined));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
  });

  it('stream is false when body.stream is explicitly false', async () => {
    const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');

    await handleChatCore(makeOptions(false));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(false);
  });

  it('stream is true when body.stream is explicitly true', async () => {
    const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');

    await handleChatCore(makeOptions(true));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  });
});
