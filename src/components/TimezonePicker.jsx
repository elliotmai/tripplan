import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'
import { TIMEZONE_GROUPS, ALL_TIMEZONES, tzLabel } from '../lib/timezones'

// ─── Dropdown rendered in a portal so it is never clipped by overflow:hidden ──

function DropdownPortal({ anchorRef, onClose, children }) {
  const [style, setStyle] = useState({})
  const dropRef = useRef(null)

  // Position the dropdown relative to the anchor button
  useEffect(() => {
    function position() {
      if (!anchorRef.current) return
      const rect = anchorRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(288, vw - 16) // 288px or viewport width minus margin
      const spaceBelow = vh - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const maxH = Math.min(280, Math.max(spaceBelow, spaceAbove) - 8)

      // Horizontal: prefer aligning left, flip if it would overflow right edge
      let left = rect.left
      if (left + width > vw - 8) left = Math.max(8, vw - width - 8)

      // Vertical: open downward by default, flip up if not enough room
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow
      const top = openUp ? rect.top - maxH - 4 : rect.bottom + 4

      setStyle({
        position: 'fixed',
        top,
        left,
        width,
        maxHeight: maxH,
        zIndex: 9999,
      })
    }

    position()
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [anchorRef])

  // Close on outside click — use pointerdown so it fires before onClick
  useEffect(() => {
    function handle(e) {
      if (
        dropRef.current && !dropRef.current.contains(e.target) &&
        anchorRef.current && !anchorRef.current.contains(e.target)
      ) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', handle)
    return () => document.removeEventListener('pointerdown', handle)
  }, [onClose, anchorRef])

  return createPortal(
    <div
      ref={dropRef}
      style={{
        ...style,
        background: '#1c1916',
        border: '1px solid rgba(212,184,122,0.2)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      }}>
      {children}
    </div>,
    document.body
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TimezonePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const buttonRef = useRef(null)
  const searchRef = useRef(null)

  const close = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      // Small delay so the portal has rendered
      const t = setTimeout(() => searchRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handle(e) { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, close])

  const label = tzLabel(value) || value || 'Select timezone'

  const q = search.toLowerCase().trim()
  const filteredGroups = q
    ? [{
      label: 'Results', zones: ALL_TIMEZONES.filter(z =>
        z.label.toLowerCase().includes(q) || z.id.toLowerCase().includes(q)
      )
    }]
    : TIMEZONE_GROUPS

  function select(id) {
    onChange(id)
    close()
  }

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full text-left"
        style={{
          color: value ? '#b5aea4' : '#5a5248',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: '6px',
          fontSize: '12px',
        }}>
        <span className="flex-1 truncate min-w-0">{label}</span>
        <ChevronDown
          size={10}
          style={{
            color: '#3d3830',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {/* Portal dropdown */}
      {open && (
        <DropdownPortal anchorRef={buttonRef} onClose={close}>
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Search size={11} style={{ color: '#5a5248', flexShrink: 0 }} />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search city or timezone…"
              className="flex-1 bg-transparent outline-none"
              style={{ color: '#d4cfc8', fontSize: '12px' }}
            />
            {search && (
              <button
                type="button"
                onPointerDown={e => { e.stopPropagation(); setSearch('') }}
                style={{ color: '#5a5248', flexShrink: 0, fontSize: '14px', lineHeight: 1 }}>
                ×
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="overflow-y-auto flex-1" style={{ overscrollBehavior: 'contain' }}>
            {filteredGroups.map(group => (
              <div key={group.label}>
                <p
                  className="px-3 py-1.5 text-xs uppercase tracking-widest sticky top-0"
                  style={{ color: '#3d3830', background: '#1c1916', fontSize: '10px' }}>
                  {group.label}
                </p>
                {group.zones.map(zone => (
                  <button
                    key={zone.id}
                    type="button"
                    // Use onPointerDown so selection happens before the outside-click closes the dropdown
                    onPointerDown={e => { e.stopPropagation(); select(zone.id) }}
                    className="w-full text-left px-3 py-2"
                    style={{
                      background: value === zone.id ? 'rgba(212,184,122,0.12)' : 'transparent',
                      color: value === zone.id ? '#d4b87a' : '#b5aea4',
                      fontSize: '12px',
                    }}>
                    {zone.label}
                  </button>
                ))}
              </div>
            ))}
            {filteredGroups[0]?.zones.length === 0 && (
              <p className="px-3 py-4 text-xs text-center" style={{ color: '#5a5248' }}>
                No timezones found
              </p>
            )}
          </div>
        </DropdownPortal>
      )}
    </div>
  )
}