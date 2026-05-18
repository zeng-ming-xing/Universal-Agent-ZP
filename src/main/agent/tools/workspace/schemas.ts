import { z } from 'zod';

export const readFileSchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const writeFileSchema = z.object({
  path: z.string().min(1, '文件路径不能为空'),
  content: z.string(),
  create_dirs: z.boolean().optional(),
});

export const executeCommandSchema = z.object({
  command: z.string().min(1, '命令不能为空'),
  cwd: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1000).max(600_000).optional(),
});
