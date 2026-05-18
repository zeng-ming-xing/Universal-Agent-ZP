import { Router } from 'express';
import { createSchemaHandlers } from '../controllers/schema.controller.mjs';
import { createQueryHandlers } from '../controllers/query.controller.mjs';
import { createConversationHandlers } from '../controllers/conversation.controller.mjs';
import { createDocumentHandlers } from '../controllers/document.controller.mjs';

/**
 * MySQL 侧能力：schema / 查询 / 对话持久化。
 * @param {{ prisma: import('@prisma/client').PrismaClient }} } deps
 */
export function createMysqlRouter({ prisma }) {
  const router = Router();
  const schema = createSchemaHandlers({ prisma });
  const query = createQueryHandlers();
  const conversation = createConversationHandlers({ prisma });
  const document = createDocumentHandlers({ prisma });

  router.post('/schema', schema.postSchema);
  router.post('/schema/signature', schema.postSchemaSignature);
  router.post('/schema/digest', schema.postSchemaDigest);
  router.post('/count', query.postCount);
  router.post('/query', query.postQuery);
  router.get('/conversations', conversation.list);
  router.get('/conversations/:id', conversation.getById);
  router.post('/conversations', conversation.save);
  router.delete('/conversations/:id', conversation.remove);
  router.get('/documents', document.list);
  router.post('/documents', document.save);

  return router;
}
