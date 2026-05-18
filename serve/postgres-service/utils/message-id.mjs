/** message_id 与 Prisma/pg 入参统一为 bigint。 */

export function toBigIntMessageId(messageId) {
  return typeof messageId === 'bigint' ? messageId : BigInt(messageId);
}
