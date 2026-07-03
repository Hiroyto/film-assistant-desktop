import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import '@radix-ui/themes/styles.css';
import { QueryClient, QueryClientProvider } from "react-query"
import { Authenticator } from '@aws-amplify/ui-react';
import { StoryUIProvider } from './components/ui/StoryUIContext';
import { CommandUIProvider } from './commands/CommandUIContext';
import { TourProvider } from './components/Tour/TourProvider';
import { DesktopShell } from './components/widgets/DesktopShell';
import { installTestBridge } from './test-bridge/install';

// Monta window.__TEST__ p/ a suíte de paridade. No-op em web/produção (gated por
// ELECTRON_IS_TEST=1, detectado via window.__TEST_SHELL__ exposto no preload).
installTestBridge();

const queryClient = new QueryClient();
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <QueryClientProvider client={queryClient}>
    <Authenticator.Provider>
      <CommandUIProvider>
        <StoryUIProvider>
          <TourProvider>
            <App />
            <DesktopShell />
          </TourProvider>
        </StoryUIProvider>
      </CommandUIProvider>
    </Authenticator.Provider>
  </QueryClientProvider >
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
