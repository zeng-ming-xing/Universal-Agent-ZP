// 知识文档摘要：写入 MySQL agent_documents，供应用侧列表与检索元数据使用。

/**
 * 创建或更新一条文档摘要记录。
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   id: string;
 *   title?: string;
 *   file_path?: string;
 *   summary: string;
 *   chunk_count?: number;
 * }} data
 */
export async function upsertDocument(prisma, data) {
  const id = String(data?.id ?? '').trim();
  if (!id) {
    return { ok: false, error: 'id 不能为空' };
  }

  const summary = data.summary ?? '';
  const title = String(data.title ?? '').trim() || '未命名文档';
  const file_path = String(data.file_path ?? '').trim();
  const chunk_count = Number.isFinite(Number(data.chunk_count))
    ? Math.max(0, Math.floor(Number(data.chunk_count)))
    : 0;

  try {
    await prisma.agent_documents.upsert({
      where: { id },
      create: {
        id,
        title,
        file_path,
        summary,
        chunk_count,
      },
      update: {
        title,
        file_path,
        summary,
        chunk_count,
        updated_at: new Date(),
      },
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
export async function listDocuments(prisma) {
  try {
    const rows = await prisma.agent_documents.findMany({
      orderBy: { updated_at: 'desc' },
      select: {
        id: true,
        title: true,
        file_path: true,
        summary: true,
        chunk_count: true,
        created_at: true,
        updated_at: true,
      },
    });
    return { ok: true, documents: rows };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
