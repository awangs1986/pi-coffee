// Pure presentation helpers: a failed/cancelled compaction is never a success.
export function compactionNotice(event) {
  if (event.aborted) return { text: '压缩已取消，未完成恢复。可检查 VM 配置后重试。', failure: true };
  if (event.errorMessage || !event.result) return { text: '压缩失败：' + (event.errorMessage || '未返回压缩结果') + '。原始记录保留，不会自动重放任务。', failure: true };
  return { text: '上下文已压缩，原始记录保留。请确认当前状态后继续任务。', failure: false };
}
export function isContextError(message) {
  return /context[_ -]?(budget|length|window|overflow)|too many tokens|maximum context|prompt.{0,20}too long/i.test(message || '');
}
