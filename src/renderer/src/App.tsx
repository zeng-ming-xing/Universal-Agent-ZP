/**
 * App 根组件
 * 渲染 Agent 消息面板（对话侧栏 + 消息列表 + 输入框）
 * 使用 React.memo 避免无 props 变化时的无效重渲染
 */

import { memo } from 'react'
import Message from './Agent'

function App(): JSX.Element {
  return <Message />
}

export default memo(App)
