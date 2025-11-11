import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import Dashboard from './Dashboard'

function App() {
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      // Check if user has admin role (you can customize this based on your user metadata)
      if (session?.user?.user_metadata?.role === 'admin') {
        setIsAdmin(true)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
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
    return <Login onAdminLogin={handleAdminLogin} />
  }

  return <Dashboard isAdmin={isAdmin} />
}

export default App