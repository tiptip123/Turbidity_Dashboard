import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://sxkgbjbjojusedcgkhse.supabase.co"
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4a2diamJqb2p1c2VkY2draHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTM5NjYsImV4cCI6MjA3Mzg2OTk2Nn0.aOyOJi3nfw1Bo5E8G-C5qGm_GrVyLrzeebHhB4_oMQ4"

export const supabase = createClient(supabaseUrl, supabaseAnonKey)