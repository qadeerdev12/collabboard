import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import PageLoading from './PageLoading'

export default function ProtectedRoute({ children }) {
    const { user, loading } = useAuth()

    if (loading) {
        return <PageLoading />
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    return children
}
