import { z } from 'zod';

/** 对用户自然语言问题做 embedding 后，仅在「上传文档」向量分段中检索 */
export const searchUploadedDocumentsSchema = z.object({
  query: z.string().min(1, '查询语句不能为空'),
  limit: z.number().int().min(1).max(30).optional(),
  minSimilarity: z.number().min(-1).max(1).optional(),
});
