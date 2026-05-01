import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { TaskTemplate, TaskTemplateConfig } from '../types/models'

// Reads the singleton config doc at /config/taskTemplates (delta §5 Flow 17).
// Returns an empty array if the doc is missing — UI should show "Custom task" only in that case.
export function useTaskTemplates(): { templates: TaskTemplate[]; loading: boolean } {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'taskTemplates'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as TaskTemplateConfig
        setTemplates(Array.isArray(data.templates) ? data.templates : [])
      } else {
        setTemplates([])
      }
      setLoading(false)
    })
  }, [])

  return { templates, loading }
}
