import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool, type ToolRuntime } from 'langchain';
import { emitToolEvent } from '../event';
import { okToolMessage } from '../utils/tool-result';
import { resolveWorkspacePath } from './path-guards';
import { writeFileSchema } from './schemas';

/** 写入或覆盖工作区内文本文件 */
export function createWriteFileTool() {
  return tool(
    async (input: unknown, runtime: ToolRuntime) => {
      const parsed = writeFileSchema.parse(input);
      const absolutePath = resolveWorkspacePath(parsed.path);

      emitToolEvent(runtime, {
        kind: 'tool_progress',
        tool: 'write_file',
        message: `正在写入：${parsed.path}`,
      });

      if (parsed.create_dirs !== false) {
        await mkdir(dirname(absolutePath), { recursive: true });
      }

      await writeFile(absolutePath, parsed.content, 'utf8');
      const bytes = Buffer.byteLength(parsed.content, 'utf8');
      const lineCount = parsed.content.split(/\r?\n/).length;

      emitToolEvent(runtime, {
        kind: 'tool_result',
        tool: 'write_file',
        message: `已写入 ${parsed.path}（${bytes} 字节，${lineCount} 行）`,
      });

      return okToolMessage(
        runtime.toolCallId,
        'write_file',
        `已写入 ${parsed.path}（${bytes} 字节，${lineCount} 行）`,
        {
          path: parsed.path,
          bytes,
          lines: lineCount,
        },
      );
    },
    {
      name: 'write_file',
      description:
        '写入或覆盖工作区内的文本文件；默认自动创建父目录（create_dirs=false 可关闭）',
      schema: writeFileSchema,
    }
  );
}
