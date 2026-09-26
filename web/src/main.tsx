// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found');

async function start(root: HTMLElement): Promise<void> {
  // The public demo answers the API inside the browser (#41, ADR-0021). Any other build
  // compiles this branch away, and the demo API with it.
  if (__ERP_DEMO__) {
    const { installDemoApi } = await import('./demo/install');
    installDemoApi();
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start(container);
