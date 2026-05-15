import type { ReactNode } from 'react'
import { createMemoryRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { DebugPage } from '@/components/DebugPage'
import { Login } from '@/components/Login'
import { ModelsDashboard } from '@/components/ModelsDashboard'
import { Presets } from '@/components/Presets'
import ProtectedRoute from '@/components/ProtectedRoute'
import { Providers } from '@/components/Providers'
import PublicRoute from '@/components/PublicRoute'
import { Router as RouterPanel } from '@/components/Router'
import { Transformers } from '@/components/Transformers'

const fullHeight = (node: ReactNode) => <div className='h-full'>{node}</div>

export const router = createMemoryRouter(
  [
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
        { path: '/transformers', element: fullHeight(<Transformers />) }
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
    }
  ],
  {
    initialEntries: ['/models']
  }
)
