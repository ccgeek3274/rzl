import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import csCZ from 'antd/locale/cs_CZ';
import dayjs from 'dayjs';
import 'dayjs/locale/cs';
import { App } from './App';
import './styles.css';

dayjs.locale('cs');

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={csCZ}
      theme={{
        token: { colorPrimary: '#1f5f8b', borderRadius: 6, fontSize: 14 },
        components: { Table: { cellPaddingBlockSM: 4, cellPaddingInlineSM: 6 } },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
