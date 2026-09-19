export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  title: string
  description?: string
  priority?: TaskPriority
  dueDate?: Date | string
  status: string
  labels?: string[]
  createdAt: Date | string
}

export type NewTask = Omit<Task, 'id' | 'createdAt'>

export interface Column {
  id: string
  title: string
  tasks: Task[]
}

export interface BoardState {
  columns: Column[]
}
