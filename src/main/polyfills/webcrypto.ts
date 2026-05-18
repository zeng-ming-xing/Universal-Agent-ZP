import { webcrypto } from 'node:crypto'

/**
 * 某些依赖（如 LangChain 内部 uuid 实现）会直接读取 globalThis.crypto。
 * 在 Electron 的 Node 运行时里，这个全局对象可能不存在，需要手动兜底。
 */
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as unknown as Crypto
}
