import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from './components/Layout'
import CharactersPage from './pages/CharactersPage'
import SimulationPage from './pages/SimulationPage'
import ChapterPage from './pages/ChapterPage'
import ExperimentsPage from './pages/ExperimentsPage'

export type PageKey = 'characters' | 'simulation' | 'chapter' | 'experiments'

export default function App() {
  const [page, setPage] = useState<PageKey>('characters')

  return (
    <Layout page={page} onNavigate={setPage}>
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {page === 'characters' && <CharactersPage />}
          {page === 'simulation' && <SimulationPage />}
          {page === 'chapter' && <ChapterPage />}
          {page === 'experiments' && <ExperimentsPage />}
        </motion.div>
      </AnimatePresence>
    </Layout>
  )
}
