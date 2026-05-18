// 对话 & 消息持久化：提供列表/详情/保存/删除能力。
// 所有函数接受 prisma（PrismaClient 或事务上下文），便于调用方在事务内组合多个操作。

/**
 * 列出所有对话（按 updated_at 倒序），不包含消息列表。
 * 返回：{ ok, conversations: [...] }
 */
export async function listConversations(prisma) {
  const rows = await prisma.agent_conversations.findMany({
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      title: true,
      summary: true,
      message_count: true,
      created_at: true,
      updated_at: true,
    },
  });
  return { ok: true, conversations: rows };
}

/**
 * 获取单个对话详情（包含消息列表）。
 * 返回：{ ok, conversation } 或 { ok: false, error }
 */
export async function getConversation(prisma, id) {
  const conversation = await prisma.agent_conversations.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!conversation) {
    return { ok: false, error: '对话不存在' };
  }
  return { ok: true, conversation };
}

/**
 * 保存（创建或更新）对话及其消息：
 * - 若对话已存在则更新 title/summary/message_count/updated_at
 * - 先清除旧消息再写入新消息（保证与前端状态一致）
 * - 消息的 events_json 仅保留非工具事件（前端已过滤，此处不再重复）
 */
export async function saveConversation(prisma, data) {
  const { id, title, summary, messages } = data;
  if (!id || typeof id !== 'string') {
    return { ok: false, error: 'id 不能为空' };
  }

  const messageCount = Array.isArray(messages) ? messages.length : 0;

  await prisma.$transaction(async (tx) => {
    await tx.agent_conversations.upsert({
      where: { id },
      create: {
        id,
        title: title ?? '新对话',
        summary: summary ?? '',
        message_count: messageCount,
      },
      update: {
        title: title ?? '新对话',
        summary: summary ?? '',
        message_count: messageCount,
        updated_at: new Date(),
      },
    });

    // 删除旧消息后重新插入，保证与前端状态完全一致
    await tx.agent_messages.deleteMany({ where: { conversation_id: id } });

    if (Array.isArray(messages) && messages.length > 0) {
      const rows = messages.map((m) => ({
        id: typeof m.id === 'bigint' ? m.id : BigInt(m.id),
        conversation_id: id,
        role: m.role ?? 'user',
        content: m.content ?? '',
        events_json: m.events_json ?? undefined,
      }));
      await tx.agent_messages.createMany({ data: rows });
    }
  });

  return { ok: true };
}

/**
 * 删除对话及其消息（CASCADE 自动处理）。
 */
export async function deleteConversation(prisma, id) {
  const conversation = await prisma.agent_conversations.findUnique({
    where: { id },
  });
  if (!conversation) {
    return { ok: false, error: '对话不存在' };
  }
  await prisma.agent_conversations.delete({ where: { id } });
  return { ok: true };
}
