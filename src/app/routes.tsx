import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { DebugPage } from '@/components/DebugPage'
import { HistoryPage } from '@/components/History'
import { Login } from '@/components/Login'
import { ModelsDashboard } from '@/components/ModelsDashboard'
import { OauthResultPage } from '@/components/OauthResultPage'
import { Presets } from '@/components/Presets'
import ProtectedRoute from '@/components/ProtectedRoute'
import { Providers } from '@/components/Providers'
import PublicRoute from '@/components/PublicRoute'
import { Router as RouterPanel } from '@/components/Router'
import { SettingsPage } from '@/components/SettingsPage'
import { Transformers } from '@/components/Transformers'
import { Usage } from '@/components/Usage'

const fullHeight = (node: ReactNode) => <div className='h-full'>{node}</div>

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to='/models' replace />
  },
  {
    path: '/login',
    element: (
      <PublicRoute>
        <Login />
      </PublicRoute>
    )
  },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: '/models', element: fullHeight(<ModelsDashboard />) },
      { path: '/providers', element: fullHeight(<Providers />) },
      { path: '/router', element: fullHeight(<RouterPanel />) },
      { path: '/transformers', element: fullHeight(<Transformers />) },
      { path: '/usage', element: fullHeight(<Usage />) },
      { path: '/history', element: fullHeight(<HistoryPage />) },
      { path: '/settings', element: fullHeight(<SettingsPage />) }
    ]
  },
  {
    path: '/presets',
    element: (
      <ProtectedRoute>
        <Presets />
      </ProtectedRoute>
    )
  },
  {
    path: '/debug',
    element: (
      <ProtectedRoute>
        <DebugPage />
      </ProtectedRoute>
    )
  },
  {
    // Public — the IdP redirects browsers here after a server-side
    // token exchange. Token persistence already happened by the time
    // this route mounts; the page is read-only.
    path: '/oauth-result',
    element: <OauthResultPage />
  }
])
