import { resolve, relative, sep } from 'node:path';
import { WORKSPACE_ROOT } from './config';

function normalizeRoot(root: string): string {
  const resolved = resolve(root);
  return resolved.endsWith(sep) ? resolved : resolved + sep;
}

const workspaceRootNorm = normalizeRoot(WORKSPACE_ROOT);

/** 将用户路径解析为工作区内的绝对路径；越界则抛错 */
export function resolveWorkspacePath(inputPath: string): string {
  const trimmed = inputPath?.trim();
  if (!trimmed) {
    throw new Error('路径不能为空');
  }

  const absolute = resolve(WORKSPACE_ROOT, trimmed);
  const rel = relative(WORKSPACE_ROOT, absolute);

  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`路径超出工作区范围：${inputPath}`);
  }

  if (!normalizeRoot(absolute).startsWith(workspaceRootNorm)) {
    throw new Error(`路径超出工作区范围：${inputPath}`);
  }

  return absolute;
}
