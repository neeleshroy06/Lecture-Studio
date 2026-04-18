import { useState } from 'react'
import NavBar from './components/shared/NavBar'
import ProfessorPage from './pages/ProfessorPage'
import StudentPage from './pages/StudentPage'

export default function App() {
  const [activeTab, setActiveTab] = useState('professor')

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'professor' ? (
          <ProfessorPage onLaunch={() => setActiveTab('student')} />
        ) : (
          <StudentPage />
        )}
      </div>
    </div>
  )
}
