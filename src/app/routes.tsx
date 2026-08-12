import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { ApiCost } from '@/components/ApiCost'
import { AppShell } from '@/components/AppShell'
import { DebugPage } from '@/components/DebugPage'
import { ErrorPage } from '@/components/ErrorPage'
import { JsonEditor } from '@/components/JsonEditor'
import { Login } from '@/components/Login'
import { LogViewer } from '@/components/LogViewer'
import { ModelsDashboard } from '@/components/ModelsDashboard'
import { OauthResultPage } from '@/components/OauthResultPage'
import { PersonaEdit } from '@/components/PersonaEdit'
import { Personas } from '@/components/Personas'
import { PersonaView } from '@/components/PersonaView'
import { Presets } from '@/components/Presets'
import ProtectedRoute from '@/components/ProtectedRoute'
import { Providers } from '@/components/Providers'
import PublicRoute from '@/components/PublicRoute'
import { RouterPreferences } from '@/components/RouterPreferences'
import { RoutingLibrary } from '@/components/RoutingLibrary'
import { RoutingLiveEditor } from '@/components/RoutingLiveEditor'
import { RoutingPresetEditor } from '@/components/RoutingPresetEditor'
import { SessionsPage } from '@/components/Sessions'
import { SettingsPage } from '@/components/SettingsPage'
import { Subscriptions } from '@/components/Subscriptions'
import { Transformers } from '@/components/Transformers'
import { Usage } from '@/components/Usage'

const fullHeight = (node: ReactNode) => <div className='h-full'>{node}</div>

export const router = createBrowserRouter([
  {
    // Root wrapper: gives every descendant a shared error boundary
    // (unknown paths + thrown render errors both surface as ErrorPage
    // instead of react-router's default "Unexpected Application Error"
    // dev screen).
    element: <Outlet />,
    errorElement: <ErrorPage />,
    children: [
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
          { path: '/subscriptions', element: fullHeight(<Subscriptions />) },
          { path: '/routing-map', element: fullHeight(<RoutingLibrary />) },
          { path: '/routing-map/live', element: fullHeight(<RoutingLiveEditor />) },
          { path: '/routing-map/preset/:id', element: fullHeight(<RoutingPresetEditor />) },
          { path: '/router-preferences', element: fullHeight(<RouterPreferences />) },
          { path: '/transformers', element: fullHeight(<Transformers />) },
          { path: '/usage', element: fullHeight(<Usage />) },
          { path: '/cost', element: fullHeight(<ApiCost />) },
          { path: '/sessions', element: fullHeight(<SessionsPage />) },
          { path: '/personas', element: fullHeight(<Personas />) },
          { path: '/personas/new', element: fullHeight(<PersonaEdit />) },
          { path: '/personas/view/:id', element: fullHeight(<PersonaView />) },
          { path: '/personas/edit/:id', element: fullHeight(<PersonaEdit />) },
          { path: '/logs', element: fullHeight(<LogViewer />) },
          { path: '/json', element: fullHeight(<JsonEditor />) },
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
      },
      {
        path: '*',
        element: <ErrorPage />
      }
    ]
  }
])
