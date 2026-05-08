import { ANSWER_START, DEEP_THINK_BEGIN, DEEP_THINK_END } from './constants';

export const getTimeText = () =>
  new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

export interface ParsedDeepThink {
  /** 已闭合的深度思考正文；流式未闭合前可能为已有片段 */
  thinking: string | null;
  /** 结束标记之后的面向用户正文（Markdown） */
  body: string;
  /** 正在流式输出深度思考块内（含 BEGIN 已出现、END 未出现） */
  inThinkingBlock: boolean;
}

function stripMarkers(text: string): string {
  return text
    .split(DEEP_THINK_BEGIN)
    .join('')
    .split(DEEP_THINK_END)
    .join('')
    .split(ANSWER_START)
    .join('')
    .trim();
}

function trimTrailingMarkerPrefix(text: string, marker: string): string {
  const suffixLen = longestSuffixPrefixLen(text, marker);
  return suffixLen > 0 ? text.slice(0, -suffixLen) : text;
}

function longestSuffixPrefixLen(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let len = max; len >= 1; len -= 1) {
    if (marker.startsWith(text.slice(-len))) {
      return len;
    }
  }
  return 0;
}

export function parseDeepThink(content: string): ParsedDeepThink {
  const bi = content.indexOf(DEEP_THINK_BEGIN);

  // 未出现完整 BEGIN：如果末尾是 BEGIN 的“前缀分片”，认为已进入深度思考（避免把 `<<` 之类渲染成正文）
  if (bi === -1) {
    const beginSuffixLen = longestSuffixPrefixLen(content, DEEP_THINK_BEGIN);
    if (beginSuffixLen > 0) {
      return {
        thinking: '',
        body: stripMarkers(content.slice(0, -beginSuffixLen)),
        inThinkingBlock: true,
      };
    }
    return {
      thinking: null,
      body: stripMarkers(content),
      inThinkingBlock: false,
    };
  }

  // 出现 BEGIN 后，仅将标记区间内内容划为「深度思考」；
  // BEGIN 之前与 END 之后内容都保留在普通回答区展示。
  const afterBegin = bi + DEEP_THINK_BEGIN.length;
  const tail = content.slice(afterBegin);

  // 查找 END（只在 BEGIN 之后查）
  const eiInTail = tail.indexOf(DEEP_THINK_END);
  if (eiInTail === -1) {
    // 未出现完整 END：同理，剔除末尾可能的 END 前缀分片，避免标记字符出现在思考内容里
    const endSuffixLen = longestSuffixPrefixLen(tail, DEEP_THINK_END);
    const thinkingText = endSuffixLen > 0 ? tail.slice(0, -endSuffixLen) : tail;
    return {
      thinking: stripMarkers(thinkingText),
      body: stripMarkers(content.slice(0, bi)),
      inThinkingBlock: true,
    };
  }

  const beforeThink = content.slice(0, bi);
  const afterThink = tail.slice(eiInTail + DEEP_THINK_END.length);

  return {
    thinking: stripMarkers(tail.slice(0, eiInTail)),
    body: (() => {
      const answerIdx = afterThink.indexOf(ANSWER_START);
      const answerRaw =
        answerIdx >= 0
          ? afterThink.slice(answerIdx + ANSWER_START.length)
          : trimTrailingMarkerPrefix(afterThink, ANSWER_START);
      const merged = `${beforeThink}\n${answerRaw}`.trim();
      return stripMarkers(merged);
    })(),
    inThinkingBlock: false,
  };
}
