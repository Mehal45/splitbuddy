import React, { useState, useEffect, ChangeEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'

// Expense type captures a single transaction.
type Expense = {
  id: string
  amount: number
  date: string
  description: string
  paidBy: string
  participants: string[]
}

// Default friends seeded on first load.
const defaultFriends = ['Mehal', 'Aro', 'Dev']

// Utility: compute net balances for each friend given a list of expenses.
function computeNets(friends: string[], expenses: Expense[]): Record<string, number> {
  const nets: Record<string, number> = {}
  friends.forEach((f) => (nets[f] = 0))
  for (const exp of expenses) {
    if (exp.participants.length === 0) continue
    const share = exp.amount / exp.participants.length
    exp.participants.forEach((p) => {
      nets[p] -= share
    })
    nets[exp.paidBy] += exp.amount
  }
  return nets
}

// Utility: aggregate expenses per day for charts.
function dailyData(expenses: Expense[]): { day: string; total: number }[] {
  const map: Record<string, number> = {}
  expenses.forEach((e) => {
    const day = e.date
    map[day] = (map[day] || 0) + e.amount
  })
  return Object.keys(map)
    .sort()
    .map((day) => ({ day, total: map[day] }))
}

const pageVariants = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 10 },
}

const App: React.FC = () => {
  // Friends state persisted to localStorage.
  const [friends, setFriends] = useState<string[]>(() => {
    const stored = localStorage.getItem('friends')
    return stored ? JSON.parse(stored) : defaultFriends
  })
  // Expenses state persisted to localStorage.
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const stored = localStorage.getItem('expenses')
    return stored ? JSON.parse(stored) : []
  })
  // Current tab selection.
  const [tab, setTab] = useState<'add' | 'data' | 'balances' | 'graphs'>('add')

  // Local fields for Add page.
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return today
  })
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [participants, setParticipants] = useState<string[]>([])

  // Persist friends and expenses when they change.
  useEffect(() => {
    localStorage.setItem('friends', JSON.stringify(friends))
  }, [friends])
  useEffect(() => {
    localStorage.setItem('expenses', JSON.stringify(expenses))
  }, [expenses])

  // Handler: add a new expense and reset fields.
  const addExpense = () => {
    const amt = parseFloat(amount)
    if (!paidBy || participants.length === 0 || !amount || isNaN(amt) || amt <= 0) return
    const exp: Expense = {
      id: Date.now().toString(),
      amount: amt,
      date,
      description,
      paidBy,
      participants,
    }
    setExpenses((xs) => [...xs, exp])
    // Clear form
    setAmount('')
    setDescription('')
    setPaidBy('')
    setParticipants([])
  }

  // Handler: delete an expense by id.
  const deleteExpense = (id: string) => {
    setExpenses((xs) => xs.filter((e) => e.id !== id))
  }

  // UI components
  const AddPage = (
    <motion.div
      key="add"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="p-4 space-y-4"
    >
      <h2 className="text-2xl font-semibold">Add Expense</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block mb-1">Amount</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/10 backdrop-blur border border-white/20 focus:outline-none"
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="block mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/10 backdrop-blur border border-white/20 focus:outline-none"
          />
        </div>
        <div>
          <label className="block mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/10 backdrop-blur border border-white/20 focus:outline-none"
            placeholder="What is this about?"
          />
        </div>
        <div>
          <label className="block mb-1">Paid By</label>
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            className="w-full px-3 py-2 rounded bg-white/10 backdrop-blur border border-white/20 focus:outline-none"
          >
            <option value="">Select friend</option>
            {friends.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block mb-1">Participants</label>
          <div className="flex flex-wrap gap-2">
            {friends.map((f) => {
              const selected = participants.includes(f)
              return (
                <button
                  key={f}
                  onClick={() => {
                    setParticipants((ps) =>
                      ps.includes(f)
                        ? ps.filter((x) => x !== f)
                        : [...ps, f],
                    )
                  }}
                  className={`px-3 py-1 rounded-full border border-white/30 ${selected ? 'bg-white/30' : 'bg-white/10'}`}
                >
                  {f}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-4">
        <button
          onClick={addExpense}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 transition text-white"
        >
          Add Expense
        </button>
        <button
          onClick={() => {
            setAmount('')
            setDate(new Date().toISOString().slice(0, 10))
            setDescription('')
            setPaidBy('')
            setParticipants([])
          }}
          className="px-4 py-2 rounded bg-gray-500 hover:bg-gray-600 transition text-white"
        >
          Reset
        </button>
      </div>
    </motion.div>
  )

  const DataPage = (
    <motion.div
      key="data"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="p-4 space-y-4"
    >
      <h2 className="text-2xl font-semibold">Data</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded bg-white/10 backdrop-blur border border-white/20">
            <div className="text-sm">Total Spent</div>
            <div className="text-xl font-bold">
              ₹{expenses.reduce((sum, e) => sum + e.amount, 0).toFixed(2)}
            </div>
          </div>
          <div className="p-4 rounded bg-white/10 backdrop-blur border border-white/20">
            <div className="text-sm">Number of Expenses</div>
            <div className="text-xl font-bold">{expenses.length}</div>
          </div>
          <div className="p-4 rounded bg-white/10 backdrop-blur border border-white/20">
            <div className="text-sm">Number of Friends</div>
            <div className="text-xl font-bold">{friends.length}</div>
          </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-white/20">
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1 text-left">Paid By</th>
              <th className="px-2 py-1 text-left">Participants</th>
              <th className="px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-white/10 hover:bg-white/5 transition">
                <td className="px-2 py-1 whitespace-nowrap">{e.date}</td>
                <td className="px-2 py-1 whitespace-nowrap">{e.description || '-'}</td>
                <td className="px-2 py-1 whitespace-nowrap text-right">₹{e.amount.toFixed(2)}</td>
                <td className="px-2 py-1 whitespace-nowrap">{e.paidBy}</td>
                <td className="px-2 py-1 whitespace-nowrap">{e.participants.join(', ')}</td>
                <td className="px-2 py-1 text-center">
                  <button
                    onClick={() => deleteExpense(e.id)}
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-gray-400">
                  No expenses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  )

  const BalancesPage = (
    <motion.div
      key="balances"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="p-4 space-y-4"
    >
      <h2 className="text-2xl font-semibold">Balances</h2>
      <div className="space-y-2">
        {Object.entries(computeNets(friends, expenses)).map(([f, net]) => (
          <div
            key={f}
            className="flex justify-between items-center p-3 rounded bg-white/10 backdrop-blur border border-white/20"
          >
            <span>{f}</span>
            <span className={net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : ''}>
              {net > 0 ? '+' : ''}₹{net.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )

  const GraphsPage = (
    <motion.div
      key="graphs"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="p-4 space-y-4"
    >
      <h2 className="text-2xl font-semibold">Graphs & Analytics</h2>
      <div className="h-64 w-full bg-white/5 rounded p-4">
        {expenses.length === 0 ? (
          <p className="text-center text-gray-400 pt-20">No data to display yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData(expenses)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="day" stroke="#cbd5e1" />
              <YAxis stroke="#cbd5e1" />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none' }}
                labelStyle={{ color: '#fff' }}
              />
                <Bar
                  dataKey="total"
                  fill="#60a5fa"
                  radius={[4, 4, 0, 0]}
                />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  )

  // Render navigation tabs and content.
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-white/10">
        <h1 className="text-3xl font-bold">Split Buddy</h1>
        <nav className="flex space-x-4">
          {(['add', 'data', 'balances', 'graphs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded transition ${tab === t ? 'bg-blue-600' : 'bg-white/10'} hover:bg-blue-500`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          {tab === 'add' && AddPage}
          {tab === 'data' && DataPage}
          {tab === 'balances' && BalancesPage}
          {tab === 'graphs' && GraphsPage}
        </AnimatePresence>
      </main>
    </div>
  )
}

export default App