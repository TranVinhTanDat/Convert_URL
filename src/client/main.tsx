import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// React.StrictMode tắt trong dev để tránh double-mount gây warning "uncontrolled→controlled"
// (warning chỉ là cosmetic vì React 19 mount component 2 lần). Bật lại khi cần audit:
// import { StrictMode } from 'react';
// <StrictMode><App /></StrictMode>
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
