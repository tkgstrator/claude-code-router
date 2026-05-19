import '@/i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'
import { ThemeProvider } from 'next-themes'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from '@/components/ConfigProvider'
import { router } from './routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute='class' defaultTheme='system' storageKey='theme'>
      <ConfigProvider>
        <RouterProvider router={router} />
      </ConfigProvider>
    </ThemeProvider>
  </StrictMode>
)
