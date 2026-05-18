import { Router } from 'express';
import { createEmbeddingHandlers } from '../controllers/embedding.controller.mjs';

/**
 * pgvector 向量嵌入 API。
 * @param {{ vectorPrisma: import('@prisma/client').PrismaClient }} } deps
 */
export function createVectorRouter({ vectorPrisma }) {
  const router = Router();
  const h = createEmbeddingHandlers({ vectorPrisma });

  router.post('/document-chunks/batch', h.saveDocumentChunksBatch);
  router.post('/document-chunks', h.saveDocumentChunk);
  router.post('/embeddings', h.save);
  router.post('/embeddings/search', h.search);
  router.get('/embeddings/message/:messageId', h.getByMessageId);
  router.get('/embeddings/conversation/:conversationId', h.listByConversation);
  router.delete('/embeddings/message/:messageId', h.deleteByMessageId);
  router.delete('/embeddings/conversation/:conversationId', h.deleteByConversation);

  return router;
}
