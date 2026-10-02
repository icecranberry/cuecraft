import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './state/store';
import './styles.css';

// 开发模式下暴露状态钩子，供自动化测试注入素材与验证流程
if (import.meta.env.DEV) {
  (window as unknown as { __cueStore: typeof useStore }).__cueStore = useStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
