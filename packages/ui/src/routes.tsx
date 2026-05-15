import { createMemoryRouter, Navigate } from 'react-router-dom'
import { DebugPage } from '@/components/DebugPage'
import { Login } from '@/components/Login'
import { Presets } from '@/components/Presets'
import ProtectedRoute from '@/components/ProtectedRoute'
import PublicRoute from '@/components/PublicRoute'
import App from './App'

export const router = createMemoryRouter(
  [
    {
      path: '/',
      element: <Navigate to='/dashboard' replace />
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
      path: '/dashboard',
      element: (
        <ProtectedRoute>
          <App />
        </ProtectedRoute>
      )
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
    initialEntries: ['/dashboard']
  }
)
