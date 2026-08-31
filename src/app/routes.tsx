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
import { PersonaEdit } from '@/components/PersonaEdit'
import { Personas } from '@/components/Personas'
import { PersonaView } from '@/components/PersonaView'
import { Presets } from '@/components/Presets'
import ProtectedRoute from '@/components/ProtectedRoute'
import PublicRoute from '@/components/PublicRoute'
import { RouterPreferences } from '@/components/RouterPreferences'
import { RouterUtilization } from '@/components/RouterUtilization'
import { RoutingLibrary } from '@/components/RoutingLibrary'
import { RoutingLiveEditor } from '@/components/RoutingLiveEditor'
import { RoutingPresetEditor } from '@/components/RoutingPresetEditor'
import { ActivityLogs } from '@/components/rialto/activity/ActivityLogs'
import { ActivityRequests } from '@/components/rialto/activity/ActivityRequests'
import { ActivitySessionDetail } from '@/components/rialto/activity/ActivitySessionDetail'
import { ActivitySessions } from '@/components/rialto/activity/ActivitySessions'
import { Overview } from '@/components/rialto/Overview'
import { AddProviderScreen } from '@/components/rialto/providers/AddProviderScreen'
import { ProvidersScreen } from '@/components/rialto/providers/ProvidersScreen'
import { RialtoShell } from '@/components/rialto/RialtoShell'
import { RouteError } from '@/components/rialto/RouteError'
import { SettingsAccess } from '@/components/rialto/settings/SettingsAccess'
import { SettingsAdvanced } from '@/components/rialto/settings/SettingsAdvanced'
import { SettingsLogging } from '@/components/rialto/settings/SettingsLogging'
import { SettingsPersonas } from '@/components/rialto/settings/SettingsPersonas'
import { SettingsPresets } from '@/components/rialto/settings/SettingsPresets'
import { SettingsServer } from '@/components/rialto/settings/SettingsServer'
import { SettingsStatusline } from '@/components/rialto/settings/SettingsStatusline'
import { AccessRejectedScreen } from '@/components/rialto/system/AccessRejected'
import { NotFoundScreen } from '@/components/rialto/system/NotFound'
import { OauthResultScreen } from '@/components/rialto/system/OauthResult'
import { SetupScreen } from '@/components/rialto/system/SetupScreen'
import { SessionDetailPage } from '@/components/SessionDetail'
import { SessionsPage } from '@/components/Sessions'
import { SettingsPage } from '@/components/SettingsPage'
import { Subscriptions } from '@/components/Subscriptions'
import { TierEditor } from '@/components/TierEditor'
import { Transformers } from '@/components/Transformers'
import { Usage } from '@/components/Usage'

const fullHeight = (node: ReactNode) => <div className='h-full'>{node}</div>

export const router = createBrowserRouter([
  {
    // Root wrapper: gives every descendant a shared error boundary.
    // RouteError separates the two cases that land here — an unmatched
    // path and a component that threw — because telling someone their
    // bookmark moved when the app actually crashed sends them looking in
    // the wrong place.
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      {
        // The new information architecture leads with Overview. /models
        // was the old landing and is now one tab inside Providers.
        path: '/',
        element: <Navigate to='/overview' replace />
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
        // Rialto shell (Phase 5). New screens land here one at a time;
        // the legacy AppShell below keeps serving every route that has
        // not been rebuilt yet, so the app is usable throughout the
        // migration rather than only at the end of it.
        element: (
          <ProtectedRoute>
            <RialtoShell />
          </ProtectedRoute>
        ),
        children: [
          { path: '/overview', element: <Overview /> },
          { path: '/providers', element: <ProvidersScreen /> },
          // Static before dynamic so /providers/connect is the add flow
          // rather than a provider literally named "connect".
          { path: '/providers/connect', element: <AddProviderScreen /> },
          { path: '/providers/:name', element: <ProvidersScreen /> },
          { path: '/activity', element: <ActivitySessions /> },
          { path: '/activity/requests', element: <ActivityRequests /> },
          { path: '/activity/sessions/:sessionId', element: <ActivitySessionDetail /> },
          { path: '/activity/logs', element: <ActivityLogs /> },
          { path: '/settings', element: <SettingsServer /> },
          { path: '/settings/access', element: <SettingsAccess /> },
          { path: '/settings/logging', element: <SettingsLogging /> },
          { path: '/settings/personas', element: <SettingsPersonas /> },
          { path: '/settings/statusline', element: <SettingsStatusline /> },
          { path: '/settings/presets', element: <SettingsPresets /> },
          { path: '/settings/advanced', element: <SettingsAdvanced /> }
        ]
      },
      {
        element: (
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        ),
        children: [
          { path: '/models', element: fullHeight(<ModelsDashboard />) },
          { path: '/subscriptions', element: fullHeight(<Subscriptions />) },
          { path: '/routing-map', element: fullHeight(<RoutingLibrary />) },
          { path: '/routing-map/live', element: fullHeight(<RoutingLiveEditor />) },
          { path: '/routing-map/preset/:id', element: fullHeight(<RoutingPresetEditor />) },
          { path: '/router-preferences', element: fullHeight(<RouterPreferences />) },
          { path: '/router-utilization', element: fullHeight(<RouterUtilization />) },
          { path: '/router-tiers', element: fullHeight(<TierEditor />) },
          { path: '/transformers', element: fullHeight(<Transformers />) },
          { path: '/json', element: fullHeight(<JsonEditor />) }
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
        element: <OauthResultScreen />
      },
      // First run and the Access-denied explanation render without the
      // shell: the first has no configuration to hang a sidebar off yet,
      // and the second is what the operator sees when the edge refused
      // them, so the app chrome would be misleading.
      { path: '/setup', element: <SetupScreen /> },
      { path: '/access-denied', element: <AccessRejectedScreen /> },
      {
        path: '*',
        element: <NotFoundScreen />
      }
    ]
  }
])
