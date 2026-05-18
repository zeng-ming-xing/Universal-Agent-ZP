/** Agent 工作区根目录（读写与命令执行的 cwd 上限） */
export const WORKSPACE_ROOT =
  process.env.AGENT_WORKSPACE_ROOT?.trim() || process.cwd();

/** 单次读取文件最大字节数 */
export const MAX_READ_BYTES = Number(
  process.env.AGENT_MAX_READ_BYTES
);

/** 命令执行默认超时（ms） */
export const COMMAND_TIMEOUT_MS = Number(
  process.env.AGENT_COMMAND_TIMEOUT_MS
);

/** 命令 stdout/stderr 合并后最大返回字符数 */
export const MAX_COMMAND_OUTPUT_CHARS = Number(
  process.env.AGENT_MAX_COMMAND_OUTPUT_CHARS
);
