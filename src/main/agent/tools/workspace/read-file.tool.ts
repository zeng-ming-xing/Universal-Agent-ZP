import { readFile, stat } from 'node:fs/promises';
import { tool, type ToolRuntime } from 'langchain';
import { emitToolEvent } from '../event';
import { okToolMessage } from '../utils/tool-result';
import { MAX_READ_BYTES } from './config';
import { resolveWorkspacePath } from './path-guards';
import { readFileSchema } from './schemas';

function formatWithLineNumbers(
  text: string,
  startLine: number
): { body: string; startLine: number; endLine: number } {
  const lines = text.split(/\r?\n/);
  const body = lines
    .map((line, i) => `${String(startLine + i).padStart(6)}|${line}`)
    .join('\n');
  return {
    body,
    startLine,
    endLine: startLine + Math.max(lines.length, 1) - 1,
  };
}

/** 读取工作区内文本文件（支持按行 offset/limit） */
export function createReadFileTool() {
  return tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = readFileSchema.parse(input);
      const absolutePath = resolveWorkspacePath(parsed.path);

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'read_file',
        message: `正在读取：${parsed.path}`,
      });

      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        throw new Error(`不是文件：${parsed.path}`);
      }
      if (fileStat.size > MAX_READ_BYTES) {
        throw new Error(
          `文件过大（${fileStat.size} 字节），上限 ${MAX_READ_BYTES} 字节；请缩小范围或分段读取`
        );
      }

      const raw = await readFile(absolutePath, 'utf8');
      const allLines = raw.split(/\r?\n/);
      const offset = parsed.offset ?? 1;
      const limit = parsed.limit ?? allLines.length;
      const sliceStart = Math.max(0, offset - 1);
      const slice = allLines.slice(sliceStart, sliceStart + limit);
      const { body, startLine, endLine } = formatWithLineNumbers(
        slice.join('\n'),
        offset
      );

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'read_file',
        message: `已读取 ${parsed.path}（第 ${startLine}-${endLine} 行，共 ${allLines.length} 行）`,
      });

      return okToolMessage(
        runtime.toolCallId,
        'read_file',
        `已读取 ${parsed.path}（第 ${startLine}-${endLine} 行）`,
        {
          path: parsed.path,
          total_lines: allLines.length,
          start_line: startLine,
          end_line: endLine,
          content: body,
        },
      );
    },
    {
      name: 'read_file',
      description:
        '读取工作区内的文本文件内容；可选 offset（1-based 行号）与 limit（行数）分段读取',
      schema: readFileSchema,
    }
  );
}
