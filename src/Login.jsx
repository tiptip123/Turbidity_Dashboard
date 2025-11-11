import { useState } from 'react'
import { supabase } from './supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

// Hardcoded admin credentials (for development/testing)
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: '123456'
}

function Login({ onAdminLogin, authError, recoveryMode = false }) {
  const [loginMode, setLoginMode] = useState('user') // 'user' or 'admin'
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [adminLoading, setAdminLoading] = useState(false)
  // We rely on Supabase Auth UI's built-in password recovery.
  // No local `userView` toggle is needed to avoid duplicate "Forgot password" links.

  const handleAdminLogin = async (e) => {
    e.preventDefault()
    setAdminError('')
    setAdminLoading(true)

    try {
      // Validate against hardcoded admin credentials
      if (adminUsername === ADMIN_CREDENTIALS.username && adminPassword === ADMIN_CREDENTIALS.password) {
        // Create a mock admin session/user
        const mockAdminUser = {
          id: 'admin-user-id',
          email: 'admin@sediment-monitor.local',
          user_metadata: { role: 'admin' }
        }
        onAdminLogin(mockAdminUser, true)
      } else {
        setAdminError('Invalid username or password. Please try again.')
      }
    } catch {
      setAdminError('Login failed. Please try again.')
    } finally {
      setAdminLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Sediment Monitor</h1>
          <p className="text-gray-600">Real-time turbidity tracking system</p>
        </div>

        {/* Login Mode Selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setLoginMode('user')}
            className={`flex-1 py-2 px-4 rounded font-medium transition ${
              loginMode === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            User Login
          </button>
          <button
            onClick={() => setLoginMode('admin')}
            className={`flex-1 py-2 px-4 rounded font-medium transition ${
              loginMode === 'admin'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Admin Login
          </button>
        </div>

        {/* User Login */}
        {loginMode === 'user' && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-center text-gray-700 mb-4">User Dashboard Access</h2>
            {authError && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-800 rounded-lg text-sm">
                {authError}
              </div>
            )}
            {/* Use Supabase Auth UI directly. Its built-in "Forgot password" UI will be shown once the user selects it.
                Removing the custom toggle avoids duplicate links and keeps the Supabase flow as the single functional
                password-recovery method. */}
            <Auth
              supabaseClient={supabase}
              appearance={{ theme: ThemeSupa }}
              providers={[]}
              view={recoveryMode ? 'update_password' : 'sign_in'}
            />
          </div>
        )}

        {/* Admin Login */}
        {loginMode === 'admin' && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-center text-red-700 mb-4">🔐 Admin Portal</h2>
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admin Username</label>
                <input
                  type="text"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admin Password</label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  required
                />
              </div>
              {adminError && (
                <div className="p-3 bg-red-100 border border-red-400 text-red-800 rounded-lg text-sm">
                  {adminError}
                </div>
              )}
              <button
                type="submit"
                disabled={adminLoading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2 px-4 rounded-lg transition"
              >
                {adminLoading ? 'Logging in...' : 'Admin Login'}
              </button>
            </form>
            <p className="text-xs text-center text-gray-500 mt-4">
              Admin credentials required for data export and report generation
            </p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-center text-gray-500">
            Sediment accumulation monitoring for water quality assessment
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
