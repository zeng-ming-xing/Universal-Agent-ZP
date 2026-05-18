import { execa } from 'execa';
import { tool, type ToolRuntime } from 'langchain';
import { emitToolEvent } from '../event';
import {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_CHARS,
  WORKSPACE_ROOT,
} from './config';
import { resolveWorkspacePath } from './path-guards';
import { executeCommandSchema } from './schemas';

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n…（已截断 ${omitted} 字符）`;
}

type CommandResult = {
  exitCode: number;
  timedOut: boolean;
  all: string;
};

async function runShellCommand(
  command: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  try {
    const result = await execa(command, [], {
      shell: true,
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      all: true,
      reject: false,
      stdin: 'ignore',
    });

    return {
      exitCode: result.exitCode ?? 1,
      timedOut: result.timedOut,
      all: result.all ?? '',
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      timedOut: false,
      all: message,
    };
  }
}

/** 在工作区内执行 shell 命令（stdout/stderr 合并返回） */
export function createExecuteCommandTool() {
  return tool(
    async (input: unknown, runtime: ToolRuntime) => {
      try {
        const parsed = executeCommandSchema.parse(input);
        const cwd = parsed.cwd
          ? resolveWorkspacePath(parsed.cwd)
          : WORKSPACE_ROOT;
        const timeout = parsed.timeout_ms ?? COMMAND_TIMEOUT_MS;

        emitToolEvent(runtime, {
          kind: 'tool_progress',
          tool: 'execute_command',
          message: `正在执行：${parsed.command}`,
        });

        const result = await runShellCommand(parsed.command, {
          cwd,
          timeout,
          env: process.env,
        });

        const output = truncateOutput(
          String(result.all ?? ''),
          MAX_COMMAND_OUTPUT_CHARS
        );

        emitToolEvent(runtime, {
          kind: 'tool_result',
          tool: 'execute_command',
          message:
            result.exitCode === 0
              ? `命令执行完成（exit 0）`
              : `命令结束（exit ${result.exitCode ?? 'unknown'}）`,
        });

        return JSON.stringify({
          ok: result.exitCode === 0,
          command: parsed.command,
          cwd,
          exit_code: result.exitCode,
          timed_out: result.timedOut,
          output,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);

        try {
          emitToolEvent(runtime, {
            kind: 'tool_result',
            tool: 'execute_command',
            message: `命令执行失败：${message}`,
          });
        } catch {
          // 事件发送失败也不应中断流程
        }

        return JSON.stringify({
          ok: false,
          command: '',
          cwd: WORKSPACE_ROOT,
          exit_code: 1,
          timed_out: false,
          output: `执行失败：${message}`,
        });
      }
    },
    {
      name: 'execute_command',
      description:
        '在工作区目录内执行 shell 命令，返回 exit_code 与合并后的 stdout/stderr；可选 cwd（相对工作区）与 timeout_ms',
      schema: executeCommandSchema,
    }
  );
}
