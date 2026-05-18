/**
 * Renderer 入口 —— React 应用挂载点
 * 由 Electron 主进程加载 index.html 后执行，负责初始化 React 组件树
 */

import './assets/main.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// 挂载 React 应用到 #root 容器（位于 index.html）
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
