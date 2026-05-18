/** Express JSON 错误响应（postgres 路由使用，与 mysql-service/utils 行为一致）。 */

export function jsonError(res, status, message, extra) {
  res.status(status).json({
    ok: false,
    error: message,
    ...(extra ? { extra } : {}),
  });
}
