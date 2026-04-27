import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, ExternalLink, Trash2, Pencil, X, Check } from 'lucide-react'

const ALBUM_SERVICES = [
  { label: 'Google Photos', emoji: '📸', detect: u => u.includes('photos.google') || u.includes('goo.gl') },
  { label: 'iCloud',        emoji: '☁️',  detect: u => u.includes('icloud.com') },
  { label: 'Dropbox',       emoji: '📦', detect: u => u.includes('dropbox.com') },
  { label: 'Flickr',        emoji: '🌅', detect: u => u.includes('flickr.com') },
  { label: 'Album',         emoji: '🗂️', detect: () => false },
]
const detectService = url => ALBUM_SERVICES.find(s => s.detect(url)) || ALBUM_SERVICES[ALBUM_SERVICES.length - 1]

const BLANK_FORM = { title: '', url: '', description: '' }

export default function PhotosTab({ tripId }) {
  const { user } = useAuth()
  const [albums, setAlbums]     = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(BLANK_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm]   = useState(BLANK_FORM)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { loadAlbums() }, [tripId])

  async function loadAlbums() {
    const snap = await getDocs(query(collection(db, 'photo_albums'), where('trip_id', '==', tripId)))
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    list.sort((a,b) => (b.created_at?.seconds||0)-(a.created_at?.seconds||0))
    setAlbums(list)
  }

  async function addAlbum() {
    if (!form.url.trim()) return
    setSaving(true)
    await addDoc(collection(db, 'photo_albums'), {
      trip_id: tripId, title: form.title || 'Untitled Album',
      url: form.url, description: form.description, added_by: user.id, created_at: serverTimestamp(),
    })
    setForm(BLANK_FORM); setShowForm(false); setSaving(false); loadAlbums()
  }

  async function saveEdit(id) {
    if (!editForm.url.trim()) return
    setSaving(true)
    await updateDoc(doc(db, 'photo_albums', id), {
      title: editForm.title || 'Untitled Album',
      url: editForm.url,
      description: editForm.description,
      updated_at: serverTimestamp(),
    })
    setEditingId(null); setEditForm(BLANK_FORM); setSaving(false); loadAlbums()
  }

  async function deleteAlbum(id) {
    await deleteDoc(doc(db, 'photo_albums', id)); loadAlbums()
  }

  function startEdit(album) {
    setEditForm({
      title: album.title || '',
      url: album.url || '',
      description: album.description || '',
    })
    setEditingId(album.id)
    setShowForm(false)
  }

  return (
    <div className="px-6 pt-4 space-y-4">
      <button onClick={() => { setShowForm(!showForm); setEditingId(null) }}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
        style={{background:'rgba(212,184,122,0.08)',border:'1px dashed rgba(212,184,122,0.25)',color:'#d4b87a'}}>
        <Plus size={14} />Add Photo Album
      </button>

      {showForm && (
        <AlbumForm
          form={form} setForm={setForm}
          saving={saving}
          onSave={addAlbum}
          onCancel={() => { setShowForm(false); setForm(BLANK_FORM) }}
          submitLabel="Add Album"
        />
      )}

      {albums.length === 0 && !showForm && (
        <div className="text-center py-16 fade-in">
          <div className="text-5xl mb-4">📷</div>
          <p className="font-display text-xl font-light" style={{color:'#e8d5a3'}}>No albums yet</p>
          <p className="text-sm mt-2" style={{color:'#5a5248'}}>Link Google Photos, iCloud, or any shared album</p>
        </div>
      )}

      <div className="grid gap-3">
        {albums.map(album => {
          const service = detectService(album.url)
          const canEdit = album.added_by === user.id

          if (editingId === album.id) {
            return (
              <AlbumForm
                key={album.id}
                form={editForm} setForm={setEditForm}
                saving={saving}
                accent="#7a9ab5"
                heading="Edit album"
                onSave={() => saveEdit(album.id)}
                onCancel={() => { setEditingId(null); setEditForm(BLANK_FORM) }}
                submitLabel="Save changes"
              />
            )
          }

          return (
            <div key={album.id} className="glass rounded-2xl fade-in group">
              <a href={album.url} target="_blank" rel="noopener noreferrer"
                className="p-5 flex items-start gap-4 active:scale-98 transition-all">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{background:'rgba(212,184,122,0.1)'}}>{service.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm" style={{color:'#d4cfc8'}}>{album.title}</p>
                      <p className="text-xs mt-0.5" style={{color:'#5a5248'}}>{service.label}</p>
                      {album.description && <p className="text-xs mt-1.5" style={{color:'#5a5248'}}>{album.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <ExternalLink size={12} style={{color:'#5a5248',flexShrink:0}} />
                      {canEdit && (
                        <>
                          <button onClick={e => { e.preventDefault(); startEdit(album) }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                            style={{color:'#7a9ab5'}} title="Edit">
                            <Pencil size={12} />
                          </button>
                          <button onClick={e => { e.preventDefault(); deleteAlbum(album.id) }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{color:'#c47c5a'}} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-xs mt-2 truncate" style={{color:'#3d3830'}}>{album.url}</p>
                </div>
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AlbumForm({ form, setForm, saving, onSave, onCancel, submitLabel, heading, accent }) {
  const accentColor = accent || '#d4b87a'
  return (
    <div className="glass rounded-2xl p-5 space-y-4 slide-up"
      style={accent ? { border: `1px solid ${accent}40`, background: `${accent}08` } : undefined}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-light" style={{color: accent ? accentColor : '#e8d5a3'}}>
          {heading || 'Link an Album'}
        </h3>
        <button onClick={onCancel} style={{color:'#5a5248'}}><X size={14} /></button>
      </div>
      {[
        ['Album URL *', 'url', 'https://photos.google.com/share/…', 'url'],
        ['Title', 'title', 'e.g. Day 1 – Arrival', 'text'],
        ['Description', 'description', 'Optional note', 'text'],
      ].map(([label, key, ph, type]) => (
        <div key={key}>
          <p className="text-xs tracking-widest uppercase mb-2" style={{color:'#5a5248'}}>{label}</p>
          <input type={type} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})} placeholder={ph}
            className="w-full bg-transparent text-sm outline-none"
            style={{color:'#d4cfc8', borderBottom:'1px solid rgba(255,255,255,0.08)', paddingBottom:'8px'}} />
        </div>
      ))}
      {form.url && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:'rgba(255,255,255,0.04)'}}>
          <span>{detectService(form.url).emoji}</span>
          <span className="text-xs" style={{color:'#5a5248'}}>Detected: {detectService(form.url).label}</span>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !form.url}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{background:'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color:'#0a0908'}}>
          {saving ? 'Saving…' : <><Check size={12} />{submitLabel}</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{color:'#5a5248', background:'rgba(255,255,255,0.04)'}}>Cancel</button>
      </div>
    </div>
  )
}
