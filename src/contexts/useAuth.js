import { createContext, useContext } from 'react'

// Lives apart from AuthContext.jsx so that file exports only a component,
// which React fast refresh needs to hot-reload it.
export const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)
