import { z } from 'zod';

export const getTableCatalogSchema = z.object({});

export const getTableSchemaSchema = z.object({
  tables: z.array(z.string().min(1)).min(1).optional(),
  database: z.string().min(1).optional(),
});

export const generateSqlSchema = z.object({
  requirement: z.string().min(1, '需求不能为空'),
  schemaJson: z.string().optional(),
  previousSql: z.string().optional(),
  feedback: z.string().optional(),
});

export const validateSqlSchema = z.object({
  sql: z.string().min(1, 'SQL 不能为空'),
  schemaJson: z.string().optional(),
});

export const runSqlSchema = z.object({
  sql: z.string().min(1, 'SQL 不能为空'),
});
