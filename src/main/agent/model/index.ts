import { ChatOpenAI } from '@langchain/openai';

/**
 * 模型配置层（与工具、主 Agent 解耦）
 * - 便于后续切换模型供应商或参数策略
 * - 统一从环境变量读取，无硬编码默认值
 */
const MODEL_NAME = process.env.AGENT_MODEL_NAME;
const BASE_URL = process.env.AGENT_MODEL_BASE_URL;
const API_KEY = process.env.ZHIPU_API_KEY;

type ChatOpenAIInit = NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>;

/** 除 model / apiKey / configuration 外均由调用方传入；三者均从环境变量读取 */
export type CreateModelParams = Omit<ChatOpenAIInit, 'model' | 'apiKey' | 'configuration'>;

export function createModel(params: CreateModelParams): ChatOpenAI {
  return new ChatOpenAI({
    model: MODEL_NAME,
    apiKey: API_KEY,
    configuration: BASE_URL ? { baseURL: BASE_URL } : undefined,
    ...params,
  });
}

export {
  mergeDocumentSegmentSummaries,
  summarizeDocumentSegment
} from './utils/document-ingest-summary'
