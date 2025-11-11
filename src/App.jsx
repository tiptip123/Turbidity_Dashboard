import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Dashboard from './Dashboard'

function App() {
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)
  const [recoveryMode, setRecoveryMode] = useState(false)

  useEffect(() => {
    // Check for Supabase recovery/reset token in URL hash
    // Supabase returns a hash like: #access_token=...&type=recovery&...
    const { hash } = window.location
    if (hash && hash.includes('type=recovery')) {
      // Password recovery flow - show the update password UI instead of auto-signing in
      setRecoveryMode(true)
      setLoading(false)
      return
    }

    // For other auth redirects (signup, oauth) parse tokens and set session so no refresh is needed
    if (hash && (hash.includes('access_token') || hash.includes('type=signup'))) {
      ;(async () => {
        try {
          const params = new URLSearchParams(hash.replace('#', ''));
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');

          if (access_token) {
            const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) {
              console.warn('Error setting session from URL tokens:', error);
              setLoading(false);
              return;
            }
            if (data?.session) {
              setSession(data.session);
              if (data.session.user?.user_metadata?.role === 'admin') setIsAdmin(true);
              try {
                const cleanUrl = window.location.origin + window.location.pathname;
                window.history.replaceState({}, document.title, cleanUrl);
              } catch (err) {
                console.warn('Failed to clean URL after auth processing', err);
              }
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          console.error('Unexpected error processing auth from URL', e);
        }
        setLoading(false);
      })();
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      // Check if user has admin role (you can customize this based on your user metadata)
      if (session?.user?.user_metadata?.role === 'admin') {
        setIsAdmin(true)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session, error) => {
      setSession(session)
      if (error) {
        setAuthError(error.message)
      }
      if (session?.user?.user_metadata?.role === 'admin') {
        setIsAdmin(true)
      } else {
        setIsAdmin(false)
      }
      setLoading(false)
    })

    return () => subscription?.unsubscribe()
  }, [])

  const handleAdminLogin = (user, isAdminUser) => {
    setSession({ user })
    setIsAdmin(isAdminUser)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return <Login onAdminLogin={handleAdminLogin} authError={authError} recoveryMode={recoveryMode} />
  }

  return <Dashboard isAdmin={isAdmin} />
}

export default App