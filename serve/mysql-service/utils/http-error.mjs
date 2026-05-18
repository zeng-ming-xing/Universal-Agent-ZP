/** Express JSON 错误响应（mysql / postgres 路由可共用）。 */

export function jsonError(res, status, message, extra) {
  res.status(status).json({
    ok: false,
    error: message,
    ...(extra ? { extra } : {}),
  });
}
