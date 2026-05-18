/** 将浮点数组格式化为 pgvector 字面量 `[1.0,2.0,...]`。 */

export function formatVectorLiteral(arr) {
  return `[${arr.join(',')}]`;
}
