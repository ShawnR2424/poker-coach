import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from './ui/Lab';
import './ui/theme.css';
import './ui/lab.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
