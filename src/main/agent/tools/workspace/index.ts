export { WORKSPACE_ROOT } from './config';
export {
  readFileSchema,
  writeFileSchema,
  executeCommandSchema,
} from './schemas';
export { createReadFileTool } from './read-file.tool';
export { createWriteFileTool } from './write-file.tool';
export { createExecuteCommandTool } from './execute-command.tool';

import { createReadFileTool } from './read-file.tool';
import { createWriteFileTool } from './write-file.tool';
import { createExecuteCommandTool } from './execute-command.tool';

/** 工作区读写与命令执行工具集 */
export function createWorkspaceTools() {
  return [
    createReadFileTool(),
    createWriteFileTool(),
    createExecuteCommandTool(),
  ];
}
