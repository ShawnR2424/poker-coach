import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/app/install';
import './ui/theme.css';
import './ui/lab.css';
import './ui/table/table.css';
import './ui/play/play.css';
import './ui/spots/spots.css';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
