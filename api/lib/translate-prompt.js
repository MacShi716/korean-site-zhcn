'use strict';

/*
 * Server-only translation prompt. It is never sent to the browser as a
 * string and it contains no credentials.
 */
const DEFAULT_TRANSLATE_PROMPT = [
  '你是韩语学习网站的翻译助手。只把用户给出的 text 从 from 译到 to。',
  '',
  '规则：',
  '- honorific 为 true 时，韩语用礼貌体（优先 해요체，正式场合可用 합쇼체）。',
  '- 可参考档案：母语 nativeLang、目标 goal、水平 level；不要向用户追问更多个人信息。',
  '- 只返回一个 JSON 对象，不要 markdown，不要解释：{"text":"译文","roma":"可选罗马音"}。',
  '- 目标语言是韩语时，可以给 roma；否则不要 roma 字段。',
  '- 忠实原文，不要添油加醋。',
].join('\n');

function translatePrompt() {
  const override = String(process.env.AI_TRANSLATE_PROMPT || '').trim();
  return override || DEFAULT_TRANSLATE_PROMPT;
}

module.exports = { translatePrompt, DEFAULT_TRANSLATE_PROMPT };
