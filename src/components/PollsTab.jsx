import { useState, useEffect } from 'react'
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Plus, Check, ChevronDown, ChevronUp } from 'lucide-react'

export default function PollsTab({ tripId, currentUser }) {
  const [polls, setPolls]     = useState([])
  const [votes, setVotes]     = useState([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm]       = useState({ question: '', options: ['', ''] })
  const [saving, setSaving]   = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { loadPolls() }, [tripId])

  async function loadPolls() {
    const [pollSnap, voteSnap] = await Promise.all([
      getDocs(query(collection(db, 'polls'), where('trip_id', '==', tripId))),
      getDocs(query(collection(db, 'poll_votes'), where('trip_id', '==', tripId))),
    ])
    const pollList = pollSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    // Load options for each poll
    const withOptions = await Promise.all(pollList.map(async poll => {
      const optSnap = await getDocs(query(collection(db, 'poll_options'), where('poll_id', '==', poll.id)))
      return { ...poll, poll_options: optSnap.docs.map(d => ({ id: d.id, ...d.data() })) }
    }))
    withOptions.sort((a,b) => (b.created_at?.seconds||0)-(a.created_at?.seconds||0))
    setPolls(withOptions)
    setVotes(voteSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function createPoll() {
    if (!form.question.trim()) return
    const validOptions = form.options.filter(o => o.trim())
    if (validOptions.length < 2) return
    setSaving(true)
    const pollRef = await addDoc(collection(db, 'polls'), { trip_id: tripId, question: form.question, created_by: currentUser.id, created_at: serverTimestamp() })
    await Promise.all(validOptions.map(text => addDoc(collection(db, 'poll_options'), { poll_id: pollRef.id, text })))
    setForm({ question: '', options: ['', ''] }); setShowNew(false); setSaving(false); loadPolls()
  }

  async function vote(pollId, optionId) {
    // Delete existing vote for this poll
    const existing = votes.filter(v => v.poll_id === pollId && v.user_id === currentUser.id)
    await Promise.all(existing.map(v => deleteDoc(doc(db, 'poll_votes', v.id))))
    await addDoc(collection(db, 'poll_votes'), { poll_id: pollId, option_id: optionId, user_id: currentUser.id, trip_id: tripId, created_at: serverTimestamp() })
    loadPolls()
  }

  return (
    <div className="px-6 pt-4 space-y-4">
      <button onClick={() => setShowNew(!showNew)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm transition-all"
        style={{background:'rgba(212,184,122,0.08)', border:'1px dashed rgba(212,184,122,0.25)', color:'#d4b87a'}}>
        <Plus size={14} />New Poll
      </button>

      {showNew && (
        <div className="glass rounded-2xl p-5 space-y-4 slide-up">
          <h3 className="font-display text-lg font-light" style={{color:'#e8d5a3'}}>Create a Poll</h3>
          <div>
            <p className="text-xs tracking-widest uppercase mb-2" style={{color:'#5a5248'}}>Question</p>
            <input autoFocus value={form.question} onChange={e => setForm({...form, question: e.target.value})}
              placeholder="What should we do on day 2?"
              className="w-full bg-transparent text-sm outline-none"
              style={{color:'#d4cfc8', borderBottom:'1px solid rgba(212,184,122,0.2)', paddingBottom:'8px'}} />
          </div>
          <div>
            <p className="text-xs tracking-widest uppercase mb-2" style={{color:'#5a5248'}}>Options</p>
            {form.options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <span className="text-xs" style={{color:'#5a5248'}}>{i+1}.</span>
                <input value={opt} onChange={e => { const opts=[...form.options]; opts[i]=e.target.value; setForm({...form,options:opts}) }}
                  placeholder={`Option ${i+1}`}
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{color:'#d4cfc8', borderBottom:'1px solid rgba(255,255,255,0.08)', paddingBottom:'6px'}} />
                {form.options.length > 2 && <button onClick={() => setForm({...form, options: form.options.filter((_,j)=>j!==i)})} className="text-xs" style={{color:'#5a5248'}}>✕</button>}
              </div>
            ))}
            {form.options.length < 6 && <button onClick={() => setForm({...form, options:[...form.options,'']})} className="text-xs mt-1" style={{color:'#d4b87a'}}>+ Add option</button>}
          </div>
          <div className="flex gap-2">
            <button onClick={createPoll} disabled={saving} className="flex-1 py-2 rounded-xl text-xs font-medium" style={{background:'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',color:'#0a0908'}}>{saving?'Creating…':'Create Poll'}</button>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-xl text-xs" style={{color:'#5a5248',background:'rgba(255,255,255,0.04)'}}>Cancel</button>
          </div>
        </div>
      )}

      {polls.length === 0 && !showNew && (
        <div className="text-center py-16 fade-in">
          <div className="text-5xl mb-4">🗳️</div>
          <p className="font-display text-xl font-light" style={{color:'#e8d5a3'}}>No polls yet</p>
          <p className="text-sm mt-2" style={{color:'#5a5248'}}>Create a poll to let everyone vote</p>
        </div>
      )}

      {polls.map(poll => {
        const pollVotes = votes.filter(v => v.poll_id === poll.id)
        const myVote    = pollVotes.find(v => v.user_id === currentUser.id)
        const total     = pollVotes.length
        const isExpanded = expanded === poll.id

        return (
          <div key={poll.id} className="glass rounded-2xl overflow-hidden fade-in">
            <button onClick={() => setExpanded(isExpanded ? null : poll.id)}
              className="w-full px-5 py-4 text-left flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-light leading-tight" style={{color:'#e8d5a3'}}>{poll.question}</p>
                <p className="text-xs mt-1" style={{color:'#5a5248'}}>{total} vote{total!==1?'s':''}{myVote?' · voted':' · tap to vote'}</p>
              </div>
              {isExpanded ? <ChevronUp size={14} style={{color:'#5a5248',flexShrink:0,marginTop:4}} /> : <ChevronDown size={14} style={{color:'#5a5248',flexShrink:0,marginTop:4}} />}
            </button>
            {isExpanded && (
              <div className="px-5 pb-5 space-y-2 slide-up">
                {poll.poll_options?.map(option => {
                  const optVotes  = pollVotes.filter(v => v.option_id === option.id).length
                  const pct       = total ? Math.round((optVotes/total)*100) : 0
                  const isMyVote  = myVote?.option_id === option.id
                  return (
                    <button key={option.id} onClick={() => vote(poll.id, option.id)}
                      className="w-full text-left rounded-xl p-3 transition-all active:scale-98 relative overflow-hidden"
                      style={{background:isMyVote?'rgba(212,184,122,0.12)':'rgba(255,255,255,0.03)', border:isMyVote?'1px solid rgba(212,184,122,0.3)':'1px solid rgba(255,255,255,0.05)'}}>
                      <div className="absolute inset-y-0 left-0 rounded-xl transition-all duration-500" style={{width:`${pct}%`,background:'rgba(212,184,122,0.06)'}} />
                      <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isMyVote && <Check size={12} style={{color:'#d4b87a'}} />}
                          <span className="text-sm" style={{color:isMyVote?'#d4b87a':'#d4cfc8'}}>{option.text}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium" style={{color:isMyVote?'#d4b87a':'#5a5248'}}>{pct}%</span>
                          <span className="text-xs ml-1" style={{color:'#5a5248'}}>({optVotes})</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
