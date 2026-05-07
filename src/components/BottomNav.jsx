import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { Compass, User, Users } from 'lucide-react'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { FRIENDSHIP_STATUS } from '../lib/friends'

export default function BottomNav({ active }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)

  // Live-update the badge whenever incoming requests appear or get accepted.
  useEffect(() => {
    if (!user?.id) return
    const q = query(
      collection(db, 'friendships'),
      where('users',  'array-contains', user.id),
      where('status', '==', FRIENDSHIP_STATUS.PENDING),
    )
    return onSnapshot(q, snap => {
      const incoming = snap.docs.filter(d => d.data().requester_id !== user.id)
      setPendingCount(incoming.length)
    }, () => setPendingCount(0))
  }, [user?.id])

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around px-8 py-4"
      style={{
        background: 'rgba(10,9,8,0.95)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(212,184,122,0.08)',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}>
      <NavItem
        icon={<Compass size={20} />}
        label="Trips"
        active={active === 'trips'}
        onClick={() => navigate('/')}
      />
      <NavItem
        icon={<Users size={20} />}
        label="Friends"
        active={active === 'friends'}
        badge={pendingCount}
        onClick={() => navigate('/friends')}
      />
      <NavItem
        icon={<User size={20} />}
        label="Account"
        active={active === 'account'}
        onClick={() => navigate('/account')}
      />
    </div>
  )
}

function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 transition-all"
      style={{ color: active ? '#d4b87a' : '#5a5248' }}>
      <div className="relative">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
              color: '#0a0908',
              boxShadow: '0 0 0 2px rgba(10,9,8,0.95)',
              lineHeight: 1,
            }}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </div>
      <span className="text-xs tracking-wider">{label}</span>
    </button>
  )
}
