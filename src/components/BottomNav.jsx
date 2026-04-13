import { useNavigate } from 'react-router-dom'
import { Compass, User } from 'lucide-react'

export default function BottomNav({ active }) {
  const navigate = useNavigate()

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
        icon={<User size={20} />}
        label="Account"
        active={active === 'account'}
        onClick={() => navigate('/account')}
      />
    </div>
  )
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 transition-all"
      style={{ color: active ? '#d4b87a' : '#5a5248' }}>
      {icon}
      <span className="text-xs tracking-wider">{label}</span>
    </button>
  )
}
