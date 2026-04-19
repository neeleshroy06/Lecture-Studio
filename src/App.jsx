import { useState } from 'react'
import NavBar from './components/shared/NavBar'
import ProfessorPage from './pages/ProfessorPage'
import StudentPage from './pages/StudentPage'

export default function App() {
  const [activeTab, setActiveTab] = useState('professor')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div
          aria-hidden={activeTab !== 'professor'}
          style={{
            height: '100%',
            display: activeTab === 'professor' ? 'block' : 'none',
          }}
        >
          <ProfessorPage />
        </div>
        <div
          aria-hidden={activeTab !== 'student'}
          style={{
            height: '100%',
            display: activeTab === 'student' ? 'block' : 'none',
          }}
        >
          <StudentPage />
        </div>
      </div>
    </div>
  )
}
