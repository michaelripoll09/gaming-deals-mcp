import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toPublicError } from '../errors/public-error.js';

export function successResult<T>(value: T): CallToolResult {
  const structuredContent = { result: value };

  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  };
}

export function errorResult(error: unknown): CallToolResult {
  const publicError = toPublicError(error);
  const structuredContent = { code: publicError.code, message: publicError.message };

  return {
    isError: true,
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  };
}

export async function runTool<T>(operation: () => Promise<T>): Promise<CallToolResult> {
  try {
    return successResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}
