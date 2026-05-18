import { ChatOpenAI } from '@langchain/openai';

/**
 * 模型配置层（与工具、主 Agent 解耦）
 * - 便于后续切换模型供应商或参数策略
 * - 统一从环境变量读取生产配置
 */
// 兼容旧版默认值：GLM-4.6 + 智谱 OpenAI 兼容接口
// 说明：环境变量优先；若未配置，回退到旧默认值（便于本地立即可用）
const DEFAULT_MODEL = 'glm-4.6V';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_API_KEY =
  // 旧版硬编码 key（历史回退）。生产环境请使用环境变量注入，避免泄漏。
  '2ec161dc21454c7f82d457cf20974ad8.GvWjNN3iSiPWyCFr';

type ChatOpenAIInit = NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>;

/** 除 model / apiKey / configuration 外均由调用方传入；三者仅在内部使用上述默认 */
export type CreateModelParams = Omit<ChatOpenAIInit, 'model' | 'apiKey' | 'configuration'>;

export function createModel(params: CreateModelParams): ChatOpenAI {
  return new ChatOpenAI({
    model: DEFAULT_MODEL,
    apiKey: DEFAULT_API_KEY,
    configuration: DEFAULT_BASE_URL ? { baseURL: DEFAULT_BASE_URL } : undefined,
    ...params,
  });
}

export {
  mergeDocumentSegmentSummaries,
  summarizeDocumentSegment
} from './utils/document-ingest-summary'
