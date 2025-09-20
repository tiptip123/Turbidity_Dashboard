import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh"
      }}>
        <p>Loading...</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        padding: "20px"
      }}>
        <div style={{ 
          width: "100%", 
          maxWidth: "400px", 
          padding: "20px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)"
        }}>
          <h2 style={{ textAlign: "center", marginBottom: "20px" }}>Login to Dashboard</h2>
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            providers={[]} // No OAuth providers
            view="sign_in" // Start with sign-in view
          />
        </div>
      </div>
    )
  } else {
    return (
      <div style={{ 
        textAlign: "center", 
        marginTop: "50px",
        padding: "20px"
      }}>
        <h2>Welcome to Your Dashboard!</h2>
        <p>You are logged in as: <strong>{session.user.email}</strong></p>
        <button 
          onClick={() => supabase.auth.signOut()}
          style={{
            padding: "10px 20px",
            backgroundColor: "#ff4444",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            marginTop: "20px"
          }}
        >
          Logout
        </button>
      </div>
    )
  }
}

export default App