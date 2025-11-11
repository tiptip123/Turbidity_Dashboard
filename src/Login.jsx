import { supabase } from './supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

function Login() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Sediment Monitor</h1>
          <p className="text-gray-600">Real-time turbidity tracking system</p>
        </div>
        
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-center text-gray-700 mb-4">Login to Dashboard</h2>
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            providers={[]}
            view="sign_in"
          />
        </div>

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
